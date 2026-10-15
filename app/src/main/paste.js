// Pega texto en la app activa: guarda el portapapeles, escribe el texto,
// simula Ctrl+V y luego restaura lo que había antes.
// Usa la API de portapapeles de Electron 44+ (asíncrona, estilo W3C).
const { clipboard, ClipboardItem } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Copia profunda del portapapeles: cada formato se lee a un Blob propio,
// porque lo que devuelve read() deja de ser válido cuando el portapapeles cambia.
async function snapshot() {
  try {
    const items = await clipboard.read();
    if (!items.length) return null;
    const copies = [];
    for (const item of items) {
      const data = {};
      for (const type of item.types) {
        try {
          data[type] = await item.getType(type);
        } catch {}
      }
      if (Object.keys(data).length) copies.push(data);
    }
    return copies.length ? copies : null;
  } catch {
    // Si el formato no se puede leer, al menos conservamos el texto.
    try {
      const text = await clipboard.readText();
      return text ? [{ 'text/plain': text }] : null;
    } catch {
      return null;
    }
  }
}

async function restore(snap) {
  try {
    if (!snap) {
      clipboard.clear();
      return;
    }
    await clipboard.write(snap.map((data) => new ClipboardItem(data)));
  } catch {
    // Último recurso: restaurar solo el texto.
    try {
      const text = snap?.[0]?.['text/plain'];
      if (typeof text === 'string') await clipboard.writeText(text);
      else if (text instanceof Blob) await clipboard.writeText(await text.text());
    } catch {}
  }
}

async function pasteText(text, { hotkeys, restoreClipboard = true } = {}) {
  const saved = restoreClipboard ? await snapshot() : null;
  await clipboard.writeText(text);
  await sleep(60);
  await hotkeys.tapPaste();
  if (restoreClipboard) {
    // Damos tiempo a que la app lea el portapapeles antes de restaurarlo.
    await sleep(600);
    let current = '';
    try {
      current = await clipboard.readText();
    } catch {}
    if (current === text) await restore(saved);
  }
}

async function copyText(text) {
  await clipboard.writeText(String(text || ''));
}

module.exports = { pasteText, copyText, snapshot, restore };
