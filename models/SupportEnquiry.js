const mongoose = require("mongoose");

const supportEnquirySchema = new mongoose.Schema({
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
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
  },
  phone: String,
  subject: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    trim: true,
  },
  source: {
    type: String,
    enum: ["portal", "website", "live_chat", "email", "phone"],
    default: "portal",
  },
  status: {
    type: String,
    enum: ["New", "Triaged", "Converted", "Closed"],
    default: "New",
    index: true,
  },
  convertedTicket: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SupportTicket",
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
}, { timestamps: true });

supportEnquirySchema.index({ companyCode: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("SupportEnquiry", supportEnquirySchema);
