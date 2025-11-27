const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  servicename: {
    type: String,
    required: [true, 'Service name is required'],
    unique: true,
    trim: true,
    maxlength: [100, 'Service name cannot exceed 100 characters'],
    lowercase: true
  }
}, {
  timestamps: true
});

// Pre-save middleware to ensure name is properly formatted
serviceSchema.pre('save', function(next) {
  if (this.servicename) {
    this.servicename = this.servicename.trim().toLowerCase();
  }
  next();
});

module.exports = mongoose.model('Service', serviceSchema);