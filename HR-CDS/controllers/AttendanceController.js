
const Attendance = require("../models/Attendance");
const User = require("../../models/User");
const Company = require("../../models/Company");
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
  if (isValidObjectId(id)) {
    return await Attendance.findById(id);
  }
  
  if (id.startsWith('absent_')) {
    const parts = id.split('_');
    if (parts.length < 3) {
      throw new Error("Invalid absent record ID format");
    }
    
    const userId = parts[1];
    const dateStr = parts[2];
    
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }
    
    const searchDate = new Date(dateStr);
    searchDate.setHours(0, 0, 0, 0);
    const endOfDay = new Date(searchDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    let record = await Attendance.findOne({
      user: userId,
      date: { $gte: searchDate, $lte: endOfDay }
    }).populate("user", "name email employeeType companyCode");
    
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
      record = await Attendance.findById(record._id).populate("user", "name email employeeType companyCode");
    }
    
    return record;
  }
  
  return null;
};

// Get user's company code for filtering
const getUserCompanyCode = async (userId) => {
  try {
    const user = await User.findById(userId).select('companyCode company');
    if (user) {
      // Check both companyCode field and populated company
      return user.companyCode || (user.company ? user.company.companyCode : null);
    }
    return null;
  } catch (error) {
    console.error("Error getting user company code:", error);
    return null;
  }
};

