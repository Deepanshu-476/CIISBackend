const mongoose = require('mongoose');

// Saved WhatsApp/SMS messages telecallers send to leads in one tap. Placeholders: {name}, {phone}, {agent}, {company}.
const messageTemplateSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 60 },
  body: { type: String, required: true, trim: true, maxlength: 1000 },
  channel: { type: String, enum: ['whatsapp', 'sms', 'both'], default: 'both' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' }
}, { timestamps: true });

messageTemplateSchema.index({ company: 1, title: 1 });

module.exports = mongoose.model('MessageTemplate', messageTemplateSchema);
