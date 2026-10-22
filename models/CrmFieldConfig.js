const mongoose = require('mongoose');

// Admin-defined names and types for a company's five lead custom fields (customField1-5).
const fieldSchema = new mongoose.Schema({
  key: { type: String, enum: ['customField1', 'customField2', 'customField3', 'customField4', 'customField5'], required: true },
  label: { type: String, default: '', trim: true, maxlength: 40 },
  type: { type: String, enum: ['text', 'number', 'date', 'dropdown'], default: 'text' },
  options: [{ type: String, trim: true, maxlength: 60 }],
  required: { type: Boolean, default: false },
  showInCallForm: { type: Boolean, default: false }
}, { _id: false });

const crmFieldConfigSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
  fields: [fieldSchema]
}, { timestamps: true });

module.exports = mongoose.model('CrmFieldConfig', crmFieldConfigSchema);
