const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  company: { type: Schema.Types.ObjectId, required: true },
  user: { type: Schema.Types.ObjectId, required: true },
  connection: Schema.Types.ObjectId,
  platform: String,
  stateHash: { type: String, unique: true, required: true },
  consumed: Boolean,
  mobile: Boolean,
  mobileResult: { type: String, enum: ['denied', 'failed'] },
  verifier: { type: String, select: false },
  credentials: { type: String, select: false },
  expiresAt: { type: Date, expires: 0, required: true }
});
module.exports = mongoose.model('AdOAuthSession', schema);
