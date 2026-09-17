
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
    default: 'info'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  relatedEntity: {
    type: String, 
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


clientNotificationSchema.index({ isRead: 1 });
clientNotificationSchema.index({ recipient: 1 });
clientNotificationSchema.index({ createdAt: -1 });
clientNotificationSchema.index({ type: 1 });
clientNotificationSchema.index({ expiryDate: 1 }, { expireAfterSeconds: 0 });


clientNotificationSchema.statics.getUnreadCount = async function(recipientId = null) {
  const query = { isRead: false };
  if (recipientId) {
    query.recipient = recipientId;
  }
  
  return await this.countDocuments(query);
};


clientNotificationSchema.statics.createNotification = async function(notificationData) {
  const notification = new this(notificationData);
  return await notification.save();
};


clientNotificationSchema.statics.markAllAsRead = async function(recipientId = null) {
  const query = { isRead: false };
  if (recipientId) {
    query.recipient = recipientId;
  }
  
  return await this.updateMany(query, { isRead: true });
};


clientNotificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  return this.save();
};


clientNotificationSchema.pre('save', function(next) {
  if (!this.expiryDate) {
    this.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); 
  }
  next();
});

module.exports = mongoose.model('ClientNotification', clientNotificationSchema);
