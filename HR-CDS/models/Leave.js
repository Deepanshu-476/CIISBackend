const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['applied', 'approved', 'rejected', 'cancelled', 'updated'],
    required: true
  },
  by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'user', 'hr', 'manager', 'intern'],
    default: 'user'
  },
  remarks: {
    type: String,
    trim: true,
    default: ''
  },
  at: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const leaveSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['Casual', 'Sick', 'Paid', 'Unpaid', 'Other'],
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  days: {
    type: Number,
    required: true,
    min: 1
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
    default: 'Pending'
  },
  approvedBy: {
    type: String,
    default: null
  },
  remarks: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  },
  history: [historySchema],
  
  // For offline sync
  syncStatus: {
    type: String,
    enum: ['synced', 'pending', 'conflict'],
    default: 'synced'
  },
  lastSynced: {
    type: Date,
    default: Date.now
  },
  deviceId: String, // For tracking which device created the leave

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for better performance
leaveSchema.index({ user: 1, startDate: -1 });
leaveSchema.index({ user: 1, status: 1 });
leaveSchema.index({ status: 1, startDate: -1 });
leaveSchema.index({ user: 1, type: 1 });
leaveSchema.index({ 'user.department': 1, status: 1 });
leaveSchema.index({ syncStatus: 1, lastSynced: -1 });

// Virtual for leave duration
leaveSchema.virtual('duration').get(function() {
  return this.days + ' day' + (this.days > 1 ? 's' : '');
});

// Virtual for formatted dates
leaveSchema.virtual('formattedStartDate').get(function() {
  return this.startDate.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
});

leaveSchema.virtual('formattedEndDate').get(function() {
  return this.endDate.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
});

// Virtual for department (populated from user)
leaveSchema.virtual('department', {
  ref: 'User',
  localField: 'user',
  foreignField: '_id',
  justOne: true,
  options: { select: 'department' }
});

// Method to check if leave is upcoming
leaveSchema.methods.isUpcoming = function() {
  return this.startDate > new Date() && this.status === 'Approved';
};

// Method to check if leave is in progress
leaveSchema.methods.isInProgress = function() {
  const today = new Date();
  return this.startDate <= today && this.endDate >= today && this.status === 'Approved';
};

// Method to check if leave is past
leaveSchema.methods.isPast = function() {
  return this.endDate < new Date();
};

// Pre-save middleware to update sync timestamp
leaveSchema.pre('save', function(next) {
  this.lastSynced = new Date();
  next();
});

// Pre-find middleware to add department filter for managers
leaveSchema.statics.findByManager = function(managerDept) {
  return this.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userInfo'
      }
    },
    {
      $unwind: '$userInfo'
    },
    {
      $match: {
        'userInfo.department': managerDept
      }
    }
  ]);
};

module.exports = mongoose.model("Leave", leaveSchema);