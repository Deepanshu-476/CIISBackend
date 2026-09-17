const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  source: String,       
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
    followUp: Date
  }],
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
