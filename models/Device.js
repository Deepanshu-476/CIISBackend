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

module.exports = mongoose.model('Device', deviceSchema);
