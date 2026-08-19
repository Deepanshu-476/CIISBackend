const mongoose = require('mongoose');

const pageDataVisibilitySchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  companyCode: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  subjectType: {
    type: String,
    enum: ['role', 'user'],
    required: true,
    index: true
  },
  subjectKey: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  subjectLabel: {
    type: String,
    required: true,
    trim: true
  },
  scope: {
    type: String,
    enum: ['all', 'branches', 'departments', 'custom'],
    default: 'custom'
  },
  branchIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Branch'
  }],
  departmentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  }],
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

pageDataVisibilitySchema.index(
  { company: 1, subjectType: 1, subjectKey: 1 },
  { unique: true }
);
pageDataVisibilitySchema.index({ company: 1, updatedAt: -1 });

module.exports = mongoose.model('PageDataVisibility', pageDataVisibilitySchema);
