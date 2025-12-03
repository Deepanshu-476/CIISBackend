const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
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

// Add index for better performance
alertSchema.index({ assignedUsers: 1 });
alertSchema.index({ assignedGroups: 1 });
alertSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Alert', alertSchema);