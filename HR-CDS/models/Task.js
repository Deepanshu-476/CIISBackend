const mongoose = require('mongoose');

// ------------------ Sub-schemas ------------------

// Sub-schema for status history
const statusHistorySchema = new mongoose.Schema({
 status: {
  type: String,
  enum: [
    'pending',
    'in-progress',
    'completed',
    'approved',
    'rejected',
    'on-hold',   // 🟡 added new status
    'reopen'     // 🟢 added new status
  ],
  required: true,
  default: 'pending' // optional but good practice
},

  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  changedAt: {
    type: Date,
    default: Date.now
  },
  remarks: String
}, { _id: false });

// Sub-schema for remarks/comments
const remarkSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Sub-schema for status tracking by user
const statusSchema = new mongoose.Schema(
  {
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    status: {
      type: String,
      enum: [
        'pending',
        'in-progress',
        'completed',
        'approved',
        'rejected',
        'on-hold',   // 🟡 added new
        'reopen'     // 🔄 added new
      ],
      default: 'pending'
    },
    updatedAt: {
      type: Date,
      default: Date.now
    },
    remarks: {
      type: String,
      trim: true,
    }
  },
  { _id: false }
);

// Sub-schema for file attachments
const fileSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  path: String,
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Sub-schema for PDF files
const pdfFileSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  path: String,
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// Sub-schema for voice note
const voiceNoteSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  path: String,
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// ------------------ Main Task Schema ------------------

