const mongoose = require("mongoose");
const { autoResolveCallLog } = require("../services/cascadeSyncEngine");

const callLogSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
  leadName: { type: String, index: true, default: '' },
  leadPhone: { type: String, index: true, default: '' },
  leadEmail: { type: String, default: '' },
  leadSource: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadSource', index: true },
  leadSourceName: { type: String, index: true, default: '' },
  leadType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadType', index: true },
  leadTypeName: { type: String, index: true, default: '' },
  leadStatus: { type: String, index: true, default: '' },
  leadAddress: { type: String, default: '' },
  leadGender: { type: String, default: '' },
  leadRemarks: { type: String, default: '' },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  agentName: { type: String, index: true, default: '' },
  agentEmail: { type: String, index: true, default: '' },
  agentRole: { type: String, default: '' },
  clientCallId: { type: String, trim: true },
  startTime: { type: Date, default: Date.now },
  endTime: Date,
  duration: Number,
  callType: { type: String, default: "Outbound" },
  status: {
    type: String,       
    enum: ["answered", "missed", "not reachable", "rejected"],      
    default: "answered",
    index: true,
  },      
  notes: String, 
  recordingUrl: { type: String, default: "" },
}, { timestamps: true });  

callLogSchema.index(
  { company: 1, agent: 1, clientCallId: 1 },
  { unique: true, partialFilterExpression: { clientCallId: { $type: 'string' } } }
);
callLogSchema.index({ company: 1, agent: 1, createdAt: -1 });
callLogSchema.index({ company: 1, lead: 1, createdAt: -1 });
callLogSchema.index({ company: 1, status: 1, createdAt: -1 });
callLogSchema.index({ company: 1, leadName: 1 });
callLogSchema.index({ company: 1, leadPhone: 1 });
callLogSchema.index({ company: 1, agentName: 1 });

// Pre-save Auto-Resolution
callLogSchema.pre('save', async function(next) {
  try {
    await autoResolveCallLog(this);
  } catch (err) {
    // Non-fatal
  }
  next();
});

module.exports = mongoose.model("CallLog", callLogSchema);
