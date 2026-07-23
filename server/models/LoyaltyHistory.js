const mongoose = require('mongoose');

const loyaltyHistorySchema = new mongoose.Schema({
    id: { type: String, required: true, index: true },
    licenseKey: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    branchId: { type: String, index: true },
    type: { type: String, enum: ['Earn', 'Redeem', 'Adjust'], required: true },
    points: { type: Number, required: true },
    orderId: { type: String },
    note: { type: String },
    date: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

loyaltyHistorySchema.index({ licenseKey: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('LoyaltyHistory', loyaltyHistorySchema);
