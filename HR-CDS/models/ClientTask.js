const mongoose = require('mongoose');

const normalizeClientTaskPriority = value => {
  const priority = String(value || '').trim().toLowerCase();
  if (priority === 'low') return 'Low';
  if (priority === 'high') return 'High';
  return 'Medium';
};

const clienttaskSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  subscriptionNo: {
    type: Number,
    default: null,
    index: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClientPlan',
    default: null
  },
  planName: {
    type: String,
    trim: true,
    default: ''
  },
  templateTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  isPlanTask: {
    type: Boolean,
    default: false
  },
  service: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: [true, 'Task name is required'],
    trim: true,
    maxlength: [200, 'Task name cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  dueDate: {
    type: Date,
    default: null
  },
  dueDateSource: {
    type: String,
    enum: ['subscription', 'manual'],
    default: 'subscription'
  },
  assignee: {
    type: String,
    trim: true,
    default: '',
  },
  assigneeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium',
    set: normalizeClientTaskPriority
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'completed', 'overdue', 'onhold'],
    default: 'pending'
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date,
    default: null
  },
  timeSpent: {
    type: Number,
    default: 0
  },
  inProgressSince: {
    type: Date,
    default: null
  },
  holdStartedAt: {
    type: Date,
    default: null
  },
  totalHoldSeconds: {
    type: Number,
    default: 0
  },
  files: [{
    filename: String,
    originalName: String,
    path: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now }
  }],
  checkpoints: [{
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now }
  }],
  remarks: [{
    text: String,
    images: [{
      url: String,
      filename: String,
      originalName: String,
      size: Number,
      mimeType: String,
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      uploadedAt: { type: Date, default: Date.now }
    }],
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    createdAt: { type: Date, default: Date.now }
  }],
  activityLogs: [{
    action: String,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    description: String,
    oldValues: mongoose.Schema.Types.Mixed,
    newValues: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


clienttaskSchema.index({ clientId: 1, service: 1 });
clienttaskSchema.index({ clientId: 1, subscriptionId: 1 });
clienttaskSchema.index({ clientId: 1, completed: 1 });
clienttaskSchema.index({ dueDate: 1 });
clienttaskSchema.index({ assignee: 1 });
clienttaskSchema.index({ assigneeId: 1 });
clienttaskSchema.index({ assigneeId: 1, createdAt: -1 });
clienttaskSchema.index({ assignee: 1, createdAt: -1 });
clienttaskSchema.index({ status: 1 });
clienttaskSchema.index({ priority: 1 });
clienttaskSchema.index({ createdAt: -1 });
clienttaskSchema.index({ 'activityLogs.createdAt': -1 });
clienttaskSchema.index({ 'remarks.createdAt': -1 });


clienttaskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || this.completed) return false;
  const status = String(this.status || 'pending').trim().toLowerCase();
  if (['completed', 'onhold', 'on hold'].includes(status)) return false;
  const dueDate = new Date(this.dueDate);
  if (Number.isNaN(dueDate.getTime())) return false;
  return dueDate < new Date();
});


clienttaskSchema.pre('save', function(next) {
  if (this.isModified('completed')) {
    if (this.completed && !this.completedAt) {
      this.completedAt = new Date();
      this.status = 'completed';
    } else if (!this.completed) {
      this.completedAt = null;
      if (this.status === 'completed') {
        this.status = 'pending';
      }
    }
  }
  next();
});

module.exports = mongoose.model('ClientTask', clienttaskSchema);
