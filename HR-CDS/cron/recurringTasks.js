const cron = require('node-cron');
const mongoose = require('mongoose');
const Task = require('../models/Task');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const {
  buildRecurringTaskClone,
  getNextRecurringDate,
  normalizeTaskRecurrenceFields,
  toValidDate,
  getIndiaDayRange,
} = require('../utils/taskRecurrence');

const MAX_CATCH_UP_OCCURRENCES = 20;

const isRecurringTemplate = task => (
  task &&
  task.isActive !== false &&
  task.taskFor === 'self' &&
  (!task.recurrenceSourceId || String(task.recurrenceSourceId) === 'null')
);

const getOccurrenceStartDate = (task) => (
  toValidDate(task?.nextRecurringDate) ||
  toValidDate(task?.dueDateTime)
);

const isAfterRecurringEndDate = (occurrenceDate, recurrenceEndDate) => {
  const endDate = toValidDate(recurrenceEndDate);
  if (!endDate) return false;
  return occurrenceDate > endDate;
};

const isUserAbsentOnDate = async (userId, dateValue, options = {}) => {
  if (!userId || !dateValue) return false;
  if (options.isAbsent !== undefined) {
    return typeof options.isAbsent === 'function'
      ? options.isAbsent(userId, dateValue)
      : Boolean(options.isAbsent);
  }
  if (mongoose.connection?.readyState === 0 && !options.mockAbsence) {
    return false;
  }

  const targetDate = toValidDate(dateValue);
  if (!targetDate) return false;

  const bounds = getIndiaDayRange(targetDate);
  if (!bounds) return false;

  try {
    const attendance = await Attendance.findOne({
      user: userId,
      date: { $gte: bounds.start, $lte: bounds.end }
    }).select('status isClockedIn inTime').lean();

    if (attendance) {
      const status = String(attendance.status || '').trim().toUpperCase();
      const isClockedIn = attendance.isClockedIn === true || Boolean(attendance.inTime);
      if (!isClockedIn && ['ABSENT', 'UNINFORMED LEAVE', 'UNINFORMEDLEAVE'].includes(status)) {
        return true;
      }
    }

    const leave = await Leave.findOne({
      user: userId,
      status: 'Approved',
      startDate: { $lte: bounds.end },
      endDate: { $gte: bounds.start }
    }).select('_id').lean();

    if (leave) {
      return true;
    }

    return false;
  } catch (err) {
    console.error(`Error checking user absence for ${userId} on ${targetDate}:`, err);
    return false;
  }
};

const cleanRecurringTasksForAbsentUser = async (userId, targetDate, options = {}) => {
  if (!userId || !targetDate) return 0;
  if (mongoose.connection?.readyState === 0 && !options.mockAbsence) return 0;

  const target = toValidDate(targetDate);
  if (!target) return 0;

  const bounds = getIndiaDayRange(target);
  if (!bounds) return 0;

  try {
    const result = await Task.deleteMany({
      taskFor: 'self',
      recurrenceSourceId: { $ne: null },
      overallStatus: 'pending',
      $or: [
        { assignedUsers: userId },
        { createdBy: userId }
      ],
      dueDateTime: { $gte: bounds.start, $lte: bounds.end }
    });
    return result.deletedCount || 0;
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
    const result = await Task.deleteMany({
      taskFor: 'self',
      recurrenceSourceId: { $ne: null },
      overallStatus: 'pending',
      $or: [
        { assignedUsers: userId },
        { createdBy: userId }
      ],
      dueDateTime: { $gte: startBounds.start, $lte: endBounds.end }
    });
    return result.deletedCount || 0;
  } catch (err) {
    console.error(`Error cleaning recurring tasks for absent user leave range ${userId}:`, err);
    return 0;
  }
};

const createOccurrenceIfMissing = async (templateTask, occurrenceDate, options = {}) => {
  const targetUserId = templateTask.assignedUsers?.[0]?._id
    || templateTask.assignedUsers?.[0]
    || templateTask.createdBy;

  if (targetUserId) {
    const isAbsent = await isUserAbsentOnDate(targetUserId, occurrenceDate, options);
    if (isAbsent) {
      const occurrenceKey = occurrenceDate.toISOString();
      try {
        await Task.deleteOne({
          recurrenceSourceId: templateTask._id,
          recurrenceOccurrenceKey: occurrenceKey,
          overallStatus: 'pending',
        });
      } catch (delErr) {
        // Ignored if disconnected or buffering
      }
      return { created: false, skipped: true, reason: 'user_absent' };
    }
  }

  const occurrenceKey = occurrenceDate.toISOString();
  const existing = await Task.findOne({
    recurrenceSourceId: templateTask._id,
    recurrenceOccurrenceKey: occurrenceKey,
  }).select('_id').lean();

  if (existing) {
    return { created: false, exists: true };
  }

  const clonePayload = buildRecurringTaskClone(templateTask, occurrenceDate);
  if (!clonePayload) {
    return { created: false, skipped: true };
  }

  try {
    await Task.create(clonePayload);
    return { created: true };
  } catch (error) {
    if (error?.code === 11000) {
      return { created: false, duplicate: true };
    }
    throw error;
  }
};

