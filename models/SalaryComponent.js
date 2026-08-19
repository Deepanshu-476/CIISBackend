const mongoose = require("mongoose");

const salaryComponentSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
  type: { type: String, enum: ["earning", "deduction"], required: true },
  sortOrder: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  proRata: { type: Boolean, default: true },
  taxable: { type: Boolean, default: true },
  grossSalary: { type: Boolean, default: true },
  pfWage: { type: Boolean, default: false },
  esiWage: { type: Boolean, default: false },
  ptWage: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

salaryComponentSchema.index({ company: 1, code: 1 }, { unique: true });
salaryComponentSchema.index({ company: 1, sortOrder: 1 });

module.exports = mongoose.model("SalaryComponent", salaryComponentSchema);
