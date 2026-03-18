const mongoose = require('mongoose');

const clienttaskSchema = new mongoose.Schema({
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
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
  assignee: {
    type: String,  // User ID or User Name
    trim: true,
    default: '',
    index: true     // Index for faster queries
  },
  assigneeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
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
  files: [{
    filename: String,
    path: String,
    uploadedAt: Date
  }],
  remarks: [{
    text: String,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    createdAt: { type: Date, default: Date.now }
  }],
  activityLogs: [{
    action: String,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    description: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
clienttaskSchema.index({ clientId: 1, service: 1 });
clienttaskSchema.index({ clientId: 1, completed: 1 });
clienttaskSchema.index({ dueDate: 1 });
clienttaskSchema.index({ assignee: 1 });  // Important for assigned-to-me queries
clienttaskSchema.index({ assigneeId: 1 });
clienttaskSchema.index({ status: 1 });
clienttaskSchema.index({ priority: 1 });
clienttaskSchema.index({ createdAt: -1 });

// Virtual for checking if task is overdue
clienttaskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || this.completed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(this.dueDate);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
});

// Pre-save middleware
clienttaskSchema.pre('save', function(next) {
  // Update completedAt when task is completed
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
  
  // Add activity log
  if (this.isModified('status')) {
    this.activityLogs = this.activityLogs || [];
    this.activityLogs.push({
      action: 'status_change',
      description: `Status changed to ${this.status}`,
      createdAt: new Date()
    });
  }
  
  next();
});

module.exports = mongoose.model('ClientTask', clienttaskSchema);