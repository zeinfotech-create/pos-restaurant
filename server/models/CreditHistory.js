const mongoose = require('mongoose');

const creditHistorySchema = new mongoose.Schema({
    id: { type: String, required: true, index: true },
    licenseKey: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    branchId: { type: String, index: true },
    type: { type: String, enum: ['Credit', 'Debit'], required: true },
    amount: { type: Number, required: true },
    reason: { type: String },
    orderId: { type: String },
    date: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

creditHistorySchema.index({ licenseKey: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('CreditHistory', creditHistorySchema);
