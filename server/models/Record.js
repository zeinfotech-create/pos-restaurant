const mongoose = require('mongoose');

// Generic record schema — stores any data from the POS (products, orders, customers, etc.)
const recordSchema = new mongoose.Schema({
    store: { type: String, required: true, index: true },       // e.g. 'products', 'orders'
    recordId: { type: String, required: true, index: true },    // the item's own .id
    licenseKey: { type: String, index: true },                  // tenant isolation
    branchId: { type: String, index: true },                    // branch isolation
    data: { type: mongoose.Schema.Types.Mixed, required: true }, // the full object
    updatedAt: { type: Date, default: Date.now }
});

recordSchema.index({ store: 1, recordId: 1, licenseKey: 1 }, { unique: true });

module.exports = mongoose.model('Record', recordSchema);
