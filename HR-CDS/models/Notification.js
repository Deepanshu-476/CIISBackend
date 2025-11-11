const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  initiator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  entityType: {
    type: String,
    enum: [
      'Task',
      'Project',
      'Leave',
      'Meeting',
      'Asset',
      'Group',
      'Holiday',
      'System'
    ],
    required: true
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  eventType: {
    type: String,
    enum: [
      'assigned',
      'status_updated',
      'remark_added',
      'completed',
      'approved',
      'rejected',
      'on-hold',
      'reopen',
      'cancelled',
      'broadcast'
    ],
    required: true
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  isRead: { type: Boolean, default: false },
  readAt: Date,
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' }
}, { timestamps: true });

notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
