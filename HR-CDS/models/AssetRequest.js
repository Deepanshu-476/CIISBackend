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
    enum: [
      'pending',
      'approved',
      'rejected',
      'completed',
      'cancelled',
      'return_requested',
      'pending_verification',
      'deposited'
    ],
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
    image: { type: String },
    originalName: { type: String, default: '' },
    size: { type: Number, default: 0 },
    mimeType: { type: String, default: '' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedAt: { type: Date, default: Date.now }
  }
],
  approvalDetails: {
    about: { type: String, default: '' },
    images: [
      {
        image: { type: String },
        originalName: { type: String, default: '' },
        size: { type: Number, default: 0 },
        mimeType: { type: String, default: '' },
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now }
      }
    ],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt: { type: Date }
  },
  updateHistory: [
    {
      action: { type: String, default: 'updated' },
      previous: { type: mongoose.Schema.Types.Mixed },
      current: { type: mongoose.Schema.Types.Mixed },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      updatedAt: { type: Date, default: Date.now }
    }
  ],
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  returnRequestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedBy: {
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
  returnRequestedAt: {
    type: Date
  },
  depositSubmittedAt: {
    type: Date
  },
  verifiedAt: {
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


assetRequestSchema.index({ user: 1, status: 1 });
assetRequestSchema.index({ asset: 1 });
assetRequestSchema.index({ companyCode: 1 });
assetRequestSchema.index({ status: 1, createdAt: -1 });

const AssetRequest = mongoose.model('AssetRequest', assetRequestSchema);

module.exports = AssetRequest;
