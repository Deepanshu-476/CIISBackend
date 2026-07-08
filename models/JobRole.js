const mongoose = require("mongoose");

const jobRoleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Job role name is required"],
    trim: true,
    maxlength: [50, "Job role name cannot exceed 50 characters"]
  },
  description: {
    type: String,
    maxlength: [200, "Description cannot exceed 200 characters"]
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    required: true
  },
  companyCode: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  shiftSettings: {
    shiftStart: { type: String, default: "09:00" },
    shiftEnd: { type: String, default: "19:00" },
    earlyClockInStart: { type: String, default: "08:30" },
    lateGraceLimit: { type: String, default: "09:10" },
    halfDayLateLimit: { type: String, default: "11:00" },
    shortLeaveEarlyLimit: { type: String, default: "18:30" },
    halfDayEarlyLimit: { type: String, default: "15:00" },
    secondHalfStart: { type: String, default: "14:00" },
    secondHalfClockInWindow: {
      start: { type: String, default: "13:30" },
      end: { type: String, default: "14:30" }
    }
  }
}, {
  timestamps: true
});


jobRoleSchema.index({ name: 1, department: 1, company: 1 }, { 
  unique: true,
  partialFilterExpression: { isActive: true }
});


jobRoleSchema.pre('save', async function(next) {
  if (this.isModified('isActive') && !this.isActive) {
    const User = mongoose.model('User');
    const usersCount = await User.countDocuments({ 
      jobRole: this._id, 
      isActive: true 
    });
    
    if (usersCount > 0) {
      next(new Error('Cannot delete job role with active users'));
    }
  }
  next();
});

module.exports = mongoose.model("JobRole", jobRoleSchema);