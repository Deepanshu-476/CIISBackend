const mongoose = require("mongoose");

const keyVaultItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    apiKey: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["valid", "invalid", "untested"],
      default: "untested",
    },
    lastTestedAt: {
      type: Date,
      default: null,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

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
    primaryVaultId: {
      type: String,
      trim: true,
      default: null,
    },
    secondaryVaultId: {
      type: String,
      trim: true,
      default: null,
    },
    keyVault: {
      type: [keyVaultItemSchema],
      default: [],
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
      primaryApiKey: "",
      secondaryApiKey: "",
      primaryVaultId: null,
      secondaryVaultId: null,
      keyVault: [],
      selectedModel: "qwen/qwen3.8-27b",
      selectedSttModel: "whisper-large-v3-turbo",
      testStatus: "untested",
    });
  }
  return settings;
};

module.exports = mongoose.models.AiSettings || mongoose.model("AiSettings", aiSettingsSchema);
