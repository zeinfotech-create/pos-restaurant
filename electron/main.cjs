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
const net = require('net');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const LICENSE_PUBLIC_KEY = require('./licensePublicKey.cjs');
const { parseScaleLine } = require('./scaleParser.cjs');

// Weight Scale (RS-232/USB-Serial) bridge — native module, loaded lazily
// and wrapped in try/catch. `serialport`'s bindings are N-API (ABI-stable
// across Node/Electron versions) so this should load fine in the packaged
// app without a separate electron-rebuild step, but a machine missing the
// right prebuilt binary for its OS/arch should still fail soft: Weight
// Scale just reports "not available" instead of crashing the whole app on
// startup for stores that don't even use a scale.
let SerialPort = null;
let ReadlineParser = null;
let scaleLoadError = null;
try {
  ({ SerialPort } = require('serialport'));
  ({ ReadlineParser } = require('@serialport/parser-readline'));
} catch (e) {
  scaleLoadError = e.message;
  console.error('[WeightScale] serialport module failed to load:', e.message);
}


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
let mongodProcess = null;
let tray = null;
let scalePort = null; // currently-open weight scale SerialPort instance, if any

// Secret shared with the local hub server so its onboarding-only endpoints
// (standalone-reset/standalone-register) can tell a real request from this
// app apart from any other local process hitting localhost:3030 — without
// it, those endpoints wipe/write shop data for anyone who can reach the
// loopback address, e.g. JS running in an unrelated browser tab.
//
// Persisted to disk (not regenerated per launch): startServer() below can
// reuse an already-running server instead of spawning a new one (e.g. an
// orphaned instance from an unclean previous shutdown that survived past
// this launch). A fresh random token every launch would mismatch whatever
// that surviving process was actually given, turning the exact crash-
// recovery case the reuse logic exists for into a 403 instead of a normal
// working install.
let HUB_ADMIN_TOKEN = null;
function loadOrCreateHubToken() {
  const tokenPath = path.join(app.getPath('userData'), 'hub-token.txt');
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) return existing;
  } catch (e) { /* no token file yet — generate one below */ }
  const fresh = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(tokenPath, fresh); } catch (e) { console.error('[Server] Failed to persist hub token:', e.message); }
  return fresh;
}
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

function getMongodExe() {
  if (isDev) {
    const devBundled = path.join(__dirname, '..', 'mongodb-portable', 'mongod.exe');
    if (fs.existsSync(devBundled)) return devBundled;
    return null;
  }
  const resMongod = path.join(process.resourcesPath, 'mongodb-portable', 'mongod.exe');
  if (fs.existsSync(resMongod)) return resMongod;
  return null;
}

// ─── MongoDB (bundled, portable, embedded) ─────────────────
// This app ships its own mongod.exe (same "no separate install" philosophy
// as the bundled portable node.exe above) so a fresh machine works out of
// the box with no manual MongoDB installation step. It's spawned as a plain
// child process against a per-user data directory — not installed as a
// Windows service — so it needs no admin rights and can't collide with
// anything already registered on the system.
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

