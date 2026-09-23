const mongoose = require('mongoose');

const leadAssignmentHistorySchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  action: { type: String, enum: ['assigned', 'reassigned', 'unassigned'], required: true },
  method: { type: String, enum: ['single', 'specific', 'round-robin', 'load-balanced', 'equal-distribution'], default: 'single' },
  reason: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true });

leadAssignmentHistorySchema.index({ company: 1, createdAt: -1 });
leadAssignmentHistorySchema.index({ company: 1, lead: 1, createdAt: -1 });

module.exports = mongoose.model('LeadAssignmentHistory', leadAssignmentHistorySchema);
