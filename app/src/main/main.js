// VozFlow — proceso principal.
// Flujo: atajo → grabar (pastilla) → Groq Whisper → Groq LLM → pegar en la app activa.
const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeImage,
  nativeTheme,
  shell,
  session: electronSession,
} = require('electron');

const store = require('./store');
const groq = require('./groq');
const prompts = require('./prompts');
const { getActiveWindow } = require('./context');
const { pasteText, copyText } = require('./paste');
const { Hotkeys, PRESETS } = require('./hotkeys');
const { removedWords, countWords } = require('../shared/diff');

const SHOTS_DIR = process.env.VOZFLOW_SHOTS || '';
const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const RENDERER = path.join(ROOT, 'src', 'renderer');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setName('VozFlow');
if (process.platform === 'win32') app.setAppUserModelId('com.vozflow.app');

const hotkeys = new Hotkeys();
let pillWin = null;
let settingsWin = null;
let tray = null;

// ---------------------------------------------------------------------------
// Estado de la sesión de dictado
// ---------------------------------------------------------------------------
let phase = 'idle'; // idle | recording | processing | suggesting | pasting | done | error
let session = null; // { id, mode, handsFree, pressAt, context }
let seq = 0;
let swallowRelease = false;
let maxTimer = null;
let resetTimer = null;
let pendingDecision = null;

const LABELS = {
  text: 'Limpiando tu texto',
  prompt: 'Armando tu prompt',
  suggest: 'Completando tu prompt',
};

function pillSend(channel, payload) {
  if (pillWin && !pillWin.isDestroyed()) pillWin.webContents.send(channel, payload);
}

function settingsSend(channel, payload) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, payload);
}

function setPhase(next, extra = {}) {
  phase = next;
  clearTimeout(resetTimer);
  const s = store.getSettings();
  pillSend('pill:state', {
    state: next,
    mode: session?.mode || 'text',
    handsFree: !!session?.handsFree,
    idleVisible: s.pillIdleVisible,
    shortcut: (PRESETS[s.hotkey] || PRESETS['ctrl-win']).label,
    ...extra,
  });
  if (next === 'done') resetTimer = setTimeout(() => goIdle(), 1400);
  if (next === 'error') resetTimer = setTimeout(() => goIdle(), 4200);
}

function goIdle() {
  session = null;
  setPhase('idle');
}

function busy() {
  return ['recording', 'processing', 'suggesting', 'pasting'].includes(phase);
}

function startRecording(mode, via = 'hotkey') {
  if (busy()) return;
  const settings = store.getSettings();
  if (!store.getApiKey()) {
    setPhase('error', { message: 'Falta tu API key de Groq', action: 'settings' });
    return;
  }
  const context = settings.useContext ? getActiveWindow() : null;
  session = { id: ++seq, mode, handsFree: via === 'click', pressAt: Date.now(), context };
  placePill(true);
  setPhase('recording');
  pillSend('rec:start', { deviceId: settings.micDeviceId, sounds: settings.sounds });
  clearTimeout(maxTimer);
  maxTimer = setTimeout(() => stopRecording(), 6 * 60 * 1000);
}

function stopRecording() {
  if (phase !== 'recording') return;
  clearTimeout(maxTimer);
  setPhase('processing', { label: LABELS[session.mode] });
  pillSend('rec:stop');
}

function cancelAll() {
  clearTimeout(maxTimer);
  if (phase === 'recording') pillSend('rec:cancel');
  if (phase === 'suggesting' && pendingDecision) {
    pendingDecision('no');
    return;
  }
  if (phase === 'pasting') return;
  session = null;
  setPhase('idle');
}

function waitDecision(timeoutSec) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish('no'), timeoutSec * 1000);
    function finish(answer) {
      clearTimeout(timer);
      pendingDecision = null;
      resolve(answer);
    }
    pendingDecision = finish;
  });
}

function friendlyError(err) {
  if (err?.code === 'auth') return { message: 'Tu API key de Groq no es válida', action: 'settings' };
  if (err?.code === 'rate_limit') return { message: 'Se acabó la cuota gratuita de hoy' };
  if (err?.code === 'network') return { message: 'Sin conexión a internet' };
  if (err?.code === 'timeout') return { message: 'Groq tardó demasiado. Intenta de nuevo' };
  return { message: err?.message || 'Algo falló al procesar tu dictado' };
}

