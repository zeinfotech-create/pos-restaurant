const mongoose = require('mongoose');

const upgradeKeySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    planType: { type: String, required: true, enum: ['monthly', 'biannual', 'yearly', 'annual', 'lifetime'] },
    branchLimit: { type: Number },
    userLimit: { type: Number },
    registerLimit: { type: Number },
    boundLicenseKey: { type: String, default: null }, // if set, only this license may redeem
    // Optional identity the admin assigns this key to at creation time (who it was
    // sold/issued to). If phone/email is set, redemption must be confirmed with a
    // matching contact — an extra check beyond boundLicenseKey.
    assignedShopName: { type: String, default: null },
    assignedPhone: { type: String, default: null },
    assignedEmail: { type: String, default: null },
    maxUses: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },
    status: { type: String, default: 'active', enum: ['active', 'revoked', 'used'] },
    redemptions: [{
        licenseKey: String,
        deviceFingerprint: String,
        redeemedAt: { type: Date, default: Date.now }
    }],
    expiresAt: { type: Date, default: null }, // the key's own validity window (optional)
    createdBy: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UpgradeKey', upgradeKeySchema);
