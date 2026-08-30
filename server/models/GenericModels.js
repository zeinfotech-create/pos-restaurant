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
    // Expenses (Rent/Salary/Electricity/etc) — unlike StockTransfer above,
    // an expense belongs to exactly ONE branch, so it's a normal
    // branchId-scoped model: included in index.js's branchScopedStores list,
    // NOT in GlobalStores.
    Expense: createGenericModel('Expense'),
    // Staff Attendance (clock-in/out) — also single-branch, same treatment
    // as Expense above.
    Attendance: createGenericModel('Attendance'),
    // Restaurant module: a table belongs to one branch's floor; a KOT
    // belongs to whichever branch's kitchen it was sent to. Both single-branch,
    // same treatment as Expense/Attendance — in branchScopedStores, not GlobalStores.
    Table: createGenericModel('Table'),
    Kot: createGenericModel('Kot'),
    // A takeaway/delivery order slot — single-branch, same treatment as
    // Table/Kot above.
    CounterOrder: createGenericModel('CounterOrder'),
    // Advance table bookings — single-branch, same treatment as Table/Kot/
    // CounterOrder above.
    Reservation: createGenericModel('Reservation'),
    // Walk-in waitlist entries — single-branch, same treatment as
    // Reservation/Table/Kot/CounterOrder above.
    Waitlist: createGenericModel('Waitlist'),
    // Post-bill customer ratings — single-branch, same treatment as
    // Waitlist/Reservation/Table/Kot/CounterOrder above.
    Feedback: createGenericModel('Feedback'),
    // Self-order QR menu submissions — single-branch, same treatment as
    // Feedback/Waitlist/Reservation/Table/Kot/CounterOrder above.
    MenuRequest: createGenericModel('MenuRequest'),
};
