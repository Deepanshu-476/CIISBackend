const mongoose = require('mongoose');

// Limits forgot-password OTP emails per account: a 60 s wait between sends,
// at most 5 sends, then a 1 hour lock. One row per email (+ company).
const passwordResetThrottleSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  companyCode: { type: String, default: '', uppercase: true, trim: true },
  sendCount: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: null },
  lockedUntil: { type: Date, default: null },
  // Rows clean themselves up a day after the last activity.
  expireAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
}, { timestamps: true });

passwordResetThrottleSchema.index({ email: 1, companyCode: 1 }, { unique: true });
passwordResetThrottleSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PasswordResetThrottle', passwordResetThrottleSchema);
