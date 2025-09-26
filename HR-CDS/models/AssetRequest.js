const mongoose = require('mongoose');

const assetRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assetName: {
    type: String,
    required: true,
    enum: ['phone', 'sim', 'laptop', 'desktop', 'headphone'] // Add more if needed
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  decisionDate: {
    type: Date
  },
  adminComment: {
    type: String,
    default: ''
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true // ✅ Adds createdAt and updatedAt fields
});

module.exports = mongoose.model('AssetRequest', assetRequestSchema);
