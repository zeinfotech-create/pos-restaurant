const mongoose = require('mongoose');

const licenseSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    businessName: { type: String },
    businessType: { type: String },
    licenseType: { type: String, default: 'trial', enum: ['trial', 'premium', 'lifetime_offline'] },
    premiumKey: { type: String },
    activatedAt: { type: Date },
    expiresAt: { type: Date },
    // Lifetime Offline license (Item 2): bound to exactly one machine fingerprint.
    deviceFingerprint: { type: String, default: null },
    activationToken: { type: String, default: null },
    lifetimeActivatedAt: { type: Date, default: null },
    branchLimit: { type: Number, default: 1 },
    userLimit: { type: Number, default: 1 },
    registerLimit: { type: Number, default: 1 },
    billingInterval: { type: String, default: 'monthly', enum: ['monthly', 'biannual', 'yearly', 'annual'] },
    status: { type: String, default: 'active' },
    otp: { type: String },
    otpExpiresAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('License', licenseSchema);
