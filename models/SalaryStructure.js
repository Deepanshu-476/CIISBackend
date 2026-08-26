const mongoose = require("mongoose");
const rowSchema = new mongoose.Schema({
  component: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryComponent", required: true },
  calculationType: { type: String, enum: ["manual", "percentage", "formula", "balance"], default: "manual" },
  calculationBase: { type: String, trim: true, default: "" }, value: { type: Number, min: 0, default: 0 },
  formula: { type: String, trim: true, maxlength: 500, default: "" }, sortOrder: { type: Number, required: true, min: 1 },
});
const schema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
  salaryType: { type: String, enum: ["monthly", "annual"], default: "monthly" },
  salaryInputType: { type: String, enum: ["gross", "ctc"], default: "gross" },
  effectiveFrom: { type: Date, required: true }, description: { type: String, trim: true, maxlength: 500, default: "" },
  status: { type: String, enum: ["active", "inactive"], default: "active" }, components: { type: [rowSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
schema.index({ company: 1, code: 1 }, { unique: true });
schema.index({ company: 1, status: 1, effectiveFrom: -1 });
module.exports = mongoose.model("SalaryStructure", schema);
