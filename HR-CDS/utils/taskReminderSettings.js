const REMINDER_OPTIONS = new Set([
  'hourly',
  'halfHourly',
  'oneHourBefore',
  'custom',
  'interval',
  'beforeDue',
]);

const parseReminderOptions = value => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_err) {
      return value.split(',');
    }
  }
  return [];
};

const normalizeTaskReminderSettings = (input = {}) => {
  let rawReminderSettings = input.reminderSettings;
  if (typeof rawReminderSettings === 'string') {
    try {
      rawReminderSettings = JSON.parse(rawReminderSettings);
    } catch (_err) {
      rawReminderSettings = null;
    }
  }
  const raw = rawReminderSettings && typeof rawReminderSettings === 'object'
    ? rawReminderSettings
    : input;
  const enabledValue = raw.reminderEnabled ?? raw.enabled ?? raw.reminder ?? input.reminder;
  const optionsValue = raw.reminderOptions ?? raw.options ?? (raw.reminderOption ? [raw.reminderOption] : (input.reminderOption ? [input.reminderOption] : []));
  const options = [...new Set(parseReminderOptions(optionsValue)
    .map(option => String(option || '').trim())
    .filter(option => REMINDER_OPTIONS.has(option)))];
  
  if (raw.reminderOption && REMINDER_OPTIONS.has(raw.reminderOption) && !options.includes(raw.reminderOption)) {
    options.push(raw.reminderOption);
  }
  if (input.reminderOption && REMINDER_OPTIONS.has(input.reminderOption) && !options.includes(input.reminderOption)) {
    options.push(input.reminderOption);
  }

  let reminderTime = null;
  const rawTime = raw.reminderTime || raw.customTime || raw.time || input.reminderTime || input.customTime;
  if (rawTime) {
    const d = new Date(rawTime);
    if (!isNaN(d.getTime())) {
      reminderTime = d;
      if (!options.includes('custom')) {
        options.push('custom');
      }
    }
  }

  const customTime = typeof raw.customTime === 'string' && raw.customTime.trim()
    ? raw.customTime.trim()
    : (reminderTime ? reminderTime.toISOString() : null);

  let repeatIntervalMinutes = Number(raw.repeatIntervalMinutes ?? raw.repeatInterval ?? raw.interval ?? input.repeatIntervalMinutes);
  if (!Number.isFinite(repeatIntervalMinutes) || repeatIntervalMinutes <= 0) {
    repeatIntervalMinutes = null;
  } else if (!options.includes('interval')) {
    options.push('interval');
  }

  let minutesBeforeDue = Number(raw.minutesBeforeDue ?? raw.beforeDue ?? input.minutesBeforeDue);
  if (!Number.isFinite(minutesBeforeDue) || minutesBeforeDue <= 0) {
    minutesBeforeDue = null;
  } else if (!options.includes('beforeDue')) {
    options.push('beforeDue');
  }

  const isEnabledExplicitly = enabledValue === true || enabledValue === 'true' || enabledValue === 1 || enabledValue === '1';
  if (isEnabledExplicitly && options.length === 0) {
    if (repeatIntervalMinutes) {
      options.push('interval');
    } else if (minutesBeforeDue) {
      options.push('beforeDue');
    } else {
      options.push('oneHourBefore');
    }
  }

  const hasTriggers = options.length > 0 || Boolean(reminderTime || repeatIntervalMinutes || minutesBeforeDue);
  const enabled = (isEnabledExplicitly || hasTriggers) && hasTriggers;

  return {
    enabled: Boolean(enabled),
    options: enabled ? options : [],
    reminderTime: enabled ? reminderTime : null,
    customTime: enabled ? customTime : null,
    repeatIntervalMinutes: enabled ? repeatIntervalMinutes : null,
    minutesBeforeDue: enabled ? minutesBeforeDue : null,
    sentKeys: Array.isArray(raw.sentKeys) ? raw.sentKeys.map(String) : [],
  };
};

module.exports = {
  REMINDER_OPTIONS: [...REMINDER_OPTIONS],
  normalizeTaskReminderSettings,
};
