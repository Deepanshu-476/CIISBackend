const cron = require('node-cron');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const Group = require('../models/Group');
const { presentOnDayFilter } = require('../utils/taskAttendance');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const {
  buildRecurringTaskClone,
  getNextRecurringDate,
  normalizeTaskRecurrenceFields,
  toValidDate,
  getIndiaDayRange,
} = require('../utils/taskRecurrence');

const DAY_MS = 24 * 60 * 60 * 1000;
const isRecurringTemplate = task => task && task.isActive !== false && !task.recurrenceSourceId;
const userIdOf = value => value?._id || value;
const uniqueIds = values => [...new Map(values.filter(Boolean).map(value => [String(value), value])).values()];

const cleanRecurringTasksForAbsentUserWindow = async (userId, startBound, endBound) => {
  const selfDelete = await Task.deleteMany({
    taskFor: 'self',
    recurrenceSourceId: { $ne: null },
    overallStatus: 'pending',
    $or: [
      { assignedUsers: userId },
      { createdBy: userId }
    ],
    dueDateTime: { $gte: startBound, $lte: endBound }
  });

  const assignedMatches = await Task.find({
    taskFor: { $ne: 'self' },
    recurrenceSourceId: { $ne: null },
    overallStatus: 'pending',
    assignedUsers: userId,
    dueDateTime: { $gte: startBound, $lte: endBound }
  }).select('_id assignedUsers assignedGroups').lean();

  let assignedCleaned = 0;
  for (const item of assignedMatches) {
    const remainingUsers = (item.assignedUsers || []).filter(id => String(id) !== String(userId));
    const hasGroups = Array.isArray(item.assignedGroups) && item.assignedGroups.length > 0;
    if (remainingUsers.length === 0 && !hasGroups) {
      await Task.deleteOne({ _id: item._id });
      assignedCleaned += 1;
    } else {
      await Task.updateOne(
        { _id: item._id },
        {
          $pull: {
            assignedUsers: userId,
            statusByUser: { user: userId }
          }
        }
      );
      assignedCleaned += 1;
    }
  }

  return (selfDelete.deletedCount || 0) + assignedCleaned;
};

const cleanRecurringTasksForAbsentUser = async (userId, targetDate, options = {}) => {
  if (!userId || !targetDate) return 0;
  if (mongoose.connection?.readyState === 0 && !options.mockAbsence) return 0;

  const target = toValidDate(targetDate);
  if (!target) return 0;

  const bounds = getIndiaDayRange(target);
  if (!bounds) return 0;

  try {
    return await cleanRecurringTasksForAbsentUserWindow(userId, bounds.start, bounds.end);
  } catch (err) {
    console.error(`Error cleaning recurring tasks for absent user ${userId}:`, err);
    return 0;
  }
};

const cleanRecurringTasksForAbsentUserRange = async (userId, startDate, endDate, options = {}) => {
  if (!userId || !startDate || !endDate) return 0;
  if (mongoose.connection?.readyState === 0 && !options.mockAbsence) return 0;

  const start = toValidDate(startDate);
  const end = toValidDate(endDate);
  if (!start || !end) return 0;

  const startBounds = getIndiaDayRange(start);
  const endBounds = getIndiaDayRange(end);
  if (!startBounds || !endBounds) return 0;

  try {
    return await cleanRecurringTasksForAbsentUserWindow(userId, startBounds.start, endBounds.end);
  } catch (err) {
    console.error(`Error cleaning recurring tasks for absent user leave range ${userId}:`, err);
    return 0;
  }
};

