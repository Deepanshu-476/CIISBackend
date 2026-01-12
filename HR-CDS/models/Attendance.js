const mongoose = require("mongoose");

// Helper: Get today's date at 00:00:00
const getTodayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const attendanceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    date: {
      type: Date,
      required: true,
      default: getTodayStart
    },
    inTime: {
      type: Date
    },
    outTime: {
      type: Date
    },
    totalTime: {
      type: String,
      default: "00:00:00"
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
    status: {
      type: String,
      enum: ["PRESENT", "HALF DAY", "LATE", "ABSENT"], // Added "LATE"
      default: "ABSENT"
    },
    isClockedIn: {
      type: Boolean,
      default: false
    },
    notes: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

// Index: Prevent multiple entries for same user on same day
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);