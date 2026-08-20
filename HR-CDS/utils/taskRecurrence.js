const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_REPEAT_PATTERNS = new Set(['none', 'daily']);
const WEEKDAY_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const normalizeRepeatPattern = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '-');
  if (normalized === 'no') return 'none';
  if (VALID_REPEAT_PATTERNS.has(normalized)) return normalized;
  return 'none';
};

const normalizeRepeatDay = (value) => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  return Object.prototype.hasOwnProperty.call(WEEKDAY_TO_INDEX, normalized) ? normalized : '';
};

const toBoolean = (value) => (
  value === true ||
  value === 'true' ||
  value === 1 ||
  value === '1'
);

const normalizeRepeatDays = (value) => {
  let rawValues = [];

  if (Array.isArray(value)) {
    rawValues = value;
  } else if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    try {
      const parsed = JSON.parse(trimmed);
      rawValues = Array.isArray(parsed) ? parsed : trimmed.split(',');
    } catch {
      rawValues = trimmed.split(',');
    }
  }

  return [...new Set(rawValues.map(normalizeRepeatDay).filter(Boolean))];
};

const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getIndiaDateParts = (value) => {
  const date = toValidDate(value);
  if (!date) return null;

  const shifted = new Date(date.getTime() + INDIA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
    weekday: shifted.getUTCDay(),
  };
};

const buildIndiaDateTime = (dateParts, timeParts = null) => {
  if (!dateParts) return null;

  const hours = timeParts?.hour ?? dateParts.hour ?? 0;
  const minutes = timeParts?.minute ?? dateParts.minute ?? 0;
  const seconds = timeParts?.second ?? dateParts.second ?? 0;
  const milliseconds = timeParts?.millisecond ?? dateParts.millisecond ?? 0;

  return new Date(Date.UTC(
    dateParts.year,
    dateParts.monthIndex,
    dateParts.day,
    hours,
    minutes,
    seconds,
    milliseconds
  ) - INDIA_OFFSET_MS);
};

const cloneDateTimeForOccurrence = (occurrenceDate, sourceDateTime) => {
  const occurrenceParts = getIndiaDateParts(occurrenceDate);
  const sourceParts = getIndiaDateParts(sourceDateTime);
  if (!occurrenceParts || !sourceParts) return null;

  return buildIndiaDateTime(occurrenceParts, {
    hour: sourceParts.hour,
    minute: sourceParts.minute,
    second: sourceParts.second,
    millisecond: sourceParts.millisecond,
  });
};

const getRecurringTimeParts = (value) => {
  const dateParts = getIndiaDateParts(value);
  if (!dateParts) return null;

  return {
    hour: dateParts.hour,
    minute: dateParts.minute,
    second: dateParts.second,
    millisecond: dateParts.millisecond,
  };
};

const getNextRecurringDate = (referenceDate, repeatPattern, repeatDays) => {
  const baseDate = toValidDate(referenceDate);
  if (!baseDate) return null;

  const pattern = normalizeRepeatPattern(repeatPattern);
  if (pattern === 'none') return null;

  const timeParts = getRecurringTimeParts(baseDate);
  const localBase = getIndiaDateParts(baseDate);
  if (!localBase) return null;

  const localMidnight = buildIndiaDateTime({
    year: localBase.year,
    monthIndex: localBase.monthIndex,
    day: localBase.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  });

  if (!localMidnight) return null;

  const selectedDays = normalizeRepeatDays(repeatDays);
  const selectedIndexes = selectedDays.map(day => WEEKDAY_TO_INDEX[day]).filter(Number.isInteger);

  if (pattern !== 'daily') return null;

  if (selectedIndexes.length > 0) {
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidateLocal = new Date(localMidnight.getTime() + (offset * DAY_MS));
      const candidateParts = getIndiaDateParts(candidateLocal);
      if (!candidateParts) continue;
      if (selectedIndexes.includes(candidateParts.weekday)) {
        return buildIndiaDateTime(candidateParts, timeParts);
      }
    }
  }

  const nextLocal = new Date(localMidnight.getTime() + DAY_MS);
  return buildIndiaDateTime(getIndiaDateParts(nextLocal), timeParts);
};

