const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  action: {
    type: String,

    required: true
  },
  by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    
    default: 'user'
  },
  remarks: {
    type: String,
    trim: true,
    default: ''
  },

  from: { type: String, trim: true, default: '' },
  to: { type: String, trim: true, default: '' },
  previousLeaveType: { type: String, trim: true, default: '' },
  newLeaveType: { type: String, trim: true, default: '' },
  previousPayType: { type: String, trim: true, default: '' },
  newPayType: { type: String, trim: true, default: '' },



  at: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const approvalStepSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  remarks: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  },
  actionedAt: {
    type: Date,
    default: null
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

    required: true
  },
  leavePolicy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeavePolicy',
    default: null
  },
  payType: {
    type: String,
    enum: ['Paid', 'Unpaid', 'Admin Choice'],
    default: 'Paid'
  },
  policySnapshot: {
    policyName: String,
    payType: String,
    entitledDays: Number,
    monthlyAllowed: Number,
    carryForward: String,
    maxCarryForwardDays: Number,
    encashmentAllowed: String,
    probationApplicable: String
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
   
    default: 'Pending'
  },
  approvals: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({
      manager: { status: 'Pending', remarks: '', actionedAt: null, by: null },
      hr: { status: 'Pending', remarks: '', actionedAt: null, by: null },
      owner: { status: 'Pending', remarks: '', actionedAt: null, by: null }
    })
  },
  approvedBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  default: null
},
  approvalSteps: [approvalStepSchema],
  approvalMode: {
    type: String,
    enum: ['single', 'all'],
    default: 'single'
  },
  remarks: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  },
  cancellationReason: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  },
  cancelledAt: {
    type: Date,
    default: null
  },
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  companyCode: {
    type: String,
    required: true,
    index: true,
    default: ''
  },
  
  history: [historySchema],
  
  
  syncStatus: {
    type: String,
    enum: ['synced', 'pending', 'conflict'],
    default: 'synced'
  },
  lastSynced: {
    type: Date,
    default: Date.now
  },
  deviceId: String, 

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


leaveSchema.index({ user: 1, startDate: -1 });
leaveSchema.index({ user: 1, status: 1 });
leaveSchema.index({ companyCode: 1, status: 1, startDate: -1 });
leaveSchema.index({ status: 1, startDate: -1 });
leaveSchema.index({ user: 1, type: 1 });
leaveSchema.index({ 'user.department': 1, status: 1 });
leaveSchema.index({ syncStatus: 1, lastSynced: -1 });


leaveSchema.virtual('duration').get(function() {
  return this.days + ' day' + (this.days > 1 ? 's' : '');
});


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


leaveSchema.virtual('department', {
  ref: 'User',
  localField: 'user',
  foreignField: '_id',
  justOne: true,
  options: { select: 'department' }
});


leaveSchema.methods.isUpcoming = function() {
  return this.startDate > new Date() && this.status === 'Approved';
};


leaveSchema.methods.isInProgress = function() {
  const today = new Date();
  return this.startDate <= today && this.endDate >= today && this.status === 'Approved';
};


leaveSchema.methods.isPast = function() {
  return this.endDate < new Date();
};

const APPROVAL_ROLES = ['manager', 'hr', 'owner'];

const buildDefaultApproval = () => ({
  status: 'Pending',
  remarks: '',
  actionedAt: null,
  by: null
});

leaveSchema.statics.defaultApprovals = function() {
  return APPROVAL_ROLES.reduce((acc, role) => {
    acc[role] = buildDefaultApproval();
    return acc;
  }, {});
};

leaveSchema.statics.normalizeApprovals = function(approvals = {}) {
  const defaults = this.defaultApprovals();

  if (!approvals || typeof approvals !== 'object' || Array.isArray(approvals)) {
    return defaults;
  }

  return APPROVAL_ROLES.reduce((acc, role) => {
    const current = approvals[role];

    if (current && typeof current === 'object' && !Array.isArray(current)) {
      acc[role] = {
        ...defaults[role],
        ...current,
        status: current.status || defaults[role].status,
        remarks: current.remarks || '',
        actionedAt: current.actionedAt || null,
        by: current.by || current.user || null
      };
    } else if (typeof current === 'string') {
      acc[role] = {
        ...defaults[role],
        status: current
      };
    } else {
      acc[role] = defaults[role];
    }

    return acc;
  }, {});
};

leaveSchema.statics.withApprovalDefaults = function(leave) {
  if (!leave) return leave;

  const plainLeave = typeof leave.toObject === 'function'
    ? leave.toObject({ virtuals: true })
    : { ...leave };

  return {
    ...plainLeave,
    approvals: this.normalizeApprovals(plainLeave.approvals),
    approvalSteps: plainLeave.approvalSteps || [],
    approvalMode: plainLeave.approvalMode || 'single',
    history: plainLeave.history || [],
    remarks: plainLeave.remarks || '',
    status: plainLeave.status || 'Pending'
  };
};


leaveSchema.pre('save', function(next) {
  this.lastSynced = new Date();
  next();
});


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
