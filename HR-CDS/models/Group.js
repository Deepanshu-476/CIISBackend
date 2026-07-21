const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
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
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true 
});


groupSchema.index({ createdBy: 1, isActive: 1 });
groupSchema.index({ members: 1 });
groupSchema.index({ company: 1, isActive: 1 });
groupSchema.index({ companyCode: 1, isActive: 1 });

module.exports = mongoose.model('Group', groupSchema);
