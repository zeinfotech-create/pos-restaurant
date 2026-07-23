const mongoose = require('mongoose');

const registerSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    registerId: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, default: 'active' },
    data: { type: mongoose.Schema.Types.Mixed },
    updatedAt: { type: Date, default: Date.now }
});

registerSchema.index({ licenseKey: 1, branchId: 1, registerId: 1 }, { unique: true });

module.exports = mongoose.model('Register', registerSchema);
