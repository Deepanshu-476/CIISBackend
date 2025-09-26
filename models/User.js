const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const crypto = require("crypto");
const { type } = require("os");

const userSchema = new mongoose.Schema({
  // Core Fields
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    minlength: [2, "Name must be at least 2 characters"],
    maxlength: [50, "Name cannot exceed 50 characters"]
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: validator.isEmail,
      message: "Please provide a valid email"
    }
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: [8, "Password must be at least 8 characters"],
    select: false
  },
  role: {
    type: String,
    enum: ['admin', 'user', 'hr', 'manager'],
    default: 'user'
  },

  // Extended Fields (for 'user' role)
  phone: String,
  address: String,
  gender: String,
  maritalStatus: String,
  dob: Date,
  salary: String,

  // Bank Details
  accountNumber: String,
  ifsc: String,
  bankName: String,
  bankHolderName: String,

  // Assets
  employeeType: {
    type: String,
    enum: ['intern', 'technical', 'non-technical', 'sales'],
  },
  jobRole: String,
  properties: {
    type: [String],
    enum: ['sim', 'phone', 'laptop', 'desktop', 'headphones'],
    default: ['sim']
  },
  propertyOwned: String,
  additionalDetails: String,

  // Family Details
  fatherName: String,
  motherName: String,

  // Emergency Details
  emergencyName: String,
  emergencyPhone: String,
  emergencyRelation: String,
  emergencyAddress: String,

  // Security & Meta
  resetToken: {
    type: String,
    select: false
  },
  resetTokenExpiry: {
    type: Date,
    select: false
  },
  lastPasswordChange: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  failedLoginAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  accountLockedUntil: {
    type: Date,
    select: false
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Password hashing middleware
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    this.password = await bcrypt.hash(this.password, 12);
    this.lastPasswordChange = Date.now();
    next();
  } catch (err) {
    next(err);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to generate password reset token
userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString("hex");

  this.resetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  this.resetTokenExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Query helper to exclude inactive users by default
userSchema.query.active = function () {
  return this.where({ isActive: true });
};

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ resetToken: 1 });
userSchema.index({ role: 1 });

module.exports = mongoose.model("User", userSchema);
