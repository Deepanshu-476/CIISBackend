const mongoose = require("mongoose");

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Plan name is required"],
      trim: true,
      unique: true,
      maxlength: [80, "Plan name cannot exceed 80 characters"],
    },
    price: {
      type: Number,
      required: [true, "Plan price is required"],
      min: [0, "Plan price cannot be negative"],
    },
    durationDays: {
      type: Number,
      required: [true, "Plan duration is required"],
      min: [1, "Plan duration must be at least 1 day"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    features: {
      type: [String],
      default: [],
    },
    allowedPages: {
      type: [String],
      default: [],
      validate: {
        validator: pages => Array.isArray(pages) && pages.length > 0,
        message: "Select at least one page for this plan",
      },
    },
    allowedSuperAdminPages: {
      type: [String],
      default: [],
    },
    aiDailyTokenLimit: {
      type: Number,
      default: 25000,
      min: [0, "AI daily token limit cannot be negative"],
    },
    aiDailyCallLimit: {
      type: Number,
      default: 35,
      min: [0, "AI daily call limit cannot be negative"],
    },
    aiDailySttLimit: {
      type: Number,
      default: 100,
      min: [0, "AI daily STT limit cannot be negative"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Plan", planSchema);
