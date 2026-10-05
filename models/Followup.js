const mongoose = require("mongoose");
const { autoResolveFollowUp } = require("../services/cascadeSyncEngine");

const followUpSchema = new mongoose.Schema({
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
  agent: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  agentName: { type: String, index: true, default: '' },
  agentEmail: { type: String, index: true, default: '' },
  sourceCallId: { type: String, trim: true },
  date: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ["pending", "done"],
    default: "pending",
    index: true,
  },
  priority: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "medium",
    index: true,
  },
  note: String
}, { timestamps: true });

followUpSchema.index(
  { company: 1, agent: 1, lead: 1, sourceCallId: 1 },
  { unique: true, partialFilterExpression: { sourceCallId: { $type: 'string' } } }
);
followUpSchema.index({ company: 1, agent: 1, status: 1, date: 1 });
followUpSchema.index({ company: 1, lead: 1, date: -1 });
followUpSchema.index({ company: 1, status: 1, date: 1 });
followUpSchema.index({ company: 1, leadName: 1 });
followUpSchema.index({ company: 1, leadPhone: 1 });
followUpSchema.index({ company: 1, agentName: 1 });

// Pre-save Auto-Resolution
followUpSchema.pre('save', async function(next) {
  try {
    await autoResolveFollowUp(this);
  } catch (err) {
    // Non-fatal
  }
  next();
});

module.exports = mongoose.model("FollowUp", followUpSchema);
