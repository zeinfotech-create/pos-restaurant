const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true },
    branchId: { type: String, required: true },
    name: { type: String, required: true },
    address: { type: String },
    phone: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Branch', branchSchema);
