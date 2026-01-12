const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: [
      'task_created',
      'task_assigned',
      'status_updated',
      'task_overdue',
      'task_overdue_manual',
      'remark_added',
      'task_completed',
      'task_updated',
      'general'
    ],
    default: 'general'
  },
  relatedTask: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ relatedTask: 1 });

module.exports = mongoose.model('Notification', notificationSchema);