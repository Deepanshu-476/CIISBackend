const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const crypto = require("crypto");

const userSchema = new mongoose.Schema({
  // Core Fields (Required)
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
  department: {
    type: String,
    required: [true, "Department is required"],
  },
  jobRole: {
    type: String,
    enum: ['admin', 'user', 'hr', 'manager', 'SuperAdmin'],
    required: [true, "Job role is required"],
    default: 'user'
  },

  // Optional Fields (Editable by anyone)
  phone: String,
  address: String,
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  maritalStatus: {
    type: String,
    enum: ['single', 'married', 'divorced', 'widowed']
  },
  dob: Date,
  salary: Number,
  
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
  properties: {
    type: [String],
    enum: ['sim', 'phone', 'laptop', 'desktop', 'headphones'],
    default: []
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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
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

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ department: 1 });
userSchema.index({ jobRole: 1 });

module.exports = mongoose.model("User", userSchema);