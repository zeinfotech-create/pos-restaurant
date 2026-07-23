const mongoose = require('mongoose');

const dailyStatsSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    branchId: { type: String, index: true },
    id: { type: String, required: true, index: true }, // e.g., '2026-04-07'
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });

dailyStatsSchema.index({ licenseKey: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('DailyStats', dailyStatsSchema);
