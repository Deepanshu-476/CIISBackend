
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
  clockOutMode: {
    type: String,
    enum: ['MANUAL', 'AUTO'],
    default: null
  },
  status: {
    type: String,
    enum: ['PRESENT', 'LATE', 'HALF DAY', 'ABSENT', 'WEEKEND','HALFDAY', 'SHORT LEAVE'],
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
  shiftId: {
    type: String,
    trim: true
  },
  shiftName: {
    type: String,
    trim: true
  },
  shiftType: {
    type: String,
    trim: true
  },
  shiftStart: {
    type: String,
    trim: true
  },
  shiftEnd: {
    type: String,
    trim: true
  },
  earlyClockInStart: {
    type: String,
    trim: true
  },
  lateGraceLimit: {
    type: String,
    trim: true
  },
  halfDayLateLimit: {
    type: String,
    trim: true
  },
  shortLeaveEarlyLimit: {
    type: String,
    trim: true
  },
  halfDayEarlyLimit: {
    type: String,
    trim: true
  },
  shiftWindow: {
    start: { type: Date },
    end: { type: Date }
  },
  inLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    accuracy: { type: Number },
    distanceFromOfficeMeters: { type: Number }
  },
  outLocation: {
    latitude: { type: Number },
    longitude: { type: Number },
    accuracy: { type: Number },
    distanceFromOfficeMeters: { type: Number }
  },
  inSelfieUrl: { type: String },
  outSelfieUrl: { type: String },
  companyCode: {
    type: String,
    required: true,
    index: true,
    default: 'UNKNOWN' 
  }
}, {
  timestamps: true
});


attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ companyCode: 1, date: 1, status: 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
