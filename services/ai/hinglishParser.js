/**
 * services/ai/hinglishParser.js
 *
 * Deterministic pre-parser for speech-to-text Hinglish & Devanagari task commands.
 * Runs BEFORE the LLM and guarantees robust extraction of:
 * - Dates / times (handling STT typos like 'cal' for 'kal', bare hours, Hindi numbers)
 * - Explicit field patterns ("uska naam X ho", "description Y", etc.)
 * - Skip keywords ("koi nahi", "baaki sab default", etc.)
 */

// India Standard Time offset: UTC + 05:30 = +330 minutes
const IST_OFFSET_MINUTES = 330;
const { normalizeTranscript } = require('./sttNormalizer');

// Convert Devanagari digits ०-९ to 0-9 and normalize Devanagari nuktas (e.g. बज़ -> बज)
function normalizeDigits(text) {
  if (!text) return '';
  const devanagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  let res = text;
  for (let i = 0; i < 10; i++) {
    res = res.split(devanagariDigits[i]).join(String(i));
  }
  res = res.replace(/ब[ज़ज]\u093C?/gu, 'बज');
  return res;
}

const HINDI_NUMBER_WORDS = {
  ek: 1,
  do: 2,
  teen: 3,
  tin: 3,
  chaar: 4,
  char: 4,
  paanch: 5,
  panch: 5,
  chheh: 6,
  che: 6,
  cheh: 6,
  chhe: 6,
  chay: 6,
  chhey: 6,
  chhah: 6,
  chahe: 6,
  chhai: 6,
  saat: 7,
  sat: 7,
  aath: 8,
  ath: 8,
  nau: 9,
  no: 9,
  das: 10,
  dus: 10,
  gyarah: 11,
  barah: 12,
  bara: 12,
  terah: 13,
  chaudah: 14,
  pandrah: 15,
  solah: 16,
  satrah: 17,
  atharah: 18,
  unnees: 19,
  bees: 20,
  ikkees: 21,
  baaees: 22,
  teis: 23,
  chaubees: 24,
  pachees: 25,
  chhabees: 26,
  sattaees: 27,
  athaees: 28,
  untees: 29,
  tees: 30,
  iktees: 31,
  battees: 32,
  tentees: 33,
  chautees: 34,
  paintrees: 35,
  chhatees: 36,
  saintees: 37,
  adhtees: 38,
  untalees: 39,
  chaalees: 40,
  chalis: 40,
  iktaalees: 41,
  bayaalees: 42,
  tetalees: 43,
  chauwaalees: 44,
  paentaalees: 45,
  paintalis: 45,
  chhiyaalees: 46,
  saintaalees: 47,
  adhtaalees: 48,
  unchaas: 49,
  pachaas: 50,
  pachas: 50,
  pchas: 50,
  pchaas: 50,
  ikyawan: 51,
  baawan: 52,
  tirepan: 53,
  chauwan: 54,
  pachpan: 55,
  chhappan: 56,
  sattawan: 57,
  athaawan: 58,
  unsath: 59,
  saath: 60,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पाँच: 5,
  पांच: 5,
  छह: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  ग्यारह: 11,
  बारह: 12,
  तेरह: 13,
  चौदह: 14,
  पंद्रह: 15,
  सोलह: 16,
  सत्रह: 17,
  अठारह: 18,
  उन्नीस: 19,
  बीस: 20,
  इक्कीस: 21,
  बाईस: 22,
  तेईस: 23,
  चौबीस: 24,
  पच्चीस: 25,
  छब्बीस: 26,
  सत्ताईस: 27,
  अट्ठाईस: 28,
  उनतीस: 29,
  तीस: 30,
  इकतीस: 31,
  बत्तीस: 32,
  तैंतीस: 33,
  चौंतीस: 34,
  पैंतीस: 35,
  छत्तीस: 36,
  सैंतीस: 37,
  अड़तीस: 38,
  उनतालीस: 39,
  चालीस: 40,
  इकतालीस: 41,
  बयालीस: 42,
  तैंतालीस: 43,
  चवालीस: 44,
  पैंतालीस: 45,
  छियालीस: 46,
  सैंतालीस: 47,
  अड़तालीस: 48,
  उनचास: 49,
  पचास: 50,
  इक्यावन: 51,
  बावन: 52,
  तिरेपन: 53,
  चौवन: 54,
  पचपन: 55,
  छप्पन: 56,
  सत्तावन: 57,
  अट्ठावन: 58,
  उनसठ: 59,
  साठ: 60,
};

const WEEKDAY_NAMES = {
  somwar: 1,
  somvaar: 1,
  monday: 1,
  mon: 1,
  सोमवार: 1,
  mangalwar: 2,
  mangalvaar: 2,
  tuesday: 2,
  tue: 2,
  मंगलवार: 2,
  budhwar: 3,
  budhvaar: 3,
  wednesday: 3,
  wed: 3,
  बुधवार: 3,
  guruwar: 4,
  guruvaar: 4,
  veervar: 4,
  thursday: 4,
  thu: 4,
  गुरुवार: 4,
  वीरवार: 4,
  shukrawar: 5,
  shukravaar: 5,
  friday: 5,
  fri: 5,
  शुक्रवार: 5,
  shaniwar: 6,
  shanivaar: 6,
  saturday: 6,
  sat: 6,
  शनिवार: 6,
  ravivar: 0,
  ravivaar: 0,
  itwar: 0,
  sunday: 0,
  sun: 0,
  रविवार: 0,
  इतवार: 0,
};

// Check for deterministic skip phrases
const SKIP_PHRASES = [
  'koi nahi',
  'kuch nahi',
  'nahi',
  'nahi hai',
  'skip',
  'chhod do',
  'chhodo',
  'blank',
  'none',
  'no',
  'rehne do',
  'rahne do',
  'na',
  'koi nhi',
  'kuch nhi',
  'nhi',
  'नहीं',
  'कोई नहीं',
  'कुछ नहीं',
  'छोड़ दो',
  'छोड़ो',
  'खाली',
  'रहने दो',
];

const SKIP_ALL_PHRASES = [
  'baaki sab default',
  'baki sab default',
  'baaki default',
  'baki default',
  'baaki sab',
  'baki sab',
  'baaki sabhi',
  'baki sabhi',
  'baaki sabbha',
  'baki sabbha',
  'baaki sabh',
  'baki sabh',
  'bas itna hi',
  'bas itna',
  'bas',
  'baaki skip',
  'baki skip',
  'sab default',
  'all default',
  'बस इतना ही',
  'बस',
  'बाकी सब डिफ़ॉल्ट',
  'बाकी डिफ़ॉल्ट',
  'बाकी सब',
  'बाकी सभी',
];

const SELF_PHRASES = [
  'khud ke liye',
  'apne liye',
  'mere liye',
  'mujhe',
  'self',
  'me',
  'myself',
  'for me',
  'खुद के लिए',
  'अपने लिए',
  'मेरे लिए',
  'मैं',
];

