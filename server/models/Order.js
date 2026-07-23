const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true },
    id: { type: String, required: true, index: true },
    orderNumber: { type: String },
    customerId: { type: String },
    customer: { type: mongoose.Schema.Types.Mixed },
    items: { type: Array, default: [] },
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    paymentMethod: { type: String },
    payments: { type: Array, default: [] },
    dailyNumber: { type: Number },
    orderType: { type: String },
    orderSource: { type: String },
    discount: { type: Number, default: 0 },
    registerId: { type: String },
    guestCount: { type: Number },
    status: { type: String }, // 'pending', 'completed', 'cancelled', 'Parked'
    timestamp: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

orderSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Order', orderSchema);
