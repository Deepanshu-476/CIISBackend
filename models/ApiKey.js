const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    default: 'AI MCP Key'
  },
  keyPrefix: {
    type: String,
    required: true,
    index: true
  },
  keyHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  companyCode: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true
  },
  role: {
    type: String,
    default: 'employee'
  },
  allowedPages: {
    type: [String],
    default: []
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lastUsedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

apiKeySchema.statics.generateKey = function() {
  const rawSecret = crypto.randomBytes(32).toString('hex');
  const fullKey = `ciis_live_${rawSecret}`;
  const keyPrefix = fullKey.slice(0, 14);
  const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');
  return { fullKey, keyPrefix, keyHash };
};

apiKeySchema.statics.hashKey = function(fullKey) {
  return crypto.createHash('sha256').update(String(fullKey || '').trim()).digest('hex');
};

module.exports = mongoose.model('ApiKey', apiKeySchema);
