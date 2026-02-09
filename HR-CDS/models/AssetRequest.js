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
    enum: ['phone', 'sim', 'laptop', 'desktop', 'headphone']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  companyCode: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  adminComment: {
    type: String,
    default: ''
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  decisionDate: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AssetRequest', assetRequestSchema);