function isSelfPhrase(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase().replace(/[.,!?;:]/g, '');
  if (!clean) return false;
  if (SELF_PHRASES.includes(clean)) return true;
  return SELF_PHRASES.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|\\P{L})${escaped}(?:\\P{L}|$)`, 'iu');
    return regex.test(clean);
  });
}

const FORBIDDEN_ASSIGNEE_NAMES = new Set([
  'me', 'myself', 'self', 'someone', 'anyone', 'mujhe', 'mujhko', 'kisi', 'sab', 'apne', 'khud',
  'shaam', 'sham', 'subah', 'subha', 'raat', 'dopahar', 'kal', 'aaj', 'parso', 'tarikh', 'tareekh',
  'din', 'baje', 'time', 'ek', 'do', 'teen', 'chaar', 'paanch', 'chhe', 'saat', 'aath', 'nau', 'das',
  'new', 'naya', 'naye', 'nayi', 'task', 'priority', 'status', 'project', 'co', 'ko', 'ka',
  'ki', 'ke', 'me', 'mein', 'mai', 'main', 'hai', 'ho', 'karo', 'banao', 'kar', 'do', 'kardo',
  'high', 'low', 'medium', 'urgent', 'pending', 'reminder', 'checkpoints', 'description', 'title'
]);

const DATE_WORDS_SET = new Set([
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may',
  'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september',
  'oct', 'october', 'nov', 'november', 'dec', 'december',
  'जनवरी', 'जन', 'फरवरी', 'फ़रवरी', 'फ़र', 'फर', 'मार्च', 'अप्रैल', 'अप्रेल',
  'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'सितम्बर', 'अक्टूबर', 'अक्टुबर', 'अक्टू',
  'नवंबर', 'नवम्बर', 'नव', 'दिसंबर', 'दिसम्बर', 'दिस',
  'today', 'tomorrow', 'yesterday', 'aaj', 'kal', 'parso', 'parson',
  'somwar', 'mangalwar', 'budhwar', 'guruwar', 'shukrawar', 'shaniwar', 'raviwar',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'tarikh', 'tareekh', 'date', 'dates', 'day', 'days', 'din', 'mahina', 'mahine',
  'month', 'months', 'year', 'years', 'saal', 'sal', 'hafta', 'hafte', 'week', 'weeks',
  'subah', 'sham', 'shaam', 'dopahar', 'raat', 'baje', 'time', 'am', 'pm'
]);

function isDateLikeToken(cand) {
  if (!cand || typeof cand !== 'string') return false;
  const clean = cand.trim().toLowerCase();
  // 1. Only digits and punctuation/whitespace: e.g. "2026", "3", "3/11/2026", "03-11-2026"
  if (/^[\d\s,.\/\-_:;]+$/.test(clean)) return true;
  // 2. Exact match in DATE_WORDS_SET
  if (DATE_WORDS_SET.has(clean)) return true;
  // 3. Every word is either a digit, ordinal (1st, 2nd, etc.), or a date word (e.g. "november 3", "3 november", "november 2026")
  const words = clean.split(/[\s,.\/\-_]+/).filter(Boolean);
  if (words.length > 0 && words.every(w => /^\d+(?:st|nd|rd|th)?$/i.test(w) || DATE_WORDS_SET.has(w))) {
    return true;
  }
  return false;
}

function isValidAssigneeCandidate(cand) {
  if (!cand || typeof cand !== 'string') return false;
  const clean = cand.trim().toLowerCase();
  if (clean.length < 2) return false;
  if (FORBIDDEN_ASSIGNEE_NAMES.has(clean)) return false;
  if (isDateLikeToken(clean)) return false;
  return true;
}

function cleanAssigneeName(name) {
  if (!name || typeof name !== 'string') return null;
  let clean = name.trim().replace(/^(?:task|assign(?:ed)?|karo|kardo|karna|kar\s*do|dena|de\s*do|bhejo|banao|haan|ha|yes|haanji|hnji)[,\s]+/i, '').trim();
  clean = clean.replace(/^(?:team\s+members?|team\s+member|members?|users?|teammates?)[,\s]+/i, '').trim();
  clean = clean.replace(/\s+(?:ko|co|koh|kor|ke\s+liye)$/i, '').trim();
  if (isDateLikeToken(clean)) return null;
  if (isValidAssigneeCandidate(clean)) {
    return clean;
  }
  return null;
}

// Separators for multiple assignees: aur, or, and, &, comma, plus, +, Devanagari और, तथा, tatha
const MULTI_NAME_SEP_REGEX = /(?:,\s*|\s+(?:and|aur|or|plus|tatha|और|तथा)\s+|\s*[&+]\s*)/iu;

function extractAssigneeMention(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();
  if (isSelfPhrase(clean)) return null;

  // If text contains multiple names/separators, single assignee extractor must not match
  if (MULTI_NAME_SEP_REGEX.test(clean)) return null;

  // 1. "assign to <Name>" or "task to <Name>"
  const assignToMatch = clean.match(/\b(?:assign(?:ed)?\s+to|task\s+to)\s+([a-zA-Z\u0900-\u097F]+(?:\s+[a-zA-Z\u0900-\u097F]+)?)/i);
  if (assignToMatch && assignToMatch[1]) {
    const cleaned = cleanAssigneeName(assignToMatch[1]);
    if (cleaned) return cleaned;
  }

  // 2. "<Name> (ko|core|co|koh|kor) task assign(ed) karo" or "<Name> (ko|core|co|koh|kor) assign" or "<Name> ko"
  const koMatch = clean.match(/([a-zA-Z\u0900-\u097F]{2,}(?:\s+[a-zA-Z\u0900-\u097F]{2,})?)\s+(?:ko|co|koh|kor|के|को)\b(?:\s+(?:ek\s+)?task)?(?:\s+(?:assign(?:ed)?|dena|de\s*do|bhejo|karo|banao))?/i);
  if (koMatch && koMatch[1]) {
    const cleaned = cleanAssigneeName(koMatch[1]);
    if (cleaned) return cleaned;
  }

  // 3. "<Name> task assign(ed) karo" (without particle)
  const taskAssignMatch = clean.match(/([a-zA-Z\u0900-\u097F]{2,})\s+(?:ek\s+)?task\s+assign(?:ed)?(?:\s+(?:karo|kardo|karna|kariye))?/i);
  if (taskAssignMatch && taskAssignMatch[1]) {
    const cleaned = cleanAssigneeName(taskAssignMatch[1]);
    if (cleaned) return cleaned;
  }

  // 4. "task assign(ed) karo <Name> ko" or "task assign(ed) karo <Name>"
  const assignKaroMatch = clean.match(/\b(?:task\s+)?assign(?:ed)?\s+(?:karo|kar\s*do|kardo|karna)\s+([a-zA-Z\u0900-\u097F]{2,})(?:\s+(?:ko|co|koh|ke\s+liye))?/i);
  if (assignKaroMatch && assignKaroMatch[1]) {
    const cleaned = cleanAssigneeName(assignKaroMatch[1]);
    if (cleaned) return cleaned;
  }

  // 5. "<Name> ke liye"
  const keLiyeMatch = clean.match(/([a-zA-Z\u0900-\u097F]{2,}(?:\s+[a-zA-Z\u0900-\u097F]{2,})?)\s+ke\s+liye\b/i);
  if (keLiyeMatch && keLiyeMatch[1]) {
    const cleaned = cleanAssigneeName(keLiyeMatch[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

/**
 * Deterministically extracts multiple assignee names or edit intents (add/remove) from text.
 * Splits on 'aur', 'or', 'and', ',', '&', 'plus', '+', 'और', 'tatha', 'तथा'.
 * Deduplicates names and avoids LLM hallucination.
 */
function extractMultipleAssignees(text) {
  if (!text || typeof text !== 'string') return { names: [], editAction: null };
  const clean = text.trim();
  if (isSelfPhrase(clean)) return { names: [], editAction: null };

  // 1. Edit Action - Removal: "Rahul ko hata do", "Rahul ko remove karo", "Divya ko chhod do"
  const removeMatch = clean.match(/(?:^|\b)([a-zA-Z\u0900-\u097F]{2,}(?:\s+(?!ko\b)[a-zA-Z\u0900-\u097F]{2,})?)\s+(?:ko\s+)?(?:hata\s*do|remove\s*karo|hatao|nikaal\s*do|mat\s*assign\s*karo|mat\s*rakho|nahi\s*chahiye|chhod\s*do|chhod\s*dein|chhor\s*do|drop\s*karo|drop|rehne\s*do|rehnde\s*do)\b/i);
  if (removeMatch && removeMatch[1]) {
    const cleaned = cleanAssigneeName(removeMatch[1]);
    if (cleaned) {
      return { names: [], editAction: { type: 'remove', name: cleaned } };
    }
  }

  // 2. Edit Action - Addition: "Simran ko bhi add karo", "Simran ko add karo", "Simran ko bhi assign karo"
  const addMatch = clean.match(/(?:^|\b)([a-zA-Z\u0900-\u097F]{2,}(?:\s+[a-zA-Z\u0900-\u097F]{2,})?)\s+(?:ko\s+)?(?:(?:bhi\s+(?:add|assign|jodo|daal|include)\s*(?:karo|do)?)|(?:add\s*karo|jodo|include\s*karo))\b/i);
  if (addMatch && addMatch[1] && !clean.includes('hata')) {
    const cleaned = cleanAssigneeName(addMatch[1]);
    if (cleaned) {
      return { names: [cleaned], editAction: { type: 'add', name: cleaned } };
    }
  }

  // 3. Multi-name extraction from sentence
  let candidateSegment = null;

  const assignToMatch = clean.match(/\b(?:assign(?:ed)?\s+to|task\s+to)\s+([a-zA-Z\u0900-\u097F\s,&+]+?)(?=\s+(?:due|kal|aaj|priority|status|description|checkpoints|$))/i);
  if (assignToMatch && assignToMatch[1]) {
    candidateSegment = assignToMatch[1];
  } else {
    const koMatch = clean.match(/(?:^|\s)([a-zA-Z\u0900-\u097F\s,&+]+?)\s+(?:ko|co|koh|kor|core|cor|के|को)\b/i);
    if (koMatch && koMatch[1]) {
      candidateSegment = koMatch[1];
    } else {
      const keLiyeMatch = clean.match(/(?:^|\s)([a-zA-Z\u0900-\u097F\s,&+]+?)\s+ke\s+liye\b/i);
      if (keLiyeMatch && keLiyeMatch[1]) {
        candidateSegment = keLiyeMatch[1];
      } else if (!/(?:task\s+ka\s+naam|title|description|due\s+date|priority|status|reminder)/i.test(clean) && (clean.includes(',') || clean.includes('&') || clean.includes('+') || clean.includes('और') || clean.includes('तथा') || /\b(?:and|aur|or|plus|tatha)\b/i.test(clean))) {
        candidateSegment = clean;
      }
    }
  }

  if (candidateSegment) {
    candidateSegment = candidateSegment
      .replace(/.*?\b(?:team\s+members?|members?)\s*(?:honge|mein|me|ko|hain)?\s*/iu, '')
      .replace(/.*?\b(?:project|प्रोजेक्ट)?\s*\b(?:mein|me|mai|main|में|ke\s+andar|के\s+अंदर)\b\s*[,:\s]*/iu, '')
      .replace(/^(?:task\s+)?(?:assign(?:ed)?\s+(?:karo|kar\s*do|kardo)?|ek\s+task\s+assign\s+karo)\s*/iu, '');

    const tokens = candidateSegment.split(MULTI_NAME_SEP_REGEX);
    const seen = new Set();
    const resultNames = [];

    const nonNames = new Set([
      'task', 'assign', 'assigned', 'karo', 'kardo', 'banao', 'create', 'ek',
      'mera', 'meri', 'self', 'apne', 'apna', 'ko', 'to', 'do', 'de', 'dena',
      'project', 'mein', 'me', 'mai', 'main', 'में', 'प्रोजेक्ट', 'demo',
      'andar', 'ka', 'ki', 'ke', 'in', 'inside', 'hai', 'hain',
      'team', 'member', 'members',
      'or', 'aur', 'and', 'plus', 'tatha', 'और', 'तथा'
    ]);

    for (const rawToken of tokens) {
      const cleaned = cleanAssigneeName(rawToken.replace(/^(?:to|ko|mai|mein|me)\s+/i, ''));
      if (cleaned && cleaned.length >= 2 && !nonNames.has(cleaned.toLowerCase()) && !isSelfPhrase(cleaned)) {
        const lower = cleaned.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          resultNames.push(cleaned);
        }
      }
    }

    if (resultNames.length > 0) {
      return { names: resultNames, editAction: null };
    }
  }

  // Fallback to single assignee extractor
  const singleMention = extractAssigneeMention(clean);
  if (singleMention) {
    return { names: [singleMention], editAction: null };
  }

  return { names: [], editAction: null };
}

function isSkip(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase().replace(/[.,!?;:]/g, '');

  // If message contains substantive field commands or time/slot details, it is NOT a field skip
  const hasSubstantiveContent = /(?:title|naam|नाम|description|विवरण|priority|प्रायोरिटी|status|स्टेटस|due|time|samay|समय|date|tareekh|tarikh|तारीख|baje|बजे|baaj|baj|bach|minute|min|मिनट|hour|ghanta|घंटा|high|low|medium|urgent|pending|completed|change|badal|badlo|बदलो|rakhna|rakho|रखो|रखना)/iu.test(clean);
  if (hasSubstantiveContent) return false;

  return SKIP_PHRASES.some(phrase => clean === phrase || clean.startsWith(phrase + ' ') || clean.endsWith(' ' + phrase));
}

function isSkipAll(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim().toLowerCase().replace(/[.,!?;:]/g, '');
  return SKIP_ALL_PHRASES.some(phrase => clean === phrase || clean.startsWith(phrase + ' ') || clean.endsWith(' ' + phrase));
}

/**
 * Format a Date object to ISO-8601 string with +05:30 IST offset.
 */
function toIstIsoString(date) {
  const istTimeMs = date.getTime() + (IST_OFFSET_MINUTES * 60 * 1000);
  const istDate = new Date(istTimeMs);
  const pad = num => String(num).padStart(2, '0');
  const yyyy = istDate.getUTCFullYear();
  const mm = pad(istDate.getUTCMonth() + 1);
  const dd = pad(istDate.getUTCDate());
  const hh = pad(istDate.getUTCHours());
  const min = pad(istDate.getUTCMinutes());
  const ss = pad(istDate.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`;
}

