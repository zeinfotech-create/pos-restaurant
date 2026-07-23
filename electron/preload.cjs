const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  onServerReady: (callback) => ipcRenderer.on('server-ready', callback),
  onServerError: (callback) => ipcRenderer.on('server-error', (_, msg) => callback(msg)),
  onAppClosing: (callback) => ipcRenderer.on('app-closing', callback),
  notifyReadyToQuit: () => ipcRenderer.send('ready-to-quit'),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  saveFileFromBuffer: (payload) => ipcRenderer.invoke('save-file-from-buffer', payload),
  listBackups: (dirPath) => ipcRenderer.invoke('list-backups', dirPath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  detectCloudFolders: () => ipcRenderer.invoke('detect-cloud-folders'),
  // Lifetime Offline License
  getMachineFingerprint: () => ipcRenderer.invoke('get-machine-fingerprint'),
  verifyLifetimeToken: (token) => ipcRenderer.invoke('verify-lifetime-token', token),
  markLifetimeActivated: () => ipcRenderer.invoke('mark-lifetime-activated'),
  // Silent thermal receipt printing (no PDF, no preview, no print dialog)
  printReceiptSilent: (html) => ipcRenderer.invoke('print-receipt-silent', html)

});

