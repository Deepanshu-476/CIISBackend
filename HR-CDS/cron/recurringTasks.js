const cron = require('node-cron');
const Task = require('../models/Task');
const {
  buildRecurringTaskClone,
  getNextRecurringDate,
  normalizeTaskRecurrenceFields,
  toValidDate,
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

const createOccurrenceIfMissing = async (templateTask, occurrenceDate) => {
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

const processRecurringTemplate = async (templateTask, now = new Date()) => {
  const normalized = normalizeTaskRecurrenceFields(templateTask);
  if (!normalized.isRecurring || normalized.repeatPattern === 'none') {
    return { created: 0, skipped: true };
  }

  let nextOccurrence = getOccurrenceStartDate(templateTask);
  if (!nextOccurrence) {
    return { created: 0, skipped: true };
  }

  let created = 0;
  let iterations = 0;

  if (nextOccurrence && isAfterRecurringEndDate(nextOccurrence, normalized.recurrenceEndDate)) {
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

  while (
    nextOccurrence &&
    nextOccurrence <= now &&
    !isAfterRecurringEndDate(nextOccurrence, normalized.recurrenceEndDate) &&
    iterations < MAX_CATCH_UP_OCCURRENCES
  ) {
    await createOccurrenceIfMissing(templateTask, nextOccurrence);
    created += 1;
    nextOccurrence = getNextRecurringDate(nextOccurrence, normalized.repeatPattern, normalized.repeatDays);
    iterations += 1;
  }

  if (nextOccurrence && isAfterRecurringEndDate(nextOccurrence, normalized.recurrenceEndDate)) {
    nextOccurrence = null;
  }

  if (nextOccurrence) {
    await Task.updateOne(
      { _id: templateTask._id },
      {
        $set: {
          nextRecurringDate: nextOccurrence,
          repeatPattern: normalized.repeatPattern,
          repeatDays: normalized.repeatDays,
          recurringPattern: normalized.repeatPattern,
          isRecurring: true,
          recurrenceEndDate: normalized.recurrenceEndDate,
        }
      }
    );
  } else {
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
  }

  return { created, nextOccurrence: nextOccurrence || null };
};

const runRecurringTaskSweep = async () => {
  const now = new Date();
  const templates = await Task.find({
    taskFor: 'self',
    isRecurring: true,
    isActive: true,
    $or: [
      { recurrenceSourceId: null },
      { recurrenceSourceId: { $exists: false } }
    ]
  }).select(
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

cron.schedule('*/15 * * * *', async () => {
  try {
    await runRecurringTaskSweep();
  } catch (error) {
    console.error('Error in recurring task cron job:', error);
  }
}, { timezone: 'Asia/Kolkata' });

module.exports = {
  runRecurringTaskSweep,
};
