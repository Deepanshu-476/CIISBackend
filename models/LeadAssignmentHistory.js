const mongoose = require('mongoose');
const { autoResolveLeadAssignmentHistory } = require("../services/cascadeSyncEngine");

const leadAssignmentHistorySchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  leadName: { type: String, index: true, default: '' },
  leadPhone: { type: String, index: true, default: '' },
  leadEmail: { type: String, default: '' },
  leadStatus: { type: String, index: true, default: '' },
  leadRemarks: { type: String, default: '' },
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  fromUserName: { type: String, index: true, default: '' },
  fromUserEmail: { type: String, default: '' },
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  toUserName: { type: String, index: true, default: '' },
  toUserEmail: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  performedByName: { type: String, index: true, default: '' },
  performedByEmail: { type: String, default: '' },
  action: { type: String, enum: ['assigned', 'reassigned', 'unassigned'], required: true, index: true },
  method: { type: String, enum: ['single', 'specific', 'round-robin', 'load-balanced', 'equal-distribution'], default: 'single' },
  reason: { type: String, trim: true, maxlength: 500, default: '' }
}, { timestamps: true });

leadAssignmentHistorySchema.index({ company: 1, createdAt: -1 });
leadAssignmentHistorySchema.index({ company: 1, lead: 1, createdAt: -1 });
leadAssignmentHistorySchema.index({ company: 1, action: 1, createdAt: -1 });
leadAssignmentHistorySchema.index({ company: 1, leadName: 1 });
leadAssignmentHistorySchema.index({ company: 1, toUserName: 1 });

// Pre-save Auto-Resolution
leadAssignmentHistorySchema.pre('save', async function(next) {
  try {
    await autoResolveLeadAssignmentHistory(this);
  } catch (err) {
    // Non-fatal
  }
  next();
});

module.exports = mongoose.model('LeadAssignmentHistory', leadAssignmentHistorySchema);
