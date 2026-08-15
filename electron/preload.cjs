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
  getHubToken: () => ipcRenderer.invoke('get-hub-token'),
  // Lifetime Offline License
  getMachineFingerprint: () => ipcRenderer.invoke('get-machine-fingerprint'),
  verifyLifetimeToken: (token) => ipcRenderer.invoke('verify-lifetime-token', token),
  markLifetimeActivated: () => ipcRenderer.invoke('mark-lifetime-activated'),
  // Silent receipt printing (no OS print dialog — the app shows its own
  // in-app preview instead when Settings > Print > "Show print preview" is
  // on). Accepts an options object so paper size / copy count can vary per
  // print instead of the old hardcoded single-shot thermal 80mm call.
  printReceiptSilent: (html, opts) => ipcRenderer.invoke('print-receipt-silent', html, opts),
  // Lists this machine's installed printers, for the Settings printer picker
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  // Raw ESC-POS printing direct to a network printer's IP (bypasses the OS
  // print spooler entirely) — used when Settings > Printing > Connection
  // Type is "Network (IP)"
  printReceiptNetwork: (html, opts) => ipcRenderer.invoke('print-receipt-network', html, opts),
  // Silent PDF export — saves straight to the Downloads folder, no print dialog
  exportReportPdfSilent: (payload) => ipcRenderer.invoke('export-pdf-silent', payload),
  // Weight Scale (RS-232/USB-Serial) bridge — Settings > Printing > Weight Scale
  listScalePorts: () => ipcRenderer.invoke('scale:list-ports'),
  connectScale: (config) => ipcRenderer.invoke('scale:connect', config),
  disconnectScale: () => ipcRenderer.invoke('scale:disconnect'),
  onScaleWeight: (callback) => {
    const handler = (_, weight) => callback(weight);
    ipcRenderer.on('scale:weight', handler);
    return () => ipcRenderer.removeListener('scale:weight', handler);
  },
  onScaleError: (callback) => {
    const handler = (_, msg) => callback(msg);
    ipcRenderer.on('scale:error', handler);
    return () => ipcRenderer.removeListener('scale:error', handler);
  },
  onScaleStatus: (callback) => {
    const handler = (_, status) => callback(status);
    ipcRenderer.on('scale:status', handler);
    return () => ipcRenderer.removeListener('scale:status', handler);
  }

});