const taskSchema = new mongoose.Schema({
  serialNo: {
    type: Number,
    default: null
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  dueDateTime: {
    type: Date
  },
  whatsappNumber: {
    type: String,
    trim: true
  },
  priorityDays: {
    type: String,
    enum: ['1', '2', '3', '4', '5', '6', '7'],
    default: '1'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },

  // Assignments
  assignedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  assignedGroups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  statusByUser: [statusSchema],

  // Activity tracking
  statusHistory: [statusHistorySchema],
  remarks: [remarkSchema],

  // File uploads
  files: [fileSchema],
  pdfFiles: [pdfFileSchema],
  voiceNote: voiceNoteSchema,

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Repeat / recurrence fields
  repeatPattern: {
    type: String,
    enum: ['none', 'daily', 'weekly', 'monthly'],
    default: 'none'
  },
  repeatDays: [{
    type: String,
    enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  }],
  parentTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  nextOccurrence: Date,
  recurrenceEndDate: Date,
  recurrenceCount: {
    type: Number,
    default: 0
  },

  // Status tracking
overallStatus: {
  type: String,
  enum: [
    'pending',
    'in-progress',
    'completed',
    'approved',
    'rejected',
    'cancelled',
    'on-hold',   // 🟡 added
    'reopen'     // 🔄 added
  ],
  default: 'pending'
},

  completionDate: Date,

  // Activity
  lastActivityAt: {
    type: Date,
    default: Date.now
  },

  // Soft delete
  isActive: {
    type: Boolean,
    default: true
  },

  // Metadata
  tags: [{ type: String, trim: true }],
  category: { type: String, trim: true }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ------------------ Indexes ------------------
taskSchema.index({ serialNo: 1 });
taskSchema.index({ dueDateTime: 1 });
taskSchema.index({ assignedUsers: 1 });
taskSchema.index({ createdBy: 1 });
taskSchema.index({ 'statusByUser.user': 1 });
taskSchema.index({ overallStatus: 1 });
taskSchema.index({ isActive: 1 });
taskSchema.index({ lastActivityAt: -1 });
taskSchema.index({ 'remarks.createdAt': -1 });
taskSchema.index({ 'statusHistory.changedAt': -1 });

// ------------------ Virtual Fields ------------------
taskSchema.virtual('isOverdue').get(function () {
  if (!this.dueDateTime) return false;
  return this.dueDateTime < new Date() && !['completed', 'approved', 'cancelled'].includes(this.overallStatus);
});

taskSchema.virtual('daysUntilDue').get(function () {
  if (!this.dueDateTime) return null;
  const diff = this.dueDateTime - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

taskSchema.virtual('urgencyLevel').get(function () {
  if (this.isOverdue) return 'overdue';
  const days = this.daysUntilDue;
  if (days === null) return 'no-due-date';
  if (days <= 1) return 'high';
  if (days <= 3) return 'medium';
  return 'low';
});

// ------------------ Instance Methods ------------------

// Update status and history
taskSchema.methods.updateUserStatus = function (userId, status, remarks = '') {
  const existing = this.statusByUser.find(s => s.user.toString() === userId.toString());
  const oldStatus = existing ? existing.status : 'pending';

  if (existing) {
    existing.status = status;
    existing.updatedAt = new Date();
    if (remarks) existing.remarks = remarks;
  } else {
    this.statusByUser.push({ user: userId, status, remarks });
  }

  this.statusHistory.push({
    status,
    changedBy: userId,
    changedAt: new Date(),
    remarks: remarks || `Status changed from ${oldStatus} to ${status}`
  });

  this.lastActivityAt = new Date();
  this.updateOverallStatus();
};

// Update overall status
taskSchema.methods.updateOverallStatus = function () {
  const statuses = this.statusByUser.map(s => s.status);

  // 🟢 Priority-based evaluation (from strongest to weakest)
  if (statuses.includes('cancelled')) {
    this.overallStatus = 'cancelled';
  } 
  else if (statuses.includes('rejected')) {
    this.overallStatus = 'rejected';
  } 
  else if (statuses.includes('on-hold')) {
    this.overallStatus = 'on-hold';
  } 
  else if (statuses.includes('reopen')) {
    this.overallStatus = 'reopen';
  } 
  else if (statuses.every(s => s === 'approved')) {
    this.overallStatus = 'approved';
  } 
  else if (statuses.every(s => s === 'completed')) {
    this.overallStatus = 'completed';
  } 
  else if (statuses.includes('in-progress')) {
    this.overallStatus = 'in-progress';
  } 
  else {
    this.overallStatus = 'pending';
  }

  // Optional timestamp updates (if you track dates)
  if (this.overallStatus === 'completed') this.completionDate = new Date();
  if (this.overallStatus === 'on-hold') this.holdDate = new Date();
  if (this.overallStatus === 'reopen') this.reopenedAt = new Date();
};


// Add remark
taskSchema.methods.addRemark = function (userId, text) {
  this.remarks.push({ user: userId, text });
  this.lastActivityAt = new Date();
};

// Calculate next occurrence for recurring tasks
taskSchema.methods.calculateNextOccurrence = function () {
  if (!this.isRecurring || !this.dueDateTime) return null;
  const next = new Date(this.dueDateTime);
  if (this.repeatPattern === 'daily') next.setDate(next.getDate() + 1);
  if (this.repeatPattern === 'weekly') next.setDate(next.getDate() + 7);
  if (this.repeatPattern === 'monthly') next.setMonth(next.getMonth() + 1);
  return next;
};

// Soft delete / restore
taskSchema.methods.softDelete = function () {
  this.isActive = false;
  return this.save();
};
taskSchema.methods.restore = function () {
  this.isActive = true;
  return this.save();
};

// ------------------ Static Methods ------------------
taskSchema.statics.getNextSerialNo = async function () {
  const last = await this.findOne().sort({ serialNo: -1 });
  return last ? last.serialNo + 1 : 1;
};

taskSchema.statics.findActive = function () {
  return this.find({ isActive: true });
};

// Pre-save hook for serial numbers
taskSchema.pre('save', async function (next) {
  if (this.isNew && !this.serialNo) this.serialNo = await this.constructor.getNextSerialNo();
  if (this.repeatPattern && this.repeatPattern !== 'none') {
    this.isRecurring = true;
    this.nextOccurrence = this.calculateNextOccurrence();
  } else {
    this.isRecurring = false;
  }
  next();
});

module.exports = mongoose.model('Task', taskSchema);
