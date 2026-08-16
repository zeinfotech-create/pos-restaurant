const mongoose = require('mongoose');

const createGenericModel = (modelName) => {
    const schema = new mongoose.Schema({
        id: { type: String, required: true, index: true },
        licenseKey: { type: String, index: true },
        branchId: { type: String, index: true }
    }, { strict: false, timestamps: true });
    
    schema.index({ id: 1, licenseKey: 1 }, { unique: true });
    return mongoose.model(modelName, schema);
};

module.exports = {
    Category: createGenericModel('Category'),
    SubCategory: createGenericModel('SubCategory'),
    ImportTracker: createGenericModel('ImportTracker'),
    BackupHistory: createGenericModel('BackupHistory'),
    ImportHistory: createGenericModel('ImportHistory'),
    // Staff commission records (db.js's saveStaffIncentive()) — had no
    // model at all in ModelMap (not even the wrong generic Record one the
    // categories/etc. bug above had), so every sync attempt failed
    // outright with "No model found for store: staff_incentives", logged
    // but never surfaced to the cashier. Saved fine locally, just never
    // reached the shared hub for other devices/reports to see.
    StaffIncentive: createGenericModel('StaffIncentive'),
    // Stock Transfers (multi-branch) — a transfer record belongs to BOTH
    // the source and destination branch, unlike every other branchId-scoped
    // model here, so it's deliberately excluded from ModelMap's
    // branchScopedStores filtering in index.js (see that list) — every
    // device pulls every transfer for the license, client-side code decides
    // whether it involves the branch it cares about.
    StockTransfer: createGenericModel('StockTransfer'),
};
