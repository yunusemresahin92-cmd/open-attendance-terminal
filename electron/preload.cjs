const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  saveXlsx: (filename, bytes) => ipcRenderer.invoke('save-xlsx', { filename, bytes }),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  retryUpdate: () => ipcRenderer.invoke('retry-update'),
  skipUpdate: () => ipcRenderer.invoke('skip-update'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  getUpdateReady: () => ipcRenderer.invoke('get-update-ready'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateReady: (callback) => {
    const listener = (_event, version) => callback(version);
    ipcRenderer.on('update-ready', listener);
    return () => ipcRenderer.removeListener('update-ready', listener);
  }
});
