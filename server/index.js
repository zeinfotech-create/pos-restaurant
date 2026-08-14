// ============================================================
// POS Sync Hub — index.js
// Pure WebSocket (ws) + MongoDB/Mongoose backend (port 3030)
// Compatible with syncEngine.js which uses raw new WebSocket(url)
// ============================================================
//
// ── IDENTITY MODEL: 'LOCAL_EXE' vs a device's real licenseKey ───────────
// This hub deliberately juggles TWO different identity concepts at once —
// documenting both here since it's caused real confusion (and bugs) more
// than once:
//
//   1. 'LOCAL_EXE' — a fixed, SHARED placeholder tenant tag that every
//      standalone/Electron install is registered under during onboarding
//      (see /api/standalone-register below, and Onboarding.js's client-side
//      call to it). It exists because the hub needs SOME licenseKey to
//      partition data under before a device has activated a real Lifetime
//      key of its own. It is NOT a per-device identity — every
//      not-yet-activated standalone install on a given hub shares it.
//
//   2. This device's own real licenseKey — a random `POS-XXXXXXX` value
//      generated once by getDeviceId() during completeInstallation() (see
//      pos-lite's src/db.js), stored in this device's local IndexedDB
//      settings, and used everywhere else in the app (sync partitioning,
//      lifetime-activation requests, etc.) as the actual per-device/per-shop
//      identity.
//
// The bug class this produces: anything that reads a login/registration
// response's `licenseKey` and blindly adopts it into local settings can end
// up copying 'LOCAL_EXE' (the SHARED placeholder) into a field that's
// supposed to hold this device's UNIQUE identity — silently merging this
// device's data into the shared placeholder tenant, or making later
// lifetime-activation attempts look like they're coming from a device that
// never finished onboarding. src/db.js's getSettings() recovery logic and
// Login.js's adopt-on-login logic both explicitly guard against adopting
// 'LOCAL_EXE' for this reason — if you add a new place that reads a
// licenseKey off a server response and writes it into local settings,
// apply the same guard there.
//
// A full redesign (e.g. never using a shared placeholder at all) would
// remove this footgun at the root, but touches onboarding, hub registration,
// and every place that currently branches on 'LOCAL_EXE' — left as a
// documented, guarded-against quirk rather than a rewrite.
// ─────────────────────────────────────────────────────────────────────────

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Force Node.js to use Google DNS — bypasses ISP DNS that blocks SRV record queries
// needed for mongodb+srv:// Atlas connection strings
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const axios = require('axios');
const DBManager = require('./dbManager');
const DB_TYPE = DBManager.getType();

const User = require('./models/User');
const Admin = require('./models/Admin');
const License = require('./models/License');
const Branch = require('./models/Branch');
const Product = require('./models/Product');
const Register = require('./models/Register');
const Customer = require('./models/Customer');
const Supplier = require('./models/Supplier');
const Order = require('./models/Order');
const Setting = require('./models/Setting');
const Purchase = require('./models/Purchase');
const Appointment = require('./models/Appointment');
const Staff = require('./models/Staff');
const Shift = require('./models/Shift');
const Return = require('./models/Return');
const InventoryLog = require('./models/InventoryLog');
const LoginActivity = require('./models/LoginActivity');
const LoyaltyHistory = require('./models/LoyaltyHistory');
const CreditHistory = require('./models/CreditHistory');
const DailyStats = require('./models/DailyStats');
const Record = require('./models/Record');
const UpgradeKey = require('./models/UpgradeKey');
// Category/SubCategory/ImportTracker/BackupHistory/ImportHistory below were
// never imported before, so ModelMap fell back to the generic Record model
// for all five — Record's schema (store/recordId/licenseKey/branchId/data)
// is a NESTED shape, incompatible with the flat {id, licenseKey, ...fields}
// object the generic 'update' handler actually sends (same shape every other
// store gets). Record also has no strict:false, so every field but
// licenseKey/branchId/updatedAt was silently dropped, and the query (keyed
// on 'id', a field Record doesn't even declare) never matched an existing
// doc — every sync of a category/sub-category/backup entry/import entry
// created a fresh near-empty document instead of updating one, with the
// real data (name, etc.) never actually persisted.
const { Category, SubCategory, ImportTracker, BackupHistory, ImportHistory, StaffIncentive } = require('./models/GenericModels');

const ModelMap = {
    'users': User,
    'products': Product,
    'branches': Branch,
    'registers': Register,
    'customers': Customer,
    'suppliers': Supplier,
    'orders': Order,
    'settings': Setting,
    'purchases': Purchase,
    'appointments': Appointment,
    'licenses': License,
    'staff': Staff,
    'shifts': Shift,
    'returns': Return,
    'inventory_logs': InventoryLog,
    'login_activities': LoginActivity,
    'loyalty_history': LoyaltyHistory,
    'credit_history': CreditHistory,
    'daily_stats': DailyStats,
    'import_tracker': ImportTracker,
    'backup_history': BackupHistory,
    'import_history': ImportHistory,
    'categories': Category,
    'sub_categories': SubCategory,
    'admins': Admin,
    'upgrade_keys': UpgradeKey,
    'staff_incentives': StaffIncentive
};

// ============================================================
// Sample Data for Seeding
// ============================================================
const SAMPLE_DATA = {
    'Restaurant': [
        { id: 101, name: 'Coffee', emoji: '☕', price: 80, category: 'Beverages', stock: 100 },
        { id: 102, name: 'Tea', emoji: '🍵', price: 40, category: 'Beverages', stock: 100 },
        { id: 103, name: 'Burger', emoji: '🍔', price: 150, category: 'Food', stock: 50 },
        { id: 104, name: 'Pizza', emoji: '🍕', price: 250, category: 'Food', stock: 30 },
        { id: 105, name: 'Water', emoji: '💧', price: 20, category: 'Beverages', stock: 500 },
    ],
    'Saloon': [
        { id: 201, name: "Men's Haircut", emoji: '💇‍♂️', price: 350, category: 'Hair', stock: 999 },
        { id: 202, name: "Women's Styling", emoji: '💇‍♀️', price: 850, category: 'Hair', stock: 999 },
        { id: 203, name: 'Beard Trim', emoji: '🧔', price: 150, category: 'Grooming', stock: 999 },
        { id: 204, name: 'Facial Ritual', emoji: '🧖', price: 1200, category: 'Spa', stock: 999 },
        { id: 205, name: 'Hair Color', emoji: '🎨', price: 1500, category: 'Hair', stock: 999 },
    ],
    'Bakery': [
        { id: 301, name: 'Fresh Bread', emoji: '🍞', price: 45, category: 'Bread', stock: 50 },
        { id: 302, name: 'Chocolate Croissant', emoji: '🥐', price: 120, category: 'Pastry', stock: 30 },
        { id: 303, name: 'Strawberry Cake', emoji: '🍰', price: 850, category: 'Cakes', stock: 10 },
        { id: 304, name: 'Cookie Box', emoji: '🍪', price: 250, category: 'Cookies', stock: 40 },
        { id: 305, name: 'Bagel', emoji: '🥯', price: 55, category: 'Bread', stock: 25 },
    ],
    'General': [
        { id: 401, name: 'Toothpaste', emoji: '🪥', price: 95, category: 'Personal Care', stock: 100 },
        { id: 402, name: 'Shampoo', emoji: '🧴', price: 180, category: 'Personal Care', stock: 50 },
        { id: 403, name: 'Milk 1L', emoji: '🥛', price: 65, category: 'Grocery', stock: 200 },
        { id: 404, name: 'Egg Box (6)', emoji: '🥚', price: 48, category: 'Grocery', stock: 150 },
        { id: 405, name: 'Detergent', emoji: '🧼', price: 210, category: 'Household', stock: 80 },
    ]
};

function getSampleProducts(type) {
    const data = SAMPLE_DATA[type] || SAMPLE_DATA['General'];
    return data.map(p => ({ ...p, branchId: 'b1' }));
}

const PORT = process.env.PORT || 3030;
const MONGODB_MODE = (process.env.MONGODB_MODE || 'remote').toLowerCase();
const MONGODB_REMOTE_URI = process.env.MONGODB_URI;
const MONGODB_LOCAL_URI = process.env.MONGODB_LOCAL_URI || 'mongodb://127.0.0.1:27017/pos_db';
const MONGODB_URI = MONGODB_MODE === 'local' ? MONGODB_LOCAL_URI : MONGODB_REMOTE_URI;

// Upgrade Keys / Lifetime activations must always be checked against the ONE
// shared central registry (Atlas), regardless of which MongoDB this specific
// install's main connection is using — a customer running MONGODB_MODE=local
// (the normal case for a standalone install) would otherwise only ever see
// upgrade keys sitting in their OWN empty local database, never the ones the
// admin panel actually generated, so no key could ever be redeemed.
let cloudLicenseConnection = null;
let CloudUpgradeKey = null;
let CloudLicense = null;
function getCloudLicenseModels() {
    if (MONGODB_MODE !== 'local') {
        // Already talking to Atlas directly — no second connection needed.
        return { UpgradeKeyModel: UpgradeKey, LicenseModel: License };
    }
    if (!cloudLicenseConnection) {
        cloudLicenseConnection = mongoose.createConnection(MONGODB_REMOTE_URI, {
            dbName: 'pos_db',
            serverSelectionTimeoutMS: 10000,
        });
        cloudLicenseConnection.on('error', (err) => console.error('[CloudLicense] Connection error:', err.message));
        CloudUpgradeKey = cloudLicenseConnection.model('UpgradeKey', UpgradeKey.schema);
        CloudLicense = cloudLicenseConnection.model('License', License.schema);
    }
    return { UpgradeKeyModel: CloudUpgradeKey, LicenseModel: CloudLicense };
}

