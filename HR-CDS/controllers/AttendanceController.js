const Attendance = require("../models/Attendance");
const User = require("../../models/User");
const Company = require("../../models/Company");
const Branch = require("../../models/Branch");
const Department = require("../../models/Department");
const JobRole = require("../../models/JobRole");
const mongoose = require("mongoose");
const {notifyPageUsers, getCompanyId} = require("../utils/systemNotificationService");
const { getPaginationOptions, buildPaginationMeta } = require("../../utils/pagination");
const { runAutoClockOutSweep } = require("../cron/forceClockOut");


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

const normalizeIdList = (value) => {
  const input = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(input
    .map(item => {
      if (!item) return '';
      if (typeof item === 'object') return String(item._id || item.id || item.value || '').trim();
      return String(item).trim();
    })
    .filter(Boolean)
  )];
};

const canViewAllBranchData = (user = {}) => {
  const roleText = String(user.companyRole || user.jobRole || user.role || '').trim().toLowerCase();
  return ['owner', 'super_admin', 'admin', 'hr'].includes(roleText);
};

const getUserBranchIds = (user = {}) => normalizeIdList([
  user.branch,
  ...(Array.isArray(user.assignedBranches) ? user.assignedBranches : [])
]);

const isWorkFromHomeEmployee = (user = {}) => {
  if (user.workFromHome === true || user.isWorkFromHome === true || user.isRemote === true) {
    return true;
  }

  const values = [
    user.employeeType,
    user.workLocation,
    user.attendanceType,
    user.workMode,
  ].map(value => String(value || '').trim().toLowerCase());

  return values.some(value => {
    const compact = value.replace(/[\s_-]+/g, '');
    return ['workfromhome', 'wfh', 'remote', 'remotework', 'home'].includes(compact) ||
      value.includes('work from home') ||
      value.includes('work-from-home') ||
      value.includes('remote');
  });
};

const refreshAutoClockOuts = async () => {
  try {
    await runAutoClockOutSweep();
  } catch (error) {
    console.error("[AutoClockOut] refresh failed:", error.message);
  }
};

const getBranchScopedUserIds = async (req, companyCode) => {
  const requestedBranch = req.query?.branch || req.query?.branchId;
  if (!requestedBranch || !isValidObjectId(requestedBranch)) return null;

  const requestedBranchId = String(requestedBranch);
  const accessibleBranchIds = getUserBranchIds(req.user || {});
  if (!canViewAllBranchData(req.user) && !accessibleBranchIds.includes(requestedBranchId)) {
    return [];
  }

  const users = await User.find({
    companyCode,
    $or: [
      { branch: requestedBranchId },
      { assignedBranches: requestedBranchId }
    ]
  }).select('_id').lean();

  return users.map(user => user._id);
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

const parseTimeToMinutes = (value, fallback = "00:00") => {
  const [rawHour, rawMinute] = String(value || fallback).split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return parseTimeToMinutes(fallback, "00:00");
  }
  return ((hour % 24) * 60) + Math.max(0, Math.min(59, minute));
};

const getShiftTime = (shiftSettings, key, fallback) => {
  const value = shiftSettings?.[key];
  return typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim())
    ? value.trim()
    : fallback;
};

const formatMinutesAsTime = minutes => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};

