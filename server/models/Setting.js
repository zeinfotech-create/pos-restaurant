const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    id: { type: String, required: true, index: true }, // Unified ID e.g., 'global_settings' or 'settings_branch1'
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String },
    storeName: { type: String },
    storeAddress: { type: String },
    receiptFooter: { type: String },
    theme: { type: String },
    currency: { type: String, default: '\u20B9' },
    taxRate: { type: Number, default: 0 },
    availableTaxes: { type: mongoose.Schema.Types.Mixed, default: [] },
    businessType: { type: String },
    email: { type: String },
    isInstalled: { type: Boolean },
    enableRegisterRoutine: { type: Boolean },
    settingsLockEnabled: { type: Boolean, default: false },
    masterPin: { type: String },
    autoLockMinutes: { type: Number },
    whatsappSessionId: { type: String },
    syncHubIp: { type: String },
    whatsappTemplates: { type: mongoose.Schema.Types.Mixed },
    whatsappReminders: { type: mongoose.Schema.Types.Mixed },
    features: { type: mongoose.Schema.Types.Mixed },
    paymentMethods: { type: mongoose.Schema.Types.Mixed, default: [] },
    subscriptionRequest: { type: mongoose.Schema.Types.Mixed },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

settingSchema.index({ licenseKey: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Setting', settingSchema);
