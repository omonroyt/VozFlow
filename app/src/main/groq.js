// Cliente mínimo de Groq (API compatible con OpenAI).
// - Voz a texto: /audio/transcriptions
// - LLM: /chat/completions con cadena de modelos de respaldo
const BASE = process.env.VOZFLOW_GROQ_BASE || 'https://api.groq.com/openai/v1';

class GroqError extends Error {
  constructor(message, { status = 0, code = '', retryable = true } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// Quien quiera enterarse de la cuota (main.js) se registra aquí.
let rateListener = null;
function onRate(fn) {
  rateListener = fn;
}
function report(info) {
  try {
    rateListener?.(info);
  } catch {}
}

function readLimits(res) {
  const num = (h) => {
    const v = res.headers.get(h);
    return v == null || v === '' ? null : Number(v);
  };
  // En Groq, *-requests siempre es por día y *-tokens por minuto.
  return {
    limitRequests: num('x-ratelimit-limit-requests'),
    remainingRequests: num('x-ratelimit-remaining-requests'),
  };
}

async function request(url, { key, body, headers = {}, timeoutMs = 20000, method = 'POST', meta = null }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...headers },
      body,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const timeout = err.name === 'AbortError';
    throw new GroqError(timeout ? 'Groq tardó demasiado en responder.' : 'No hay conexión con Groq.', {
      code: timeout ? 'timeout' : 'network',
    });
  }
  clearTimeout(timer);
  if (res.ok) {
    const data = await res.json();
    if (meta) report({ ...meta, ok: true, ...readLimits(res), tokens: data?.usage?.total_tokens || 0 });
    return data;
  }
  if (meta && res.status === 429) report({ ...meta, ok: false, exhausted: true, ...readLimits(res) });

  let detail = '';
  try {
    const data = await res.json();
    detail = data?.error?.message || '';
  } catch {}
  const status = res.status;
  if (status === 401 || status === 403) {
    throw new GroqError('La API key de Groq no es válida.', { status, code: 'auth', retryable: false });
  }
  if (status === 429) {
    throw new GroqError('Se alcanzó el límite gratuito de este modelo por hoy.', { status, code: 'rate_limit' });
  }
  throw new GroqError(detail || `Groq respondió con error ${status}.`, { status, code: 'http' });
}

// Frases que Whisper "alucina" en español cuando hay silencio o ruido.
const HALLUCINATIONS = [
  /subt[ií]tulos? (realizados? )?(por|de) la comunidad de amara\.org/i,
  /^gracias por ver( el v[ií]deo)?\.?$/i,
  /^¡?gracias\.?!?$/i,
  /^suscr[ií]bete/i,
  /^(m[uú]sica|aplausos|risas)\.?$/i,
  /^\.+$/,
  /^thank you( for watching)?\.?$/i,
  /amara\.org/i,
];

function cleanWhisper(json) {
  let text = '';
  if (Array.isArray(json.segments) && json.segments.length) {
    text = json.segments
      .filter((s) => !(s.no_speech_prob > 0.75 && s.avg_logprob < -0.6))
      .map((s) => s.text)
      .join('')
      .trim();
  } else {
    text = (json.text || '').trim();
  }
  if (!text) return '';
  if (HALLUCINATIONS.some((re) => re.test(text))) return '';
  return text;
}

async function transcribe({ key, audio, mime = 'audio/webm', language = 'es', model = 'whisper-large-v3-turbo' }) {
  const form = new FormData();
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  form.append('file', new Blob([audio], { type: mime }), `dictado.${ext}`);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('temperature', '0');
  if (language && language !== 'auto') form.append('language', language);
  const json = await request(`${BASE}/audio/transcriptions`, {
    key,
    body: form,
    timeoutMs: 45000,
    meta: { kind: 'stt', model },
  });
  return cleanWhisper(json);
}

function isReasoningModel(model) {
  return model.startsWith('openai/gpt-oss');
}

// Llama a la cadena de modelos: si uno se queda sin cuota o falla, pasa al siguiente.
async function chat({ key, models, messages, json = false, maxTokens = 1800, timeoutMs = 15000 }) {
  let lastError = null;
  for (const model of models) {
    const body = {
      model,
      messages,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
    };
    if (isReasoningModel(model)) {
      body.reasoning_effort = 'low';
      body.include_reasoning = false;
    }
    if (json) body.response_format = { type: 'json_object' };

    try {
      const data = await request(`${BASE}/chat/completions`, {
        key,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        timeoutMs,
        meta: { kind: 'llm', model },
      });
      const content = data?.choices?.[0]?.message?.content?.trim() || '';
      if (!content) throw new GroqError('El modelo devolvió una respuesta vacía.', { code: 'empty' });
      return { content, model };
    } catch (err) {
      lastError = err;
      if (err.code === 'auth') throw err;
      // Si el modelo no acepta el modo JSON, se intenta una vez sin él.
      if (json && err.status === 400) {
        try {
          delete body.response_format;
          const data = await request(`${BASE}/chat/completions`, {
            key,
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
            timeoutMs,
            meta: { kind: 'llm', model },
          });
          const content = data?.choices?.[0]?.message?.content?.trim() || '';
          if (content) return { content, model };
        } catch (err2) {
          lastError = err2;
          if (err2.code === 'auth') throw err2;
        }
      }
      console.warn(`[groq] ${model} falló (${err.code || err.status}): ${err.message}`);
    }
  }
  throw lastError || new GroqError('Ningún modelo respondió.');
}

async function testKey(key) {
  const data = await request(`${BASE}/models`, { key, method: 'GET', timeoutMs: 10000 });
  const ids = (data?.data || []).map((m) => m.id);
  return { ok: true, models: ids };
}

module.exports = { transcribe, chat, testKey, onRate, GroqError, cleanWhisper };