async function processAudio(s, { buffer, mime, durationMs, peak }) {
  const settings = store.getSettings();
  const key = store.getApiKey();
  const started = Date.now();
  let raw = '';
  try {
    if (durationMs < 400) return goIdle();
    if (peak < 0.015) {
      return setPhase('error', { message: 'No se escuchó nada. Revisa tu micrófono', action: 'settings' });
    }

    raw = await groq.transcribe({
      key,
      audio: Buffer.from(buffer),
      mime,
      language: settings.language,
      model: settings.sttModel,
    });
    if (s !== session) return;
    if (!raw) return setPhase('error', { message: 'No te escuché bien. Intenta de nuevo' });

    let final = raw;
    let model = settings.sttModel;
    let fallback = false;
    let offered = 0;
    let accepted = 0;

    if (settings.cleanup && s.mode === 'text') {
      try {
        const r = await groq.chat({ key, models: settings.llmModels, messages: prompts.cleanMessages(raw, s.context) });
        final = prompts.tidyOutput(r.content) || raw;
        model = r.model;
      } catch (err) {
        if (err.code === 'auth') throw err;
        fallback = true;
      }
    } else if (settings.cleanup && s.mode === 'prompt') {
      try {
        const r = await groq.chat({
          key,
          models: settings.llmModels,
          messages: prompts.promptMessages(raw),
          json: true,
        });
        model = r.model;
        const sections = prompts.normalizeSections(prompts.parseJson(r.content));
        const missing = prompts.missingSections(sections);
        if (missing.length === prompts.SECTIONS.length) {
          final = raw;
          fallback = true;
        } else {
          const suggested = [];
          if (missing.length && settings.promptSuggestions) {
            setPhase('suggesting', {
              missing: prompts.sectionLabels(missing),
              timeoutSec: settings.suggestionTimeoutSec,
            });
            offered = 1;
            const answer = await waitDecision(settings.suggestionTimeoutSec);
            if (s !== session) return;
            if (answer === 'yes') {
              accepted = 1;
              setPhase('processing', { label: LABELS.suggest });
              try {
                const r2 = await groq.chat({
                  key,
                  models: settings.llmModels,
                  messages: prompts.suggestMessages(sections, missing),
                  json: true,
                });
                const extra = prompts.normalizeSections(prompts.parseJson(r2.content));
                for (const k of missing) {
                  const v = extra[k];
                  if (Array.isArray(v) ? v.length : v) {
                    sections[k] = v;
                    suggested.push(k);
                  }
                }
              } catch (err) {
                if (err.code === 'auth') throw err;
              }
            }
          }
          final = prompts.renderPrompt(sections, suggested);
        }
      } catch (err) {
        if (err.code === 'auth') throw err;
        fallback = true;
      }
    }

    if (s !== session) return;
    setPhase('pasting');
    await pasteText(final, { hotkeys, restoreClipboard: settings.restoreClipboard });
    store.addHistory({
      mode: s.mode,
      raw,
      final,
      app: s.context?.app || '',
      model,
      ms: Date.now() - started,
      fallback,
    });
    settingsSend('history:updated', store.getHistory());
    store.addStats({
      words: countWords(raw),
      dictations: 1,
      prompts: s.mode === 'prompt' ? 1 : 0,
      removed: s.mode === 'text' && !fallback ? removedWords(raw, final).filter((w) => w.removed).length : 0,
      speechMs: durationMs,
      offered,
      accepted,
    });
    settingsSend('dashboard:updated', dashboard());
    setPhase('done', { message: fallback ? 'Pegado sin limpiar' : 'Pegado' });
  } catch (err) {
    console.error('[vozflow]', err);
    if (raw) {
      store.addHistory({ mode: s.mode, raw, final: raw, app: s.context?.app || '', error: err.message });
      settingsSend('history:updated', store.getHistory());
    }
    setPhase('error', friendlyError(err));
  }
}

// ---------------------------------------------------------------------------
// Ventanas
// ---------------------------------------------------------------------------
const PILL_W = 420;
const PILL_H = 300;

