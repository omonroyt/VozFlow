const api = window.vozflow;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let state = { settings: {}, hasKey: false, presets: {} };

const ICON = {
  win: '<svg viewBox="0 0 20 20"><path d="M3 4.5 9 3.6v5.9H3ZM10.2 3.4 17 2.4v7.1h-6.8ZM3 10.6h6v5.9l-6-.9ZM10.2 10.6H17v7.1l-6.8-1Z" fill="currentColor" stroke="none"/></svg>',
  shift: '<svg viewBox="0 0 20 20"><path d="M10 3.5 3.5 10.5H7v5.5h6v-5.5h3.5Z"/></svg>',
};

const KEYDEF = {
  ctrl: { label: 'Ctrl', mod: 'ctrl' },
  win: { label: 'Win', icon: ICON.win, mod: 'meta' },
  alt: { label: 'Alt', mod: 'alt' },
  shift: { label: 'Shift', icon: ICON.shift, mod: 'shift', wide: true },
  f8: { label: 'F8' },
  f9: { label: 'F9' },
};

const PRESET_KEYS = {
  'ctrl-win': ['ctrl', 'win'],
  'ctrl-alt': ['ctrl', 'alt'],
  f8: ['f8'],
  f9: ['f9'],
};

function keycaps(keys) {
  return keys
    .map((k) => {
      const d = KEYDEF[k];
      const cls = `key${d.wide ? ' wide' : ''}`;
      return `<span class="${cls}" data-mod="${d.mod || ''}">${d.icon || ''}${d.label}</span>`;
    })
    .join('<span class="plus">+</span>');
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------
function go(page) {
  const valid = ['inicio', 'conexion', 'atajos', 'microfono', 'preferencias', 'recientes'];
  if (!valid.includes(page)) page = 'inicio';
  $$('.page').forEach((p) => p.classList.toggle('is-active', p.id === `page-${page}`));
  $$('#nav a').forEach((a) => a.classList.toggle('is-active', a.dataset.page === page));
  $('#main').scrollTop = 0;
  if (page !== 'microfono') stopMeter();
  if (page === 'microfono') loadMics();
  if (page === 'recientes') api.getHistory().then(renderHistory);
  if (page === 'inicio') refreshDashboard();
}

window.addEventListener('hashchange', () => go(location.hash.slice(1)));
api.onGoto((section) => {
  location.hash = section;
});

// ---------------------------------------------------------------------------
// Render general
// ---------------------------------------------------------------------------
function renderAll() {
  const s = state.settings;
  const base = PRESET_KEYS[s.hotkey] || PRESET_KEYS['ctrl-win'];
  $('[data-combo="text"]').innerHTML = keycaps(base);
  $('[data-combo="prompt"]').innerHTML = keycaps([...base, 'shift']);

  // Ajustes simples
  $$('[data-setting]').forEach((el) => {
    const v = s[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.tagName === 'SELECT' && el.id !== 'mic') el.value = String(v);
  });

  // Cadena de modelos
  $('#chain').innerHTML = (s.llmModels || []).map((m) => `<li>${m.replace('openai/', '')}</li>`).join('');

  // Atajos
  $('#presets').innerHTML = Object.entries(PRESET_KEYS)
    .map(
      ([id, keys]) => `
      <label class="preset ${s.hotkey === id ? 'is-selected' : ''}">
        <input type="radio" name="hotkey" value="${id}" ${s.hotkey === id ? 'checked' : ''} />
        <div class="keys">${keycaps(keys)}</div>
        <span class="preset-copy">${id === 'ctrl-win' ? 'Recomendado. Igual que Wispr Flow.' : id === 'ctrl-alt' ? 'Cómodo con una mano.' : 'Una sola tecla.'}</span>
      </label>`
    )
    .join('');

  renderStatus();
}

function renderStatus() {
  const el = $('#side-status');
  el.classList.toggle('is-ok', state.hasKey);
  el.classList.toggle('is-warn', !state.hasKey);
  $('.txt', el).textContent = state.hasKey ? 'Conectado a Groq' : 'Falta tu API key';
  $('#api-key').placeholder = state.hasKey
    ? state.keyFromEnv
      ? 'Usando GROQ_API_KEY del sistema'
      : '••••••••••••  (guardada)'
    : 'gsk_…';
}

// ---------------------------------------------------------------------------
// Cambios de ajustes
// ---------------------------------------------------------------------------
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.name === 'hotkey') {
    state.settings = await api.setSettings({ hotkey: el.value });
    renderAll();
    return;
  }
  const key = el.dataset.setting;
  if (!key) return;
  let value = el.type === 'checkbox' ? el.checked : el.value;
  if (el.hasAttribute('data-number')) value = Number(value);
  state.settings = await api.setSettings({ [key]: value });
});

