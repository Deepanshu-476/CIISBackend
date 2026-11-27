const Attendance = require('../models/Attendance');
const { getIndiaDayRange } = require('./taskRecurrence');

const PRESENT_STATUSES = ['PRESENT', 'LATE', 'HALF DAY', 'HALFDAY', 'SHORT LEAVE'];
const ATTENDANCE_REQUIRED = 'Mark your attendance or clock in before changing a task status.';

const isPresentAttendance = record => PRESENT_STATUSES.includes(String(record?.status || '').trim().toUpperCase());

const presentOnDayFilter = (date, now = new Date()) => {
  const range = getIndiaDayRange(date);
  if (!range) return { status: { $in: PRESENT_STATUSES }, _id: null };
  const { start, end } = range;
  const cutoff = end < now ? end : now;
  const todayRange = getIndiaDayRange(now);
  const orClauses = [
    { date: { $gte: start, $lte: end } },
    { inTime: { $gte: start, $lte: cutoff } }
  ];
  if (todayRange && start.getTime() === todayRange.start.getTime()) {
    orClauses.push({
      isClockedIn: true,
      outTime: null,
      inTime: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), $lt: start }
    });
  }
  return {
    status: { $in: PRESENT_STATUSES },
    $or: orClauses
  };
};

const hasTaskAttendance = async (user, now = new Date()) => {
  const userId = user?._id || user?.id;
  if (!userId || !getIndiaDayRange(now)) return false;
  return Boolean(await Attendance.exists({
    ...presentOnDayFilter(now, now),
    user: userId,
  }));
};

const ensureTaskStatusAttendance = async (req, res) => {
  if (await hasTaskAttendance(req.user)) return true;
  res.status(403).json({ success: false, code: 'TASK_ATTENDANCE_REQUIRED', error: ATTENDANCE_REQUIRED, message: ATTENDANCE_REQUIRED });
  return false;
};

module.exports = { ATTENDANCE_REQUIRED, isPresentAttendance, presentOnDayFilter, hasTaskAttendance, ensureTaskStatusAttendance };
