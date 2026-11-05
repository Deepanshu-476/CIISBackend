// India time helpers. The backend works in Asia/Kolkata (UTC+05:30) for shifts,
// attendance days and leave days, so the tests do too.
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const istParts = (d = new Date()) => {
  const s = new Date(d.getTime() + IST_MS);
  return {
    y: s.getUTCFullYear(),
    m: s.getUTCMonth(),
    d: s.getUTCDate(),
    hh: s.getUTCHours(),
    mm: s.getUTCMinutes(),
    dow: s.getUTCDay(), // 0 = Sunday
  };
};

const pad = n => String(n).padStart(2, '0');

// "YYYY-MM-DD" in India time
const istKey = (d = new Date()) => {
  const p = istParts(d);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
};

// A Date for a given India-local day + time
const istAt = (key, hhmm = '00:00') => new Date(`${key}T${hhmm}:00.000+05:30`);

const addDaysKey = (key, days) => istKey(new Date(istAt(key, '12:00').getTime() + days * DAY_MS));

const minutesNowIst = () => {
  const p = istParts();
  return p.hh * 60 + p.mm;
};

const hhmm = minutes => {
  const n = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
};

const dowOfKey = key => istParts(istAt(key, '12:00')).dow;

// Most recent day before today (India) whose weekday is `dow` (0 Sun … 6 Sat)
const lastDowBefore = (dow, fromKey = istKey()) => {
  let k = addDaysKey(fromKey, -1);
  for (let i = 0; i < 8; i++) {
    if (dowOfKey(k) === dow) return k;
    k = addDaysKey(k, -1);
  }
  return null;
};

// Most recent Mon–Fri before today
const lastWeekdayBefore = (fromKey = istKey(), skip = 0) => {
  let k = addDaysKey(fromKey, -1);
  let found = 0;
  for (let i = 0; i < 20; i++) {
    const dow = dowOfKey(k);
    if (dow >= 1 && dow <= 5) {
      if (found === skip) return k;
      found += 1;
    }
    k = addDaysKey(k, -1);
  }
  return null;
};

const monthOfKey = key => ({ year: Number(key.slice(0, 4)), month0: Number(key.slice(5, 7)) - 1 });

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

module.exports = {
  IST_MS, DAY_MS, istParts, istKey, istAt, addDaysKey, minutesNowIst, hhmm,
  dowOfKey, lastDowBefore, lastWeekdayBefore, monthOfKey, MONTH_NAMES,
};
