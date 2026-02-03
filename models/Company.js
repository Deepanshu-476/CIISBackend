// models/Company.js
const mongoose = require("mongoose");
const validator = require("validator");

const companySchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      unique: true,
      trim: true,
      minlength: [2, "Company name must be at least 2 characters"],
      maxlength: [100, "Company name cannot exceed 100 characters"],
    },

    companyEmail: {
      type: String,
      required: [true, "Company email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: validator.isEmail,
        message: "Please provide a valid company email",
      },
    },

    companyAddress: {
      type: String,
      required: [true, "Company address is required"],
      trim: true,
    },

    companyPhone: {
      type: String,
      required: [true, "Company phone is required"],
      unique: true,
      trim: true,
    },

    ownerName: {
      type: String,
      required: [true, "Owner name is required"],
      trim: true,
    },

    logo: {
      type: String,
      default: null,
    },

    // ✅ Auto-generated
    companyCode: {
      type: String,
      unique: true,
      uppercase: true,
      minlength: [3, "Company code must be at least 3 characters"],
      maxlength: [10, "Company code cannot exceed 10 characters"],
    },

    // ✅ Auto-generated
    loginUrl: {
      type: String,
      unique: true,
       default: function() {
      return `/company/${this.companyCode}/login`;
    }
    },

    // ✅ Auto-generated
    dbIdentifier: {
      type: String,
      unique: true,
    },

    // ✅ Auto-generated from email
    companyDomain: {
      type: String,
      default: null,
    },

    loginToken: {
      type: String,
      default: null,
      select: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    deactivatedAt: {
      type: Date,
      default: null,
    },

    subscriptionExpiry: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

// ✅ Pre-save hook
companySchema.pre("save", async function (next) {
  if (!this.isNew) return next();

  // ✅ companyCode
  if (!this.companyCode) {
    const code = this.companyName
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 6)
      .toUpperCase();

    this.companyCode = code || `CMP${Date.now().toString().slice(-4)}`;
  }

  // ✅ dbIdentifier
  if (!this.dbIdentifier) {
    this.dbIdentifier = `company_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
  }

  // ✅ companyDomain
  if (!this.companyDomain && this.companyEmail) {
    this.companyDomain = this.companyEmail.split("@")[1];
  }

  // ✅ loginUrl
  if (!this.loginUrl) {
    const urlCode = this.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .substring(0, 20);

    this.loginUrl = `/company/${urlCode}-${Date.now().toString(36)}/login`;
  }

  next();
});

// Indexes
companySchema.index({ companyCode: 1 });
companySchema.index({ companyEmail: 1 });
companySchema.index({ companyPhone: 1 });
companySchema.index({ loginUrl: 1 });
companySchema.index({ dbIdentifier: 1 });

module.exports = mongoose.model("Company", companySchema);