// If the admin assigned a key to a specific phone/email at creation time, the
// customer must confirm one of them at redemption — an extra identity check
// beyond boundLicenseKey. Keys with no assigned contact skip this (open to any).
function verifyKeyContactMatch(keyDoc, providedPhone, providedEmail) {
    const needsCheck = !!(keyDoc.assignedPhone || keyDoc.assignedEmail);
    if (!needsCheck) return { ok: true };

    const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-10);
    const normEmail = (e) => (e || '').trim().toLowerCase();

    const phoneMatches = keyDoc.assignedPhone && providedPhone && normPhone(providedPhone) === normPhone(keyDoc.assignedPhone);
    const emailMatches = keyDoc.assignedEmail && providedEmail && normEmail(providedEmail) === normEmail(keyDoc.assignedEmail);

    if (phoneMatches || emailMatches) return { ok: true };
    return { ok: false, message: 'Please enter the phone number or email this key was issued to.' };
}

// Mirrors src/db.js's verifyPassword() exactly (same `sha256:<saltHex>:<hashHex>`
// format, same SHA-256(saltHex + plain) construction) so a password hashed on
// the client can actually be verified here. Both login checks below used to
// do `user.passwordHash === password` — a raw string compare that can only
// ever match a passwordHash that was never hashed in the first place. Every
// properly-hashed account (which, since today, is now the normal case — see
// Onboarding.js and db.js's saveUser()) silently failed login through this
// hub path, even with the correct password, while still falling back to
// treating any not-yet-hashed legacy value as plaintext.
function verifyPasswordHash(plain, stored) {
    if (!stored || plain == null) return false;
    if (typeof stored !== 'string' || !stored.startsWith('sha256:')) {
        return stored === plain; // legacy plaintext record
    }
    const [, saltHex, hashHex] = stored.split(':');
    const computedHex = crypto.createHash('sha256').update(saltHex + plain).digest('hex');
    return computedHex === hashHex;
}

// ============================================================
// MongoDB Connection
// ============================================================
let isDbConnected = false;

async function connectDB() {
    try {
        console.log(`⏳ Connecting to MongoDB (${MONGODB_MODE})...`);
        await mongoose.connect(MONGODB_URI, {
            dbName: 'pos_db',
            serverSelectionTimeoutMS: 10000,
            heartbeatFrequencyMS: 10000,
        });
        isDbConnected = true;
        console.log(`✅ MongoDB connected (${MONGODB_MODE}: ${MONGODB_URI.replace(/:([^@/]+)@/, ':****@')})`);

        // Migration: Ensure all existing settings have an id
        await Setting.updateMany({ id: { $exists: false } }, { id: 'global_settings' });
    } catch (err) {
        isDbConnected = false;
        console.error('❌ MongoDB connection failed:', err.message);
        setTimeout(connectDB, 5000);
    }
}

// ============================================================
// HTTP Server + WebSocket Server
// ============================================================

// Guards the Electron-onboarding-only endpoints below (standalone-reset wipes
// this hub's tenant data, standalone-register creates its admin user). The
// server listens on all interfaces so other LAN devices can reach the sync/
// login endpoints by design, but these two are never legitimately called by
// anything except this same machine's own Electron app during its own
// onboarding (see Onboarding.js, which only ever targets localhost:3030) — so
// without this check, any process able to reach 127.0.0.1:3030 (including JS
// in an unrelated browser tab on the same PC) could wipe or hijack the shop.
function checkHubAdminToken(req, res) {
    const remote = req.socket.remoteAddress || '';
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const token = req.headers['x-hub-token'];
    if (!isLoopback || !process.env.HUB_ADMIN_TOKEN || token !== process.env.HUB_ADMIN_TOKEN) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Forbidden' }));
        return false;
    }
    return true;
}

const server = http.createServer(async (req, res) => {
    // 1. GLOBAL CORS HEADERS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Token');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // Health check for Electron
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', db: isDbConnected }));
    }

    // Electron Install Check: Returns whether a local admin already exists on this
    // hub. This is the authoritative signal checkElectronInstallState() (src/db.js)
    // uses to decide Install screen vs Login on every launch, and is also how other
    // LAN devices know this shop's local hub is already set up.
    if (req.url === '/api/install-check' && req.method === 'GET') {
        try {
            // No licenseKey filter: a standalone local hub represents exactly one shop at a
            // time, and its admin user's licenseKey changes once a real Lifetime/Upgrade key
            // is activated (moving off the 'LOCAL_EXE' placeholder) — filtering on the
            // placeholder here made this check start reporting "not installed" for any shop
            // that had since activated a real license, incorrectly bouncing them back to
            // onboarding mid-session on every navigate() call.
            const userCount = await DBManager.count(User, 'users', {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ hasUsers: userCount > 0, userCount, dbConnected: isDbConnected }));
        } catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ hasUsers: false, error: err.message, dbConnected: isDbConnected }));
        }
    }

    // Standalone Reset: called once at the START of onboarding, right before
    // completeInstallation() runs client-side. Standalone/Electron installs
    // always register under the fixed licenseKey 'LOCAL_EXE' + branchId 'b1'
    // (there's only ever one business per local install, so these aren't
    // randomized per-install) — but that means completeInstallation()'s own
    // resetDatabase() only wiped this terminal's IndexedDB, while this exact
    // same hub tenant's OLD data (products, old branch name, etc.) stayed put
    // in the local Mongo hub. Without this, a "fresh" reinstall would still
    // have its very first sync pull that same old hub data straight back
    // into the newly-emptied IndexedDB, silently reintroducing anything the
    // previous install ever pushed here (sample products included) even when
    // this install's own onboarding declined them.
    if (req.url === '/api/standalone-reset' && req.method === 'POST') {
        if (!checkHubAdminToken(req, res)) return;
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
        try {
            // Onboarding's own call (before this install has ever had a real
            // key) sends no body, so it still defaults to 'LOCAL_EXE'. But
            // Settings.js's Danger Zone "Delete Account" button reuses this
            // same endpoint on an ALREADY-activated device — that device's hub
            // data lives under its real generated licenseKey (e.g. 'POS-XXXXX'),
            // never 'LOCAL_EXE', so wiping only the placeholder left that real
            // tenant's user record sitting in the hub forever. The next boot's
            // checkElectronInstallState() (unfiltered "does ANY user exist"
            // check) then saw that leftover user and skipped Onboarding
            // entirely — silently keeping the device on an empty licenseKey.
            let licenseKey = 'LOCAL_EXE';
            try {
                const parsed = JSON.parse(body || '{}');
                if (parsed.licenseKey && typeof parsed.licenseKey === 'string') licenseKey = parsed.licenseKey;
            } catch (e) { /* no/invalid body — keep the LOCAL_EXE default */ }

            const skip = new Set(['admins', 'upgrade_keys']); // platform-level, not per-install business data
            const results = {};
            for (const [store, Model] of Object.entries(ModelMap)) {
                if (skip.has(store)) continue;
                try {
                    const r = await DBManager.delete(Model, store, { licenseKey });
                    results[store] = r.deletedCount || 0;
                } catch (err) {
                    results[store] = { error: err.message };
                }
            }
            console.log(`[Server] Standalone hub reset (licenseKey: ${licenseKey}):`, results);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, results }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: err.message }));
        }
        });
        return;
    }

    // Standalone Registration: Called after onboarding to persist the admin
    // (+ branch + register) in the local Mongo hub — so other LAN devices
    // linking to this shop can see them, AND so login can still
    // succeed with a full branch/register list via the HTTP fallback
    // (syncEngine.verifyCredentials) if this terminal's own IndexedDB is ever wiped.
    if (req.url === '/api/standalone-register' && req.method === 'POST') {
        if (!checkHubAdminToken(req, res)) return;
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const userData = JSON.parse(body);
                const licenseKey = 'LOCAL_EXE';
                const userId = userData.userId || userData.id;

                if (userData.branchId) {
                    await DBManager.upsert(Branch, 'branches', { licenseKey, branchId: userData.branchId }, {
                        licenseKey,
                        branchId: userData.branchId,
                        name: userData.businessName || 'My Store',
                        address: userData.businessAddress || '',
                        updatedAt: new Date()
                    });
                }
                if (userData.registerId) {
                    await DBManager.upsert(Register, 'registers', { licenseKey, branchId: userData.branchId, registerId: userData.registerId }, {
                        licenseKey,
                        branchId: userData.branchId,
                        registerId: userData.registerId,
                        name: 'Main Counter',
                        updatedAt: new Date()
                    });
                }

                const existing = await DBManager.findOne(User, 'users', { userId, licenseKey });
                if (!existing) {
                    await DBManager.upsert(User, 'users', { userId, licenseKey }, {
                        userId,
                        licenseKey,
                        username: userData.username,
                        name: userData.name || userData.username,
                        passwordHash: userData.password,
                        role: userData.role || 'Admin',
                        branchId: userData.branchId,
                        updatedAt: new Date()
                    });
                    console.log(`[Server] Standalone admin registered on local hub: ${userData.username}`);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
        });
        return;
    }

    // NEW: HTTP Login for POS (more reliable for mobile/firewalls)
    if (req.url === '/api/pos-login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                // Without this, a crafted body like {"username": {"$gt": ""}}
                // builds a Mongo filter that matches an arbitrary user instead
                // of doing the intended exact-value lookup.
                if (typeof username !== 'string' || typeof password !== 'string') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Invalid credentials format' }));
                }
                const user = await DBManager.findOne(User, 'users', {
                    username
                }) || await DBManager.findOne(User, 'users', {
                    email: username
                }) || await DBManager.findOne(User, 'users', {
                    name: username
                });

                if (!user) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'User not found' }));
                }
                
                // MIRROR: pos_verify_credentials logic (pin, or hashed/legacy password)
                const isValid = user.pin === password || verifyPasswordHash(password, user.passwordHash);

                if (!isValid) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Invalid password' }));
                }

                const status = await getLicenseStatus(user.licenseKey);
                if (status.isSuspended) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'ACCOUNT SUSPENDED' }));
                }

                let branches = (await DBManager.find(Branch, 'branches', { licenseKey: user.licenseKey })).map(b => {
                    const obj = b;
                    return { ...obj, id: obj.branchId || obj._id?.toString() };
                });
                let registers = (await DBManager.find(Register, 'registers', { licenseKey: user.licenseKey })).map(r => {
                    const obj = r;
                    return { ...obj, id: obj.registerId || obj._id?.toString() };
                });

                // MIRROR: pos_verify_credentials's own branch-scoping (below) — Staff/
                // Manager/Custom only ever get the branches explicitly assigned to
                // them, never every branch on the license. This endpoint used to skip
                // this filter entirely, so a login through it (the HTTP fallback path)
                // handed a staff account every branch regardless of assignment.
                if (user.role !== 'Admin' && user.role !== 'Master' && user.role !== 'Super Admin' && user.branchIds && user.branchIds.length > 0) {
                    branches = branches.filter(b => user.branchIds.includes(b.id));
                    registers = registers.filter(r => user.branchIds.includes(r.branchId));
                }

                const settings = await DBManager.find(Setting, 'settings', { licenseKey: user.licenseKey });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    // Full record (branchIds, permissions, sessionFilterEnabled, etc.) —
                    // this used to whitelist only a handful of fields and silently drop
                    // branchIds, which made Switch Branch (client checks
                    // store.user.branchIds.length > 1) invisible for any staff account
                    // whose login happened to go through this HTTP path instead of the
                    // WebSocket one, even though they were assigned multiple branches.
                    user: { ...user, id: user._id },
                    licenseKey: user.licenseKey,
                    networkId: user.licenseKey,
                    branches, registers, settings, licenseStatus: status
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Server Login Error' }));
            }
        });
        return;
    }

    // Log the unhandled request to help the user find typos in their URL
    console.warn(`[Server] 404 - Unhandled ${req.method} request to: ${req.url}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: 'Endpoint not found',
        requestedPath: req.url,
        suggestion: "Check your Android app URL settings. Ensure it matches exactly."
    }));
});

const wss = new WebSocket.Server({ server });

// --------------------------------------------------------
// Email Helpers (Brevo & Validation)
// --------------------------------------------------------
async function sendSubscriptionEmail(email, status, details = {}) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        console.error('[Brevo] 🛑 Cannot send email: BREVO_API_KEY is missing from environment variables.');
        return false;
    }

    if (!email) {
        console.error(`[Brevo] 🛑 Cannot send ${status} email: Recipient email is missing.`);
        return false;
    }

    // Template Mapping:
    // 3: Plan Upgrade Requested (Confirmation)
    // 4: Plan Approved (Success)
    // 5: Plan Rejected (Failure/Action Required)
    const templateMap = {
        'requested': 3,
        'approved': 4,
        'rejected': 5
    };

    const templateId = templateMap[status];
    if (!templateId) {
        console.error(`[Brevo] 🛑 Internal Error: No template ID mapped for status "${status}"`);
        return false;
    }

    console.log(`[Brevo] 📤 Attempting to send ${status.toUpperCase()} email to: ${email} (Template #${templateId})`);

    try {
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: 'ZeInfoTech Team', email: 'zeinfotech@gmail.com' },
            to: [{ email: email }],
            templateId: templateId,
            params: {
                storeName: details.storeName || 'Your Store',
                plan: details.plan || 'Premium',
                amount: details.amount || '0',
                premiumKey: details.premiumKey || '',
                expiryDate: details.expiryDate || '',
                reason: details.reason || 'Verification failed'
            }
        }, {
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }
        });
        console.log(`[Brevo] ✅ ${status.toUpperCase()} email successfully sent to ${email}. ID: ${response.data.messageId}`);
        return true;
    } catch (err) {
        const errorData = err.response?.data || err.message;
        console.error(`[Brevo] ❌ FAILED to send ${status} email to ${email}:`, errorData);
        return false;
    }
}