const createOccurrenceIfMissing = async (template, occurrenceDate, { now = new Date(), userId } = {}) => {
  const day = getIndiaDayRange(now);
  if (occurrenceDate < day.start || occurrenceDate > day.end) return { created: false, skipped: true };

  const isSelfTask = !template.taskFor || template.taskFor === 'self';
  let recipients = isSelfTask
    ? [userIdOf(template.assignedUsers?.[0] || template.createdBy)]
    : (template.assignedUsers || []).map(userIdOf);
  if (!isSelfTask && template.assignedGroups?.length) {
    const groups = await Group.find({
      _id: { $in: template.assignedGroups.map(userIdOf) },
      isActive: true
    }).select('members').lean();
    recipients.push(...groups.flatMap(group => group.members || []).map(userIdOf));
  }
  recipients = uniqueIds(recipients).filter(id => !userId || String(id) === String(userId));
  if (!recipients.length) return { created: false, skipped: true };

  const attendance = await Attendance.find({
    user: { $in: recipients },
    ...presentOnDayFilter(occurrenceDate, now)
  }).select('user').lean();
  const presentUsers = uniqueIds(attendance.map(record => userIdOf(record.user)));
  if (!presentUsers.length) return { created: false, skipped: true };

  const key = { recurrenceSourceId: template._id, recurrenceOccurrenceKey: occurrenceDate.toISOString() };
  const clone = buildRecurringTaskClone(template, occurrenceDate, { assignedUsers: presentUsers });
  if (!clone) return { created: false, skipped: true };

  // Recurring group assignments become individual assignments as members clock in.
  clone.assignedGroups = [];
  try {
    const result = await Task.updateOne(key, { $setOnInsert: clone }, { upsert: true, timestamps: false });
    if (result.upsertedCount) return { created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  if (!isSelfTask) {
    for (const entry of clone.statusByUser) {
      await Task.updateOne(
        { ...key, assignedUsers: { $ne: entry.user }, overallStatus: 'completed' },
        {
          $addToSet: { assignedUsers: entry.user },
          $push: { statusByUser: entry },
          $set: { overallStatus: 'in-progress', completionDate: null }
        }
      );
      await Task.updateOne(
        { ...key, assignedUsers: { $ne: entry.user } },
        {
          $addToSet: { assignedUsers: entry.user },
          $push: { statusByUser: entry }
        }
      );
    }
  }
  return { created: false, exists: true };
};

const generateRecurringOccurrences = async (template, options = {}) => {
  if (!isRecurringTemplate(template)) return { created: 0, skipped: true };
  const { repeatPattern, repeatDays, isRecurring, recurrenceEndDate } = normalizeTaskRecurrenceFields(template);
  const base = toValidDate(template.dueDateTime);
  if (!base || !isRecurring || repeatPattern === 'none') return { created: 0, skipped: true };

  const now = options.now || new Date();
  const today = getIndiaDayRange(now);
  const end = options.targetEndDate || recurrenceEndDate;
  if (end && today.start > end) {
    await Task.updateOne({ _id: template._id }, { $set: {
      nextRecurringDate: null, isRecurring: false, repeatPattern: 'none', recurringPattern: 'none', recurrenceStoppedAt: now
    } });
    return { created: 0, stopped: true };
  }

  // Resolve today's scheduled occurrence from the template. Old ahead-of-time copies
  // and absent days must not advance the series past the day an employee clocks in.
  const baseDay = getIndiaDayRange(base);
  const daysSinceBase = Math.floor((today.start - baseDay.start) / DAY_MS);
  const anchor = repeatPattern === 'daily' && daysSinceBase > 1
    ? new Date(base.getTime() + (daysSinceBase - 1) * DAY_MS)
    : base;
  let occurrence = getNextRecurringDate(anchor, repeatPattern, repeatDays);
  while (occurrence && occurrence < today.start) {
    occurrence = getNextRecurringDate(occurrence, repeatPattern, repeatDays);
  }
  let result = { created: false };
  if (occurrence && occurrence <= today.end && (!end || occurrence <= end)) {
    result = await createOccurrenceIfMissing(template, occurrence, { ...options, now });
    if (result.created || result.exists) occurrence = getNextRecurringDate(occurrence, repeatPattern, repeatDays);
  }
  const next = occurrence && (!end || occurrence <= end) ? occurrence : null;
  if (String(toValidDate(template.nextRecurringDate)) !== String(next)) {
    await Task.updateOne({ _id: template._id, isRecurring: true }, { $set: { nextRecurringDate: next } });
  }
  return { created: Number(result.created), nextOccurrence: next };
};

const processRecurringTemplate = (template, now = new Date(), options = {}) =>
  generateRecurringOccurrences(template, { ...options, now });

const runRecurringTaskSweep = async (filter = {}, options = {}) => {
  const now = options.now || new Date();
  const templateConditions = [
    { isRecurring: true },
    { isActive: true },
    {
      $or: [
        { recurrenceSourceId: null },
        { recurrenceSourceId: { $exists: false } }
      ]
    }
  ];
  if (filter && typeof filter === 'object' && Object.keys(filter).length > 0) {
    templateConditions.push(filter);
  }
  const query = { $and: templateConditions };

  const templates = await Task.find(query).select(
    '_id title description startDateTime dueDateTime nextRecurringDate recurrenceEndDate repeatPattern repeatDays recurringPattern isRecurring createdAt taskFor recurrenceSourceId isActive whatsappNumber priorityDays priority companyCode branch assignedUsers assignedGroups statusByUser checkpoints reminderSettings remarks files voiceNote createdBy'
  ).lean();

  let processed = 0;
  let created = 0;

  for (const template of templates) {
    try {
      const result = await processRecurringTemplate(template, now, options);
      processed += 1;
      created += result.created || 0;
    } catch (error) {
      console.error(`Failed to process recurring task ${template?._id}:`, error);
    }
  }

  return { processed, created };
};

const generateRecurringTasksOnClockIn = async (userId, now) => {
  const groups = await Group.find({ members: userId, isActive: true }).select('_id').lean();
  return runRecurringTaskSweep({ $or: [
    { taskFor: 'self', createdBy: userId },
    { assignedUsers: userId },
    { assignedGroups: { $in: groups.map(group => group._id) } }
  ] }, { now, userId });
};

if (process.env.NODE_ENV !== 'test' && require('../../utils/scheduledJobs').scheduledJobsEnabled()) {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runRecurringTaskSweep();
    } catch (error) {
      console.error('Error in recurring task cron job:', error);
    }
  }, { timezone: 'Asia/Kolkata' });
}

