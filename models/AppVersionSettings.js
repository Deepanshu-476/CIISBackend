const mongoose = require("mongoose");

const platformVersionSchema = new mongoose.Schema(
  {
    latestVersionName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 40,
    },
    latestVersionCode: {
      type: Number,
      default: 1,
      min: 0,
    },
    minimumVersionCode: {
      type: Number,
      default: 1,
      min: 0,
    },
    forceUpdate: {
      type: Boolean,
      default: false,
    },
    updateEnabled: {
      type: Boolean,
      default: true,
    },
    title: {
      type: String,
      trim: true,
      default: "New Update Available",
      maxlength: 120,
    },
    message: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
    storeUrl: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
    appIdentifier: {
      type: String,
      trim: true,
      default: "",
      maxlength: 120,
    },
    storeId: {
      type: String,
      trim: true,
      default: "",
      maxlength: 80,
    },
  },
  { _id: false }
);

const appVersionSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
      immutable: true,
    },
    ios: {
      type: platformVersionSchema,
      default: () => ({}),
    },
    android: {
      type: platformVersionSchema,
      default: () => ({}),
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppVersionSettings", appVersionSettingsSchema);