/**
 * Parse date & time from Hinglish/Devanagari text.
 * Reference `now` can be passed for deterministic testing.
 * If referenceDate is provided and no new date offset is found in text, the scheduled date is preserved.
 */
function parseHinglishDateTime(rawText, now = new Date(), referenceDate = null) {
  if (!rawText || typeof rawText !== 'string') return null;

  const normalizedRaw = normalizeTranscript(rawText);
  let text = normalizeDigits(normalizedRaw.toLowerCase());

  // Remove common speech-to-text noise tokens before date markers (e.g. "due date, jn tomorrow 10:10 am")
  text = text.replace(/\b(?:due\s+date|deadline|due|by|tak|tk)[\s,:]*(?:jn|jan|ok|so|uh|um)\b/gi, ' ');
  text = text.replace(/\b(?:jn|jan|ok|so|uh|um)\s+(tomorrow|today|kal|aaj|parso|tonight)\b/gi, '$1');

  // Current IST parts
  const currentUtcMs = now.getTime();
  const nowIst = new Date(currentUtcMs + IST_OFFSET_MINUTES * 60 * 1000);

  let baseIst = nowIst;
  if (referenceDate) {
    const refMs = new Date(referenceDate).getTime();
    if (!isNaN(refMs)) {
      baseIst = new Date(refMs + IST_OFFSET_MINUTES * 60 * 1000);
    }
  }

  let targetYear = baseIst.getUTCFullYear();
  let targetMonth = baseIst.getUTCMonth(); // 0-indexed
  let targetDate = baseIst.getUTCDate();
  let dayOffsetFound = false;
  let isTonight = false;

  // In N hours check: "in 2 hours", "in 3 ghante"
  const inHoursMatch = text.match(/\bin\s+(\d+)\s*(?:hours?|hrs?|ghante?|घंटे)\b/i);
  if (inHoursMatch) {
    const hoursToAdd = parseInt(inHoursMatch[1], 10);
    const targetWithHours = new Date(nowIst.getTime() + hoursToAdd * 60 * 60 * 1000);
    return toIstIsoString(new Date(targetWithHours.getTime() - IST_OFFSET_MINUTES * 60 * 1000));
  }

  // 1. Day keywords (including English, Hinglish, STT typos, and Devanagari)
  // Day after tomorrow / Parso / Parson / परसों
  if (/(?:^|\P{L})(day\s+after\s+tomorrow|parso|parson|परसों)(?:\P{L}|$)/iu.test(text)) {
    targetDate += 2;
    dayOffsetFound = true;
  }
  // Tomorrow / Kal / Cal / Kl / कल
  else if (/(?:^|\P{L})(tomorrow|kal|cal|kl|कल)(?:\P{L}|$)/iu.test(text)) {
    targetDate += 1;
    dayOffsetFound = true;
  }
  // Today / Aaj / Tonight / आज (Strict whole-word match preventing combining marks like 'ी' from matching boundary)
  else if (/(?<![\p{L}\p{M}])(today|aaj|tonight|आज)(?![\p{L}\p{M}])/iu.test(text)) {
    dayOffsetFound = true;
    if (/(?:^|\P{L})tonight(?:\P{L}|$)/iu.test(text)) {
      isTonight = true;
    }
  }
  // N din baad / N days later / in N days
  const nDaysMatch = text.match(/(?:in\s+)?(\d+)\s*(din|days?|दिन)\s*(?:baad|later|के बाद)?/iu);
  if (nDaysMatch && (text.includes('baad') || text.includes('later') || text.includes('in ') || text.includes('के बाद'))) {
    targetDate += parseInt(nDaysMatch[1], 10);
    dayOffsetFound = true;
  }

  // Weekdays check
  if (!dayOffsetFound) {
    for (const [wName, wDayIndex] of Object.entries(WEEKDAY_NAMES)) {
      const regex = new RegExp(`(?:^|\\P{L})(?:next\\s+)?${wName}(?:\\P{L}|$)`, 'iu');
      if (regex.test(text)) {
        const currentDay = nowIst.getUTCDay();
        let diff = wDayIndex - currentDay;
        if (diff <= 0 || text.includes('next ' + wName)) {
          if (diff <= 0) diff += 7; // next occurrence
        }
        targetDate += diff;
        dayOffsetFound = true;
        break;
      }
    }
  }

  // Next week / Agle hafte
  if (!dayOffsetFound && /(?:^|\P{L})(next\s+week|agle\s+hafte|अगले\s+हफ्ते)(?:\P{L}|$)/iu.test(text)) {
    targetDate += 7;
    dayOffsetFound = true;
  }

  // 2. Time & Period extraction
  let hour = null;
  let minute = 0;
  let period = null; // 'am' | 'pm'

  // Subah / morning / am
  if (/(?:^|\P{L})(subah|subha|morning|am|pratah|सवेरे|सुबह|प्रातः)(?:\P{L}|$)/u.test(text)) {
    period = 'am';
  }
  // Dopahar / afternoon
  else if (/(?:^|\P{L})(dopahar|dophar|afternoon|दोपहर)(?:\P{L}|$)/u.test(text)) {
    period = 'pm';
  }
  // Shaam / evening
  else if (/(?:^|\P{L})(shaam|sham|evening|शाम|सांझ)(?:\P{L}|$)/u.test(text)) {
    period = 'pm';
  }
  // Raat / night
  else if (/(?:^|\P{L})(raat|night|रात)(?:\P{L}|$)/u.test(text)) {
    period = 'pm';
  }

  // Check special phrases: dedh (1:30), dhai (2:30), saade X (X:30), sawa X (X:15), paune X ((X-1):45)
  if (/(?:^|\P{L})(dedh|dhed|डेढ़)(?:\P{L}|$)/u.test(text)) {
    hour = 1;
    minute = 30;
  } else if (/(?:^|\P{L})(dhai|dhaai|ढाई)(?:\P{L}|$)/u.test(text)) {
    hour = 2;
    minute = 30;
  } else {
    const saadeMatch = text.match(/(?:^|\P{L})(?:saadhe|sadhe|saade|sade|साढ़े|साढे|साड़े)\s+(\w+|\d+)(?:\s*(?:baje|बजे|o'?clock))?(?:\P{L}|$)/iu);
    if (saadeMatch) {
      const rawH = saadeMatch[1].toLowerCase();
      const parsedH = HINDI_NUMBER_WORDS[rawH] !== undefined ? HINDI_NUMBER_WORDS[rawH] : parseInt(rawH, 10);
      if (!isNaN(parsedH) && parsedH >= 1 && parsedH <= 24) {
        hour = parsedH;
        minute = 30;
      }
    }
    const sawaMatch = text.match(/(?:^|\P{L})(?:sawa|सवा)\s+(\w+|\d+)(?:\s*(?:baje|बजे|o'?clock))?(?:\P{L}|$)/iu);
    if (sawaMatch && hour === null) {
      const rawH = sawaMatch[1].toLowerCase();
      const parsedH = HINDI_NUMBER_WORDS[rawH] !== undefined ? HINDI_NUMBER_WORDS[rawH] : parseInt(rawH, 10);
      if (!isNaN(parsedH) && parsedH >= 1 && parsedH <= 24) {
        hour = parsedH;
        minute = 15;
      }
    }
    const pauneMatch = text.match(/(?:^|\P{L})(?:paune|पौने)\s+(\w+|\d+)(?:\s*(?:baje|बजे|o'?clock))?(?:\P{L}|$)/iu);
    if (pauneMatch && hour === null) {
      const rawH = pauneMatch[1].toLowerCase();
      const parsedH = HINDI_NUMBER_WORDS[rawH] !== undefined ? HINDI_NUMBER_WORDS[rawH] : parseInt(rawH, 10);
      if (!isNaN(parsedH) && parsedH >= 1 && parsedH <= 24) {
        hour = parsedH - 1;
        minute = 45;
      }
    }
  }

  // Check numeric or standard time patterns if hour not yet resolved:
  // e.g. "10:10 am", "10:00", "10:30", "6.50 pm", "6.50 p.m.", "5 : 30", "5: 30"
  if (hour === null) {
    const colonMatch = text.match(/\b(\d{1,2})\s*[:.]\s*(\d{1,2})\s*(a\.?m\.?|p\.?m\.?|am|pm)?\b/i);
    if (colonMatch) {
      hour = parseInt(colonMatch[1], 10);
      minute = parseInt(colonMatch[2], 10);
      if (colonMatch[3]) {
        period = colonMatch[3].toLowerCase().replace(/\./g, '');
      }
    }
  }

  // Space-separated time e.g. "5 30 pm", "5 30 baje", "time 5 30", "5 30"
  if (hour === null) {
    const spaceTimeMatch = text.match(/\b([1-9]|1[0-2])\s+([0-5]\d)\s*(a\.?m\.?|p\.?m\.?|am|pm)?\b/i);
    if (spaceTimeMatch) {
      hour = parseInt(spaceTimeMatch[1], 10);
      minute = parseInt(spaceTimeMatch[2], 10);
      if (spaceTimeMatch[3]) {
        period = spaceTimeMatch[3].toLowerCase().replace(/\./g, '');
      }
    }
  }

  // Hindi word combinations for hour + minute e.g. "paanch tees" (5:30), "chaar pandrah" (4:15), "पांच तीस", "सात दस"
  if (hour === null) {
    const wordTimeMatch = text.match(/(?:^|\P{L})(ek|do|teen|tin|chaar|char|paanch|panch|chheh|chhe|che|chay|chhey|saat|sat|aath|ath|nau|no|das|dus|gyarah|barah|एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|ग्यारह|बारह)\s+(paanch|panch|पांच|पाँच|das|dus|दस|pandrah|bees|pachees|tees|paintrees|chaalees|chalis|paintalis|paentaalees|pachaas|pachas|pchas|pchaas|pachpan|पंद्रह|बीस|पच्चीस|तीस|पैंतीस|चालीस|पैंतालीस|पचास|पचपन)(?:\P{L}|$)/iu);
    if (wordTimeMatch) {
      const hVal = wordTimeMatch[1].toLowerCase();
      const mVal = wordTimeMatch[2].toLowerCase();
      const parsedH = HINDI_NUMBER_WORDS[hVal] !== undefined ? HINDI_NUMBER_WORDS[hVal] : parseInt(hVal, 10);
      const parsedM = HINDI_NUMBER_WORDS[mVal] !== undefined ? HINDI_NUMBER_WORDS[mVal] : parseInt(mVal, 10);
      if (!isNaN(parsedH) && !isNaN(parsedM)) {
        hour = parsedH;
        minute = parsedM;
      }
    }
  }

  // "7 baaj kar 10 min", "6 bach kar 50 minute", "7 baj kar 10 minute", "7 bajke 10 minute", "7 bajkar 10 min", "7 baje 10 minute", "7 बजकर 10 मिनट", "7 बजके 10 मिनट", "6 बज़ कर 10 मिनट"
  if (hour === null) {
    const bajKarMinMatch = text.match(/(\d{1,2}|[a-z\u0900-\u097F]+)\s*(?:baaj\s*(?:kar|ke)|bachkar|bachke|bajkar|bajke|baje|ब[ज़ज]\u093C?े|ब[ज़ज]\u093C?कर|ब[ज़ज]\u093C?के|ब[ज़ज]\u093C?\s+(?:कर|के)|बचकर|बचके|baj\s+(?:kar|ke)|bach\s+(?:kar|ke)|baaj\b|baj\b|bach\b|ब[ज़ज]\u093C?)\s*(\d{1,2}|[a-z\u0900-\u097F]+)\s*(?:min(?:ute)?s?|m|मिनट)?/iu);
    if (bajKarMinMatch) {
      const hVal = bajKarMinMatch[1].toLowerCase();
      const mVal = bajKarMinMatch[2].toLowerCase();
      const parsedH = HINDI_NUMBER_WORDS[hVal] !== undefined ? HINDI_NUMBER_WORDS[hVal] : parseInt(hVal, 10);
      const parsedM = HINDI_NUMBER_WORDS[mVal] !== undefined ? HINDI_NUMBER_WORDS[mVal] : parseInt(mVal, 10);
      if (!isNaN(parsedH) && parsedH >= 1 && parsedH <= 24 && !isNaN(parsedM) && parsedM >= 0 && parsedM <= 59) {
        hour = parsedH;
        minute = parsedM;
      }
    }
  }

  // "X bajne me Y minute" / "X bajne me Y minute baaki" (e.g. 7 bajne me 10 minute = 6:50)
  if (hour === null) {
    const bajneMeMatch = text.match(/(\d{1,2}|[a-z\u0900-\u097F]+)\s*(?:bajne\s*(?:me|mein)|ब[ज़ज]\u093C?ने\s*में)\s*(\d{1,2}|[a-z\u0900-\u097F]+)\s*(?:min(?:ute)?s?|m|मिनट)/iu);
    if (bajneMeMatch) {
      const hVal = bajneMeMatch[1].toLowerCase();
      const mVal = bajneMeMatch[2].toLowerCase();
      const parsedH = HINDI_NUMBER_WORDS[hVal] !== undefined ? HINDI_NUMBER_WORDS[hVal] : parseInt(hVal, 10);
      const parsedM = HINDI_NUMBER_WORDS[mVal] !== undefined ? HINDI_NUMBER_WORDS[mVal] : parseInt(mVal, 10);
      if (!isNaN(parsedH) && !isNaN(parsedM) && parsedM >= 0 && parsedM <= 59) {
        hour = parsedH - 1;
        minute = 60 - parsedM;
      }
    }
  }

  if (hour === null) {
    // "10 am" / "10 pm" / "6pm" / "6 p.m."
    const ampmMatch = text.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i);
    if (ampmMatch) {
      hour = parseInt(ampmMatch[1], 10);
      period = ampmMatch[2].toLowerCase().replace(/\./g, '');
    }
  }

  if (hour === null) {
    // "10 baje" or "10 बजे" or "10 बज़े" or "10 baaj" or "10 bach"
    const bajeMatch = text.match(/(\d{1,2}|[a-z\u0900-\u097F]+)\s*(?:baje|baaj|baj|bach|ब[ज़ज]\u093C?े|ब[ज़ज]\u093C?|o'?clock)/iu);
    if (bajeMatch) {
      const val = bajeMatch[1].toLowerCase();
      hour = HINDI_NUMBER_WORDS[val] !== undefined ? HINDI_NUMBER_WORDS[val] : (parseInt(val, 10) || null);
    }
  }

  // Bare number check if followed by subah/shaam e.g. "subah 10" or "10 subah"
  if (hour === null && period !== null) {
    const nearPeriodMatch = text.match(/(?:subah|subha|shaam|sham|dopahar|raat|सुबह|शाम|दोपहर|रात)\s*(\d{1,2})\b/iu) ||
                            text.match(/\b(\d{1,2})\s*(?:subah|subha|shaam|sham|dopahar|raat|सुबह|शाम|दोपहर|रात)/iu);
    if (nearPeriodMatch) {
      hour = parseInt(nearPeriodMatch[1], 10);
    }
  }

  // If no date and no time matched at all, return null
  if (!dayOffsetFound && hour === null) {
    return null;
  }

  // Default hour if day was mentioned without hour: default to 18:00 IST (shaam 6 baje) or 20:00 for tonight
  if (hour === null) {
    hour = isTonight ? 20 : 18;
    minute = 0;
  } else {
    // Adjust hour for period (am / pm)
    if (period === 'pm' && hour < 12) {
      hour += 12;
    } else if (period === 'am' && hour === 12) {
      hour = 0;
    } else if (period === null && hour < 8) {
      // Natural bare hour assumption: hours 1 to 7 are usually PM in business context
      hour += 12;
    }
  }

  // Create final target date object in IST
  // Construct UTC milliseconds for IST timestamp
  const targetUtcMs = Date.UTC(targetYear, targetMonth, targetDate, hour, minute, 0) - (IST_OFFSET_MINUTES * 60 * 1000);
  const targetDateObj = new Date(targetUtcMs);

  return toIstIsoString(targetDateObj);
}

/**
 * Deterministically extract title, description, priority, etc. from common Hinglish patterns.
 */
function parseHinglishSlots(rawText, now = new Date(), referenceDate = null) {
  if (!rawText || typeof rawText !== 'string') return {};

  const normalizedRaw = normalizeTranscript(rawText);
  const text = normalizedRaw.trim();
  const normalized = normalizeDigits(text);
  const slots = {};

  // 1. Title Extraction:
  // Support: "task name/naam (is|ka naam|:) X", "title (is|:) X", "name it X", "call it X", "task (is|:) X", "naam X"
  const stopKeywords = '(?=[.,;]?\\s*(?:status|स्टेटस|description|details|vivaran|विवरण|डिस्क्रिप्शन|priority|प्रायोरिटी|due\\s+date|due|deadline|reminder|रिमाइंडर|repeat|checkpoints?|aur|and|uska|uski|उसका|उसकी|इसका|इसकी|attach|vah|woh|\\bby\\b|kal|cal|kl|aaj|today|tomorrow|parso)|\\.\\s+|$)';
  const titleRegexes = [
    new RegExp(`(?:(?:urgent\\s+)?(?:ek\\s+)?(?:naya\\s+)?task\\s*(?:banao|create\\s+karo|karo|bana\\s*do|banayein|create)\\s*:\\s*)(.+?)${stopKeywords}`, 'i'),
    new RegExp(`^(.+?)(?:\\s+(?:ka|ke\\s+liye)\\s+(?:ek\\s+)?task\\s+(?:banao|create\\s+karo|karo|bana\\s*do|banayein))${stopKeywords}`, 'i'),
    new RegExp(`(?:^|\\b)(?:(?:mera|meri|mere|hamara|hamari|hamare|apna|apni|apne)\\s+(?:liye\\s+)?)?(?:ek\\s+)?(?:naya\\s+|nayi\\s+)?\\b(?!(?:ek|naya|nayi|naye|mera|meri|mere|liye|hamara|hamari|hamare|apna|apni|apne|kisi|kripya|please|ka|ke|ki|urgent|quick)\\b)([a-zA-Z\\u0900-\\u097F0-9_-]+(?:\\s+[a-zA-Z\\u0900-\\u097F0-9_-]+)*)\\s+task\\s+(?:banao|create\\s+karo|karo|bana\\s*do|bana\\s*dijiye|banayein|create)${stopKeywords}`, 'i'),
    new RegExp(`(?:(?:task\\s+)?(?:title|naam|नाम)\\s*(?:badlo|badal\\s+kar|change\\s+karo|change\\s+to|change|बदलो)\\s*(?:to|ko|kar)?\\s*)(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:(?:and\\s+|aur\\s+)?task\\s+(?:name|naam)\\s*(?:is\\s+|ka\\s+naam\\s+|:\\s*|\\s+as\\s+|\\s+to\\s+be\\s+)?)(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:(?:task\\s+)?title\\s*(?:is\\s+|:\\s*|\\s+as\\s+|\\s+to\\s+be\\s+|hai\\s+|hoga\\s+)?)(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:name\\s+it\\s+|call\\s+it\\s+)(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:task\\s*(?:is\\s+|:\\s*))(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:(?:task\\s+)?(?:ka\\s+)?naam\\s*(?:badal\\s*kar|badlo|karo)?\\s*(?:hai\\s+|:\\s*|is\\s+|hoga\\s+)?)(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:(?:uska|iska|उसका|इसका)?\\s*(?:naam|नाम|title)\\s*(?:badal\\s*kar|badlo|rakho|rakhein|rakhna|रखो|रखें|रखना|hai|is|:)?(?:[\\s,:]*))(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:(?:title|naam|नाम)\\s*(?:badlo|badal\\s*kar|badal\\s*do|change\\s*karo|change\\s*kar\\s*do|बदलो)\\s*[,:]?\\s*)(.+?)${stopKeywords}`, 'i'),
    new RegExp(`(?:uska\\s+naam\\s+(?:yah\\s+|yeh\\s+)?)(.+?)${stopKeywords}`, 'i'),
  ];

  for (const regex of titleRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]) {
      let t = match[1].trim();
      t = t.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
      t = t.replace(/^(yah|yeh|is)\s+/i, '');
      t = t.replace(/\s+(ho|hoga|rakhna|hai|rakhein|karo|kar\s+do|करो|कर\s+दो)$/i, '');
      t = t.replace(/\s+(ka|ke|ki)$/i, '');
      t = t.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
      if (t.length > 0 && t.length <= 100 && !/^(task|create|banana|hai|is|ek|naya|nayi|naye|mera|meri|mere|liye|hamare|hamara|apne|apna|khud)$/i.test(t)) {
        slots.title = t.charAt(0).toUpperCase() + t.slice(1);
        break;
      }
    }
  }

  // 2. Description Extraction:
  // Support: "description (is|:|,)? Y", "details Y", "uska description Y"
  const descStopKeywords = '(?=[.,;]?\\s*(?:status|स्टेटस|priority|प्रायोरिटी|due\\s+date|due|deadline|reminder|रिमाइंडर|repeat|checkpoints|aur|and|cal|kal|today|tomorrow|start\\s+date|end\\s+date|shuru|khatam|complete|members?|team\\s+members?|\\b\\d{1,2}\\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b|attach|\\bby\\b|uska|uski|उसका|उसकी|इसका|इसकी)|\\.\\s*(?:status|priority|due|deadline|reminder|repeat|kal|aaj|today|tomorrow)|\\.\\s+|$)';
  const descRegexes = [
    new RegExp(`(?:(?:uska|iska|उसका|इसका)?\\s*(?:description|विवरण|डिस्क्रिप्शन)\\s*(?:rakho|rakhein|रखो|रखें|rakhna|is|:\\s*|\\s*,\\s*|as\\s+|to\\s+be\\s+|hai\\s+|hoga\\s+|\\s+yah\\s+|\\s+yeh\\s+)?(?:[\\s,:]*))(.+?)${descStopKeywords}`, 'i'),
    new RegExp(`(?:(?:uska\\s+)?details\\s*(?:is\\s+|:\\s*|\\s*,\\s*|as\\s+|to\\s+be\\s+|hai\\s+|hoga\\s+)?)(.+?)${descStopKeywords}`, 'i'),
    new RegExp(`(?:(?:uska\\s+)?vivaran\\s*(?:hai\\s+|:\\s*|\\s*,\\s*|hoga\\s+)?)(.+?)${descStopKeywords}`, 'i'),
  ];

  for (const regex of descRegexes) {
    const match = normalized.match(regex);
    if (match && match[1]) {
      let d = match[1].trim();
      d = d.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
      d = d.replace(/^(yah|yeh|is)\s+/i, '');
      d = d.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
      if (d.length > 0 && d.length <= 500) {
        slots.description = d.charAt(0).toUpperCase() + d.slice(1);
        break;
      }
    }
  }

  // 3. Priority Extraction
  const prioMatch = normalized.match(/(?:priority|प्रायोरिटी)\s*(?:is\s+|:\s*|\s*=\s*|rakho\s+|rakhein\s+|रखो\s+|रखें\s+)?\s*(low|medium|high|urgent|लो|मीडियम|हाई)\b/i);
  if (prioMatch && prioMatch[1]) {
    const rawVal = prioMatch[1].toLowerCase();
    let pVal = rawVal;
    if (rawVal === 'हाई' || rawVal === 'urgent') pVal = 'high';
    else if (rawVal === 'मीडियम') pVal = 'medium';
    else if (rawVal === 'लो') pVal = 'low';
    slots.priority = pVal;
  } else if (/\b(high|urgent)\s+priority\b/i.test(normalized) || /\b(urgent|high|urgent\s+hai|bahut\s+zaroori|jaruri|zaroori)\b/i.test(normalized) || /(?:प्रायोरिटी\s*[:=\s]*हाई|हाई\s*प्रायोरिटी|जरूरी|ज़रूरी|अति\s*आवश्यक)/u.test(normalized)) {
    slots.priority = 'high';
  } else if (/\blow\s+priority\b/i.test(normalized) || /\b(low|kam\s+priority|halka)\b/i.test(normalized) || /(?:प्रायोरिटी\s*[:=\s]*लो|लो\s*प्रायोरिटी|कम\s*प्रायोरिटी)/u.test(normalized)) {
    slots.priority = 'low';
  } else if (/\bmedium\s+priority\b/i.test(normalized) || /\b(medium|normal|theek\s+thaak)\b/i.test(normalized) || /(?:प्रायोरिटी\s*[:=\s]*मीडियम|मीडियम)/u.test(normalized)) {
    slots.priority = 'medium';
  }

  // 3b. Status Extraction
  const statusMatch = normalized.match(/(?:task\s+)?(?:status|स्टेटस)\s*(?:is\s+|:\s*|\s*=\s*|rakho\s+|rakhein\s+|रखो\s+|रखें\s+|hoga\s+|chahiye\s+)?\s*(in\s*progress|inprogress|in-progress|completed|complete|done|khatam|on\s*hold|onhold|rejected|cancelled|cancel|overdue|reopen|pending|पेंडिंग|चालू|कम्प्लीट|पूरा|होल्ड|रद्द|खारिज)\b/i);
  if (statusMatch && statusMatch[1]) {
    const rawStatus = statusMatch[1].toLowerCase().replace(/[\s_]/g, '-');
    if (rawStatus.includes('progress') || rawStatus.includes('चालू')) {
      slots.status = 'in-progress';
    } else if (rawStatus.includes('complet') || rawStatus === 'done' || rawStatus === 'khatam' || rawStatus.includes('कम्प्लीट') || rawStatus.includes('पूरा')) {
      slots.status = 'completed';
    } else if (rawStatus.includes('hold') || rawStatus.includes('होल्ड')) {
      slots.status = 'onhold';
    } else if (rawStatus.includes('reject') || rawStatus.includes('खारिज')) {
      slots.status = 'rejected';
    } else if (rawStatus.includes('cancel') || rawStatus.includes('रद्द')) {
      slots.status = 'cancelled';
    } else if (rawStatus.includes('overdue')) {
      slots.status = 'overdue';
    } else if (rawStatus.includes('reopen')) {
      slots.status = 'reopen';
    } else {
      slots.status = 'pending';
    }
  } else if (/\b(?:status\s+)?(in\s*progress|inprogress|work\s+in\s+progress|इन\s*प्रोग्रेस)\b/i.test(normalized)) {
    slots.status = 'in-progress';
  } else if (/\b(?:status\s+)?(on\s*hold|onhold|ऑन\s*होल्ड)\b/i.test(normalized)) {
    slots.status = 'onhold';
  } else if (/\b(?:status\s+)?(completed|complete|done|khatam|कम्प्लीट)\s+status\b/i.test(normalized) || /\bstatus\s*(?:is|:|=)?\s*(?:completed|complete|done)\b/i.test(normalized)) {
    slots.status = 'completed';
  } else if (/\b(?:status\s+)?(pending|पेंडिंग)\s+status\b/i.test(normalized) || /\bstatus\s*(?:is|:|=)?\s*(?:pending|पेंडिंग)\b/i.test(normalized)) {
    slots.status = 'pending';
  }

  // 4. Reminder Extraction
  if (
    /\b(?:reminder|रिमाइंडर|yaad|याद)\s*(?:is|:)?\s*(?:off|band|mat\s+lagao|nahi|no|koi\s+bhi\s+nahi|कोई\s+भी\s+नहीं|unhe\s+karna)\b/i.test(normalized) ||
    /(?:reminder|रिमाइंडर|yaad|याद)\s+(?:koi\s+bhi\s+|कोई\s+भी\s+)?(?:nahi|नहीं|नी|ni|na)\s*(?:chahiye|चाहिए|karna|करना|rakhna|lagana)?/iu.test(normalized) ||
    /\b(?:off|band|mat\s+lagao|no|nahi|नहीं)\s+(?:chahiye\s+|चाहिए\s+)?(?:reminder|रिमाइंडर|yaad|याद)/iu.test(normalized) ||
    /(?:रिमाइंडर\s*(?:ऑफ|बंद|मत\s*लगाओ|नहीं|ना))/u.test(normalized)
  ) {
    slots.reminder = false;
    slots.reminderOption = null;
    slots.repeatIntervalMinutes = null;
    slots.minutesBeforeDue = null;
    slots.customTime = null;
    slots.reminderTime = null;
  } else {
    const parseNumberWord = (val) => {
      if (!val) return null;
      const lower = String(val).toLowerCase().trim();
      const n = parseInt(lower, 10);
      if (!isNaN(n)) return n;
      const map = {
        one: 1, ek: 1, aik: 1, two: 2, do: 2, doh: 2, three: 3, teen: 3, tin: 3,
        four: 4, char: 4, chaar: 4, five: 5, panch: 5, paanch: 5, six: 6, chhe: 6, che: 6,
        seven: 7, saat: 7, eight: 8, aath: 8, nine: 9, nau: 9, ten: 10, das: 10, dus: 10,
        fifteen: 15, pandrah: 15, twenty: 20, bees: 20, thirty: 30, tees: 30,
      };
      return map[lower] || HINDI_NUMBER_WORDS[lower] || null;
    };

    // Check custom interval: e.g. "every 10 min", "every two minutes", "har 10 minute me", "repeat every 10 min", "10 min ka reminder"
    const intervalMatch = normalized.match(/(?:repeat\s+)?(?:reminder\s*)?(?:every|har|repeat\s+every|har\s+ek|interval\s*of)\s*(\d+|[a-z\u0900-\u097F]+)\s*(?:min(?:ute)?s?|m|मिनट)/i) ||
      normalized.match(/(\d+|[a-z\u0900-\u097F]+)\s*(?:min(?:ute)?s?|m|मिनट)\s*(?:ka\s*)?(?:repeat\s*)?(?:reminder|interval)/i) ||
      normalized.match(/(?:reminder|रिमाइंडर).*?(?:every|har|har\s+ek|हर)\s*(\d+|[a-z\u0900-\u097F]+)\s*(?:min(?:ute)?s?|m|मिनट)/i) ||
      normalized.match(/हर\s*(\d+|[a-z\u0900-\u097F]+)\s*मिनट/u);

    // Check before-due: e.g. "due se 15 min pehle", "15 min before due", "20 minute pehle", "2 ghante pehle"
    const beforeDueMatch = normalized.match(/(?:due\s*(?:se|time\s*se)?\s*)?(\d+|[a-z\u0900-\u097F]+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)(?:\s*(?:ka\s*)?(?:reminder|रिमाइंडर))?/i) ||
      normalized.match(/(?:reminder|रिमाइंडर).*?(\d+|[a-z\u0900-\u097F]+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i);

    const isGeneralReminder = /\b(?:reminder\s*(?:is|:)?\s*(?:on|chalu|lagao|karo|kar\s*do|haan|ha|yes|laga\s*do|daal\s*do|bhej\s*do|rakho|rakhein)|(?:on|chalu|kar\s*do|laga\s*do)\s+reminder)\b/i.test(normalized) ||
      /\b(?:reminder|रिमाइंडर)\b/i.test(normalized) ||
      /(?:रिमाइंडर\s*(?:ऑन|चालू|लगाओ|हाँ|हां|कर\s*दो|भेज\s*दो|रखो|रखें|लगा\s*दो))/u.test(normalized);

    const intervalVal = intervalMatch ? parseNumberWord(intervalMatch[1]) : null;
    const beforeDueVal = beforeDueMatch ? parseNumberWord(beforeDueMatch[1]) : null;

    if (intervalVal) {
      slots.reminder = true;
      slots.repeatIntervalMinutes = intervalVal;
      slots.reminderOption = intervalVal === 30 ? 'halfHourly' : (intervalVal === 60 ? 'hourly' : 'interval');
    } else if (beforeDueVal) {
      slots.reminder = true;
      const unit = beforeDueMatch[2].toLowerCase();
      const mins = /ghant|hour|घंट/.test(unit) ? beforeDueVal * 60 : beforeDueVal;
      slots.minutesBeforeDue = mins;
      slots.reminderOption = mins === 60 ? 'oneHourBefore' : 'beforeDue';
    } else if (/\b(?:30\s*min(?:ute)?|aadha\s+ghanta|half\s*hour(?:ly)?|आधा\s*घंटा|30\s*मिनट)\b/i.test(normalized)) {
      slots.reminder = true;
      slots.reminderOption = 'halfHourly';
      slots.repeatIntervalMinutes = 30;
    } else if (/\b(?:har\s+(?:1\s+)?ghant[ae]|har\s+ghant[ae]|hourly|every\s+hour|हर\s*(?:एक\s*)?घंटे)\b/i.test(normalized)) {
      slots.reminder = true;
      slots.reminderOption = 'hourly';
      slots.repeatIntervalMinutes = 60;
    } else if (/\b(?:1|one|ek)\s*(?:ghant[ae]|hour)s?\s*(?:pehle|before|पहले)\b/i.test(normalized)) {
      slots.reminder = true;
      slots.reminderOption = 'oneHourBefore';
      slots.minutesBeforeDue = 60;
    } else if (isGeneralReminder) {
      slots.reminder = true;
      slots.reminderOption = 'oneHourBefore';
    }
  }

  // 5. Repeat Extraction
  if (/\b(repeat\s+roz|daily|har\s+roz|har\s+din)\b/i.test(normalized)) {
    slots.repeatPattern = 'daily';
  } else if (/\b(no\s+repeat|repeat\s+nahi|nahi\s+karna)\b/i.test(normalized)) {
    slots.repeatPattern = 'none';
  }

  // 6. Checkpoints Extraction
  const cpMatch = normalized.match(/checkpoints?\s*:\s*(.+?)(?:\s+and|\s+aur|\s+due|$)/i);
  if (cpMatch && cpMatch[1]) {
    const items = cpMatch[1].split(/[,;]|\baur\b|\band\b/).map(s => s.trim()).filter(Boolean);
    if (items.length > 0) {
      slots.checkpoints = items.map(item => ({ title: item, completed: false }));
    }
  }

  // 7. Assignee / Self extraction
  if (isSelfPhrase(normalized)) {
    slots.isSelf = true;
  }
  const multiAssignee = extractMultipleAssignees(normalized);
  if (multiAssignee.names && multiAssignee.names.length > 0) {
    slots.assigneeName = multiAssignee.names.length > 1 ? multiAssignee.names.join(', ') : multiAssignee.names[0];
    slots.pendingAssigneeNames = [...multiAssignee.names];
    slots.wantsOthers = true;
    slots.taskFor = 'others';
  } else {
    const assigneeMention = extractAssigneeMention(normalized);
    if (assigneeMention) {
      slots.assigneeName = assigneeMention;
      slots.pendingAssigneeNames = [assigneeMention];
      slots.wantsOthers = true;
      slots.taskFor = 'others';
    }
  }

  // 8. Date & Time
  const dueDateTime = parseHinglishDateTime(normalized, now, referenceDate);
  if (dueDateTime) {
    const parsedDate = new Date(dueDateTime);
    if (parsedDate.getTime() < now.getTime()) {
      slots.dueDateTimePast = true;
    }
    slots.dueDateTime = dueDateTime;
  }

  return slots;
}

const FILLER_PHRASE_REGEX = /^(?:haan|ha|theek\s+hai|thik\s+hai|ok|okay|achha|acha|yes|yep|sure|nahi|no|hn|hnn|hnji|haanji|nahi\s+nahi|kuch\s+nahi|theek|thik)(?:\s+(?:haan|ha|theek\s+hai|thik\s+hai|ok|okay|bhai|ji|hai))*$/i;

function isFillerPhrase(text) {
  if (!text) return false;
  return FILLER_PHRASE_REGEX.test(text.trim());
}

const SELF_INTRO_REGEX = /^(?:hello|hi|namaste|hey)?[\s,;]*(?:my\s+name\s+is|i\s+am|mera\s+naam|main\s+hoon)\s+[a-zA-Z\u0900-\u097F]+(?:\s+hai)?[\s,.]*$/i;

const INITIATION_PHRASE_REGEX = /^(?:hello|hi|namaste|hey)?[\s,;]*(?:mera\s+)?(?:ek\s+)?(?:naya\s+|new\s+)?(?:task|kaam|काम|टास्क)\s*(?:banao|bana\s*do|banayein|create\s*karo|create\s*kar\s*do|karna\s*hai|likho|daalo|add\s*karo|बनाओ|बनाएं|बना\s*दो|करना\s*है)?$/i;

function isInitiationPhrase(text) {
  if (!text) return false;
  const clean = text.trim().toLowerCase().replace(/[\s,.;:!?]+/g, ' ');
  if (INITIATION_PHRASE_REGEX.test(clean)) return true;
  return /^(?:hello|hi|hey|namaste)?[\s,;]*(?:create|make|add|start)\s*(?:a\s+)?(?:new\s+)?(?:task)$/i.test(clean) ||
    /^(?:new\s+task|naya\s+task|नया\s+टास्क)$/i.test(clean);
}

function isSelfIntroduction(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (SELF_INTRO_REGEX.test(trimmed)) return true;
  return /^(?:hello|hi|namaste|hey)?[\s,;]*(?:my\s+name\s+is|i\s+am|mera\s+naam|main\s+hoon)\b/i.test(trimmed) &&
    !/(?:task|title|naam|description|priority|due|kal|today|tomorrow)/i.test(trimmed);
}

/**
 * Apply title fallback logic:
 * If title is empty and message is short (<= 80 chars), and not a date/time or chip label,
 * strip leading/trailing title phrases and use it as title.
 */
const TITLE_GUARD_FILLERS = new Set([
  'hlo', 'hello', 'hi', 'hey', 'helo', 'namaste', 'namashkar', 'namaskar', 'pranam',
  'salam', 'salaam', 'yo', 'ya', 'yes', 'yep', 'yeah', 'ok', 'okay', 'okk',
  'ko', 'co', 'haan', 'ha', 'haanji', 'hnji', 'hn', 'hnn', 'nahi', 'nahin', 'no', 'nope', 'na',
  'theek hai', 'thik hai', 'theek', 'thik', 'accha', 'acha', 'achha', 'kuch nahi', 'koi nahi',
  'kuch nhi', 'koi nhi', 'skip', 'kardo', 'kar do', 'banao', 'bana do', 'do', 'done',
  'sure', 'true', 'false', 'blank', 'none', 'नहीं', 'हाँ', 'हां', 'नमस्ते', 'हेलो', 'हाय'
]);

function detectPersonInActionTitle(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();

  // If text already has explicit assignment markers ('ko assign', 'ke liye', 'for', 'assign to', etc.), it's handled by extractAssigneeMention
  if (/\b(?:ko|ke\s+liye|for|assign\s+to|assign)\b/i.test(clean)) {
    return null;
  }

  const nonPersonTokens = new Set([
    'team', 'client', 'doctor', 'office', 'bank', 'customer', 'vendor',
    'support', 'hr', 'it', 'meeting', 'demo', 'interview', 'report',
    'invoice', 'bill', 'call', 'task', 'project', 'system', 'server',
    'code', 'bug', 'feature', 'data', 'pipeline', 'me', 'us', 'him', 'her', 'them',
    'statements', 'statement', 'accounts', 'account', 'documents', 'files', 'file',
    'today', 'tomorrow', 'kal', 'parso', 'urgent', 'asap', 'fast', 'high', 'low', 'medium'
  ]);

  // 1. Action verbs targeting a person with or without prepositions:
  // "Call Priya", "Meet Rahul", "Follow up with Rahul", "Talk to Simran", "Discuss with Aman", "Check with Rohit"
  const prepMatch = clean.match(/\b(?:call|meet|talk\s+to|speak\s+(?:to|with)|follow\s+up\s+with|follow\s+up|discuss\s+with|check\s+with|message|email|contact|milna|baat\s+karo)\s+([a-zA-Z\u0900-\u097F]{2,})\b/i);
  if (prepMatch && prepMatch[1]) {
    const candidate = cleanAssigneeName(prepMatch[1]);
    if (candidate && isValidAssigneeCandidate(candidate) && !nonPersonTokens.has(candidate.toLowerCase())) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }

  // 2. Action verbs followed by a subject and trailing person name:
  // "Send report Priya", "verify bank statements Priya", "audit accounts Rahul", "review PR Aman"
  const trailingMatch = clean.match(/\b(?:send|share|verify|check|audit|review|forward|submit)\b.*?\s+([a-zA-Z\u0900-\u097F]{2,})$/i);
  if (trailingMatch && trailingMatch[1]) {
    const candidate = cleanAssigneeName(trailingMatch[1]);
    if (candidate && isValidAssigneeCandidate(candidate) && !nonPersonTokens.has(candidate.toLowerCase())) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }

  return null;
}

/**
 * Sanity guard for extracted task titles.
 * Rejects command phrases, whole-sentence echoes, assignee-directive sentences, and bare fillers.
 */
function isInvalidOrCommandTitle(title, message = '', assigneeName = '') {
  if (!title || typeof title !== 'string') return true;
  const t = title.trim();
  if (t.length === 0) return true;

  const normTitle = t.toLowerCase().replace(/[\s.,!?;:।]+/gu, ' ').trim();
  const normMsg = String(message || '').toLowerCase().replace(/[\s.,!?;:।]+/gu, ' ').trim();

  // Strip punctuation and check bare fillers ("hlo", "hello", "hi", "hey", "ya", "yes", "ok", "ko", "haan", "nahi", etc.)
  const cleanBare = normTitle.replace(/^[#@$%&*+=~`<>{}()[\]\\/|'"]+|[#@$%&*+=~`<>{}()[\]\\/|'"]+$/g, '').trim();
  if (TITLE_GUARD_FILLERS.has(cleanBare) || cleanBare.length < 2) {
    return true;
  }

  // Initiation, filler, or pure date/time
  if (isInitiationPhrase(t) || isFillerPhrase(t) || isSelfPhrase(t) || isSkip(t)) {
    return true;
  }

  // 1. Bare commands: purely instructions to create/make/assign a task with no actual task subject
  // e.g. "ek task banao", "task banao", "naya task banao", "task create karo", "create a task", "make a task", "task bana do"
  const bareCommandRegex = /^(?:(?:hello|hi|hey|namaste|please|plz)?\s*(?:mujhe|mere\s+liye|apne\s+liye)?\s*(?:ek\s+|a\s+|one\s+)?(?:naya\s+|new\s+)?(?:urgent\s+)?(?:task|kaam|काम|टास्क)\s*(?:banao|bana\s*do|banayein|create\s*karo|create\s*kar\s*do|create|kar\s*do|karna\s*hai|likho|daalo|add\s*karo|karo|do|बनाओ|बनाएं|बना\s*दो|करना\s*है|करो|कर\s*दो)?)$/i;
  if (bareCommandRegex.test(normTitle)) {
    return true;
  }

  // 2. Command addressed to a person or assigning to a person without a separate task subject
  // Reject ONLY when title is (nearly) the whole user sentence AND is addressed to a person
  const isNearlyWholeSentence = !normMsg || normTitle === normMsg || (normTitle.length >= 0.75 * normMsg.length && normMsg.includes(normTitle));

  if (isNearlyWholeSentence) {
    const personCommandPatterns = [
      /\b[a-zA-Z\u0900-\u097F]+\s+ko\s+(?:ek\s+)?(?:naya\s+)?(?:urgent\s+)?task\s+(?:do|banao|assign\s*karo|karo|bana\s*do|de\s*do|बनाओ|दो)\b/i,
      /\btask\s+(?:assign\s+karo|banao|do|create\s*karo)\s+[a-zA-Z\u0900-\u097F]+\s+ko\b/i,
      /\b(?:assign\s+karo|assign\s+to|task\s+assign)\s+[a-zA-Z\u0900-\u097F]+(?:\s+ko)?\b/i,
      /\b[a-zA-Z\u0900-\u097F]+\s+ko\s+(?:assign\s+karo|kar\s*do|bana\s*do)\b/i,
      /(?:टास्क\s*असाइन\s*करो|टास्क\s*दो|[a-zA-Z\u0900-\u097F]+\s*को\s*टास्क)/u,
    ];
    if (personCommandPatterns.some((p) => p.test(normTitle))) {
      return true;
    }

    if (assigneeName && String(assigneeName).trim()) {
      const normAssignee = String(assigneeName).trim().toLowerCase();
      if (normTitle.includes(normAssignee) && /\b(?:assign|task|ko|karo|do)\b/i.test(normTitle)) {
        return true;
      }
    }
  }

  return false;
}

function applyTitleFallback(title, message) {
  if (title && String(title).trim() && !isInvalidOrCommandTitle(title, message)) return title;
  if (!message || typeof message !== 'string') return null;

  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;

  // Title guard check on trimmed message directly
  const normMsg = trimmed.toLowerCase().replace(/[\s.,!?;:।]+/gu, ' ').trim();
  if (TITLE_GUARD_FILLERS.has(normMsg)) {
    return null;
  }

  // Skip fallback if message is purely a skip word, self phrase, conversational filler, self-introduction, or task initiation command
  if (isSkip(trimmed) || isSkipAll(trimmed) || isSelfPhrase(trimmed) || isFillerPhrase(trimmed) || isSelfIntroduction(trimmed) || isInitiationPhrase(trimmed)) return null;

  // Skip fallback if message is only date/time
  const dateOnlyTokens = /^(?:aaj|aj|kal|cal|kl|parso|parson|today|tomorrow|somwar|mangalwar|budhwar|guruwar|shukrawar|shaniwar|ravivar|monday|tuesday|wednesday|thursday|friday|saturday|sunday|subah|subha|morning|dopahar|shaam|sham|evening|raat|night|am|pm|baje|baaj|baj|kar|ke|min|minute|o'?clock|saade|sade|dedh|dhai|sawa|paune|tak|tk|तक|by|until|till|before|\d+|कल|आज|सुबह|शाम|दोपहर|रात|बजे|बज|कर|के|मिनट)+$/iu;
  if (dateOnlyTokens.test(trimmed.replace(/[\s:,\.-]+/gu, ''))) {
    return null;
  }

  // Skip fallback if message is only a chip label
  if (/^(low|medium|high|urgent|haan|nahi|yes|no|none|skip|hourly|halfhourly|onehourbefore)$/i.test(trimmed)) {
    return null;
  }

  let cleaned = trimmed;
  const stripPrefixes = [
    /^(?:urgent\s+)?(?:ek\s+)?(?:naya\s+)?(?:task|टास्क)\s*(?:banao|bana\s*do|create\s*karo|karo|banayein|बनाओ|बना\s*दो)\s*:\s*/i,
    /^(?:task|टास्क)\s*:\s*/i,
    /^title\s*:\s*/i,
    /^(?:ye|yeh|iska|task\s+ka)\s+title\s+(?:hai|hoga)?\s*/i,
    /^title\s+(?:is|hai)\s*/i,
  ];
  for (const prefix of stripPrefixes) {
    cleaned = cleaned.replace(prefix, '');
  }

  const stripSuffixes = [
    /\s+(?:is\s+the\s+title|title\s+hai|ye\s+title\s+hai|iska\s+title\s+hai)$/i,
    /\s+(?:rakhna|rakho|hoga)$/i,
  ];
  for (const suffix of stripSuffixes) {
    cleaned = cleaned.replace(suffix, '');
  }

  // Strip trailing date/time expressions from title (e.g. "Call Priya about invoice kal 5 baje" -> "Call Priya about invoice")
  cleaned = cleaned.replace(/\s+(?:kal|cal|kl|aaj|aj|parso|tomorrow|today|yesterday)\s+(?:\d{1,2}|subah|shaam|dopahar|raat|[a-z]+)\s*(?:baje|baaj|baj|am|pm|o'?clock)?.*$/i, '');
  cleaned = cleaned.replace(/\s+(?:at|by|till|tak)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?.*$/i, '');
  cleaned = cleaned.replace(/\s+\d{1,2}\s*(?:baje|baaj|baj|बजे).*$/i, '');

  cleaned = cleaned.trim();
  if (cleaned.length >= 2 && cleaned.length <= 80) {
    if (isInvalidOrCommandTitle(cleaned, message)) {
      return null;
    }
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return null;
}

const MONTH_MAP = {
  jan: 0, january: 0, 'जनवरी': 0, 'जन': 0,
  feb: 1, february: 1, 'फरवरी': 1, 'फ़रवरी': 1,
  mar: 2, march: 2, 'मार्च': 2,
  apr: 3, april: 3, 'अप्रैल': 3,
  may: 4, 'मई': 4,
  jun: 5, june: 5, 'जून': 5,
  jul: 6, july: 6, 'जुलाई': 6,
  aug: 7, august: 7, 'अगस्त': 7,
  sep: 8, sept: 8, september: 8, 'सितंबर': 8, 'सितम्बर': 8,
  oct: 9, october: 9, 'अक्टूबर': 9, 'अक्टुबर': 9,
  nov: 10, november: 10, 'नवंबर': 10, 'नवम्बर': 10,
  dec: 11, december: 11, 'दिसंबर': 11, 'दिसम्बर': 11,
};

function formatYyyyMmDd(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseProjectDate(raw, now = new Date()) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = normalizeDigits(raw.trim().toLowerCase());

  // "15 Dec" or "15 December" or "1 November"
  const mMatch = clean.match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-zA-Z\u0900-\u097F]+)/);
  if (mMatch) {
    const day = parseInt(mMatch[1], 10);
    const mStr = mMatch[2].toLowerCase();
    const month = MONTH_MAP[mStr];
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = now.getFullYear();
      const candidate = new Date(year, month, day);
      return formatYyyyMmDd(candidate);
    }
  }

  if (/\b(?:kal|tomorrow)\b/i.test(clean)) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return formatYyyyMmDd(d);
  }
  if (/\b(?:aaj|today)\b/i.test(clean)) {
    return formatYyyyMmDd(now);
  }
  return null;
}

function parseProjectDateRange(raw, now = new Date()) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = normalizeDigits(raw.trim().toLowerCase());

  // 1. "1 November se 30 November tak" or "1 Nov to 30 Nov"
  const rangeRegex = /(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-zA-Z\u0900-\u097F]+)\s*(?:se|to|-|\bse\s+lekar\b)\s*(\d{1,2})\s*(?:st|nd|rd|th)?\s+([a-zA-Z\u0900-\u097F]+)(?:\s*tak)?/i;
  const rMatch = clean.match(rangeRegex);
  if (rMatch) {
    const day1 = parseInt(rMatch[1], 10);
    const mStr1 = rMatch[2].toLowerCase();
    const day2 = parseInt(rMatch[3], 10);
    const mStr2 = rMatch[4].toLowerCase();

    const m1 = MONTH_MAP[mStr1];
    const m2 = MONTH_MAP[mStr2];

    if (m1 !== undefined && m2 !== undefined && day1 >= 1 && day1 <= 31 && day2 >= 1 && day2 <= 31) {
      const year = now.getFullYear();
      const d1 = new Date(year, m1, day1);
      const d2 = new Date(year, m2, day2);

      if (d2.getTime() < d1.getTime()) {
        return { error: 'end_before_start' };
      }
      return {
        startDate: formatYyyyMmDd(d1),
        endDate: formatYyyyMmDd(d2),
        error: null,
      };
    }
  }

  // 2. "kal se 2 hafte" or "kal se do hafte" or "kal se 14 din"
  const kalSeWeeks = clean.match(/(?:kal|tomorrow)\s*(?:se|to|-)\s*(\d+|ek|do|teen|chaar|paanch|chhe|saat|aath|nau|das)?\s*(hafte|week|weeks|din|days|mahine|months?)(?:\s*tak)?/i);
  if (kalSeWeeks) {
    const rawNum = kalSeWeeks[1] ? (HINDI_NUMBER_WORDS[kalSeWeeks[1]] || parseInt(kalSeWeeks[1], 10) || 1) : 1;
    const unit = kalSeWeeks[2].toLowerCase();
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    let end = new Date(start.getTime());
    if (unit.startsWith('haft') || unit.startsWith('week')) {
      end.setDate(end.getDate() + rawNum * 7);
    } else if (unit.startsWith('din') || unit.startsWith('day')) {
      end.setDate(end.getDate() + rawNum);
    } else if (unit.startsWith('mahin') || unit.startsWith('month')) {
      end.setMonth(end.getMonth() + rawNum);
    }
    return {
      startDate: formatYyyyMmDd(start),
      endDate: formatYyyyMmDd(end),
      error: null,
    };
  }

  // 3. "agle mahine ke end tak" / "next month end tak"
  if (/(?:agle\s+mahine|next\s+month)(?:\s+ke)?\s+end(?:\s*tak)?/i.test(clean)) {
    const start = new Date(now.getTime());
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return {
      startDate: formatYyyyMmDd(start),
      endDate: formatYyyyMmDd(end),
      error: null,
    };
  }

  return null;
}

function parseProjectStatusHinglish(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim().toLowerCase();
  if (/\b(?:planning|plan|abhi\s+plan\s+mein|plan\s+mein|tayyari|प्लानिंग|प्लान)\b/i.test(clean)) return 'planning';
  if (/\b(?:on\s*hold|onhold|ruka\s+hua|rok\s+do|hold\s+par|hold|होल्ड)\b/i.test(clean)) return 'on hold';
  if (/\b(?:completed|complete|khatam|poora|done|हो\s*गया|पूरा)\b/i.test(clean)) return 'completed';
  if (/\b(?:cancelled|canceled|cancel|band|drop|रद्द)\b/i.test(clean)) return 'cancelled';
  if (/\b(?:active|chalu|shuru|in\s*progress|chal\s+raha\s+hai|एक्टिव|चालू)\b/i.test(clean)) return 'active';
  return null;
}

function parseProjectPriorityHinglish(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim().toLowerCase();
  if (/\b(?:high|urgent|zaroori|tez|top|हाई|अर्जेंट)\b/i.test(clean)) return 'high';
  if (/\b(?:low|kam|chhota|dheema|लो|कम)\b/i.test(clean)) return 'low';
  if (/\b(?:medium|darmiyan|normal|beech\s+ka|मीडियम)\b/i.test(clean)) return 'medium';
  return null;
}

module.exports = {
  MULTI_NAME_SEP_REGEX,
  isSkip,
  isSkipAll,
  isSelfPhrase,
  isFillerPhrase,
  isSelfIntroduction,
  isInitiationPhrase,
  cleanAssigneeName,
  isValidAssigneeCandidate,
  isDateLikeToken,
  DATE_WORDS_SET,
  extractAssigneeMention,
  extractMultipleAssignees,
  parseHinglishDateTime,
  parseHinglishSlots,
  applyTitleFallback,
  isInvalidOrCommandTitle,
  toIstIsoString,
  HINDI_NUMBER_WORDS,
  WEEKDAY_NAMES,
  TITLE_GUARD_FILLERS,
  detectPersonInActionTitle,
  parseProjectDateRange,
  parseProjectDate,
  parseProjectStatusHinglish,
  parseProjectPriorityHinglish,
};


