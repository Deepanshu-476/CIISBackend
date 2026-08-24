const mongoose = require('mongoose');
const JobRole = require('../../models/JobRole');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getShiftTime = (shiftSettings, key, fallback) => {
  const value = shiftSettings?.[key];
  return typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())
    ? value.trim()
    : fallback;
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

const getIndiaDateParts = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const shifted = new Date(date.getTime() + INDIA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
};

const indiaDateTimeToUtc = (year, monthIndex, day, hour = 0, minute = 0, second = 0, millisecond = 0) => (
  new Date(Date.UTC(year, monthIndex, day, hour, minute, second, millisecond) - INDIA_OFFSET_MS)
);

const buildShiftSchedule = (referenceDate, shiftSettings = {}) => {
  const shiftStartStr = getShiftTime(shiftSettings, 'shiftStart', null);
  const shiftEndStr = getShiftTime(shiftSettings, 'shiftEnd', null);
  if (!shiftStartStr || !shiftEndStr) return null;

  const earlyClockInStartStr = getShiftTime(shiftSettings, 'earlyClockInStart', shiftStartStr);
  const lateGraceLimitStr = getShiftTime(shiftSettings, 'lateGraceLimit', shiftStartStr);
  const halfDayLateLimitStr = formatMinutesAsTime(parseTimeToMinutes(shiftStartStr) + 120);
  const shortLeaveEarlyLimitStr = getShiftTime(shiftSettings, 'shortLeaveEarlyLimit', shiftEndStr);
  const halfDayEarlyLimitStr = getShiftTime(shiftSettings, 'halfDayEarlyLimit', shortLeaveEarlyLimitStr);

  const startMinutes = parseTimeToMinutes(shiftStartStr);
  const endMinutes = parseTimeToMinutes(shiftEndStr);
  const isOvernight = endMinutes <= startMinutes;
  const baseDate = getIndiaDateParts(referenceDate);
  if (!baseDate) return null;

  const atMinutes = minutes => indiaDateTimeToUtc(
    baseDate.year,
    baseDate.monthIndex,
    baseDate.day,
    Math.floor(minutes / 60),
    minutes % 60
  );

  const addDayIfBeforeStart = date => date < atMinutes(startMinutes) ? indiaDateTimeToUtc(
    baseDate.year,
    baseDate.monthIndex,
    baseDate.day + 1,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  ) : date;

  let shiftStart = atMinutes(startMinutes);
  let shiftEnd = atMinutes(endMinutes);
  if (isOvernight) {
    shiftEnd = indiaDateTimeToUtc(
      baseDate.year,
      baseDate.monthIndex,
      baseDate.day + 1,
      Math.floor(endMinutes / 60),
      endMinutes % 60
    );
  }

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

const resolveShiftScheduleForUser = async (userObj, referenceDate = new Date()) => {
  const shiftSettings = await resolveSelectedShiftSettings(userObj);
  if (!shiftSettings) return null;
  const schedule = buildShiftSchedule(referenceDate, shiftSettings);
  return schedule ? { shiftSettings, schedule } : null;
};

const applyShiftTimesToDate = (referenceDate, shiftSettings = {}) => {
  const schedule = buildShiftSchedule(referenceDate, shiftSettings);
  if (!schedule) return null;
  return {
    startDateTime: schedule.shiftStart,
    dueDateTime: schedule.shiftEnd,
    shiftStartStr: schedule.shiftStartStr,
    shiftEndStr: schedule.shiftEndStr,
  };
};

module.exports = {
  INDIA_OFFSET_MS,
  getShiftTime,
  parseTimeToMinutes,
  formatMinutesAsTime,
  getIndiaDateParts,
  buildShiftSchedule,
  resolveSelectedShiftSettings,
  resolveShiftScheduleForUser,
  applyShiftTimesToDate,
};
