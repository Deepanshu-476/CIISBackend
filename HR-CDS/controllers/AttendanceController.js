const Attendance = require("../models/Attendance");
const User = require("../../models/User");
const Company = require("../../models/Company");
const mongoose = require("mongoose");
const {notifyPageUsers, getCompanyId} = require("../utils/systemNotificationService");


const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const ATTENDANCE_TIME_ZONE = 'Asia/Kolkata';
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const toValidDate = value => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getIndiaDateParts = (value = new Date()) => {
  const date = toValidDate(value) || new Date();
  const shifted = new Date(date.getTime() + INDIA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};

const indiaDateTimeToUtc = (year, monthIndex, day, hour = 0, minute = 0, second = 0, millisecond = 0) =>
  new Date(Date.UTC(year, monthIndex, day, hour, minute, second, millisecond) - INDIA_OFFSET_MS);

const getIndiaDayStart = (value = new Date()) => {
  const {year, monthIndex, day} = getIndiaDateParts(value);
  return indiaDateTimeToUtc(year, monthIndex, day);
};

const getIndiaDayEnd = (value = new Date()) => {
  const {year, monthIndex, day} = getIndiaDateParts(value);
  return indiaDateTimeToUtc(year, monthIndex, day, 23, 59, 59, 999);
};

const getIndiaDayRange = value => ({
  start: getIndiaDayStart(value),
  end: getIndiaDayEnd(value),
});

const parseIndiaDateOnly = value => {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return indiaDateTimeToUtc(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }
  return getIndiaDayStart(value);
};

const getIndiaThreshold = (value, hour, minute = 0) => {
  const {year, monthIndex, day} = getIndiaDateParts(value);
  return indiaDateTimeToUtc(year, monthIndex, day, hour, minute);
};

const getIndiaMinutesSinceMidnight = value => {
  const {hour, minute} = getIndiaDateParts(value);
  return (hour * 60) + minute;
};

const formatIndiaDateKey = value => {
  const {year, monthIndex, day} = getIndiaDateParts(value);
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const addIndiaDays = (value, days) => new Date(value.getTime() + (days * DAY_MS));


const formatTime = (date) => {
  const validDate = toValidDate(date);
  return validDate
    ? validDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: ATTENDANCE_TIME_ZONE,
    })
    : "";
};


const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};


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
    
    const searchDate = parseIndiaDateOnly(dateStr);
    const endOfDay = getIndiaDayEnd(searchDate);
    
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


const getUserCompanyCode = async (userId) => {
  try {
    const user = await User.findById(userId).select('companyCode company');
    if (user) {
      return user.companyCode || (user.company ? user.company.companyCode : null);
    }
    return null;
  } catch (error) {
    console.error("Error getting user company code:", error);
    return null;
  }
};


const canAccessAttendance = (requestingUser, targetCompanyCode) => {
  const userCompanyCode = requestingUser.companyCode || (requestingUser.company ? requestingUser.company.companyCode : null);
  
  
  return userCompanyCode === targetCompanyCode;
};