function spawnMongod(mongodExe, dbPath, userData) {
  console.log('[Mongo] Launching with mongod:', mongodExe);
  console.log('[Mongo] dbPath:', dbPath);

  fs.mkdirSync(dbPath, { recursive: true });

  const proc = spawn(mongodExe, [
    '--dbpath', dbPath,
    '--port', '27017',
    '--bind_ip', '127.0.0.1', // never accept connections beyond this machine
    '--quiet',
  ], {
    cwd: path.dirname(mongodExe),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => console.log('[Mongo]', d.toString().trim()));
  proc.stderr.on('data', d => console.error('[Mongo ERR]', d.toString().trim()));
  proc.on('error', err => {
    console.error('[Mongo SPAWN ERROR]', err.code, err.message);
    try { fs.appendFileSync(path.join(userData, 'startServer_debug.log'), '\nMONGO SPAWN ERROR: ' + err.message); } catch (e) {}
  });
  proc.on('close', code => console.log(`[Mongo] Exited (${code})`));
  return proc;
}

// Waits for port 27017 to accept connections, then calls back — used both
// after spawning our own bundled mongod, and (if something is already
// listening, e.g. a real MongoDB the user separately installed, such as on
// this project's own dev machine) as the sole check before skipping our own
// spawn entirely, so this never tries to double-bind the port.
function waitForMongo(cb, attempts = 0) {
  if (attempts > 30) { cb(false); return; }
  isPortOpen(27017).then(open => {
    if (open) { cb(true); return; }
    setTimeout(() => waitForMongo(cb, attempts + 1), 1000);
  });
}

async function startMongo(cb) {
  const alreadyRunning = await isPortOpen(27017);
  if (alreadyRunning) {
    console.log('[Mongo] Something is already listening on 27017 — using it instead of spawning our own.');
    cb(true);
    return;
  }

  const mongodExe = getMongodExe();
  if (!mongodExe) {
    console.error('[Mongo] No bundled mongod.exe found and nothing is already listening on 27017.');
    cb(false);
    return;
  }

  const userData = app.getPath('userData');
  const dbPath = path.join(userData, 'mongodb-data');
  mongodProcess = spawnMongod(mongodExe, dbPath, userData);
  waitForMongo(cb);
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

  // shell:true was here before, but on Windows it routes the spawn through
  // `cmd.exe /c <command>`, which naively splits the command string on the
  // FIRST space with no auto-quoting — breaking silently (exits cleanly,
  // no 'error' event, nothing logged) the moment nodeExe's path contains a
  // space, which it always does for any real per-machine install under
  // "C:\Program Files\<product name>\..." (confirmed: this exact path only
  // ever gets exercised by a genuinely installed build, never by dev mode,
  // which is why this went unnoticed until the first real installer test).
  // Node's spawn() correctly handles spaced paths and args natively without
  // a shell — including the bare 'node' PATH-lookup fallback in getNodeExe()
  // — so shell:true was never actually needed here.
  const proc = spawn(nodeExe, [script], {
    cwd: serverCwd,
    env: {
      ...process.env,
      WWEBJS_AUTH_PATH: path.join(userData, '.wwebjs_auth'),
      WWEBJS_CACHE_PATH: path.join(userData, '.wwebjs_cache'),
      // Do NOT override DB_TYPE — let server read its own .env (MongoDB Atlas)
      PORT: '3030',
      MONGODB_MODE: 'local',
      HUB_ADMIN_TOKEN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => console.log('[Server]', d.toString().trim()));
  proc.stderr.on('data', d => console.error('[Server ERR]', d.toString().trim()));
  proc.on('error', err => console.error('[Server SPAWN ERROR]', err.code, err.message));
  proc.on('close', code => console.log(`[Server] Exited (${code})`));
  return proc;
}

async function startServer() {
  const script    = isDev ? res('server', 'index.js') : path.join(process.resourcesPath, 'server', 'index.js');
  const serverCwd = isDev ? res('server') : path.join(process.resourcesPath, 'server');
  const userData  = app.getPath('userData');

  // Unlike Mongo (bundled portable mongod on port 27017), nothing here ever
  // checks whether port 3030 is already held by an orphaned server process
  // from an unclean previous shutdown (crash, Task Manager kill — anything
  // that skips the app's own 'before-quit' cleanup). Spawning a second
  // process on top of that just fails to bind (see server/index.js's
  // server.on('error', ...)) — reuse whatever's already answering instead,
  // mirroring startMongo()'s existing "use what's already there" pattern.
  if (await isPortOpen(3030)) {
    console.log('[Server] Port 3030 already in use — reusing the existing instance instead of spawning a new one.');
    return;
  }

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

  // 90s, not 30s: waitForMongo() only confirms Mongo's TCP port is open, not
  // that it's actually ready to serve queries. On a first run, Mongo has to
  // create its data files from scratch before it's truly ready — the port
  // can open before that finishes. When that happens, the sync server's own
  // connectDB() can hit its 10s Mongoose serverSelectionTimeoutMS, then
  // retry after a 5s delay — one retry cycle alone can burn 25s+ before the
  // server ever starts listening, blowing past a 30s budget on a slow first
  // run even though the server would have come up fine given a bit longer.
  // Subsequent runs are fast because Mongo's data files already exist.
  if (attempts > 90) { settle(false); return; }
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

  let isClosing = false;
  mainWindow.on('close', (e) => {
    if (mainWindow) {
      e.preventDefault();
      // A second close attempt (impatient double-click on X, or Alt+F4
      // pressed twice) while the first close is still running the 5s
      // teardown window would otherwise re-send 'app-closing' and kick off
      // a second concurrent runAutoBackup(true) — two backups writing to
      // the same second-precision timestamped filename can race/clobber
      // each other. Only the first close attempt actually triggers it.
      if (isClosing) return;
      isClosing = true;
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
    HUB_ADMIN_TOKEN = loadOrCreateHubToken();
    createSplash();
    createTray();
    // Mongo must be accepting connections before the sync server tries to
    // connect to it, so this gates startServer() rather than running in parallel.
    startMongo((mongoOk) => {
      if (!mongoOk) {
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        dialog.showErrorBox('Database Error', 'Could not start the bundled database (MongoDB). Please reinstall the app, or contact support if the problem continues.');
        app.quit();
        return;
      }
      startServer();
      waitForServer((ok) => {
        if (!ok) {
          if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
          dialog.showErrorBox('Server Error', 'The local sync server did not start in time. Please restart the app, or contact support if the problem continues.');
          app.quit();
          return;
        }
        createMainWindow();
      });
    });
  } else {
    // In CI, skip splash, tray, mongo, and server entirely.
    // The server requires Postgres which isn't running, and spawn errors could show a native blocking dialog.
    createMainWindow();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !tray) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill('SIGTERM'); serverProcess = null; }
  if (mongodProcess) { mongodProcess.kill('SIGTERM'); mongodProcess = null; }
  if (tray) tray.destroy();
  // Release the COM port so it isn't left locked for the next launch (or
  // for another app) if the store owner quits without disconnecting first.
  if (scalePort && scalePort.isOpen) { try { scalePort.close(); } catch (_) { /* already closing */ } }
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
  // The only caller (BackupService.js) writes either a user-chosen path from
  // a native showSaveDialog (trustworthy — the OS dialog controls it, not
  // renderer JS) or an auto-backup path built from a user-configured folder,
  // always ending in .json. This IPC channel itself has no such constraint
  // though, so a compromised renderer (XSS, malicious dependency) could
  // otherwise write arbitrary bytes to any path it likes — restricting the
  // extension keeps the channel doing only what it's actually for.
  if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.json')) {
    return { success: false, error: 'Only .json files can be written through this channel.' };
  }
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
  // The only caller (BackupService.js's retention cleanup) only ever passes
  // back a path this same session got from list-backups, which already
  // filters to the Auto_Backup_*.json naming pattern — enforcing it here too
  // means this channel can only ever delete a backup file it created itself,
  // not an arbitrary path a compromised renderer might supply.
  if (typeof filePath !== 'string' || !/^Auto_Backup_.*\.json$/i.test(path.basename(filePath))) {
    return { success: false, error: 'This channel can only delete Auto_Backup_*.json files.' };
  }
  try { if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return { success: true }; } return { success: false, error: 'File not found' }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.on('ready-to-quit', () => { if (mainWindow) mainWindow.destroy(); });

// ─── List installed printers ─────────────────────────────────────────────
// Lets Settings show a real dropdown of this machine's printers (the OS
// print dialog already gets this for free, but the silent flow here never
// surfaces that dialog) so the store owner can pick one instead of always
// depending on the system default. mainWindow's own webContents is used
// only as a handle to query the OS printer list — it never prints anything.
ipcMain.handle('get-printers', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    return await mainWindow.webContents.getPrintersAsync();
  } catch (e) {
    console.error('[Print] get-printers failed:', e.message);
    return [];
  }
});

// ─── Silent thermal receipt printing ────────────────────────────────────────
// Renders the receipt HTML off-screen and sends it straight to the chosen
// printer (or the system default if none is set) — no PDF file, no preview
// window, no OS print dialog.
ipcMain.handle('print-receipt-silent', async (event, html, opts = {}) => {
  let hiddenWin;
  try {
    // A4/A5 are standard sheets — Chromium accepts these as plain strings.
    // Thermal rolls aren't a fixed sheet size, so those two keep the original
    // custom {width, height} approach: fixed roll width, height fitted to the
    // actual receipt content instead of a fixed sheet.
    // Note: unlike printToPDF (inches), webContents.print()'s custom pageSize
    // is in MICRONS — confirmed by Chromium's own validation error when this
    // was passed in inches ("height and width properties must be minimum
    // 352 microns").
    const paperSize = opts.paperSize || 'thermal-80';
    const isThermal = paperSize !== 'a4' && paperSize !== 'a5';

    // BUG FIX: this hidden window used to be created with no explicit width,
    // so it defaulted to Electron's ~800px window size. The receipt's print
    // CSS sizes everything in `vw` (relative to THAT viewport), so on an
    // 800px-wide hidden window the whole receipt rendered ~2.5x wider than
    // the actual 80mm (~302px) page ever was — table columns nearest the
    // right edge (RATE/AMOUNT) got physically clipped by the printer even
    // though the in-app preview (rendered in the full-width main window) and
    // print-receipt-network (which already sets this same width, below)
    // never showed the problem. Give the window the SAME width the physical
    // page will be so `vw` resolves against the right base before printing.
    let cssWidth;
    if (isThermal) {
      const widthMm = paperSize === 'thermal-58' ? 58 : (paperSize === 'thermal-104' ? 104 : 80);
      cssWidth = Math.round((widthMm / 25.4) * 96); // mm -> inches -> CSS px @ 96dpi
    }

    hiddenWin = new BrowserWindow({
      show: false,
      ...(cssWidth ? { width: cssWidth, height: 100 } : {}),
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    await hiddenWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    let pageSize;
    if (paperSize === 'a4') {
      pageSize = 'A4';
    } else if (paperSize === 'a5') {
      pageSize = 'A5';
    } else {
      const widthMm = paperSize === 'thermal-58' ? 58 : (paperSize === 'thermal-104' ? 104 : 80);
      const contentHeightPx = await hiddenWin.webContents.executeJavaScript('document.body.scrollHeight');
      const MICRONS_PER_INCH = 25400;
      const widthMicrons = widthMm * 1000;
      const heightInches = Math.max(contentHeightPx / 96, 2) + 0.1;
      const heightMicrons = Math.round(heightInches * MICRONS_PER_INCH);
      pageSize = { width: widthMicrons, height: heightMicrons };
    }

    const result = await new Promise((resolve) => {
      hiddenWin.webContents.print({
        silent: true,
        printBackground: true,
        pageSize,
        copies: Math.min(5, Math.max(1, parseInt(opts.copies, 10) || 1)),
        margins: { marginType: 'none' },
        // Omitting deviceName falls through to Electron's own system-default
        // behavior — only set it when a specific printer was actually chosen.
        ...(opts.printerName ? { deviceName: opts.printerName } : {}),
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

// ─── Network (IP) thermal printer — raw ESC-POS over TCP ────────────────
// For thermal printers reachable by IP that the store owner would rather
// not install as a Windows printer first (Settings > Printing > Connection
// Type: Network). Renders the receipt exactly like print-receipt-silent
// (same hidden window), but instead of handing it to the OS print spooler,
// captures it as a bitmap, converts that to a 1-bit monochrome ESC-POS
// raster image, and writes the raw bytes straight to the printer's IP over
// a plain TCP socket (port 9100 — the standard raw/JetDirect port almost
// every ESC-POS thermal printer listens on). This is the actual printer
// protocol, not a virtual/OS printer — no driver installation needed on
// this machine at all.
ipcMain.handle('print-receipt-network', async (event, html, opts = {}) => {
  let hiddenWin;
  try {
    const { ip, port } = opts;
    if (!ip) return { success: false, error: 'No printer IP address configured.' };
    const targetPort = parseInt(port, 10) || 9100;

    // 58mm/80mm/104mm rolls print at 384/576/832 dots wide on virtually
    // every ESC-POS thermal printer (203 DPI is the near-universal thermal
    // print head resolution, and dot counts are rounded to a byte multiple
    // — 8 dots — same as printer datasheets do) — render the hidden window
    // at the equivalent CSS pixel width (96 CSS px/inch) so what gets
    // captured is already close to the right proportions before the exact
    // resize below.
    const paperSize = opts.paperSize || 'thermal-80';
    const dotWidth = paperSize === 'thermal-58' ? 384 : (paperSize === 'thermal-104' ? 832 : 576);
    const cssWidth = Math.round((dotWidth / 203) * 96);

    hiddenWin = new BrowserWindow({ show: false, width: cssWidth, height: 100, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    await hiddenWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const contentHeightPx = await hiddenWin.webContents.executeJavaScript('document.body.scrollHeight');
    hiddenWin.setContentSize(cssWidth, Math.max(Math.ceil(contentHeightPx), 50));

    const captured = await hiddenWin.webContents.capturePage();
    const resized = captured.resize({ width: dotWidth });
    const { width, height } = resized.getSize();
    // BGRA on Windows (Electron NativeImage's native bitmap format) — the
    // exact channel order doesn't actually matter for the luminance
    // threshold below, since receipt content is plain black-on-white
    // (R≈G≈B for every real pixel); only presence/absence of a byte offset
    // for alpha (4 bytes/pixel either way) matters here.
    const bitmap = resized.toBitmap();

    const bytesPerRow = Math.ceil(width / 8);
    const imageData = Buffer.alloc(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const c0 = bitmap[idx], c1 = bitmap[idx + 1], c2 = bitmap[idx + 2], alpha = bitmap[idx + 3];
        // Treat fully-transparent pixels as white background — capturePage()
        // can include transparent padding the receipt's own white .receipt
        // background wouldn't otherwise have.
        const luminance = alpha === 0 ? 255 : (0.299 * c2 + 0.587 * c1 + 0.114 * c0);
        if (luminance < 128) {
          imageData[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x % 8));
        }
      }
    }

    hiddenWin.destroy();
    hiddenWin = null;

    // ESC @ (initialize) + GS v 0 (print raster bit image, standard mode)
    // + the packed 1-bit bitmap + feed/cut. This is the same raster-image
    // command virtually every ESC-POS-compatible thermal printer supports,
    // regardless of brand — printing an image instead of formatted text
    // means the printout matches the on-screen receipt exactly (logo,
    // barcode, fonts, layout) with no separate text-formatting path to
    // keep in sync with the HTML template.
    const escInit = Buffer.from([0x1B, 0x40]);
    const rasterHeader = Buffer.from([
      0x1D, 0x76, 0x30, 0x00,
      bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
      height & 0xFF, (height >> 8) & 0xFF
    ]);
    const feedAndCut = Buffer.from([0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x00]);
    const printBuffer = Buffer.concat([escInit, rasterHeader, imageData, feedAndCut]);

    const sendOnce = () => new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ success: false, error: `Timed out connecting to printer at ${ip}:${targetPort}` });
      }, 8000);
      socket.once('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message });
      });
      socket.connect(targetPort, ip, () => {
        socket.write(printBuffer, (err) => {
          clearTimeout(timer);
          if (err) { socket.destroy(); resolve({ success: false, error: err.message }); return; }
          socket.end();
          resolve({ success: true });
        });
      });
    });

    const copies = Math.min(5, Math.max(1, parseInt(opts.copies, 10) || 1));
    for (let c = 0; c < copies; c++) {
      const result = await sendOnce();
      if (!result.success) return result;
    }
    return { success: true };
  } catch (e) {
    if (hiddenWin && !hiddenWin.isDestroyed()) hiddenWin.destroy();
    console.error('[Print] print-receipt-network failed:', e.message);
    return { success: false, error: e.message };
  }
});

// ─── Weight Scale (RS-232/USB-Serial) Bridge ────────────────────────────
// Optional hardware integration for shops that weigh loose items (fruit,
// veg, bulk grains/dals) at the counter — Settings > Printing > Weight
// Scale. Runs in "continuous output" mode: once connected, the scale just
// keeps streaming lines of weight data on its own (no request/poll needed,
// matching how virtually every retail scale indicator ships configured),
// and every parsed reading is pushed to the renderer as a 'scale:weight'
// event so POS/Quick POS can show the live number.
ipcMain.handle('scale:list-ports', async () => {
  if (!SerialPort) return { error: scaleLoadError || 'Weight scale module not available on this machine.' };
  try {
    const ports = await SerialPort.list();
    return { ports: ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || '' })) };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('scale:connect', async (event, { path: portPath, baudRate } = {}) => {
  if (!SerialPort) return { success: false, error: scaleLoadError || 'Weight scale module not available on this machine.' };
  if (!portPath) return { success: false, error: 'No COM port selected.' };
  const win = windowForEvent(event);
  try {
    // Reconnecting (e.g. after changing the port in Settings) should
    // cleanly replace whatever was open before, not leak the old handle.
    if (scalePort && scalePort.isOpen) {
      await new Promise(resolve => scalePort.close(resolve));
    }

    scalePort = new SerialPort({ path: portPath, baudRate: parseInt(baudRate, 10) || 9600, autoOpen: false });
    const parser = scalePort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    parser.on('data', (line) => {
      const weight = parseScaleLine(line);
      if (weight !== null && win && !win.isDestroyed()) win.webContents.send('scale:weight', weight);
    });
    scalePort.on('error', (err) => {
      console.error('[WeightScale] port error:', err.message);
      if (win && !win.isDestroyed()) win.webContents.send('scale:error', err.message);
    });
    scalePort.on('close', () => {
      if (win && !win.isDestroyed()) win.webContents.send('scale:status', 'disconnected');
    });

    await new Promise((resolve, reject) => scalePort.open((err) => (err ? reject(err) : resolve())));
    return { success: true };
  } catch (e) {
    console.error('[WeightScale] connect failed:', e.message);
    scalePort = null;
    return { success: false, error: e.message };
  }
});

ipcMain.handle('scale:disconnect', async () => {
  try {
    if (scalePort && scalePort.isOpen) {
      await new Promise(resolve => scalePort.close(resolve));
    }
    scalePort = null;
    return { success: true };
  } catch (e) {
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

// Onboarding needs this to authenticate its one-time hub-reset/register calls
// to the local server — see HUB_ADMIN_TOKEN above.
ipcMain.handle('get-hub-token', () => HUB_ADMIN_TOKEN);

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
