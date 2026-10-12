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
  const enabledValue = raw.reminderEnabled ?? raw.enabled;
  const optionsValue = raw.reminderOptions ?? raw.options;
  const options = [...new Set(parseReminderOptions(optionsValue)
    .map(option => String(option || '').trim())
    .filter(option => REMINDER_OPTIONS.has(option)))];
  
  let reminderTime = null;
  const rawTime = raw.reminderTime || raw.customTime || raw.time;
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

  let repeatIntervalMinutes = Number(raw.repeatIntervalMinutes);
  if (!Number.isFinite(repeatIntervalMinutes) || repeatIntervalMinutes <= 0) {
    repeatIntervalMinutes = null;
  } else if (!options.includes('interval')) {
    options.push('interval');
  }

  let minutesBeforeDue = Number(raw.minutesBeforeDue);
  if (!Number.isFinite(minutesBeforeDue) || minutesBeforeDue <= 0) {
    minutesBeforeDue = null;
  } else if (!options.includes('beforeDue')) {
    options.push('beforeDue');
  }

  const hasTriggers = options.length > 0 || Boolean(reminderTime || repeatIntervalMinutes || minutesBeforeDue);
  const enabled = (enabledValue === true || enabledValue === 'true' || enabledValue === '1' || hasTriggers) && hasTriggers;

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