const buildShiftSchedule = (referenceDate, shiftSettings = {}) => {
  const shiftStartStr = getShiftTime(shiftSettings, "shiftStart", "09:00");
  const shiftEndStr = getShiftTime(shiftSettings, "shiftEnd", "19:00");
  const earlyClockInStartStr = getShiftTime(shiftSettings, "earlyClockInStart", "08:30");
  const lateGraceLimitStr = getShiftTime(shiftSettings, "lateGraceLimit", "09:10");
  // Half-day is an automatic attendance policy: two hours after this
  // employee's assigned shift starts. It does not depend on a UI input.
  const halfDayLateLimitStr = formatMinutesAsTime(parseTimeToMinutes(shiftStartStr) + 120);
  const shortLeaveEarlyLimitStr = getShiftTime(shiftSettings, "shortLeaveEarlyLimit", "18:30");
  const halfDayEarlyLimitStr = getShiftTime(shiftSettings, "halfDayEarlyLimit", "15:00");

  const startMinutes = parseTimeToMinutes(shiftStartStr);
  const endMinutes = parseTimeToMinutes(shiftEndStr);
  const isOvernight = endMinutes <= startMinutes;
  const referenceMinutes = getIndiaMinutesSinceMidnight(referenceDate);
  const anchorReference = isOvernight && referenceMinutes <= endMinutes
    ? addIndiaDays(referenceDate, -1)
    : referenceDate;

  const { year, monthIndex, day } = getIndiaDateParts(anchorReference);
  const atMinutes = minutes => indiaDateTimeToUtc(
    year,
    monthIndex,
    day,
    Math.floor(minutes / 60),
    minutes % 60
  );
  const addDayIfBeforeStart = date => date < atMinutes(startMinutes) ? addIndiaDays(date, 1) : date;

  let shiftStart = atMinutes(startMinutes);
  let shiftEnd = atMinutes(endMinutes);
  if (isOvernight) shiftEnd = addIndiaDays(shiftEnd, 1);

  const earlyClockInStart = atMinutes(parseTimeToMinutes(earlyClockInStartStr));
  const lateGraceLimit = addDayIfBeforeStart(atMinutes(parseTimeToMinutes(lateGraceLimitStr)));
  const halfDayLateLimit = addDayIfBeforeStart(atMinutes(parseTimeToMinutes(halfDayLateLimitStr)));
  const shortLeaveEarlyLimit = addDayIfBeforeStart(atMinutes(parseTimeToMinutes(shortLeaveEarlyLimitStr)));
  const halfDayEarlyLimit = addDayIfBeforeStart(atMinutes(parseTimeToMinutes(halfDayEarlyLimitStr)));

  return {
    shiftStartStr,
    shiftEndStr,
    earlyClockInStartStr,
    lateGraceLimitStr,
    halfDayLateLimitStr,
    shortLeaveEarlyLimitStr,
    halfDayEarlyLimitStr,
    shiftStart,
    shiftEnd,
    earlyClockInStart,
    lateGraceLimit,
    halfDayLateLimit,
    shortLeaveEarlyLimit,
    halfDayEarlyLimit,
    dateStart: getIndiaDayStart(shiftStart),
    dateEnd: getIndiaDayEnd(shiftStart),
  };
};

const buildShiftSnapshot = (shiftSettings = {}, schedule) => {
  const source = shiftSettings || {};
  return {
    shiftId: String(source.shiftId || source.id || source._id || ""),
    shiftName: source.shiftName || source.name || "General Shift",
    shiftType: source.shiftType || "general",
    shiftStart: schedule.shiftStartStr,
    shiftEnd: schedule.shiftEndStr,
    earlyClockInStart: schedule.earlyClockInStartStr,
    lateGraceLimit: schedule.lateGraceLimitStr,
    halfDayLateLimit: schedule.halfDayLateLimitStr,
    shortLeaveEarlyLimit: schedule.shortLeaveEarlyLimitStr,
    halfDayEarlyLimit: schedule.halfDayEarlyLimitStr,
    shiftWindow: {
      start: schedule.shiftStart,
      end: schedule.shiftEnd
    }
  };
};

const applyShiftSnapshot = (record, snapshot = {}) => {
  record.shiftId = snapshot.shiftId;
  record.shiftName = snapshot.shiftName;
  record.shiftType = snapshot.shiftType;
  record.shiftStart = snapshot.shiftStart;
  record.shiftEnd = snapshot.shiftEnd;
  record.earlyClockInStart = snapshot.earlyClockInStart;
  record.lateGraceLimit = snapshot.lateGraceLimit;
  record.halfDayLateLimit = snapshot.halfDayLateLimit;
  record.shortLeaveEarlyLimit = snapshot.shortLeaveEarlyLimit;
  record.halfDayEarlyLimit = snapshot.halfDayEarlyLimit;
  record.shiftWindow = snapshot.shiftWindow;
};

const getRecordShiftSettings = (record) => ({
  shiftId: record.shiftId,
  shiftName: record.shiftName,
  shiftType: record.shiftType,
  shiftStart: record.shiftStart || "09:00",
  shiftEnd: record.shiftEnd || "19:00",
  earlyClockInStart: record.earlyClockInStart || record.shiftStart || "09:00",
  lateGraceLimit: record.lateGraceLimit || record.shiftStart || "09:00",
  halfDayLateLimit: record.halfDayLateLimit || record.shiftStart || "09:00",
  shortLeaveEarlyLimit: record.shortLeaveEarlyLimit || record.shiftEnd || "19:00",
  halfDayEarlyLimit: record.halfDayEarlyLimit || record.shiftEnd || "19:00"
});

const normalizeClockOutMode = (value) => {
  const mode = String(value || '').trim().toUpperCase();
  return mode === 'AUTO' ? 'AUTO' : 'MANUAL';
};

