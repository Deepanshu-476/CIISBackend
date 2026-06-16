const mongoose = require('mongoose');

const clientDocumentSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
    index: true,
  },
  companyCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    index: true,
  },
  originalName: {
    type: String,
    required: true,
    trim: true,
  },
  storedName: {
    type: String,
    required: true,
  },
  path: {
    type: String,
    required: true,
  },
  mimeType: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    default: 0,
  },
  category: {
    type: String,
    default: 'General',
    trim: true,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  uploadedByName: {
    type: String,
    default: 'User',
  },
  uploadedByRole: {
    type: String,
    enum: ['client', 'company'],
    default: 'company',
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, { timestamps: true });

clientDocumentSchema.index({ client: 1, createdAt: -1 });
clientDocumentSchema.index({ companyCode: 1, createdAt: -1 });

module.exports = mongoose.model('ClientDocument', clientDocumentSchema);
