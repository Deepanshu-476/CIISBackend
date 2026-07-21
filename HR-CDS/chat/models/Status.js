const mongoose = require("mongoose");

const statusSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ["text", "image", "video"],
    required: true,
  },
  text: { type: String, trim: true, maxlength: 500, default: "" },
  mediaUrl: { type: String, default: "" },
  mimeType: { type: String, default: "" },
  viewedBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    viewedAt: { type: Date, default: Date.now },
  }],
  expiresAt: {
    type: Date,
    required: true,
  },
}, { timestamps: true });

statusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
statusSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.model("ChatStatus", statusSchema);
