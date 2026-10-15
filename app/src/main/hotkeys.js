// Atajos globales con uiohook (detecta mantener/soltar, cosa que globalShortcut no puede).
//   combo           → dictado
//   combo + Shift   → modo prompt (Shift se puede agregar en cualquier momento)
//   Esc             → cancelar
const { EventEmitter } = require('events');
const { uIOhook, UiohookKey: K } = require('uiohook-napi');

const PRESETS = {
  'ctrl-win': { label: 'Ctrl + Win', test: (m) => m.ctrl && m.meta && !m.alt },
  'ctrl-alt': { label: 'Ctrl + Alt', test: (m) => m.ctrl && m.alt && !m.meta },
  f8: { label: 'F8', test: (m, keys) => keys.has(K.F8) },
  f9: { label: 'F9', test: (m, keys) => keys.has(K.F9) },
};

const MOD = {
  ctrl: [K.Ctrl, K.CtrlRight],
  meta: [K.Meta, K.MetaRight],
  shift: [K.Shift, K.ShiftRight],
  alt: [K.Alt, K.AltRight],
};

class Hotkeys extends EventEmitter {
  constructor() {
    super();
    this.keys = new Set();
    this.preset = PRESETS['ctrl-win'];
    this.active = false;
    this.shiftSent = false;
    this.muted = false; // mientras VozFlow simula Ctrl+V
    this.started = false;
  }

  setPreset(id) {
    this.preset = PRESETS[id] || PRESETS['ctrl-win'];
  }

  mods(e) {
    const has = (list) => list.some((k) => this.keys.has(k));
    return {
      ctrl: has(MOD.ctrl),
      meta: has(MOD.meta),
      shift: has(MOD.shift),
      alt: has(MOD.alt),
    };
  }

  // Si se perdió un keyup (por ejemplo, con Win+L), las banderas del evento lo corrigen.
  resync(e) {
    if (e.ctrlKey === false) MOD.ctrl.forEach((k) => this.keys.delete(k));
    if (e.metaKey === false) MOD.meta.forEach((k) => this.keys.delete(k));
    if (e.shiftKey === false) MOD.shift.forEach((k) => this.keys.delete(k));
    if (e.altKey === false) MOD.alt.forEach((k) => this.keys.delete(k));
  }

  evaluate() {
    const m = this.mods();
    const now = this.preset.test(m, this.keys);
    if (now && !this.active) {
      this.active = true;
      this.shiftSent = m.shift;
      this.emit('press', { shift: m.shift });
    } else if (now && this.active && m.shift && !this.shiftSent) {
      this.shiftSent = true;
      this.emit('shift');
    } else if (!now && this.active) {
      this.active = false;
      this.emit('release');
    }
    this.emit('mods', m);
  }

  start() {
    if (this.started) return;
    uIOhook.on('keydown', (e) => {
      if (this.muted) return;
      this.keys.add(e.keycode);
      if (e.keycode === K.Escape) this.emit('escape');
      this.evaluate();
    });
    uIOhook.on('keyup', (e) => {
      if (this.muted) return;
      this.keys.delete(e.keycode);
      this.resync(e);
      this.evaluate();
    });
    uIOhook.start();
    this.started = true;
  }

  stop() {
    if (!this.started) return;
    uIOhook.stop();
    this.started = false;
  }

  // Simula Ctrl+V sin que nuestro propio listener lo tome como atajo.
  async tapPaste() {
    this.muted = true;
    try {
      uIOhook.keyTap(K.V, [K.Ctrl]);
    } finally {
      setTimeout(() => {
        this.muted = false;
      }, 120);
    }
  }
}

module.exports = { Hotkeys, PRESETS };
