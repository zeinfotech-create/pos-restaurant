const mongoose = require('mongoose');

const scheduledReminderSchema = new mongoose.Schema({
    id: { type: String, required: true, index: true },
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, index: true },
    customerId: { type: String, index: true },
    phone: { type: String },
    name: { type: String },
    message: { type: String },
    scheduledFor: { type: Date, required: true, index: true },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'cancelled'], default: 'pending', index: true },
    error: { type: String },
    attemptedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

scheduledReminderSchema.index({ licenseKey: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('ScheduledReminder', scheduledReminderSchema);
