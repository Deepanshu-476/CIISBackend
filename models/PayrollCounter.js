const mongoose = require("mongoose");

const payrollCounterSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
  key: { type: String, required: true, trim: true },
  sequence: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

payrollCounterSchema.index({ company: 1, key: 1 }, { unique: true });

module.exports = mongoose.model("PayrollCounter", payrollCounterSchema);
