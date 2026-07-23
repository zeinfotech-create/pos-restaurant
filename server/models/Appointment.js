const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, required: true },
    id: { type: String, required: true, index: true },
    customerId: { type: String },
    customerName: { type: String },
    customerPhone: { type: String },
    staffId: { type: String },
    serviceId: { type: String },
    startTime: { type: Date },
    endTime: { type: Date },
    status: { type: String, default: 'scheduled' },
    updatedAt: { type: Date, default: Date.now }
});

appointmentSchema.index({ licenseKey: 1, branchId: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('Appointment', appointmentSchema);