function placePill(followCursor = false) {
  if (!pillWin) return;
  const display = followCursor
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : screen.getPrimaryDisplay();
  const wa = display.workArea;
  const x = Math.round(wa.x + (wa.width - PILL_W) / 2);
  const y = Math.round(wa.y + wa.height - PILL_H - 6);
  pillWin.setBounds({ x, y, width: PILL_W, height: PILL_H });
}

function createPill() {
  pillWin = new BrowserWindow({
    width: PILL_W,
    height: PILL_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'pill.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pillWin.setAlwaysOnTop(true, 'screen-saver');
  pillWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pillWin.setIgnoreMouseEvents(true, { forward: true });
  pillWin.loadFile(path.join(RENDERER, 'pill', 'index.html'));
  placePill();
  pillWin.once('ready-to-show', () => {
    pillWin.showInactive();
    setPhase('idle');
  });
  screen.on('display-metrics-changed', () => placePill());
}

function themeColors() {
  const dark = nativeTheme.shouldUseDarkColors;
  return dark ? { bg: '#141318', symbol: '#C9C5D1' } : { bg: '#F4F4F6', symbol: '#3A3742' };
}

function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    if (section) settingsSend('settings:goto', section);
    return;
  }
  const c = themeColors();
  settingsWin = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: 'VozFlow',
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: c.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: c.bg, symbolColor: c.symbol, height: 44 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings', 'index.html'), {
    query: section ? { section } : {},
  });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

nativeTheme.on('updated', () => {
  if (settingsWin && !settingsWin.isDestroyed() && process.platform === 'win32') {
    const c = themeColors();
    settingsWin.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol });
    settingsWin.setBackgroundColor(c.bg);
  }
});

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('VozFlow');
  const refresh = () => {
    const s = store.getSettings();
    const label = (PRESETS[s.hotkey] || PRESETS['ctrl-win']).label;
    tray.setToolTip(`VozFlow · ${label} para dictar`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir VozFlow', click: () => openSettings() },
        { label: 'Dictar', click: () => startRecording('text', 'click') },
        { label: 'Dictar prompt', click: () => startRecording('prompt', 'click') },
        { type: 'separator' },
        {
          label: 'Iniciar con Windows',
          type: 'checkbox',
          checked: s.launchAtLogin,
          click: (item) => applySettings({ launchAtLogin: item.checked }),
        },
        { type: 'separator' },
        { label: 'Salir', click: () => app.quit() },
      ])
    );
  };
  refresh();
  tray.on('click', () => openSettings());
  tray.refresh = refresh;
}

function applySettings(patch) {
  const next = store.setSettings(patch);
  if ('hotkey' in patch) hotkeys.setPreset(next.hotkey);
  if ('launchAtLogin' in patch && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] });
  }
  if ('pillIdleVisible' in patch || 'hotkey' in patch) {
    if (phase === 'idle') setPhase('idle');
  }
  tray?.refresh?.();
  return next;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function dashboard() {
  const settings = store.getSettings();
  return {
    stats: store.getStats(),
    today: store.localDay(),
    quota: store.getQuota(),
    models: settings.llmModels,
    sttModel: settings.sttModel,
    last: store.getHistory()[0] || null,
    hasKey: !!store.getApiKey(),
    micTested: !!settings.micTested,
    hasHistory: store.getHistory().length > 0,
  };
}

