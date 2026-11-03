/**
 * services/ai/taskFields.js
 *
 * Single Source of Truth for task field definitions, slot-filling order,
 * question templates (Roman Hinglish reply + Devanagari Hindi speech),
 * anti-loop re-ask templates, chips, defaults, and normalisers.
 */

const { toIstIsoString, parseHinglishDateTime } = require('./hinglishParser');

const TASK_FIELD_ORDER = [
  'assignee',
  'title',
  'dueDateTime',
  'description',
  'priority',
  'status',
  'reminder',
  'reminderOption',
  'priorityDays',
  'repeatPattern',
  'checkpoints',
  'attachments',
];

const buildDateChips = (refTime = new Date()) => {
  const now = refTime instanceof Date ? refTime : new Date(refTime);
  const istTimeMs = now.getTime() + (330 * 60 * 1000);
  const istDate = new Date(istTimeMs);

  const y = istDate.getUTCFullYear();
  const m = istDate.getUTCMonth();
  const d = istDate.getUTCDate();

  // Aaj shaam 6 PM
  const today6pmUtc = Date.UTC(y, m, d, 18, 0, 0) - (330 * 60 * 1000);
  const today6pmIso = toIstIsoString(new Date(today6pmUtc));

  // Kal subah 10 AM
  const kal10amUtc = Date.UTC(y, m, d + 1, 10, 0, 0) - (330 * 60 * 1000);
  const kal10amIso = toIstIsoString(new Date(kal10amUtc));

  // Kal shaam 6 PM
  const kal6pmUtc = Date.UTC(y, m, d + 1, 18, 0, 0) - (330 * 60 * 1000);
  const kal6pmIso = toIstIsoString(new Date(kal6pmUtc));

  const chips = [];
  if (today6pmUtc > now.getTime()) {
    chips.push({
      label: 'Aaj shaam 6:00 PM',
      value: today6pmIso,
      action: { type: 'set', field: 'dueDateTime', value: today6pmIso },
    });
  }
  chips.push({
    label: 'Kal subah 10:00 AM',
    value: kal10amIso,
    action: { type: 'set', field: 'dueDateTime', value: kal10amIso },
  });
  chips.push({
    label: 'Kal shaam 6:00 PM',
    value: kal6pmIso,
    action: { type: 'set', field: 'dueDateTime', value: kal6pmIso },
  });
  return chips;
};

