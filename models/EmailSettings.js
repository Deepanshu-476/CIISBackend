const mongoose = require("mongoose");

const emailSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
      immutable: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    senderName: {
      type: String,
      trim: true,
      default: "CIIS NETWORK",
      maxlength: 120,
    },
    emailUser: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    encryptedEmailPass: {
      type: String,
      default: "",
      select: false,
    },
    emailService: {
      type: String,
      trim: true,
      default: "Gmail",
    },
    emailHost: {
      type: String,
      trim: true,
      default: "",
    },
    emailPort: {
      type: Number,
      default: 465,
      min: 1,
      max: 65535,
    },
    emailSecure: {
      type: Boolean,
      default: true,
    },
    replyTo: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    lastTestedAt: {
      type: Date,
      default: null,
    },
    lastTestStatus: {
      type: String,
      enum: ["success", "failed", "not_tested"],
      default: "not_tested",
    },
    lastTestMessage: {
      type: String,
      default: "",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EmailSettings", emailSettingsSchema);
