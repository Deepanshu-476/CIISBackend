const mongoose = require('mongoose');

const companyRegistrationRequestSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true
  },
  companyEmail: {
    type: String,
    required: [true, 'Company email is required'],
    trim: true,
    lowercase: true,
    index: true
  },
  companyPhone: {
    type: String,
    required: [true, 'Company phone is required'],
    trim: true
  },
  companyAddress: {
    type: String,
    required: [true, 'Company address is required'],
    trim: true
  },
  department: {
    type: String,
    trim: true,
    default: 'Management'
  },
  status: {
    type: String,
    enum: ['Profile Completed', 'Converted', 'Archived'],
    default: 'Profile Completed',
    index: true
  },
  source: {
    type: String,
    trim: true,
    default: '/RegisterCompany'
  },
  convertedCompany: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null
  }
}, {
  timestamps: true
});

companyRegistrationRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CompanyRegistrationRequest', companyRegistrationRequestSchema);
