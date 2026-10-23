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
      default: 'task_agent',
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

aiUsageSchema.index(
  { company: 1, user: 1, date: 1, feature: 1 },
  { unique: true }
);

module.exports = mongoose.model('AiUsage', aiUsageSchema);
