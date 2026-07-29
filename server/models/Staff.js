const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true },
    id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    role: { type: String },
    phone: { type: String },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

staffSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Staff', staffSchema);
