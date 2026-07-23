const mongoose = require('mongoose');

const returnSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true },
    id: { type: String, required: true, index: true },
    type: { type: String }, // 'sales', 'purchase'
    orderId: { type: String },
    purchaseId: { type: String },
    items: { type: Array, default: [] },
    total: { type: Number, default: 0 },
    reason: { type: String },
    customer: { type: mongoose.Schema.Types.Mixed },
    supplierId: { type: String },
    supplierName: { type: String },
    registerId: { type: String },
    refundMethod: { type: String, default: 'Cash' },
    date: { type: Date, default: Date.now },
    timestamp: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

returnSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Return', returnSchema);
