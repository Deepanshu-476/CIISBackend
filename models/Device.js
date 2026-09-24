const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deviceToken: String,
  platform: String,
  notificationPermission: String,
  userAgent: String,
  ipAddress: String,
  updatedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

deviceSchema.index({ userId: 1, deviceToken: 1 });
deviceSchema.index({ deviceToken: 1 });
deviceSchema.index({ updatedAt: -1, createdAt: -1 });

module.exports = mongoose.model('Device', deviceSchema);
