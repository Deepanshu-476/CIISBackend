const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  leadSource: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadSource' },
  leadType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadType' },
  gender: { type: String, enum: ['', 'Male', 'Female', 'Other'], default: '' },
  leadDate: String,
  address: String,
  customField1: String,
  customField2: String,
  customField3: String,
  customField4: String,
  customField5: String,
  remarks: String,
  name: String,
  phone: String,
  email: String,
  source: String,       
  status: {
    type: String,
    enum: ["new", "follow-up", "interested", "not interested", "converted"],
    default: "new",
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  assignedAt: {
    type: Date
  },
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
