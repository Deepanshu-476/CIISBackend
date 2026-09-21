const mongoose = require('mongoose');
const rowSchema = new mongoose.Schema({
  rowNumber: Number,
  body: mongoose.Schema.Types.Mixed,
  parseErrors: [String],
  leadId: { type: mongoose.Schema.Types.ObjectId, required: true },
  outcome: { type: String, default: 'pending' },
  issues: [String]
}, { _id: false });
const schema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: String,
  status: { type: String, enum: ['preview', 'processing', 'completed', 'partial', 'failed', 'interrupted'], default: 'preview' },
  rows: [rowSchema],
  total: Number,
  added: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  pending: Number,
  startedAt: Date,
  processingOwner: String,
  completedAt: Date,
  expiresAt: Date
}, { timestamps: true });
schema.index({ company: 1, createdAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: 'preview' } });
module.exports = mongoose.model('LeadImportBatch', schema);
