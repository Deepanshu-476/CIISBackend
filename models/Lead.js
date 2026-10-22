const mongoose = require("mongoose");
const { autoResolveLead, cascadeLeadUpdate } = require("../services/cascadeSyncEngine");

const leadSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  leadSource: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadSource', index: true },
  leadSourceName: { type: String, default: '' },
  leadType: { type: mongoose.Schema.Types.ObjectId, ref: 'LeadType', index: true },
  leadTypeName: { type: String, default: '' },
  gender: { type: String, enum: ['', 'Male', 'Female', 'Other'], default: '' },
  leadDate: String,
  address: String,
  customField1: String,
  customField2: String,
  customField3: String,
  customField4: String,
  customField5: String,
  remarks: String,
  name: { type: String },
  phone: { type: String },
  email: String,
  source: { type: String },       
  status: {
    type: String,
    // contacted and negotiation are pipeline stages set from the Kanban board.
    enum: ["new", "contacted", "follow-up", "interested", "negotiation", "not interested", "converted", "closed"],
    default: "new",
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    index: true
  },
  assignedToName: { type: String, default: '' },
  assignedToEmail: { type: String, default: '' },
  assignedToRole: { type: String, default: '' },
  assignedAt: {
    type: Date,
    index: true
  },
  nextFollowUp: { type: Date, index: true },
  // Set by a missed call from the lead; cleared by the next answered or outgoing call. Lists show these first.
  lastMissedCallAt: { type: Date, default: null },
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
  campaignName: { type: String, default: '' },
  callHistory: [{
    _id: false,
    id: { type: String, required: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: String,
    date: { type: Date, required: true },
    callType: String,
    outcome: String,
    notes: String,
    duration: { type: Number, default: 0 },
    followUp: Date,
    recordingUrl: { type: String, default: "" }
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
  },
  createdByName: { type: String, default: '' },
  createdByEmail: { type: String, default: '' }
}, { timestamps: true });

leadSchema.index({ company: 1, createdAt: -1 });
leadSchema.index({ company: 1, status: 1, createdAt: -1 });
leadSchema.index({ company: 1, assignedTo: 1, assignedAt: -1 });
leadSchema.index({ company: 1, assignedTo: 1, createdAt: -1 });
leadSchema.index({ company: 1, leadType: 1, createdAt: -1 });
leadSchema.index({ company: 1, leadSource: 1, createdAt: -1 });
leadSchema.index({ company: 1, nextFollowUp: 1 });
leadSchema.index({ company: 1, name: 1, phone: 1 });
leadSchema.index({ company: 1, assignedToName: 1 });
leadSchema.index({ company: 1, leadSourceName: 1 });
leadSchema.index({ company: 1, leadTypeName: 1 });
leadSchema.index({ company: 1, campaign: 1 });
// Sort keys of the paged CRM lists (assigned / pending / completed / converted).
leadSchema.index({ company: 1, assignedAt: -1 });
leadSchema.index({ company: 1, status: 1, assignedAt: -1 });
leadSchema.index({ company: 1, status: 1, updatedAt: -1 });

// Pre-save Auto-Resolution
leadSchema.pre('save', async function(next) {
  try {
    await autoResolveLead(this, this.company);
  } catch (err) {
    // Non-fatal, allow save to proceed
  }
  next();
});

// Post-save Cascade Engine
leadSchema.post('save', async function(doc) {
  try {
    await cascadeLeadUpdate(doc._id, doc);
  } catch (err) {
    console.error('Lead post-save cascade error:', err.message);
  }
});

module.exports = mongoose.model("Lead", leadSchema);
