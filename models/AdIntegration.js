const mongoose = require('mongoose');
const { Schema } = mongoose;

const answerMapping = new Schema({ key: String, label: String }, { _id: false });
const formMapping = new Schema({ formId: String, fields: [answerMapping] }, { _id: false });
const schema = new Schema({
  company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  platform: { type: String, enum: ['meta', 'google'], required: true },
  externalAccountId: { type: String, required: true },
  accountName: String,
  businessName: String,
  instagramName: String,
  managerId: String,
  forms: [{ _id: false, id: String, name: String }],
  campaigns: [{ _id: false, id: String, name: String }],
  mappings: [formMapping],
  credentials: { type: String, select: false },
  webhookKey: { type: String, select: false },
  status: { type: String, enum: ['connected', 'reconnect', 'disconnected', 'connecting'], required: true },
  ownsMetaPage: Boolean,
  metaLease: { type: String, select: false },
  metaLeaseUntil: { type: Date, select: false },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  department: { type: Schema.Types.ObjectId, ref: 'Department' },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
  leadStatus: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  lastSyncAt: Date,
  lastLeadReceivedAt: Date,
  lastWebhookTestAt: Date
}, { timestamps: true });

schema.index({ company: 1, platform: 1, externalAccountId: 1 }, { unique: true });
// A signed Meta delivery identifies a Page, so only one tenant can own its routing.
schema.index({ platform: 1, externalAccountId: 1 }, {
  name: 'owned_meta_page', unique: true, partialFilterExpression: { ownsMetaPage: true }
});
module.exports = mongoose.model('AdIntegration', schema);
