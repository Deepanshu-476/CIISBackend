const mongoose = require('mongoose');

// A named group of leads (e.g. "Diwali offer list") with a conversion target and its own subset of call outcomes.
const campaignSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: '', trim: true, maxlength: 500 },
  // Conversions aimed for; 0 means no target.
  target: { type: Number, default: 0, min: 0 },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' },
  // Outcomes telecallers pick from for this campaign's leads; empty means all outcomes.
  outcomes: [{ type: String }],
  status: { type: String, enum: ['active', 'paused', 'completed'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

campaignSchema.index({ company: 1, name: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
