const mongoose = require("mongoose");

const leaveTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  nameKey: { type: String, required: true, trim: true, lowercase: true },
  description: { type: String, trim: true, default: "", maxlength: 300 },
  sortOrder: { type: Number, default: 1, min: 0 },
  status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  isCustom: { type: Boolean, default: true },
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  companyCode: { type: String, trim: true, required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

leaveTypeSchema.index({ company: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model("LeaveType", leaveTypeSchema);
