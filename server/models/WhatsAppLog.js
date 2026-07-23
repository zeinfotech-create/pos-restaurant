const mongoose = require('mongoose');

const whatsappLogSchema = new mongoose.Schema({
    id: { type: String, required: true, index: true },
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, index: true },
    customerId: { type: String, index: true },
    phone: { type: String },
    name: { type: String },
    message: { type: String },
    type: { type: String },
    status: { type: String },
    timestamp: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

whatsappLogSchema.index({ licenseKey: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('WhatsAppLog', whatsappLogSchema);
