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
    const defaultPrimary = (process.env.GROQ_API_KEY || "").trim();
    const defaultSecondary = (process.env.GROQ_API_KEY_SECONDARY || "").trim();
    const initialVault = [];
    let pVaultId = null;
    let sVaultId = null;

    if (defaultPrimary) {
      pVaultId = new mongoose.Types.ObjectId().toString();
      initialVault.push({
        id: pVaultId,
        label: "Environment Primary Key",
        apiKey: defaultPrimary,
        status: "untested",
        addedAt: new Date(),
      });
    }

    if (defaultSecondary) {
      sVaultId = new mongoose.Types.ObjectId().toString();
      initialVault.push({
        id: sVaultId,
        label: "Environment Secondary Fallback",
        apiKey: defaultSecondary,
        status: "untested",
        addedAt: new Date(),
      });
    }

    settings = await this.create({
      primaryApiKey: defaultPrimary,
      secondaryApiKey: defaultSecondary,
      primaryVaultId: pVaultId,
      secondaryVaultId: sVaultId,
      keyVault: initialVault,
      selectedModel: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
      selectedSttModel: process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo",
      testStatus: "untested",
    });
  } else {
    // If settings already existed from previous version but keyVault is empty and primaryApiKey exists, migrate it
    if ((!settings.keyVault || settings.keyVault.length === 0) && (settings.primaryApiKey || settings.secondaryApiKey)) {
      const initialVault = [];
      if (settings.primaryApiKey) {
        const pId = new mongoose.Types.ObjectId().toString();
        settings.primaryVaultId = pId;
        initialVault.push({
          id: pId,
          label: "Primary Production Key",
          apiKey: settings.primaryApiKey,
          status: settings.testStatus || "untested",
          lastTestedAt: settings.lastTestedAt || null,
          addedAt: new Date(),
        });
      }
      if (settings.secondaryApiKey) {
        const sId = new mongoose.Types.ObjectId().toString();
        settings.secondaryVaultId = sId;
        initialVault.push({
          id: sId,
          label: "Secondary Fallback Key",
          apiKey: settings.secondaryApiKey,
          status: "untested",
          addedAt: new Date(),
        });
      }
      settings.keyVault = initialVault;
      await settings.save();
    }
  }
  return settings;
};

module.exports = mongoose.models.AiSettings || mongoose.model("AiSettings", aiSettingsSchema);