const TASK_FIELDS = {
  project: {
    key: 'project',
    required: true,
    askOrder: 0.5,
    question: {
      reply: 'Kis project mein task add karna hai? Project ka naam batayein.',
      speech: 'किस प्रोजेक्ट में टास्क जोड़ना है? प्रोजेक्ट का नाम बताएं।',
      speakText: 'Kis project mein task add karna hai? Project ka naam batayein.',
      speakTextHi: 'किस Project में Task जोड़ना है? Project का नाम बताएं।',
    },
    reAskQuestion: {
      reply: 'Kripya project ka sahi naam batayein ya options se chun lein.',
      speech: 'कृपया प्रोजेक्ट का सही नाम बताएं।',
      speakText: 'Kripya project ka sahi naam batayein.',
      speakTextHi: 'कृपया Project का सही नाम बताएं।',
    },
    chips: () => [],
    default: null,
  },

  assignee: {
    key: 'assignee',
    required: false, // Asked only if Owner/Admin explicitly requests others or mentions another name
    askOrder: 1,
    question: {
      reply: 'Kiske liye task banana hai? Employee ka naam batayein.',
      speech: 'किसके लिए टास्क बनाना है? कर्मचारी का नाम बताएं।',
      speakText: 'Kiske liye task banana hai? Employee ka naam batayein.',
      speakTextHi: 'किसके लिए Task बनाना है? Employee का नाम बताएं।',
    },
    reAskQuestion: {
      reply: 'Kripya employee ka naam sahi se batayein, ya "khud ke liye" chun lein.',
      speech: 'कृपया कर्मचारी का नाम सही से बताएं, या खुद के लिए चुन लें।',
      speakText: 'Kripya employee ka naam batayein ya khud ke liye chun lein.',
      speakTextHi: 'कृपया employee का नाम बताएं या खुद के लिए चुन लें।',
    },
    chips: () => [],
    reAskChips: () => [
      { label: 'Khud ke liye', action: { type: 'set', field: 'taskFor', value: 'self' } },
      { label: 'Naam type karein', action: { type: 'edit', field: 'assignee' } },
    ],
    default: null,
    parse: (val) => (val ? String(val).trim() : null),
    normalise: (val) => (val ? String(val).trim() : null),
  },

  title: {
    key: 'title',
    required: true,
    askOrder: 2,
    question: {
      reply: 'Task ka naam kya rakhna hai?',
      speech: 'टास्क का नाम क्या रखना है?',
      speakText: 'Task ka naam kya rakhna hai?',
      speakTextHi: 'Task का नाम क्या रखना है?',
    },
    reAskQuestion: {
      reply: 'Task ka naam 2-3 shabdon mein seedhe likh dein (jaise "Client meeting" ya "Bug fix").',
      speech: 'टास्क का नाम सीधे लिख दें, जैसे क्लाइंट मीटिंग या बग फिक्स।',
      speakText: 'Task ka naam seedhe likh dein, jaise Client meeting ya Bug fix.',
      speakTextHi: 'Task का नाम सीधे लिख दें, जैसे Client meeting या Bug fix।',
    },
    chips: () => [],
    reAskChips: () => [
      { label: 'Client meeting', action: { type: 'set', field: 'title', value: 'Client meeting' } },
      { label: 'Daily update', action: { type: 'set', field: 'title', value: 'Daily update' } },
      { label: 'Bug fix', action: { type: 'set', field: 'title', value: 'Bug fix' } },
    ],
    default: null,
    parse: (val) => (val ? String(val).trim() : null),
    normalise: (val) => (val ? String(val).trim() : null),
  },

  description: {
    key: 'description',
    required: false,
    askOrder: 3,
    question: {
      reply: "Description kya likhna hai? Agar nahi hai to 'koi nahi' bol dein.",
      speech: 'Description क्या लिखना है? अगर नहीं है तो कोई नहीं बोल दें।',
      speakText: 'Description kya likhna hai? Agar nahi to skip bol dein.',
      speakTextHi: 'Description क्या लिखना है? अगर नहीं है तो skip बोल दें।',
    },
    reAskQuestion: {
      reply: "Description optional hai. Kuch nahi likhna to 'Skip' dabayein.",
      speech: 'Description जरूरी नहीं है। कुछ नहीं लिखना तो स्किप दबाएं।',
      speakText: 'Description optional hai. Kuch nahi likhna to Skip dabayein.',
      speakTextHi: 'Description optional है। कुछ नहीं लिखना तो Skip दबाएं।',
    },
    chips: () => [
      { label: 'Koi nahi / Skip', action: { type: 'skip', field: 'description' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: 'Koi nahi / Skip', action: { type: 'skip', field: 'description' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    default: '',
    parse: (val) => (val !== undefined && val !== null ? String(val).trim() : ''),
    normalise: (val) => (val !== undefined && val !== null ? String(val).trim() : ''),
  },

  dueDateTime: {
    key: 'dueDateTime',
    required: true,
    askOrder: 4,
    question: {
      reply: 'Ye task kab tak complete hona chahiye? Date aur time batayein.',
      speech: 'यह टास्क कब तक पूरा होना चाहिए? तारीख और समय बताएं।',
      speakText: 'Ye task kab tak complete hona chahiye? Due date aur time batayein.',
      speakTextHi: 'यह Task कब तक complete होना चाहिए? Due date और समय बताएं।',
    },
    reAskQuestion: {
      reply: 'Kripya niche diye options se direct date aur time chun lein.',
      speech: 'कृपया नीचे दिए विकल्पों से तारीख और समय चुन लें।',
      speakText: 'Kripya niche diye options se direct Due date chun lein.',
      speakTextHi: 'कृपया नीचे दिए विकल्पों से Due date चुन लें।',
    },
    chips: buildDateChips,
    reAskChips: buildDateChips,
    default: null,
    parse: (val) => {
      if (!val) return null;
      if (val instanceof Date) return toIstIsoString(val);
      if (typeof val === 'string' && val.includes('T')) return val;
      return parseHinglishDateTime(String(val));
    },
    normalise: (val) => val,
  },

  priority: {
    key: 'priority',
    required: false,
    askOrder: 5,
    question: {
      reply: 'Priority kya rakhein? Low, Medium ya High?',
      speech: 'Priority क्या रखें? Low, Medium ya High?',
      speakText: 'Priority kya rakhein? Low, Medium ya High?',
      speakTextHi: 'Priority क्या रखें? Low, Medium या High?',
    },
    reAskQuestion: {
      reply: 'Kripya inme se ek priority chun lein: Low, Medium ya High.',
      speech: 'कृपया इनमें से एक Priority चुनें: Low, Medium ya High।',
      speakText: 'Inme se ek Priority chun lein: Low, Medium ya High.',
      speakTextHi: 'इनमें से एक Priority चुन लें: Low, Medium या High।',
    },
    chips: () => [
      { label: 'Low', action: { type: 'set', field: 'priority', value: 'low' } },
      { label: 'Medium', action: { type: 'set', field: 'priority', value: 'medium' } },
      { label: 'High', action: { type: 'set', field: 'priority', value: 'high' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: 'Low', action: { type: 'set', field: 'priority', value: 'low' } },
      { label: 'Medium', action: { type: 'set', field: 'priority', value: 'medium' } },
      { label: 'High', action: { type: 'set', field: 'priority', value: 'high' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    default: 'medium',
    parse: (val) => {
      const clean = String(val || '').trim().toLowerCase();
      if (['low', 'medium', 'high'].includes(clean)) return clean;
      if (clean === 'urgent') return 'high';
      return 'medium';
    },
    normalise: (val) => {
      const clean = String(val || 'medium').trim().toLowerCase();
      return ['low', 'medium', 'high'].includes(clean) ? clean : 'medium';
    },
  },

  status: {
    key: 'status',
    required: false,
    askOrder: 5.5,
    question: {
      reply: 'Task ka status kya rakhna hai? Pending, In Progress, On Hold, ya Completed?',
      speech: 'टास्क का स्टेटस क्या रखना है? पेंडिंग, इन प्रोग्रेस, ऑन होल्ड, या कम्प्लीटेड?',
      speakText: 'Task ka status kya rakhna hai? Pending, In Progress, On Hold, ya Completed?',
      speakTextHi: 'Task का status क्या रखना है? Pending, In Progress, On Hold, या Completed?',
    },
    reAskQuestion: {
      reply: 'Status chun lein (jaise Pending, In Progress, On Hold, Completed). Default Pending rahega.',
      speech: 'स्टेटस चुन लें, जैसे पेंडिंग, इन प्रोग्रेस, ऑन होल्ड, या कम्प्लीटेड। डिफॉल्ट पेंडिंग रहेगा।',
      speakText: 'Status chun lein, default Pending rahega.',
      speakTextHi: 'Status चुन लें, default Pending रहेगा।',
    },
    chips: () => [
      { label: 'Pending', action: { type: 'set', field: 'status', value: 'pending' } },
      { label: 'In Progress', action: { type: 'set', field: 'status', value: 'in-progress' } },
      { label: 'Completed', action: { type: 'set', field: 'status', value: 'completed' } },
      { label: 'On Hold', action: { type: 'set', field: 'status', value: 'onhold' } },
    ],
    reAskChips: () => [
      { label: 'Pending', action: { type: 'set', field: 'status', value: 'pending' } },
      { label: 'In Progress', action: { type: 'set', field: 'status', value: 'in-progress' } },
      { label: 'Completed', action: { type: 'set', field: 'status', value: 'completed' } },
      { label: 'On Hold', action: { type: 'set', field: 'status', value: 'onhold' } },
    ],
    default: 'pending',
    parse: (val) => {
      const clean = String(val || '').trim().toLowerCase().replace(/[\s_]/g, '-');
      if (clean.includes('in-progress') || clean.includes('inprogress') || clean.includes('progress') || clean.includes('chalu') || clean.includes('चालू')) return 'in-progress';
      if (clean.includes('completed') || clean.includes('complete') || clean.includes('done') || clean.includes('khatam') || clean.includes('कम्प्लीट') || clean.includes('पूरा')) return 'completed';
      if (clean.includes('on-hold') || clean.includes('onhold') || clean.includes('hold') || clean.includes('होल्ड')) return 'onhold';
      if (clean.includes('rejected') || clean.includes('reject') || clean.includes('खारिज') || clean.includes('रिजेक्ट')) return 'rejected';
      if (clean.includes('cancelled') || clean.includes('cancel') || clean.includes('रद्द') || clean.includes('कैंसिल')) return 'cancelled';
      if (clean.includes('overdue') || clean.includes('लेट') || clean.includes('ओवरड्यू')) return 'overdue';
      if (clean.includes('reopen') || clean.includes('रीओपन')) return 'reopen';
      return 'pending';
    },
    normalise: (val) => {
      const clean = String(val || 'pending').trim().toLowerCase().replace(/[\s_]/g, '-');
      const valid = ['pending', 'in-progress', 'completed', 'approved', 'rejected', 'onhold', 'reopen', 'cancelled', 'overdue'];
      return valid.includes(clean) ? clean : 'pending';
    },
  },

  reminder: {
    key: 'reminder',
    required: false,
    askOrder: 6,
    question: {
      reply: 'Reminder on karna hai? Haan ya nahi? (Jaise har 10 min, har 30 min, 1 ghante pehle)',
      speech: 'रिमाइंडर ऑन करना है? हाँ या नहीं?',
      speakText: 'Reminder on karna hai? Haan ya nahi?',
      speakTextHi: 'Reminder on करना है? हाँ या नहीं?',
    },
    reAskQuestion: {
      reply: 'Reminder lagana hai ya nahi? Niche diye button par tap karein.',
      speech: 'रिमाइंडर लगाना है या नहीं? नीचे दिए बटन पर टैप करें।',
      speakText: 'Reminder lagana hai ya nahi?',
      speakTextHi: 'Reminder लगाना है या नहीं?',
    },
    chips: () => [
      { label: 'Haan', action: { type: 'set', field: 'reminder', value: true } },
      { label: 'Every 10 min', action: { type: 'set', field: 'repeatIntervalMinutes', value: 10 } },
      { label: '1 hour before', action: { type: 'set', field: 'reminderOption', value: 'oneHourBefore' } },
      { label: 'Nahi', action: { type: 'set', field: 'reminder', value: false } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: 'Haan', action: { type: 'set', field: 'reminder', value: true } },
      { label: 'Every 10 min', action: { type: 'set', field: 'repeatIntervalMinutes', value: 10 } },
      { label: '1 hour before', action: { type: 'set', field: 'reminderOption', value: 'oneHourBefore' } },
      { label: 'Nahi', action: { type: 'set', field: 'reminder', value: false } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    default: false,
    parse: (val) => {
      if (typeof val === 'boolean') return val;
      const clean = String(val || '').trim().toLowerCase();
      if (['haan', 'yes', 'true', 'on', 'ha'].includes(clean)) return true;
      if (['nahi', 'no', 'false', 'off', 'na'].includes(clean)) return false;
      if (/(?:hour|ghant|baad|pehle|before|half|30|10|min|aadha|hourly|har|laga|chalu|kar\s*do|एक|घंटे|घंटा|बाद|पहले|मिनट)/i.test(clean)) return true;
      return false;
    },
    normalise: (val) => Boolean(val),
  },

  reminderOption: {
    key: 'reminderOption',
    required: false,
    askOrder: 7,
    parentKey: 'reminder',
    question: {
      reply: 'Reminder kab bhejein? Har 10 min me, har 30 min me, har 1 ghante me, ya 1 ghante pehle?',
      speech: 'रिमाइंडर कब भेजें? हर दस मिनट में, हर तीस मिनट में, हर एक घंटे में, या एक घंटे पहले?',
      speakText: 'Reminder kab bhejein? Jaise har 10 min ya 1 ghanta pehle.',
      speakTextHi: 'Reminder कब भेजें? जैसे हर 10 मिनट या 1 घंटा पहले।',
    },
    reAskQuestion: {
      reply: 'Kripya reminder timing option chun lein (jaise har 10 min, har 30 min, 1 ghante pehle).',
      speech: 'कृपया रिमाइंडर टाइमिंग ऑप्शन चुन लें।',
      speakText: 'Reminder ka time chun lein.',
      speakTextHi: 'Reminder का समय चुन लें।',
    },
    chips: () => [
      { label: 'Every 10 min', action: { type: 'set', field: 'repeatIntervalMinutes', value: 10 } },
      { label: 'Every 30 min', action: { type: 'set', field: 'reminderOption', value: 'halfHourly' } },
      { label: 'Every 1 hour', action: { type: 'set', field: 'reminderOption', value: 'hourly' } },
      { label: '1 hour before', action: { type: 'set', field: 'reminderOption', value: 'oneHourBefore' } },
      { label: '15 min before due', action: { type: 'set', field: 'minutesBeforeDue', value: 15 } },
    ],
    reAskChips: () => [
      { label: 'Every 10 min', action: { type: 'set', field: 'repeatIntervalMinutes', value: 10 } },
      { label: 'Every 30 min', action: { type: 'set', field: 'reminderOption', value: 'halfHourly' } },
      { label: 'Every 1 hour', action: { type: 'set', field: 'reminderOption', value: 'hourly' } },
      { label: '1 hour before', action: { type: 'set', field: 'reminderOption', value: 'oneHourBefore' } },
      { label: '15 min before due', action: { type: 'set', field: 'minutesBeforeDue', value: 15 } },
    ],
    default: 'oneHourBefore',
    parse: (val) => {
      const clean = String(val || '').trim().toLowerCase();
      const intervalMatch = clean.match(/(?:every|har|repeat)?\s*(\d+)\s*(?:min|minute|m)/);
      if (intervalMatch) return 'interval';
      if (clean.includes('half') || clean.includes('30') || clean.includes('aadha') || clean.includes('आधा')) return 'halfHourly';
      if (clean.includes('every') || clean.includes('har 1') || clean.includes('hourly') || clean.includes('har ghante') || clean.includes('हर')) return 'hourly';
      if (clean.includes('pehle') || clean.includes('before')) return clean.includes('1') || clean.includes('hour') ? 'oneHourBefore' : 'beforeDue';
      return 'oneHourBefore';
    },
    normalise: (val) => {
      const clean = String(val || 'oneHourBefore').trim();
      return ['hourly', 'halfHourly', 'oneHourBefore', 'interval', 'beforeDue', 'custom'].includes(clean) ? clean : 'oneHourBefore';
    },
  },

  priorityDays: {
    key: 'priorityDays',
    required: false,
    askOrder: 8,
    question: {
      reply: 'Priority Days kitne rakhein? (default 1)',
      speech: 'प्रायोरिटी डेज कितने रखें? (डिफ़ॉल्ट एक)',
      speakText: 'Priority days kitne rakhne hain? Jaise 1, 2 ya 3 din.',
      speakTextHi: 'Priority days कितने रखने हैं? जैसे 1, 2, या 3 दिन।',
    },
    reAskQuestion: {
      reply: 'Priority days kitne din rakhne hain? Niche se chun lein.',
      speech: 'प्रायोरिटी डेज नीचे से चुन लें।',
      speakText: 'Priority days niche se chun lein.',
      speakTextHi: 'Priority days नीचे से चुन लें।',
    },
    chips: () => [
      { label: '1 (Default)', action: { type: 'set', field: 'priorityDays', value: '1' } },
      { label: '2', action: { type: 'set', field: 'priorityDays', value: '2' } },
      { label: '3', action: { type: 'set', field: 'priorityDays', value: '3' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: '1 (Default)', action: { type: 'set', field: 'priorityDays', value: '1' } },
      { label: '2', action: { type: 'set', field: 'priorityDays', value: '2' } },
      { label: 'Skip', action: { type: 'skip', field: 'priorityDays' } },
    ],
    default: '1',
    parse: (val) => {
      const num = parseInt(val, 10);
      return !isNaN(num) && num >= 1 ? String(num) : '1';
    },
    normalise: (val) => String(val || '1'),
  },

  repeatPattern: {
    key: 'repeatPattern',
    required: false,
    askOrder: 9,
    question: {
      reply: 'Kya ye task repeat karna hai? (No repeat / Repeat Task)',
      speech: 'क्या यह टास्क रिपीट करना है?',
      speakText: 'Kya yeh task repeat karna hai?',
      speakTextHi: 'क्या यह Task repeat करना है?',
    },
    reAskQuestion: {
      reply: 'Task repeat karna hai ya nahi? Niche option chunein.',
      speech: 'टास्क रिपीट करना है या नहीं? नीचे विकल्प चुनें।',
      speakText: 'Task repeat karna hai ya nahi?',
      speakTextHi: 'Task repeat करना है या नहीं?',
    },
    chips: () => [
      { label: 'No repeat', action: { type: 'set', field: 'repeatPattern', value: 'none' } },
      { label: 'Repeat Task (Daily)', action: { type: 'set', field: 'repeatPattern', value: 'daily' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: 'No repeat', action: { type: 'set', field: 'repeatPattern', value: 'none' } },
      { label: 'Repeat Task (Daily)', action: { type: 'set', field: 'repeatPattern', value: 'daily' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    default: 'none',
    parse: (val) => {
      const clean = String(val || '').trim().toLowerCase();
      if (clean === 'daily' || clean === 'roz' || clean.includes('repeat')) return 'daily';
      return 'none';
    },
    normalise: (val) => (val === 'daily' ? 'daily' : 'none'),
  },

  checkpoints: {
    key: 'checkpoints',
    required: false,
    askOrder: 10,
    question: {
      reply: "Koi checkpoints add karne hain? Ek ek bol dein, ya 'koi nahi' bol dein.",
      speech: 'कोई चेकपॉइंट्स जोड़ने हैं? एक-एक बोल दें, या कोई नहीं बोल दें।',
      speakText: 'Checkpoints add karne hain? Ek ek bol dein, ya skip bol dein.',
      speakTextHi: 'कोई Checkpoints add करने हैं? एक-एक बोल दें, या skip बोल दें।',
    },
    reAskQuestion: {
      reply: "Checkpoints add nahi karne to 'Skip' par tap karein.",
      speech: 'चेकपॉइंट्स नहीं जोड़ने तो स्किप पर टैप करें।',
      speakText: 'Checkpoints add nahi karne to Skip par tap karein.',
      speakTextHi: 'Checkpoints नहीं जोड़ने तो Skip पर tap करें।',
    },
    chips: () => [
      { label: 'Koi nahi / Skip', action: { type: 'skip', field: 'checkpoints' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: 'Koi nahi / Skip', action: { type: 'skip', field: 'checkpoints' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    default: [],
    parse: (val) => {
      if (Array.isArray(val)) {
        return val
          .map((item) => (typeof item === 'string' ? { title: item.trim(), completed: false } : item))
          .filter((item) => item?.title);
      }
      if (typeof val === 'string' && val.trim()) {
        return val
          .split(/[,;]|\band\b|\baur\b/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((title) => ({ title, completed: false }));
      }
      return [];
    },
    normalise: (val) => (Array.isArray(val) ? val : []),
  },

  attachments: {
    key: 'attachments',
    required: false,
    askOrder: 11,
    question: {
      reply: "Koi photo ya file attach karni hai? Clip button se upload karein, ya 'nahi' bol dein.",
      speech: 'कोई फोटो या फाइल अटैच करनी है? क्लिप बटन से अपलोड करें, या नहीं बोल दें।',
      speakText: 'Koi photo ya file attach karni hai? Nahi to skip bol dein.',
      speakTextHi: 'कोई photo या file attach करनी है? नहीं तो skip बोल दें।',
    },
    reAskQuestion: {
      reply: "File attach nahi karni to 'Nahi' dabayein, task ready ho jayega.",
      speech: 'File attach नहीं करनी तो नहीं दबाएं।',
      speakText: 'File attach nahi karni to Nahi dabayein.',
      speakTextHi: 'File attach नहीं करनी तो नहीं दबाएं।',
      speakText: 'File attach nahi karni to Nahi dabayein.',
      speakTextHi: 'File attach नहीं करनी तो नहीं दबाएं।',
    },
    chips: () => [
      { label: 'Haan, attach karta hoon', action: { type: 'set', field: 'attachments', value: true } },
      { label: 'Nahi', action: { type: 'skip', field: 'attachments' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: 'Nahi (Skip)', action: { type: 'skip', field: 'attachments' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    default: 0,
    parse: (val) => (typeof val === 'number' ? val : 0),
    normalise: (val) => Number(val || 0),
  },

  dueDate: {
    key: 'dueDate',
    required: false,
    askOrder: 4,
    question: {
      reply: 'Task ki due date kya rakhni hai? (Jaise Aaj shaam 6 PM, Kal subah 10 AM)',
      speech: 'टास्क की ड्यू डेट क्या रखनी है?',
      speakText: 'Task ki due date kya rakhni hai?',
      speakTextHi: 'Task की Due date क्या रखनी है?',
    },
    reAskQuestion: {
      reply: 'Kripya due date batayein ya "koi nahi" bolkar skip karein.',
      speech: 'कृपया ड्यू डेट बताएं या स्किप करें।',
      speakText: 'Kripya due date batayein ya skip karein.',
      speakTextHi: 'कृपया Due date बताएं या skip करें।',
    },
    chips: buildDateChips,
    reAskChips: buildDateChips,
    default: null,
    parse: (val) => {
      if (!val) return null;
      if (val instanceof Date) return toIstIsoString(val);
      if (typeof val === 'string' && val.includes('T')) return val;
      return parseHinglishDateTime(String(val));
    },
    normalise: (val) => val,
  },

  file: {
    key: 'file',
    required: false,
    askOrder: 9.5,
    question: {
      reply: "Koi document ya photo attach karni hai? (Ek PDF ya image file, ya 'nahi' bol dein)",
      speech: 'कोई document या photo attach करनी है?',
      speakText: 'Koi document ya photo attach karni hai? Ya nahi bol dein.',
      speakTextHi: 'कोई document या photo attach करनी है? या नहीं बोल दें।',
    },
    reAskQuestion: {
      reply: "File attach nahi karni to 'Nahi' dabayein, task ready ho jayega.",
      speech: 'File attach नहीं करनी तो नहीं दबाएं।',
      speakText: 'File attach nahi karni to Nahi dabayein.',
      speakTextHi: 'File attach नहीं करनी तो नहीं दबाएं।',
    },
    chips: () => [
      { label: 'Haan, attach karta hoon', action: { type: 'set', field: 'attachments', value: true } },
      { label: 'Nahi (Skip)', action: { type: 'skip', field: 'file' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    reAskChips: () => [
      { label: 'Nahi (Skip)', action: { type: 'skip', field: 'file' } },
      { label: 'Baaki sab default', action: { type: 'skip_all' } },
    ],
    default: 0,
    parse: (val) => (typeof val === 'number' ? val : 0),
    normalise: (val) => Number(val || 0),
  },

  ready: {
    key: 'ready',
    required: true,
    askOrder: 12,
    question: {
      reply: 'Sab details ready hain. Kya ise create kar doon?',
      speech: 'सब details ready हैं। क्या इसे create कर दूं?',
      speakText: 'Sab details ready hain. Kya ise create kar doon?',
      speakTextHi: 'सब details ready हैं। क्या इसे create कर दूं?',
    },
    chips: () => [
      { label: 'Haan, create karo', action: { type: 'confirm' } },
      { label: 'Kuch badalna hai', action: { type: 'edit' } },
    ],
    default: false,
  },
};

const validateAttachmentFile = (file, currentCount = 0, maxFiles = 1, maxSizeBytes = 10 * 1024 * 1024, allowedExts = new Set(['pdf'])) => {
  if (!file || !file.name) {
    return { valid: false, error: 'File invalid hai.' };
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!allowedExts.has(ext)) {
    return { valid: false, error: `Only PDF files allowed. File type .${ext} is not allowed.` };
  }
  if (file.size > maxSizeBytes) {
    return { valid: false, error: `File "${file.name}" exceeds 10MB size limit.` };
  }
  if (currentCount >= maxFiles) {
    return { valid: false, error: `Maximum ${maxFiles} file allowed.` };
  }
  return { valid: true };
};

module.exports = {
  TASK_FIELD_ORDER,
  TASK_FIELDS,
  validateAttachmentFile,
};
