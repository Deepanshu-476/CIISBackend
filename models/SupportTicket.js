const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  senderName: String,
  senderRole: {
    type: String,
    enum: ["employee", "agent", "system"],
    default: "employee",
  },
  message: {
    type: String,
    trim: true,
    maxlength: 2000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

const supportTicketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    unique: true,
    index: true,
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Company",
    index: true,
  },
  companyCode: {
    type: String,
    required: true,
    index: true,
  },
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  requesterName: String,
  requesterEmail: String,
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    index: true,
  },
  department: String,
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 160,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 4000,
  },
  category: {
    type: String,
    enum: ["HR Policy", "IT Helpdesk", "Payroll", "Assets", "Facilities", "Attendance", "General"],
    default: "General",
    index: true,
  },
  source: {
    type: String,
    enum: ["portal", "chatbot", "live_chat", "admin"],
    default: "portal",
  },
  status: {
    type: String,
    enum: ["Open", "In Progress", "Waiting", "Resolved", "Closed", "Escalated"],
    default: "Open",
    index: true,
  },
  priority: {
    type: String,
    enum: ["Low", "Medium", "High", "Critical"],
    default: "Medium",
    index: true,
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  assignedToName: String,
  slaDueAt: Date,
  resolvedAt: Date,
  lastResponseAt: Date,
  satisfactionScore: {
    type: Number,
    min: 1,
    max: 5,
  },
  tags: [String],
  messages: [messageSchema],
}, { timestamps: true });

supportTicketSchema.pre("save", async function (next) {
  if (!this.ticketNumber) {
    const count = await mongoose.model("SupportTicket").countDocuments({
      companyCode: this.companyCode,
    });
    this.ticketNumber = `SUP-${String(count + 1001).padStart(4, "0")}`;
  }

  if (!this.slaDueAt) {
    const hours = this.priority === "Critical" ? 4 : this.priority === "High" ? 8 : 24;
    this.slaDueAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  if (this.isModified("status") && ["Resolved", "Closed"].includes(this.status) && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }

  next();
});

supportTicketSchema.index({ companyCode: 1, status: 1, createdAt: -1 });
supportTicketSchema.index({ companyCode: 1, requester: 1, createdAt: -1 });
supportTicketSchema.index({ companyCode: 1, status: 1, updatedAt: -1 });
supportTicketSchema.index({ companyCode: 1, priority: 1, updatedAt: -1 });
supportTicketSchema.index({ companyCode: 1, departmentId: 1, status: 1, updatedAt: -1 });
supportTicketSchema.index({ companyCode: 1, assignedTo: 1, updatedAt: -1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
