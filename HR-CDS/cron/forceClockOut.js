const schedule = require('node-schedule');
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const User = require('../../models/User');
const JobRole = require('../../models/JobRole');
const { notifyDirectUsers } = require('../utils/systemNotificationService');

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
  const { year, monthIndex, day } = getIndiaDateParts(value);
  return indiaDateTimeToUtc(year, monthIndex, day);
};

const getIndiaDayEnd = (value = new Date()) => {
  const { year, monthIndex, day } = getIndiaDateParts(value);
  return indiaDateTimeToUtc(year, monthIndex, day, 23, 59, 59, 999);
};

const getIndiaMinutesSinceMidnight = value => {
  const { hour, minute } = getIndiaDateParts(value);
  return (hour * 60) + minute;
};

const parseTimeToMinutes = (value, fallback = '00:00') => {
  const [rawHour, rawMinute] = String(value || fallback).split(':');
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return parseTimeToMinutes(fallback, '00:00');
  }
  return ((hour % 24) * 60) + Math.max(0, Math.min(59, minute));
};

const getShiftTime = (shiftSettings, key, fallback) => {
  const value = shiftSettings?.[key];
  return typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())
    ? value.trim()
    : fallback;
};

const formatMinutesAsTime = minutes => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

const addIndiaDays = (value, days) => new Date(value.getTime() + (days * DAY_MS));

const addMinutes = (date, minutes) => new Date(date.getTime() + (minutes * 60 * 1000));

const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const formatTime = (date) => {
  const validDate = toValidDate(date);
  return validDate
    ? validDate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: ATTENDANCE_TIME_ZONE,
    })
    : '';
};

const buildShiftSchedule = (referenceDate, shiftSettings = {}) => {
  const shiftStartStr = getShiftTime(shiftSettings, 'shiftStart', '09:00');
  const shiftEndStr = getShiftTime(shiftSettings, 'shiftEnd', '19:00');
  const earlyClockInStartStr = getShiftTime(shiftSettings, 'earlyClockInStart', shiftStartStr);
  const lateGraceLimitStr = getShiftTime(shiftSettings, 'lateGraceLimit', shiftStartStr);
  const halfDayLateLimitStr = formatMinutesAsTime(parseTimeToMinutes(shiftStartStr) + 120);
  const shortLeaveEarlyLimitStr = getShiftTime(shiftSettings, 'shortLeaveEarlyLimit', shiftEndStr);
  const halfDayEarlyLimitStr = getShiftTime(shiftSettings, 'halfDayEarlyLimit', shortLeaveEarlyLimitStr);

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
    shiftId: String(source.shiftId || source.id || source._id || ''),
    shiftName: source.shiftName || source.name || 'General Shift',
    shiftType: source.shiftType || 'general',
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
  shiftStart: record.shiftStart || '09:00',
  shiftEnd: record.shiftEnd || '19:00',
  earlyClockInStart: record.earlyClockInStart || record.shiftStart || '09:00',
  lateGraceLimit: record.lateGraceLimit || record.shiftStart || '09:00',
  halfDayLateLimit: record.halfDayLateLimit || record.shiftStart || '09:00',
  shortLeaveEarlyLimit: record.shortLeaveEarlyLimit || record.shiftEnd || '19:00',
  halfDayEarlyLimit: record.halfDayEarlyLimit || record.shiftEnd || '19:00'
});

const calculateAttendanceByShift = ({ inTime, outTime, shiftSettings, currentStatus }) => {
  if (!inTime) {
    return {
      status: currentStatus || 'ABSENT',
      lateBy: '00:00:00',
      earlyLeave: '00:00:00',
      overTime: '00:00:00',
      totalTime: '00:00:00'
    };
  }

  const schedule = buildShiftSchedule(inTime, shiftSettings);
  const lateBy = inTime > schedule.lateGraceLimit ? formatDuration(inTime - schedule.shiftStart) : '00:00:00';
  let status = 'PRESENT';

  if (inTime >= schedule.halfDayLateLimit) {
    status = 'HALF DAY';
  } else if (inTime > schedule.lateGraceLimit && inTime < schedule.halfDayLateLimit) {
    status = 'LATE';
  }

  if (!outTime) {
    return {
      status,
      lateBy,
      earlyLeave: '00:00:00',
      overTime: '00:00:00',
      totalTime: '00:00:00'
    };
  }

  const totalMs = outTime - inTime;
  let finalStatus = status;

  // Keep LATE determined from clock-in from being overwritten when the
  // auto-clock-out sweep recalculates the record.
  if (finalStatus === 'PRESENT') {
    if (outTime < schedule.halfDayEarlyLimit) {
      finalStatus = 'HALF DAY';
    } else if (outTime < schedule.shortLeaveEarlyLimit) {
      finalStatus = 'SHORT LEAVE';
    }
  }

  return {
    status: finalStatus,
    lateBy,
    earlyLeave: outTime < schedule.shiftEnd ? formatDuration(schedule.shiftEnd - outTime) : '00:00:00',
    overTime: outTime > schedule.shiftEnd ? formatDuration(outTime - schedule.shiftEnd) : '00:00:00',
    totalTime: formatDuration(Math.max(totalMs, 0))
  };
};

