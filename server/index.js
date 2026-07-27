// ============================================================
// POS Sync Hub — index.js
// Pure WebSocket (ws) + MongoDB/Mongoose backend (port 3030)
// Compatible with syncEngine.js which uses raw new WebSocket(url)
// ============================================================

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Force Node.js to use Google DNS — bypasses ISP DNS that blocks SRV record queries
// needed for mongodb+srv:// Atlas connection strings
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const mongoose = require('mongoose');
const crypto = require('crypto');
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
    'import_tracker': Record,
    'backup_history': Record,
    'import_history': Record,
    'categories': Record,
    'sub_categories': Record,
    'admins': Admin,
    'upgrade_keys': UpgradeKey
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

// pos-lite is local-only: no second Atlas connection. Upgrade Key / Lifetime
// activation redemption was removed from the client entirely, so there's no
// remaining reason for this server to ever reach outside localhost MongoDB.
function getCloudLicenseModels() {
    return { UpgradeKeyModel: UpgradeKey, LicenseModel: License };
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
        const adminCount = await Admin.countDocuments();
        if (adminCount === 0) {
            await Admin.create({ username: 'admin', password: 'zei12345', fullName: 'Zeinfotech Administrator' });
            console.log('✅ Admin collection seeded with default record');
        }
    } catch (err) {
        isDbConnected = false;
        console.error('❌ MongoDB connection failed:', err.message);
        setTimeout(connectDB, 5000);
    }
}

// ============================================================
// HTTP Server + WebSocket Server
// ============================================================

async function checkAdminAuth(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) { res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' })); return false; }
    try {
        const decoded = Buffer.from(token, 'base64').toString();
        const [username, password] = decoded.split(':');
        if (!username || !password) throw new Error('Invalid token');
        
        const admin = await DBManager.findOne(Admin, 'admins', { username, password });
        if (admin) return true;
    } catch (e) {}
    res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
}

