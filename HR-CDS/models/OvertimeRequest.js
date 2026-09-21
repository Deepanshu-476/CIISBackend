const mongoose = require('mongoose');

const overtimeRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  companyCode: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  requestType: {
    type: String,
    enum: ['SINGLE_DAY', 'MULTIPLE_DAYS', 'FULL_MONTH'],
    default: 'SINGLE_DAY'
  },
  dates: [{
    type: Date
  }],
  dateKeys: [{
    type: String, // 'YYYY-MM-DD' formatted for India timezone
    trim: true
  }],
  month: {
    type: String, // 'YYYY-MM'
    trim: true
  },
  calculationType: {
    type: String,
    enum: ['BY_HOURS', 'FULL_DAY_PRESENT'],
    default: 'BY_HOURS'
  },
  requestedHours: {
    type: Number,
    default: 0
  },
  calculatedAmount: {
    type: Number,
    default: 0
  },
  isFullDayApproved: {
    type: Boolean,
    default: false
  },
  reason: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
    index: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  approvedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

overtimeRequestSchema.index({ companyCode: 1, status: 1 });
overtimeRequestSchema.index({ user: 1, status: 1 });
overtimeRequestSchema.index({ dateKeys: 1 });
overtimeRequestSchema.index({ month: 1 });

const OvertimeRequest = mongoose.model('OvertimeRequest', overtimeRequestSchema);

module.exports = OvertimeRequest;

