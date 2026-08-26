const mongoose = require("mongoose");

const componentBreakdownSchema = new mongoose.Schema({
  component: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryComponent", required: true },
  name: { type: String, trim: true },
  code: { type: String, trim: true, uppercase: true },
  type: { type: String, enum: ["earning", "deduction"], required: true },
  calculationType: { type: String, enum: ["manual", "percentage", "formula", "balance"], default: "manual" },
  calculationBase: { type: String, trim: true, default: "" },
  formula: { type: String, trim: true, default: "" },
  value: { type: Number, default: 0 },
  amount: { type: Number, required: true, default: 0 },
  annualAmount: { type: Number, default: 0 },
  isOverride: { type: Boolean, default: false },
  isLocked: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 1 }
}, { _id: false });

const revisionHistorySchema = new mongoose.Schema({
  salaryStructure: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryStructure" },
  salaryStructureName: { type: String, default: "" },
  salaryType: { type: String, enum: ["monthly", "annual"], default: "monthly" },
  salaryInputType: { type: String, enum: ["gross", "ctc"], default: "gross" },
  currency: { type: String, default: "INR" },
  payFrequency: { type: String, default: "Monthly" },
  paymentMode: { type: String, default: "Bank Transfer" },
  bankAccount: { type: String, default: "" },
  baseAmount: { type: Number, default: 0 },
  monthlyGross: { type: Number, default: 0 },
  monthlyNet: { type: Number, default: 0 },
  monthlyCTC: { type: Number, default: 0 },
  annualCTC: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  components: [componentBreakdownSchema],
  effectiveFrom: { type: Date },
  effectiveTo: { type: Date },
  notes: { type: String, trim: true, default: "" },
  remarks: { type: String, trim: true, default: "" },
  revisedAt: { type: Date, default: Date.now },
  revisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { _id: true });

const employeeSalarySchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  salaryStructure: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryStructure", required: true },
  department: { type: String, trim: true, default: "" },
  designation: { type: String, trim: true, default: "" },
  dateOfJoining: { type: Date },
  salaryType: { type: String, enum: ["monthly", "annual"], default: "monthly" },
  salaryInputType: { type: String, enum: ["gross", "ctc"], default: "gross" },
  currency: { type: String, default: "INR" },
  payFrequency: { type: String, enum: ["Monthly", "Semi-Monthly", "Weekly", "Bi-Weekly", "Annual"], default: "Monthly" },
  paymentMode: { type: String, enum: ["Bank Transfer", "Cash", "Cheque", "UPI"], default: "Bank Transfer" },
  bankAccount: { type: String, trim: true, default: "" },
  baseAmount: { type: Number, required: true, min: 0 },
  monthlyGross: { type: Number, required: true, min: 0, default: 0 },
  monthlyNet: { type: Number, required: true, min: 0, default: 0 },
  monthlyCTC: { type: Number, required: true, min: 0, default: 0 },
  annualCTC: { type: Number, required: true, min: 0, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date },
  status: { type: String, enum: ["active", "inactive", "revised"], default: "active", index: true },
  components: { type: [componentBreakdownSchema], default: [] },
  history: { type: [revisionHistorySchema], default: [] },
  notes: { type: String, trim: true, maxlength: 500, default: "" },
  remarks: { type: String, trim: true, maxlength: 500, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

employeeSalarySchema.index({ company: 1, user: 1 });
employeeSalarySchema.index({ company: 1, status: 1, effectiveFrom: -1 });

module.exports = mongoose.model("EmployeeSalary", employeeSalarySchema);
