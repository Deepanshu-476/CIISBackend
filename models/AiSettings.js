const mongoose = require("mongoose");

const aiSettingsSchema = new mongoose.Schema(
  {
    primaryApiKey: {
      type: String,
      trim: true,
      default: "",
    },
    secondaryApiKey: {
      type: String,
      trim: true,
      default: "",
    },
    selectedModel: {
      type: String,
      trim: true,
      default: "qwen/qwen3.8-27b",
    },
    selectedSttModel: {
      type: String,
      trim: true,
      default: "whisper-large-v3-turbo",
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
    lastTestedAt: {
      type: Date,
      default: null,
    },
    testStatus: {
      type: String,
      enum: ["valid", "invalid", "untested"],
      default: "untested",
    },
    testMessage: {
      type: String,
      default: "",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Singleton pattern helper: ensures only one active configuration document exists
aiSettingsSchema.statics.getOrCreateSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      primaryApiKey: (process.env.GROQ_API_KEY || "").trim(),
      secondaryApiKey: (process.env.GROQ_API_KEY_SECONDARY || "").trim(),
      selectedModel: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
      selectedSttModel: process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo",
      testStatus: "untested",
    });
  }
  return settings;
};

module.exports = mongoose.models.AiSettings || mongoose.model("AiSettings", aiSettingsSchema);
