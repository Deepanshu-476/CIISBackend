const mongoose = require('mongoose');

// Saved recipients for the Bulk Email page, one address per company.
const bulkEmailContactSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  name: { type: String, trim: true, default: '', maxlength: 120 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

bulkEmailContactSchema.index({ company: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('BulkEmailContact', bulkEmailContactSchema);
