const mongoose = require('mongoose');

/**
 * An employee asking to take their weekly off on a different day of the same week.
 *
 * It is a swap, not an extra day: `fromDateKey` is the weekly off they give up and `toDateKey` is
 * the day they want instead. Only an Approved request changes anything — see HR-CDS/utils/weekOff.js,
 * which both attendance and payroll use to resolve off days.
 */
const weekOffRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company'
  },
  companyCode: {
    type: String,
    required: true,
    trim: true
  },
  // Monday of the week this swap belongs to, 'YYYY-MM-DD' in India time.
  weekStartKey: {
    type: String,
    required: true,
    trim: true
  },
  // The scheduled weekly off being given up.
  fromDateKey: {
    type: String,
    required: true,
    trim: true
  },
  // The day the employee wants off instead.
  toDateKey: {
    type: String,
    required: true,
    trim: true
  },
  reason: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Cancelled'],
    default: 'Pending',
    index: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  reviewRemarks: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  }
}, { timestamps: true });

weekOffRequestSchema.index({ companyCode: 1, status: 1, weekStartKey: -1 });
weekOffRequestSchema.index({ user: 1, weekStartKey: -1 });
// Resolving a month of attendance or payroll reads approved swaps for a set of users by week.
weekOffRequestSchema.index({ company: 1, status: 1, weekStartKey: 1 });

module.exports = mongoose.model('WeekOffRequest', weekOffRequestSchema);
