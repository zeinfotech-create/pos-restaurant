// ============================================================
// ZeInfoTech POS — Electron Main Process
// ============================================================
const { app, BrowserWindow, dialog, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const LICENSE_PUBLIC_KEY = require('./licensePublicKey.cjs');


// ─── CI / Headless GPU fix ────────────────────────────────
// Must be called BEFORE app.whenReady() to take effect
if (process.env.CI) {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

let mainWindow = null;
let serverProcess = null;
let tray = null;
let splashWindow = null;

// Prevent a second launch from opening a duplicate window and spawning a
// second local server (which would also crash with EADDRINUSE on port 3030).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      return;
    }
    // If splashWindow exists, this instance is still starting up (splash/
    // server still loading) — do nothing and let its own app.whenReady()
    // flow create the single window when ready. Calling createMainWindow()
    // here too would race it and open a second window.
    if (splashWindow) return;
    // Neither exists: window-all-closed left this instance alive in the
    // tray (see that handler below) with no window at all. Without this,
    // re-launching the app while it's tray-resident silently does nothing —
    // easy to mistake for "nothing happens" and try launching again.
    createMainWindow();
  });
}

const isDev = !app.isPackaged;
// In CI we always load from the built dist so there's no Vite server dependency
const useDistInCI = !!process.env.CI;

// ─── Path helpers ─────────────────────────────────────────
function res(...parts) {
  return path.join(__dirname, '..', ...parts);
}

function getNodeExe() {
  if (isDev) {
    // 1. Bundled portable node
    const devBundled = path.join(__dirname, '..', 'node-portable', 'node.exe');
    if (fs.existsSync(devBundled)) return devBundled;
    // 2. Node binary that npm itself uses (set when launched via npm run)
    const npmNode = process.env.npm_node_execpath || process.env.npm_execpath;
    if (npmNode && fs.existsSync(npmNode) && path.basename(npmNode).toLowerCase().startsWith('node')) return npmNode;
    // 3. Common Windows install paths
    const common = [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
    ];
    for (const p of common) { if (fs.existsSync(p)) return p; }
    return 'node';
  }
  const resNode = path.join(process.resourcesPath, 'node.exe');
  if (fs.existsSync(resNode)) return resNode;
  const sideNode = path.join(path.dirname(process.execPath), 'node.exe');
  if (fs.existsSync(sideNode)) return sideNode;
  return 'node';
}

// ─── Splash Screen ────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    skipTaskbar: true, // Never show a second, confusing taskbar entry for the splash
    webPreferences: { nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.show();
  splashWindow.on('closed', () => { splashWindow = null; });
}

