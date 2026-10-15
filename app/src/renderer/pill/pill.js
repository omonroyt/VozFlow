// Pastilla flotante: estados visuales, captura de audio y onda iridiscente.
const $ = (sel) => document.querySelector(sel);
const pillEl = $('#pill');
const card = $('#suggest');
const hint = $('#hint');
const canvas = $('#wave');
const ctx2d = canvas.getContext('2d');
const timerEl = $('#timer');
const labelEl = $('#label');
const modeTag = $('#mode-tag');

let state = 'idle';
let mode = 'text';
let shortcut = 'Ctrl + Win';
let idleVisible = true;
let lastSnapshot = {};

// ---------------------------------------------------------------------------
// Interactividad: la ventana deja pasar los clics salvo encima de la pastilla
// ---------------------------------------------------------------------------
let interactive = false;
let openTimer = null;
let closeTimer = null;

function setInteractive(v) {
  if (v === interactive) return;
  interactive = v;
  window.pill.setInteractive(v);
}

function hoverTargets() {
  return [pillEl, card.classList.contains('is-visible') ? card : null].filter(Boolean);
}

document.addEventListener('mousemove', (e) => {
  const over = hoverTargets().some((el) => {
    const r = el.getBoundingClientRect();
    const pad = el === pillEl && state === 'idle' ? 10 : 2;
    return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
  });
  const usable = !(state === 'idle' && !idleVisible && !pillEl.classList.contains('is-open'));
  setInteractive(over && (usable || state !== 'idle'));
  if (state === 'idle') {
    if (over) {
      clearTimeout(closeTimer);
      if (!pillEl.classList.contains('is-open')) {
        clearTimeout(openTimer);
        openTimer = setTimeout(() => pillEl.classList.add('is-open'), 110);
      }
    } else {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => pillEl.classList.remove('is-open'), 260);
    }
  }
});
document.addEventListener('mouseleave', () => {
  setInteractive(false);
  clearTimeout(openTimer);
  closeTimer = setTimeout(() => pillEl.classList.remove('is-open'), 260);
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'dictate' || act === 'prompt') pillEl.classList.remove('is-open');
  window.pill.action(act);
});

// Tooltip con el atajo
const tip = document.createElement('div');
tip.className = 'tip';
document.body.appendChild(tip);
document.querySelectorAll('[data-tip]').forEach((el) => {
  el.addEventListener('mouseenter', () => {
    const r = el.getBoundingClientRect();
    tip.textContent = el.dataset.tip.replace('{k}', shortcut);
    tip.style.left = `${r.left + r.width / 2}px`;
    tip.style.top = `${r.top - 34}px`;
    tip.classList.add('is-visible');
  });
  el.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));
});

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------
function joinEs(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
}

let countdownAnim = null;

function render(s) {
  lastSnapshot = s;
  const prev = state;
  state = s.state;
  mode = s.mode || 'text';
  shortcut = s.shortcut || shortcut;
  idleVisible = s.idleVisible !== false;

  pillEl.dataset.state = state;
  pillEl.dataset.mode = mode;
  pillEl.classList.toggle('is-hidden', !idleVisible);
  if (state !== 'idle') pillEl.classList.remove('is-open');
  tip.classList.remove('is-visible');

  modeTag.textContent = mode === 'prompt' ? 'Prompt' : 'Dictado';
  labelEl.textContent = s.label || (state === 'pasting' ? 'Pegando' : state === 'suggesting' ? 'Esperando tu respuesta' : '');

  // Pista de manos libres
  if (state === 'recording' && s.handsFree) {
    hint.textContent = `Manos libres. Toca ${shortcut} para terminar`;
    hint.classList.add('is-visible');
  } else {
    hint.classList.remove('is-visible');
  }

  // Tarjeta de sugerencias
  if (state === 'suggesting') {
    const missing = s.missing || [];
    $('#suggest-title').innerHTML = `A tu prompt le ${missing.length === 1 ? 'falta' : 'faltan'} ${joinEs(
      missing.map((m) => `<b>${m}</b>`)
    )}. ¿Las agrego?`.replace('¿Las agrego?', missing.length === 1 ? '¿La agrego?' : '¿Las agrego?');
    card.querySelector('.btn-primary').textContent = missing.length === 1 ? 'Agregarla' : 'Agregarlas';
    card.classList.add('is-visible');
    const bar = $('#countdown-bar');
    countdownAnim?.cancel();
    countdownAnim = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: (s.timeoutSec || 15) * 1000,
      easing: 'linear',
      fill: 'forwards',
    });
  } else {
    card.classList.remove('is-visible');
    countdownAnim?.cancel();
  }

  // Estado final
  const statusText = $('#status-text');
  if (state === 'done') statusText.textContent = s.message || 'Pegado';
  if (state === 'error') {
    statusText.textContent = s.message || 'Algo falló';
    const w = Math.min(400, Math.max(220, 64 + s.message.length * 7.1 + (s.action ? 110 : 0)));
    pillEl.style.setProperty('--error-w', `${w}px`);
  }
  pillEl.classList.toggle('has-action', state === 'error' && !!s.action);

  if (state === 'error' && prev !== 'error') beep('error');
  if (['recording', 'processing', 'pasting', 'suggesting'].includes(state)) startLoop();
}

