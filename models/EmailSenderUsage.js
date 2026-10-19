const mongoose = require("mongoose");

// Recipients sent per sender address per day (Asia/Kolkata date), shared by every server instance so
// the daily limit holds across all of them. blockedUntil is set when the provider itself refuses
// (daily limit hit early, bad password) so that account is skipped until then.
const emailSenderUsageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true, lowercase: true, trim: true },
    day: { type: String, required: true },
    count: { type: Number, default: 0 },
    blockedUntil: { type: Date, default: null },
    blockedReason: { type: String, default: "" },
  },
  { timestamps: true }
);

emailSenderUsageSchema.index({ sender: 1, day: 1 }, { unique: true });
// Old days are not needed after a few days.
emailSenderUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("EmailSenderUsage", emailSenderUsageSchema);
