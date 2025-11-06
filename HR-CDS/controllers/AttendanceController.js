const Attendance = require("../models/Attendance");

// Convert milliseconds to HH:MM:SS
const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const formatTime = (date) => {
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
};

// ✅ CLOCK IN
const clockIn = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const alreadyIn = await Attendance.findOne({ user: userId, date: { $gte: todayStart } });
    if (alreadyIn) {
      return res.status(400).json({ message: "✅ You’ve already logged your attendance today." });
    }

    const shiftStart = new Date(now);
    shiftStart.setHours(9, 0, 0, 0);
    const lateBy = now > shiftStart
  ? (formatDuration(now - shiftStart) || "00:00:00")
  : "00:00:00";


    const newRecord = new Attendance({
      user: userId,
      date: now,
      inTime: now,
      lateBy,
      status: "PRESENT",
      isClockedIn: true,
      totalTime: "00:00:00",
      overTime: "00:00:00",
      earlyLeave: "00:00:00"
    });

    await newRecord.save();

    res.status(200).json({
      message: "Clocked in successfully",
      data: {
        _id: newRecord._id,
        date: newRecord.date,
        inTime: newRecord.inTime,
        login: formatTime(newRecord.inTime),
        isClockedIn: true,
        totalTime: "00:00:00",
        lateBy,
        overTime: "00:00:00",
        earlyLeave: "00:00:00",
        status: "PRESENT"
      }
    });
  } catch (err) {
    console.error("Clock In Error:", err.message);
    res.status(500).json({ message: "Server error while clocking in" });
  }
};

// ✅ CLOCK OUT
const clockOut = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const record = await Attendance.findOne({ user: userId, date: { $gte: todayStart } });

    if (!record || record.outTime) {
      return res.status(400).json({ message: "Not clocked in or already clocked out" });
    }

    const shiftEnd = new Date(now);
    shiftEnd.setHours(19, 0, 0, 0);

    const totalMs = now - new Date(record.inTime);
    const totalHours = totalMs / (1000 * 60 * 60);

    record.outTime = now;
    record.isClockedIn = false;
    record.totalTime = formatDuration(totalMs);
    record.overTime = now > shiftEnd ? formatDuration(now - shiftEnd) : "00:00:00";
    record.earlyLeave = now < shiftEnd ? formatDuration(shiftEnd - now) : "00:00:00";

    // record.status = totalHours >= 8 ? "PRESENT" : (totalHours > 0 ? "HALF DAY" : "ABSENT");
    record.status = totalHours >= 9 
  ? "PRESENT" 
  : (totalHours >= 5 
      ? "HALF DAY" 
      : "ABSENT");


    await record.save();

    res.status(200).json({
      message: "Clocked out successfully",
      data: {
        _id: record._id,
        date: record.date,
        inTime: record.inTime,
        outTime: record.outTime,
        login: formatTime(record.inTime),
        logout: formatTime(record.outTime),
        totalTime: record.totalTime,
        lateBy: record.lateBy,
        overTime: record.overTime,
        earlyLeave: record.earlyLeave,
        status: record.status,
        isClockedIn: false
      }
    });
  } catch (err) {
    console.error("Clock Out Error:", err.message);
    res.status(500).json({ message: "Server error while clocking out" });
  }
};

// ✅ GET ATTENDANCE LIST
const getAttendanceList = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const list = await Attendance.find({ user: userId }).sort({ date: -1 });

    res.status(200).json({
      message: "Attendance records fetched",
      data: list.map(rec => ({
        _id: rec._id,
        date: rec.date,
        inTime: rec.inTime,
        outTime: rec.outTime,
        login: formatTime(rec.inTime),
        logout: formatTime(rec.outTime),
        totalTime: rec.totalTime,
        lateBy: rec.lateBy,
        overTime: rec.overTime,
        earlyLeave: rec.earlyLeave,
        status: rec.status
      }))
    });
  } catch (err) {
    console.error("Get Attendance List Error:", err.message);
    res.status(500).json({ message: "Server error while fetching attendance" });
  }
};

// ✅ GET TODAY STATUS
const getTodayStatus = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const today = await Attendance.findOne({ user: userId, date: { $gte: todayStart } });

    if (!today) {
      return res.status(200).json({ isClockedIn: false });
    }

    res.status(200).json({
      _id: today._id,
      isClockedIn: today.isClockedIn,
      date: today.date,
      inTime: today.inTime,
      outTime: today.outTime,
      login: formatTime(today.inTime),
      logout: formatTime(today.outTime),
      totalTime: today.totalTime,
      lateBy: today.lateBy,
      overTime: today.overTime,
      earlyLeave: today.earlyLeave,
      status: today.status
    });
  } catch (err) {
    console.error("Get Today Status Error:", err.message);
    res.status(500).json({ message: "Server error while checking status" });
  }
};

// ✅ ADMIN: ALL USER ATTENDANCE (with optional date filter)
const getAllUsersAttendance = async (req, res) => {
  try {
    const { date } = req.query;
    let filter = {};

    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const records = await Attendance.find(filter)
      .populate("user", "name email employeeType")
      .sort({ date: -1 });

    res.status(200).json({ message: "All attendance records", data: records });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch all attendance records" });
  }
};

// ✅ ADMIN: UPDATE RECORD
const updateAttendanceRecord = async (req, res) => {
  try {
    const record = await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json({ message: "Attendance updated", data: record });
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
};

// ✅ ADMIN: DELETE RECORD
const deleteAttendanceRecord = async (req, res) => {
  try {
    await Attendance.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Attendance record deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
};

module.exports = {
  clockIn,
  clockOut,
  getAttendanceList,
  getTodayStatus,
  getAllUsersAttendance,
  updateAttendanceRecord,
  deleteAttendanceRecord
};
