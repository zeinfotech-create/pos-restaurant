const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    registerId: { type: String, required: true, index: true },
    id: { type: String, required: true, index: true }, // Shift ID e.g. SHIFT-123
    openedBy: { type: String },
    openedAt: { type: Date },
    closedAt: { type: Date },
    status: { type: String, default: 'Open' },
    openingBalance: { type: Number, default: 0 },
    closingBalance: { type: Number, default: 0 },
    sales: { type: Number, default: 0 },
    cashSales: { type: Number, default: 0 },
    ordersCount: { type: Number, default: 0 },
    collections: { type: mongoose.Schema.Types.Mixed },
    transactions: { type: Array, default: [] },
    notes: { type: String },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

shiftSchema.index({ licenseKey: 1, branchId: 1, registerId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Shift', shiftSchema);
