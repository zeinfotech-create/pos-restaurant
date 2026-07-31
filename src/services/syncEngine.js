import { db, getSettings, getDeviceId, updateData, deleteData, getDataById, updateSettings, getOrders, saveOrder, updateOrder, clearStore, read, KEYS, getCachedLicenseStatus, saveCachedLicenseStatus, getDeletedTombstones, clearExpiredTombstones, verifyLocalUser } from '../db.js';
import { showSuspendedOverlay } from './LicenseService.js';

// TODO: replace with the real, permanent public URL of your vendor-only
// license-signing server (see D:\zeinfotech-admin-panel, a project deliberately
// kept separate from this one — it holds the RSA private key that signs
// Lifetime activation tokens, which must never ship inside this app). Until
// you have a real domain/host for it, this only works when that server is
// also running locally on the SAME machine as pos-lite (e.g. your own testing).
const LICENSE_SERVER_URL = 'http://127.0.0.1:4000';

class SyncEngine {
    constructor() {
        this.ws = null;
        this.hubUrl = null;
        this.retryTimeout = 5000;
        this.isConnected = false;
        this.isSilent = false; // Flag to prevent broadcast loops
        this.isRegistered = false; // Tracking Hub registration
        this.adbStatus = 'disconnected';
        this.health = 'offline';
        this.retryCount = 0;
        this.maxRetriesBeforeOffline = 5;
        this.pendingRequests = new Map(); // Map<requestId, {resolve, reject}>
        this.isNewInstall = false; // NEW: Flag for gated license creation
        this.broadcastQueue = []; // NEW: Buffer for messages during registration
        this.pendingSilentBroadcasts = []; // Local edits that arrived while isSilent was true — flushed once it clears
        // Standalone/Electron: true only once a device-locked Lifetime key is
        // verified (see checkLifetimeActivation()/activateLifetimeKey() below).
        // Starts false so a fresh/un-activated install is locked until a real
        // key is entered — checked again (from the persisted token, fully
        // offline) on every init() so this doesn't reset on refresh.
        this.isLifetimeActivated = false;
        this.licenseStatus = {
            type: 'unactivated',
            isExpired: true,
            daysLeft: 0,
            branchLimit: 0,
            userLimit: 0,
            registerLimit: 0,
            productLimit: 0,
            modules: {
                inventory: 'none', reports: 'none',
                register_shift: false, cloud_sync: false,
                data_backup: false,
                pro_addons: false, industry_setup: false
            }
        };

        // This build only supports the local/Electron install — always standalone.
        this.deploymentMode = 'standalone';

        // Load cached license status to avoid "Trial/Free" flash on refresh.
        // Guarded by _licenseResolvedByInit: this read races init()'s own
        // (slower, IPC-involving) license computation, and without the guard
        // a late-resolving stale cache read can silently clobber the fresh
        // status init() already computed and saved, permanently downgrading
        // limits (e.g. registerLimit stuck at an old value of 1) until the
        // cache itself is rewritten by some other event.
        this._licenseResolvedByInit = false;
        getCachedLicenseStatus().then(cached => {
            if (cached && !this._licenseResolvedByInit) {
                this.licenseStatus = cached;
            }
        });

        this.blockReconnect = false;
        window.syncEngine = this; // Expose globally
        window.db = db;
        window.getSettings = getSettings;
        window.verifyLocalUser = verifyLocalUser;
        window.KEYS = KEYS;
    }

    getLimits() {
        const s = this.licenseStatus || {};
        return {
            maxBranches: s.branchLimit || 1,
            maxRegistersPerBranch: s.registerLimit || 1, // Hub usually sends total limit, but we'll use it as max for selection
            maxUsers: s.userLimit || 5,
            maxProducts: s.productLimit || 100
        };
    }

    checkCapability(feature) {
        // Standalone/Offline mode is Lifetime Premium ONLY once a device-locked key is verified
        if (this.deploymentMode === 'standalone' && this.isLifetimeActivated) return true;

        const s = this.licenseStatus || {};
        
        // Premium and Pro licenses unlock everything professional
        if (s.type === 'premium' || s.type === 'pro') return true;

        if (!s.modules) return false;
        const modules = s.modules;

        // Handle nested modules or direct booleans
        if (typeof modules[feature] === 'boolean') return modules[feature];
        if (modules[feature] === 'advanced' || modules[feature] === 'full') return true;

        return false;
    }

    // ── Lifetime Offline License ────────────────────────────────────────────
    async checkLifetimeActivation() {
        if (!window.electronAPI?.verifyLifetimeToken) { this.isLifetimeActivated = false; return; }
        const settings = await getSettings();
        if (!settings?.lifetimeToken) { this.isLifetimeActivated = false; return; }
        try {
            const result = await window.electronAPI.verifyLifetimeToken(settings.lifetimeToken);
            // The token's signature+fingerprint alone aren't enough — it must also be
            // bound to THIS install's licenseKey. Otherwise a token cached from an
            // earlier activation on this same machine (a different local install,
            // reinstall, or test license) would silently unlock a brand new install
            // that never actually verified a key of its own.
            const licenseKey = settings.licenseKey || 'LOCAL_EXE';
            this.isLifetimeActivated = !!result?.valid && result.payload?.licenseKey === licenseKey;
        } catch (e) {
            this.isLifetimeActivated = false;
        }
    }

