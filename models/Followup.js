const mongoose = require("mongoose");

const followUpSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: Date, required: true },
  status: {
    type: String,
    enum: ["pending", "done"],
    default: "pending"
  },
  note: String
}, { timestamps: true });

module.exports = mongoose.model("FollowUp", followUpSchema);