const normalizeTaskRecurrenceFields = (task = {}) => {
  const repeatPattern = normalizeRepeatPattern(task.repeatPattern || task.recurringPattern);
  const repeatDays = normalizeRepeatDays(task.repeatDays);
  const isRecurring = toBoolean(task.isRecurring) || repeatPattern !== 'none';
  const nextRecurringDate = task.nextRecurringDate ? toValidDate(task.nextRecurringDate) : null;
  const recurrenceSourceId = task.recurrenceSourceId || null;
  const recurrenceOccurrenceKey = task.recurrenceOccurrenceKey || null;

  return {
    repeatPattern,
    repeatDays,
    isRecurring,
    nextRecurringDate,
    recurrenceSourceId,
    recurrenceOccurrenceKey,
  };
};

const buildRecurringTaskClone = (templateTask, occurrenceDate) => {
  const baseTask = typeof templateTask?.toObject === 'function' ? templateTask.toObject() : { ...(templateTask || {}) };
  const normalized = normalizeTaskRecurrenceFields(baseTask);
  const dueDateTime = toValidDate(occurrenceDate);
  if (!dueDateTime) return null;

  const sourceId = baseTask.recurrenceSourceId || baseTask._id || null;
  const nextRecurringDate = getNextRecurringDate(dueDateTime, normalized.repeatPattern, normalized.repeatDays);
  const assignedUsers = Array.isArray(baseTask.assignedUsers) && baseTask.assignedUsers.length > 0
    ? baseTask.assignedUsers.map(user => user?._id || user).filter(Boolean)
    : (baseTask.createdBy ? [baseTask.createdBy] : []);
  const checkpoints = Array.isArray(baseTask.checkpoints)
    ? baseTask.checkpoints.map(checkpoint => ({
        title: String(checkpoint?.title || '').trim(),
        completed: false,
        completedAt: null,
        completedBy: null,
      })).filter(checkpoint => checkpoint.title)
    : [];
  const statusByUser = assignedUsers.map(userId => ({
    user: userId,
    status: 'pending',
    updatedAt: new Date(),
    remarks: 'Recurring task auto-created'
  }));

  return {
    title: baseTask.title,
    description: baseTask.description,
    startDateTime: baseTask.startDateTime
      ? cloneDateTimeForOccurrence(dueDateTime, baseTask.startDateTime)
      : null,
    dueDateTime,
    whatsappNumber: baseTask.whatsappNumber,
    priorityDays: baseTask.priorityDays,
    priority: baseTask.priority || 'medium',
    companyCode: baseTask.companyCode,
    branch: baseTask.branch || null,
    assignedUsers,
    assignedGroups: Array.isArray(baseTask.assignedGroups) ? [...baseTask.assignedGroups] : [],
    statusByUser,
    statusHistory: [{
      status: 'pending',
      changedBy: baseTask.createdBy,
      remarks: 'Recurring task auto-created',
      changedAt: new Date()
    }],
    checkpoints,
    remarks: [],
    files: Array.isArray(baseTask.files) ? [...baseTask.files] : [],
    voiceNote: baseTask.voiceNote ? { ...baseTask.voiceNote } : null,
    createdBy: baseTask.createdBy,
    taskFor: 'self',
    isRecurring: normalized.isRecurring,
    repeatPattern: normalized.repeatPattern,
    repeatDays: normalized.repeatDays,
    recurringPattern: normalized.repeatPattern,
    nextRecurringDate,
    recurrenceSourceId: sourceId,
    recurrenceOccurrenceKey: dueDateTime.toISOString(),
    creatorStatus: {
      status: 'pending',
      updatedAt: new Date(),
    },
    overallStatus: 'pending',
    completionDate: null,
    markedOverdueAt: null,
    overdueReason: undefined,
    overdueNotified: false,
    onHoldReleasedAt: null,
    snoozedUntil: null,
    isSnoozed: false,
    lastActivityAt: new Date(),
    isActive: true,
  };
};

module.exports = {
  INDIA_OFFSET_MS,
  normalizeRepeatPattern,
  normalizeRepeatDays,
  toBoolean,
  normalizeTaskRecurrenceFields,
  getNextRecurringDate,
  buildRecurringTaskClone,
  toValidDate,
};
