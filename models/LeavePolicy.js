const mongoose = require("mongoose");

const leavePolicySchema = new mongoose.Schema({
  policyName: { type: String, required: true, trim: true, maxlength: 120 },
  department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
  jobRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: "JobRole" }],
  jobRoleNames: [{ type: String, trim: true }],
  leaveType: { type: String, required: true, trim: true, maxlength: 80 },
  payType: { type: String, enum: ["Paid", "Unpaid", "Admin Choice"], default: "Paid" },
  entitledDays: { type: Number, required: true, min: 0, default: 0 },
  monthlyAllowed: { type: Number, min: 0, default: 0 },
  carryForward: { type: String, enum: ["Yes", "No"], default: "No" },
  maxCarryForwardDays: { type: Number, min: 0, default: 0 },
  encashmentAllowed: { type: String, enum: ["Yes", "No"], default: "No" },
  probationApplicable: { type: String, enum: ["Yes", "No"], default: "No" },
  sortOrder: { type: Number, min: 0, default: 1 },
  status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  companyCode: { type: String, trim: true, required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

leavePolicySchema.index({ company: 1, department: 1, status: 1 });
leavePolicySchema.index({ company: 1, sortOrder: 1 });
leavePolicySchema.index({ company: 1, department: 1, sortOrder: 1 });
leavePolicySchema.index({ company: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("LeavePolicy", leavePolicySchema);