const calculateAttendanceByShift = ({ inTime, outTime, shiftSettings, currentStatus }) => {
  if (!inTime) {
    return {
      status: currentStatus || "ABSENT",
      lateBy: "00:00:00",
      earlyLeave: "00:00:00",
      overTime: "00:00:00",
      totalTime: "00:00:00"
    };
  }

  const schedule = buildShiftSchedule(inTime, shiftSettings);
  const lateBy = inTime > schedule.lateGraceLimit ? formatDuration(inTime - schedule.shiftStart) : "00:00:00";
  let status = "PRESENT";

  if (inTime >= schedule.halfDayLateLimit) {
    status = "HALF DAY";
  } else if (inTime > schedule.lateGraceLimit && inTime < schedule.halfDayLateLimit) {
    status = "LATE";
  }

  if (!outTime) {
    return {
      status,
      lateBy,
      earlyLeave: "00:00:00",
      overTime: "00:00:00",
      totalTime: "00:00:00"
    };
  }

  const totalMs = outTime - inTime;
  let finalStatus = status;

  // Preserve a late clock-in classification during clock-out recalculation.
  // Early clock-out rules apply only to employees who clocked in on time;
  // otherwise a valid LATE record (for example, 10:00 for a 09:00 shift)
  // was incorrectly overwritten as HALF DAY.
  if (finalStatus === "PRESENT") {
    if (outTime < schedule.halfDayEarlyLimit) {
      finalStatus = "HALF DAY";
    } else if (outTime < schedule.shortLeaveEarlyLimit) {
      finalStatus = "SHORT LEAVE";
    }
  }

  return {
    status: finalStatus,
    lateBy,
    earlyLeave: outTime < schedule.shiftEnd ? formatDuration(schedule.shiftEnd - outTime) : "00:00:00",
    overTime: outTime > schedule.shiftEnd ? formatDuration(outTime - schedule.shiftEnd) : "00:00:00",
    totalTime: formatDuration(Math.max(totalMs, 0))
  };
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

const buildLocationPayload = ({ latitude, longitude, accuracy, distanceFromOfficeMeters }) => {
  if (latitude === undefined || longitude === undefined) return null;

  const location = {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };

  if (accuracy !== undefined && accuracy !== null && accuracy !== "") {
    location.accuracy = Number(accuracy);
  }

  if (distanceFromOfficeMeters !== undefined && distanceFromOfficeMeters !== null) {
    location.distanceFromOfficeMeters = Math.round(Number(distanceFromOfficeMeters));
  }

  return location;
};

const toFiniteCoordinate = value => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const earthRadiusMeters = 6371000;
  const toRadians = degrees => degrees * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const startLat = toRadians(lat1);
  const endLat = toRadians(lat2);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMeters * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const validateCompanyLocationRange = ({ company, latitude, longitude, actionLabel }) => {
  const officeLatitude = toFiniteCoordinate(company?.officeLocation?.latitude);
  const officeLongitude = toFiniteCoordinate(company?.officeLocation?.longitude);
  const userLatitude = toFiniteCoordinate(latitude);
  const userLongitude = toFiniteCoordinate(longitude);
  const allowedRadiusEnabled = company?.officeLocation?.allowedRadiusEnabled !== false;
  const allowedRadiusMeters = Number(company?.officeLocation?.allowedRadiusMeters || 100);

  if (userLatitude === null || userLongitude === null) {
    return {
      ok: false,
      status: 400,
      message: "Valid location coordinates are required for attendance."
    };
  }

  if (!allowedRadiusEnabled) {
    return {
      ok: true,
      distanceMeters: null,
      allowedRadiusMeters: null,
      allowedRadiusEnabled: false
    };
  }

  if (officeLatitude === null || officeLongitude === null) {
    return {
      ok: false,
      status: 400,
      message: "Company office location is not configured. Please add latitude and longitude in company settings."
    };
  }

  const distanceMeters = calculateDistanceMeters(officeLatitude, officeLongitude, userLatitude, userLongitude);

  if (distanceMeters > allowedRadiusMeters) {
    return {
      ok: false,
      status: 403,
      distanceMeters,
      allowedRadiusMeters,
      message: `You are outside the allowed office area. ${actionLabel} is allowed within ${Math.round(allowedRadiusMeters)} meters. Your distance is ${Math.round(distanceMeters)} meters.`
    };
  }

  return {
    ok: true,
    distanceMeters,
    allowedRadiusMeters
  };
};

const getAttendanceSettingsContext = async ({ companyCode, userId }) => {
  const [company, userObj] = await Promise.all([
    Company.findOne({ companyCode }),
    User.findById(userId),
  ]);
  const branchId = userObj?.branch || userObj?.branchId;
  const branch = branchId
    ? await Branch.findById(branchId).select("dashboardConfig officeLocation")
    : null;

  return {
    company,
    userObj,
    attendanceSettings: branch || company,
  };
};

const resolveSelectedShiftSettings = async (userObj) => {
  if (!userObj?.jobRole) return null;

  let jobRoleDoc = null;
  const jobRoleValue = String(userObj.jobRole);
  const companyScope = userObj.company
    ? { company: userObj.company }
    : (userObj.companyCode ? { companyCode: userObj.companyCode } : {});

  if (mongoose.Types.ObjectId.isValid(jobRoleValue)) {
    jobRoleDoc = await JobRole.findOne({
      _id: jobRoleValue,
      ...companyScope,
      isActive: true
    });
  }

  if (!jobRoleDoc) {
    jobRoleDoc = await JobRole.findOne({
      name: { $regex: new RegExp(`^${jobRoleValue}$`, 'i') },
      ...companyScope,
      isActive: true
    });
  }

  if (!jobRoleDoc) return null;

  const shifts = Array.isArray(jobRoleDoc.shifts) && jobRoleDoc.shifts.length > 0
    ? jobRoleDoc.shifts
    : (jobRoleDoc.shiftSettings ? [jobRoleDoc.shiftSettings] : []);

  return shifts.find(shift => String(shift.shiftId || shift._id || shift.id) === String(userObj.shiftId))
    || jobRoleDoc.shiftSettings
    || shifts[0]
    || null;
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
    
    const user = await User.findById(userId).select('companyCode').lean();
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

    // 1. Fetch branch-scoped settings to read attendance mode
    const { attendanceSettings, userObj } = await getAttendanceSettingsContext({ companyCode: userCompanyCode, userId });
    const clockInConfig = attendanceSettings?.dashboardConfig?.find(c => c.componentId === 'clock-in');
    const attendanceMode = clockInConfig?.settings?.attendanceMode || 'normal';

    const { latitude, longitude, accuracy, selfieUrl } = req.body;

    // 2. Validate Geolocation/Selfie based on company requirements
    let locationRange = null;
    const shouldEnforceLocation =
      (attendanceMode === 'location' || attendanceMode === 'both') &&
      !isWorkFromHomeEmployee(userObj) &&
      !isWorkFromHomeEmployee(req.user) &&
      !isWorkFromHomeEmployee(req.body);
    if (shouldEnforceLocation) {
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          message: "Location coordinates (latitude and longitude) are required for attendance."
        });
      }

      locationRange = validateCompanyLocationRange({
        company: attendanceSettings,
        latitude,
        longitude,
        actionLabel: "Clock-in"
      });

      if (!locationRange.ok) {
        return res.status(locationRange.status).json({
          message: locationRange.message,
          distanceMeters: locationRange.distanceMeters ? Math.round(locationRange.distanceMeters) : undefined,
          allowedRadiusMeters: locationRange.allowedRadiusMeters
        });
      }
    }

    if (attendanceMode === 'image' || attendanceMode === 'both') {
      if (!selfieUrl) {
        return res.status(400).json({
          message: "Selfie/Live image upload is required for attendance."
        });
      }
    }
    
    const now = new Date();
    // 3. Fetch selected JobRole shift timing configuration
    const shiftSettings = await resolveSelectedShiftSettings(userObj);

    const schedule = buildShiftSchedule(now, shiftSettings);
    const shiftSnapshot = buildShiftSnapshot(shiftSettings, schedule);

    // 4. Validate Early Clock-In
    if (now < schedule.earlyClockInStart) {
      return res.status(400).json({
        message: `You cannot clock in too early. Clock-in for ${shiftSnapshot.shiftName} is allowed from ${schedule.earlyClockInStartStr}.`
      });
    }

    if (now > schedule.shiftEnd) {
      return res.status(400).json({
        message: `Your ${shiftSnapshot.shiftName} window is over. Clock-in was allowed between ${schedule.earlyClockInStartStr} and ${schedule.shiftEndStr}.`
      });
    }

    const existingRecord = await Attendance.findOne({
      user: userId,
      date: { $gte: schedule.dateStart, $lte: schedule.dateEnd }
    });

    const isAbsentPlaceholder = existingRecord
      && !existingRecord.inTime
      && !existingRecord.outTime
      && !existingRecord.isClockedIn;

    if (existingRecord && !isAbsentPlaceholder) {
      return res.status(400).json({
        message: "✅ You've already logged your attendance for this shift."
      });
    }

    // The shift has a grace window: do not record/display lateness until the
    // configured grace threshold has actually passed.
    const lateBy = now > schedule.lateGraceLimit ? formatDuration(now - schedule.shiftStart) : "00:00:00";

    // 5. Determine dynamic status
    let status = "PRESENT";
    if (now >= schedule.halfDayLateLimit) {
      status = "HALF DAY";
    } else if (now > schedule.lateGraceLimit && now < schedule.halfDayLateLimit) {
      status = "LATE";
    }

    const attendanceRecord = existingRecord || new Attendance({ user: userId });
    attendanceRecord.date = schedule.dateStart;
    attendanceRecord.inTime = now;
    attendanceRecord.outTime = null;
    attendanceRecord.lateBy = lateBy;
    attendanceRecord.status = status;
    attendanceRecord.isClockedIn = true;
    attendanceRecord.totalTime = "00:00:00";
    attendanceRecord.overTime = "00:00:00";
    attendanceRecord.earlyLeave = "00:00:00";
    attendanceRecord.companyCode = userCompanyCode;
    applyShiftSnapshot(attendanceRecord, shiftSnapshot);

    // Save Location & Selfie
    if (latitude !== undefined && longitude !== undefined) {
      attendanceRecord.inLocation = buildLocationPayload({
        latitude,
        longitude,
        accuracy,
        distanceFromOfficeMeters: locationRange?.distanceMeters
      });
    }
    if (selfieUrl) {
      attendanceRecord.inSelfieUrl = selfieUrl;
    }

    if (isAbsentPlaceholder) {
      attendanceRecord.notes = "Clocked in after the automatic absent mark";
    }

    await attendanceRecord.save();

    const populatedRecord = await Attendance.findById(attendanceRecord._id)
      .populate({
        path: "user",
        select: "name email employeeType companyCode jobRole shiftId shiftName shiftType department",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      });

    notifyEmployeeAttendancePage({
      req,
      userId,
      type: 'attendance_clock_in',
      title: 'Employee Clock In',
      message: `${req.user.name || 'An employee'} clocked in at ${formatTime(now)}`,
      attendanceId: attendanceRecord._id,
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
    
    // 1. Fetch branch-scoped settings to read attendance mode requirements
    const { attendanceSettings, userObj } = await getAttendanceSettingsContext({ companyCode: userCompanyCode, userId });
    const clockInConfig = attendanceSettings?.dashboardConfig?.find(c => c.componentId === 'clock-in');
    const attendanceMode = clockInConfig?.settings?.attendanceMode || 'normal';

    const { latitude, longitude, accuracy, selfieUrl } = req.body;

    // 2. Validate Geolocation/Selfie based on company requirements
    let locationRange = null;
    const shouldEnforceLocation =
      (attendanceMode === 'location' || attendanceMode === 'both') &&
      !isWorkFromHomeEmployee(userObj) &&
      !isWorkFromHomeEmployee(req.user) &&
      !isWorkFromHomeEmployee(req.body);
    if (shouldEnforceLocation) {
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({
          message: "Location coordinates (latitude and longitude) are required to clock out."
        });
      }

      locationRange = validateCompanyLocationRange({
        company: attendanceSettings,
        latitude,
        longitude,
        actionLabel: "Clock-out"
      });

      if (!locationRange.ok) {
        return res.status(locationRange.status).json({
          message: locationRange.message,
          distanceMeters: locationRange.distanceMeters ? Math.round(locationRange.distanceMeters) : undefined,
          allowedRadiusMeters: locationRange.allowedRadiusMeters
        });
      }
    }

    if (attendanceMode === 'image' || attendanceMode === 'both') {
      if (!selfieUrl) {
        return res.status(400).json({
          message: "Selfie/Live image upload is required to clock out."
        });
      }
    }

    const now = new Date();
    const {start: todayStart, end: todayEnd} = getIndiaDayRange(now);

    let record = await Attendance.findOne({
      user: userId,
      date: { $gte: todayStart, $lte: todayEnd },
      isClockedIn: true
    });

    if (!record) {
      record = await Attendance.findOne({
        user: userId,
        isClockedIn: true,
        inTime: { $gte: addIndiaDays(todayStart, -1), $lte: now }
      }).sort({ inTime: -1 });
    }

    if (!record || record.outTime) {
      return res.status(400).json({ 
        message: "Not clocked in or already clocked out" 
      });
    }

    // 3. Fetch selected JobRole shift settings
    const shiftSettings = record.shiftStart && record.shiftEnd
      ? getRecordShiftSettings(record)
      : await resolveSelectedShiftSettings(userObj);
    const schedule = buildShiftSchedule(record.inTime || now, shiftSettings);
    const shiftSnapshot = buildShiftSnapshot(shiftSettings, schedule);

    if (now > addIndiaDays(schedule.shiftEnd, 1)) {
      return res.status(400).json({
        message: `Clock-out for ${shiftSnapshot.shiftName} is no longer available. Please contact HR to update this attendance.`
      });
    }

    const totalMs = now - new Date(record.inTime);

    record.outTime = now;
    record.clockOutMode = 'MANUAL';
    record.isClockedIn = false;
    record.totalTime = formatDuration(totalMs);
    record.overTime = now > schedule.shiftEnd ? formatDuration(now - schedule.shiftEnd) : "00:00:00";
    record.earlyLeave = now < schedule.shiftEnd ? formatDuration(schedule.shiftEnd - now) : "00:00:00";
    applyShiftSnapshot(record, shiftSnapshot);
    Object.assign(record, calculateAttendanceByShift({
      inTime: new Date(record.inTime),
      outTime: now,
      shiftSettings,
      currentStatus: record.status
    }));

    // Save Location & Selfie
    if (latitude !== undefined && longitude !== undefined) {
      record.outLocation = buildLocationPayload({
        latitude,
        longitude,
        accuracy,
        distanceFromOfficeMeters: locationRange?.distanceMeters
      });
    }
    if (selfieUrl) {
      record.outSelfieUrl = selfieUrl;
    }

    if (!record.companyCode && userCompanyCode) {
      record.companyCode = userCompanyCode;
    }

    await record.save();

    const populatedRecord = await Attendance.findById(record._id)
      .populate({
        path: "user",
        select: "name email employeeType companyCode jobRole shiftId shiftName shiftType department",
        populate: {
          path: "company",
          select: "companyCode companyName"
        }
      });

    notifyEmployeeAttendancePage({
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
    await refreshAutoClockOuts();

    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    const now = new Date();
    const {start: todayStart, end: todayEnd} = getIndiaDayRange(now);

    let today = await Attendance.findOne({ 
      user: userId, 
      date: { $gte: todayStart, $lte: todayEnd } 
    });

    if (!today) {
      today = await Attendance.findOne({
        user: userId,
        isClockedIn: true,
        inTime: { $gte: addIndiaDays(todayStart, -1), $lte: now }
      }).sort({ inTime: -1 });
    }

    if (!today) {
      const { userObj } = await getAttendanceSettingsContext({ companyCode: userCompanyCode, userId });
      const shiftSettings = await resolveSelectedShiftSettings(userObj);
      const schedule = buildShiftSchedule(now, shiftSettings);
      
      if (now > schedule.shiftEnd) {
        return res.status(200).json({
          isClockedIn: false,
          status: "ABSENT",
          shiftId: shiftSettings?.shiftId,
          shiftName: shiftSettings?.shiftName,
          shiftStart: schedule.shiftStartStr,
          shiftEnd: schedule.shiftEndStr,
          message: "No attendance recorded for your shift"
        });
      }
      
      return res.status(200).json({ 
        isClockedIn: false,
        shiftId: shiftSettings?.shiftId,
        shiftName: shiftSettings?.shiftName,
        shiftStart: schedule.shiftStartStr,
        shiftEnd: schedule.shiftEndStr,
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
    await refreshAutoClockOuts();

    const userId = req.user._id || req.user.id;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    const { month, year } = req.query;
    
    
    const targetUserId = req.params.userId || userId;
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "User company code not found" 
      });
    }
    
    
    const targetUser = await User.findById(targetUserId)
      .select('name email employeeType companyCode company jobRole shiftId shiftName shiftType createdAt');
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
      const todayEnd = getIndiaDayEnd(new Date());
      
      startDate = indiaDateTimeToUtc(queryYear, queryMonth, 1);
      endDate = indiaDateTimeToUtc(queryYear, queryMonth + 1, 0, 23, 59, 59, 999);
      if (endDate > todayEnd) {
        endDate = todayEnd;
      }
      
      query.date = { $gte: startDate, $lte: endDate };
    }

    
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      allDates.push(new Date(currentDate));
      currentDate = addIndiaDays(currentDate, 1);
    }

    void 0;

    
    const targetShiftSettings = await resolveSelectedShiftSettings(targetUser);

    const list = await Attendance.find(query)
      .populate({
        path: "user",
        select: "name email employeeType companyCode jobRole shiftId shiftName shiftType department",
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
        const recordObject = record.toObject ? record.toObject() : record;
        const fallbackSchedule = buildShiftSchedule(record.date, targetShiftSettings);
        const fallbackShift = buildShiftSnapshot(targetShiftSettings || {}, fallbackSchedule);
        return {
          ...recordObject,
          shiftId: recordObject.shiftId || fallbackShift.shiftId,
          shiftName: recordObject.shiftName || fallbackShift.shiftName,
          shiftType: recordObject.shiftType || fallbackShift.shiftType,
          shiftStart: recordObject.shiftStart || fallbackShift.shiftStart,
          shiftEnd: recordObject.shiftEnd || fallbackShift.shiftEnd,
          earlyClockInStart: recordObject.earlyClockInStart || fallbackShift.earlyClockInStart,
          lateGraceLimit: recordObject.lateGraceLimit || fallbackShift.lateGraceLimit,
          halfDayLateLimit: recordObject.halfDayLateLimit || fallbackShift.halfDayLateLimit,
          shortLeaveEarlyLimit: recordObject.shortLeaveEarlyLimit || fallbackShift.shortLeaveEarlyLimit,
          halfDayEarlyLimit: recordObject.halfDayEarlyLimit || fallbackShift.halfDayEarlyLimit,
          shiftWindow: recordObject.shiftWindow || fallbackShift.shiftWindow,
          login: formatTime(record.inTime),
          logout: formatTime(record.outTime),
          status: record.status || 'ABSENT'
        };
      } else {
        
        const dayOfWeek = new Date(date.getTime() + INDIA_OFFSET_MS).getUTCDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const fallbackSchedule = buildShiftSchedule(date, targetShiftSettings);
        const fallbackShift = buildShiftSnapshot(targetShiftSettings || {}, fallbackSchedule);

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
          shiftId: fallbackShift.shiftId,
          shiftName: fallbackShift.shiftName,
          shiftType: fallbackShift.shiftType,
          shiftStart: fallbackShift.shiftStart,
          shiftEnd: fallbackShift.shiftEnd,
          earlyClockInStart: fallbackShift.earlyClockInStart,
          lateGraceLimit: fallbackShift.lateGraceLimit,
          halfDayLateLimit: fallbackShift.halfDayLateLimit,
          shortLeaveEarlyLimit: fallbackShift.shortLeaveEarlyLimit,
          halfDayEarlyLimit: fallbackShift.halfDayEarlyLimit,
          shiftWindow: fallbackShift.shiftWindow,
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
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 31, maxLimit: 1000 });
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    let filter = { companyCode: userCompanyCode };
    const branchUserIds = await getBranchScopedUserIds(req, userCompanyCode);
    if (branchUserIds) {
      if (branchUserIds.length === 0) {
        return res.status(200).json({
          message: "All attendance records fetched successfully",
          data: [],
          count: 0,
          total: 0,
          pagination: buildPaginationMeta({ page, limit, total: 0 })
        });
      }
      filter.user = { $in: branchUserIds };
    }
    
    
    if (userId && isValidObjectId(userId)) {
      if (filter.user?.$in) {
        filter.user = filter.user.$in.some(id => String(id) === String(userId)) ? userId : null;
      } else {
        filter.user = userId;
      }
    }

    if (date) {
      const {start, end} = getIndiaDayRange(parseIndiaDateOnly(date));
      filter.date = { $gte: start, $lte: end };
    }

    const [records, total] = await Promise.all([
      Attendance.find(filter)
        .populate({
          path: "user",
          select: "name email employeeType companyCode jobRole shiftId shiftName shiftType department",
          populate: {
            path: "company",
            select: "companyCode companyName"
          }
        })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(filter)
    ]);

    res.status(200).json({ 
      message: "All attendance records fetched successfully",
      data: records.map(record => ({
        ...record,
        status: record.status || 'ABSENT'
      })),
      count: records.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total })
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
    
    
    
    if (updateData.inTime !== undefined) {
      record.inTime = updateData.inTime ? new Date(updateData.inTime) : null;
    }
    
    if (updateData.outTime) {
      record.outTime = new Date(updateData.outTime);
      record.clockOutMode = normalizeClockOutMode(updateData.clockOutMode || 'MANUAL');
      record.isClockedIn = false;
    }
    
    if ((updateData.inTime || updateData.outTime) && !updateData.status) {
      const attendanceUser = await User.findById(record.user).select('company jobRole shiftId shiftName shiftType');
      const shiftSettings = record.shiftStart && record.shiftEnd
        ? getRecordShiftSettings(record)
        : await resolveSelectedShiftSettings(attendanceUser);
      const schedule = buildShiftSchedule(record.inTime || record.date, shiftSettings);
      applyShiftSnapshot(record, buildShiftSnapshot(shiftSettings || {}, schedule));
      const recalculated = calculateAttendanceByShift({
        inTime: record.inTime,
        outTime: record.outTime,
        shiftSettings,
        currentStatus: record.status
      });
      Object.assign(record, recalculated);
    }

    if (!record.outTime) {
      record.clockOutMode = null;
    } else if (!record.clockOutMode) {
      record.clockOutMode = 'MANUAL';
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
        select: "name email employeeType companyCode jobRole shiftId shiftName shiftType department",
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
    const { user, date, inTime, outTime, status, lateBy, earlyLeave, overTime, notes, clockOutMode } = req.body;
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

    const shiftSettings = await resolveSelectedShiftSettings(userExists);
    const scheduleReference = inTime ? new Date(inTime) : parseIndiaDateOnly(date);
    const schedule = buildShiftSchedule(scheduleReference, shiftSettings);
    const shiftSnapshot = buildShiftSnapshot(shiftSettings || {}, schedule);
    const calculated = calculateAttendanceByShift({
      inTime: inTime ? new Date(inTime) : null,
      outTime: outTime ? new Date(outTime) : null,
      shiftSettings,
      currentStatus: status ? status.toUpperCase() : "ABSENT"
    });
    
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
      existingAttendance.isClockedIn = outTime ? false : existingAttendance.isClockedIn;
      existingAttendance.clockOutMode = outTime
        ? normalizeClockOutMode(clockOutMode || existingAttendance.clockOutMode || 'MANUAL')
        : existingAttendance.clockOutMode;
      existingAttendance.lateBy = lateBy || existingAttendance.lateBy;
      existingAttendance.earlyLeave = earlyLeave || existingAttendance.earlyLeave;
      existingAttendance.overTime = overTime || existingAttendance.overTime;
      existingAttendance.notes = notes || existingAttendance.notes;
      existingAttendance.companyCode = userCompanyCode;
      applyShiftSnapshot(existingAttendance, shiftSnapshot);

      if (!status) {
        existingAttendance.status = calculated.status;
        existingAttendance.lateBy = lateBy || calculated.lateBy;
        existingAttendance.earlyLeave = earlyLeave || calculated.earlyLeave;
        existingAttendance.overTime = overTime || calculated.overTime;
        existingAttendance.totalTime = calculated.totalTime;
      }

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
      clockOutMode: outTime ? normalizeClockOutMode(clockOutMode || 'MANUAL') : null,
      status: status ? status.toUpperCase() : calculated.status,
      lateBy: lateBy || calculated.lateBy,
      earlyLeave: earlyLeave || calculated.earlyLeave,
      overTime: overTime || calculated.overTime,
      totalTime: calculated.totalTime,
      notes: notes || "",
      isClockedIn: !outTime,
      companyCode: userCompanyCode
    });
    applyShiftSnapshot(attendance, shiftSnapshot);
    
    await attendance.save();
    
    const populatedAttendance = await Attendance.findById(attendance._id)
      .populate({
        path: "user",
        select: "name email employeeType companyCode jobRole shiftId shiftName shiftType department",
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
    const { date, month, year } = req.query;
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
    
    if (month !== undefined || year !== undefined) {
      const queryMonth = Number(month);
      const queryYear = Number(year);
      if (!Number.isInteger(queryMonth) || queryMonth < 0 || queryMonth > 11 ||
          !Number.isInteger(queryYear) || queryYear < 2000 || queryYear > 2100) {
        return res.status(400).json({ message: "Month must be 0-11 and year must be valid" });
      }
      query.date = {
        $gte: indiaDateTimeToUtc(queryYear, queryMonth, 1),
        $lte: indiaDateTimeToUtc(queryYear, queryMonth + 1, 0, 23, 59, 59, 999)
      };
    } else if (date) {
      const {start, end} = getIndiaDayRange(parseIndiaDateOnly(date));
      query.date = { $gte: start, $lte: end };
    }
    
    const records = await Attendance.find(query)
      .select('date status inTime outTime totalTime lateBy earlyLeave overTime notes')
      .sort({ date: -1 })
      .lean();

    let responseRecords = records;
    if (month !== undefined && year !== undefined) {
      const queryMonth = Number(month);
      const queryYear = Number(year);
      const recordsByDate = new Map(records.map(record => [formatIndiaDateKey(record.date), record]));
      const daysInMonth = new Date(queryYear, queryMonth + 1, 0).getDate();
      const todayKey = formatIndiaDateKey(new Date());

      responseRecords = Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const date = indiaDateTimeToUtc(queryYear, queryMonth, day);
        const dateKey = formatIndiaDateKey(date);
        const savedRecord = recordsByDate.get(dateKey);
        if (savedRecord) return savedRecord;

        const weekDay = new Date(queryYear, queryMonth, day).getDay();
        return {
          _id: `calendar-${dateKey}`,
          date,
          status: dateKey > todayKey ? 'UPCOMING' : (weekDay === 0 ? 'WEEKEND' : 'NO RECORD'),
          isGenerated: true
        };
      });
    }
    
    res.status(200).json({ 
      message: "Attendance records fetched successfully", 
      data: responseRecords.map(record => ({
        ...record,
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
          const shiftSettings = await resolveSelectedShiftSettings(user);
          const schedule = buildShiftSchedule(now, shiftSettings);
          const absentThreshold = schedule.shiftEnd;
          
          if (now >= absentThreshold) {
            const absentRecord = new Attendance({
              user: user._id,
              date: schedule.dateStart,
              status: "ABSENT",
              isClockedIn: false,
              companyCode: company.companyCode
            });
            applyShiftSnapshot(absentRecord, buildShiftSnapshot(shiftSettings || {}, schedule));
            
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
    const branchUserIds = await getBranchScopedUserIds(req, userCompanyCode);
    if (branchUserIds) {
      if (branchUserIds.length === 0) {
        return res.status(200).json({
          message: "Attendance statistics fetched successfully",
          data: { total: 0, present: 0, late: 0, halfDay: 0, absent: 0 }
        });
      }
      matchStage.user = { $in: branchUserIds };
    }
    
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
