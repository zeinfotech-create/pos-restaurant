// Renderer-side wrapper around the Weight Scale (RS-232/USB-Serial) IPC
// bridge in electron/main.cjs. Outside Electron (plain browser/CI) every
// method below just no-ops or resolves with an error — there's no serial
// hardware to talk to there, and POS/Quick POS never assume this returns
// anything meaningful unless isElectron is true.
const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

let latestWeight = null;
let unsubscribeWeight = null;
let unsubscribeError = null;
let connectedPort = null;
const weightListeners = new Set();
const errorListeners = new Set();

function notifyWeight(kg) {
  latestWeight = kg;
  weightListeners.forEach(fn => fn(kg));
}

function notifyError(msg) {
  errorListeners.forEach(fn => fn(msg));
}

/** Lists this machine's available COM/serial ports for the Settings picker. */
export async function listScalePorts() {
  if (!isElectron || !window.electronAPI?.listScalePorts) return { ports: [], error: 'Weight scale bridge is only available in the desktop app.' };
  return window.electronAPI.listScalePorts();
}

/** Opens the given port and starts streaming weight readings. */
export async function connectScale(portPath, baudRate = 9600) {
  if (!isElectron || !window.electronAPI?.connectScale) return { success: false, error: 'Weight scale bridge is only available in the desktop app.' };

  // Wire the event listeners once per connect — a fresh connect() always
  // replaces whatever the main process had open, so it's fine to just
  // re-subscribe here rather than tracking connect state separately.
  if (!unsubscribeWeight) unsubscribeWeight = window.electronAPI.onScaleWeight(notifyWeight);
  if (!unsubscribeError) unsubscribeError = window.electronAPI.onScaleError(notifyError);

  const result = await window.electronAPI.connectScale({ path: portPath, baudRate });
  connectedPort = result.success ? portPath : null;
  return result;
}

export async function disconnectScale() {
  latestWeight = null;
  connectedPort = null;
  if (!isElectron || !window.electronAPI?.disconnectScale) return { success: true };
  return window.electronAPI.disconnectScale();
}

/** True once connectScale() has actually succeeded against a port — lets
 *  page init code avoid redundantly re-opening the same port on every
 *  navigation to POS/Quick POS. */
export function isConnected() {
  return connectedPort !== null;
}

/** The most recent weight reading (kg), or null if nothing's been read yet. */
export function getLatestWeight() {
  return latestWeight;
}

/** Subscribe to every new weight reading as it streams in. Returns an unsubscribe function. */
export function onWeight(callback) {
  weightListeners.add(callback);
  return () => weightListeners.delete(callback);
}

/** Subscribe to scale/port errors (e.g. cable unplugged mid-sale). Returns an unsubscribe function. */
export function onError(callback) {
  errorListeners.add(callback);
  return () => errorListeners.delete(callback);
}

export function isScaleSupported() {
  return isElectron;
}

/** Testing helper (Settings > Weight Scale > Testing Tools) — pushes a
 *  fake reading through the exact same pub-sub path a real scale's data
 *  takes, so the whole "kg product -> POS click -> weight captured" flow
 *  can be verified with zero physical hardware attached. Marks the scale
 *  as "connected" too, so isConnected()-gated UI (the POS ⚖️ badge, etc.)
 *  behaves identically to the real thing while testing. */
export function simulateWeight(kg) {
  connectedPort = connectedPort || 'SIMULATED';
  notifyWeight(kg);
}