const generateRecurringOccurrences = async (templateTask, options = {}) => {
  const normalized = normalizeTaskRecurrenceFields(templateTask);
  if (!normalized.isRecurring || normalized.repeatPattern === 'none') {
    return { created: 0, skipped: true };
  }

  const maxOccurrences = options.maxOccurrences || 60;
  const targetEndDate = options.targetEndDate || normalized.recurrenceEndDate;
  const baseDueDate = toValidDate(templateTask.dueDateTime);
  if (!baseDueDate) {
    return { created: 0, skipped: true };
  }

  let nextOccurrence = getNextRecurringDate(baseDueDate, normalized.repeatPattern, normalized.repeatDays);
  if (!nextOccurrence) {
    return { created: 0, skipped: true };
  }

  let created = 0;
  let iterations = 0;

  while (
    nextOccurrence &&
    (!targetEndDate || !isAfterRecurringEndDate(nextOccurrence, targetEndDate)) &&
    iterations < maxOccurrences
  ) {
    const result = await createOccurrenceIfMissing(templateTask, nextOccurrence, options);
    if (result.created) {
      created += 1;
    }
    nextOccurrence = getNextRecurringDate(nextOccurrence, normalized.repeatPattern, normalized.repeatDays);
    iterations += 1;
  }

  const isPastEndDate = Boolean(
    targetEndDate &&
    new Date() > targetEndDate
  );

  const hasRemainingFutureOccurrences = Boolean(
    nextOccurrence && (!targetEndDate || !isAfterRecurringEndDate(nextOccurrence, targetEndDate))
  );

  const updateFields = {
    nextRecurringDate: hasRemainingFutureOccurrences ? nextOccurrence : null,
  };

  if (isPastEndDate) {
    updateFields.isRecurring = false;
    updateFields.repeatPattern = 'none';
    updateFields.recurringPattern = 'none';
    updateFields.recurrenceStoppedAt = new Date();
  }

  await Task.updateOne({ _id: templateTask._id }, { $set: updateFields });

  return { created, nextOccurrence: hasRemainingFutureOccurrences ? nextOccurrence : null };
};

const processRecurringTemplate = async (templateTask, now = new Date()) => {
  const normalized = normalizeTaskRecurrenceFields(templateTask);
  if (!normalized.isRecurring || normalized.repeatPattern === 'none') {
    return { created: 0, skipped: true };
  }

  if (normalized.recurrenceEndDate && now > normalized.recurrenceEndDate) {
    await Task.updateOne(
      { _id: templateTask._id },
      {
        $set: {
          isRecurring: false,
          repeatPattern: 'none',
          recurringPattern: 'none',
          nextRecurringDate: null,
          recurrenceStoppedAt: new Date(),
        }
      }
    );
    return { created: 0, stopped: true };
  }

  return generateRecurringOccurrences(templateTask);
};

const runRecurringTaskSweep = async (filter = {}) => {
  const now = new Date();
  const query = {
    taskFor: 'self',
    isRecurring: true,
    isActive: true,
    $or: [
      { recurrenceSourceId: null },
      { recurrenceSourceId: { $exists: false } }
    ],
    ...filter
  };

  const templates = await Task.find(query).select(
    '_id title description startDateTime dueDateTime nextRecurringDate recurrenceEndDate repeatPattern repeatDays recurringPattern isRecurring createdAt taskFor recurrenceSourceId isActive whatsappNumber priorityDays priority companyCode branch assignedUsers assignedGroups statusByUser checkpoints remarks files voiceNote createdBy'
  ).lean();

  let processed = 0;
  let created = 0;

  for (const template of templates) {
    try {
      const result = await processRecurringTemplate(template, now);
      processed += 1;
      created += result.created || 0;
    } catch (error) {
      console.error(`Failed to process recurring task ${template?._id}:`, error);
    }
  }

  return { processed, created };
};

if (process.env.NODE_ENV !== 'test') {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runRecurringTaskSweep();
    } catch (error) {
      console.error('Error in recurring task cron job:', error);
    }
  }, { timezone: 'Asia/Kolkata' });
}

module.exports = {
  createOccurrenceIfMissing,
  generateRecurringOccurrences,
  processRecurringTemplate,
  runRecurringTaskSweep,
  isUserAbsentOnDate,
  cleanRecurringTasksForAbsentUser,
  cleanRecurringTasksForAbsentUserRange,
};