// Check attendance and leave in bulk when displaying older personal occurrences.
const buildAbsenceChecker = async (userId, dateValues = []) => {
  const ranges = dateValues
    .map(value => toValidDate(value))
    .filter(Boolean)
    .map(date => getIndiaDayRange(date))
    .filter(Boolean);
  if (!userId || !ranges.length || mongoose.connection?.readyState === 0) return () => false;

  const start = new Date(Math.min(...ranges.map(range => range.start.getTime())));
  const end = new Date(Math.max(...ranges.map(range => range.end.getTime())));
  let attendance = [];
  let leaves = [];
  try {
    [attendance, leaves] = await Promise.all([
      Attendance.find({ user: userId, date: { $gte: start, $lte: end } })
        .select('date status isClockedIn inTime').lean(),
      Leave.find({ user: userId, status: 'Approved', startDate: { $lte: end }, endDate: { $gte: start } })
        .select('startDate endDate').lean(),
    ]);
  } catch (error) {
    return () => false;
  }

  return (dateValue) => {
    const targetDate = toValidDate(dateValue);
    const bounds = targetDate && getIndiaDayRange(targetDate);
    if (!bounds) return false;
    const absentByAttendance = attendance.some(record => {
      const recordDate = toValidDate(record.date);
      if (!recordDate || recordDate < bounds.start || recordDate > bounds.end) return false;
      const status = String(record.status || '').trim().toUpperCase();
      const isClockedIn = record.isClockedIn === true || Boolean(record.inTime);
      return !isClockedIn && ['ABSENT', 'UNINFORMED LEAVE', 'UNINFORMEDLEAVE'].includes(status);
    });
    if (absentByAttendance) return true;
    return leaves.some(leave => new Date(leave.startDate) <= bounds.end && new Date(leave.endDate) >= bounds.start);
  };
};

module.exports = {
  createOccurrenceIfMissing,
  buildAbsenceChecker,
  generateRecurringOccurrences,
  processRecurringTemplate,
  runRecurringTaskSweep,
  generateRecurringTasksOnClockIn,
  cleanRecurringTasksForAbsentUser,
  cleanRecurringTasksForAbsentUserRange,
};
