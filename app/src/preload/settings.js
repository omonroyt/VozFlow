const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vozflow', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setApiKey: (key) => ipcRenderer.invoke('key:set', key),
  testApiKey: (key) => ipcRenderer.invoke('key:test', key),
  getHistory: () => ipcRenderer.invoke('history:get'),
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  onDashboard: (cb) => ipcRenderer.on('dashboard:updated', (_e, d) => cb(d)),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  tryDictation: (mode) => ipcRenderer.invoke('app:try', mode),
  onHistory: (cb) => ipcRenderer.on('history:updated', (_e, list) => cb(list)),
  onMods: (cb) => ipcRenderer.on('keys:mods', (_e, mods) => cb(mods)),
  onGoto: (cb) => ipcRenderer.on('settings:goto', (_e, section) => cb(section)),
});
