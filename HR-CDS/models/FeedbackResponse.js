const mongoose = require('mongoose');

const feedbackResponseSchema = new mongoose.Schema(
  {
    questionnaire: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedbackQuestionnaire',
      required: true,
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      default: null,
      index: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    recipientNameSnapshot: {
      type: String,
      default: '',
      trim: true,
    },
    recipientEmailSnapshot: {
      type: String,
      default: '',
      trim: true,
    },
    visibilityMode: {
      type: String,
      enum: ['show_name', 'anonymous'],
      default: 'show_name',
    },
    answers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

feedbackResponseSchema.index({ questionnaire: 1, recipient: 1 }, { unique: true });
feedbackResponseSchema.index({ questionnaire: 1, submittedAt: -1 });

module.exports = mongoose.model('FeedbackResponse', feedbackResponseSchema);
