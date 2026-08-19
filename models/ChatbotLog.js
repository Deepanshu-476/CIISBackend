const mongoose = require("mongoose");

const chatbotLogSchema = new mongoose.Schema({
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
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  userName: String,
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
  },
  departmentName: String,
  question: {
    type: String,
    required: true,
    trim: true,
  },
  answer: {
    type: String,
    trim: true,
  },
  intent: {
    type: String,
    default: "General Support",
    index: true,
  },
  confidence: {
    type: Number,
    min: 0,
    max: 100,
    default: 78,
  },
  outcome: {
    type: String,
    enum: ["Resolved", "Article served", "Ticket created", "Agent handoff"],
    default: "Resolved",
    index: true,
  },
  ticket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupportTicket",
  },
}, { timestamps: true });

chatbotLogSchema.index({ companyCode: 1, intent: 1, createdAt: -1 });
chatbotLogSchema.index({ companyCode: 1, createdAt: -1 });
chatbotLogSchema.index({ companyCode: 1, user: 1, createdAt: -1 });

module.exports = mongoose.model("ChatbotLog", chatbotLogSchema);
