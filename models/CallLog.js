  const mongoose = require("mongoose");

  const callLogSchema = new mongoose.Schema({
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    duration: Number,
    status: {
      type: String,
      enum: ["answered", "missed", "not reachable", "rejected"],
      default: "answered",
    },
    notes: String,
  }, { timestamps: true });

  module.exports = mongoose.model("CallLog", callLogSchema);
