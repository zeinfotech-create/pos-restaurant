const mongoose = require('mongoose');

const loginActivitySchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
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
});

module.exports = mongoose.model('LoginActivity', loginActivitySchema);
