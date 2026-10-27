const mongoose = require('mongoose');

// Reusable email content. `mode: 'simple'` is built from the fields below; `mode: 'html'` sends `html` as written.
const bulkEmailTemplateSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  mode: { type: String, enum: ['simple', 'html'], default: 'simple' },
  subject: { type: String, trim: true, default: '', maxlength: 250 },
  heading: { type: String, trim: true, default: '', maxlength: 250 },
  subheading: { type: String, trim: true, default: '', maxlength: 500 },
  body: { type: String, default: '', maxlength: 20000 },
  buttonText: { type: String, trim: true, default: '', maxlength: 80 },
  buttonUrl: { type: String, trim: true, default: '', maxlength: 2000 },
  footer: { type: String, default: '', maxlength: 2000 },
  html: { type: String, default: '', maxlength: 200000 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

bulkEmailTemplateSchema.index({ company: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('BulkEmailTemplate', bulkEmailTemplateSchema);
