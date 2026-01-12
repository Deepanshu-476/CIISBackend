const Attendance = require("../models/Attendance");
const User = require("../../models/User");
const mongoose = require("mongoose");

// Helper function: Format duration in HH:MM:SS
const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

// Helper function: Format time to readable string
const formatTime = (date) => {
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
};

// Check if ID is a valid MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Find or create attendance record based on ID
const findAttendanceRecord = async (id, updateData = {}) => {
  // If ID is a valid ObjectId, search by _id
  if (isValidObjectId(id)) {
    return await Attendance.findById(id);
  }
  
  // If ID starts with 'absent_', it's a frontend-generated ID
  if (id.startsWith('absent_')) {
    const parts = id.split('_');
    if (parts.length < 3) {
      throw new Error("Invalid absent record ID format");
    }
    
    const userId = parts[1];
    const dateStr = parts[2];
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    
    // Convert date string to Date object
    const searchDate = new Date(dateStr);
    searchDate.setHours(0, 0, 0, 0);
    const endOfDay = new Date(searchDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Try to find existing record
    let record = await Attendance.findOne({
      user: userId,
      date: { $gte: searchDate, $lte: endOfDay }
    }).populate("user", "name email employeeType");
    
    // If record doesn't exist, create a new one
    if (!record) {
      record = new Attendance({
        user: userId,
        date: searchDate,
        inTime: null,
        outTime: null,
        status: "ABSENT",
        lateBy: "00:00:00",
        earlyLeave: "00:00:00",
        overTime: "00:00:00",
        totalTime: "00:00:00",
        isClockedIn: false
      });
      
      await record.save();
      // Populate user data
      record = await Attendance.findById(record._id).populate("user", "name email employeeType");
    }
    
    return record;
  }
  
  return null;
};

// Clock In
const clockIn = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Check if already clocked in today
    const alreadyIn = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart } 
    });
    
    if (alreadyIn) {
      return res.status(400).json({ 
        message: "✅ You've already logged your attendance today." 
      });
    }

    // Calculate thresholds
    const halfDayThreshold = new Date(now);
    halfDayThreshold.setHours(10, 0, 0, 0);
    
    const lateThreshold = new Date(now);
    lateThreshold.setHours(9, 30, 0, 0);
    
    const shiftStart = new Date(now);
    shiftStart.setHours(9, 0, 0, 0);

    // Calculate lateBy
    const lateBy = now > shiftStart ? formatDuration(now - shiftStart) : "00:00:00";

    // Determine status
    let status = "PRESENT";
    if (now >= halfDayThreshold) {
      status = "HALF DAY";
    } else if (now >= lateThreshold) {
      status = "LATE";
    }

    // Create new record
    const newRecord = new Attendance({
      user: userId,
      date: now,
      inTime: now,
      lateBy,
      status: status,
      isClockedIn: true,
      totalTime: "00:00:00",
      overTime: "00:00:00",
      earlyLeave: "00:00:00"
    });

    await newRecord.save();

    // Populate user data
    const populatedRecord = await Attendance.findById(newRecord._id)
      .populate("user", "name email employeeType");

    res.status(200).json({
      message: "Clocked in successfully",
      data: {
        ...populatedRecord.toObject(),
        login: formatTime(populatedRecord.inTime),
        status: populatedRecord.status.toLowerCase()
      }
    });
  } catch (err) {
    console.error("Clock In Error:", err.message);
    res.status(500).json({ 
      message: "Server error while clocking in",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Clock Out
const clockOut = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Find today's record
    const record = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart } 
    });

    if (!record || record.outTime) {
      return res.status(400).json({ 
        message: "Not clocked in or already clocked out" 
      });
    }

    const shiftEnd = new Date(now);
    shiftEnd.setHours(19, 0, 0, 0);

    // Calculate total time worked
    const totalMs = now - new Date(record.inTime);
    const totalHours = totalMs / (1000 * 60 * 60);

    // Update record
    record.outTime = now;
    record.isClockedIn = false;
    record.totalTime = formatDuration(totalMs);
    record.overTime = now > shiftEnd ? formatDuration(now - shiftEnd) : "00:00:00";
    record.earlyLeave = now < shiftEnd ? formatDuration(shiftEnd - now) : "00:00:00";

    // Update status based on login time and hours worked
    const loginTime = new Date(record.inTime);
    const halfDayThreshold = new Date(loginTime);
    halfDayThreshold.setHours(10, 0, 0, 0);
    
    const lateThreshold = new Date(loginTime);
    lateThreshold.setHours(9, 30, 0, 0);

    // Rule 1: If logged in after 10:00, always HALF DAY
    if (loginTime >= halfDayThreshold) {
      record.status = "HALF DAY";
    } 
    // Rule 2: If logged in between 9:30-10:00, status depends on hours worked
    else if (loginTime >= lateThreshold) {
      if (totalHours >= 9) {
        record.status = "PRESENT";
      } else if (totalHours >= 5) {
        record.status = "HALF DAY";
      } else {
        record.status = "ABSENT";
      }
    }
    // Rule 3: If logged in before 9:30, use original rules
    else {
      if (totalHours >= 9) {
        record.status = "PRESENT";
      } else if (totalHours >= 5) {
        record.status = "HALF DAY";
      } else {
        record.status = "ABSENT";
      }
    }

    await record.save();

    // Populate user data
    const populatedRecord = await Attendance.findById(record._id)
      .populate("user", "name email employeeType");

    res.status(200).json({
      message: "Clocked out successfully",
      data: {
        ...populatedRecord.toObject(),
        login: formatTime(populatedRecord.inTime),
        logout: formatTime(populatedRecord.outTime),
        status: populatedRecord.status.toLowerCase()
      }
    });
  } catch (err) {
    console.error("Clock Out Error:", err.message);
    res.status(500).json({ 
      message: "Server error while clocking out",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Get Today's Status
const getTodayStatus = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Find today's attendance
    const today = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart, $lte: todayEnd } 
    });

    if (!today) {
      // Check if it's past 10:00 AM and no attendance recorded
      const currentTime = new Date();
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      
      // If current time is after 10:00 AM and before end of day, mark as ABSENT
      const absentThreshold = new Date();
      absentThreshold.setHours(10, 0, 0, 0);
      
      if (currentTime >= absentThreshold && currentTime <= endOfDay) {
        return res.status(200).json({
          isClockedIn: false,
          status: "ABSENT",
          message: "No attendance recorded today"
        });
      }
      
      return res.status(200).json({ 
        isClockedIn: false,
        message: "No attendance recorded yet"
      });
    }

    res.status(200).json({
      ...today.toObject(),
      login: formatTime(today.inTime),
      logout: formatTime(today.outTime),
      status: today.status.toLowerCase()
    });
  } catch (err) {
    console.error("Get Today Status Error:", err.message);
    res.status(500).json({ 
      message: "Server error while checking status",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Get Attendance List for User
// Get Attendance List for User - FIXED VERSION
const getAttendanceList = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    
    // Get current month and year
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    // Calculate start and end of current month
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);
    
    // Get attendance records for the user for current month
    const list = await Attendance.find({ 
      user: userId,
      date: { $gte: startOfMonth, $lte: endOfMonth }
    })
      .populate("user", "name email employeeType")
      .sort({ date: 1 }); // Sort by date ascending

    // Generate absent records for missing dates in current month
    const allDatesInMonth = [];
    const currentDate = new Date(startOfMonth);
    
    while (currentDate <= endOfMonth) {
      allDatesInMonth.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Create a map of existing records by date
    const existingRecordsMap = {};
    list.forEach(record => {
      const recordDate = new Date(record.date);
      const dateKey = `${recordDate.getFullYear()}-${recordDate.getMonth()}-${recordDate.getDate()}`;
      existingRecordsMap[dateKey] = record;
    });

    // Create absent records for missing dates
    const completeList = allDatesInMonth.map(date => {
      const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      
      if (existingRecordsMap[dateKey]) {
        // Return existing record
        return existingRecordsMap[dateKey];
      } else {
        // Create absent record for missing date
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        // Check if it's a future date
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (date > today) {
          // Future date - no record
          return null;
        }
        
        // Create absent record
        const absentRecord = {
          _id: `absent_${userId}_${date.toISOString().split('T')[0]}`,
          user: {
            _id: userId,
            name: req.user.name || 'User',
            email: req.user.email,
            employeeType: req.user.employeeType
          },
          date: date,
          inTime: null,
          outTime: null,
          status: isWeekend ? "WEEKEND" : "ABSENT",
          lateBy: "00:00:00",
          earlyLeave: "00:00:00",
          overTime: "00:00:00",
          totalTime: "00:00:00",
          isClockedIn: false,
          notes: isWeekend ? "Weekend" : "No attendance recorded",
          createdAt: date,
          updatedAt: date
        };
        
        return absentRecord;
      }
    }).filter(record => record !== null); // Remove null records (future dates)

    res.status(200).json({
      message: "Attendance records fetched",
      data: completeList.map(rec => ({
        ...rec.toObject ? rec.toObject() : rec,
        login: formatTime(rec.inTime),
        logout: formatTime(rec.outTime),
        status: rec.status ? rec.status.toLowerCase() : 'absent'
      }))
    });
  } catch (err) {
    console.error("Get Attendance List Error:", err.message);
    res.status(500).json({ 
      message: "Server error while fetching attendance",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};
// Get All Users Attendance (Admin)
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

    // Get all attendance records
    const records = await Attendance.find(filter)
      .populate("user", "name email employeeType")
      .sort({ date: -1 });

    res.status(200).json({ 
      message: "All attendance records fetched successfully",
      data: records.map(record => ({
        ...record.toObject(),
        status: record.status ? record.status.toLowerCase() : 'absent'
      }))
    });
  } catch (err) {
    console.error("Get All Users Attendance Error:", err.message);
    res.status(500).json({ 
      message: "Failed to fetch all attendance records",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Update Attendance Record (Admin)
const updateAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    console.log("Update request received:", { id, updateData });
    
    // Find or create the attendance record
    let record = await findAttendanceRecord(id, updateData);
    
    if (!record) {
      return res.status(404).json({ 
        message: "Attendance record not found",
        id: id
      });
    }
    
    // Update inTime if provided
    if (updateData.inTime) {
      record.inTime = new Date(updateData.inTime);
      
      // Calculate lateBy based on inTime
      const shiftStart = new Date(record.inTime);
      shiftStart.setHours(9, 0, 0, 0);
      
      if (record.inTime > shiftStart) {
        record.lateBy = formatDuration(record.inTime - shiftStart);
      } else {
        record.lateBy = "00:00:00";
      }
      
      // Auto-calculate status based on inTime
      const loginTime = record.inTime;
      const hour = loginTime.getHours();
      const minute = loginTime.getMinutes();
      const totalMinutes = (hour * 60) + minute;
      
      if (totalMinutes >= 600) {
        record.status = "HALF DAY";
      } else if (totalMinutes >= 570) {
        record.status = "LATE";
      } else {
        record.status = "PRESENT";
      }
    }
    
    // Update outTime if provided
    if (updateData.outTime) {
      record.outTime = new Date(updateData.outTime);
      record.isClockedIn = false;
      
      // Calculate total time if both inTime and outTime exist
      if (record.inTime && record.outTime) {
        const totalMs = record.outTime - record.inTime;
        record.totalTime = formatDuration(totalMs);
        
        // Calculate overtime and early leave
        const shiftEnd = new Date(record.outTime);
        shiftEnd.setHours(19, 0, 0, 0);
        
        record.overTime = record.outTime > shiftEnd ? 
          formatDuration(record.outTime - shiftEnd) : "00:00:00";
        record.earlyLeave = record.outTime < shiftEnd ? 
          formatDuration(shiftEnd - record.outTime) : "00:00:00";
        
        // Update status based on hours worked
        const totalHours = totalMs / (1000 * 60 * 60);
        const loginTime = record.inTime;
        const halfDayThreshold = new Date(loginTime);
        halfDayThreshold.setHours(10, 0, 0, 0);
        
        if (loginTime >= halfDayThreshold) {
          record.status = "HALF DAY";
        } else if (totalHours >= 9) {
          record.status = "PRESENT";
        } else if (totalHours >= 5) {
          record.status = "HALF DAY";
        } else {
          record.status = "ABSENT";
        }
      }
    }
    
    // Update status if explicitly provided (overrides auto-calculation)
    if (updateData.status && updateData.status.trim() !== '') {
      record.status = updateData.status.toUpperCase();
    }
    
    // Update other fields if provided
    if (updateData.lateBy !== undefined) {
      record.lateBy = updateData.lateBy;
    }
    
    if (updateData.earlyLeave !== undefined) {
      record.earlyLeave = updateData.earlyLeave;
    }
    
    if (updateData.overTime !== undefined) {
      record.overTime = updateData.overTime;
    }
    
    if (updateData.notes !== undefined) {
      record.notes = updateData.notes;
    }
    
    if (updateData.date !== undefined) {
      record.date = new Date(updateData.date);
    }
    
    // Save the updated record
    await record.save();
    
    // Populate user data
    const populatedRecord = await Attendance.findById(record._id)
      .populate("user", "name email employeeType");
    
    res.status(200).json({ 
      message: "Attendance updated successfully", 
      data: {
        ...populatedRecord.toObject(),
        status: populatedRecord.status ? populatedRecord.status.toLowerCase() : 'absent'
      }
    });
  } catch (err) {
    console.error("Update Attendance Error:", err.message);
    res.status(500).json({ 
      message: "Server error while updating attendance",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Create Manual Attendance (Admin)
const createManualAttendance = async (req, res) => {
  try {
    const { user, date, inTime, outTime, status, lateBy, earlyLeave, overTime, notes } = req.body;
    
    console.log("Creating manual attendance:", req.body);
    
    // Validate required fields
    if (!user || !date) {
      return res.status(400).json({ 
        message: "User and date are required fields" 
      });
    }
    
    // Check if user exists
    const userExists = await User.findById(user);
    if (!userExists) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }
    
    // Check if attendance already exists for this user on this date
    const existingDate = new Date(date);
    existingDate.setHours(0, 0, 0, 0);
    const endOfDay = new Date(existingDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const existingAttendance = await Attendance.findOne({
      user,
      date: { $gte: existingDate, $lte: endOfDay }
    });
    
    if (existingAttendance) {
      return res.status(400).json({ 
        message: "Attendance already exists for this user on this date",
        data: existingAttendance
      });
    }
    
    // Create new attendance record
    const attendance = new Attendance({
      user,
      date: new Date(date),
      inTime: inTime ? new Date(inTime) : null,
      outTime: outTime ? new Date(outTime) : null,
      status: status ? status.toUpperCase() : "ABSENT",
      lateBy: lateBy || "00:00:00",
      earlyLeave: earlyLeave || "00:00:00",
      overTime: overTime || "00:00:00",
      notes: notes || "",
      isClockedIn: !outTime
    });
    
    await attendance.save();
    
    // Populate user data
    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate("user", "name email employeeType");
    
    res.status(201).json({
      message: "Attendance created successfully",
      data: {
        ...populatedAttendance.toObject(),
        status: populatedAttendance.status ? populatedAttendance.status.toLowerCase() : 'absent'
      }
    });
  } catch (err) {
    console.error("Create Manual Attendance Error:", err.message);
    res.status(500).json({ 
      message: "Server error while creating attendance",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Delete Attendance Record (Admin)
const deleteAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log("Delete request received for ID:", id);
    
    // Check if ID is valid ObjectId
    if (isValidObjectId(id)) {
      const record = await Attendance.findByIdAndDelete(id);
      
      if (!record) {
        return res.status(404).json({ 
          message: "Attendance record not found" 
        });
      }
      
      return res.status(200).json({ 
        message: "Attendance record deleted successfully" 
      });
    }
    
    // If ID starts with 'absent_', it's a frontend-generated record
    if (id.startsWith('absent_')) {
      return res.status(400).json({ 
        message: "Cannot delete absent record - it doesn't exist in database",
        note: "This was a placeholder record created by the frontend"
      });
    }
    
    return res.status(400).json({ 
      message: "Invalid attendance ID" 
    });
  } catch (err) {
    console.error("Delete Attendance Error:", err.message);
    res.status(500).json({ 
      message: "Delete failed",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Get Attendance by User ID (Admin)
const getAttendanceByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { date } = req.query;
    
    // Validate user ID
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ 
        message: "Invalid user ID" 
      });
    }
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }
    
    let query = { user: userId };
    
    // Add date filter if provided
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
    }
    
    // Get attendance records
    const records = await Attendance.find(query)
      .populate("user", "name email employeeType")
      .sort({ date: -1 });
    
    res.status(200).json({ 
      message: "Attendance records fetched successfully", 
      data: records.map(record => ({
        ...record.toObject(),
        status: record.status ? record.status.toLowerCase() : 'absent'
      }))
    });
  } catch (err) {
    console.error("Get Attendance by User Error:", err.message);
    res.status(500).json({ 
      message: "Failed to fetch attendance records",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Mark Daily Absent (Cron Job)
const markDailyAbsent = async () => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    
    // Get all users
    const allUsers = await User.find({});
    
    // For each user, check if they have attendance today
    for (const user of allUsers) {
      const existingAttendance = await Attendance.findOne({
        user: user._id,
        date: { $gte: todayStart, $lte: todayEnd }
      });
      
      // If no attendance exists and it's past 10:00 AM, mark as absent
      if (!existingAttendance) {
        const now = new Date();
        const absentThreshold = new Date();
        absentThreshold.setHours(10, 0, 0, 0);
        
        if (now >= absentThreshold) {
          const absentRecord = new Attendance({
            user: user._id,
            date: todayStart,
            status: "ABSENT",
            isClockedIn: false
          });
          
          await absentRecord.save();
        }
      }
    }
    
    console.log("Daily absent marking completed");
  } catch (err) {
    console.error("Mark Daily Absent Error:", err.message);
  }
};

// Get Attendance Statistics
const getAttendanceStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let matchStage = {};
    
    // Add date filter if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      matchStage.date = { $gte: start, $lte: end };
    }
    
    // Aggregate statistics
    const stats = await Attendance.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          present: {
            $sum: {
              $cond: [{ $eq: ["$status", "PRESENT"] }, 1, 0]
            }
          },
          late: {
            $sum: {
              $cond: [{ $eq: ["$status", "LATE"] }, 1, 0]
            }
          },
          halfDay: {
            $sum: {
              $cond: [{ $eq: ["$status", "HALF DAY"] }, 1, 0]
            }
          },
          absent: {
            $sum: {
              $cond: [{ $eq: ["$status", "ABSENT"] }, 1, 0]
            }
          }
        }
      }
    ]);
    
    const result = stats[0] || {
      total: 0,
      present: 0,
      late: 0,
      halfDay: 0,
      absent: 0
    };
    
    res.status(200).json({
      message: "Attendance statistics fetched successfully",
      data: result
    });
  } catch (err) {
    console.error("Get Attendance Stats Error:", err.message);
    res.status(500).json({ 
      message: "Failed to fetch attendance statistics",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  clockIn,
  clockOut,
  getAttendanceList,
  getTodayStatus,
  getAllUsersAttendance,
  updateAttendanceRecord,
  deleteAttendanceRecord,
  createManualAttendance,
  getAttendanceByUser,
  markDailyAbsent,
  getAttendanceStats
};