// ─── Server ───────────────────────────────────────────────
function spawnServer(script, serverCwd, userData) {
  const nodeExe = getNodeExe();
  console.log('[Server] Launching with node:', nodeExe);
  console.log('[Server] Script:', script, '| exists:', fs.existsSync(script));
  console.log('[Server] CWD:', serverCwd);

  // The Electron desktop build is a one-time local install: it must always run
  // against the local MongoDB instance, never Atlas — Atlas is reserved for the
  // hosted web/cloud version. This applies regardless of Lifetime activation.
  console.log('[Server] Electron desktop build — forcing MONGODB_MODE=local');

  const proc = spawn(nodeExe, [script], {
    cwd: serverCwd,
    shell: true,
    env: {
      ...process.env,
      WWEBJS_AUTH_PATH: path.join(userData, '.wwebjs_auth'),
      WWEBJS_CACHE_PATH: path.join(userData, '.wwebjs_cache'),
      // Do NOT override DB_TYPE — let server read its own .env (MongoDB Atlas)
      PORT: '3030',
      MONGODB_MODE: 'local',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => console.log('[Server]', d.toString().trim()));
  proc.stderr.on('data', d => console.error('[Server ERR]', d.toString().trim()));
  proc.on('error', err => console.error('[Server SPAWN ERROR]', err.code, err.message));
  proc.on('close', code => console.log(`[Server] Exited (${code})`));
  return proc;
}

function startServer() {
  const script    = isDev ? res('server', 'index.js') : path.join(process.resourcesPath, 'server', 'index.js');
  const serverCwd = isDev ? res('server') : path.join(process.resourcesPath, 'server');
  const userData  = app.getPath('userData');

  // WRITE LOG TO DISK SO WE CAN READ IT
  const logData = `
    isDev: ${isDev}
    script: ${script} (exists: ${fs.existsSync(script)})
    serverCwd: ${serverCwd} (exists: ${fs.existsSync(serverCwd)})
    userData: ${userData}
  `;
  try {
    fs.writeFileSync(path.join(userData, 'startServer_debug.log'), logData);
    console.log('[Debug] startServer_debug.log written to', userData);
  } catch (e) {
    console.error('[Debug] Failed to write startServer_debug.log:', e);
  }

  serverProcess = spawnServer(script, serverCwd, userData);

  serverProcess.on('error', err => {
    fs.appendFileSync(path.join(userData, 'startServer_debug.log'), '\nERROR EVENT: ' + err.message + ' CODE: ' + err.code);
    dialog.showErrorBox('Server Error', `Failed to start sync server:\n${err.message}`);
  });
}

function waitForServer(cb, attempts = 0) {
  // The response callback and the request's 'error' handler can BOTH fire for
  // the same request — Node can still emit a late socket error after a
  // response was already delivered if its body is never drained. Without a
  // one-shot guard, that stray error re-enters the retry loop even after
  // cb(true) already ran, and once the retry also succeeds, cb(true) fires a
  // SECOND time — which previously called createMainWindow() twice, opening
  // two full windows.
  let settled = false;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    cb(result);
  };

  if (attempts > 30) { settle(false); return; }
  const req = http.get('http://127.0.0.1:3030/health', res => {
    res.resume(); // drain the body so the socket doesn't linger and later error
    if (res.statusCode === 200) { settle(true); return; }
    setTimeout(() => waitForServer(cb, attempts + 1), 1000);
  });
  req.on('error', () => {
    if (settled) return;
    setTimeout(() => waitForServer(cb, attempts + 1), 1000);
  });
  req.end();
}

// ─── Main Window ──────────────────────────────────────────
function createMainWindow() {
  // Idempotency guard: no matter what calls this (waitForServer's callback,
  // 'activate', 'second-instance', the tray menu), never end up with two
  // live windows — if one already exists, just bring it to front.
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }

  const iconPath = path.join(__dirname, 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f172a',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    title: 'ZeInfoTech POS',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.setMenuBarVisibility(false);
  if (isDev && !useDistInCI) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(res('dist', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    mainWindow.show();
    mainWindow.maximize();
  });

  mainWindow.on('close', (e) => {
    if (mainWindow) {
      e.preventDefault();
      mainWindow.webContents.send('app-closing');
      setTimeout(() => { if (mainWindow) mainWindow.destroy(); }, 5000);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  // ─── Open target="_blank" / window.open() in a new Electron BrowserWindow ──
  // Prevents links from launching the system's default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1280,
      height: 820,
      minWidth: 800,
      minHeight: 600,
      backgroundColor: '#0f172a',
      autoHideMenuBar: true,
      title: 'ZeInfoTech POS',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    },
  }));

  // Propagate the same handler to every child window that may open further links
  // Also maximize child windows so the Kiosk fills the screen properly
  mainWindow.webContents.on('did-create-window', (childWin) => {
    childWin.setMenuBarVisibility(false);

    // Maximize once the window is ready (gives a proper kiosk full-screen experience)
    childWin.once('ready-to-show', () => {
      childWin.maximize();
      childWin.show();
    });

    // Prevent child windows from opening yet more system-browser links
    childWin.webContents.setWindowOpenHandler(({ url }) => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1280,
        height: 820,
        minWidth: 800,
        minHeight: 600,
        backgroundColor: '#0f172a',
        autoHideMenuBar: true,
        title: 'ZeInfoTech POS',
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      },
    }));
  });
}

// ─── System Tray ──────────────────────────────────────────
function createTray() {
  if (process.env.CI) return; // Tray causes crashes in headless xvfb environments
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    if (!fs.existsSync(iconPath)) return;
    const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('ZeInfoTech POS');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open POS',  click: () => { if (mainWindow) mainWindow.focus(); else createMainWindow(); } },
      { type: 'separator' },
      { label: 'Quit POS',  click: () => app.quit() },
    ]));
  } catch (e) { console.error('[Tray] Failed:', e.message); }
}

