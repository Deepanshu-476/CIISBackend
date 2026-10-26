const mongoose = require('mongoose');

const executiveInsightCacheSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    companyCode: {
      type: String,
      required: true,
      index: true,
    },
    range: {
      type: String,
      enum: ['7d', '30d', '90d'],
      default: '30d',
      required: true,
      index: true,
    },
    department: {
      type: String,
      default: 'all',
      index: true,
    },
    metrics: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },
    narrative: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    narrativeAvailable: {
      type: Boolean,
      default: true,
    },
    model: {
      type: String,
      default: null,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // MongoDB TTL index (automatically drops expired docs)
    },
  },
  {
    timestamps: true,
  }
);

// Unique compound index per company, time range, and department filter
executiveInsightCacheSchema.index(
  { company: 1, range: 1, department: 1 },
  { unique: true }
);

/**
 * Cache lookup helper: returns valid cached insight if exists and unexpired.
 */
executiveInsightCacheSchema.statics.getCached = async function ({ company, range = '30d', department = 'all' }) {
  const deptKey = String(department || '').trim() || 'all';
  return await this.findOne({
    company,
    range,
    department: deptKey,
    expiresAt: { $gt: new Date() },
  }).lean();
};

/**
 * Cache store helper: upserts executive insight with a 6-hour TTL.
 */
executiveInsightCacheSchema.statics.setCached = async function ({
  company,
  companyCode,
  range = '30d',
  department = 'all',
  metrics,
  narrative,
  narrativeAvailable = true,
  model = null,
  ttlHours = 6,
}) {
  const deptKey = String(department || '').trim() || 'all';
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const filter = {
    company,
    range,
    department: deptKey,
  };

  const update = {
    $set: {
      companyCode,
      metrics,
      narrative,
      narrativeAvailable,
      model,
      generatedAt: new Date(),
      expiresAt,
    },
  };

  return await this.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
};

module.exports =
  mongoose.models.ExecutiveInsightCache ||
  mongoose.model('ExecutiveInsightCache', executiveInsightCacheSchema);
