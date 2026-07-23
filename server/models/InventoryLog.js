const mongoose = require('mongoose');

const inventoryLogSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true },
    id: { type: String, required: true },
    date: { type: Date, default: Date.now },
    productId: { type: String, required: true },
    variantName: { type: String },
    type: { type: String, required: true, enum: ['IN', 'OUT'] },
    qtyChange: { type: Number, required: true },
    reason: { type: String },
    user: { type: String },
    oldStock: { type: Number },
    newStock: { type: Number },
    refId: { type: String },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

inventoryLogSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('InventoryLog', inventoryLogSchema, 'inventory_logs');
