const mongoose = require('mongoose');

const loginActivitySchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    // DBManager.insert() (dbManager.js) always upserts on a derived `id` field (here,
    // userId) — without it declared in the schema, Mongoose throws StrictModeError on
    // every insert attempt ("Path 'id' is not in schema, strict mode is true, and
    // upsert is true"), silently swallowed by the caller's try/catch. This is why
    // Login Activity has never actually recorded anything, for any login path.
    id: { type: String, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String },
    role: { type: String },
    branchId: { type: String },
    branchName: { type: String },
    timestamp: { type: Date, default: Date.now, index: true },
    ip: { type: String },
    userAgent: { type: String },
    deviceType: { type: String },
    browser: { type: String },
    os: { type: String },
    registerId: { type: String },
    registerName: { type: String }
}, { strict: false });

module.exports = mongoose.model('LoginActivity', loginActivitySchema);
