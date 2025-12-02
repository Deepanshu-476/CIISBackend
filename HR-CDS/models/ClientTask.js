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
  dueDate: {
    type: Date,
    default: null
  },
  assignee: {
    type: String,
    trim: true,
    default: ''
  },
  priority: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Medium'
  },
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
clienttaskSchema.index({ clientId: 1, service: 1 });
clienttaskSchema.index({ clientId: 1, completed: 1 });
clienttaskSchema.index({ dueDate: 1 });
clienttaskSchema.index({ assignee: 1 });
clienttaskSchema.index({ priority: 1 });

// Virtual for checking if task is overdue
clienttaskSchema.virtual('isOverdue').get(function() {
  if (!this.dueDate || this.completed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(this.dueDate);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
});

// Pre-save middleware for completedAt
clienttaskSchema.pre('save', function(next) {
  if (this.isModified('completed') && this.completed && !this.completedAt) {
    this.completedAt = new Date();
  } else if (this.isModified('completed') && !this.completed && this.completedAt) {
    this.completedAt = null;
  }
  next();
});

module.exports = mongoose.model('ClientTask', clienttaskSchema);