// Clock In - UPDATED with company filtering
const clockIn = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "User company code not found. Please contact admin." 
      });
    }
    
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const alreadyIn = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart } 
    });
    
    if (alreadyIn) {
      return res.status(400).json({ 
        message: "✅ You've already logged your attendance today." 
      });
    }

    const halfDayThreshold = new Date(now);
    halfDayThreshold.setHours(10, 0, 0, 0);
    
    const lateThresholdEnd = new Date(now);
    lateThresholdEnd.setHours(9, 30, 0, 0);
    
    const lateThresholdStart = new Date(now);
    lateThresholdStart.setHours(9, 10, 0, 0);
    
    const shiftStart = new Date(now);
    shiftStart.setHours(9, 0, 0, 0);

    const lateBy = now > shiftStart ? formatDuration(now - shiftStart) : "00:00:00";

    let status = "PRESENT";
    
    if (now >= halfDayThreshold) {
      status = "HALFDAY";
    } else if (now >= lateThresholdStart && now <= lateThresholdEnd) {
      status = "LATE";
    } else if (now > lateThresholdEnd && now < halfDayThreshold) {
      status = "HALFDAY";
    }

    const newRecord = new Attendance({
      user: userId,
      date: now,
      inTime: now,
      lateBy,
      status: status,
      isClockedIn: true,
      totalTime: "00:00:00",
      overTime: "00:00:00",
      earlyLeave: "00:00:00",
      companyCode: userCompanyCode // Add company code to attendance record
    });

    await newRecord.save();

    const populatedRecord = await Attendance.findById(newRecord._id)
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      });

    res.status(200).json({
      message: "Clocked in successfully",
      data: {
        ...populatedRecord.toObject(),
        login: formatTime(populatedRecord.inTime),
        status: populatedRecord.status
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

// Clock Out - UPDATED with company filtering
const clockOut = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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

    const totalMs = now - new Date(record.inTime);
    const totalHours = totalMs / (1000 * 60 * 60);

    record.outTime = now;
    record.isClockedIn = false;
    record.totalTime = formatDuration(totalMs);
    record.overTime = now > shiftEnd ? formatDuration(now - shiftEnd) : "00:00:00";
    record.earlyLeave = now < shiftEnd ? formatDuration(shiftEnd - now) : "00:00:00";

    const loginTime = new Date(record.inTime);
    const halfDayThreshold = new Date(loginTime);
    halfDayThreshold.setHours(10, 0, 0, 0);
    
    const lateThresholdEnd = new Date(loginTime);
    lateThresholdEnd.setHours(9, 30, 0, 0);
    
    const lateThresholdStart = new Date(loginTime);
    lateThresholdStart.setHours(9, 10, 0, 0);

    if (loginTime >= halfDayThreshold) {
      record.status = "HALFDAY";
    } else if (loginTime > lateThresholdEnd && loginTime < halfDayThreshold) {
      if (totalHours >= 9) {
        record.status = "HALFDAY";
      } else if (totalHours >= 5) {
        record.status = "HALFDAY";
      } else {
        record.status = "ABSENT";
      }
    } else if (loginTime >= lateThresholdStart && loginTime <= lateThresholdEnd) {
      if (totalHours >= 9) {
        record.status = "LATE";
      } else if (totalHours >= 5) {
        record.status = "HALFDAY";
      } else {
        record.status = "ABSENT";
      }
    } else {
      if (totalHours >= 9) {
        record.status = "PRESENT";
      } else if (totalHours >= 5) {
        record.status = "HALFDAY";
      } else {
        record.status = "ABSENT";
      }
    }

    // Ensure company code is set
    if (!record.companyCode && userCompanyCode) {
      record.companyCode = userCompanyCode;
    }

    await record.save();

    const populatedRecord = await Attendance.findById(record._id)
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      });

    res.status(200).json({
      message: "Clocked out successfully",
      data: {
        ...populatedRecord.toObject(),
        login: formatTime(populatedRecord.inTime),
        logout: formatTime(populatedRecord.outTime),
        status: populatedRecord.status
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

// Get Today's Status - UPDATED
const getTodayStatus = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const today = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart, $lte: todayEnd } 
    });

    if (!today) {
      const currentTime = new Date();
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      
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
      status: today.status
    });
  } catch (err) {
    console.error("Get Today Status Error:", err.message);
    res.status(500).json({ 
      message: "Server error while checking status",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Get Attendance List for User - UPDATED with company filtering
const getAttendanceList = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const { month, year } = req.query;
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "User company code not found" 
      });
    }
    
    const now = new Date();
    const queryMonth = month !== undefined ? parseInt(month) : now.getMonth();
    const queryYear = year !== undefined ? parseInt(year) : now.getFullYear();
    
    const startOfMonth = new Date(queryYear, queryMonth, 1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(queryYear, queryMonth + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    let endDate = endOfMonth;
    const today = new Date();
    
    if (queryYear === today.getFullYear() && queryMonth === today.getMonth()) {
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    } else if (queryYear > today.getFullYear() || 
               (queryYear === today.getFullYear() && queryMonth > today.getMonth())) {
      endDate = new Date(startOfMonth);
    }

    // Fetch attendance records filtered by company code
    const list = await Attendance.find({ 
      user: userId,
      companyCode: userCompanyCode, // Add company code filter
      date: { $gte: startOfMonth, $lte: endDate }
    })
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      })
      .sort({ date: 1 });

    // Generate all dates in the month
    const allDatesInMonth = [];
    const currentDate = new Date(startOfMonth);
    
    while (currentDate <= endDate) {
      allDatesInMonth.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const existingRecordsMap = {};
    list.forEach(record => {
      const recordDate = new Date(record.date);
      const dateKey = `${recordDate.getFullYear()}-${recordDate.getMonth()}-${recordDate.getDate()}`;
      existingRecordsMap[dateKey] = record;
    });

    const completeList = allDatesInMonth.map(date => {
      const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

      if (existingRecordsMap[dateKey]) {
        return existingRecordsMap[dateKey];
      } else {
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        return {
          _id: `absent_${userId}_${date.toISOString().split('T')[0]}`,
          user: {
            _id: userId,
            name: req.user.name || 'User',
            email: req.user.email,
            employeeType: req.user.employeeType,
            companyCode: userCompanyCode
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
          companyCode: userCompanyCode, // Add company code to absent records
          notes: isWeekend ? "Weekend" : "No attendance recorded",
          createdAt: date,
          updatedAt: date
        };
      }
    });

    res.status(200).json({
      message: `Attendance records fetched for ${new Date(queryYear, queryMonth).toLocaleString('default', { month: 'long', year: 'numeric' })}`,
      data: completeList.map(rec => ({
        ...rec.toObject ? rec.toObject() : rec,
        login: formatTime(rec.inTime),
        logout: formatTime(rec.outTime),
        status: rec.status || 'ABSENT'
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

// Get All Users Attendance (Admin) - UPDATED with company filtering
const getAllUsersAttendance = async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const { date } = req.query;
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    let filter = { companyCode: userCompanyCode }; // Filter by company code

    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    }

    const records = await Attendance.find(filter)
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      })
      .sort({ date: -1 });

    res.status(200).json({ 
      message: "All attendance records fetched successfully",
      data: records.map(record => ({
        ...record.toObject(),
        status: record.status || 'ABSENT'
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

// Update Attendance Record (Admin) - UPDATED
const updateAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    console.log("Update request received:", { id, updateData });
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    let record = await findAttendanceRecord(id, updateData);
    
    if (!record) {
      return res.status(404).json({ 
        message: "Attendance record not found",
        id: id
      });
    }
    
    // Verify the record belongs to the same company
    if (record.companyCode && record.companyCode !== userCompanyCode) {
      return res.status(403).json({ 
        message: "Access denied. Record belongs to different company." 
      });
    }
    
    // Update inTime if provided
    if (updateData.inTime) {
      record.inTime = new Date(updateData.inTime);
      
      const shiftStart = new Date(record.inTime);
      shiftStart.setHours(9, 0, 0, 0);
      
      if (record.inTime > shiftStart) {
        record.lateBy = formatDuration(record.inTime - shiftStart);
      } else {
        record.lateBy = "00:00:00";
      }
      
      const loginTime = record.inTime;
      const hour = loginTime.getHours();
      const minute = loginTime.getMinutes();
      const totalMinutes = (hour * 60) + minute;
      
      if (totalMinutes >= 600) {
        record.status = "HALFDAY";
      } else if (totalMinutes >= 570) {
        record.status = "HALFDAY";
      } else if (totalMinutes >= 550) {
        record.status = "LATE";
      } else {
        record.status = "PRESENT";
      }
    }
    
    // Update outTime if provided
    if (updateData.outTime) {
      record.outTime = new Date(updateData.outTime);
      record.isClockedIn = false;
      
      if (record.inTime && record.outTime) {
        const totalMs = record.outTime - record.inTime;
        record.totalTime = formatDuration(totalMs);
        
        const shiftEnd = new Date(record.outTime);
        shiftEnd.setHours(19, 0, 0, 0);
        
        record.overTime = record.outTime > shiftEnd ? 
          formatDuration(record.outTime - shiftEnd) : "00:00:00";
        record.earlyLeave = record.outTime < shiftEnd ? 
          formatDuration(shiftEnd - record.outTime) : "00:00:00";
        
        const totalHours = totalMs / (1000 * 60 * 60);
        const loginTime = record.inTime;
        const halfDayThreshold = new Date(loginTime);
        halfDayThreshold.setHours(10, 0, 0, 0);
        
        const lateThresholdEnd = new Date(loginTime);
        lateThresholdEnd.setHours(9, 30, 0, 0);
        
        const lateThresholdStart = new Date(loginTime);
        lateThresholdStart.setHeaders(9, 10, 0, 0);
        
        if (loginTime >= halfDayThreshold) {
          record.status = "HALFDAY";
        } else if (loginTime > lateThresholdEnd && loginTime < halfDayThreshold) {
          if (totalHours >= 9) {
            record.status = "HALFDAY";
          } else if (totalHours >= 5) {
            record.status = "HALFDAY";
          } else {
            record.status = "ABSENT";
          }
        } else if (loginTime >= lateThresholdStart && loginTime <= lateThresholdEnd) {
          if (totalHours >= 9) {
            if (record.status !== "LATE") {
              record.status = "PRESENT";
            }
          } else if (totalHours >= 5) {
            record.status = "HALFDAY";
          } else {
            record.status = "ABSENT";
          }
        } else {
          if (totalHours >= 9) {
            record.status = "PRESENT";
          } else if (totalHours >= 5) {
            record.status = "HALFDAY";
          } else {
            record.status = "ABSENT";
          }
        }
      }
    }
    
    // Update status if explicitly provided
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
    
    // Ensure company code is set
    if (!record.companyCode) {
      record.companyCode = userCompanyCode;
    }
    
    await record.save();
    
    const populatedRecord = await Attendance.findById(record._id)
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      });
    
    res.status(200).json({ 
      message: "Attendance updated successfully", 
      data: {
        ...populatedRecord.toObject(),
        status: populatedRecord.status || 'ABSENT'
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

// Create Manual Attendance (Admin) - UPDATED
const createManualAttendance = async (req, res) => {
  try {
    const { user, date, inTime, outTime, status, lateBy, earlyLeave, overTime, notes } = req.body;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    console.log("Creating manual attendance:", req.body);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    if (!user || !date) {
      return res.status(400).json({ 
        message: "User and date are required fields" 
      });
    }
    
    const userExists = await User.findById(user);
    if (!userExists) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }
    
    // Verify user belongs to same company
    if (userExists.companyCode !== userCompanyCode) {
      return res.status(403).json({ 
        message: "Cannot create attendance for user from different company" 
      });
    }
    
    const existingDate = new Date(date);
    existingDate.setHours(0, 0, 0, 0);
    const endOfDay = new Date(existingDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    const existingAttendance = await Attendance.findOne({
      user,
      date: { $gte: existingDate, $lte: endOfDay }
    });
    
    if (existingAttendance) {
  existingAttendance.status = status ? status.toUpperCase() : existingAttendance.status;
  existingAttendance.inTime = inTime ? new Date(inTime) : existingAttendance.inTime;
  existingAttendance.outTime = outTime ? new Date(outTime) : existingAttendance.outTime;
  existingAttendance.lateBy = lateBy || existingAttendance.lateBy;
  existingAttendance.earlyLeave = earlyLeave || existingAttendance.earlyLeave;
  existingAttendance.overTime = overTime || existingAttendance.overTime;
  existingAttendance.notes = notes || existingAttendance.notes;

  await existingAttendance.save();

  return res.status(200).json({
    message: "Attendance updated successfully",
    data: existingAttendance
  });
}

    
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
      isClockedIn: !outTime,
      companyCode: userCompanyCode // Add company code
    });
    
    await attendance.save();
    
    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      });
    
    res.status(201).json({
      message: "Attendance created successfully",
      data: {
        ...populatedAttendance.toObject(),
        status: populatedAttendance.status || 'ABSENT'
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

// Delete Attendance Record (Admin) - UPDATED
const deleteAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    console.log("Delete request received for ID:", id);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    if (isValidObjectId(id)) {
      const record = await Attendance.findById(id);
      
      if (!record) {
        return res.status(404).json({ 
          message: "Attendance record not found" 
        });
      }
      
      // Verify record belongs to same company
      if (record.companyCode && record.companyCode !== userCompanyCode) {
        return res.status(403).json({ 
          message: "Cannot delete attendance from different company" 
        });
      }
      
      await Attendance.findByIdAndDelete(id);
      
      return res.status(200).json({ 
        message: "Attendance record deleted successfully" 
      });
    }
    
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

// Get Attendance by User ID (Admin) - UPDATED
const getAttendanceByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { date } = req.query;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ 
        message: "Invalid user ID" 
      });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }
    
    // Verify user belongs to same company
    if (user.companyCode !== userCompanyCode) {
      return res.status(403).json({ 
        message: "Cannot access attendance for user from different company" 
      });
    }
    
    let query = { 
      user: userId,
      companyCode: userCompanyCode // Add company filter
    };
    
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.date = { $gte: start, $lte: end };
    }
    
    const records = await Attendance.find(query)
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      })
      .sort({ date: -1 });
    
    res.status(200).json({ 
      message: "Attendance records fetched successfully", 
      data: records.map(record => ({
        ...record.toObject(),
        status: record.status || 'ABSENT'
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

// Mark Daily Absent (Cron Job) - UPDATED
const markDailyAbsent = async () => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    
    // Get all companies
    const companies = await Company.find({ isActive: true });
    
    for (const company of companies) {
      // Get all users for this company
      const companyUsers = await User.find({ 
        companyCode: company.companyCode,
        isActive: true 
      });
      
      // For each user in company, check attendance
      for (const user of companyUsers) {
        const existingAttendance = await Attendance.findOne({
          user: user._id,
          date: { $gte: todayStart, $lte: todayEnd }
        });
        
        if (!existingAttendance) {
          const now = new Date();
          const absentThreshold = new Date();
          absentThreshold.setHours(10, 0, 0, 0);
          
          if (now >= absentThreshold) {
            const absentRecord = new Attendance({
              user: user._id,
              date: todayStart,
              status: "ABSENT",
              isClockedIn: false,
              companyCode: company.companyCode // Add company code
            });
            
            await absentRecord.save();
          }
        }
      }
    }
    
    console.log("Daily absent marking completed for all companies");
  } catch (err) {
    console.error("Mark Daily Absent Error:", err.message);
  }
};

// Get Attendance Statistics - UPDATED
const getAttendanceStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    let matchStage = { companyCode: userCompanyCode }; // Filter by company code
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      matchStage.date = { $gte: start, $lte: end };
    }
    
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
              $cond: [{ $eq: ["$status", "HALFDAY"] }, 1, 0]
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
console.log("✅ AttendanceController.js loaded successfully");