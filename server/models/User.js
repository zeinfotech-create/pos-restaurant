const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    username: { type: String },
    email: { type: String },
    name: { type: String },
    image: { type: String },
    role: { type: String },
    branchId: { type: String },
    branchIds: [{ type: String }],
    pin: { type: String },
    passwordHash: { type: String },
    otp: { type: String },
    otpExpiresAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    isActive: { type: Boolean, default: true },
    sessionFilterEnabled: { type: Boolean, default: false },
    permissions: [{ type: String }],
    data: { type: mongoose.Schema.Types.Mixed },
    updatedAt: { type: Date, default: Date.now }
}, { strict: false });
// strict:false (matching Branch.js/Product.js) so the client's own 'id' field
// — which this schema never declared, only 'userId' — survives the
// upsert/lean() round-trip instead of being silently stripped. Without it,
// every doc this hub echoed back (broadcastToLicense after a save, or a
// pos_full_state pull) arrived with no 'id' at all, and the client's
// handleIncomingUpdate()/pos_full_state handler both key their local lookup
// on data.id — db.get(store, undefined) then throws "No key or key range
// specified", so the incoming users update/full-state record was silently
// dropped every time (caught, logged, never applied). Only the 'users' store
// itself was ever affected, but for any device other than the one that made
// the original change, its whole picture of staff/admin accounts could stay
// stale indefinitely.

userSchema.index({ licenseKey: 1, userId: 1 }, { unique: true });
userSchema.index({ licenseKey: 1, username: 1 });
userSchema.index({ licenseKey: 1, email: 1 });

module.exports = mongoose.model('User', userSchema);
