const mongoose = require('mongoose');

const assetRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  asset: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CompanyAsset',
    required: true
  },
  assetName: {
    type: String,
    required: true
  },
  assetStatus: {
    type: String,
    default: 'Available'
  },
  requestType: {
    type: String,
    enum: ['new', 'assignment', 'maintenance', 'return'],
    default: 'assignment'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed', 'cancelled'],
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
  reason: {
    type: String,
    default: ''
  },
  adminComments: [
  {
    text: { type: String },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now }
  }
],
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  requestDate: {
    type: Date,
    default: Date.now
  },
  decisionDate: {
    type: Date
  },
  expectedReturnDate: {
    type: Date
  },
  actualReturnDate: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better performance
assetRequestSchema.index({ user: 1, status: 1 });
assetRequestSchema.index({ asset: 1 });
assetRequestSchema.index({ companyCode: 1 });
assetRequestSchema.index({ status: 1, createdAt: -1 });

const AssetRequest = mongoose.model('AssetRequest', assetRequestSchema);

module.exports = AssetRequest;