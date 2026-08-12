// True-time drift detection.
//
// Every order/record timestamp in this app comes from the LOCAL machine's
// own clock (`Date.now()` / `new Date()`), so if that clock is wrong —
// manually changed (e.g. to test expiry-date logic, or by a cashier trying
// to backdate a sale / dodge an expired-product warning), unset, or just
// drifted — every timestamp it produces is wrong too, and nothing in the
// app would ever notice.
//
// This module cross-checks the local clock against a trusted OUTSIDE
// clock: the `Date` response header of the license server
// (zeinfotech-admin-panel, already contacted elsewhere in the app — see
// syncEngine.js — so this adds no new external dependency). Every HTTP
// response, even an error one, carries a `Date` header per the HTTP spec,
// so this works with a plain HEAD request against the server root.
//
// Fully fail-open / offline-safe: if the request fails (no internet, LAN-
// only shop, server down), the last known offset just keeps being used —
// this NEVER blocks order creation or forces an internet requirement on an
// otherwise fully-offline-capable app.

const LICENSE_SERVER_URL = 'https://zeinfotech-admin-panel.onrender.com';

const SUSPICIOUS_THRESHOLD_MS = 5 * 60 * 1000;   // >5 min drift is worth flagging
const OFFSET_STALE_MS = 2 * 60 * 60 * 1000;       // stop trusting a check older than 2h

let cachedOffsetMs = 0;   // trueServerTime - localTime, as of the last successful check
let lastCheckedAt = 0;    // local Date.now() when cachedOffsetMs was last refreshed
let hasEverSynced = false;

// Fire-and-forget: call on app boot and periodically (see syncEngine.js).
// Returns true if the offset was refreshed, false if the check failed
// (offline/unreachable) — callers generally don't need to do anything with
// the return value, it's mainly there for tests/debugging.
export async function refreshTrueTimeOffset() {
    try {
        const res = await fetch(LICENSE_SERVER_URL, {
            method: 'HEAD',
            signal: AbortSignal.timeout(8000)
        });
        const serverDateHeader = res.headers.get('date');
        if (!serverDateHeader) return false;
        const serverTime = new Date(serverDateHeader).getTime();
        if (!serverTime || Number.isNaN(serverTime)) return false;

        const localNow = Date.now();
        cachedOffsetMs = serverTime - localNow;
        lastCheckedAt = localNow;
        hasEverSynced = true;
        return true;
    } catch (e) {
        // Offline / unreachable — keep whatever offset (if any) we already
        // have. Same fail-open philosophy as syncEngine's checkRevocationStatus().
        return false;
    }
}

// Best current estimate of the real time, as a Date.now()-style epoch ms
// number — local clock corrected by the last known drift against the
// license server. Falls back to the plain local clock (no correction) if
// we've never successfully checked yet, or the last check is too old to
// still trust (the device may have been offline/asleep a long time, during
// which the local clock could have drifted further on its own).
export function getTrueNow() {
    if (!hasEverSynced || (Date.now() - lastCheckedAt) > OFFSET_STALE_MS) return Date.now();
    return Date.now() + cachedOffsetMs;
}

// How far off the local clock currently looks, in ms (positive = local
// clock is BEHIND the real time, negative = local clock is AHEAD/in the
// future). 0 if never successfully checked.
export function getClockDriftMs() {
    return hasEverSynced ? cachedOffsetMs : 0;
}

// True only when we have a recent, successful check AND the drift is bigger
// than normal clock skew — i.e. worth flagging as "this record's original
// timestamp may not be trustworthy", not just routine few-second drift.
export function isClockSuspicious() {
    if (!hasEverSynced || (Date.now() - lastCheckedAt) > OFFSET_STALE_MS) return false;
    return Math.abs(cachedOffsetMs) > SUSPICIOUS_THRESHOLD_MS;
}

export function getLastCheckedAt() {
    return lastCheckedAt;
}
