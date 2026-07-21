const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    index: true
  },
  companyCode: {
    type: String,
    trim: true,
    index: true
  },
  type: {
    type: String,
    enum: ['info', 'warning', 'error'],
    default: 'info'
  },
  message: {
    type: String,
    required: true
  },
  assignedUsers: [
    { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      default: [] 
    }
  ],
  assignedGroups: [
    { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Group',
      default: [] 
    }
  ],
  readBy: [
    { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      default: [] 
    }
  ],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { 
  timestamps: true 
});


alertSchema.index({ assignedUsers: 1 });
alertSchema.index({ assignedGroups: 1 });
alertSchema.index({ createdBy: 1 });
alertSchema.index({ company: 1, createdAt: -1 });
alertSchema.index({ companyCode: 1, createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
