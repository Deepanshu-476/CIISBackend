require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Attendance = require('../HR-CDS/models/Attendance');
const User = require('../models/User');
const JobRole = require('../models/JobRole');

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const dryRun = !applyChanges || args.has('--dry-run');

const userIdArg = process.argv.find(arg => arg.startsWith('--userId='));
const companyCodeArg = process.argv.find(arg => arg.startsWith('--companyCode='));
const targetUserId = userIdArg ? userIdArg.split('=')[1] : '69f81c77c823256b51d22636';
const targetCompanyCode = companyCodeArg ? companyCodeArg.split('=')[1].trim().toUpperCase() : '';

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

const addIndiaDays = (value, days) => new Date(value.getTime() + (days * DAY_MS));

const formatIndiaDateKey = value => {
  const { year, monthIndex, day } = getIndiaDateParts(value);
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

const formatMinutesAsTime = minutes => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

const formatDuration = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const getShiftTime = (shiftSettings, key, fallback) => {
  const value = shiftSettings?.[key];
  return typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())
    ? value.trim()
    : fallback;
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
  const referenceMinutes = (() => {
    const { hour, minute } = getIndiaDateParts(referenceDate);
    return (hour * 60) + minute;
  })();
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

const getRecordScore = (record = {}) => {
  const status = String(record.status || '').trim().toUpperCase();
  let score = 0;

  if (record.inTime) score += 1000;
  if (record.outTime) score += 1000;
  if (record.inTime && record.outTime) score += 500;
  if (!['ABSENT', 'WEEKEND'].includes(status)) score += 100;
  if (String(record.companyCode || '').trim().toUpperCase() !== 'UNKNOWN') score += 50;
  if (record.clockOutMode) score += 20;
  if (String(record.totalTime || '00:00:00') !== '00:00:00') score += 10;

  const updatedAt = new Date(record.updatedAt || record.createdAt || 0);
  if (!Number.isNaN(updatedAt.getTime())) {
    score += Math.min(Math.floor(updatedAt.getTime() / 1000), 1000);
  }

  return score;
};

const pickBestRecord = (records = []) => {
  return records.reduce((best, candidate) => {
    if (!best) return candidate;

    const bestScore = getRecordScore(best);
    const candidateScore = getRecordScore(candidate);
    if (candidateScore !== bestScore) {
      return candidateScore > bestScore ? candidate : best;
    }

    const bestUpdatedAt = new Date(best.updatedAt || best.createdAt || 0).getTime();
    const candidateUpdatedAt = new Date(candidate.updatedAt || candidate.createdAt || 0).getTime();
    if (candidateUpdatedAt !== bestUpdatedAt) {
      return candidateUpdatedAt > bestUpdatedAt ? candidate : best;
    }

    return best;
  }, null);
};

const getUserShiftSettings = async (userDoc) => {
  if (!userDoc) return null;

  const userShift = {
    shiftId: userDoc.shiftId,
    shiftName: userDoc.shiftName,
    shiftType: userDoc.shiftType
  };

  if (userDoc.shiftStart && userDoc.shiftEnd) {
    return {
      ...userShift,
      shiftStart: userDoc.shiftStart,
      shiftEnd: userDoc.shiftEnd,
      earlyClockInStart: userDoc.earlyClockInStart,
      lateGraceLimit: userDoc.lateGraceLimit,
      halfDayLateLimit: userDoc.halfDayLateLimit,
      shortLeaveEarlyLimit: userDoc.shortLeaveEarlyLimit,
      halfDayEarlyLimit: userDoc.halfDayEarlyLimit
    };
  }

  const companyScope = userDoc.company
    ? { company: userDoc.company }
    : (userDoc.companyCode ? { companyCode: userDoc.companyCode } : {});

  let jobRoleDoc = null;
  const jobRoleValue = String(userDoc.jobRole || '');

  if (mongoose.Types.ObjectId.isValid(jobRoleValue)) {
    jobRoleDoc = await JobRole.findOne({
      _id: jobRoleValue,
      ...companyScope,
      isActive: true
    }).lean();
  }

  if (!jobRoleDoc) {
    jobRoleDoc = await JobRole.findOne({
      name: { $regex: new RegExp(`^${jobRoleValue}$`, 'i') },
      ...companyScope,
      isActive: true
    }).lean();
  }

  if (!jobRoleDoc) return null;

  const shifts = Array.isArray(jobRoleDoc.shifts) && jobRoleDoc.shifts.length > 0
    ? jobRoleDoc.shifts
    : (jobRoleDoc.shiftSettings ? [jobRoleDoc.shiftSettings] : []);

  return shifts.find(shift => String(shift.shiftId || shift._id || shift.id) === String(userDoc.shiftId))
    || jobRoleDoc.shiftSettings
    || shifts[0]
    || null;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await connectDB();

  const user = await User.findById(targetUserId).lean();
  if (!user) {
    throw new Error(`User not found: ${targetUserId}`);
  }

  if (targetCompanyCode && String(user.companyCode || '').trim().toUpperCase() !== targetCompanyCode) {
    throw new Error(`User company mismatch. Expected ${targetCompanyCode}, found ${user.companyCode || 'N/A'}`);
  }

  const shiftSettings = await getUserShiftSettings(user);
  const records = await Attendance.find({
    user: user._id,
    $or: [
      { companyCode: user.companyCode },
      { companyCode: 'UNKNOWN' },
      { companyCode: { $exists: false } },
      { companyCode: null },
      { companyCode: '' }
    ]
  }).sort({ date: 1, updatedAt: 1 }).lean();

  const grouped = new Map();
  for (const record of records) {
    const dateKey = formatIndiaDateKey(record.date);
    const bucket = grouped.get(dateKey) || [];
    bucket.push(record);
    grouped.set(dateKey, bucket);
  }

  let inspected = 0;
  let updated = 0;
  let deleted = 0;
  const changes = [];

  for (const [dateKey, bucket] of grouped.entries()) {
    inspected += 1;
    const primary = pickBestRecord(bucket);
    const hasRealAttendance = bucket.some(record => record.inTime || record.outTime);
    const placeholders = bucket.filter(record => String(record._id) !== String(primary._id));

    if (!primary) continue;

    const referenceShift = primary.shiftStart && primary.shiftEnd
      ? {
          shiftId: primary.shiftId,
          shiftName: primary.shiftName,
          shiftType: primary.shiftType,
          shiftStart: primary.shiftStart,
          shiftEnd: primary.shiftEnd,
          earlyClockInStart: primary.earlyClockInStart,
          lateGraceLimit: primary.lateGraceLimit,
          halfDayLateLimit: primary.halfDayLateLimit,
          shortLeaveEarlyLimit: primary.shortLeaveEarlyLimit,
          halfDayEarlyLimit: primary.halfDayEarlyLimit
        }
      : shiftSettings;

    if (primary.inTime || primary.outTime) {
      const recalculated = calculateAttendanceByShift({
        inTime: primary.inTime ? new Date(primary.inTime) : null,
        outTime: primary.outTime ? new Date(primary.outTime) : null,
        shiftSettings: referenceShift,
        currentStatus: primary.status
      });
      const schedule = buildShiftSchedule(primary.inTime || primary.date, referenceShift || {});
      const shiftSnapshot = buildShiftSnapshot(referenceShift || {}, schedule);
      const nextValues = {
        status: recalculated.status,
        lateBy: recalculated.lateBy,
        earlyLeave: recalculated.earlyLeave,
        overTime: recalculated.overTime,
        totalTime: recalculated.totalTime,
        companyCode: user.companyCode || primary.companyCode || 'UNKNOWN',
        ...shiftSnapshot
      };

      const changed =
        String(primary.status || '') !== String(nextValues.status || '') ||
        String(primary.lateBy || '') !== String(nextValues.lateBy || '') ||
        String(primary.earlyLeave || '') !== String(nextValues.earlyLeave || '') ||
        String(primary.overTime || '') !== String(nextValues.overTime || '') ||
        String(primary.totalTime || '') !== String(nextValues.totalTime || '') ||
        String(primary.companyCode || '') !== String(nextValues.companyCode || '') ||
        String(primary.shiftId || '') !== String(nextValues.shiftId || '') ||
        String(primary.shiftStart || '') !== String(nextValues.shiftStart || '') ||
        String(primary.shiftEnd || '') !== String(nextValues.shiftEnd || '');

      if (changed) {
        changes.push({
          type: 'update',
          dateKey,
          id: String(primary._id),
          from: {
            status: primary.status,
            lateBy: primary.lateBy,
            earlyLeave: primary.earlyLeave,
            overTime: primary.overTime,
            totalTime: primary.totalTime,
            companyCode: primary.companyCode
          },
          to: nextValues
        });

        if (applyChanges) {
          await Attendance.updateOne(
            { _id: primary._id },
            { $set: nextValues }
          );
          updated += 1;
        }
      }
    }

    const idsToDelete = [];
    for (const record of placeholders) {
      const status = String(record.status || '').trim().toUpperCase();
      const isPlaceholder = !record.inTime && !record.outTime && ['ABSENT', 'WEEKEND'].includes(status);

      if (hasRealAttendance && isPlaceholder) {
        idsToDelete.push(String(record._id));
        changes.push({
          type: 'delete',
          dateKey,
          id: String(record._id),
          reason: 'duplicate placeholder with real attendance on same India date'
        });
      } else if (!hasRealAttendance) {
        const bucketPrimary = pickBestRecord(bucket);
        if (bucketPrimary && String(bucketPrimary._id) !== String(record._id) && isPlaceholder) {
          idsToDelete.push(String(record._id));
          changes.push({
            type: 'delete',
            dateKey,
            id: String(record._id),
            reason: 'duplicate placeholder on same India date'
          });
        }
      }
    }

    if (applyChanges && idsToDelete.length > 0) {
      const deleteResult = await Attendance.deleteMany({
        _id: { $in: idsToDelete }
      });
      deleted += deleteResult.deletedCount || 0;
    }
  }

  console.log(JSON.stringify({
    mode: dryRun ? 'dry-run' : 'apply',
    userId: String(user._id),
    companyCode: user.companyCode,
    inspectedDays: inspected,
    updated,
    deleted,
    changesPreview: dryRun ? changes.slice(0, 50) : undefined
  }, null, 2));

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('Attendance fix failed:', error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
