const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  transcribe: (pcm) => ipcRenderer.invoke('transcribe', pcm),
  translate: (text, history) => ipcRenderer.invoke('translate', text, history),
  draft: (text, history) => ipcRenderer.invoke('draft', text, history),
  suggest: (history) => ipcRenderer.invoke('suggest', history),
  questions: () => ipcRenderer.invoke('questions'),
  saveMeeting: (id, history) => ipcRenderer.invoke('meeting:save', id, history),
  endMeeting: (id, history) => ipcRenderer.invoke('meeting:end', id, history),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  pickContext: () => ipcRenderer.invoke('settings:pickContext'),
  openDataFolder: () => ipcRenderer.invoke('openDataFolder'),
  getStatus: () => ipcRenderer.invoke('status'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, text) => cb(text)),
});