const notifyEmployeeAttendancePage = async ({
  req,
  userId,
  type,
  title,
  message,
  attendanceId,
  status,
  time,
  extraData = {},
}) => {
  try {
    const companyId = getCompanyId(req.user);
    void 0;

    await notifyPageUsers({
      companyId,
      targetPath: '/ciisUser/emp-attendance',
      targetScreen: 'Employee Attendance',
      excludeUserIds: [userId],
      type,
      title,
      message,
      actor: userId,
      data: {
        attendanceId,
        userId,
        userName: req.user.name,
        status,
        time,
        targetPath: '/ciisUser/emp-attendance',
        targetScreen: 'Employee Attendance',
        ...extraData,
      },
      priority: 'medium',
    });

    void 0;
  } catch (error) {
    console.error('[ATTENDANCE NOTIFICATION] failed', {
      at: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
    });
  }
};


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
    const {start: todayStart, end: todayEnd} = getIndiaDayRange(now);

    const alreadyIn = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart, $lte: todayEnd } 
    });
    
    if (alreadyIn) {
      return res.status(400).json({ 
        message: "✅ You've already logged your attendance today." 
      });
    }

    const halfDayThreshold = getIndiaThreshold(now, 10, 0);
    const lateThresholdEnd = getIndiaThreshold(now, 9, 30);
    const lateThresholdStart = getIndiaThreshold(now, 9, 10);
    const shiftStart = getIndiaThreshold(now, 9, 0);

    const lateBy = now > shiftStart ? formatDuration(now - shiftStart) : "00:00:00";

    let status = "PRESENT";
    
    if (now >= halfDayThreshold) {
      status = "HALF DAY";
    } else if (now >= lateThresholdStart && now <= lateThresholdEnd) {
      status = "LATE";
    } else if (now > lateThresholdEnd && now < halfDayThreshold) {
      status = "HALF DAY";
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
      companyCode: userCompanyCode
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

    await notifyEmployeeAttendancePage({
      req,
      userId,
      type: 'attendance_clock_in',
      title: 'Employee Clock In',
      message: `${req.user.name || 'An employee'} clocked in at ${formatTime(now)}`,
      attendanceId: newRecord._id,
      status,
      time: now,
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


const clockOut = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    const now = new Date();
    const {start: todayStart, end: todayEnd} = getIndiaDayRange(now);

    const record = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart, $lte: todayEnd } 
    });

    if (!record || record.outTime) {
      return res.status(400).json({ 
        message: "Not clocked in or already clocked out" 
      });
    }

    const shiftEnd = getIndiaThreshold(now, 19, 0);

    const totalMs = now - new Date(record.inTime);
    const totalHours = totalMs / (1000 * 60 * 60);

    record.outTime = now;
    record.isClockedIn = false;
    record.totalTime = formatDuration(totalMs);
    record.overTime = now > shiftEnd ? formatDuration(now - shiftEnd) : "00:00:00";
    record.earlyLeave = now < shiftEnd ? formatDuration(shiftEnd - now) : "00:00:00";

    const loginTime = new Date(record.inTime);
    const halfDayThreshold = getIndiaThreshold(loginTime, 10, 0);
    const lateThresholdEnd = getIndiaThreshold(loginTime, 9, 30);
    const lateThresholdStart = getIndiaThreshold(loginTime, 9, 10);

    if (loginTime >= halfDayThreshold) {
      record.status = "HALF DAY";
    } else if (loginTime > lateThresholdEnd && loginTime < halfDayThreshold) {
      if (totalHours >= 9) {
        record.status = "HALF DAY";
      } else if (totalHours >= 5) {
        record.status = "HALF DAY";
      } else {
        record.status = "ABSENT";
      }
    } else if (loginTime >= lateThresholdStart && loginTime <= lateThresholdEnd) {
      if (totalHours >= 9) {
        record.status = "LATE";
      } else if (totalHours >= 5) {
        record.status = "HALF DAY";
      } else {
        record.status = "ABSENT";
      }
    } else {
      if (totalHours >= 9) {
        record.status = "PRESENT";
      } else if (totalHours >= 5) {
        record.status = "HALF DAY";
      } else {
        record.status = "ABSENT";
      }
    }

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

    await notifyEmployeeAttendancePage({
      req,
      userId,
      type: 'attendance_clock_out',
      title: 'Employee Clock Out',
      message: `${req.user.name || 'An employee'} clocked out at ${formatTime(now)}`,
      attendanceId: record._id,
      status: record.status,
      time: now,
      extraData: {
        totalTime: record.totalTime,
      },
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


const getTodayStatus = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    const now = new Date();
    const {start: todayStart, end: todayEnd} = getIndiaDayRange(now);

    const today = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart, $lte: todayEnd } 
    });

    if (!today) {
      const currentTime = new Date();
      const endOfDay = getIndiaDayEnd(currentTime);
      const absentThreshold = getIndiaThreshold(currentTime, 10, 0);
      
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


const getAttendanceList = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const { month, year } = req.query;
    
    
    const targetUserId = req.params.userId || userId;
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "User company code not found" 
      });
    }
    
    
    const targetUser = await User.findById(targetUserId).select('companyCode');
    if (!targetUser || targetUser.companyCode !== userCompanyCode) {
      return res.status(403).json({ 
        message: "Access denied. User belongs to different company." 
      });
    }
    
    let query = { 
      user: targetUserId,
      companyCode: userCompanyCode
    };
    
    let allDates = [];
    let isAllTime = false;
    let startDate, endDate;
    
    
    if (month === undefined || year === undefined || month === 'all' || year === 'all') {
      isAllTime = true;
      
      
      const user = await User.findById(targetUserId).select('createdAt');
      const userJoinDate = user?.createdAt || new Date(2020, 0, 1);
      
      startDate = getIndiaDayStart(userJoinDate);
      endDate = getIndiaDayEnd(new Date());
      
      query.date = { $gte: startDate, $lte: endDate };
      
      void 0;
    } else {
      
      const queryMonth = parseInt(month);
      const queryYear = parseInt(year);
      
      startDate = indiaDateTimeToUtc(queryYear, queryMonth, 1);
      endDate = indiaDateTimeToUtc(queryYear, queryMonth + 1, 0, 23, 59, 59, 999);
      
      query.date = { $gte: startDate, $lte: endDate };
    }

    
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      allDates.push(new Date(currentDate));
      currentDate = addIndiaDays(currentDate, 1);
    }

    void 0;

    
    const list = await Attendance.find(query)
      .populate({
        path: "user",
        select: "name email employeeType companyCode",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      })
      .sort({ date: 1 });

    
    const existingRecordsMap = {};
    list.forEach(record => {
      const dateKey = formatIndiaDateKey(record.date);
      existingRecordsMap[dateKey] = record;
    });

    
    const completeList = allDates.map(date => {
      const dateKey = formatIndiaDateKey(date);

      if (existingRecordsMap[dateKey]) {
        
        const record = existingRecordsMap[dateKey];
        return {
          ...record.toObject ? record.toObject() : record,
          login: formatTime(record.inTime),
          logout: formatTime(record.outTime),
          status: record.status || 'ABSENT'
        };
      } else {
        
        const dayOfWeek = new Date(date.getTime() + INDIA_OFFSET_MS).getUTCDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        return {
          _id: `absent_${targetUserId}_${dateKey}`,
          user: {
            _id: targetUserId,
            name: targetUser?.name || 'User',
            email: targetUser?.email,
            employeeType: targetUser?.employeeType,
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
          companyCode: userCompanyCode,
          notes: isWeekend ? "Weekend" : "No attendance recorded",
          createdAt: date,
          updatedAt: date,
          login: "",
          logout: ""
        };
      }
    });

    
    completeList.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.status(200).json({
      message: isAllTime 
        ? `All time attendance records fetched successfully from ${formatIndiaDateKey(startDate)} to ${formatIndiaDateKey(endDate)}` 
        : `Attendance records fetched for ${indiaDateTimeToUtc(parseInt(year), parseInt(month), 1).toLocaleString('default', { month: 'long', year: 'numeric', timeZone: ATTENDANCE_TIME_ZONE })}`,
      data: completeList
    });

  } catch (err) {
    console.error("Get Attendance List Error:", err.message);
    res.status(500).json({ 
      message: "Server error while fetching attendance",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};


const getAllUsersAttendance = async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const { date, userId } = req.query;
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    let filter = { companyCode: userCompanyCode };
    
    
    if (userId && isValidObjectId(userId)) {
      filter.user = userId;
    }

    if (date) {
      const {start, end} = getIndiaDayRange(parseIndiaDateOnly(date));
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


const updateAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    void 0;
    
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
    
    if (record.companyCode && record.companyCode !== userCompanyCode) {
      return res.status(403).json({ 
        message: "Access denied. Record belongs to different company." 
      });
    }
    
    
    
    if (updateData.inTime) {
      record.inTime = new Date(updateData.inTime);
      
      const shiftStart = getIndiaThreshold(record.inTime, 9, 0);
      
      if (record.inTime > shiftStart) {
        record.lateBy = formatDuration(record.inTime - shiftStart);
      } else {
        record.lateBy = "00:00:00";
      }
      
      const loginTime = record.inTime;
      const totalMinutes = getIndiaMinutesSinceMidnight(loginTime);
      
      if (totalMinutes >= 600) {
        record.status = "HALF DAY";
      } else if (totalMinutes >= 570) {
        record.status = "HALF DAY";
      } else if (totalMinutes >= 550) {
        record.status = "LATE";
      } else {
        record.status = "PRESENT";
      }
    }
    
    if (updateData.outTime) {
      record.outTime = new Date(updateData.outTime);
      record.isClockedIn = false;
      
      if (record.inTime && record.outTime) {
        const totalMs = record.outTime - record.inTime;
        record.totalTime = formatDuration(totalMs);
        
        const shiftEnd = getIndiaThreshold(record.outTime, 19, 0);
        
        record.overTime = record.outTime > shiftEnd ? 
          formatDuration(record.outTime - shiftEnd) : "00:00:00";
        record.earlyLeave = record.outTime < shiftEnd ? 
          formatDuration(shiftEnd - record.outTime) : "00:00:00";
        
        const totalHours = totalMs / (1000 * 60 * 60);
        const loginTime = record.inTime;
        const halfDayThreshold = getIndiaThreshold(loginTime, 10, 0);
        const lateThresholdEnd = getIndiaThreshold(loginTime, 9, 30);
        const lateThresholdStart = getIndiaThreshold(loginTime, 9, 10);
        
        if (loginTime >= halfDayThreshold) {
          record.status = "HALF DAY";
        } else if (loginTime > lateThresholdEnd && loginTime < halfDayThreshold) {
          if (totalHours >= 9) {
            record.status = "HALF DAY";
          } else if (totalHours >= 5) {
            record.status = "HALF DAY";
          } else {
            record.status = "ABSENT";
          }
        } else if (loginTime >= lateThresholdStart && loginTime <= lateThresholdEnd) {
          if (totalHours >= 9) {
            if (record.status !== "LATE") {
              record.status = "PRESENT";
            }
          } else if (totalHours >= 5) {
            record.status = "HALF DAY";
          } else {
            record.status = "ABSENT";
          }
        } else {
          if (totalHours >= 9) {
            record.status = "PRESENT";
          } else if (totalHours >= 5) {
            record.status = "HALF DAY";
          } else {
            record.status = "ABSENT";
          }
        }
      }
    }
    
    if (updateData.status && updateData.status.trim() !== '') {
      record.status = updateData.status.toUpperCase();
    }
    
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
      record.date = parseIndiaDateOnly(updateData.date);
    }
    
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


const createManualAttendance = async (req, res) => {
  try {
    const { user, date, inTime, outTime, status, lateBy, earlyLeave, overTime, notes } = req.body;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    void 0;
    
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
    
    
    if (userExists.companyCode !== userCompanyCode) {
      return res.status(403).json({ 
        message: "Cannot create attendance for user from different company" 
      });
    }
    
    const existingDate = parseIndiaDateOnly(date);
    const endOfDay = getIndiaDayEnd(existingDate);
    
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
      existingAttendance.companyCode = userCompanyCode;

      await existingAttendance.save();

      return res.status(200).json({
        message: "Attendance updated successfully",
        data: existingAttendance
      });
    }
    
    const attendance = new Attendance({
      user,
      date: existingDate,
      inTime: inTime ? new Date(inTime) : null,
      outTime: outTime ? new Date(outTime) : null,
      status: status ? status.toUpperCase() : "ABSENT",
      lateBy: lateBy || "00:00:00",
      earlyLeave: earlyLeave || "00:00:00",
      overTime: overTime || "00:00:00",
      notes: notes || "",
      isClockedIn: !outTime,
      companyCode: userCompanyCode
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


const deleteAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    void 0;
    
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
    
    
    if (user.companyCode !== userCompanyCode) {
      return res.status(403).json({ 
        message: "Cannot access attendance for user from different company" 
      });
    }
    
    let query = { 
      user: userId,
      companyCode: userCompanyCode
    };
    
    if (date) {
      const {start, end} = getIndiaDayRange(parseIndiaDateOnly(date));
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


const markDailyAbsent = async () => {
  try {
    const nowForDay = new Date();
    const {start: todayStart, end: todayEnd} = getIndiaDayRange(nowForDay);
    
    const companies = await Company.find({ isActive: true });
    
    for (const company of companies) {
      const companyUsers = await User.find({ 
        companyCode: company.companyCode,
        isActive: true 
      });
      
      for (const user of companyUsers) {
        const existingAttendance = await Attendance.findOne({
          user: user._id,
          date: { $gte: todayStart, $lte: todayEnd }
        });
        
        if (!existingAttendance) {
          const now = new Date();
          const absentThreshold = getIndiaThreshold(now, 10, 0);
          
          if (now >= absentThreshold) {
            const absentRecord = new Attendance({
              user: user._id,
              date: todayStart,
              status: "ABSENT",
              isClockedIn: false,
              companyCode: company.companyCode
            });
            
            await absentRecord.save();
          }
        }
      }
    }
    
    void 0;
  } catch (err) {
    console.error("Mark Daily Absent Error:", err.message);
  }
};


const getAttendanceStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    let matchStage = { companyCode: userCompanyCode };
    
    if (startDate && endDate) {
      const start = parseIndiaDateOnly(startDate);
      const end = getIndiaDayEnd(parseIndiaDateOnly(endDate));
      
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
              $cond: [{ $in: ["$status", ["HALF DAY", "HALFDAY"]] }, 1, 0]
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

void 0;
