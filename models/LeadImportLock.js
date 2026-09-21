const mongoose = require('mongoose');
// A company-wide lease serializes this feature's imports across server processes.
module.exports = mongoose.model('LeadImportLock', new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  owner: { type: String, required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, required: true },
  until: { type: Date, required: true }
}, { versionKey: false }));
