const mongoose = require('mongoose');

const aiUsageSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: {
      type: String, // YYYY-MM-DD in Asia/Kolkata (IST)
      required: true,
      index: true,
    },
    feature: {
      type: String,
      required: true,
      default: 'interactive',
      index: true,
    },
    count: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Preserves existing unique compound index without duplicate key collision
aiUsageSchema.index(
  { company: 1, user: 1, date: 1, feature: 1 },
  { unique: true }
);

/**
 * Atomically increment usage for a user on a given date and feature.
 * Race-condition safe via atomic findOneAndUpdate with $inc and upsert.
 */
aiUsageSchema.statics.incrementUsage = async function ({ company, user, date, feature = 'interactive', inc = 1 }) {
  const filter = { company, user, date, feature };
  return await this.findOneAndUpdate(
    filter,
    {
      $inc: { count: inc },
      $setOnInsert: { company, user, date, feature },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Read-only check for daily budget usage (feature: 'budget').
 */
aiUsageSchema.statics.getBudgetUsage = async function ({ company, user, date }) {
  const doc = await this.findOne({ company, user, date, feature: 'budget' }).lean();
  return doc ? doc.count || 0 : 0;
};

/**
 * Atomic reservation using unique index on { company, user, date, feature }.
 * Filter { count: { $lt: limit } } with upsert: true guarantees:
 * - If count < limit, atomically increments count by 1.
 * - If count >= limit, upsert fails with E11000 duplicate key error on the unique index.
 * Catching E11000 specifically returns { ok: false, code: 'LIMIT_REACHED' }.
 */
aiUsageSchema.statics.reserveBudget = async function ({ company, user, date, limit }) {
  try {
    const doc = await this.findOneAndUpdate(
      { company, user, date, feature: 'budget', count: { $lt: limit } },
      {
        $inc: { count: 1 },
        $setOnInsert: { company, user, date, feature: 'budget' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { ok: true, count: doc ? doc.count : 1 };
  } catch (err) {
    if (err.code === 11000) {
      return { ok: false, code: 'LIMIT_REACHED' };
    }
    throw err;
  }
};

/**
 * Atomic refund helper: decrements budget count by 1 (never below 0).
 */
aiUsageSchema.statics.refundBudget = async function ({ company, user, date }) {
  return await this.findOneAndUpdate(
    { company, user, date, feature: 'budget', count: { $gt: 0 } },
    { $inc: { count: -1 } },
    { new: true }
  );
};

module.exports = mongoose.models.AiUsage || mongoose.model('AiUsage', aiUsageSchema);


