const mongoose = require('mongoose');

const feedbackQuestionSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    type: {
      type: String,
      required: true,
      enum: ['text', 'textarea', 'single_choice', 'multiple_choice', 'rating', 'number'],
    },
    required: {
      type: Boolean,
      default: false,
    },
    options: {
      type: [String],
      default: [],
    },
    maxRating: {
      type: Number,
      default: 5,
      min: 1,
      max: 10,
    },
    placeholder: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: true }
);

const feedbackQuestionnaireSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 2000,
    },
    targetScope: {
      type: String,
      required: true,
      enum: ['company', 'branch', 'user'],
    },
    recipientMode: {
      type: String,
      default: 'all',
      enum: ['all', 'specific'],
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
    targetedUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    recipientIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    }],
    questions: {
      type: [feedbackQuestionSchema],
      default: [],
      validate: {
        validator: value => Array.isArray(value) && value.length > 0,
        message: 'At least one question is required',
      },
    },
    nameVisibility: {
      type: String,
      default: 'show_name',
      enum: ['show_name', 'anonymous'],
    },
    status: {
      type: String,
      default: 'active',
      enum: ['draft', 'active', 'closed'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    responseCount: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

feedbackQuestionnaireSchema.index({ status: 1, createdAt: -1 });
feedbackQuestionnaireSchema.index({ company: 1, createdAt: -1 });
feedbackQuestionnaireSchema.index({ branch: 1, createdAt: -1 });
feedbackQuestionnaireSchema.index({ recipientIds: 1, status: 1 });

module.exports = mongoose.model('FeedbackQuestionnaire', feedbackQuestionnaireSchema);
