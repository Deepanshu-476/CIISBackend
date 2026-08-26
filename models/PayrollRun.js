const mongoose = require("mongoose");

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true },
  fromStatus: { type: String, default: "" },
  toStatus: { type: String, default: "" },
  reason: { type: String, trim: true, default: "" },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  performedByName: { type: String, trim: true, default: "" },
  employeeId: { type: String, trim: true, default: "" },
  employeeName: { type: String, trim: true, default: "" },
  performedAt: { type: Date, default: Date.now }
}, { _id: false });

const payrollRunSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
  status: {
    type: String,
    enum: ["Draft", "Calculated", "Reviewed", "Approved", "Locked"],
    default: "Draft",
    index: true
  },
  employees: { type: [mongoose.Schema.Types.Mixed], default: [] },
  totals: {
    employees: { type: Number, default: 0 },
    earnings: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    pendingAttendance: { type: Number, default: 0 }
  },
  calculatedAt: Date,
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  approvedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  lockedAt: Date,
  lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  auditLog: { type: [auditSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

payrollRunSchema.index({ company: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("PayrollRun", payrollRunSchema);