const server = http.createServer(async (req, res) => {
    // 1. GLOBAL CORS HEADERS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

    // Standalone Registration: Called after onboarding to persist the admin
    // (+ branch + register) in the local Mongo hub — so other LAN devices
    // linking to this shop can see them, AND so login can still
    // succeed with a full branch/register list via the HTTP fallback
    // (syncEngine.verifyCredentials) if this terminal's own IndexedDB is ever wiped.
    if (req.url === '/api/standalone-register' && req.method === 'POST') {
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
                
                // MIRROR: pos_verify_credentials logic (pin, password, or passwordHash)
                const isValid = user.pin === password || user.password === password || user.passwordHash === password;
                
                if (!isValid) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Invalid password' }));
                }

                const status = await getLicenseStatus(user.licenseKey);
                if (status.isSuspended) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'ACCOUNT SUSPENDED' }));
                }

                const branches = (await DBManager.find(Branch, 'branches', { licenseKey: user.licenseKey })).map(b => {
                    const obj = b;
                    return { ...obj, id: obj.branchId || obj._id?.toString() };
                });
                const registers = (await DBManager.find(Register, 'registers', { licenseKey: user.licenseKey })).map(r => {
                    const obj = r;
                    return { ...obj, id: obj.registerId || obj._id?.toString() };
                });
                
                const settings = await DBManager.find(Setting, 'settings', { licenseKey: user.licenseKey });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    user: { id: user._id, username: user.username, email: user.email, role: user.role, licenseKey: user.licenseKey, branchId: user.branchId, name: user.name },
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

                    if (req.url === '/admin') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head>
    <title>Zeinfotech | Admin Control Panel</title>
    <style>
        :root {
            --primary: #2563eb; --primary-hover: #1d4ed8; --bg: #f8fafc;
            --sidebar-bg: #1e293b; --text-main: #0f172a; --text-muted: #64748b;
        }
        body { font-family: 'Inter', sans-serif; background: var(--bg); margin: 0; display: flex; height: 100vh; overflow: hidden; }
        
        .sidebar { width: 260px; background: var(--sidebar-bg); color: white; display: flex; flex-direction: column; }
        .sidebar-header { padding: 32px 24px; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .sidebar-header h1 { margin: 0; font-size: 20px; font-weight: 800; }
        .nav-links { flex: 1; padding: 24px 12px; }
        .nav-item { 
            display: flex; align-items: center; padding: 12px 16px; margin-bottom: 4px; border-radius: 8px;
            color: #cbd5e1; text-decoration: none; font-weight: 500; transition: all 0.2s; cursor: pointer;
        }
        .nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
        .nav-item.active { background: var(--primary); color: white; }
        .logout-btn { padding: 24px; border-top: 1px solid rgba(255,255,255,0.1); color: #f87171; cursor: pointer; font-weight: 600; text-align: center; }

        .main-content { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
        .top-bar { height: 72px; background: white; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; padding: 0 40px; }
        .view-section { padding: 40px; display: none; }
        .view-section.active { display: block; }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px; margin-bottom: 40px; }
        .stat-card { background: white; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0; }
        .stat-label { color: var(--text-muted); font-size: 13px; margin-bottom: 8px; font-weight: 600; }
        .stat-value { font-size: 26px; font-weight: 800; color: var(--text-main); }

        .card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; text-align: left; }
        th { background: #f8fafc; padding: 16px 24px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid #e2e8f0; }
        td { padding: 16px 24px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        .badge { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
        .badge-pending { background: #fef3c7; color: #d97706; }
        .badge-premium { background: #dcfce7; color: #15803d; }
        .badge-inactive { background: #fee2e2; color: #991b1b; }
        
        .btn { padding: 8px 16px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 13px; }
        .btn-blue { background: var(--primary); color: white; }
        .btn-red { background: #ef4444; color: white; }
        .btn-green { background: #10b981; color: white; }
        
        .login-overlay { position: fixed; inset: 0; background: #0f172a; display: flex; align-items: center; justify-content: center; z-index: 9999; }
        .login-card { background: white; padding: 48px; border-radius: 24px; width: 100%; max-width: 440px; }
        .login-card input, .form-card input { width: 100%; padding: 12px; border: 1px solid #e2e8f0; border-radius: 12px; margin-top: 8px; box-sizing: border-box; }
        .form-label { display: block; margin-top: 16px; font-size: 14px; font-weight: 600; }

        #modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 10000; align-items: center; justify-content: center; }
        #modal img { max-width: 90%; max-height: 90vh; border-radius: 12px; }

        /* Real-time Pulse Animation */
        @keyframes pulse-highlight {
            0% { transform: scale(1); box-shadow: 0 0 0 rgba(37, 99, 235, 0); }
            50% { transform: scale(1.02); box-shadow: 0 0 20px rgba(37, 99, 235, 0.3); }
            100% { transform: scale(1); box-shadow: 0 0 0 rgba(37, 99, 235, 0); }
        }
        .pulse-now { animation: pulse-highlight 0.8s ease-out; }

        /* Toast Styles */
        #toast-container { position: fixed; top: 24px; right: 24px; z-index: 100000; display: flex; flex-direction: column; gap: 12px; }
        .toast { 
            background: white; border-left: 4px solid var(--primary); padding: 16px 24px; border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 16px;
            min-width: 300px; animation: slide-in 0.3s ease-out;
        }
        @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    </style></head><body>
    <div id="toast-container"></div>

    <div id="loginView" class="login-overlay" style="display:none;">
        <div class="login-card"><h2>Admin Login</h2><form id="loginForm">
            <label class="form-label">Username</label><input type="text" id="username" required />
            <label class="form-label">Password</label><input type="password" id="password" required />
            <button type="submit" class="btn btn-blue" style="width:100%; margin-top:32px; padding:14px;">Log In</button>
        </form><p id="loginErr" style="color:#ef4444; margin-top:20px; text-align:center; display:none;">Invalid credentials</p></div>
    </div>

    <div id="adminPanel" style="display:flex; width:100%;">
        <nav class="sidebar">
            <div class="sidebar-header"><h1>Zeinfotech</h1></div>
            <div class="nav-links">
                <div class="nav-item active" onclick="showTab('dashboard')">Dashboard</div>
                <div class="nav-item" onclick="showTab('subscriptions')">Subscriptions</div>
                <div class="nav-item" onclick="showTab('licenses')">Licenses</div>
                <div class="nav-item" onclick="showTab('upgradeKeys')">Upgrade Keys</div>
                <div class="nav-item" onclick="showTab('admins')">Admin Users</div>
            </div>
            <div class="logout-btn" onclick="logout()">Sign Out</div>
        </nav>
        <main class="main-content">
            <header class="top-bar"><h2 id="viewTitle" style="margin:0; font-weight:800;">Dashboard</h2></header>

            <section id="view-dashboard" class="view-section active">
                <div class="stats-grid" style="margin-bottom:32px;">
                    <div class="stat-card" style="background: #eff6ff; border-color: #bfdbfe;"><div class="stat-label">Total Revenue</div><div id="stat-revenue" class="stat-value" style="color:#1e40af">₹0</div></div>
                    <div class="stat-card" style="cursor:pointer" title="View all stores" onclick="document.querySelector('.nav-item[onclick*=licenses]').click()"><div class="stat-label">Total Stores</div><div id="stat-stores" class="stat-value">0</div></div>
                    <div class="stat-card"><div class="stat-label">Active Licenses</div><div id="stat-licenses" class="stat-value">0</div></div>
                    <div class="stat-card"><div class="stat-label">Pending Req.</div><div id="stat-pending" class="stat-value">0</div></div>
                </div>

                <div class="card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3 style="margin:0; font-weight:800; font-size:18px;">Business Performance Hub</h3>
                        <div style="font-size:12px; color:var(--text-muted);"><i class="fa-solid fa-circle-info mr-6"></i> Tracking <b>Revenue</b> and <b>Branch Activity</b> across the network.</div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Store / Business</th>
                                <th style="text-align:center;">Branches</th>
                                <th style="text-align:center;">Orders</th>
                                <th style="text-align:right;">Total Revenue</th>
                                <th style="text-align:center;">Status</th>
                                <th style="text-align:center;">Sync</th>
                            </tr>
                        </thead>
                        <tbody id="performanceBody">
                            <tr><td colspan="6" style="text-align:center; padding:40px;">Generating detailed report...</td></tr>
                        </tbody>
                    </table>
                </div>
            </section>

            <section id="view-subscriptions" class="view-section">
                <div class="card" style="overflow-x:auto;"><table><thead><tr><th>Store</th><th>Plan</th><th>Amount</th><th>Receipt</th><th>Action</th></tr></thead><tbody id="subBody"></tbody></table></div>
            </section>

            <section id="view-licenses" class="view-section">
                <div class="card" style="overflow-x:auto;"><table><thead><tr><th>Store</th><th>Key</th><th>Status</th><th>Expiry</th><th>Branches</th><th>Actions</th></tr></thead><tbody id="licBody"></tbody></table></div>
            </section>

            <section id="view-upgradeKeys" class="view-section">
                <div style="display:grid; grid-template-columns: minmax(0,2fr) minmax(0,1fr); gap:24px; align-items:start;">
                    <div class="card" style="overflow-x:auto; min-width:0;"><table style="min-width:900px;"><thead><tr><th>Key</th><th>Plan</th><th>Uses</th><th>Bound To</th><th>Issued To</th><th>Redeemed By</th><th>Status</th><th>Actions</th></tr></thead><tbody id="upgradeKeysBody"></tbody></table></div>
                    <div class="card" style="padding:24px;">
                        <h4 style="margin:0;">Generate Upgrade Key</h4>
                        <form id="generateKeyForm">
                            <label class="form-label">Plan</label>
                            <select id="gk_plan" class="form-select" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px;">
                                <option value="monthly">Monthly</option>
                                <option value="biannual">Biannual (6 months)</option>
                                <option value="annual">Annual</option>
                                <option value="lifetime">Lifetime (device-locked)</option>
                            </select>
                            <label class="form-label">Max Uses</label>
                            <input type="number" id="gk_maxUses" value="1" min="1" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px; box-sizing:border-box;" />
                            <label class="form-label">Bind to License Key (optional)</label>
                            <input type="text" id="gk_boundLicenseKey" placeholder="e.g. POS-SATH-BKH8" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px; box-sizing:border-box;" />
                            <label class="form-label">Branch Limit (optional)</label>
                            <input type="number" id="gk_branchLimit" min="1" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px; box-sizing:border-box;" />
                            <label class="form-label">User Limit (optional)</label>
                            <input type="number" id="gk_userLimit" min="1" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px; box-sizing:border-box;" />
                            <hr style="margin:16px 0; border-color:#e5e7eb;" />
                            <div style="font-size:12px; font-weight:700; color:#64748b; margin-bottom:10px;">WHO IS THIS KEY FOR? (optional — identifies the buyer, and if phone/email is set, they must confirm it to redeem)</div>
                            <label class="form-label">Shop Name</label>
                            <input type="text" id="gk_shopName" placeholder="e.g. Sri Ganesh Store" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px; box-sizing:border-box;" />
                            <label class="form-label">Phone Number</label>
                            <input type="text" id="gk_phone" placeholder="e.g. 9876543210" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px; box-sizing:border-box;" />
                            <label class="form-label">Email</label>
                            <input type="email" id="gk_email" placeholder="e.g. owner@shop.com" style="width:100%; padding:10px; border-radius:8px; border:1px solid #d1d5db; margin-bottom:12px; box-sizing:border-box;" />
                            <button type="submit" class="btn btn-blue" style="width:100%; margin-top:8px;">Generate Key</button>
                        </form>
                        <div id="generatedKeyResult" style="margin-top:16px; display:none; padding:14px; background:#f0fdf4; border:1px dashed #86efac; border-radius:10px; word-break:break-all; font-weight:700; color:#15803d;"></div>
                    </div>
                </div>
            </section>

            <section id="view-admins" class="view-section">
                <div style="display:grid; grid-template-columns: 2fr 1fr; gap:24px;">
                    <div class="card" style="overflow-x:auto;"><table><thead><tr><th>User</th><th>Full Name</th><th>Actions</th></tr></thead><tbody id="adminUsersBody"></tbody></table></div>
                    <div class="card" style="padding:24px;">
                        <h4 style="margin:0;">Add New Admin</h4>
                        <form id="addAdminForm">
                            <label class="form-label">Username</label><input type="text" id="new_user" required />
                            <label class="form-label">Password</label><input type="password" id="new_pass" required />
                            <label class="form-label">Full Name</label><input type="text" id="new_name" />
                            <button type="submit" class="btn btn-blue" style="width:100%; margin-top:20px;">Create Admin</button>
                        </form>
                    </div>
                </div>
            </section>
        </main>
    </div>

    <div id="modal"><button onclick="document.getElementById('modal').style.display='none'" style="position:absolute;top:20px;right:20px;padding:10px;cursor:pointer;">Close</button><img id="modalImg" src="" /></div>


    <!-- Delete Confirmation Modal -->
    <div id="deleteModal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:20000; align-items:center; justify-content:center; padding:20px;">
        <div class="card" style="max-width:440px; padding:32px; border: 2px solid #ef4444;">
            <h2 style="margin:0; color:#ef4444;">DANGER ZONE</h2>
            <p style="margin:16px 0; color:var(--text-main); font-weight:600;">You are about to PERMANENTLY WIPE this record and all associated orders/data.</p>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:24px;">This action is irreversible. To confirm, please type the license key below:</p>
            
            <input type="text" id="confirmDeleteKey" placeholder="Type key here..." style="width:100%; padding:12px; border:1px solid #d1d5db; border-radius:8px; margin-bottom:24px; box-sizing:border-box;" />
            
            <div style="display:flex; gap:12px;">
                <button class="btn" style="flex:1; background:#94a3b8; color:white;" onclick="closeDeleteModal()">Cancel</button>
                <button id="finalDeleteBtn" class="btn btn-red" style="flex:1; opacity:0.5; cursor:not-allowed;" disabled onclick="executeHardDelete()">Hard Delete</button>
            </div>
        </div>
    </div>

    <script>
        const getHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('zeiAdminToken') });
        async function api(url, options = {}) {
            const res = await fetch(url, { ...options, headers: { ...getHeaders(), ...(options.headers || {}) } });
            if (res.status === 401) { window.logout(); return null; }
            return res.json();
        }

        function showTab(tabId) {
            document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.getElementById('view-' + tabId).classList.add('active');
            event.currentTarget.classList.add('active');
            document.getElementById('viewTitle').innerText = tabId.charAt(0).toUpperCase() + tabId.slice(1);
            loadTabData(tabId);
        }

        async function loadTabData(tabId) {
            if (tabId === 'dashboard') {
                const d = await api('/api/admin/metrics'); if(!d) return;
                document.getElementById('stat-revenue').innerText = '₹' + d.totalRevenue.toLocaleString();
                document.getElementById('stat-stores').innerText = d.totalStores;
                document.getElementById('stat-licenses').innerText = d.totalLicenses;
                document.getElementById('stat-pending').innerText = d.pendingRequests;

                // Render Performance breakdown
                const body = document.getElementById('performanceBody');
                if (body && d.storeBreakdown) {
                    body.innerHTML = d.storeBreakdown.map(s => \`
                        <tr>
                            <td>
                                <div style="font-weight:700; color:var(--text-main); font-size:14px;">\${s.name}</div>
                                <div style="font-size:11px; color:var(--text-muted); opacity:0.8;">\${s.licenseKey} · \${s.email}</div>
                            </td>
                            <td style="text-align:center; font-weight:600;">\${s.branches}</td>
                            <td style="text-align:center; color:var(--text-muted);">\${s.orderCount}</td>
                            <td style="text-align:right; font-weight:800; color:var(--primary); font-size:15px;">₹\${s.revenue.toLocaleString()}</td>
                            <td style="text-align:center;">
                                <span class="badge \${s.status === 'inactive' ? 'badge-inactive' : (s.type === 'premium' ? 'badge-premium' : 'badge-trial')}">
                                    \${s.status.toUpperCase()}
                                </span>
                            </td>
                            <td style="text-align:center;">
                                <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
                                    <div style="width:10px; height:10px; border-radius:50%; background:\${s.activeSockets > 0 ? '#10b981' : '#cbd5e1'}; box-shadow:\${s.activeSockets > 0 ? '0 0 8px #10b98180' : 'none'};"></div>
                                    <span style="font-size:11px; font-weight:700; color:\${s.activeSockets > 0 ? '#10b981' : '#64748b'};">\${s.activeSockets > 0 ? 'ONLINE' : 'OFFLINE'}</span>
                                </div>
                            </td>
                        </tr>
                    \`).join('');
                }
            } else if (tabId === 'subscriptions') {
                const d = await api('/api/admin/subscriptions');
                document.getElementById('subBody').innerHTML = d.map(s => {
                    const r = s.subscriptionRequest;
                    return \`<tr><td><b>\${s.branchId}</b><br><small>\${r.email}</small></td><td>\${r.plan}</td><td>₹\${r.amount}</td><td><button class="btn btn-blue" onclick="viewImg('\${r.receiptBase64}')">View</button></td><td><button class="btn btn-green" onclick="approve('\${s.licenseKey}', '\${r.plan}')">Approve</button> <button class="btn btn-red" onclick="reject('\${s.licenseKey}')">Reject</button></td></tr>\`;
                }).join('') || '<tr><td colspan="5" style="text-align:center;padding:40px;">Clean!</td></tr>';
            } else if (tabId === 'licenses') {
                const d = await api('/api/admin/licenses');
                document.getElementById('licBody').innerHTML = d.map(l => {
                  const expiryCell = l.displayExpiryLabel === 'Lifetime'
                    ? '<span style="color:#7c3aed;font-weight:700;">Lifetime</span>'
                    : l.displayExpiry
                      ? new Date(l.displayExpiry).toLocaleDateString() + (l.displayExpiryLabel === 'Trial' ? ' <small style="color:#d97706;">(Trial)</small>' : '')
                      : 'N/A';
                  const isLifetime = l.displayExpiryLabel === 'Lifetime';
                  const branchesCell = isLifetime
                    ? \`<b>\${l.branchLimit ?? 1}</b>\`
                    : \`<div style='display:flex;align-items:center;gap:8px;'><b>\${l.branchLimit ?? 1}</b><button class=\\\"btn\\\" style=\\\"padding:4px 10px;background:#eef2ff;color:#4338ca;\\\" onclick=\\\"editBranchLimit('\${l.licenseKey}', \${l.branchLimit ?? 1})\\\">✏️ Edit</button></div>\`;
                  return \`<tr><td><b>\${l.businessName || 'N/A'}</b><br><small>\${l.email}</small></td><td><code>\${l.licenseKey}</code></td><td><span class=\\\"badge \${l.status === 'inactive' ? 'badge-inactive' : 'badge-premium'}\\\">\${l.status}</span></td><td>\${expiryCell}</td><td>\${branchesCell}</td><td><div style='display:flex;gap:8px;'><button class=\\\"btn \${l.status === 'inactive' ? 'btn-green' : 'btn-red'}\\\" onclick=\\\"toggleStatus('\${l.licenseKey}', '\${l.status}')\\\">\${l.status === 'inactive' ? 'Activate' : 'Deactivate'}</button><button class=\\\"btn\\\" style=\\\"background:#64748b; color:white;\\\" onclick=\\\"openDeleteModal('\${l.licenseKey}', '\${l.businessName}')\\\">🗑️</button></div></td></tr>\`;
                }).join('');
            } else if (tabId === 'admins') {
                const d = await api('/api/admin/accounts');
                document.getElementById('adminUsersBody').innerHTML = d.map(a => \`<tr><td>\${a.username}</td><td>\${a.fullName}</td><td>\${a.username !== 'admin' ? '<button class="btn btn-red" onclick="delAdmin(\\''+a.username+'\\')">Delete</button>' : ''}</td></tr>\`).join('');
            } else if (tabId === 'upgradeKeys') {
                const [d, licenses] = await Promise.all([
                    api('/api/admin/upgrade-keys'),
                    api('/api/admin/licenses').catch(() => [])
                ]);
                const licenseByKey = {};
                (licenses || []).forEach(l => { licenseByKey[l.licenseKey] = l; });
                document.getElementById('upgradeKeysBody').innerHTML = (d || []).map(k => {
                    const statusBadge = k.status === 'active' ? 'badge-premium' : (k.status === 'used' ? 'badge-pending' : 'badge-inactive');
                    const redeemedByCell = (k.redemptions && k.redemptions.length > 0)
                        ? k.redemptions.map(r => {
                            const buyer = licenseByKey[r.licenseKey];
                            const nameLine = buyer ? \`<b>\${buyer.businessName || 'N/A'}</b><br><small>\${buyer.email || ''}</small><br>\` : '';
                            return \`\${nameLine}<code>\${r.licenseKey}</code><br><small style="color:#94a3b8;">\${new Date(r.redeemedAt).toLocaleString()}</small>\`;
                          }).join('<hr style="margin:6px 0;border-color:#e5e7eb;">')
                        : '<i style="color:#94a3b8;">not yet redeemed</i>';
                    const issuedToCell = (k.assignedShopName || k.assignedPhone || k.assignedEmail)
                        ? \`\${k.assignedShopName ? '<b>'+k.assignedShopName+'</b><br>' : ''}\${k.assignedPhone ? '<small>'+k.assignedPhone+'</small><br>' : ''}\${k.assignedEmail ? '<small>'+k.assignedEmail+'</small>' : ''}\`
                        : '<i style="color:#94a3b8;">any</i>';
                    const actionsCell = \`<div style="display:flex;gap:8px;">\${k.status === 'active' ? '<button class="btn btn-red" onclick="revokeUpgradeKey(\\''+k.key+'\\')">Revoke</button>' : ''}<button class="btn" style="background:#64748b;color:white;" onclick="deleteUpgradeKey('\${k.key}')">🗑️ Delete</button></div>\`;
                    return \`<tr><td><code>\${k.key}</code></td><td>\${k.planType}</td><td>\${k.usedCount || 0} / \${k.maxUses}</td><td>\${k.boundLicenseKey || '<i>any</i>'}</td><td>\${issuedToCell}</td><td>\${redeemedByCell}</td><td><span class="badge \${statusBadge}">\${k.status}</span></td><td>\${actionsCell}</td></tr>\`;
                }).join('') || '<tr><td colspan="8" style="text-align:center;padding:40px;">No upgrade keys generated yet.</td></tr>';
            }
        }

        window.toggleStatus = async (licenseKey, current) => {
            const next = current === 'active' ? 'inactive' : 'active';
            if(!confirm('Switch status to ' + next + '?')) return;
            await api('/api/admin/licenses/status', { method:'POST', body:JSON.stringify({licenseKey, status:next}) });
            loadTabData('licenses');
        };

        window.editBranchLimit = async (licenseKey, current) => {
            const input = prompt('New branch limit for ' + licenseKey + ':', current);
            if (input === null) return;
            const newLimit = parseInt(input, 10);
            if (!Number.isFinite(newLimit) || newLimit < 1) return alert('Enter a valid number (1 or more)');
            const res = await api('/api/admin/licenses/branch-limit', { method:'POST', body:JSON.stringify({ licenseKey, branchLimit: newLimit }) });
            if (res && res.success) loadTabData('licenses');
            else alert(res && res.error ? res.error : 'Failed to update branch limit');
        };

        document.getElementById('addAdminForm').onsubmit = async (e) => {
            e.preventDefault();
            const res = await api('/api/admin/accounts/create', { method:'POST', body:JSON.stringify({ username: document.getElementById('new_user').value, password: document.getElementById('new_pass').value, fullName: document.getElementById('new_name').value }) });
            if(res.success) { alert('Admin Created'); e.target.reset(); loadTabData('admins'); } else alert(res.error);
        };

        window.delAdmin = async (username) => { if(confirm('Delete ' + username + '?')) { await api('/api/admin/accounts/delete', { method:'POST', body:JSON.stringify({username}) }); loadTabData('admins'); } };

        // Lifetime keys default to generous limits (5 branches / 5 users) since
        // there's no renewal cycle to revisit them at — admin can still override.
        document.getElementById('gk_plan').onchange = (e) => {
            if (e.target.value === 'lifetime') {
                if (!document.getElementById('gk_branchLimit').value) document.getElementById('gk_branchLimit').value = 5;
                if (!document.getElementById('gk_userLimit').value) document.getElementById('gk_userLimit').value = 5;
            }
        };

        document.getElementById('generateKeyForm').onsubmit = async (e) => {
            e.preventDefault();
            const res = await api('/api/admin/upgrade-keys', { method:'POST', body:JSON.stringify({
                planType: document.getElementById('gk_plan').value,
                maxUses: document.getElementById('gk_maxUses').value,
                boundLicenseKey: document.getElementById('gk_boundLicenseKey').value.trim() || null,
                branchLimit: document.getElementById('gk_branchLimit').value || null,
                userLimit: document.getElementById('gk_userLimit').value || null,
                shopName: document.getElementById('gk_shopName').value.trim() || null,
                phone: document.getElementById('gk_phone').value.trim() || null,
                email: document.getElementById('gk_email').value.trim() || null
            }) });
            if (res && res.success) {
                const box = document.getElementById('generatedKeyResult');
                box.style.display = 'block';
                box.innerText = 'Generated: ' + res.key;
                e.target.reset();
                loadTabData('upgradeKeys');
            } else {
                alert(res && res.error ? res.error : 'Failed to generate key');
            }
        };

        window.revokeUpgradeKey = async (key) => {
            if (!confirm('Revoke key ' + key + '? It will no longer be redeemable.')) return;
            await api('/api/admin/upgrade-keys/revoke', { method:'POST', body:JSON.stringify({ key }) });
            loadTabData('upgradeKeys');
        };

        window.deleteUpgradeKey = async (key) => {
            if (!confirm('Permanently delete key ' + key + '? This cannot be undone.')) return;
            const res = await api('/api/admin/upgrade-keys/delete', { method:'POST', body:JSON.stringify({ key }) });
            if (res && res.success) loadTabData('upgradeKeys');
            else alert(res && res.error ? res.error : 'Failed to delete key');
        };
        document.getElementById('loginForm').onsubmit = async (e) => { e.preventDefault(); const res = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username: document.getElementById('username').value, password: document.getElementById('password').value}) }); const data = await res.json(); if (data.token) { localStorage.setItem('zeiAdminToken', data.token); location.reload(); } else document.getElementById('loginErr').style.display='block'; };
        window.approve = async (licenseKey, plan) => { if(!confirm('Approve?')) return; await api('/api/admin/subscriptions/approve', { method:'POST', body:JSON.stringify({licenseKey, plan}) }); loadTabData('subscriptions'); };
        window.reject = async (licenseKey) => { if(!confirm('Reject/Request Resend?')) return; await api('/api/admin/subscriptions/reject', { method:'POST', body:JSON.stringify({licenseKey}) }); loadTabData('subscriptions'); };
        window.viewImg = (src) => { document.getElementById('modalImg').src = src; document.getElementById('modal').style.display = 'flex'; };
        
        let pendingDeleteKey = '';

        window.openDeleteModal = (key, name) => {
            pendingDeleteKey = key.replace(/['"]/g, '');
            document.getElementById('confirmDeleteKey').value = '';
            document.getElementById('deleteModal').style.display = 'flex';
            const btn = document.getElementById('finalDeleteBtn');
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        };

        window.closeDeleteModal = () => {
            document.getElementById('deleteModal').style.display = 'none';
        };

        document.getElementById('confirmDeleteKey').oninput = (e) => { console.log('Match Attempt:', e.target.value.trim().toUpperCase(), 'vs', pendingDeleteKey.trim().toUpperCase());
            const btn = document.getElementById('finalDeleteBtn');
            
            // Bulletproof Match: Strip any quotes or whitespace that might have leaked from the template
            const userInput = e.target.value.trim().toUpperCase().replace(/['"]/g, '');
            const targetKey = pendingDeleteKey.trim().toUpperCase().replace(/['"]/g, '');
            const match = userInput === targetKey && targetKey !== '';

            btn.disabled = !match;
            btn.style.opacity = match ? '1' : '0.5';
            btn.style.cursor = match ? 'pointer' : 'not-allowed';
        };

        window.executeHardDelete = async () => {
            if(!confirm('LAST WARNING: This will erase everything. Proceed?')) return;
            const res = await api('/api/admin/licenses/remove', { 
                method:'POST', body:JSON.stringify({licenseKey: pendingDeleteKey}) 
            });
            if(res.success) {
                alert('Store wiped successfully.');
                closeDeleteModal();
                loadTabData('licenses');
            } else {
                alert('Error: ' + res.error);
            }
        };

        window.logout = () => { localStorage.removeItem('zeiAdminToken'); location.reload(); };

        // Real-time synchronization
        function applyPulse(id) {
            const el = document.getElementById(id)?.closest('.stat-card');
            if (el) {
                el.classList.remove('pulse-now');
                void el.offsetWidth; // Trigger reflow
                el.classList.add('pulse-now');
            }
        }

        function initLiveSync() {
            const token = localStorage.getItem('zeiAdminToken');
            if (!token) return;

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);

            ws.onopen = () => {
                console.log('[Sync] Admin channel connected');
                ws.send(JSON.stringify({ type: 'admin_register', token }));
            };

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'admin_metrics_live') {
                        console.log('[Sync] Live metrics received:', msg);
                        
                        const pEl = document.getElementById('stat-pending');
                        const oldP = parseInt(pEl.innerText) || 0;
                        
                        pEl.innerText = msg.pendingRequests;
                        document.getElementById('stat-stores').innerText = msg.totalStores;
                        document.getElementById('stat-licenses').innerText = msg.totalLicenses;

                        if (msg.pendingRequests > oldP) {
                            applyPulse('stat-pending');
                        }
                    } else if (msg.type === 'new_subscription_received') {
                        showToast(\`New Subscription! \${msg.storeName} (₹\${msg.amount})\`);
                        
                        // If user is on subscriptions tab, reload it live
                        const activeTab = document.querySelector('.nav-item.active').innerText.toLowerCase();
                        if (activeTab === 'subscriptions') {
                            loadTabData('subscriptions');
                        } else {
                            // Highlight the subscriptions tab in sidebar
                            const subTab = Array.from(document.querySelectorAll('.nav-item')).find(i => i.innerText.toLowerCase() === 'subscriptions');
                            if (subTab) {
                                subTab.style.borderRight = '4px solid #facc15'; // Yellow indicator
                            }
                        }
                        
                        // Also update metrics regardless
                        loadTabData('dashboard');
                    }
                } catch (err) {}
            };

            function showToast(msg) {
                const container = document.getElementById('toast-container');
                const t = document.createElement('div');
                t.className = 'toast';
                t.innerHTML = \`
                    <div style="font-size:20px;">🔔</div>
                    <div>
                        <div style="font-weight:800; font-size:14px; color:var(--text-main);">Zeinfotech Notification</div>
                        <div style="font-size:13px; color:var(--text-muted);">\${msg}</div>
                    </div>
                \`;
                container.appendChild(t);
                setTimeout(() => t.style.opacity = '0', 4700);
                setTimeout(() => t.remove(), 5000);
            }

            ws.onclose = () => {
                console.log('[Sync] Connection lost, reconnecting in 5s...');
                setTimeout(initLiveSync, 5000);
            };
        }

        function init() { if (localStorage.getItem('zeiAdminToken')) { document.getElementById('loginView').style.display = 'none'; loadTabData('dashboard'); initLiveSync(); } else { document.getElementById('loginView').style.display = 'flex'; document.getElementById('adminPanel').style.display = 'none'; } }
        init();
    </script>
</body></html>`);
        return;
    }

    
    if (req.url === '/api/admin/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                const admin = await DBManager.findOne(Admin, 'admins', { username });
                if (admin && admin.password === password) {
                    const token = Buffer.from(`${admin.username}:${admin.password}`).toString('base64');
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ token }));
                }

                res.writeHead(401).end(JSON.stringify({ error: 'Invalid admin credentials' }));
            } catch(e) { 
                res.writeHead(500).end(JSON.stringify({ error: e.message })); 
            }
        });
        return;
    }

    
    // GET Metrics Dashboard
    if (req.url === '/api/admin/metrics' && req.method === 'GET') {
        if (!(await checkAdminAuth(req, res))) return;
        try {
            const orderDocs = await DBManager.find(Order, 'orders', { status: 'completed' });
            const orderStats = Object.values(orderDocs.reduce((acc, o) => {
                const key = o.licenseKey;
                if (!acc[key]) acc[key] = { _id: key, revenue: 0, orderCount: 0 };
                acc[key].revenue += (o.total || 0);
                acc[key].orderCount++;
                return acc;
            }, {}));
            
            const branchDocs = await DBManager.find(Branch, 'branches', {});
            const branchStats = Object.values(branchDocs.reduce((acc, b) => {
                const key = b.licenseKey;
                if (!acc[key]) acc[key] = { _id: key, branchCount: 0 };
                acc[key].branchCount++;
                return acc;
            }, {}));

            const allLicenses = await DBManager.find(License, 'licenses', { licenseKey: { $ne: 'GLOBAL' } });
            
            // Combine data
            const storeBreakdown = allLicenses.map(lic => {
                const orders = orderStats.find(s => s._id === lic.licenseKey) || { revenue: 0, orderCount: 0 };
                const branchObj = branchStats.find(s => s._id === lic.licenseKey) || { branchCount: 0 };
                
                // Count active sockets
                let activeSockets = 0;
                wss.clients.forEach(client => {
                    if ((client._licenseKey === lic.licenseKey || client.licenseKey === lic.licenseKey) && client.readyState === 1) {
                        activeSockets++;
                    }
                });

                return {
                    name: lic.businessName || 'Unnamed Store',
                    licenseKey: lic.licenseKey,
                    email: lic.email,
                    branches: branchObj.branchCount,
                    revenue: Math.round(orders.revenue),
                    orderCount: orders.orderCount,
                    status: lic.status || 'active',
                    type: lic.licenseType,
                    activeSockets
                };
            });

            // Sort by revenue descending
            storeBreakdown.sort((a, b) => b.revenue - a.revenue);

            // Derived from the same scoped breakdown (existing licenses only) so this can
            // never drift from the table below — the old separate aggregate summed orders
            // for licenses that had since been deleted, inflating the total silently.
            const totalRevenue = storeBreakdown.reduce((sum, s) => sum + s.revenue, 0);

            const metrics = {
                // NOTE: was counting Setting *documents* (each business has multiple —
                // global_settings + one per branch), inflating this well past the real
                // business count. "Stores" = distinct licenses, same as the table below.
                totalStores: allLicenses.length,
                totalLicenses: allLicenses.length,
                activeLicenses: allLicenses.filter(l => l.status === 'active').length,
                activeStores: 0, // Placeholder
                pendingRequests: await DBManager.count(Setting, 'settings', { "subscriptionRequest.status": "pending_verification" }),
                totalRevenue,
                storeBreakdown
            };
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(metrics));
        } catch(e) { res.writeHead(500).end(); }
        return;
    }

    // GET All Licenses
    
    // Toggle License Status (Active/Inactive)
    if (req.url === '/api/admin/licenses/status' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { licenseKey, status } = JSON.parse(body);
                await DBManager.upsert(License, 'licenses', { licenseKey }, { status: status === 'active' ? 'active' : 'inactive' });
                
                // Real-time Enforcement: Broadcast status change to all connected POS terminals
                const finalStatus = await getLicenseStatus(licenseKey);
                broadcastToLicense(licenseKey, { 
                    type: 'license-status-changed', 
                    licenseStatus: finalStatus,
                    timestamp: new Date().toISOString() 
                });
                
                // If deactivated, force immediate disconnect of active sessions
                if (status === 'inactive') {
                    console.log(`[Admin] 🔒 FORCING DISCONNECT for license: ${licenseKey}`);
                    broadcastToLicense(licenseKey, { 
                        type: 'force_disconnect', 
                        reason: 'Account Deactivated by Administrator',
                        timestamp: new Date().toISOString() 
                    });
                    
                    // Physical Termination: Find all sockets and kill them immediately
                    wss.clients.forEach(client => {
                        if (client._licenseKey === licenseKey || (client.licenseKey === licenseKey)) {
                            console.log(`[Hub] 💥 Terminating active socket for suspended license: ${licenseKey}`);
                            setTimeout(() => client.terminate(), 500);
                        }
                    });
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) { res.writeHead(400).end(); }
        });
        return;
    }

    // Directly edit a customer's branch limit (e.g. support agreed to a
    // one-off extra branch without generating/redeeming an upgrade key).
    if (req.url === '/api/admin/licenses/branch-limit' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { licenseKey, branchLimit } = JSON.parse(body || '{}');
                const limit = Number(branchLimit);
                if (!licenseKey || !Number.isFinite(limit) || limit < 1) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'licenseKey and a valid branchLimit (>=1) are required' }));
                }
                await DBManager.upsert(License, 'licenses', { licenseKey }, { branchLimit: limit });

                // Broadcast so any already-connected terminal for this license
                // picks up the new limit immediately, same as a status change.
                const finalStatus = await getLicenseStatus(licenseKey);
                broadcastToLicense(licenseKey, {
                    type: 'license-status-changed',
                    licenseStatus: finalStatus,
                    timestamp: new Date().toISOString()
                });

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Create Admin Account
    if (req.url === '/api/admin/accounts/create' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { username, password, fullName } = JSON.parse(body);
                const exists = await DBManager.findOne(Admin, 'admins', { username });
                if (exists) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Username exists' }));
                }
                await DBManager.upsert(Admin, 'admins', { username }, { username, password, fullName });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) { res.writeHead(400).end(); }
        });
        return;
    }

    // Delete Admin Account
    if (req.url === '/api/admin/accounts/delete' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { username } = JSON.parse(body);
                if (username === 'admin') return res.writeHead(403).end(); // Protect super-admin
                await DBManager.delete(Admin, 'admins', { username });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch(e) { res.writeHead(400).end(); }
        });
        return;
    }


    // HARD DELETE (Cascading Wipe)
    if (req.url === '/api/admin/licenses/remove' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                let { licenseKey } = JSON.parse(body); if(licenseKey) licenseKey = licenseKey.trim().toUpperCase();
                if (!licenseKey || licenseKey === 'GLOBAL') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Cannot delete protected license' }));
                }

                console.log(`[Admin] HARD DELETE Initiated for License: ${licenseKey}`);
                
                const modelsToWipe = [
                    License, User, Branch, Product, Register, Customer, Supplier, Order, Setting,
                    Purchase, Appointment, Staff, Shift, Return,
                    InventoryLog, LoginActivity, LoyaltyHistory, CreditHistory, DailyStats,
                    Record
                ];

                const results = await Promise.all(modelsToWipe.map(model => {
                    const store = Object.keys(ModelMap).find(key => ModelMap[key] === model);
                    return DBManager.delete(model, store || 'records', { licenseKey }).catch(err => ({ error: err.message, model: model.modelName }));
                }));

                console.log(`[Admin] HARD DELETE Complete for ${licenseKey}`);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, results }));
            } catch(e) { 
                res.writeHead(500).end(JSON.stringify({ error: e.message })); 
            }
        });
        return;
    }

    if (req.url === '/api/admin/licenses' && req.method === 'GET') {
        if (!(await checkAdminAuth(req, res))) return;
        try {
            // Use pre-imported License constant — works for both MongoDB and PostgreSQL
            const data = await DBManager.find(License, 'licenses', { licenseKey: { $ne: 'GLOBAL' } });
            // Trial licenses never get a stored `expiresAt` (it's computed on the fly from
            // createdAt + 7 days) — without this, the admin panel showed "N/A" even though
            // the app itself displays a real countdown to the customer.
            const withDisplayExpiry = data.map(l => {
                if (l.licenseType === 'lifetime_offline') {
                    return { ...l, displayExpiry: null, displayExpiryLabel: 'Lifetime' };
                }
                if (l.expiresAt) {
                    return { ...l, displayExpiry: l.expiresAt, displayExpiryLabel: null };
                }
                const trialEnd = new Date(new Date(l.createdAt || Date.now()).getTime() + 7 * 24 * 60 * 60 * 1000);
                return { ...l, displayExpiry: trialEnd, displayExpiryLabel: 'Trial' };
            });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(withDisplayExpiry));
        } catch(e) { res.writeHead(500).end(); }
        return;
    }

    // ── Upgrade Keys: generate / list / revoke (admin-only) ──────────────────
    function generateUpgradeKeyString() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O, 1/I
        const group = () => Array.from(crypto.randomBytes(4)).map(b => chars[b % chars.length]).join('');
        return `ZEI-${group()}-${group()}-${group()}`;
    }

    if (req.url === '/api/admin/upgrade-keys' && req.method === 'GET') {
        if (!(await checkAdminAuth(req, res))) return;
        try {
            // Keys are always managed in the cloud (Atlas) database — even if this
            // particular server process happens to be running MONGODB_MODE=local
            // (e.g. a locally-run admin session), the admin's view must stay in
            // sync with the one central key registry every install checks against.
            const { UpgradeKeyModel } = getCloudLicenseModels();
            const data = await DBManager.find(UpgradeKeyModel, 'upgrade_keys', {});
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        } catch (e) { res.writeHead(500).end(); }
        return;
    }

    if (req.url === '/api/admin/upgrade-keys' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { planType, maxUses, boundLicenseKey, branchLimit, userLimit, registerLimit, expiresInDays, createdBy, shopName, phone, email } = JSON.parse(body || '{}');
                const validPlans = ['monthly', 'biannual', 'yearly', 'annual', 'lifetime'];
                if (!validPlans.includes(planType)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid planType' }));
                }

                const key = generateUpgradeKeyString();
                const doc = {
                    key,
                    planType,
                    maxUses: Number(maxUses) || 1,
                    usedCount: 0,
                    status: 'active',
                    boundLicenseKey: boundLicenseKey || null,
                    assignedShopName: shopName || null,
                    assignedPhone: phone || null,
                    assignedEmail: email || null,
                    branchLimit: branchLimit ? Number(branchLimit) : undefined,
                    userLimit: userLimit ? Number(userLimit) : undefined,
                    registerLimit: registerLimit ? Number(registerLimit) : undefined,
                    expiresAt: expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 86400000) : null,
                    redemptions: [],
                    createdBy: createdBy || 'admin',
                    createdAt: new Date()
                };
                const { UpgradeKeyModel } = getCloudLicenseModels();
                await DBManager.upsert(UpgradeKeyModel, 'upgrade_keys', { key }, doc);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, key }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    if (req.url === '/api/admin/upgrade-keys/revoke' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { key } = JSON.parse(body || '{}');
                if (!key) { res.writeHead(400).end(JSON.stringify({ error: 'key required' })); return; }
                const { UpgradeKeyModel } = getCloudLicenseModels();
                await DBManager.updateMany(UpgradeKeyModel, 'upgrade_keys', { key }, { status: 'revoked' });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // Permanently remove an upgrade key row (used/revoked cleanup) from the
    // cloud registry — separate from Revoke, which only blocks future redemption.
    if (req.url === '/api/admin/upgrade-keys/delete' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { key } = JSON.parse(body || '{}');
                if (!key) { res.writeHead(400).end(JSON.stringify({ error: 'key required' })); return; }
                const { UpgradeKeyModel } = getCloudLicenseModels();
                await DBManager.delete(UpgradeKeyModel, 'upgrade_keys', { key });
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // ── GET /api/backup/download?licenseKey=XXX ──────────────────────────────
    // Download a full JSON backup file for a license. Works for MongoDB + PostgreSQL.
    if (req.url.startsWith('/api/backup/download') && req.method === 'GET') {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const licenseKey = urlObj.searchParams.get('licenseKey');
        if (!licenseKey || licenseKey === 'GLOBAL') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'licenseKey query param required' }));
        }
        try {
            console.log(`[Hub] 💾 HTTP Backup Download for: ${licenseKey}`);
            const backup = await DBManager.exportAll(ModelMap, licenseKey);
            const totalRecords = Object.values(backup.stores).reduce((sum, arr) => sum + (arr.length || 0), 0);

            // Log to backup_history
            await DBManager.insert(Record, 'backup_history', {
                licenseKey,
                type: 'http_download',
                exportedAt: backup.exportedAt,
                totalRecords,
                stores: Object.keys(backup.stores).length
            });

            const filename = `pos_backup_${licenseKey}_${new Date().toISOString().slice(0,10)}.json`;
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'X-Total-Records': totalRecords
            });
            res.end(JSON.stringify(backup, null, 2));
            console.log(`[Hub] ✅ Backup download sent — ${totalRecords} records`);
        } catch (err) {
            console.error('[Hub] Backup download error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // ── POST /api/backup/restore ─────────────────────────────────────────────
    // Restore a previously downloaded backup JSON. Works for MongoDB + PostgreSQL.
    if (req.url === '/api/backup/restore' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const { backup, wipe = false } = JSON.parse(body);
                if (!backup || !backup.licenseKey || !backup.stores) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid backup data format' }));
                }
                console.log(`[Hub] 🔄 HTTP Restore for: ${backup.licenseKey} (wipe=${wipe})`);
                const results = await DBManager.importAll(ModelMap, backup, wipe);
                const totalImported = Object.values(results).reduce((sum, r) => sum + (r.imported || 0), 0);

                // Notify all connected clients to refresh
                broadcastToLicense(backup.licenseKey, {
                    type: 'pos_data_restored',
                    licenseKey: backup.licenseKey,
                    timestamp: new Date().toISOString()
                });

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, totalImported, results }));
                console.log(`[Hub] ✅ HTTP Restore complete — ${totalImported} records`);
            } catch (err) {
                console.error('[Hub] Restore error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // GET Admin Accounts
    if (req.url === '/api/admin/accounts' && req.method === 'GET') {
        if (!(await checkAdminAuth(req, res))) return;
        try {
            const data = await DBManager.find(Admin, 'admins', {});
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data.map(a => ({ username: a.username, fullName: a.fullName }))));
        } catch(e) { res.writeHead(500).end(); }
        return;
    }

    if (req.url === '/api/admin/subscriptions' && req.method === 'GET') {
        if (!(await checkAdminAuth(req, res))) return;
        try {
            const data = await DBManager.find(Setting, 'settings', { "subscriptionRequest.status": "pending_verification" });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        } catch(e) { res.writeHead(500).end(); }
        return;
    }

    if (req.url === '/api/admin/subscriptions/approve' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { licenseKey, plan } = JSON.parse(body);
                const sDoc = await DBManager.findOne(Setting, 'settings', { licenseKey, "subscriptionRequest.status": "pending_verification" });
                if (!sDoc) return res.writeHead(400).end(JSON.stringify({ error: 'Not found' }));

                const reqData = sDoc.subscriptionRequest || {};
                const branchCount = reqData.branches || 1;
                const userCount = reqData.users || 1;
                const registerCount = reqData.registers || 1;

                // Determine subscription duration based on billing interval
                const billingInterval = reqData.interval || 'monthly';
                const daysToAdd = billingInterval === 'yearly' ? 365 : 30;

                const newKey = `POS-P-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                
                // Set License
                let lic = await DBManager.findOne(License, 'licenses', { licenseKey });
                if(!lic) lic = { licenseKey, email: sDoc.subscriptionRequest.email || 'admin@pos.com', createdAt: new Date() };
                lic.licenseType = 'premium';
                lic.premiumKey = newKey;
                lic.branchLimit = branchCount;
                lic.userLimit = userCount;
                lic.registerLimit = registerCount;
                lic.billingInterval = billingInterval;
                lic.expiresAt = new Date(Date.now() + daysToAdd*24*60*60*1000);
                lic.updatedAt = new Date();
                await DBManager.upsert(License, 'licenses', { licenseKey }, lic);

                // Update Request Status
                reqData.status = 'approved';
                reqData.approvedAt = new Date().toISOString();
                reqData.premiumKey = newKey;
                sDoc.subscriptionRequest = reqData;
                sDoc.updatedAt = new Date();
                await DBManager.upsert(Setting, 'settings', { licenseKey, id: sDoc.id || 'global_settings' }, sDoc);

                // Broadcast 
                const payload = {
                    type: 'upgrade_license_result',
                    success: true,
                    requestId: 'server_approve',
                    message: 'Premium Approved via Admin Hub',
                    licenseStatus: {
                        type: 'premium',
                        isExpired: false,
                        daysLeft: daysToAdd,
                        billingInterval,
                        branchLimit: branchCount,
                        userLimit: userCount,
                        registerLimit: registerCount,
                        tierName: 'Premium',
                        modules: {
                             inventory: 'full',
                             reports: 'advanced',
                             appointments: true
                        }
                    }
                };
                
                let bCount = 0;
                if (typeof clientMap !== 'undefined' && clientMap.has(licenseKey)) {
                    for (const ws of clientMap.get(licenseKey)) {
                        if (ws.readyState === 1) { ws.send(JSON.stringify(payload)); bCount++; }
                    }
                }
                
                // ALSO Broadcast standard settings update to ensure IDB sync
                broadcastToLicense(licenseKey, { 
                    type: 'update', 
                    store: 'settings', 
                    data: { ...sDoc, id: sDoc.id || 'global_settings' }, 
                    timestamp: new Date().toISOString() 
                });

                // EMAIL: Notify User
                const userEmail = sDoc.subscriptionRequest.email || (lic && lic.email);
                if (userEmail) {
                    console.log(`[Hub] 📧 Triggering approval email to: ${userEmail}`);
                    await sendSubscriptionEmail(userEmail, 'approved', {
                        storeName: sDoc.storeName || licenseKey,
                        plan: sDoc.subscriptionRequest.plan,
                        premiumKey: newKey,
                        expiryDate: new Date(lic.expiresAt).toLocaleDateString()
                    });
                }

                await broadcastAdminMetrics(); // LIVE UPDATE ADMIN HUB

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, premiumKey: newKey, broadcast: bCount }));
            } catch(e) {
                res.writeHead(500).end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    if (req.url === '/api/admin/subscriptions/reject' && req.method === 'POST') {
        if (!(await checkAdminAuth(req, res))) return;
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                let { licenseKey } = JSON.parse(body); if(licenseKey) licenseKey = licenseKey.trim().toUpperCase();
                const sDoc = await DBManager.findOne(Setting, 'settings', { licenseKey, "subscriptionRequest.status": "pending_verification" });
                if (!sDoc) return res.writeHead(400).end(JSON.stringify({ error: 'Not found' }));
                
                sDoc.subscriptionRequest.status = 'rejected';
                sDoc.updatedAt = new Date();
                await DBManager.upsert(Setting, 'settings', { licenseKey, id: sDoc.id || 'global_settings' }, sDoc);
                
                await broadcastAdminMetrics(); // LIVE UPDATE ADMIN HUB
                
                // Get fresh status to broadcast (This will switch it from 'pending_verification' back to 'trial')
                const freshStatus = await getLicenseStatus(licenseKey);
                
                const payload = { 
                    type: 'subscription_resend_request', 
                    success: false, 
                    message: 'Please resend a clearer image of your bank receipt.',
                    licenseStatus: freshStatus // Include updated status to force UI switch
                };

                if (typeof clientMap !== 'undefined' && clientMap.has(licenseKey)) {
                    for (const ws of clientMap.get(licenseKey)) {
                        if (ws.readyState === 1) ws.send(JSON.stringify(payload));
                    }
                }

                // ALSO Broadcast standard settings update to ensure IDB sync
                broadcastToLicense(licenseKey, { 
                    type: 'update', 
                    store: 'settings', 
                    data: { ...sDoc, id: sDoc.id || 'global_settings' }, 
                    timestamp: new Date().toISOString() 
                });

                // EMAIL: Notify User
                const userEmail = sDoc.subscriptionRequest.email;
                if (userEmail) {
                    console.log(`[Hub] 📧 Triggering rejection email to: ${userEmail}`);
                    await sendSubscriptionEmail(userEmail, 'rejected', {
                        storeName: sDoc.storeName || licenseKey,
                        reason: 'Please resend a clearer image of your bank receipt.'
                    });
                }
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true }));
            } catch(e) {
                res.writeHead(500).end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
            status: 'ok',
            db: isDbConnected ? 'connected' : 'disconnected',
            clients: wss.clients.size
        }));
    } else if (req.url === '/api/license/activate-lifetime' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            try {
                const { licenseKey, key, deviceFingerprint, phone, email } = JSON.parse(body || '{}');
                if (!licenseKey || !key || !deviceFingerprint) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'licenseKey, key and deviceFingerprint are required' }));
                }

                // Upgrade Keys always live in the cloud (Atlas) — the admin panel that
                // issues them never touches a customer's local Mongo, so validation and
                // redemption tracking must go through the cloud connection even when
                // this server itself is running MONGODB_MODE=local.
                const { UpgradeKeyModel } = getCloudLicenseModels();
                const keyDoc = await DBManager.findOne(UpgradeKeyModel, 'upgrade_keys', { key: key.toUpperCase() });
                if (!keyDoc || keyDoc.planType !== 'lifetime') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid lifetime key' }));
                }
                if (keyDoc.status === 'revoked') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'This key has been revoked' }));
                }
                if (keyDoc.boundLicenseKey && keyDoc.boundLicenseKey !== licenseKey) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'This key is not valid for your account' }));
                }
                const contactCheck = verifyKeyContactMatch(keyDoc, phone, email);
                if (!contactCheck.ok) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: contactCheck.message }));
                }

                let existingLicense = await DBManager.findOne(License, 'licenses', { licenseKey });

                // Already activated on THIS license identity — enforce single-device lock
                if (existingLicense?.licenseType === 'lifetime_offline' && existingLicense?.deviceFingerprint) {
                    if (existingLicense.deviceFingerprint !== deviceFingerprint) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: 'This lifetime key is already activated on another device. Contact support to transfer it.' }));
                    }
                    // Same device reactivating (e.g. reinstall) — return the cached token idempotently
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    return res.end(JSON.stringify({ success: true, token: existingLicense.activationToken }));
                }

                if (keyDoc.usedCount >= keyDoc.maxUses) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'This key has already been activated on another device' }));
                }

                // First activation — bind the device fingerprint and sign an offline-verifiable token
                const payload = { licenseKey, deviceFingerprint, licenseType: 'lifetime_offline', iat: Date.now() };
                const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
                const signer = crypto.createSign('RSA-SHA256');
                signer.update(payloadB64);
                signer.end();
                const privateKeyPem = Buffer.from(process.env.LICENSE_SIGNING_PRIVATE_KEY, 'base64').toString('utf8');
                const signatureB64 = signer.sign(privateKeyPem).toString('base64');
                const token = `${payloadB64}.${signatureB64}`;

                let newLicenseData = {
                    ...(existingLicense || { licenseKey, email: `${licenseKey}@lifetime.local` }),
                    licenseType: 'lifetime_offline',
                    deviceFingerprint,
                    activationToken: token,
                    lifetimeActivatedAt: new Date(),
                    expiresAt: null,
                    status: 'active',
                    updatedAt: new Date()
                };
                await DBManager.upsert(License, 'licenses', { licenseKey }, newLicenseData);

                const newUsedCount = (keyDoc.usedCount || 0) + 1;
                await DBManager.updateMany(UpgradeKeyModel, 'upgrade_keys', { key: keyDoc.key }, {
                    $set: {
                        usedCount: newUsedCount,
                        status: newUsedCount >= keyDoc.maxUses ? 'used' : 'active',
                        redemptions: [...(keyDoc.redemptions || []), { licenseKey, deviceFingerprint, redeemedAt: new Date() }]
                    }
                });

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ success: true, token }));
            } catch (err) {
                console.error('[Lifetime Activation] Error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Activation failed' }));
            }
        });
    } else {
        // Log the unhandled request to help the user find typos in their URL
        console.warn(`[Server] 404 - Unhandled ${req.method} request to: ${req.url}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            error: 'Endpoint not found', 
            requestedPath: req.url,
            suggestion: "Check your Android app URL settings. Ensure it matches exactly."
        }));
    }
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
const adminSockets = new Set(); // Admin dashboard connections

