// models/Branch.js
const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Branch name is required"],
      trim: true,
      maxlength: [100, "Branch name cannot exceed 100 characters"],
    },
    
    branchCode: {
      type: String,
      required: [true, "Branch code is required"],
      uppercase: true,
      trim: true,
      minlength: [2, "Branch code must be at least 2 characters"],
      maxlength: [10, "Branch code cannot exceed 10 characters"],
    },

    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company is required"],
      index: true
    },

    companyCode: {
      type: String,
      required: [true, "Company code is required"],
      uppercase: true,
      trim: true,
      index: true
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    isDefault: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Ensure that branch name is unique within the same company
branchSchema.index({ name: 1, company: 1 }, { unique: true });

// Ensure that branch code is unique within the same company
branchSchema.index({ branchCode: 1, company: 1 }, { unique: true });

module.exports = mongoose.model("Branch", branchSchema);
