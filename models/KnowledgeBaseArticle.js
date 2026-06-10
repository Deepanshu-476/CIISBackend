const mongoose = require("mongoose");

const knowledgeBaseArticleSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    index: true,
  },
  companyCode: {
    type: String,
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    default: "General",
    index: true,
  },
  summary: String,
  content: String,
  tags: [String],
  views: {
    type: Number,
    default: 0,
  },
  isPublished: {
    type: Boolean,
    default: true,
    index: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
}, { timestamps: true });

knowledgeBaseArticleSchema.index({ companyCode: 1, isPublished: 1, views: -1 });

module.exports = mongoose.model("KnowledgeBaseArticle", knowledgeBaseArticleSchema);
