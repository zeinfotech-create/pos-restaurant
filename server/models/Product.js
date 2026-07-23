const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true },
    productId: { type: String, required: true },
    name: { type: String, required: true },
    emoji: { type: String },
    price: { type: Number, required: true },
    category: { type: String },
    stock: { type: Number, default: 0 },
    sku: { type: String },
    barcode: { type: String },
    variants: { type: Array, default: [] },
    isReturnable: { type: Boolean, default: true },
    itemDiscount: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

productSchema.index({ licenseKey: 1, branchId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
