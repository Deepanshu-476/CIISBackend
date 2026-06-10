const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true
  },
  companyCode: {
    type: String,
    trim: true,
    uppercase: true,
    index: true
  },
  otp: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model('OTP', otpSchema);