// Helper to broadcast metrics to all connected admin panels
// NOTE: Uses pre-imported License + Setting constants — works for BOTH MongoDB and PostgreSQL
async function broadcastAdminMetrics() {
    try {
        const pendingCount = await DBManager.count(Setting, 'settings', { "subscriptionRequest.status": "pending_verification" });
        const totalStores  = await DBManager.count(Setting, 'settings', { licenseKey: { $ne: 'GLOBAL' } });
        const allLicenses  = await DBManager.count(License, 'licenses', { licenseKey: { $ne: 'GLOBAL' } });
        
        const payload = JSON.stringify({ 
            type: 'admin_metrics_live', 
            pendingRequests: pendingCount,
            totalStores,
            totalLicenses: allLicenses,
            timestamp: new Date().toISOString()
        });

        adminSockets.forEach(ws => {
            if (ws.readyState === 1) ws.send(payload);
        });
    } catch (e) {
        console.error('[Hub] Admin Metrics broadcast failed:', e.message);
    }
}

// Helper to send JSON messages securely
function send(ws, obj) {
    if (ws && ws.readyState === 1) {
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

function send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
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
        const licenseKey = msg.licenseKey || ws._licenseKey || 'GLOBAL';

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
                case 'admin_register': {
                    const { token } = msg;
                    if (!token) break;
                    try {
                        const decoded = Buffer.from(token, 'base64').toString();
                        const [username, password] = decoded.split(':');
                        const admin = await DBManager.findOne(Admin, 'admins', { username });
                        if (admin && admin.password === password) {
                            ws.isAdmin = true;
                            adminSockets.add(ws);
                            console.log(`[Hub] Admin Socket Registered: ${username}`);
                            // Send immediate confirmation and first metrics
                            broadcastAdminMetrics();
                        }
                    } catch (e) {}
                    break;
                }

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

                    const finalLicense = msgLicense || licenseKey || (data && data.licenseKey);
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

                        // Real-time Admin Notification if it's a subscription request
                        if (updateObj.subscriptionRequest && updateObj.subscriptionRequest.status === 'pending_verification') {
                            const storeName = updateObj.storeName || finalLicense;
                            const amount = updateObj.subscriptionRequest.amount;
                            const plan = updateObj.subscriptionRequest.plan;
                            
                            console.log(`[Hub] 📢 Detected Subscription Request (${plan}) from ${storeName}. Status: ${updateObj.subscriptionRequest.status}`);
                            
                            const notifyPayload = JSON.stringify({
                                type: 'new_subscription_received',
                                storeName,
                                amount,
                                plan,
                                licenseKey: finalLicense,
                                timestamp: new Date().toISOString()
                            });

                            adminSockets.forEach(ws => {
                                if (ws.readyState === 1) ws.send(notifyPayload);
                            });

                            await broadcastAdminMetrics();

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
                    const finalLicense = msgLicense || licenseKey;

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

                    const isValid = user.pin === password || user.password === password || user.passwordHash === password;

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
                            await DBManager.insert(LoginActivity, 'login_activities', {
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
                        await DBManager.insert(LoginActivity, 'login_activities', {
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
        // Cleanup Admin Sockets
        adminSockets.delete(ws);

        unregisterClient(ws);
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
connectDB().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 POS Sync Hub running on ws://localhost:${PORT}`);
        console.log(`   Health: http://localhost:${PORT}/health`);
        console.log(`   Database: MongoDB [${MONGODB_MODE}] (${MONGODB_URI?.replace(/:([^@]+)@/, ':****@')})`);
    });
});
