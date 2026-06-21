const mongoose = require('mongoose');

const taskTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  dueInDays: { type: Number, default: 0, min: 0 }
}, { _id: true });

const serviceTemplateSchema = new mongoose.Schema({
  service: { type: String, required: true, trim: true },
  tasks: { type: [taskTemplateSchema], default: [] }
}, { _id: true });

const clientPlanSchema = new mongoose.Schema({
  companyCode: { type: String, required: true, trim: true, uppercase: true, index: true },
  name: { type: String, required: true, trim: true },
  price: { type: Number, default: 0, min: 0 },
  months: { type: Number, default: 1, min: 1 },
  description: { type: String, trim: true, default: '' },
  services: { type: [serviceTemplateSchema], default: [] },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

clientPlanSchema.index({ companyCode: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('ClientPlan', clientPlanSchema);
