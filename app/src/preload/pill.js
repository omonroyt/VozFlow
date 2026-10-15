const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pill', {
  on: (channel, cb) => {
    const allowed = ['pill:state', 'rec:start', 'rec:stop', 'rec:cancel'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  action: (name) => ipcRenderer.send('pill:action', name),
  setInteractive: (value) => ipcRenderer.send('pill:mouse', !!value),
  sendAudio: (data) => ipcRenderer.send('rec:data', data),
  micError: (message) => ipcRenderer.send('rec:error', message),
});