    async activateLifetimeKey(key, contact = '') {
        if (!window.electronAPI?.getMachineFingerprint) {
            return { success: false, message: 'Lifetime activation is only available in the desktop app.' };
        }
        const deviceFingerprint = await window.electronAPI.getMachineFingerprint();
        if (!deviceFingerprint) return { success: false, message: 'Could not read this device\'s fingerprint.' };

        const settings = await getSettings();
        const licenseKey = settings.licenseKey || 'LOCAL_EXE';

        // The customer enters one field (phone or email) — send it as both, the
        // server only matches whichever the key was actually issued against.
        const trimmedContact = (contact || '').trim();
        const phone = trimmedContact;
        const email = trimmedContact;

        try {
            const res = await fetch(`${LICENSE_SERVER_URL}/api/license/activate-lifetime`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey, key, deviceFingerprint, phone, email })
            });
            const data = await res.json();
            if (!data.success) return { success: false, message: data.error || 'Activation failed' };

            await updateSettings({ lifetimeToken: data.token, licenseKey });
            await window.electronAPI.markLifetimeActivated();
            this.isLifetimeActivated = true;

            // Re-run init so licenseStatus/UI reflect the new lifetime state immediately
            await this.init();
            return { success: true };
        } catch (e) {
            return { success: false, message: 'Could not reach the license server: ' + e.message };
        }
    }

    async init() {
        // Safe re-init: cleanup existing state
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            try { this.ws.close(); } catch (e) { }
            this.ws = null;
        }
        this.isConnected = false;
        this.isRegistered = false;
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
            this.autoSyncInterval = null;
        }
        if (this.reminderInterval) {
            clearInterval(this.reminderInterval);
            this.reminderInterval = null;
        }

        const settings = await getSettings();
        // deploymentMode is already set in constructor for immediate UI responsiveness
        localStorage.setItem('zepos_deployment_mode', this.deploymentMode);
        // Self-heal: if a prior sync ever clobbered the persisted settings record
        // with a synced-from-server value (before the pos_full_state/handleIncomingUpdate
        // guards existed), correct it now so every direct getSettings().deploymentMode
        // read (e.g. in Settings.js) also sees the right device-local value.
        if (settings.deploymentMode !== this.deploymentMode) {
            await updateSettings({ deploymentMode: this.deploymentMode });
        }

        if (this.deploymentMode === 'standalone') {
            console.log('SyncEngine: Running in STANDALONE mode. Local hub enabled.');

            await this.checkLifetimeActivation();

            if (this.isLifetimeActivated) {
                this.licenseStatus = {
                    type: 'premium',
                    isExpired: false,
                    daysLeft: 9999,
                    branchLimit: 99,
                    userLimit: 99,
                    registerLimit: 99,
                    productLimit: 99999,
                    modules: {
                        inventory: 'full', reports: 'full',
                        register_shift: true, cloud_sync: true,
                        data_backup: true,
                        pro_addons: true, industry_setup: true
                    }
                };
            } else {
                // Not yet activated — no trial grace period for the desktop
                // build. The router hard-blocks every page except login/
                // onboarding/activation until a real key is verified; this
                // status just keeps any capability check reached some other
                // way consistently locked too.
                this.licenseStatus = {
                    type: 'unactivated',
                    isExpired: true,
                    daysLeft: 0,
                    branchLimit: 0,
                    userLimit: 0,
                    registerLimit: 0,
                    productLimit: 0,
                    modules: {
                        inventory: 'none', reports: 'none',
                        register_shift: false, cloud_sync: false,
                        data_backup: false,
                        pro_addons: false, industry_setup: false
                    }
                };
            }
            this._licenseResolvedByInit = true;
            saveCachedLicenseStatus(this.licenseStatus);
            this.updateHealth('online');
            
            if (!this.hasStorageListener) {
                this.setupStorageListener();
                this.hasStorageListener = true;
            }
            
            // In Standalone/Electron, we still need the server for Notifications
            // Use Port 3030 for local EXE server to avoid conflicts with Port 3030 (Cloud Hub)
            let hubIp = settings.syncHubIp || '127.0.0.1';
            if (hubIp === 'localhost') hubIp = '127.0.0.1';
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.licenseKey = settings.licenseKey || 'LOCAL_EXE';
            this.hubUrl = `${wsProtocol}//${hubIp}:3030?licenseKey=${this.licenseKey}`;
            
            this.connect();
            return;
        }
    }

    setupStorageListener() {
        window.addEventListener('storage-change', async (e) => {
            const { type, store, data } = e.detail;
            
            // CRITICAL: If licenseKey or syncHubIp changes, reconnect to the correct tenant/hub
            if (store === 'settings') {
                let shouldReconnect = false;
                
                if (data.licenseKey && this.licenseKey && data.licenseKey !== this.licenseKey) {
                    console.log(`[SyncEngine] 🔑 License changed from ${this.licenseKey} to ${data.licenseKey}. Wiping local tenant data before resync.`);
                    // This device previously held another business's data locally (products, orders, etc.
                    // all use per-record IDs that don't collide across tenants, so old + new would otherwise
                    // coexist forever). Clear everything tenant-scoped before pulling the new license's data.
                    const tenantStores = [
                        'products', 'orders', 'returns',
                        'customers', 'suppliers', 'purchases', 'branches', 'users', 'staff',
                        'registers', 'shifts', 'appointments', 'staff_incentives',
                        'daily_stats', 'inventory_logs',
                        'categories', 'sub_categories', 'credit_history', 'loyalty_history',
                        'login_activity', 'import_tracker', 'import_history',
                        'backup_history', 'license_status'
                    ];
                    for (const store of tenantStores) {
                        await clearStore(store);
                    }
                    // These live as sub-records inside the SESSION store (not their own named
                    // store), so the loop above can't reach them — clear explicitly, or the old
                    // tenant's in-progress cart/bulk-selection follows you into the new one.
                    await db.delete(KEYS.SESSION, 'pos_cart');
                    try { localStorage.removeItem('pos_selected_products'); } catch (e) {}

                    this.licenseKey = data.licenseKey;
                    shouldReconnect = true;
                }

                if (data.syncHubIp && data.syncHubIp !== this.syncHubIp) {
                    console.log(`[SyncEngine] 🌐 Hub IP changed to ${data.syncHubIp}.`);
                    this.syncHubIp = data.syncHubIp;
                    shouldReconnect = true;
                }

                if (shouldReconnect) {
                    console.log(`[SyncEngine] Rebuilding connection...`);
                    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                    const hubIp = this.syncHubIp || window.location.hostname || '127.0.0.1';
                    const finalIp = hubIp === 'localhost' ? '127.0.0.1' : hubIp;
                    
                    this.hubUrl = `${wsProtocol}//${finalIp}:3030?licenseKey=${this.licenseKey}`;
                    this.connect(); 
                }
            }

            this.broadcast(type, store, data);
        });
    }

    async updateHealth(newHealth) {
        if (this.health !== newHealth) {
            console.log(`SyncEngine: Health changed [${this.health}] -> [${newHealth}]`);
            this.health = newHealth;
            window.dispatchEvent(new CustomEvent('sync-health-changed', { detail: { health: this.health } }));
            
            // If we are offline, show a hint if we have a custom IP that might be wrong
            if (newHealth === 'offline' && this.hubUrl && !this.hubUrl.includes('localhost') && !this.hubUrl.includes('127.0.0.1')) {
               const settings = await getSettings();
               if (settings.syncHubIp) {
                  console.warn('SyncEngine: Connection failing to custom IP. You might need to update the Hub IP in Settings.');
               }
            }
        }
    }

    async verifyLicense(licenseKey) {
        if (!this.isConnected) return { success: false, message: 'Offline' };

        return new Promise((resolve) => {
            const requestId = 'vl-' + Date.now();
            this.pendingRequests.set(requestId, { resolve });
            this.ws.send(JSON.stringify({ type: 'verify_license', licenseKey, requestId }));

            // Timeout after 10s
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    resolve({ success: false, message: 'Request Timeout' });
                }
            }, 10000);
        });
    }

    async fetchLoginData() {
        if (!this.isConnected) return { success: false, message: 'Offline' };

        return new Promise((resolve) => {
            const requestId = 'ld-' + Date.now();
            this.pendingRequests.set(requestId, { resolve });
            this.ws.send(JSON.stringify({ type: 'pos_get_login_data', requestId }));
        });
    }

    async verifyCredentials(username, password) {
        // If standalone, verify locally first (no network attempt needed for the common case)
        const settings = await getSettings();
        // isElectron is derived fresh from the user-agent every time — it can never
        // go stale the way a synced settings field can (see the deploymentMode
        // guards added to pos_full_state/handleIncomingUpdate). Trust it as the
        // final word on "is this a local desktop install", not just the cached flag.
        const isElectron = /Electron/i.test(navigator.userAgent);
        if (isElectron || settings.deploymentMode === 'standalone') {
            console.log('SyncEngine: Standalone mode detected. Verifying credentials locally...');
            const { verifyLocalUser, updateData } = await import('../db.js');
            // NOTE: login activity is deliberately NOT recorded here — at this point the
            // user has only entered a password, not picked a branch/register yet, so
            // there's nothing meaningful to put in the Register column. Login.js's
            // finalizeLogin() calls notifyLoginActivity() once branch+register are known.
            const localResult = await verifyLocalUser(username, password);
            if (localResult.success && localResult.branches?.length > 0) {
                return localResult;
            }

            // Either no local match (profile reset/reinstalled while the local
            // Mongo hub's data survived), or the local user exists but its
            // branch/register records are missing/incomplete in IndexedDB —
            // ask the hub, which is the durable record, and self-heal IndexedDB
            // from its answer so this doesn't need to happen again next login.
            console.log(`SyncEngine: ${localResult.success ? 'Local user found but no branches locally' : 'No local match'}. Falling back to local hub...`);
            const hubResult = await this.verifyCredentialsHTTP(username, password);
            if (hubResult.success) {
                for (const b of hubResult.branches || []) await updateData('branches', b, true);
                for (const r of hubResult.registers || []) await updateData('registers', r, true);
                return hubResult;
            }

            // Hub unreachable/failed — still honor a valid local login rather
            // than blocking the user over a network hiccup, even with no branches.
            return localResult.success ? localResult : hubResult;
        }

        // If disconnected, try to connect first but don't block
        if (!this.isConnected) {
            console.warn('SyncEngine: Attempting on-demand connection for verification');
            this.connect();
        }

        return new Promise(async (resolve) => {
            // Priority 1: If we have a WebSocket, use it
            if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
                const requestId = 'vc-' + Date.now();
                this.pendingRequests.set(requestId, { resolve });
                const systemDetails = await this.getSystemDetails();
                this.ws.send(JSON.stringify({ type: 'pos_verify_credentials', username, password, requestId, systemDetails }));
                
                setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.pendingRequests.delete(requestId);
                        this.verifyCredentialsHTTP(username, password).then(resolve);
                    }
                }, 5000);
            } else {
                // Priority 2: Fallback to HTTP for better reliability on erratic Wi-Fi
                this.verifyCredentialsHTTP(username, password).then(resolve);
            }
        });
    }

    async verifyCredentialsHTTP(username, password) {
        try {
            const settings = await getSettings();
            let hubIp = settings.syncHubIp || '127.0.0.1';
            const response = await fetch(`http://${hubIp}:3030/api/pos-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            return data;
        } catch (err) {
            console.error('SyncEngine: HTTP Login Fallback failed:', err);
            return { success: false, message: 'Sync Hub Unreachable' };
        }
    }

    // Fire-and-forget: tells the (local, for standalone) hub a login just succeeded, so the
    // Login Activity report has something to show. Standalone logins verify locally and skip
    // pos_verify_credentials entirely, which is the only other place this gets recorded —
    // without this call, Login Activity would silently stay empty for every standalone install.
    async notifyLoginActivity(user) {
        try {
            if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) return;
            const systemDetails = await this.getSystemDetails();
            this.ws.send(JSON.stringify({
                type: 'pos_log_login_activity',
                userId: user.id || user.userId,
                userName: user.name,
                role: user.role,
                systemDetails
            }));
        } catch (err) {
            console.warn('SyncEngine: Failed to notify login activity (non-fatal):', err.message);
        }
    }

    async getLoginActivities(limit = 100) {
        if (!this.isConnected) return { success: false, message: 'Offline' };

        return new Promise((resolve) => {
            const requestId = 'la-' + Date.now();
            this.pendingRequests.set(requestId, { resolve });
            this.ws.send(JSON.stringify({ type: 'pos_get_login_activities', requestId, limit }));

            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    resolve({ success: false, message: 'Activities Fetch Timeout' });
                }
            }, 8000);
        });
    }

    async getSystemDetails() {
        const ua = navigator.userAgent;
        let browser = "Unknown";
        if (ua.indexOf("Firefox") > -1) browser = "Firefox";
        else if (ua.indexOf("Chrome") > -1) browser = "Chrome";
        else if (ua.indexOf("Safari") > -1) browser = "Safari";
        else if (ua.indexOf("Edge") > -1) browser = "Edge";

        let os = "Unknown";
        if (ua.indexOf("Windows") > -1) os = "Windows";
        else if (ua.indexOf("Mac") > -1) os = "MacOS";
        else if (ua.indexOf("Android") > -1) os = "Android";
        else if (ua.indexOf("iPhone") > -1 || ua.indexOf("iPad") > -1) os = "iOS";
        else if (ua.indexOf("Linux") > -1) os = "Linux";

        let deviceType = "Desktop";
        if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
            deviceType = "Mobile/Tablet";
        }

        const sess = await db.get(KEYS.SESSION, 'current');
        const registerId = sess?.data?.registerId || null;

        // Resolve the actual register/counter name by id — this used to fall back to the
        // BRANCH name, which is a different thing and made every login look like it came
        // from "Unknown" register once a real registerId was actually present.
        let registerName = 'Global Terminal';
        if (registerId) {
            try {
                const { getRegisters } = await import('../db.js');
                const registers = await getRegisters();
                registerName = registers.find(r => r.id === registerId)?.name || registerName;
            } catch (e) { /* non-fatal — keep the fallback name */ }
        }

        return {
            userAgent: ua,
            browser,
            os,
            deviceType,
            platform: navigator.platform,
            screen: `${window.screen.width}x${window.screen.height}`,
            registerId: registerId,
            registerName
        };
    }


    async checkAvailability(username, email) {
        if (!this.isConnected) return { success: false, message: 'Offline' };

        return new Promise((resolve) => {
            const requestId = 'ca-' + Date.now();
            this.pendingRequests.set(requestId, { resolve });
            this.ws.send(JSON.stringify({ type: 'pos_check_availability', username, email, requestId }));

            // Timeout after 8s
            setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    this.pendingRequests.delete(requestId);
                    resolve({ success: false, message: 'Check Timeout' });
                }
            }, 8000);
        });
    }

    disconnect() {
        this.blockReconnect = true;
        this.isConnected = false;
        this.isRegistered = false;
        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            try { this.ws.close(); } catch (e) { }
            this.ws = null;
        }
        window.dispatchEvent(new CustomEvent('sync-status-changed', { detail: { isConnected: false } }));
        console.log('SyncEngine: Disconnected (manual).');
    }

    connect() {
        if (!this.hubUrl) return;

        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onmessage = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            try { this.ws.close(); } catch (e) { }
            this.ws = null;
        }

        this.blockReconnect = false;
        console.log(`SyncEngine: Attempting connection to ${this.hubUrl} `);
        
        try {
            this.ws = new WebSocket(this.hubUrl);
        } catch (e) {
            console.error('SyncEngine: Failed to create WebSocket:', e);
            this.handleConnectionFailure();
            return;
        }

        this.ws.onopen = async () => {
            console.log('SyncEngine: WebSocket connected to Hub!');
            this.isConnected = true;
            this.updateHealth('online');
            this.retryCount = 0;
            
            // If we successfully connected via fallback, update the settings so we don't fail next time
            if (this.isTryingFallback) {
                const currentHubIp = this.hubUrl.split('/')[2].split(':')[0];
                console.log(`SyncEngine: Fallback succeeded! Auto-updating Sync Hub IP to: ${currentHubIp}`);
                getSettings().then(s => {
                    s.syncHubIp = currentHubIp;
                    updateSettings(s);
                    this.isTryingFallback = false;
                });
            }

            window.dispatchEvent(new CustomEvent('sync-status-changed', { detail: { isConnected: true } }));

            this.reRegister();
            this.requestAdbStatus();
        };

        this.ws.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    case 'adb_status':
                        this.adbStatus = message.status;
                        window.dispatchEvent(new CustomEvent('sync-message', { detail: message }));
                        break;

                    case 'sync_ack':
                        // Server confirmed our update — mark the local record as synced
                        if (message.store && message.id) {
                            try {
                                const local = await getDataById(message.store, message.id);
                                if (local) {
                                    await updateData(message.store, { ...local, isSynced: true }, true);
                                    console.log(`[SyncEngine] ✅ ACK: ${message.store}/${message.id} marked as synced`);
                                }
                            } catch(e) {
                                console.warn('[SyncEngine] sync_ack update failed:', e);
                            }
                        }
                        break;

                    case 'force_disconnect':
                        console.warn('SyncEngine: Received force_disconnect from Hub:', message.message);
                        showSuspendedOverlay(message.message);
                        this.disconnect();
                        break;

                    case 'server_status':
                        this.isDbConnected = message.dbConnected;
                        break;

                    case 'upgrade_license_result':
                        console.log('SyncEngine: upgrade_license_result received:', message.success);
                        if (message.success && message.licenseStatus) {
                            this.licenseStatus = { ...this.licenseStatus, ...message.licenseStatus };
                            saveCachedLicenseStatus(this.licenseStatus);
                            getSettings().then(s => {
                                updateSettings({ ...s, subscriptionRequest: { ...(s.subscriptionRequest || {}), status: 'approved' } });
                            });
                            window.dispatchEvent(new CustomEvent('license-status-changed', { detail: this.licenseStatus }));
                        }
                        window.dispatchEvent(new CustomEvent('sync-message', { detail: message }));
                        break;

                    case 'update':
                    case 'delete':
                        await this.handleIncomingUpdate(message);
                        break;

                    case 'error':
                        if (message.code === 'LIMIT_REACHED') {
                            console.warn(`SyncEngine: Limit Reached for store '${message.store}'!`);
                            if (message.id && message.store) {
                                deleteData(message.store, message.id, true);
                                if (window.navigate) {
                                    window.navigate(window.location.hash.slice(1) || 'dashboard');
                                }
                            }
                            window.dispatchEvent(new CustomEvent('sync-limit-reached', { detail: message }));
                        } else {
                            console.error('SyncEngine Error:', message.message || message);
                        }
                        break;

                    case 'register_failure':
                        console.error('SyncEngine: Registration failed:', message.message);
                        if (message.message && message.message.includes('SUSPENDED')) {
                            showSuspendedOverlay(message.message);
                        }
                        break;

                    case 'register_success':
                        console.log('SyncEngine: Registration confirmed by Hub');
                        this.isRegistered = true;
                        if (message.licenseKey && message.type === 'register_success') {
                            await getSettings().then(current => {
                                // Only ever ADOPT a hub-assigned key on a device that has
                                // none yet. message.licenseKey is just the server's echo of
                                // whatever we sent (or its own 'GLOBAL' fallback if we sent
                                // nothing, e.g. on a startup race before settings loaded) —
                                // it is not authoritative. Overwriting an already-set key
                                // here previously let a single bad reconnect permanently
                                // downgrade an activated device's real license key to
                                // 'GLOBAL', silently detaching it from its License record.
                                if (!current.licenseKey) {
                                    updateSettings({ licenseKey: message.licenseKey, networkId: message.licenseKey });
                                }
                            });
                        }
                        // Standalone has no license concept — the hub's own idea of this
                        // key's status is irrelevant here and must never overwrite the
                        // fixed local status computed in init(). This mirrors the earlier
                        // bug where a hub-echoed status silently downgraded a fully-working
                        // install's limits back to server-side defaults on every reconnect.
                        if (message.licenseStatus && this.deploymentMode !== 'standalone') {
                            const statusChanged = JSON.stringify(this.licenseStatus) !== JSON.stringify(message.licenseStatus);
                            this.licenseStatus = message.licenseStatus;
                            saveCachedLicenseStatus(this.licenseStatus);
                            if (statusChanged) {
                                window.dispatchEvent(new CustomEvent('license-status-changed', { detail: this.licenseStatus }));
                            }
                        }
                        this.isConnected = true;
                        setTimeout(() => {
                            this.syncAllLocalData();
                        }, 2000);
                        window.dispatchEvent(new CustomEvent('sync-registered'));
                        if (this.broadcastQueue.length > 0) {
                            const latestSettings = await getSettings();
                            this.broadcastQueue.forEach(payload => {
                                payload.licenseKey = latestSettings.licenseKey || payload.licenseKey;
                                payload.branchId = payload.branchId || latestSettings.branchId;
                                this.ws.send(JSON.stringify(payload));
                            });
                            this.broadcastQueue = [];
                        }
                        getSettings().then(s => {
                            this.ws.send(JSON.stringify({ type: 'pos_fetch_all', branchId: s.branchId || null }));
                        });
                        break;

                    case 'pos_setup_result':
                        // Response to initSetup/verifyOtp/setupBranch/setupAdmin — see _setupRequest()
                        window.dispatchEvent(new CustomEvent('sync-setup-result', { detail: message }));
                        break;

                    case 'verify_license_result':
                        for (const [rid, req] of this.pendingRequests) {
                            if (rid.startsWith('vl-')) { req.resolve(message); this.pendingRequests.delete(rid); }
                        }
                        break;

                    case 'pos_login_data':
                        if (message.success) {
                            if (message.users) { clearStore('users'); message.users.forEach(u => updateData('users', u, true)); }
                            if (message.branches) { clearStore('branches'); message.branches.forEach(b => updateData('branches', b, true)); }
                            if (message.registers) { clearStore('registers'); message.registers.forEach(r => updateData('registers', r, true)); }
                        }
                        for (const [rid, req] of this.pendingRequests) {
                            if (rid.startsWith('ld-')) { req.resolve(message); this.pendingRequests.delete(rid); }
                        }
                        break;

                    case 'pos_full_state':
                        if (message.results) {
                            const currentSettings = await getSettings();

                            // Load tombstones ONCE for this batch — skip any record the user deleted locally
                            const tombstones = await getDeletedTombstones();

                            for (const [store, records] of Object.entries(message.results)) {
                                for (const data of records) {
                                    // ── TOMBSTONE CHECK: Never resurrect locally-deleted records ──
                                    const tombstoneKey = `${store}:${data.id}`;
                                    if (tombstones.has(tombstoneKey)) {
                                        console.log(`[SyncEngine] 🚭 Skipping server record (tombstoned): ${tombstoneKey}`);
                                        continue;
                                    }

                                    const mergedData = { ...data, isSynced: true };
                                    
                                    // Subscription Unification: If server sends subscriptionRequest, 
                                    // ensure it lands in the record the UI expects (global_settings)
                                    if (store === 'settings' && data.subscriptionRequest) {
                                        const globalS = await read(KEYS.SETTINGS).then(all => (all || []).find(x => x.id === 'global_settings') || { id: 'global_settings' });
                                        globalS.subscriptionRequest = data.subscriptionRequest;
                                        await updateData('settings', globalS, true);
                                    }

                                    if (store === 'settings' && (data.id === 'global_settings' || data.branchId === currentSettings.branchId)) {
                                        if (currentSettings.licenseKey) {
                                            mergedData.licenseKey = currentSettings.licenseKey;
                                            mergedData.networkId = currentSettings.licenseKey;
                                        }
                                        if (currentSettings.syncHubIp) {
                                            mergedData.syncHubIp = currentSettings.syncHubIp;
                                        }
                                        // deploymentMode is per-DEVICE (this machine is Electron/standalone
                                        // or a browser/cloud tab), never per-license — the synced copy from
                                        // Mongo must never overwrite it, or Electron logins silently switch
                                        // to the cloud verify path and lose their local branch/register data.
                                        if (currentSettings.deploymentMode) {
                                            mergedData.deploymentMode = currentSettings.deploymentMode;
                                        }
                                    }
                                    if (store === 'settings') {
                                        // Check if we have a pending local version that hasn't been confirmed by server yet
                                        const localRecord = await getDataById('settings', data.id);
                                        if (localRecord && localRecord.isSynced === false) {
                                            // Local has pending changes — preserve local financial fields
                                            const protectedData = {
                                                ...mergedData,
                                                availableTaxes: localRecord.availableTaxes ?? data.availableTaxes,
                                                paymentMethods: localRecord.paymentMethods ?? data.paymentMethods,
                                                isSynced: false // keep pending until server confirms
                                            };
                                            await updateData(store, protectedData, true);
                                            console.log(`[SyncEngine] ⚠️ Settings ${data.id}: kept local pending taxes/payments during full-state apply`);
                                        } else {
                                            await updateData(store, mergedData, true);
                                        }
                                    } else {
                                        await updateData(store, mergedData, true);
                                    }
                                }
                            }

                            // Clean up expired tombstones (older than 24h) so IDB doesn't grow forever
                            clearExpiredTombstones().catch(e => console.warn('[SyncEngine] Tombstone cleanup failed:', e));

                            window.dispatchEvent(new CustomEvent('sync-full-state-applied'));
                        }
                        break;

                    case 'upi_payment_received':
                        window.dispatchEvent(new CustomEvent('sync-broadcast', { detail: message }));
                        break;

                    default:
                        // Generic Request Resolver: Automatically resolve any pending requestId-based promises
                        if (message.requestId && this.pendingRequests.has(message.requestId)) {
                            this.pendingRequests.get(message.requestId).resolve(message);
                            this.pendingRequests.delete(message.requestId);
                            console.log(`SyncEngine: Generic Resolve for ${message.type} (ID: ${message.requestId})`);
                        }
                        window.dispatchEvent(new CustomEvent('sync-message', { detail: message }));
                        break;
                }
            } catch (e) {
                console.error('SyncEngine: Error handling message', e);
            }
        };

        this.ws.onclose = () => {
            this.isConnected = false;
            this.isRegistered = false;
            this.ws = null;
            window.dispatchEvent(new CustomEvent('sync-status-changed', { detail: { isConnected: false } }));
            if (!this.blockReconnect) {
                setTimeout(() => this.connect(), this.retryTimeout);
            }
        };

        this.ws.onerror = (err) => {
            this.handleConnectionFailure();
        };
    }

    handleConnectionFailure() {
        if (this.ws) { try { this.ws.close(); } catch (e) { } this.ws = null; }
        getSettings().then(settings => {
            const currentHostname = window.location.hostname || '127.0.0.1';
            if (settings.syncHubIp && settings.syncHubIp !== currentHostname && !this.isTryingFallback) {
                this.isTryingFallback = true;
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                this.hubUrl = `${wsProtocol}//${currentHostname}:3030?licenseKey=${this.licenseKey}`;
                setTimeout(() => this.connect(), 1000);
                return;
            }
            this.isConnected = false;
            if (!this.blockReconnect) {
                setTimeout(() => this.connect(), this.retryTimeout);
            }
        });
    }

    async handleIncomingUpdate(message) {
        const { type, store, data } = message;
        this.isSilent = true;
        try {
            if (type === 'update') {
                const local = await getDataById(store, data.id);
                // Genuine last-write-wins on the record's OWN updatedAt, not
                // the message envelope's timestamp (which is ~"now" at
                // receipt time, not when the data was actually changed) —
                // the previous version treated any already-synced local
                // record as automatically safe to overwrite regardless of
                // which side was actually newer, so a replayed/delayed
                // update carrying stale data could silently stomp a newer
                // local edit. Only fall back to the isSynced heuristic when
                // there's no reliable timestamp to compare on both sides.
                let isSafeToOverwrite;
                if (!local) {
                    isSafeToOverwrite = true;
                } else if (data.updatedAt && local.updatedAt) {
                    isSafeToOverwrite = new Date(data.updatedAt) >= new Date(local.updatedAt);
                } else {
                    isSafeToOverwrite = local.isSynced !== false;
                }
                if (isSafeToOverwrite) {
                    const mergedData = { ...data, isSynced: true };
                    // deploymentMode is per-device, never synced from the server copy (see the
                    // same guard in the pos_full_state handler above for why).
                    if (store === 'settings' && local?.deploymentMode) {
                        mergedData.deploymentMode = local.deploymentMode;
                    }
                    await updateData(store, mergedData, true);
                    window.dispatchEvent(new CustomEvent('data-synced', { detail: { store, id: data.id } }));
                }
            } else if (type === 'delete') {
                await deleteData(store, data.id, true);
                window.dispatchEvent(new CustomEvent('data-synced', { detail: { store, id: data.id } }));
            }
        } catch (e) {
            console.error(`SyncEngine: Failed to apply sync for ${store}`, e);
        } finally {
            this.isSilent = false;
            if (this.pendingSilentBroadcasts.length > 0) {
                const pending = this.pendingSilentBroadcasts;
                this.pendingSilentBroadcasts = [];
                pending.forEach(p => this.broadcast(p.type, p.store, p.data));
            }
        }
    }
    
    send(payload) {
        if (this.ws && this.ws.readyState === 1 && this.isRegistered) {
            this.ws.send(JSON.stringify(payload));
            return true;
        }
        // If not registered yet or disconnected, queue the message
        console.warn('SyncEngine: Socket not registered or offline. Queueing message:', payload.type);
        this.broadcastQueue.push(payload);
        return false;
    }

    async useLocalHub() {
        const s = await getSettings();
        s.syncHubIp = 'localhost';
        await updateSettings(s);
        this.hubUrl = `ws://localhost:3030?licenseKey=${this.licenseKey}`;
        this.retryCount = 0;
        this.connect();
    }

    async broadcast(type, store, data) {
        // A local edit (storage-change) firing while an incoming sync message
        // is still being applied (isSilent, see handleIncomingUpdate) used to
        // just be dropped here — not queued, not retried — silently never
        // reaching the hub. Queue it instead so it goes out once isSilent
        // clears, typically milliseconds later.
        if (this.isSilent) {
            this.pendingSilentBroadcasts.push({ type, store, data });
            return;
        }
        const settings = await getSettings();
        if (!this.ws || !settings.isInstalled) return;
        const branchId = data?.branchId || settings.branchId || null;
        const syncData = { ...(data || {}) };
        delete syncData.isSynced;
        const payload = {
            type,
            store,
            data: syncData,
            deviceId: settings.id,
            licenseKey: settings.licenseKey,
            branchId
        };
        this.send(payload);
    }

    async syncIncremental() {
        // Implementation for incremental sync if needed
    }

    startAutoSync() {
        this.autoSyncInterval = setInterval(() => this.syncAllLocalData(), 30000);
    }

    async syncAllLocalData(onProgress) {
        let totalSynced = 0;
        const syncKeys = [
            { label: 'Products', store: 'products', key: KEYS.PRODUCTS },
            { label: 'Customers', store: 'customers', key: KEYS.CUSTOMERS },
            { label: 'Orders', store: 'orders', key: KEYS.ORDERS },
            { label: 'Suppliers', store: 'suppliers', key: KEYS.SUPPLIERS },
            { label: 'Settings', store: 'settings', key: KEYS.SETTINGS },
            { label: 'Users', store: 'users', key: KEYS.USERS }
        ];

        // Load tombstones once — skip pushing records that were deleted locally
        const tombstones = await getDeletedTombstones();

        for (const item of syncKeys) {
            const data = await read(item.key);
            if (Array.isArray(data)) {
                const pending = data.filter(x => {
                    if (!x || !x.id) return false;
                    if (x.isSynced === true) return false;
                    // Skip tombstoned records — they were deleted locally, don't re-push
                    if (tombstones.has(`${item.store}:${x.id}`)) {
                        console.log(`[SyncEngine] 🚭 Skipping re-push of tombstoned: ${item.store}:${x.id}`);
                        return false;
                    }
                    return true;
                });
                for (const entry of pending) {
                    await this.broadcast('update', item.store, entry);
                    totalSynced++;
                }
            }
        }
        return { success: true, count: totalSynced };
    }

    async reRegister() {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const settings = await getSettings();

        // The awaited getSettings() call above gives the event loop a chance
        // to run — this.ws can be closed/reassigned by a disconnect/reconnect
        // that happens in that gap, so re-check right before sending instead
        // of trusting the check made before the await.
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        console.log('SyncEngine: Sending REGISTRATION to Hub...');
        this.ws.send(JSON.stringify({
            type: 'register',
            deviceId: settings.id,
            licenseKey: settings.licenseKey,
            branchId: settings.branchId,
            email: settings.email,
            businessName: settings.storeName
        }));
    }

    async requestAdbStatus() { if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'get_adb_status' })); }
}

export const syncEngine = new SyncEngine();
