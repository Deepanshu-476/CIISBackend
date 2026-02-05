// models/Attendance.js
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  inTime: {
    type: Date
  },
  outTime: {
    type: Date
  },
  status: {
    type: String,
    enum: ['PRESENT', 'LATE', 'HALF DAY', 'ABSENT', 'WEEKEND'],
    default: 'ABSENT'
  },
  lateBy: {
    type: String,
    default: "00:00:00"
  },
  earlyLeave: {
    type: String,
    default: "00:00:00"
  },
  overTime: {
    type: String,
    default: "00:00:00"
  },
  totalTime: {
    type: String,
    default: "00:00:00"
  },
  notes: {
    type: String
  },
  isClockedIn: {
    type: Boolean,
    default: false
  },
    companyCode: {
    type: String,
    required: true,
    index: true,
    default: 'UNKNOWN' 
  }
}, {
  timestamps: true
});

// Index for faster queries
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;