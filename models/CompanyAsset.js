const mongoose = require('mongoose');

const companyAssetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Asset name is required'],
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['Available', 'Assigned', 'Maintenance', 'Damaged', 'Retired'],
    default: 'Available'
  },
  company: {
    type: String,
    required: [true, 'Company code is required'],
    trim: true
  },
  companyCode: {
    type: String,
    required: [true, 'Company code is required'],
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by is required']
  }
}, {
  timestamps: true
});

// Add indexes for better performance
companyAssetSchema.index({ company: 1 });
companyAssetSchema.index({ status: 1 });
companyAssetSchema.index({ createdBy: 1 });

const CompanyAsset = mongoose.model('CompanyAsset', companyAssetSchema);

module.exports = CompanyAsset;