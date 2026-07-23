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
});

userSchema.index({ licenseKey: 1, userId: 1 }, { unique: true });
userSchema.index({ licenseKey: 1, username: 1 });
userSchema.index({ licenseKey: 1, email: 1 });

module.exports = mongoose.model('User', userSchema);
