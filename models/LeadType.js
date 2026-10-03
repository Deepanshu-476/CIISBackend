const mongoose = require('mongoose');
const { cascadeLeadTypeUpdate } = require('../services/cascadeSyncEngine');

const schema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  normalizedName: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
  isSystem: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

schema.index({ company: 1, normalizedName: 1 }, { unique: true });
schema.index({ company: 1, name: 1 });

// Post-save cascade synchronization
schema.post('save', async function(doc) {
  try {
    await cascadeLeadTypeUpdate(doc._id, doc);
  } catch (err) {
    console.error('LeadType post-save cascade error:', err.message);
  }
});

module.exports = mongoose.model('LeadType', schema);
