const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String },
    email: { type: String },
    contact: { type: String },
    gstin: { type: String },
    type: { type: String },
    address: { type: String },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

supplierSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Supplier', supplierSchema);
