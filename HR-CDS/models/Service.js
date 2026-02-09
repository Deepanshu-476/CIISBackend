const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  companyCode: {
    type: String,
    required: [true, 'Company code is required'],
    trim: true,
    uppercase: true
  },
  servicename: {
    type: String,
    required: [true, 'Service name is required'],
    trim: true,
    maxlength: [100, 'Service name cannot exceed 100 characters'],
    lowercase: true
  }
}, {
  timestamps: true
});

// Unique service per company
serviceSchema.index({ companyCode: 1, servicename: 1 }, { unique: true });

// Pre-save middleware
serviceSchema.pre('save', function(next) {
  if (this.companyCode) {
    this.companyCode = this.companyCode.trim().toUpperCase();
  }
  if (this.servicename) {
    this.servicename = this.servicename.trim().toLowerCase();
  }
  next();
});

module.exports = mongoose.model('Service', serviceSchema);
