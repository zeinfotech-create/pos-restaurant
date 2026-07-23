const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true },
    id: { type: String, required: true, index: true },
    date: { type: String },
    supplierId: { type: String },
    supplierName: { type: String },
    supplierGstin: { type: String },
    supplierInvoiceNo: { type: String },
    placeOfSupply: { type: String },
    items: { type: Array, default: [] },
    subtotal: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    status: { type: String },
    timestamp: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

purchaseSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Purchase', purchaseSchema);