// ---------------------------------------------------------------------------
// API key
// ---------------------------------------------------------------------------
const keyInput = $('#api-key');
const keyMsg = $('#key-msg');

function msg(el, text, kind = '') {
  el.textContent = text;
  el.className = `field-msg${kind ? ` is-${kind}` : ''}`;
}

$('#toggle-key').addEventListener('click', () => {
  keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
});

$('#save-key').addEventListener('click', async () => {
  const value = keyInput.value.trim();
  if (!value) return msg(keyMsg, 'Pega tu API key antes de guardar.', 'err');
  if (!value.startsWith('gsk_')) msg(keyMsg, 'Las keys de Groq empiezan con gsk_. Revisa que la copiaste completa.', 'err');
  const btn = $('#save-key');
  btn.disabled = true;
  msg(keyMsg, 'Comprobando…');
  const test = await api.testApiKey(value);
  btn.disabled = false;
  if (!test.ok) return msg(keyMsg, test.message, 'err');
  state.hasKey = await api.setApiKey(value);
  state.settings = await api.setSettings({ onboarded: true });
  keyInput.value = '';
  renderStatus();
  refreshDashboard();
  msg(keyMsg, 'Guardada. Ya puedes dictar con tu atajo.', 'ok');
});

$('#test-key').addEventListener('click', async () => {
  const btn = $('#test-key');
  btn.disabled = true;
  msg(keyMsg, 'Probando conexión…');
  const r = await api.testApiKey(keyInput.value.trim());
  btn.disabled = false;
  if (r.ok) msg(keyMsg, `Conexión correcta. ${r.whisper ? 'Whisper disponible.' : 'Whisper no aparece en tu cuenta.'}`, 'ok');
  else msg(keyMsg, r.message, 'err');
});

keyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#save-key').click();
});

$$('[data-ext]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    api.openExternal(a.dataset.ext);
  })
);

// ---------------------------------------------------------------------------
// Teclas en vivo: las keycaps se hunden cuando presionas el atajo real
// ---------------------------------------------------------------------------
api.onMods((m) => {
  $$('.combos .key').forEach((k) => {
    const mod = k.dataset.mod;
    if (mod) k.classList.toggle('is-down', !!m[mod]);
  });
});

// ---------------------------------------------------------------------------
// Prueba
// ---------------------------------------------------------------------------
$$('[data-try]').forEach((b) =>
  b.addEventListener('click', () => {
    const area = $('#try-area');
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    api.tryDictation(b.dataset.try);
    $('#try-note').textContent = 'Grabando. Usa el botón de la pastilla para terminar.';
    setTimeout(() => ($('#try-note').textContent = 'Esc cancela en cualquier momento.'), 6000);
  })
);

