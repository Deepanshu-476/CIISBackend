const mongoose = require('mongoose');

const loginOTPSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    index: true,
    lowercase: true,
    trim: true
  },
  otp: { 
    type: String, 
    required: true 
  },
  tempToken: { 
    type: String, 
    required: true 
  },
  expiresAt: { 
    type: Date, 
    required: true, 
    default: () => new Date(Date.now() + 5 * 60 * 1000) 
  },
  attempts: { 
    type: Number, 
    default: 0 
  },
  verified: { 
    type: Boolean, 
    default: false 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});


loginOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LoginOTP', loginOTPSchema);