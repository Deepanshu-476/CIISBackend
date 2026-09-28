const mongoose = require('mongoose');

// Retain successful transfers for the rolling 30-day dashboard statistic.
const schema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  downloadedAt: { type: Date, default: Date.now, expires: 31 * 24 * 60 * 60 },
});
module.exports = mongoose.model('ClientDocumentDownload', schema);
