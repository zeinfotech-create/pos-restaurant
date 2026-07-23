const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true, index: true },
    id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    phone: { type: String },
    email: { type: String },
    address: { type: String },
    image: { type: String },
    gstin: { type: String },
    loyaltyPoints: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    totalOrders: { type: Number, default: 0 },
    tier: { type: mongoose.Schema.Types.Mixed },
    points: { type: Number, default: 0 }, // keeping legacy field for compatibility
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

customerSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