function registerIpc() {
  // Pastilla
  ipcMain.on('pill:mouse', (_e, interactive) => {
    if (!pillWin) return;
    if (interactive) pillWin.setIgnoreMouseEvents(false);
    else pillWin.setIgnoreMouseEvents(true, { forward: true });
  });
  ipcMain.on('pill:action', (_e, action) => {
    switch (action) {
      case 'dictate':
        return startRecording('text', 'click');
      case 'prompt':
        return startRecording('prompt', 'click');
      case 'stop':
        return stopRecording();
      case 'cancel':
        return cancelAll();
      case 'settings':
        return openSettings();
      case 'suggest-yes':
        return pendingDecision?.('yes');
      case 'suggest-no':
        return pendingDecision?.('no');
    }
  });
  ipcMain.on('rec:data', (_e, data) => {
    const s = session;
    if (!s || phase !== 'processing') return;
    processAudio(s, data);
  });
  ipcMain.on('rec:error', (_e, message) => {
    clearTimeout(maxTimer);
    session = null;
    setPhase('error', { message: message || 'No se pudo usar el micrófono', action: 'settings' });
  });

  // Ajustes
  ipcMain.handle('settings:get', () => ({
    settings: store.getSettings(),
    hasKey: !!store.getApiKey(),
    keyFromEnv: !!process.env.GROQ_API_KEY,
    presets: Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, p.label])),
    version: app.getVersion(),
    platform: process.platform,
  }));
  ipcMain.handle('settings:set', (_e, patch) => applySettings(patch || {}));
  ipcMain.handle('key:set', (_e, key) => {
    store.setApiKey(key);
    if (phase === 'error') goIdle();
    return !!store.getApiKey();
  });
  ipcMain.handle('key:test', async (_e, key) => {
    const k = (key || '').trim() || store.getApiKey();
    if (!k) return { ok: false, message: 'Escribe tu API key primero.' };
    try {
      const r = await groq.testKey(k);
      return {
        ok: true,
        whisper: r.models.some((m) => m.includes('whisper')),
        count: r.models.length,
      };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('history:get', () => store.getHistory());
  ipcMain.handle('dashboard:get', () => dashboard());
  ipcMain.handle('history:clear', () => {
    store.clearHistory();
    return [];
  });
  ipcMain.handle('clipboard:write', async (_e, text) => {
    await copyText(text);
    return true;
  });
  ipcMain.handle('open:external', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:try', (_e, mode) => startRecording(mode === 'prompt' ? 'prompt' : 'text', 'click'));
}

// ---------------------------------------------------------------------------
// Atajos
// ---------------------------------------------------------------------------
let lastMods = '';
function registerHotkeys() {
  hotkeys.setPreset(store.getSettings().hotkey);
  hotkeys.on('press', ({ shift }) => {
    if (phase === 'recording') {
      if (session?.handsFree) {
        swallowRelease = true;
        stopRecording();
      }
      return;
    }
    if (busy()) return;
    startRecording(shift ? 'prompt' : 'text', 'hotkey');
  });
  hotkeys.on('shift', () => {
    if (phase === 'recording' && session && session.mode !== 'prompt') {
      session.mode = 'prompt';
      setPhase('recording');
    }
  });
  hotkeys.on('release', () => {
    if (swallowRelease) {
      swallowRelease = false;
      return;
    }
    if (phase !== 'recording' || !session || session.handsFree) return;
    if (Date.now() - session.pressAt < 320) {
      session.handsFree = true;
      setPhase('recording');
    } else {
      stopRecording();
    }
  });
  hotkeys.on('escape', () => {
    if (phase === 'recording' || phase === 'suggesting') cancelAll();
  });
  hotkeys.on('mods', (m) => {
    const sig = `${m.ctrl}${m.meta}${m.shift}${m.alt}`;
    if (sig === lastMods) return;
    lastMods = sig;
    settingsSend('keys:mods', m);
  });
  try {
    hotkeys.start();
  } catch (err) {
    console.error('[hotkeys] no se pudieron registrar:', err);
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
app.on('second-instance', () => openSettings());
app.on('window-all-closed', (e) => e.preventDefault?.());
app.on('before-quit', () => hotkeys.stop());

app.whenReady().then(async () => {
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'clipboard-sanitized-write'].includes(permission));
  });
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'clipboard-sanitized-write'].includes(permission)
  );

  groq.onRate((info) => {
    store.recordQuota(info);
    settingsSend('dashboard:updated', dashboard());
  });
  registerIpc();
  createPill();

  if (SHOTS_DIR && process.env.VOZFLOW_THEME) nativeTheme.themeSource = process.env.VOZFLOW_THEME;
  if (SHOTS_DIR) {
    const { runShots } = require('./shots');
    return runShots({ app, SHOTS_DIR, getPill: () => pillWin, openSettings, getSettings: () => settingsWin, setPhase });
  }

  buildTray();
  registerHotkeys();

  const s = store.getSettings();
  const hidden = process.argv.includes('--hidden');
  if (!hidden && (!store.getApiKey() || !s.onboarded)) openSettings();
});