window.pill.on('pill:state', render);

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
let stream = null;
let audioCtx = null;
let analyser = null;
let recorder = null;
let chunks = [];
let recStart = 0;
let peak = 0;
let level = 0;
let cancelled = false;
let timerInt = null;

async function startCapture({ deviceId, sounds }) {
  cancelled = false;
  chunks = [];
  peak = 0;
  level = 0;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    window.pill.micError(
      err.name === 'NotAllowedError'
        ? 'Windows bloqueó el micrófono. Revisa la privacidad'
        : err.name === 'NotFoundError' || err.name === 'OverconstrainedError'
        ? 'No encontré tu micrófono'
        : 'No se pudo abrir el micrófono'
    );
    return;
  }
  if (cancelled) return stopTracks();

  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.2;
  src.connect(analyser);

  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 48000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    const durationMs = Date.now() - recStart;
    const blob = new Blob(chunks, { type: 'audio/webm' });
    stopTracks();
    if (cancelled) return;
    const buffer = new Uint8Array(await blob.arrayBuffer());
    window.pill.sendAudio({ buffer, mime: 'audio/webm', durationMs, peak });
  };
  recorder.start(250);
  recStart = Date.now();
  if (sounds) beep('start');

  clearInterval(timerInt);
  timerEl.textContent = '0:00';
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  soundsOn = sounds;
}

let soundsOn = true;

function stopCapture() {
  clearInterval(timerInt);
  if (recorder && recorder.state !== 'inactive') {
    if (soundsOn) beep('stop');
    recorder.stop();
  } else {
    // El micrófono no llegó a abrirse
    window.pill.sendAudio({ buffer: new Uint8Array(0), mime: 'audio/webm', durationMs: 0, peak: 0 });
  }
}

function cancelCapture() {
  cancelled = true;
  clearInterval(timerInt);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else stopTracks();
}

function stopTracks() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  analyser = null;
  if (audioCtx) audioCtx.close().catch(() => {});
  audioCtx = null;
  recorder = null;
}

window.pill.on('rec:start', startCapture);
window.pill.on('rec:stop', stopCapture);
window.pill.on('rec:cancel', cancelCapture);

// Sonidos suaves sintetizados (sin archivos)
let sfx = null;
function beep(kind) {
  try {
    sfx = sfx || new AudioContext();
    const now = sfx.currentTime;
    const notes = { start: [660, 990], stop: [880, 587], error: [330, 247] }[kind];
    notes.forEach((f, i) => {
      const o = sfx.createOscillator();
      const g = sfx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = now + i * 0.075;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(kind === 'error' ? 0.05 : 0.07, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(sfx.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// Onda: barras con el reflejo de la obsidiana
// ---------------------------------------------------------------------------
const ACCENT = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim() || '#6fd3b8';
const BARS = 22;
const heights = new Array(BARS).fill(0.08);
const seeds = Array.from({ length: BARS }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
let loopOn = false;
const timeData = new Uint8Array(1024);

let fakeLevel = null;
function readLevel() {
  if (fakeLevel !== null) return fakeLevel * (0.6 + 0.4 * Math.random());
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeData.length);
  peak = Math.max(peak, rms);
  return Math.min(1, rms * 5.5);
}

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

function draw(t) {
  const { w, h, dpr } = sizeCanvas();
  ctx2d.clearRect(0, 0, w, h);
  if (!w) return;

  const live = state === 'recording';
  const target = live ? readLevel() : 0;
  level += (target - level) * (target > level ? 0.45 : 0.12);

  const bars = live ? BARS : 9;
  const gap = 2 * dpr;
  const bw = Math.max(2 * dpr, (w - gap * (bars - 1)) / bars);
  const total = bars * bw + gap * (bars - 1);
  const x0 = (w - total) / 2;

  ctx2d.fillStyle = ACCENT;

  for (let i = 0; i < bars; i++) {
    let v;
    if (live) {
      const center = 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
      const envelope = 0.35 + 0.65 * Math.pow(center, 0.8);
      const wobble = 0.55 + 0.45 * Math.sin(t / (140 + seeds[i] * 90) + i * 1.7);
      const targetH = 0.1 + level * envelope * wobble * 0.95;
      heights[i] += (targetH - heights[i]) * 0.35;
      v = heights[i];
    } else {
      // Pensando: una ola que recorre las barras
      v = 0.16 + 0.22 * (0.5 + 0.5 * Math.sin(t / 220 - i * 0.7));
    }
    const bh = Math.max(3 * dpr, v * h);
    const x = x0 + i * (bw + gap);
    const y = (h - bh) / 2;
    ctx2d.globalAlpha = live ? 0.95 : 0.85;
    roundRect(x, y, bw, bh, bw / 2);
  }
  ctx2d.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx2d.beginPath();
  ctx2d.roundRect(x, y, w, h, r);
  ctx2d.fill();
}

function startLoop() {
  if (loopOn) return;
  loopOn = true;
  const frame = (t) => {
    if (!['recording', 'processing', 'pasting', 'suggesting'].includes(state)) {
      loopOn = false;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    draw(t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Para capturas de pantalla automáticas
window.__render = render;
window.__fakeLevel = (v) => {
  fakeLevel = v;
};
