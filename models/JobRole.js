const mongoose = require("mongoose");

const shiftDefaults = () => ({
  shiftId: new mongoose.Types.ObjectId().toString(),
  shiftName: "General Shift",
  shiftType: "general",
  shiftStart: "09:00",
  shiftEnd: "19:00",
  earlyClockInStart: "08:30",
  lateGraceLimit: "09:10",
  halfDayLateLimit: "11:00",
  shortLeaveEarlyLimit: "18:30",
  halfDayEarlyLimit: "15:00",
  secondHalfStart: "14:00",
  secondHalfClockInWindow: {
    start: "13:30",
    end: "14:30"
  }
});

const shiftSettingsSchema = new mongoose.Schema({
  shiftId: { type: String, default: () => new mongoose.Types.ObjectId().toString(), trim: true },
  shiftName: { type: String, default: "General Shift", trim: true },
  shiftType: { type: String, default: "general", trim: true },
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
}, { _id: false });

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
    type: shiftSettingsSchema,
    default: shiftDefaults
  },
  shifts: {
    type: [shiftSettingsSchema],
    default: () => [shiftDefaults()]
  }
}, {
  timestamps: true
});


jobRoleSchema.index({ name: 1, department: 1, company: 1 }, { 
  unique: true,
  partialFilterExpression: { isActive: true }
});
jobRoleSchema.index({ company: 1, isActive: 1, createdAt: -1 });
jobRoleSchema.index({ company: 1, department: 1, isActive: 1 });
jobRoleSchema.index({ company: 1, department: 1, isActive: 1, createdAt: -1 });
jobRoleSchema.index({ companyCode: 1, isActive: 1 });


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