// ---------------------------------------------------------------------------
// Micrófono
// ---------------------------------------------------------------------------
async function loadMics() {
  const sel = $('#mic');
  try {
    // Pedimos permiso una vez para poder leer los nombres de los dispositivos.
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch {}
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const current = state.settings.micDeviceId || 'default';
  const opts = [{ deviceId: 'default', label: 'Predeterminado de Windows' }].concat(
    devices.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
  );
  sel.innerHTML = opts
    .map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || `Micrófono ${i}`)}</option>`)
    .join('');
  sel.value = opts.some((o) => o.deviceId === current) ? current : 'default';
}

let meter = null;
async function startMeter() {
  stopMeter();
  const id = state.settings.micDeviceId;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: id && id !== 'default' ? { exact: id } : undefined },
    });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(512);
    let max = 0;
    const started = Date.now();
    meter = { stream, ctx, raf: 0 };
    const tick = () => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / data.length) * 6);
      max = Math.max(max, lvl);
      $('#meter-fill').style.width = `${Math.round(lvl * 100)}%`;
      if (Date.now() - started > 6000) {
        stopMeter();
        msg(
          $('#mic-msg'),
          max > 0.12 ? 'Tu micrófono se escucha bien.' : 'Se escucha muy bajo. Revisa el dispositivo o acércate.',
          max > 0.12 ? 'ok' : 'err'
        );
        if (max > 0.12 && !state.settings.micTested) {
          api.setSettings({ micTested: true }).then((s2) => {
            state.settings = s2;
            refreshDashboard();
          });
        }
        return;
      }
      meter.raf = requestAnimationFrame(tick);
    };
    msg($('#mic-msg'), 'Habla durante unos segundos…');
    tick();
  } catch {
    msg($('#mic-msg'), 'No se pudo abrir el micrófono. Revisa la privacidad de Windows.', 'err');
  }
}
function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.raf);
  meter.stream.getTracks().forEach((t) => t.stop());
  meter.ctx.close().catch(() => {});
  meter = null;
  $('#meter-fill').style.width = '0%';
}
$('#mic-test').addEventListener('click', startMeter);

// ---------------------------------------------------------------------------
// Recientes
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function ago(iso) {
  const diff = (new Date(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'hace un momento';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

let historyCache = [];
function renderHistory(list) {
  historyCache = list || [];
  const ul = $('#history');
  if (!historyCache.length) {
    ul.innerHTML = `<li class="empty">Aún no hay dictados. Mantén <b>${escapeHtml(
      state.presets[state.settings.hotkey] || 'Ctrl + Win'
    )}</b> en cualquier app y habla.</li>`;
    return;
  }
  ul.innerHTML = historyCache
    .map(
      (h, i) => `
    <li>
      <div class="h-meta">
        <span class="tag ${h.mode}">${h.mode === 'prompt' ? 'Prompt' : 'Dictado'}</span>
        <span>${h.app ? `En ${escapeHtml(h.app)}, ` : ''}${ago(h.date)}</span>
        ${h.fallback ? '<span>sin limpiar</span>' : ''}
        ${h.error ? '<span>con error</span>' : ''}
      </div>
      <p class="h-text">${escapeHtml(h.final)}</p>
      <div class="h-actions">
        <button class="link-btn" data-copy="${i}">Copiar</button>
        <button class="link-btn" data-raw="${i}">Ver lo que dijiste</button>
      </div>
    </li>`
    )
    .join('');
}

$('#history').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  const raw = e.target.closest('[data-raw]');
  if (copy) {
    await api.copy(historyCache[+copy.dataset.copy].final);
    copy.textContent = 'Copiado';
    setTimeout(() => (copy.textContent = 'Copiar'), 1400);
  }
  if (raw) {
    const li = raw.closest('li');
    const existing = $('.h-raw', li);
    if (existing) {
      existing.remove();
      raw.textContent = 'Ver lo que dijiste';
      return;
    }
    const p = document.createElement('p');
    p.className = 'h-raw';
    p.textContent = historyCache[+raw.dataset.raw].raw;
    $('.h-actions', li).before(p);
    $('.h-text', li).classList.add('is-open');
    raw.textContent = 'Ocultar original';
  }
});

$('#clear-history').addEventListener('click', async () => renderHistory(await api.clearHistory()));
api.onHistory((list) => {
  if ($('#page-recientes').classList.contains('is-active')) renderHistory(list);
  else historyCache = list;
});


// ---------------------------------------------------------------------------
// Inicio: resumen, cuota del plan gratuito y último dictado
// ---------------------------------------------------------------------------
const nf = new Intl.NumberFormat('es-MX');
const TPD = { 'openai/gpt-oss-120b': 200000, 'openai/gpt-oss-20b': 200000, 'llama-3.1-8b-instant': 500000 };
const shortModel = (m) => (m || '').replace('openai/', '');
const TYPING_WPM = 40;

function listEs(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

function minutesText(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `unas ${h} h${m ? ` ${m} min` : ''}`;
  }
  return min === 1 ? 'un minuto' : `unos ${min} minutos`;
}

function weekTotals(days) {
  const total = { words: 0, dictations: 0, prompts: 0, removed: 0, offered: 0, accepted: 0 };
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now - i * 86400000);
    const key = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const day = days[key];
    if (day) for (const k of Object.keys(total)) total[k] += day[k] || 0;
  }
  return total;
}

function renderSummary(d) {
  const today = d.stats?.days?.[d.today];
  const title = $('#summary-title');
  if (today && today.words) {
    const saved = Math.round(today.words / TYPING_WPM - today.speechMs / 60000);
    title.textContent =
      saved >= 1
        ? `Hoy dictaste ${nf.format(today.words)} palabras y te ahorraste ${minutesText(saved)} de escribir.`
        : `Hoy dictaste ${nf.format(today.words)} palabras.`;
  } else {
    title.textContent = 'Todavía no dictas nada hoy.';
  }

  const w = weekTotals(d.stats?.days || {});
  const parts = [];
  if (w.words) parts.push(`${nf.format(w.words)} palabras`);
  if (w.removed) parts.push(`${nf.format(w.removed)} muletillas y repeticiones eliminadas`);
  if (w.prompts) parts.push(`${nf.format(w.prompts)} ${w.prompts === 1 ? 'prompt estructurado' : 'prompts estructurados'}`);
  if (w.offered) parts.push(`${w.accepted} de ${w.offered} sugerencias aceptadas`);
  const week = $('#summary-week');
  week.textContent = parts.length ? `Esta semana: ${listEs(parts)}.` : '';
  week.hidden = !parts.length;
}

function renderChecklist(d) {
  const steps = { key: d.hasKey, mic: d.micTested || !!state.settings.micTested, first: d.hasHistory };
  const list = $('#checklist');
  list.hidden = Object.values(steps).every(Boolean);
  for (const [k, done] of Object.entries(steps)) {
    $(`[data-step="${k}"]`, list).classList.toggle('is-done', !!done);
  }
}

function setBar(row, fraction, warn) {
  const bar = $('.bar span', row);
  bar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  row.classList.toggle('is-warn', !!warn);
}

function renderQuota(d) {
  const q = d.quota || {};
  const note = $('#quota-note');
  const notes = [];

  // Voz a texto
  const sttRow = $('#quota-stt');
  if (q.stt?.exhausted) {
    $('.quota-text', sttRow).textContent = 'Se acabó la cuota de hoy';
    setBar(sttRow, 0, true);
  } else if (q.stt?.limit && q.stt.remaining != null) {
    $('.quota-text', sttRow).textContent = `Te quedan ${nf.format(q.stt.remaining)} de ${nf.format(q.stt.limit)} dictados`;
    setBar(sttRow, q.stt.remaining / q.stt.limit, q.stt.remaining / q.stt.limit < 0.15);
  } else {
    $('.quota-text', sttRow).textContent = 'Sin datos todavía hoy';
    setBar(sttRow, 1, false);
  }

  // Limpieza: el primer modelo de la cadena que aún tiene cuota
  const llmRow = $('#quota-llm');
  const models = d.models || [];
  const llm = q.llm || {};
  const activeIdx = Math.max(0, models.findIndex((m) => !llm[m]?.exhausted));
  const active = models[activeIdx];
  const next = models[activeIdx + 1];
  const m = llm[active];
  const limit = TPD[active] || 200000;
  $('.quota-title', llmRow).textContent = `Limpieza con ${shortModel(active)}`;
  if (m && m.tokens) {
    const avg = m.requests ? m.tokens / m.requests : 1000;
    const left = Math.max(0, Math.floor((limit - m.tokens) / avg));
    $('.quota-text', llmRow).textContent = `Usaste ${nf.format(m.tokens)} de ${nf.format(limit)} tokens. Alcanza para unos ${nf.format(left)} dictados más`;
    const frac = 1 - m.tokens / limit;
    setBar(llmRow, frac, frac < 0.15);
    if (frac < 0.15 && next) notes.push(`Cuando se acabe, VozFlow seguirá con ${shortModel(next)}.`);
  } else {
    $('.quota-text', llmRow).textContent = 'Sin datos todavía hoy';
    setBar(llmRow, 1, false);
  }
  if (activeIdx > 0) {
    notes.unshift(`${shortModel(models[0])} se quedó sin cuota hoy, así que se está usando ${shortModel(active)}.`);
  }
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
}

function renderLast(d) {
  const box = $('#last');
  const meta = $('#last-meta');
  const h = d.last;
  if (!h) {
    meta.textContent = '';
    box.innerHTML = '<p class="empty-note">Tu primer dictado aparecerá aquí, con lo que dijiste y lo que se pegó.</p>';
    return;
  }
  meta.textContent = `${h.mode === 'prompt' ? 'Prompt' : 'Dictado'}${h.app ? ` en ${h.app}` : ''}, ${ago(h.date)}`;
  let said;
  if (h.mode === 'text' && !h.fallback && !h.error) {
    said = window.VFDiff.removedWords(h.raw, h.final)
      .map((w) => (w.removed ? `<del>${escapeHtml(w.word)}</del>` : escapeHtml(w.word)))
      .join(' ');
  } else {
    said = escapeHtml(h.raw);
  }
  box.innerHTML = `
    <div class="compare">
      <div>
        <p class="compare-label">Lo que dijiste</p>
        <p class="compare-text said">${said}</p>
      </div>
      <div>
        <p class="compare-label">Lo que se pegó</p>
        <p class="compare-text">${escapeHtml(h.final)}</p>
      </div>
    </div>
    <button class="link-btn" id="copy-last">Copiar otra vez</button>`;
  $('#copy-last').addEventListener('click', async (e) => {
    await api.copy(h.final);
    e.target.textContent = 'Copiado';
    setTimeout(() => (e.target.textContent = 'Copiar otra vez'), 1400);
  });
}

function renderDashboard(d) {
  renderSummary(d);
  renderChecklist(d);
  renderQuota(d);
  renderLast(d);
}

async function refreshDashboard() {
  renderDashboard(await api.getDashboard());
}
api.onDashboard(renderDashboard);

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
(async function init() {
  state = await api.getSettings();
  renderAll();
  const params = new URLSearchParams(location.search);
  const start = location.hash.slice(1) || params.get('section') || (state.hasKey ? 'inicio' : 'inicio');
  go(start);
})();