const resolveSelectedShiftSettings = async (userObj) => {
  const companyId = userObj?.company?._id || userObj?.company || userObj?.companyId || null;
  if (!userObj?.jobRole || !companyId) return null;

  let jobRoleDoc = null;
  const jobRoleValue = String(userObj.jobRole);

  if (mongoose.Types.ObjectId.isValid(jobRoleValue)) {
    jobRoleDoc = await JobRole.findOne({
      _id: jobRoleValue,
      company: companyId,
      isActive: true
    });
  }

  if (!jobRoleDoc) {
    jobRoleDoc = await JobRole.findOne({
      name: { $regex: new RegExp(`^${jobRoleValue}$`, 'i') },
      company: companyId,
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

const runAutoClockOutSweep = async () => {
  if (mongoose.connection.readyState !== 1) return { processed: 0, updated: 0 };

  const now = new Date();
  const scanFrom = addIndiaDays(getIndiaDayStart(now), -2);

  const records = await Attendance.find({
    isClockedIn: true,
    outTime: null,
    inTime: { $ne: null, $gte: scanFrom }
  }).populate({
    path: 'user',
    select: 'name email company jobRole shiftId shiftName shiftType companyCode',
    populate: {
      path: 'company',
      select: 'companyCode companyName'
    }
  });

  let updated = 0;

  for (const record of records) {
    try {
      const recordUser = record.user;
      if (!recordUser) continue;

      const shiftSettings = record.shiftStart && record.shiftEnd
        ? getRecordShiftSettings(record)
        : await resolveSelectedShiftSettings(recordUser);

      if (!shiftSettings) continue;

      const schedule = buildShiftSchedule(record.inTime || record.date || now, shiftSettings);
      const forcedOutTime = addMinutes(schedule.shiftEnd, 30);
      if (now < forcedOutTime) continue;

      const snapshot = buildShiftSnapshot(shiftSettings, schedule);
      const recalculated = calculateAttendanceByShift({
        inTime: record.inTime,
        outTime: forcedOutTime,
        shiftSettings,
        currentStatus: record.status
      });

      applyShiftSnapshot(record, snapshot);
      record.outTime = forcedOutTime;
      record.clockOutMode = 'AUTO';
      record.isClockedIn = false;
      record.totalTime = recalculated.totalTime;
      record.earlyLeave = recalculated.earlyLeave;
      record.overTime = recalculated.overTime;
      record.status = recalculated.status;
      if (!record.companyCode && recordUser.companyCode) {
        record.companyCode = recordUser.companyCode;
      }

      record.notes = record.notes || 'Auto clocked out after shift end + 30 minutes.';
      await record.save();
      updated++;

      try {
        await notifyDirectUsers({
          userIds: [recordUser._id],
          targetPath: '/ciisUser/emp-attendance',
          type: 'attendance_clock_out',
          title: 'Auto Clock Out',
          message: `${snapshot.shiftName || 'Your shift'} was auto clocked out at ${formatTime(forcedOutTime)} after 30 minutes of shift end.`,
          actor: null,
          data: {
            attendanceId: record._id,
            userId: recordUser._id,
            status: record.status,
            time: forcedOutTime,
            clockOutMode: 'AUTO',
            shiftName: snapshot.shiftName,
            shiftEnd: snapshot.shiftEnd
          },
          priority: 'high'
        });
      } catch (notifyError) {
        console.error('[AutoClockOut] notification failed:', notifyError.message);
      }
    } catch (error) {
      console.error('[AutoClockOut] failed to finalize record:', error.message);
    }
  }

  return { processed: records.length, updated };
};

let autoClockOutJob = null;

const scheduleAutoClockOutJob = () => {
  if (autoClockOutJob) return autoClockOutJob;

  schedule.scheduleJob('*/1 * * * *', async () => {
    try {
      await runAutoClockOutSweep();
    } catch (error) {
      console.error('[AutoClockOut] scheduled run failed:', error.message);
    }
  });

  autoClockOutJob = true;
  return autoClockOutJob;
};

scheduleAutoClockOutJob();

module.exports = {
  runAutoClockOutSweep,
  scheduleAutoClockOutJob
};
