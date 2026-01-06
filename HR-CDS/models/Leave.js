const mongoose = require('mongoose');

/* =========================
   HISTORY SUB-SCHEMA
========================= */
const historySchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['applied', 'approved', 'rejected', 'pending'],
    required: true
  },

  by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',              // ✅ REAL USER ID
    required: true
  },

  role: {
    type: String,
    enum: ['employee', 'hr', 'admin', 'manager'],
    required: true
  },

  remarks: {
    type: String,
    default: ''
  },

  at: {
    type: Date,
    default: Date.now
  }
});

/* =========================
   LEAVE MAIN SCHEMA
========================= */
const leaveSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  type: {
    type: String,
    enum: ['Casual', 'Sick', 'Paid', 'Unpaid', 'Other'],
    required: true
  },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

  reason: {
    type: String,
    required: true,
    trim: true
  },

  days: {
    type: Number,
    required: true,
    min: 1
  },

  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },

  // 🔹 Quick access fields (latest action)
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',              // ✅ last approver ID
    default: null
  },

  remarks: {
    type: String,
    default: ''
  },

  history: [historySchema]     // ✅ FULL AUDIT TRAIL
}, {
  timestamps: true
});

module.exports = mongoose.model('Leave', leaveSchema);
