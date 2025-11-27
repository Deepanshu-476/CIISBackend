// models/Notification.js
const mongoose = require('mongoose');

const clientNotificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    trim: true,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  type: {
    type: String,
    required: true,
    enum: ['info', 'success', 'warning', 'error', 'client_added', 'client_updated', 'client_deleted', 'service_added', 'service_deleted'],
    default: 'info'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // यदि आपके पास user system है
    required: false
  },
  relatedEntity: {
    type: String, // 'client', 'service', etc.
    trim: true
  },
  relatedEntityId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'relatedEntity'
  },
  actionUrl: {
    type: String,
    trim: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  expiryDate: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
clientnotificationSchema.index({ isRead: 1 });
clientnotificationSchema.index({ recipient: 1 });
clientnotificationSchema.index({ createdAt: -1 });
clientnotificationSchema.index({ type: 1 });
clientnotificationSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });

// Static method to get unread count
clientnotificationSchema.statics.getUnreadCount = async function(recipientId = null) {
  const query = { isRead: false };
  if (recipientId) {
    query.recipient = recipientId;
  }
  
  return await this.countDocuments(query);
};

// Static method to create notification
clientnotificationSchema.statics.createNotification = async function(notificationData) {
  const notification = new this(notificationData);
  return await notification.save();
};

// Static method to mark all as read
clientnotificationSchema.statics.markAllAsRead = async function(recipientId = null) {
  const query = { isRead: false };
  if (recipientId) {
    query.recipient = recipientId;
  }
  
  return await this.updateMany(query, { isRead: true });
};

// Instance method to mark as read
clientnotificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  return this.save();
};

// Pre-save middleware to set default expiry (30 days)
clientnotificationSchema.pre('save', function(next) {
  if (!this.expiryDate) {
    this.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  }
  next();
});

module.exports = mongoose.model('ClientNotification', clientclientnotificationSchema);