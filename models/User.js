const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const crypto = require("crypto");

const userSchema = new mongoose.Schema({
  // ==================== COMPANY FIELD (NEW) ====================
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: [true, "Company is required"],
    index: true
  },
  
  companyCode: {
    type: String,
    required: [true, "Company code is required"],
    index: true
  },
  
  // ==================== CORE FIELDS ====================
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
    enum: ['admin', 'user', 'hr', 'manager', 'super_admin', 'intern', 'owner'],
    required: [true, "Job role is required"],
    default: 'user'
  },

  // ==================== PERSONAL INFORMATION ====================
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
  
  // ==================== BANK DETAILS ====================
  accountNumber: String,
  ifsc: String,
  bankName: String,
  bankHolderName: String,
  
  // ==================== EMPLOYMENT DETAILS ====================
  employeeType: {
    type: String,
    enum: ['intern', 'technical', 'non-technical', 'sales', 'management'],
  },
  employeeId: {
    type: String,
    unique: true,
    sparse: true
  },
  
  // ==================== ASSETS ====================
  properties: {
    type: [String],
    enum: ['sim', 'phone', 'laptop', 'desktop', 'headphones', 'tablet', 'vehicle'],
    default: []
  },
  propertyOwned: String,
  additionalDetails: String,
  
  // ==================== FAMILY DETAILS ====================
  fatherName: String,
  motherName: String,
  spouseName: String,
  children: [{
    name: String,
    age: Number,
    dob: Date
  }],
  
  // ==================== EMERGENCY DETAILS ====================
  emergencyName: String,
  emergencyPhone: String,
  emergencyRelation: String,
  emergencyAddress: String,
  
  // ==================== COMPANY-SPECIFIC FIELDS ====================
  companyRole: {
    type: String,
    default: 'employee'
  },
  
  // ==================== SECURITY & AUTHENTICATION ====================
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
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  lockUntil: {
    type: Date,
    select: false
  },
  
  // ==================== STATUS & META ====================
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String,
    select: false
  },
  
  // ==================== REFERENCES ====================
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  
  reportingManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  
  // ==================== DOCUMENTS ====================
  documents: [{
    name: String,
    type: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }]

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ==================== COMPOUND INDEXES ====================
// Unique email per company
userSchema.index({ company: 1, email: 1 }, { unique: true });

// For faster queries
userSchema.index({ company: 1, jobRole: 1 });
userSchema.index({ company: 1, department: 1 });
userSchema.index({ company: 1, isActive: 1 });
userSchema.index({ company: 1, employeeType: 1 });

// ==================== PRE-SAVE MIDDLEWARE ====================
userSchema.pre("save", async function (next) {
  // Generate employee ID if not present
  if (!this.employeeId && this.companyCode) {
    const count = await mongoose.model("User").countDocuments({ 
      company: this.company,
      companyCode: this.companyCode 
    });
    this.employeeId = `${this.companyCode}-EMP-${String(count + 1).padStart(4, '0')}`;
  }

  // Hash password if modified
  if (this.isModified("password")) {
    try {
      this.password = await bcrypt.hash(this.password, 12);
      this.lastPasswordChange = Date.now();
    } catch (err) {
      return next(err);
    }
  }
  
  next();
});

// ==================== INSTANCE METHODS ====================
// Compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate reset token
userSchema.methods.generateResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.resetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  this.resetTokenExpiry = Date.now() + 30 * 60 * 1000; // 30 minutes
  
  return resetToken;
};

// Generate verification token
userSchema.methods.generateVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  
  this.verificationToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
    
  return token;
};

// Check if account is locked
userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Increment login attempts
userSchema.methods.incrementLoginAttempts = function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 30 * 60 * 1000 }; // Lock for 30 minutes
  }
  
  return this.updateOne(updates);
};

// Reset login attempts on successful login
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $set: { 
      loginAttempts: 0,
      lastLogin: Date.now() 
    },
    $unset: { lockUntil: 1 }
  });
};

// ==================== VIRTUAL FIELDS ====================
userSchema.virtual('fullName').get(function () {
  return this.name;
});

userSchema.virtual('age').get(function () {
  if (!this.dob) return null;
  const diff = Date.now() - this.dob.getTime();
  const age = new Date(diff);
  return Math.abs(age.getUTCFullYear() - 1970);
});

// ==================== QUERY HELPERS ====================
// Active users query helper
userSchema.query.active = function () {
  return this.where({ isActive: true });
};

// By company query helper
userSchema.query.byCompany = function (companyId) {
  return this.where({ company: companyId });
};

// By job role query helper
userSchema.query.byRole = function (role) {
  return this.where({ jobRole: role });
};

// ==================== STATIC METHODS ====================
// Find by email and company
userSchema.statics.findByEmailAndCompany = function (email, companyId) {
  return this.findOne({ 
    email: email.toLowerCase(), 
    company: companyId 
  });
};

// Get all users by company
userSchema.statics.findByCompany = function (companyId, options = {}) {
  const { 
    activeOnly = true,
    sortBy = 'createdAt',
    sortOrder = -1 
  } = options;
  
  let query = this.find({ company: companyId });
  
  if (activeOnly) {
    query = query.where({ isActive: true });
  }
  
  return query.sort({ [sortBy]: sortOrder });
};

// Get statistics for company
userSchema.statics.getCompanyStats = async function (companyId) {
  const stats = await this.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { 
          $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] }
        },
        byRole: { $push: "$jobRole" },
        byDepartment: { $push: "$department" }
      }
    }
  ]);
  
  return stats[0] || { total: 0, active: 0, byRole: [], byDepartment: [] };
};

// ==================== VALIDATION ====================
// Validate email format
userSchema.path('email').validate(function (email) {
  return validator.isEmail(email);
}, 'Invalid email format');

// Validate phone if provided
userSchema.path('phone').validate(function (phone) {
  if (!phone) return true;
  return /^[0-9]{10}$/.test(phone);
}, 'Phone number must be 10 digits');

module.exports = mongoose.model("User", userSchema);