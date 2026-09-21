const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
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