// ─── App Lifecycle ────────────────────────────────────────
app.whenReady().then(() => {
  if (!process.env.CI) {
    createSplash();
    createTray();
    startServer();
    waitForServer((ok) => { createMainWindow(); });
  } else {
    // In CI, skip splash, tray, and server entirely.
    // The server requires Postgres which isn't running, and spawn errors could show a native blocking dialog.
    createMainWindow();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill('SIGTERM'); serverProcess = null; }
  if (tray) tray.destroy();
});

// ─── IPC Handlers ─────────────────────────────────────────
// Resolve the window that actually sent the IPC call, falling back to the
// module-level mainWindow reference. This is more robust than trusting
// mainWindow alone — if it's ever stale/null when a dialog IPC fires, the
// old code silently short-circuited to a fake { canceled: true } with no
// dialog ever shown, which looked exactly like "nothing happens when I click".
function windowForEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

ipcMain.handle('show-save-dialog', async (event, options) => {
  const win = windowForEvent(event);
  if (!win) return { canceled: true };
  return await dialog.showSaveDialog(win, options);
});

ipcMain.handle('select-directory', async (event) => {
  const win = windowForEvent(event);
  if (!win) return { canceled: true };
  return await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
});

ipcMain.handle('save-file-from-buffer', async (event, { filePath, buffer }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('list-backups', async (event, dirPath) => {
  try {
    if (!fs.existsSync(dirPath)) return [];
    const files = fs.readdirSync(dirPath);
    return files.filter(f => f.startsWith('Auto_Backup_') && f.endsWith('.json'))
      .map(f => ({ name: f, path: path.join(dirPath, f), mtime: fs.statSync(path.join(dirPath, f)).mtimeMs }));
  } catch (err) { return []; }
});

// Best-effort detection of installed cloud-sync clients (OneDrive/Dropbox/
// Google Drive), so backups can be pointed at one automatically instead of
// requiring the user to browse for it manually. Purely local filesystem/env
// checks — no network calls, no accounts, no API keys.
ipcMain.handle('detect-cloud-folders', async () => {
  const results = [];

  try {
    // Windows sets one of these env vars once OneDrive is installed & signed in.
    const oneDrivePath = process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial
      || path.join(os.homedir(), 'OneDrive');
    if (oneDrivePath && fs.existsSync(oneDrivePath)) {
      results.push({ provider: 'OneDrive', path: oneDrivePath });
    }
  } catch (e) { /* ignore */ }

  try {
    // Dropbox's own info.json records the real configured sync path(s).
    const infoPath = path.join(process.env.APPDATA || '', 'Dropbox', 'info.json');
    if (fs.existsSync(infoPath)) {
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      const dbxPath = info.personal?.path || info.business?.path;
      if (dbxPath && fs.existsSync(dbxPath)) results.push({ provider: 'Dropbox', path: dbxPath });
    } else {
      const fallback = path.join(os.homedir(), 'Dropbox');
      if (fs.existsSync(fallback)) results.push({ provider: 'Dropbox', path: fallback });
    }
  } catch (e) { /* ignore */ }

  try {
    // Legacy "Backup and Sync" mirrors into the home folder; current "Drive
    // for Desktop" mounts a virtual drive letter instead (checked as fallback).
    let found = false;
    for (const name of ['Google Drive', 'GoogleDrive']) {
      const p = path.join(os.homedir(), name);
      if (fs.existsSync(p)) { results.push({ provider: 'Google Drive', path: p }); found = true; break; }
    }
    if (!found) {
      for (let code = 67; code <= 90; code++) {
        const p = String.fromCharCode(code) + ':\\My Drive';
        if (fs.existsSync(p)) { results.push({ provider: 'Google Drive', path: p }); break; }
      }
    }
  } catch (e) { /* ignore */ }

  return results;
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try { if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return { success: true }; } return { success: false, error: 'File not found' }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.on('ready-to-quit', () => { if (mainWindow) mainWindow.destroy(); });

// ─── Silent thermal receipt printing ────────────────────────────────────────
// Renders the receipt HTML off-screen and sends it straight to the system's
// default printer — no PDF file, no preview window, no OS print dialog.
ipcMain.handle('print-receipt-silent', async (event, html) => {
  let hiddenWin;
  try {
    hiddenWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await hiddenWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // 3-inch (80mm) thermal roll width, with the page height fitted to the
    // actual receipt content instead of a fixed A4/Letter sheet.
    // Note: unlike printToPDF (inches), webContents.print()'s custom pageSize
    // is in MICRONS — confirmed by Chromium's own validation error when this
    // was passed in inches ("height and width properties must be minimum
    // 352 microns").
    const contentHeightPx = await hiddenWin.webContents.executeJavaScript('document.body.scrollHeight');
    const MICRONS_PER_INCH = 25400;
    const widthMicrons = 80 * 1000; // 80mm
    const heightInches = Math.max(contentHeightPx / 96, 2) + 0.1;
    const heightMicrons = Math.round(heightInches * MICRONS_PER_INCH);

    const result = await new Promise((resolve) => {
      hiddenWin.webContents.print({
        silent: true,
        printBackground: true,
        pageSize: { width: widthMicrons, height: heightMicrons },
        margins: { marginType: 'none' },
      }, (success, failureReason) => {
        resolve({ success, error: success ? null : failureReason });
      });
    });

    hiddenWin.destroy();
    hiddenWin = null;
    return result;
  } catch (e) {
    if (hiddenWin && !hiddenWin.isDestroyed()) hiddenWin.destroy();
    console.error('[Print] print-receipt-silent failed:', e.message);
    return { success: false, error: e.message };
  }
});

// ─── Silent PDF export (Reports) ────────────────────────────────────────
// Renders arbitrary report HTML off-screen and saves it straight to the
// Downloads folder as a PDF — no OS print dialog, same silent approach as
// print-receipt-silent above, just producing a file instead of a printout.
ipcMain.handle('export-pdf-silent', async (event, { html, filename }) => {
  let hiddenWin;
  try {
    hiddenWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await hiddenWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // printToPDF's pageSize is in inches (unlike webContents.print's microns —
    // see the note above); 'A4' is one of Electron's supported named sizes.
    const pdfBuffer = await hiddenWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' }
    });

    hiddenWin.destroy();
    hiddenWin = null;

    const downloadsDir = app.getPath('downloads');
    const safeName = (filename || 'Report').replace(/[\\/:*?"<>|]/g, '_');
    let targetPath = path.join(downloadsDir, `${safeName}.pdf`);
    let counter = 1;
    while (fs.existsSync(targetPath)) {
      targetPath = path.join(downloadsDir, `${safeName} (${counter}).pdf`);
      counter++;
    }
    fs.writeFileSync(targetPath, pdfBuffer);
    return { success: true, path: targetPath };
  } catch (e) {
    if (hiddenWin && !hiddenWin.isDestroyed()) hiddenWin.destroy();
    console.error('[Print] export-pdf-silent failed:', e.message);
    return { success: false, error: e.message };
  }
});

// ─── Lifetime Offline License (Item 2) ─────────────────────────────────────
ipcMain.handle('get-machine-fingerprint', () => {
  try { return machineIdSync(true); } catch (e) { console.error('[Lifetime] Fingerprint error:', e.message); return null; }
});

ipcMain.handle('verify-lifetime-token', (event, token) => {
  try {
    if (!token || typeof token !== 'string' || !token.includes('.')) return { valid: false };
    const [payloadB64, sigB64] = token.split('.');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(payloadB64);
    verifier.end();
    const sigOk = verifier.verify(LICENSE_PUBLIC_KEY, Buffer.from(sigB64, 'base64'));
    if (!sigOk) return { valid: false, reason: 'bad-signature' };

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    const currentFingerprint = machineIdSync(true);
    if (payload.deviceFingerprint !== currentFingerprint) return { valid: false, reason: 'device-mismatch' };

    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: e.message };
  }
});

// Marks this install as lifetime-activated so future server spawns force
// MONGODB_MODE=local (no more cloud/Atlas dependency after activation).
ipcMain.handle('mark-lifetime-activated', () => {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'lifetime-activated.flag'), 'true');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
