const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const crypto = require("crypto");

const userDocumentSchema = new mongoose.Schema({
  name: String,
  type: String,
  url: String,
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const userSchema = new mongoose.Schema({
  
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

  
  branch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    index: true
  },

  assignedBranches: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Branch",
    index: true
  }],
  
  branchCode: {
    type: String, 
    index: true
  },
  
  
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
   
    required: [true, "Job role is required"],
    default: 'user'
  },

  shiftId: {
    type: String,
    trim: true
  },
  shiftName: {
    type: String,
    trim: true
  },
  shiftType: {
    type: String,
    trim: true
  },
  
  
  
  
  

  
  phone: String,
  profileImage: String,
  address: String,
  city: String,
  state: String,
  country: String,
  pinCode: String,
  zipCode: String,
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  maritalStatus: {
    type: String,
    enum: ['single', 'married', 'divorced', 'widowed']
  },
  dob: Date,
  aadharCard: String,
  aadhaar: String,
  aadhar: String,
  panCard: String,
  pan: String,
  salary: Number,
  
  
  accountNumber: String,
  ifsc: String,
  bankName: String,
  bankHolderName: String,
  
  
  employeeType: {
    type: String,
    
  },
  workLocation: String,
  noticePeriod: String,
  shift: String,
  dateOfJoining: Date,
  employeeId: {
    type: String,
    unique: true,
    sparse: true
  },
  
  
  properties: {
    type: [String],
    enum: ['sim', 'phone', 'laptop', 'desktop', 'headphones', 'tablet', 'vehicle'],
    default: []
  },
  propertyOwned: String,
  additionalDetails: String,
  
  
  fatherName: String,
  motherName: String,
  spouseName: String,
  children: [{
    name: String,
    age: Number,
    dob: Date
  }],
  
  
  emergencyName: String,
  emergencyPhone: String,
  emergencyRelation: String,
  emergencyAddress: String,
  
  
  companyRole: {
  type: String,
  default: "employee"
},
  
  
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
  
  
  isActive: {
    type: Boolean,
    default: true
  },
  isOnline: {
    type: Boolean,
    default: false,
    index: true
  },
  lastSeen: {
    type: Date,
    default: null
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String,
    select: false
  },
  
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  
  notificationPreferences: {
    push: {
      type: Boolean,
      default: true
    },
    web: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: false
    },
    channels: {
      taskAssigned: { type: Boolean, default: true }, 
      taskClient: { type: Boolean, default: true }, 
      leave: { type: Boolean, default: true },
      assets: { type: Boolean, default: true },
      projects: { type: Boolean, default: true },
      chats: { type: Boolean, default: true },
      attendance: { type: Boolean, default: true }
    },
    
    quietHours: {
      start: { type: String, default: null },
      end: { type: String, default: null }
    }
  },

  chatSettings: {
    about: { type: String, default: 'Available' },
    blockedContacts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    privacy: {
      lastSeen: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
      profilePhoto: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
      readReceipts: { type: Boolean, default: true },
      groups: { type: String, enum: ['everyone', 'contacts'], default: 'everyone' }
    },
    chats: {
      theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
      enterToSend: { type: Boolean, default: true },
      mediaAutoDownload: { type: Boolean, default: true },
      wallpaper: { type: String, default: '' }
    },
    videoVoice: {
      cameraEnabled: { type: Boolean, default: true },
      microphoneEnabled: { type: Boolean, default: true },
      speakerEnabled: { type: Boolean, default: true }
    },
    general: {
      startWithSystem: { type: Boolean, default: false },
      keepLoggedIn: { type: Boolean, default: true },
      compactMode: { type: Boolean, default: true }
    },
    keyboard: {
      enabled: { type: Boolean, default: true },
      sendMessage: { type: String, default: 'Enter' },
      newLine: { type: String, default: 'Shift+Enter' }
    }
  },

  
assets: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Asset'
}],
currentlyAssignedAssets: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Asset'
}],
  
  reportingManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  
  
  documents: {
    type: [userDocumentSchema],
    default: []
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});



userSchema.index({ company: 1, email: 1 }, { unique: true });


userSchema.index({ company: 1, jobRole: 1 });
userSchema.index({ company: 1, department: 1 });
userSchema.index({ company: 1, isActive: 1 });
userSchema.index({ company: 1, employeeType: 1 });


userSchema.pre("save", async function (next) {
  
  if (!this.employeeId && this.companyCode) {
    const count = await mongoose.model("User").countDocuments({ 
      company: this.company,
      companyCode: this.companyCode 
    });
    this.employeeId = `${this.companyCode}-EMP-${String(count + 1).padStart(4, '0')}`;
  }

  
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



userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};


userSchema.methods.generateResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.resetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  this.resetTokenExpiry = Date.now() + 30 * 60 * 1000; 
  
  return resetToken;
};


userSchema.methods.generateVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  
  this.verificationToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
    
  return token;
};


userSchema.methods.isLocked = function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};


userSchema.methods.incrementLoginAttempts = function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 30 * 60 * 1000 }; 
  }
  
  return this.updateOne(updates);
};


userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $set: { 
      loginAttempts: 0,
      lastLogin: Date.now() 
    },
    $unset: { lockUntil: 1 }
  });
};


userSchema.virtual('fullName').get(function () {
  return this.name;
});

userSchema.virtual('age').get(function () {
  if (!this.dob) return null;
  const diff = Date.now() - this.dob.getTime();
  const age = new Date(diff);
  return Math.abs(age.getUTCFullYear() - 1970);
});



userSchema.query.active = function () {
  return this.where({ isActive: true });
};


userSchema.query.byCompany = function (companyId) {
  return this.where({ company: companyId });
};


userSchema.query.byRole = function (role) {
  return this.where({ jobRole: role });
};



userSchema.statics.findByEmailAndCompany = function (email, companyId) {
  return this.findOne({ 
    email: email.toLowerCase(), 
    company: companyId 
  });
};


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



userSchema.path('email').validate(function (email) {
  return validator.isEmail(email);
}, 'Invalid email format');


userSchema.path('phone').validate(function (phone) {
  if (!phone) return true;
  return /^[0-9]{10}$/.test(phone);
}, 'Phone number must be 10 digits');

module.exports = mongoose.model("User", userSchema);