// --------------------------------------------------------
// Helpers
// --------------------------------------------------------
function getDefaultSettings(licenseKey, branchId = null) {
    return {
        id: branchId ? `settings_${branchId}` : 'global_settings',
        licenseKey,
        branchId,
        storeName: 'My Store',
        storeAddress: '123 Main Street, City',
        currency: '₹',
        taxRate: 5,
        availableTaxes: [],
        paymentMethods: [],
        receiptFooter: 'Thank you for shopping with us!',
        theme: 'theme-light-zoom', // "Sapphire" — default for fresh installs
        enableRegisterRoutine: true,
        masterPin: '0000',
        autoLockMinutes: 0,
        isInstalled: false,
        businessType: 'Restaurant',
        syncHubIp: '',
        email: '',
        updatedAt: new Date()
    };
}

// ============================================================
// Client Registry — licenseKey → Set<WebSocket>
// ============================================================
const clientMap = new Map(); // licenseKey -> Set<ws>

// Active-session-per-user registry — `${licenseKey}::${userId}` -> { ws, registerId,
// registerName, branchId, branchName, loginAt }. In-memory only (per hub process): a
// hub restart clears it, which is fine since every connected client re-registers and
// re-selects a register on reconnect. Freed on explicit logout (pos_logout_session)
// or when the owning ws disconnects (ws.on('close')), so a crashed/closed client
// never permanently locks its register slot.
const activeUserSessions = new Map();

