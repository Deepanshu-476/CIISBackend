  const mongoose = require("mongoose");

  const callLogSchema = new mongoose.Schema({
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    clientCallId: { type: String, trim: true },
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

  callLogSchema.index(
    { company: 1, agent: 1, clientCallId: 1 },
    { unique: true, partialFilterExpression: { clientCallId: { $type: 'string' } } }
  );

  module.exports = mongoose.model("CallLog", callLogSchema);
