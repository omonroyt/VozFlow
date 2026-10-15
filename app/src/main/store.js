// Ajustes, API key cifrada e historial. Todo vive en la carpeta de datos de la app
// (%APPDATA%\VozFlow en Windows), nunca dentro del proyecto.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  hotkey: 'ctrl-win',            // ctrl-win | ctrl-alt | f8 | f9
  language: 'es',                // 'es' o 'auto'
  sttModel: 'whisper-large-v3-turbo',
  llmModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
  cleanup: true,                 // si es false, pega la transcripción cruda
  promptSuggestions: true,       // proponer secciones faltantes en modo prompt
  suggestionTimeoutSec: 15,
  restoreClipboard: true,
  useContext: true,              // mandar nombre de la app activa al LLM
  sounds: true,
  micDeviceId: 'default',
  pillIdleVisible: true,
  launchAtLogin: false,
  onboarded: false,
};

const HISTORY_MAX = 40;

function file(name) {
  return path.join(app.getPath('userData'), name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const tmp = file(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file(name));
  } catch (err) {
    console.error('[store] no se pudo guardar', name, err);
  }
}

let settings = null;
let history = null;

function getSettings() {
  if (!settings) settings = { ...DEFAULTS, ...readJson('settings.json', {}) };
  return settings;
}

function setSettings(patch) {
  settings = { ...getSettings(), ...patch };
  writeJson('settings.json', settings);
  return settings;
}

// --- API key (cifrada con DPAPI de Windows vía safeStorage) ---
function getApiKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY.trim();
  const stored = readJson('secrets.json', {});
  if (!stored.groq) return '';
  try {
    if (stored.enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.groq, 'base64'));
    }
    return Buffer.from(stored.groq, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function setApiKey(key) {
  const clean = (key || '').trim();
  if (!clean) {
    writeJson('secrets.json', {});
    return;
  }
  const enc = safeStorage.isEncryptionAvailable();
  const payload = enc
    ? safeStorage.encryptString(clean).toString('base64')
    : Buffer.from(clean, 'utf8').toString('base64');
  writeJson('secrets.json', { groq: payload, enc });
}

// --- Historial de dictados (para recuperar texto si el pegado falla) ---
function getHistory() {
  if (!history) history = readJson('history.json', []);
  return history;
}

function addHistory(entry) {
  const list = getHistory();
  list.unshift({ id: Date.now().toString(36), date: new Date().toISOString(), ...entry });
  history = list.slice(0, HISTORY_MAX);
  writeJson('history.json', history);
  return history;
}

function clearHistory() {
  history = [];
  writeJson('history.json', history);
}

// --- Cuota del plan gratuito (lo que Groq reporta en cada respuesta) ---
// Groq renueva los límites diarios en horario UTC; contamos por día UTC.
function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

let quota = null;
function getQuota() {
  if (!quota) quota = readJson('quota.json', {});
  if (quota.day !== utcDay()) quota = { day: utcDay(), stt: null, llm: {} };
  return quota;
}

function recordQuota(info) {
  const q = getQuota();
  const now = new Date().toISOString();
  if (info.kind === 'stt') {
    q.stt = {
      model: info.model,
      limit: info.limitRequests ?? q.stt?.limit ?? null,
      remaining: info.remainingRequests ?? q.stt?.remaining ?? null,
      exhausted: !!info.exhausted,
      at: now,
    };
  } else if (info.kind === 'llm') {
    const m = q.llm[info.model] || { tokens: 0, requests: 0 };
    if (info.ok) {
      m.tokens += info.tokens || 0;
      m.requests += 1;
    }
    if (info.limitRequests != null) m.limit = info.limitRequests;
    if (info.remainingRequests != null) m.remaining = info.remainingRequests;
    m.exhausted = !!info.exhausted;
    m.at = now;
    q.llm[info.model] = m;
  }
  writeJson('quota.json', q);
  return q;
}

// --- Estadísticas por día (fecha local) ---
function localDay(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

let stats = null;
function getStats() {
  if (!stats) stats = readJson('stats.json', { days: {} });
  return stats;
}

function addStats(entry) {
  const st = getStats();
  const key = localDay();
  const d = st.days[key] || {
    words: 0,
    dictations: 0,
    prompts: 0,
    removed: 0,
    speechMs: 0,
    offered: 0,
    accepted: 0,
  };
  for (const k of Object.keys(d)) d[k] += entry[k] || 0;
  st.days[key] = d;
  // Conservamos 90 días
  const keys = Object.keys(st.days).sort();
  while (keys.length > 90) delete st.days[keys.shift()];
  writeJson('stats.json', st);
  return st;
}

module.exports = {
  DEFAULTS,
  getSettings,
  setSettings,
  getApiKey,
  setApiKey,
  getHistory,
  addHistory,
  clearHistory,
  getQuota,
  recordQuota,
  getStats,
  addStats,
  localDay,
};
