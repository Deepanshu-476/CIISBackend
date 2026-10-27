const mongoose = require('mongoose');

// Running count of emails a company has sent per IST day ('2026-10-27') and month ('2026-10').
// Sends reserve their count here atomically so parallel sends cannot exceed the limit.
const bulkEmailUsageSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  period: { type: String, required: true },
  count: { type: Number, default: 0 },
}, { timestamps: true });

bulkEmailUsageSchema.index({ company: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('BulkEmailUsage', bulkEmailUsageSchema);
