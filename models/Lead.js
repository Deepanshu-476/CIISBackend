const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    index: true
  },
  name: String,
  phone: String,
  email: String,
  source: String,
  leadSource: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LeadSource"
  },
  leadType: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LeadType"
  },
  gender: String,
  leadDate: String,
  address: String,
  remarks: String,
  customField1: String,
  customField2: String,
  customField3: String,
  customField4: String,
  customField5: String,
  status: {
    type: String,
    enum: ["new", "follow-up", "interested", "not interested", "converted", "closed"],
    default: "new",
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  assignedAt: {
    type: Date
  },
  nextFollowUp: Date,
  callHistory: [{
    _id: false,
    id: { type: String, required: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: String,
    date: { type: Date, required: true },
    callType: String,
    outcome: String,
    notes: String,
    followUp: Date,
    duration: { type: Number, default: 0 }
  }],
  conversionValue: Number,
  enrolledCourse: String,
  paymentStatus: String,
  convertedAt: Date,
  notes: [
    {
      message: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  }
}, { timestamps: true });

module.exports = mongoose.model("Lead", leadSchema);
