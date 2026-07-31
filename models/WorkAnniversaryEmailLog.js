const mongoose = require("mongoose");

const workAnniversaryEmailLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    companyCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    anniversaryYear: {
      type: Number,
      required: true,
    },
    completedYears: {
      type: Number,
      required: true,
      min: 1,
    },
    templateVersion: {
      type: String,
      default: "legacy",
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "skipped"],
      default: "pending",
    },
    sentAt: {
      type: Date,
      default: null,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
    },
    error: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

workAnniversaryEmailLogSchema.index(
  { user: 1, anniversaryYear: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "WorkAnniversaryEmailLog",
  workAnniversaryEmailLogSchema
);