// Helper to send JSON messages securely
function send(ws, obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function registerClient(ws, licenseKey) {
    ws._licenseKey = licenseKey;
    if (!clientMap.has(licenseKey)) clientMap.set(licenseKey, new Set());
    clientMap.get(licenseKey).add(ws);
    console.log(`[Hub] Registered client for license: ${licenseKey} (total: ${clientMap.get(licenseKey).size})`);
}

function unregisterClient(ws) {
    const lk = ws._licenseKey;
    if (lk && clientMap.has(lk)) {
        clientMap.get(lk).delete(ws);
        if (clientMap.get(lk).size === 0) clientMap.delete(lk);
    }
}

function broadcastToLicense(licenseKey, payload, excludeWs = null) {
    const group = clientMap.get(licenseKey);
    if (!group) return;
    const json = JSON.stringify(payload);
    for (const ws of group) {
        if (ws === excludeWs) continue;
        if (ws.readyState === WebSocket.OPEN) ws.send(json);
    }
}

// ============================================================
// Trial & License Helpers
// ============================================================
async function getLicenseStatus(licenseKey) {
    // Local/Electron install has no license concept — this hub's own enforcement
    // (the LIMIT_REACHED guard on 'update' below) must agree with the client's
    // hardcoded standalone limits (syncEngine.js), or a legitimate add gets
    // rejected here even though the UI shows room for it.
    const defaultTrial = {
        type: 'trial',
        isExpired: false,
        daysLeft: 7,
        branchLimit: 2,
        userLimit: 5,
        registerLimit: 2,
        productLimit: 100,
        modules: {
            inventory: 'basic',
            reports: 'daily',
            appointments: false,
            industry_setup: false
        }
    };

    if (!licenseKey || licenseKey === 'GLOBAL' || licenseKey === 'FREE-POS-ZEI-AUTO') {
        // Standalone / Electron mode — all modules enabled locally
        return {
            ...defaultTrial,
            type: 'standalone',
            modules: {
                inventory: 'advanced',
                reports: 'advanced',
                appointments: true,
                industry_setup: true,
                pro_addons: true,
                register_shift: true,
                cloud_sync: false,
                data_backup: true
            }
        };
    }

    const license = await DBManager.findOne(License, 'licenses', { licenseKey: licenseKey.trim().toUpperCase() });
    if (!license) return defaultTrial;

    // SUSPENSION CHECK
    if (license.status === 'inactive') {
        return { ...defaultTrial, isSuspended: true, status: 'inactive' };
    }

    const createdAt = license.createdAt || new Date();
    const now = new Date();

    // Trial logic
    const diffTime = now - createdAt;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const trialDaysLeft = Math.max(0, 7 - diffDays);
    const trialExpired = diffDays > 7;

    if (license.licenseType === 'premium' || license.type === 'premium') {
        let expiry = license.expiresAt || license.expiryDate;
        if (!expiry) {
            expiry = new Date(createdAt);
            expiry.setDate(expiry.getDate() + 30);
        }

        const premDiffTime = new Date(expiry) - now;
        const daysLeft = Math.max(0, Math.ceil(premDiffTime / (1000 * 60 * 60 * 24)));
        const isExpired = now > new Date(expiry);

        const branchLimit = license.branchLimit || 2;
        // Use actual saved limits from subscription, not derived formula
        const userLimit = license.userLimit || (branchLimit * 3);
        const registerLimit = license.registerLimit || (branchLimit * 3);
        const billingInterval = license.billingInterval || 'monthly';

        return {
            type: 'premium',
            isExpired,
            daysLeft,
            billingInterval,
            expiresAt: expiry,
            branchLimit: branchLimit,
            userLimit: userLimit,
            registerLimit: registerLimit,
            productLimit: 1000000, // Unlimited
            modules: {
                inventory: 'advanced',
                reports: 'full',
                appointments: true,
                industry_setup: true
            },
            createdAt: createdAt
        };
    }

    // Lifetime Offline license (Item 2): never expires, all modules unlocked —
    // relevant for ANY client querying this license's status (mobile-link/
    // browser), not just the Electron install that owns the device-locked token.
    if (license.licenseType === 'lifetime_offline') {
        return {
            type: 'premium',
            isExpired: false,
            daysLeft: 9999,
            branchLimit: license.branchLimit || 2,
            userLimit: license.userLimit || 5,
            registerLimit: license.registerLimit || 2,
            productLimit: 999999,
            modules: {
                inventory: 'advanced',
                reports: 'full',
                appointments: true,
                industry_setup: true,
                pro_addons: true,
                register_shift: true,
                cloud_sync: true,
                data_backup: true
            },
            createdAt: createdAt
        };
    }

    // -------------------------------------------------------------------------
    // PENDING VERIFICATION CHECK (Persistence across refresh)
    // -------------------------------------------------------------------------
    const Setting = mongoose.model('Setting');
    const sDoc = await DBManager.findOne(Setting, 'settings', { licenseKey: licenseKey.trim().toUpperCase() });
    if (sDoc && sDoc.subscriptionRequest && sDoc.subscriptionRequest.status === 'pending_verification') {
        return {
            ...defaultTrial,
            type: 'pending_verification',
            daysLeft: trialDaysLeft,
            isExpired: trialExpired
        };
    }

    return {
        ...defaultTrial,
        isExpired: trialExpired,
        daysLeft: trialDaysLeft,
        createdAt: createdAt
    };
}

// ============================================================
// WebSocket Message Handler
// ============================================================
wss.on('connection', (ws, req) => {
    // Extract licenseKey from query string: ws://host:3030?licenseKey=XXX
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const queryLicense = url.searchParams.get('licenseKey') || 'GLOBAL';
    ws._licenseKey = queryLicense;
    ws._ip = req.socket.remoteAddress; // Store IP for deduplication
    console.log(`[Hub] New connection: ${ws._ip} | licenseKey: ${queryLicense}`);

    // Send server status immediately
    send(ws, { type: 'server_status', dbConnected: isDbConnected });

    // Heartbeat setup
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (rawData) => {
        let msg;
        try {
            msg = JSON.parse(rawData.toString());
            console.log(`[Hub] [RAW] Received: ${msg.type} from ${ws._ip} | Store: ${msg.store || 'N/A'}`);
        } catch (e) {
            console.error('[Hub] Invalid JSON received:', e.message);
            return;
        }


        const { type } = msg;
        // Use the connection's OWN registered identity, not whatever the
        // message body claims — a client sending {licenseKey: 'someone-else'}
        // in an 'update'/'delete'/'pos_fetch_all'/etc message body must not be
        // able to act as a different tenant than the one it connected/
        // registered as. ('register' itself is the one legitimate place a
        // connection's licenseKey is established/changed — see that case.)
        const licenseKey = ws._licenseKey || 'GLOBAL';

        // GLOBAL SUSPENSION GUARD: Check license status for EVERY message
        const status = await getLicenseStatus(licenseKey);
        if (status.isSuspended && type !== 'register') {
            console.log(`[Hub] 🔒 Global Guard REJECTED message ${type} from suspended license: ${licenseKey}`);
            send(ws, { 
                type: 'force_disconnect', 
                reason: 'ACCOUNT SUSPENDED: Contact Zeinfotech Support' 
            });
            // Immediate termination for suspended accounts
            setTimeout(() => { if (ws.readyState === 1 || ws.readyState === 0) ws.terminate(); }, 200);
            return;
        }


        try {
            switch (type) {
                // --------------------------------------------------------
                // register — client handshake
                // --------------------------------------------------------
                case 'register': {
                    const key = msg.licenseKey || queryLicense || 'GLOBAL';
                    
                    const status = await getLicenseStatus(key);
                    if (status.isSuspended) {
                        console.log(`[Hub] 🔒 Registration REJECTED (Suspended): ${key}`);
                        send(ws, { 
                            type: 'register_failure', 
                            licenseKey: key, 
                            message: 'ACCOUNT SUSPENDED: Contact Zeinfotech Support',
                            licenseStatus: status 
                        });
                        return setTimeout(() => ws.terminate(), 500);
                    }

                    registerClient(ws, key);

                    send(ws, {
                        type: 'register_success',
                        licenseKey: key,
                        message: `Registered with POS Sync Hub (${DB_TYPE.toUpperCase()})`,
                        licenseStatus: status
                    });
                    send(ws, { type: 'server_status', dbConnected: isDbConnected });
                    break;
                }

                // --------------------------------------------------------
                // pos_fetch_all — consolidated sync for all models
                // --------------------------------------------------------
                case 'pos_fetch_all': {
                    const { branchId } = msg;
                    console.log(`[Hub] 📂 Fetch All Request for ${licenseKey} (Branch: ${branchId || 'All'})`);

                    const results = {};
                    const branchScopedStores = ['products', 'registers', 'customers', 'suppliers', 'orders', 'purchases', 'appointments', 'staff', 'shifts', 'returns', 'categories', 'sub_categories'];

                    const fetchPromises = Object.entries(ModelMap).map(async ([store, Model]) => {
                        let query = { licenseKey };
                        if (branchId && branchScopedStores.includes(store)) {
                            query.branchId = branchId;
                        }

                        if (store === 'orders') {
                            query.status = { $in: ['completed', 'cancelled', 'Completed', 'Cancelled', 'Settled', 'settled', 'Paid', 'paid'] };
                        }

                        // Special case for settings: global + branch-specific
                        if (store === 'settings' && branchId) {
                            query = {
                                licenseKey,
                                $or: [{ id: 'global_settings' }, { branchId: branchId }]
                            };
                        }

                        const docs = await DBManager.find(Model, store, query);
                        results[store] = docs.map(d => ({
                            ...d,
                            id: d.id || d.userId || d.productId || d.registerId || d.branchId || d._id
                        }));
                    });

                    await Promise.all(fetchPromises);

                    send(ws, { type: 'pos_full_state', results });
                    const totalCount = Object.values(results).reduce((sum, records) => sum + records.length, 0);
                    console.log(`[Hub] 📤 Sent ${totalCount} records to client`);
                    break;
                }

                // --------------------------------------------------------
                // update — upsert to MongoDB + broadcast
                // --------------------------------------------------------
                case 'update': {
                    const { store, data, licenseKey: msgLicense } = msg;

                    if (!store || !data || !data.id) break;

                    const Model = ModelMap[store];
                    if (!Model) {
                        console.warn(`[Hub] No model found for store: "${store}" (Keys: ${Object.keys(ModelMap).join(', ')})`);
                        break;
                    }

                    // Prefer the connection's own established identity over
                    // whatever the message/payload claims — only fall back to
                    // those when this connection hasn't registered a real
                    // licenseKey yet (still 'GLOBAL').
                    const finalLicense = licenseKey !== 'GLOBAL' ? licenseKey : (msgLicense || (data && data.licenseKey));
                    console.log(`[Hub] [UPDATE] Store: ${store} | ID: ${data.id} | License: ${finalLicense}`);

                    // GUARD: Reject updates from unconfigured/GLOBAL clients to keep DB clean
                    // EXCEPT for settings, which might need to sync the initial configuration
                    if ((!finalLicense || finalLicense === 'GLOBAL') && store !== 'settings') return;

                    // LIMIT & SUSPENSION GUARD
                    const status = await getLicenseStatus(finalLicense);
                    if (status.isSuspended) {
                        console.log(`[Hub] 🛑 Update BLOCKED (Suspended): ${finalLicense}`);
                        send(ws, { 
                            type: 'force_disconnect', 
                            reason: 'ACCOUNT SUSPENDED: Contact Zeinfotech Support' 
                        });
                        setTimeout(() => { if (ws.readyState === 1) ws.close(); }, 500);
                        return;
                    }
                    if (status.isExpired && store !== 'settings') {
                        console.warn(`[Hub] 🛑 Update REJECTED (Expired): ${store} for ${finalLicense}`);
                        send(ws, { type: 'error', code: 'TRIAL_EXPIRED', message: 'Your license or trial has expired. Please upgrade or renew to continue.', store });
                        break;
                    }

                    const recordCount = await DBManager.count(Model, store, { licenseKey: finalLicense });
                    const GlobalStores = ['users', 'branches', 'settings', 'staff', 'licenses'];
                    const isGlobalStore = GlobalStores.includes(store);
                    // Computed early (also reused below for DB-write partitioning) —
                    // registerLimit is PER BRANCH, so its count must be scoped by
                    // branchId too, unlike the other limits here which are genuinely
                    // license-wide totals.
                    const finalBranchId = data.branchId || msg.branchId;

                    let limitExceeded = false;
                    let limitMsg = '';

                    // A MONGODB_MODE=local hub is this one shop's own bundled instance —
                    // it never has a real License document for its device's licenseKey
                    // (those only ever live in the Atlas-hosted admin panel), so
                    // getLicenseStatus() always fell back to defaultTrial's branchLimit:2
                    // / userLimit:5 / etc. regardless of what the client had actually
                    // activated (Lifetime tokens are verified entirely client-side via
                    // RSA signature — this hub is never told about them). That silently
                    // rejected adds the client's own UI showed as allowed the moment a
                    // real device unlocked more than the trial defaults. Standalone
                    // builds' real enforcement is the client's Lifetime activation state,
                    // not this hub's (always-empty-for-local-mode) license collection.
                    if (MONGODB_MODE !== 'local') {
                        if (store === 'branches') {
                            const existing = await DBManager.findOne(Model, store, { licenseKey: finalLicense, branchId: data.id });
                            if (!existing && recordCount >= status.branchLimit) {
                                limitExceeded = true;
                                limitMsg = `License limit reached: Your current plan allows max ${status.branchLimit} branch${status.branchLimit > 1 ? 'es' : ''}.`;
                            }
                        } else if (store === 'users') {
                            const existing = await DBManager.findOne(Model, store, { licenseKey: finalLicense, userId: data.id });
                            if (!existing && recordCount >= status.userLimit) {
                                limitExceeded = true;
                                limitMsg = `License limit reached: Your current plan allows max ${status.userLimit} users.`;
                            }
                        } else if (store === 'registers') {
                            const existing = await DBManager.findOne(Model, store, { licenseKey: finalLicense, registerId: data.id });
                            const registerCountForBranch = finalBranchId
                                ? await DBManager.count(Model, store, { licenseKey: finalLicense, branchId: finalBranchId })
                                : recordCount;
                            if (!existing && registerCountForBranch >= status.registerLimit) {
                                limitExceeded = true;
                                limitMsg = `License limit reached: Your current plan allows max ${status.registerLimit} registers per branch.`;
                            }
                        } else if (store === 'products') {
                            const existing = await DBManager.findOne(Model, store, { licenseKey: finalLicense, productId: data.id });
                            if (!existing && recordCount >= status.productLimit) {
                                limitExceeded = true;
                                limitMsg = `License limit reached: Your plan allows max ${status.productLimit} products.`;
                            }
                        }
                    } // end MONGODB_MODE !== 'local'

                    if (limitExceeded) {
                        console.warn(`[Hub] 🛑 Limit Reached: ${store} for ${finalLicense}`);
                        send(ws, { type: 'error', code: 'LIMIT_REACHED', message: limitMsg, store, id: data.id });
                        break;
                    }

                    let query = { licenseKey: finalLicense };
                    // Deduplication: Only partition by branchId for non-global stores
                    if (finalBranchId && !isGlobalStore) query.branchId = finalBranchId;

                    const updateObj = { ...data, licenseKey: finalLicense, updatedAt: new Date() };
                    if (finalBranchId && !isGlobalStore) updateObj.branchId = finalBranchId;

                    // Security: Strip sensitive fields that shouldn't be updated via sync if coming from untrusted source
                    if (isGlobalStore && store === 'settings' && status.type === 'trial') {
                        // Force trial limitations in settings
                        if (updateObj.features) {
                            updateObj.features.hasAppointments = false;
                        }
                    }

                    if (store === 'users') {
                        // MAPPING: Ensure password from client is saved as passwordHash for login compatibility
                        if (data.password) updateObj.passwordHash = data.password;
                        if (data.pin) updateObj.pin = data.pin;

                        // LOGGING: Check if image is being received
                        if (data.image) {
                            console.log(`[Hub] 🖼️ Image received for user: ${data.id} (Size: ${Math.round(data.image.length / 1024)} KB)`);
                        }

                        if (data.username) {
                            const existing = await DBManager.findOne(Model, store, { username: data.username, licenseKey: finalLicense });
                            if (existing) {
                                query.userId = existing.userId;
                                updateObj.userId = existing.userId;
                            } else {
                                query.userId = data.id;
                                updateObj.userId = data.id;
                            }
                        } else {
                            query.userId = data.id;
                            updateObj.userId = data.id;
                        }
                    } else if (store === 'settings') {
                        // DEDUPLICATION: Merge branch settings by branchId + licenseKey
                        if (data.branchId && data.id?.startsWith('settings_')) {
                            const existing = await DBManager.findOne(Model, store, { branchId: data.branchId, licenseKey: finalLicense, id: { $ne: 'global_settings' } });
                            if (existing) {
                                query.id = existing.id;
                                updateObj.id = existing.id;
                            } else {
                                query.id = data.id;
                                updateObj.id = data.id;
                            }
                    } else if (data.id === 'global_settings') {
                        // strictly match per license to avoid cross-tenant data corruption
                        const existing = await DBManager.findOne(Model, store, { id: 'global_settings', licenseKey: finalLicense });
                        if (existing) {
                            query = { id: 'global_settings', licenseKey: finalLicense };
                        } else {
                            // Claim GLOBAL legacy if it exists and we haven't created one
                            const globalExisting = await DBManager.findOne(Model, store, { id: 'global_settings', licenseKey: 'GLOBAL' });
                            if (globalExisting && finalLicense !== 'GLOBAL') {
                                query = { id: 'global_settings', licenseKey: 'GLOBAL' };
                            } else {
                                query = { id: 'global_settings', licenseKey: finalLicense };
                            }
                        }
                        updateObj.licenseKey = finalLicense;
                        updateObj.branchId = null;
                        } else {
                            query.id = data.id;
                            updateObj.id = data.id;
                        }

                        console.log(`[Hub] ⚙️ SETTINGS UPDATE for ${updateObj.licenseKey || finalLicense}:`, {
                            id: data.id,
                            taxes: (data.availableTaxes || []).length,
                            payments: (data.paymentMethods || []).length,
                            storeName: data.storeName,
                            taxRate: data.taxRate
                        });

                        // SYNC: Handle storeName propagation based on context (Branch or Global)
                        if (data.storeName && finalLicense && finalLicense !== 'GLOBAL') {
                            const isBranchSettings = data.branchId && data.id?.startsWith('settings_');
                            const isGlobalSettings = data.id === 'global_settings';

                            console.log(`[Hub] 🔄 Propagating storeName "${data.storeName}" for license: ${finalLicense} (Type: ${isBranchSettings ? 'Branch' : (isGlobalSettings ? 'Global' : 'Other')})`);

                            try {
                                if (isBranchSettings) {
                                    if (ModelMap.branches) {
                                        const branchToUpdate = await DBManager.findOne(ModelMap.branches, 'branches', { licenseKey: finalLicense, branchId: data.branchId });
                                        if (branchToUpdate) {
                                            branchToUpdate.name = data.storeName;
                                            branchToUpdate.updatedAt = new Date();
                                            await DBManager.upsert(ModelMap.branches, 'branches', { licenseKey: finalLicense, branchId: data.branchId }, branchToUpdate);
                                            console.log(`[Hub] ✅ Updated branch "${data.branchId}" name to "${data.storeName}"`);
                                        }
                                    }
                                } else if (isGlobalSettings) {
                                    if (ModelMap.licenses) {
                                        const licenseType = data.licenseKey === 'FREE-POS-ZEI-AUTO' ? 'trial' : (data.licenseKey?.startsWith('ZEI-') ? 'premium' : null);
                                        const updateData = { businessName: data.storeName, updatedAt: new Date() };
                                        if (licenseType) updateData.licenseType = licenseType;

                                        const licenseToUpdate = await DBManager.findOne(ModelMap.licenses, 'licenses', { licenseKey: finalLicense });
                                        if (licenseToUpdate) {
                                            Object.assign(licenseToUpdate, updateData);
                                            await DBManager.upsert(ModelMap.licenses, 'licenses', { licenseKey: finalLicense }, licenseToUpdate);
                                        }
                                        console.log(`[Hub] ✅ Updated global license businessName to "${data.storeName}" and type to "${licenseType || 'unchanged'}"`);
                                    }
                                }

                                if (isBranchSettings && ModelMap.branches) {
                                    const updatedBranch = await DBManager.findOne(ModelMap.branches, 'branches', { licenseKey: finalLicense, branchId: data.branchId });
                                    if (updatedBranch) {
                                        broadcastToLicense(finalLicense, {
                                            type: 'update',
                                            store: 'branches',
                                            data: { ...updatedBranch, id: updatedBranch.branchId || updatedBranch.id },
                                            timestamp: new Date().toISOString()
                                        }, ws);
                                    }
                                }
                            } catch (pErr) {
                                console.error(`[Hub] ❌ Propagation failed:`, pErr.message);
                            }
                        }

                        // The admin panel (a separate vendor-only project — see
                        // D:\zeinfotech-admin-panel) has no live connection to this
                        // hub to notify anymore; it polls the shared Atlas Settings
                        // collection for pending requests instead. Still send the
                        // customer-facing confirmation email from here.
                        if (updateObj.subscriptionRequest && updateObj.subscriptionRequest.status === 'pending_verification') {
                            const storeName = updateObj.storeName || finalLicense;
                            const amount = updateObj.subscriptionRequest.amount;
                            const plan = updateObj.subscriptionRequest.plan;

                            console.log(`[Hub] 📢 Detected Subscription Request (${plan}) from ${storeName}. Status: ${updateObj.subscriptionRequest.status}`);

                            // EMAIL: Send confirmation to user
                            if (updateObj.subscriptionRequest.email) {
                                console.log(`[Hub] 📧 Triggering confirmation email to: ${updateObj.subscriptionRequest.email}`);
                                await sendSubscriptionEmail(updateObj.subscriptionRequest.email, 'requested', {
                                    storeName,
                                    plan,
                                    amount
                                });
                            }
                        }
                    } else if (store === 'products') {
                        query.productId = data.id;
                    } else if (store === 'branches') {
                        // branches are global to license, or scoped by self id
                        query.branchId = data.id;
                    } else if (store === 'registers') {
                        query.registerId = data.id;
                    } else {
                        query.id = data.id;
                    }

                    try {
                        // Strip _id to prevent E11000 duplicate key errors during upsert
                        delete updateObj._id;

                        const doc = await DBManager.upsert(Model, store, query, updateObj);
                        console.log(`[Hub] ✅ Saved to ${store}: ${query.id || data.id} (License: ${finalLicense})`);
                        if (store === 'settings') {
                            console.log(`  - Taxes saved: ${JSON.stringify(doc.availableTaxes || doc.data?.availableTaxes)}`);
                            console.log(`  - Payments saved: ${JSON.stringify(doc.paymentMethods || doc.data?.paymentMethods)}`);
                        }
                        console.log(`[Hub] [DEBUG] UPDATE SUCCESS - Store: ${store}, ID: ${data.id}, Status in Doc: ${doc.status || 'N/A'}`);

                        // Broadcast the update to other clients with the same license
                        broadcastToLicense(finalLicense, { type: 'update', store, data: doc, timestamp: new Date().toISOString() }, ws);

                        // Send acknowledgement back to the sender
                        send(ws, { 
                            type: 'sync_ack', 
                            store, 
                            id: data.id, 
                            timestamp: new Date().toISOString() 
                        });
                    } catch (err) {
                        console.error(`[Hub] 🔴 Failed to update ${store} (ID: ${data.id}):`, err);
                    }
                    break;
                }

                // --------------------------------------------------------
                // upgrade_license — validate and save premium key
                // --------------------------------------------------------
                case 'upgrade_license': {
                    const { premiumKey, requestId, plan, branchCount, phone, email } = msg;
                    console.log(`[Hub] Upgrade license request for ${licenseKey} to key: ${premiumKey} (Plan: ${plan}, Branches: ${branchCount})`);

                    if (!licenseKey || !premiumKey) {
                        send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'Missing license key or premium key' });
                        break;
                    }

                    const isFreeKey = premiumKey.toUpperCase() === 'FREE-POS-ZEI-AUTO';

                    if (!isFreeKey) {
                        // Real, admin-issued key lookup — replaces the old "any ZEI-* string" placeholder
                        // check. Keys always live in the cloud (Atlas) registry regardless of which
                        // Mongo mode this particular server process is running in.
                        const { UpgradeKeyModel } = getCloudLicenseModels();
                        const keyDoc = await DBManager.findOne(UpgradeKeyModel, 'upgrade_keys', { key: premiumKey.toUpperCase() });

                        if (!keyDoc) {
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'Invalid upgrade key' });
                            break;
                        }
                        if (keyDoc.status !== 'active') {
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'This key has already been used or was revoked' });
                            break;
                        }
                        if (keyDoc.expiresAt && new Date(keyDoc.expiresAt) < new Date()) {
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'This key has expired' });
                            break;
                        }
                        if (keyDoc.usedCount >= keyDoc.maxUses) {
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'This key has reached its maximum number of uses' });
                            break;
                        }
                        if (keyDoc.boundLicenseKey && keyDoc.boundLicenseKey !== licenseKey) {
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'This key is not valid for your account' });
                            break;
                        }
                        const contactCheck = verifyKeyContactMatch(keyDoc, phone, email);
                        if (!contactCheck.ok) {
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: contactCheck.message });
                            break;
                        }
                        if (keyDoc.planType === 'lifetime') {
                            // Lifetime keys are device-locked and activated through a separate offline-activation flow
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'Lifetime keys must be activated from the Lifetime Activation screen' });
                            break;
                        }

                        try {
                            let existingLicense = await DBManager.findOne(License, 'licenses', { licenseKey });

                            // Extend from the LATER of (current expiry, now) so renewing early
                            // doesn't waste the customer's remaining paid days.
                            const baseDate = (existingLicense?.expiresAt && new Date(existingLicense.expiresAt) > new Date())
                                ? new Date(existingLicense.expiresAt)
                                : new Date();
                            let expiresAt = new Date(baseDate);
                            if (keyDoc.planType === 'annual' || keyDoc.planType === 'yearly') {
                                expiresAt.setFullYear(expiresAt.getFullYear() + 1);
                            } else if (keyDoc.planType === 'biannual') {
                                expiresAt.setMonth(expiresAt.getMonth() + 6);
                            } else {
                                expiresAt.setMonth(expiresAt.getMonth() + 1);
                            }

                            let newLicenseData = {
                                ...(existingLicense || { licenseKey }),
                                licenseType: 'premium',
                                premiumKey: premiumKey,
                                branchLimit: keyDoc.branchLimit || Number(branchCount) || existingLicense?.branchLimit || 2,
                                userLimit: keyDoc.userLimit || existingLicense?.userLimit,
                                registerLimit: keyDoc.registerLimit || existingLicense?.registerLimit,
                                activatedAt: existingLicense?.activatedAt || new Date(),
                                expiresAt,
                                status: 'active',
                                updatedAt: new Date()
                            };
                            await DBManager.upsert(License, 'licenses', { licenseKey }, newLicenseData);

                            // Consume the key — one-time (or maxUses-capped) redemption
                            const newUsedCount = (keyDoc.usedCount || 0) + 1;
                            await DBManager.updateMany(UpgradeKeyModel, 'upgrade_keys', { key: keyDoc.key }, {
                                $set: {
                                    usedCount: newUsedCount,
                                    status: newUsedCount >= keyDoc.maxUses ? 'used' : 'active',
                                    redemptions: [...(keyDoc.redemptions || []), { licenseKey, redeemedAt: new Date() }]
                                }
                            });

                            const status = await getLicenseStatus(licenseKey);
                            send(ws, { type: 'upgrade_license_result', requestId, success: true, message: 'License upgraded to Premium successfully!', licenseStatus: status });
                            broadcastToLicense(licenseKey, { type: 'license-status-changed', licenseStatus: status, timestamp: new Date().toISOString() });
                        } catch (err) {
                            console.error('[Hub] Upgrade failed:', err);
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'Server error' });
                        }
                        break;
                    }

                        if (isFreeKey) {
                            // Revert to trial/free for the CURRENT license identity
                            try {
                                let existingLicense = await DBManager.findOne(License, 'licenses', { licenseKey });
                                let newLicenseData = { ...(existingLicense || { licenseKey }), licenseType: 'trial', premiumKey: null, branchLimit: 1, status: 'active', updatedAt: new Date() };
                                await DBManager.upsert(License, 'licenses', { licenseKey }, newLicenseData);

                                // ALSO clear any pending subscription requests to prevent UI lock
                                let existingSetting = await DBManager.findOne(Setting, 'settings', { licenseKey });
                                let sDoc = null;
                                if (existingSetting) {
                                    existingSetting.subscriptionRequest = null;
                                    sDoc = await DBManager.upsert(Setting, 'settings', { licenseKey }, existingSetting);
                                }

                            send(ws, { type: 'upgrade_license_result', requestId, success: true, message: 'Free Account Activated' });

                            const status = await getLicenseStatus(licenseKey);
                            broadcastToLicense(licenseKey, { type: 'license-status-changed', licenseStatus: status });

                            // Broadcast settings update to clear "Pending Verification" on all terminals
                            if (sDoc) {
                                broadcastToLicense(licenseKey, { 
                                    type: 'update', 
                                    store: 'settings', 
                                    data: { ...sDoc, id: sDoc.id || 'global_settings' }, 
                                    timestamp: new Date().toISOString() 
                                });
                            }
                        } catch (err) {
                            console.error('[Hub] Failed to reset to trial:', err);
                            send(ws, { type: 'upgrade_license_result', requestId, success: false, message: 'Server error' });
                        }
                        break;
                    }
                }



                // --------------------------------------------------------
                // delete — remove from MongoDB + broadcast
                // --------------------------------------------------------
                case 'delete': {
                    const { store, data, licenseKey: msgLicense } = msg;
                    const finalLicense = licenseKey !== 'GLOBAL' ? licenseKey : msgLicense;

                    // GUARD: Reject deletes from unconfigured/GLOBAL clients
                    if (!finalLicense || finalLicense === 'GLOBAL') return;

                    if (!store || !data || !data.id) break;

                    const Model = ModelMap[store];
                    if (!Model) break;

                    const finalBranchId = data.branchId || msg.branchId;
                    let query = { licenseKey: finalLicense };
                    if (finalBranchId) query.branchId = finalBranchId;

                    if (store === 'users') {
                        query.userId = data.id;
                    } else if (store === 'products') {
                        query.productId = data.id;
                    } else if (store === 'branches') {
                        query.branchId = data.id;
                    } else {
                        query.id = data.id;
                    }

                    try {
                        console.log(`[Hub] [SYNC-DEBUG] Delete Request — Store: "${store}", ID: "${data.id}"`);

                        // ── DB-AGNOSTIC DELETE: Works for both MongoDB and PostgreSQL ──
                        // Build the lookup query based on store-specific ID field
                        let deleteQuery = { licenseKey: finalLicense };
                        // We do NOT inject branchId for deletes. The primary ID (like productId)
                        // is unique per license, and enforcing branchId causes deletes to fail
                        // for globally seeded items that don't have a branchId.

                        if (store === 'products')  deleteQuery.productId  = data.id;
                        else if (store === 'branches')  deleteQuery.branchId   = data.id;
                        else if (store === 'registers') deleteQuery.registerId  = data.id;
                        else if (store === 'users')     deleteQuery.userId      = data.id;
                        else                            deleteQuery.id          = data.id;

                        const delResult = await DBManager.deleteOne(Model, store, deleteQuery);
                        console.log(`[Hub] DELETE SUCCESS — Store: ${store}, ID: ${data.id}, Removed: ${delResult.deletedCount}`);

                        // Broadcast the delete to all other clients on this license
                        broadcastToLicense(finalLicense, {
                            type: 'delete',
                            store,
                            data: { id: data.id },
                            timestamp: new Date().toISOString()
                        }, ws);

                        // Acknowledge back to the sender
                        send(ws, {
                            type: 'sync_ack',
                            store,
                            id: data.id,
                            timestamp: new Date().toISOString()
                        });
                    } catch (err) {
                        console.error(`[Hub] 🔴 Failed to delete ${store}:`, err.message);
                    }
                    break;
                }


                // --------------------------------------------------------
                // pos_get_login_data — users / branches / registers
                // --------------------------------------------------------
                case 'pos_get_login_data': {
                    const status = await getLicenseStatus(licenseKey);
                    if (status.isSuspended) return send(ws, { type: 'pos_login_data', requestId: msg.requestId, success: false, message: 'ACCOUNT SUSPENDED: Contact Zeinfotech Support' });
                    const [users, branches, registers] = await Promise.all([
                        DBManager.find(User, 'users', { licenseKey }),
                        DBManager.find(Branch, 'branches', { licenseKey }),
                        DBManager.find(Register, 'registers', { licenseKey })
                    ]);

                    send(ws, {
                        type: 'pos_login_data',
                        requestId: msg.requestId,
                        success: true,
                        users: users.map(u => ({ ...u, id: u.userId })),
                        branches: branches.map(b => ({ ...b, id: b.branchId })),
                        registers: registers.map(r => ({ ...r, id: r.registerId }))
                    });
                    break;
                }

                // --------------------------------------------------------
                // pos_verify_credentials — login pin/password check
                // --------------------------------------------------------
                case 'pos_verify_credentials': {
                    const { username, password, requestId, systemDetails } = msg;

                    if (typeof username !== 'string' || typeof password !== 'string') {
                        return send(ws, { type: 'pos_verify_result', requestId, success: false, message: 'Invalid credentials format' });
                    }

                    // 1. Check User in MongoDB
                    const user = await DBManager.findOne(User, 'users', {
                        $or: [
                            { username }, 
                            { email: username },
                            { name: username }
                        ]
                    });

                    if (!user) {
                        return send(ws, { type: 'pos_verify_result', requestId, success: false, message: 'User not found' });
                    }

                    // 2. CHECK LICENSE STATUS FOR THIS SPECIFIC USER
                    const status = await getLicenseStatus(user.licenseKey);
                    if (status.isSuspended) {
                        console.log(`[Hub] 🔒 Verification REJECTED (Suspended License: ${user.licenseKey}): ${username}`);
                        return send(ws, { 
                            type: 'pos_verify_result', 
                            requestId, 
                            success: false, 
                            message: 'ACCOUNT SUSPENDED: Contact Zeinfotech Support' 
                        });
                    }

                    if (!user) {
                        send(ws, { type: 'pos_verify_result', requestId, success: false, message: 'User not found' });
                        break;
                    }

                    // CHECK ACTIVE STATUS
                    if (user.isActive === false) {
                        send(ws, { 
                            type: 'pos_verify_result', 
                            requestId, 
                            success: false, 
                            message: 'Account deactivated. Please contact administrator.' 
                        });
                        break;
                    }

                    // CHECK LOCKOUT
                    if (user.lockUntil && user.lockUntil > new Date()) {
                        const remaining = Math.ceil((user.lockUntil - new Date()) / 60000);
                        send(ws, {
                            type: 'pos_verify_result',
                            requestId,
                            success: false,
                            message: `Account locked. Please try again in ${remaining} minutes or reset your password.`
                        });
                        break;
                    }

                    const isValid = user.pin === password || verifyPasswordHash(password, user.passwordHash);

                    if (isValid) {
                        // Reset failed attempts on success
                        user.failedLoginAttempts = 0;
                        user.lockUntil = null;
                        await DBManager.upsert(User, 'users', { userId: user.userId, licenseKey: user.licenseKey }, user);

                        let userLicenseKey = user.licenseKey;
                        const status = await getLicenseStatus(userLicenseKey);
                        const userLimit = status.userLimit || 1;

                        // ENFORCEMENT: Check if this user is beyond the license limit
                        // We fetch all users for this license, sorted by creation, to determine rank
                        const allUsers = await DBManager.find(User, 'users', { licenseKey: userLicenseKey }, { sort: { createdAt: 1 } });
                        const userIndex = allUsers.findIndex(u => u.userId === user.userId);

                        // Master role is exempt from capacity checks
                        if (user.role !== 'Master' && userIndex >= userLimit) {
                            console.log(`[Hub] Login BLOCKED for ${username}: User limit exceeded (${userIndex + 1}/${userLimit})`);
                            send(ws, {
                                type: 'pos_verify_result',
                                requestId,
                                success: false,
                                message: `Staff account restricted. This account exceeds your current license limit (${userLimit} User${userLimit > 1 ? 's' : ''}). Please upgrade your plan.`
                            });
                            break;
                        }

                        // RECORD LOGIN ACTIVITY (Added for Step 3)
                        try {
                            const details = systemDetails || {};
                            // See the identical comment on the pos_log_login_activity handler
                            // below: DBManager.insert() upserts on a derived id that falls
                            // back to userId, so without an explicit per-event id this
                            // silently overwrote the same user's one login-activity row
                            // every time instead of appending a new one.
                            await DBManager.insert(LoginActivity, 'login_activities', {
                                id: 'LA-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                                licenseKey: userLicenseKey, // Use userLicenseKey as finalLicense
                                userId: user.userId || user.id,
                                userName: user.name,
                                role: user.role,
                                timestamp: new Date(),
                                ip: ws._ip?.replace('::ffff:', ''),
                                userAgent: details.userAgent,
                                deviceType: details.deviceType || 'Unknown',
                                browser: details.browser,
                                os: details.os,
                                registerId: details.registerId,
                                registerName: details.registerName
                            });
                        } catch (logErr) {
                            console.error('[Hub] ❌ Failed to log activity:', logErr.message);
                        }

                        console.log(`[Hub] Login successful: ${username} (${userLicenseKey})`);

                        // Hub is authoritative—always use the key assigned to the user
                        // even if the license record is missing or shows trial status
                        const License = require('./models/License');
                        const licenseRecord = await DBManager.findOne(License, 'licenses', { licenseKey: userLicenseKey });
                        
                        let branches = [];
                        let registers = [];
                        let settings = [];

                        if (licenseRecord) {
                            branches = await DBManager.find(Branch, 'branches', { licenseKey: userLicenseKey });
                            registers = await DBManager.find(Register, 'registers', { licenseKey: userLicenseKey });
                            settings = await DBManager.find(Setting, 'settings', { licenseKey: userLicenseKey });
                        } else {
                            console.log(`[Hub] ⚠️ Missing license record for ${userLicenseKey}. Applying default trial status.`);
                        }

                        // Filter based on user's assigned branches
                        if (user.role !== 'Admin' && user.role !== 'Master' && user.branchIds && user.branchIds.length > 0) {
                            branches = branches.filter(b => user.branchIds.includes(b.branchId));
                            registers = registers.filter(r => user.branchIds.includes(r.branchId));
                        }

                        const branchLimit = status.branchLimit || 1;
                        const userRegLimit = branchLimit * 3;

                        // Authoritative Filtering: Stop users from seeing data exceeding their current tier
                        if (branches.length > branchLimit) {
                            console.log(`[Hub] Filtering branches for ${userLicenseKey}: ${branches.length} -> ${branchLimit}`);
                            branches = branches.slice(0, branchLimit);
                        }
                        if (registers.length > userRegLimit) {
                            registers = registers.slice(0, userRegLimit);
                        }

                        send(ws, {
                            type: 'pos_verify_result',
                            requestId,
                            success: true,
                            message: 'Login successful',
                            user: { ...user, id: user.userId },
                            licenseKey: userLicenseKey,
                            networkId: userLicenseKey,
                            branches: branches.map(b => ({ ...b, id: b.branchId })),
                            registers: registers.map(r => ({ ...r, id: r.registerId })),
                            settings, // Include settings in login response
                            licenseStatus: status
                        });

                        // PERSIST LICENSE FOR THIS CONNECTION
                        ws._licenseKey = userLicenseKey;
                    } else {
                        // Track failed attempt
                        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
                        let message = 'Invalid email or password';

                        if (user.failedLoginAttempts >= 5) {
                            user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
                            message = 'Too many failed attempts. Account locked for 15 minutes.';
                        } else {
                            const remaining = 5 - user.failedLoginAttempts;
                            message += `. ${remaining} attempts remaining before lockout.`;
                        }

                        await DBManager.upsert(User, 'users', { userId: user.userId, licenseKey: user.licenseKey }, user);
                        send(ws, { type: 'pos_verify_result', requestId, success: false, message });
                    }
                    break;
                }

                // Standalone/Electron logins verify credentials locally (src/services/
                // syncEngine.js verifyCredentials()) and never reach pos_verify_credentials
                // above, so they'd otherwise never get recorded here — lets the client tell
                // the hub a local login just succeeded, without re-sending the password.
                case 'pos_log_login_activity': {
                    if (!licenseKey) break;
                    const { userId, userName, role, systemDetails, registerId, registerName } = msg;
                    try {
                        const details = systemDetails || {};
                        // DBManager.insert() derives its upsert key as
                        // `data.id || data.productId || data.userId || ...` (dbManager.js)
                        // — fine for "one record per entity" stores (products, registers),
                        // but Login Activity is an append-only audit trail: one user logs
                        // in many times. Without an explicit, per-event `id` here, the
                        // derivation fell through to `userId`, so every login for the same
                        // user upserted (overwrote) that user's ONE existing row instead of
                        // adding a new one — only ever the most recent login ever showed up.
                        await DBManager.insert(LoginActivity, 'login_activities', {
                            id: 'LA-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                            licenseKey,
                            userId,
                            userName,
                            role,
                            timestamp: new Date(),
                            ip: ws._ip?.replace('::ffff:', ''),
                            userAgent: details.userAgent,
                            deviceType: details.deviceType || 'Unknown',
                            browser: details.browser,
                            os: details.os,
                            registerId: registerId || details.registerId,
                            registerName: registerName || details.registerName
                        });
                    } catch (logErr) {
                        console.error('[Hub] ❌ Failed to log activity (standalone):', logErr.message);
                    }
                    break;
                }

                // --------------------------------------------------------
                // pos_check_active_session — enforce one-register-at-a-time
                // per user. Called right before finalizeLogin() commits to a
                // register, so a rejected login never touches the other
                // register's live session.
                // --------------------------------------------------------
                case 'pos_check_active_session': {
                    const { requestId, userId, registerId, registerName, branchId, branchName } = msg;
                    if (!userId) {
                        send(ws, { type: 'pos_active_session_result', requestId, allowed: true });
                        break;
                    }

                    // Keyed by userId alone, NOT licenseKey — two clients of the
                    // same standalone shop can legitimately register under
                    // different licenseKey values (see the standalone hub
                    // identity notes elsewhere in this file), so partitioning by
                    // licenseKey too made the same user on two registers never
                    // collide, silently defeating this whole check.
                    const key = String(userId);
                    const existing = activeUserSessions.get(key);
                    const staleOrSameRegister = !existing
                        || existing.ws === ws
                        || existing.ws.readyState !== WebSocket.OPEN
                        || existing.registerId === registerId;

                    console.log(`[Hub][ActiveSession] check user=${userId} register=${registerId} existing=${existing ? `${existing.registerId} (open=${existing.ws.readyState === WebSocket.OPEN})` : 'none'} -> ${staleOrSameRegister ? 'allow' : 'BLOCK'}`);

                    if (!staleOrSameRegister) {
                        send(ws, {
                            type: 'pos_active_session_result',
                            requestId,
                            allowed: false,
                            message: `This user is already logged in on Register "${existing.registerName || existing.registerId || 'another device'}". Please log out there first.`
                        });
                        break;
                    }

                    activeUserSessions.set(key, { ws, registerId, registerName, branchId, branchName, loginAt: new Date() });
                    ws._activeSessionKey = key;
                    send(ws, { type: 'pos_active_session_result', requestId, allowed: true });
                    break;
                }

                // --------------------------------------------------------
                // pos_logout_session — frees this user's active-session slot
                // immediately on manual logout (see window.logout in main.js),
                // instead of waiting for the ws.on('close') cleanup below.
                // --------------------------------------------------------
                case 'pos_logout_session': {
                    const { userId } = msg;
                    if (!userId) break;
                    const key = String(userId);
                    if (activeUserSessions.get(key)?.ws === ws) {
                        activeUserSessions.delete(key);
                        console.log(`[Hub][ActiveSession] freed user=${userId} (explicit logout)`);
                    }
                    break;
                }

                case 'pos_get_login_activities': {
                    const { requestId, limit = 100 } = msg;
                    if (!licenseKey) break;

                    try {
                        const logs = await DBManager.find(LoginActivity, 'login_activities', { licenseKey }, { sort: { timestamp: -1 }, limit: limit });
                        send(ws, { type: 'pos_login_activities_result', requestId, success: true, logs });
                    } catch (err) {
                        send(ws, { type: 'pos_login_activities_result', requestId, success: false, message: err.message });
                    }
                    break;
                }

                // --------------------------------------------------------
                // pos_check_availability — username / email check
                // --------------------------------------------------------
                case 'pos_check_availability': {
                    const { username, email, requestId } = msg;
                    if ((username != null && typeof username !== 'string') || (email != null && typeof email !== 'string')) {
                        send(ws, { type: 'pos_check_result', requestId, usernameAvailable: false, emailAvailable: false });
                        break;
                    }
                    // Check if any user already has this 'username' or 'email'
                    const checkValue = username || email;
                    const [byUser, byLicense] = await Promise.all([
                        checkValue ? DBManager.findOne(User, 'users', { $or: [{ username: checkValue }, { email: checkValue }] }) : null,
                        email ? DBManager.findOne(License, 'licenses', { email }) : null
                    ]);
                    send(ws, {
                        type: 'pos_check_result',
                        requestId,
                        usernameAvailable: !byUser, // 'usernameAvailable' here means "available for use as a login identifier"
                        emailAvailable: !byLicense
                    });
                    break;
                }


                // --------------------------------------------------------
                // verify_license — check license exists in DB
                // --------------------------------------------------------
                case 'verify_license': {
                    const keyToVerify = msg.licenseKey;
                    const exists = keyToVerify ? await DBManager.findOne(License, 'licenses', { licenseKey: keyToVerify }) : null;
                    send(ws, {
                        type: 'verify_license_result',
                        requestId: msg.requestId,
                        success: !!exists,
                        licenseKey: keyToVerify,
                        message: exists ? 'License valid' : 'License not found'
                    });
                    break;
                }

                // --------------------------------------------------------
                // Peripheral stubs (ADB)
                // --------------------------------------------------------
                case 'get_adb_status':
                    send(ws, { type: 'adb_status', status: 'disconnected' });
                    break;

                // --------------------------------------------------------
                // ONBOARDING HANDLERS (Database-First)
                // --------------------------------------------------------

                case 'pos_load_sample_data': {
                    const { licenseKey, businessType, requestId } = msg;
                    console.log(`[Hub] 📦 Setup Request: pos_load_sample_data for ${licenseKey} (Type: ${businessType})`);

                    // Update license status
                    await DBManager.updateMany(License, 'licenses', { licenseKey }, { businessType, status: 'active' });

                    // Update Settings features based on industry
                    const features = {
                        hasAppointments: businessType === 'Saloon'
                    };
                    await DBManager.updateMany(Setting, 'settings', { licenseKey }, { businessType, features, updatedAt: new Date() });

                    const products = getSampleProducts(businessType);

                    // 1. Prepare for Product collection (Dedicated)
                    const productDocs = products.map(p => ({
                        licenseKey,
                        branchId: 'b1',
                        productId: String(p.id),
                        name: p.name,
                        emoji: p.emoji,
                        price: p.price,
                        category: p.category,
                        stock: p.stock,
                        updatedAt: new Date()
                    }));

                    for (const doc of productDocs) {
                        await DBManager.upsert(Product, 'products', { productId: doc.productId, licenseKey }, doc);
                    }

                    console.log(`[Hub] ✅ Loaded ${productDocs.length} sample products into Products collection for ${licenseKey}`);

                    send(ws, { type: 'pos_setup_result', requestId, success: true });
                    break;
                }

                // ─────────────────────────────────────────────────────────────────
                // pos_backup_data — Export all data for this license as JSON
                // Works for both MongoDB and PostgreSQL
                // ─────────────────────────────────────────────────────────────────
                case 'pos_backup_data': {
                    const { requestId } = msg;
                    if (!licenseKey || licenseKey === 'GLOBAL') {
                        send(ws, { type: 'pos_backup_result', requestId, success: false, message: 'License key required for backup' });
                        break;
                    }
                    console.log(`[Hub] 💾 Backup requested for: ${licenseKey}`);
                    try {
                        const backup = await DBManager.exportAll(ModelMap, licenseKey);

                        // Log to backup_history
                        const totalRecords = Object.values(backup.stores).reduce((sum, arr) => sum + (arr.length || 0), 0);
                        await DBManager.insert(Record, 'backup_history', {
                            licenseKey,
                            type: 'manual',
                            exportedAt: backup.exportedAt,
                            totalRecords,
                            stores: Object.keys(backup.stores).length
                        });

                        send(ws, {
                            type: 'pos_backup_result',
                            requestId,
                            success: true,
                            backup,
                            totalRecords,
                            message: `Backup complete — ${totalRecords} records exported`
                        });
                        console.log(`[Hub] ✅ Backup sent — ${totalRecords} total records for ${licenseKey}`);
                    } catch (err) {
                        console.error('[Hub] Backup failed:', err.message);
                        send(ws, { type: 'pos_backup_result', requestId, success: false, message: err.message });
                    }
                    break;
                }

                // ─────────────────────────────────────────────────────────────────
                // pos_restore_data — Import a backup blob back into the database
                // Works for both MongoDB and PostgreSQL
                // ─────────────────────────────────────────────────────────────────
                case 'pos_restore_data': {
                    const { requestId, backup, wipe = false } = msg;
                    if (!backup || !backup.licenseKey || !backup.stores) {
                        send(ws, { type: 'pos_restore_result', requestId, success: false, message: 'Invalid backup data' });
                        break;
                    }
                    // Only allow restoring to the same license
                    if (backup.licenseKey !== licenseKey) {
                        send(ws, { type: 'pos_restore_result', requestId, success: false, message: 'License key mismatch' });
                        break;
                    }
                    console.log(`[Hub] 🔄 Restore requested for: ${licenseKey} (wipe=${wipe})`);
                    try {
                        const results = await DBManager.importAll(ModelMap, backup, wipe);
                        const totalImported = Object.values(results).reduce((sum, r) => sum + (r.imported || 0), 0);

                        // Broadcast refresh to all connected clients
                        broadcastToLicense(licenseKey, {
                            type: 'pos_data_restored',
                            licenseKey,
                            timestamp: new Date().toISOString()
                        });

                        send(ws, {
                            type: 'pos_restore_result',
                            requestId,
                            success: true,
                            results,
                            totalImported,
                            message: `Restore complete — ${totalImported} records imported`
                        });
                        console.log(`[Hub] ✅ Restore complete — ${totalImported} records for ${licenseKey}`);
                    } catch (err) {
                        console.error('[Hub] Restore failed:', err.message);
                        send(ws, { type: 'pos_restore_result', requestId, success: false, message: err.message });
                    }
                    break;
                }

                default:
                    console.log(`[Hub] Unhandled message type: ${type}`);
            }

        } catch (err) {
            console.error(`[Hub] Error handling "${type}":`, err.message);
            send(ws, { type: 'error', message: `Server error: ${err.message}` });
        }
    });

    ws.on('close', () => {
        unregisterClient(ws);
        if (ws._activeSessionKey && activeUserSessions.get(ws._activeSessionKey)?.ws === ws) {
            activeUserSessions.delete(ws._activeSessionKey);
        }
        console.log(`[Hub] Client disconnected. Remaining: ${wss.clients.size}`);
    });

    ws.on('error', (err) => {
        console.error('[Hub] WebSocket error:', err.message);
    });
});

// Periodic heartbeat to clean up stale connections (every 30 seconds)
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
            console.log(`[Hub] Terminating stale connection: ${ws._licenseKey} (${ws._clientType || 'unknown'})`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

// ============================================================
// Start everything
// ============================================================
// Without this, a bind failure (most commonly EADDRINUSE from an orphaned
// previous instance still holding the port) is an unhandled 'error' event on
// the server's EventEmitter — Node treats that as an uncaught exception and
// kills this process immediately, with nothing communicating WHY to the
// Electron parent, which just sees the child exit and never explains it to
// the user (main.cjs's waitForServer eventually times out after 30s, but
// only if it's also taught to surface that failure — see its call site).
server.on('error', (err) => {
    console.error(`[Server] Failed to bind to port ${PORT}:`, err.code, err.message);
    process.exit(1);
});

connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 POS Sync Hub running on ws://localhost:${PORT}`);
        console.log(`   Health: http://localhost:${PORT}/health`);
        console.log(`   Database: MongoDB [${MONGODB_MODE}] (${MONGODB_URI?.replace(/:([^@]+)@/, ':****@')})`);
    });
});
