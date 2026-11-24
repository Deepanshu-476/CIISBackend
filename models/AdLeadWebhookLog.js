const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  company: { type: Schema.Types.ObjectId, required: true },
  integration: { type: Schema.Types.ObjectId, ref: 'AdIntegration', required: true },
  platform: String,
  externalLeadId: String,
  formId: String,
  payload: { type: Schema.Types.Mixed, select: false },
  status: { type: String, enum: ['queued', 'processing', 'retrying', 'failed', 'created', 'duplicate', 'test'] },
  attempts: { type: Number, default: 0 },
  duplicates: { type: Number, default: 0 },
  lead: { type: Schema.Types.ObjectId, ref: 'Lead' },
  error: String,
  receivedAt: { type: Date, default: Date.now },
  processedAt: Date,
  availableAt: Date,
  claim: String,
  expiresAt: { type: Date, expires: 0 }
});
schema.index({ company: 1, platform: 1, externalLeadId: 1 }, {
  unique: true, partialFilterExpression: { externalLeadId: { $type: 'string' } }
});
schema.index({ status: 1, availableAt: 1 });
schema.index({ company: 1, receivedAt: -1 });
schema.index({ company: 1, integration: 1, status: 1 });
module.exports = mongoose.model('AdLeadWebhookLog', schema);
