const mongoose = require('mongoose');

// One send action: what was sent and the delivery result for every recipient (the history view).
const recipientSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  name: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  error: { type: String, default: '' },
  sentAt: { type: Date, default: null },
}, { _id: false });

const bulkEmailCampaignSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sentByName: { type: String, default: '' },
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'BulkEmailTemplate', default: null },
  templateName: { type: String, default: '' },
  mode: { type: String, enum: ['simple', 'html'], default: 'simple' },
  subject: { type: String, required: true },
  heading: { type: String, default: '' },
  html: { type: String, default: '' },
  status: { type: String, enum: ['sending', 'completed'], default: 'sending' },
  recipients: { type: [recipientSchema], default: [] },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
}, { timestamps: true });

bulkEmailCampaignSchema.index({ company: 1, createdAt: -1 });
bulkEmailCampaignSchema.index({ company: 1, 'recipients.email': 1, createdAt: -1 });

module.exports = mongoose.model('BulkEmailCampaign', bulkEmailCampaignSchema);
