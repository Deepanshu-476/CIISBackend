/**
 * services/ai/sttNormalizer.js
 *
 * Deterministic transcript normalizer and intent detector for Hindi/Hinglish speech.
 * Normalizes speech recognition inconsistencies (Whisper homophones, number words,
 * noise tokens) and detects user intents (skip_all, skip_field, create_now, cancel, confirm).
 */

const LEVENSHTEIN_THRESHOLD_LEN = 5;

/**
 * Collapses duplicate repeated sentences or utterances back-to-back:
 * e.g. "Simran, Gabya, Gaurav, Vanch, Arav.  Simran, Gabya, Gaurav, Vanch, Arav." -> "Simran, Gabya, Gaurav, Vanch, Arav."
 */
function collapseRepeatedUtterance(text) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // 1. Direct split by sentence delimiters like ". ", ".\n", "? ", "! "
  const sentenceSplit = trimmed.split(/(?<=[.!?])\s+/);
  if (sentenceSplit.length >= 2) {
    const first = sentenceSplit[0].trim().replace(/[.!?]+$/, '').toLowerCase();
    const allIdentical = sentenceSplit.every(s => s.trim().replace(/[.!?]+$/, '').toLowerCase() === first);
    if (allIdentical) {
      return sentenceSplit[0].trim();
    }
  }

  // 2. Exact repeated halves: "X X" or "X, X" or "X. X"
  const halfLen = Math.floor(trimmed.length / 2);
  for (let offset = -5; offset <= 5; offset += 1) {
    const mid = halfLen + offset;
    if (mid > 3 && mid < trimmed.length - 3) {
      const part1 = trimmed.slice(0, mid).trim().replace(/[,;.!?]+$/, '').trim();
      const part2 = trimmed.slice(mid).trim().replace(/^[,;.!?]+/, '').trim().replace(/[,;.!?]+$/, '').trim();
      if (part1 && part1.toLowerCase() === part2.toLowerCase()) {
        return part1;
      }
    }
  }

  // 3. Repeated clauses separated by comma or semicolon
  const clauses = trimmed.split(/\s*[,;]\s*/);
  if (clauses.length === 2 && clauses[0].trim().toLowerCase() === clauses[1].trim().toLowerCase()) {
    return clauses[0].trim();
  }

  return trimmed;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  const row = [];
  for (let j = 0; j <= lb; j += 1) row[j] = j;

  for (let i = 1; i <= la; i += 1) {
    let prev = i;
    for (let j = 1; j <= lb; j += 1) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], row[j], prev) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[lb] = prev;
  }
  return row[lb];
}

const MISHEARD_NUMBERS_HINDI = {
  साथ: 'सात',
  साठ: 'सात',
  अट: 'आठ',
  आथ: 'आठ',
  चर: 'चार',
  पाच: 'पांच',
  पाँच: 'पांच',
  नो: 'नौ',
  तिन: 'तीन',
  दौ: 'दो',
  इक: 'एक',
  छः: 'छह',
  छे: 'छह',
  दश: 'दस',
  ग्यारा: 'ग्यारह',
  बारा: 'बारह',
};

const MISHEARD_NUMBERS_ROMAN = {
  saath: 'saat',
  sath: 'saat',
  aath: 'aath',
  at: 'aath',
  char: 'chaar',
  panch: 'paanch',
  nau: 'nau',
  tin: 'teen',
  dus: 'das',
};

// Key target words for fuzzy match (Levenshtein <= 1 for words >= 5 chars)
const FUZZY_TARGETS = [
  { target: 'default', candidates: ['default', 'defalt', 'diffalt', 'difalt'] },
  { target: 'reminder', candidates: ['reminder', 'remindr', 'remindar', 'remainder'] },
  { target: 'priority', candidates: ['priority', 'prioriti', 'priorty'] },
  { target: 'description', candidates: ['description', 'discription', 'descriptn'] },
  { target: 'checkpoint', candidates: ['checkpoint', 'checkpnt', 'chekpoint'] },
  { target: 'attachments', candidates: ['attachment', 'attachments', 'atachment'] },
];

/**
 * Clean and normalize Hindi/Hinglish speech transcripts.
 *
 * @param {string} text - Raw transcript from STT
 * @returns {string} - Cleaned and normalized text
 */
function normalizeTranscript(text) {
  if (!text || typeof text !== 'string') return '';

  let res = collapseRepeatedUtterance(text.trim());

  // 1. STT noise tokens ("studio", "रोचे", "ok", "so", "इस निवेज़े") when filler
  res = res.replace(/(?:^|\s)studio\s*(?:rakho|rakhein|रखो|रखें)?/giu, ' ');
  res = res.replace(/(?:^|\s)रोचे(?:\s|[.,;]|$)/giu, ' ');
  res = res.replace(/(?:^|\s)इस\s*निवे[ज़ज]े(?:\s|[.,;]|$)/giu, ' ');
  res = res.replace(/(?:^|\s)(?:ok|so)(?=\s|$)/gi, ' ');

  // 2. Whisper number word homophones right before "baje" / "बजे" / "वजे"
  // Normalize "वजे/वज/बजे/baje/bje/bajey" -> "बजे" / "baje"
  res = res.replace(/([a-zA-Z\u0900-\u097F]+)\s*(?:वजे|वज|बजे)(?=\P{L}|$)/giu, (match, word) => {
    const trimmed = word.trim();
    if (MISHEARD_NUMBERS_HINDI[trimmed]) {
      return `${MISHEARD_NUMBERS_HINDI[trimmed]} बजे`;
    }
    return `${trimmed} बजे`;
  });

  res = res.replace(/([a-zA-Z]+)\s*(?:baje|bje|bajey|bajeh)\b/gi, (match, word) => {
    const lower = word.trim().toLowerCase();
    if (MISHEARD_NUMBERS_ROMAN[lower]) {
      return `${MISHEARD_NUMBERS_ROMAN[lower]} baje`;
    }
    return `${word} baje`;
  });

  // Direct standalone replacements for साथ वजे
  res = res.replace(/साथ\s*वजे/gu, 'सात बजे');
  res = res.replace(/साथ\s*बजे/gu, 'सात बजे');
  res = res.replace(/\bsaath\s*baje\b/gi, 'saat baje');

  // Whisper mishearings for "baj kar" / "baj ke"
  res = res.replace(/\b(?:baaj|bach|bachh)\s*(?:kar|ke)\b/giu, 'baj kar');
  res = res.replace(/\b(?:bachkar|bachke|bajke|baajke)\b/giu, 'baj kar');
  res = res.replace(/\b(?:bach|baaj)\s*baje\b/giu, 'baje');

  // Devanagari nukta variants for baj / baje (e.g. "बज़ कर", "बज़कर", "बज़के", "बज़े", "बज़")
  res = res.replace(/ब[ज़ज]\u093C?\s*(?:कर|के)/gu, 'बज कर');
  res = res.replace(/ब[ज़ज]\u093C?कर/gu, 'बज कर');
  res = res.replace(/ब[ज़ज]\u093C?के/gu, 'बज कर');
  res = res.replace(/ब[ज़ज]\u093C?े/gu, 'बजे');
  res = res.replace(/ब[ज़ज]\u093C?\s*बजे/gu, 'बजे');
  res = res.replace(/ब[ज़ज]\u093C?(?=\s*\d|\s*कर|\s*के|$)/gu, 'बज');

  // Whisper number word variants (e.g. "chay" -> "chhe", "pchas" -> "pachaas")
  res = res.replace(/(?:^|\P{L})(?:chay|chhey|chhai|chahe)(?:\P{L}|$)/giu, (match) => match.replace(/chay|chhey|chhai|chahe/iu, 'chhe'));
  res = res.replace(/(?:^|\P{L})(?:pchas|pchaas)(?:\P{L}|$)/giu, (match) => match.replace(/pchas|pchaas/iu, 'pachaas'));

  // Normalize "p.m." and "a.m." with any spacing or trailing dots
  res = res.replace(/\bp\s*\.\s*m\s*\.?/gi, 'pm');
  res = res.replace(/\ba\s*\.\s*m\s*\.?/gi, 'am');

  // Normalize spaces around colon or dot in time e.g. "5 : 30", "5: 30", "5 . 30" -> "5:30"
  res = res.replace(/\b(\d{1,2})\s*[:.]\s*([0-5]\d)(?:\s*(pm|am)\b)?/gi, (m, h, min, meridiem) => {
    return meridiem ? `${h}:${min} ${meridiem}` : `${h}:${min}`;
  });

  // Normalize space-separated hour & minute e.g. "5 30 pm" -> "5:30 pm", "5 30 baje" -> "5:30 baje"
  res = res.replace(/\b([1-9]|1[0-2])\s+([0-5]\d)\s*(pm|am)\b/gi, '$1:$2 $3');
  res = res.replace(/\b([1-9]|1[0-2])\s+([0-5]\d)\s*(baje|बजे)\b/gi, '$1:$2 $3');
  res = res.replace(/(?<=\b(?:time|samay|समय|aaj|आज|kal|कल|sham|shaam|शाम|dopahar|दोपहर|due|tarikh|tareekh)\s+)([1-9]|1[0-2])\s+([0-5]\d)\b/gi, '$1:$2');

  // Standardize saadhe variants (sadhe, saadhe, saade, sade, साढ़े, साढे, साड़े) -> saadhe
  res = res.replace(/(?:^|\P{L})(?:saadhe|sadhe|saade|sade|साढ़े|साढे|साड़े)(?:\P{L}|$)/giu, (match) => {
    return match.replace(/saadhe|sadhe|saade|sade|साढ़े|साढे|साड़े/iu, 'saadhe');
  });

  // 3. "बाकी/बाकि/बाखी/बाक़ी/baki/baaki/baqi/bakhi" -> "baaki"
  res = res.replace(/(?:^|\P{L})(?:बाकी|बाकि|बाखी|बाक़ी|baki|baaki|baqi|bakhi)(?:\P{L}|$)/giu, (match) => {
    return match.replace(/बाकी|बाकि|बाखी|बाक़ी|baki|baaki|baqi|bakhi/iu, 'baaki');
  });

  // 4. "डिफ़ॉल्ट/डिफॉल्ट/default" -> "default"
  res = res.replace(/(?:^|\P{L})(?:डिफ़ॉल्ट|डिफॉल्ट|default|defalt)(?:\P{L}|$)/giu, (match) => {
    return match.replace(/डिफ़ॉल्ट|डिफॉल्ट|default|defalt/iu, 'default');
  });

  // 5. "सारा/सब/sab/sara/saara" -> "sab" in default/all contexts
  res = res.replace(/(?:^|\P{L})(?:सारा|सब|sab|sara|saara)(?:\s+(?:default|baaki|रोचे|डिफ़ॉल्ट))(?:\P{L}|$)/giu, (match) => {
    return match.replace(/सारा|सब|sab|sara|saara/iu, 'sab');
  });

  // 6. Common STT misheard negation tokens:
  // "नी" -> "नहीं" when before "चाहिए" / "karna"
  res = res.replace(/(?:^|\s)नी\s*(?=चाहिए|chahiye|karna|karo|करना)/giu, ' नहीं ');
  // "उन्हें करना" -> "नहीं करना" when preceded by "नहीं reminder"
  res = res.replace(/(?:^|\s)उन्हें\s+(?=करना|karna)/giu, ' नहीं ');

  // 6b. Speech homophones for assign commands and particles:
  // "Simran co / koh task assign / assigned karo" -> "Simran ko task assign karo"
  res = res.replace(/\b([a-zA-Z\u0900-\u097F]{2,})\s+(?:co|koh|kor)\s+(?:ek\s+)?task\s+(?:assign|assigned)\b/gi, '$1 ko task assign');
  res = res.replace(/\b([a-zA-Z\u0900-\u097F]{2,})\s+(?:co|koh|kor)\b(?=\s*(?:assign|assigned|task|de\s*do|bhejo|$|[.,;!]))/gi, '$1 ko');
  res = res.replace(/\bassigned\s+(karo|kar\s*do|kardo|karna|kariye)\b/gi, 'assign $1');
  res = res.replace(/\btask\s+assigned\b/gi, 'task assign');

  // 6c. "baaki sab / baki sabbha / baki sabha / baaki sabhi / baaki sabh" -> "baaki sab default"
  res = res.replace(/(?:^|\P{L})(?:baaki|baki|baqi)\s+(?:sabbha|sabha|sabh|sab|sabhi|sab\s+kuch)(?:\s+(?:default|bhi|rehne\s+do))?(?:\P{L}|$)/giu, ' baaki sab default ');

  // 7. Token-level fuzzy match for key target words (Levenshtein <= 1 for >= 5 chars)
  const tokens = res.split(/\s+/);
  const normalizedTokens = tokens.map((token) => {
    const cleanWord = token.replace(/^[.,!?;:]+|[.,!?;:]+$/g, '').toLowerCase();
    if (cleanWord.length >= LEVENSHTEIN_THRESHOLD_LEN) {
      for (const item of FUZZY_TARGETS) {
        if (levenshtein(cleanWord, item.target) <= 1) {
          return token.replace(new RegExp(cleanWord, 'i'), item.target);
        }
      }
    }
    return token;
  });
  res = normalizedTokens.join(' ');

  // Collapse extra spaces
  res = res.replace(/\s{2,}/g, ' ').trim();
  return res;
}

/**
 * Detect user intent on every incoming message.
 * Supports: skip_all, skip_field, create_now, cancel, confirm_yes, confirm_no.
 *
 * @param {string} text - Message from user (raw or normalized)
 * @returns {{ type: string, field?: string } | null}
 */
function detectUserIntent(text) {
  if (!text || typeof text !== 'string') return null;

  const normalized = normalizeTranscript(text);
  const clean = normalized.toLowerCase().replace(/[,.!?;:।]/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. cancel
  if (
    /\b(?:cancel|rehne\s+do\s+task|chhod\s+do\s+task|band\s+karo|रद्द\s+करो|टास्क\s+कैंसिल|cancel\s+task)\b/iu.test(clean) ||
    /^(?:cancel|rehne\s+do|chhod\s+do|रद्द\s+करो)$/iu.test(clean)
  ) {
    return { type: 'cancel' };
  }

const CANONICAL_AFFIRMATIVES = [
  'haan ji', 'bana do', 'kar do', 'create kar do', 'ok', 'theek hai',
  'haan ji kardo', 'haan ji banado', 'kardo', 'banado'
];

function isGenericAffirmative(text) {
  if (!text || typeof text !== 'string') return false;
  let clean = text.toLowerCase().replace(/[^a-zA-Z\u0900-\u097F\s]/g, ' ').replace(/\s+/g, ' ').trim();
  clean = clean.replace(/\b(?:hanji|hnji|haanji|aaji)\b/g, 'haan ji');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  if (/^(?:nahi|no|ruko|badlo|रुको|नहीं|ना|बदलो|mat|change)/iu.test(clean)) return false;

  // Direct affirmative patterns
  if (/^(?:(?:haan|ha|yes|हाँ|हां|ji)\s+)?(?:create\s+kar\s+do|create\s+karo|create\s+kardo|bana\s+do|banado|banadu|banao|kar\s+do|kardo|theek\s+hai|thik\s+hai|sahi\s+hai|ok|okay|sure|done|confirm|क्रिएट\s*कर\s*दो|बना\s*दो|बनादो|बनादू|कर\s*दो|ठीक\s*है)$/iu.test(clean)) return true;
  if (/^(?:haan|ha|yes|sure|ok|okay|theek\s+hai|thik\s+hai|हाँ|हां|हाँ\s+जी|ठीक\s+है)$/iu.test(clean)) return true;

  // Edit distance against canonical list
  for (const target of CANONICAL_AFFIRMATIVES) {
    const dist = levenshtein(clean, target);
    const maxAllowed = target.length >= 10 ? 3 : (target.length >= 6 ? 2 : 1);
    if (dist <= maxAllowed) return true;
  }

  // Token-by-token alignment tolerance
  for (const target of CANONICAL_AFFIRMATIVES) {
    const targetWords = target.split(' ');
    if (targetWords.length === words.length) {
      let totalWordDist = 0;
      let ok = true;
      for (let i = 0; i < words.length; i++) {
        const d = levenshtein(words[i], targetWords[i]);
        if (d > 2) { ok = false; break; }
        totalWordDist += d;
      }
      if (ok && totalWordDist <= 2) return true;
    }
  }

  return false;
}

  // 2. create_now
  // "task create kar do/karo/kardo", "bana do/banao", "create it", "submit", "ho gaya", "kar do", "kardo", "यह टास्क बना दो", "क्रिएट कर दो"
  const isPureCreateNow = /^(?:(?:haan|ha|yes|हाँ|हां|aaji|आजी)\s+)?(?:task\s+)?(?:create\s+kar\s+do|create\s+karo|create\s+kardo|bana\s+do|banado|banadu|banao|create\s+it|submit|ho\s+gaya|kar\s+do|kardo|यह\s+टास्क\s+बना\s+दो|टास्क\s+बना\s+दो|क्रिएट\s+कर\s+दो|क्रिएट\s+करो|क्रिएट\s+क\s*र्दो|क्रिएट|बना\s*दो|बनादो|बनादू)$/iu.test(clean);
  const containsCreateNow = /\b(?:task\s+create\s+kar\s+do|task\s+create\s+kardo|bana\s+do\s+task|create\s+it\s+now|submit\s+task)\b/i.test(clean) ||
    /(?:क्रिएट\s+कर\s+दो|टास्क\s+बना\s+दो|टास्क\s+क्रिएट\s+कर\s+दो|आजी\s*बनादो|आजी\s*बना\s*दो)/u.test(clean);
  if (isPureCreateNow || containsCreateNow) {
    return { type: 'create_now' };
  }

  // 3. confirm_yes / confirm_no for ready step
  const isConfirmYes = isGenericAffirmative(clean);
  if (isConfirmYes) {
    return { type: 'confirm_yes' };
  }
  const isConfirmNo = /^(?:nahi|no|ruko|badlo|रुको|नहीं|ना|बदलो|abhi\s+nahi|nahi\s+abhi\s+nahi|kuch\s+change|kuch\s+changes|kuch\s+badalna|change\s+karna\s+hai|kuch\s+badalna\s+hai|changes\s+karne\s+hai|nahi\s+kuch\s+change|nahi\s+mujhe\s+kuch\s+changes\s+karne\s+hai)$/iu.test(clean) ||
    /\b(?:kuch\s+changes\s+karne|kuch\s+badalna\s+hai|change\s+karna\s+hai|abhi\s+nahi\s+karna|nahi\s+abhi\s+nahi)\b/iu.test(clean) ||
    /(?:कुछ\s+बदलना\s+है|बदलाव\s+करना\s+है|बदलाव\s+चाहिए)/u.test(clean);
  if (isConfirmNo) {
    return { type: 'confirm_no' };
  }

  // 4. skip_all
  // Any of: baaki sab default, baaki default, baaki sab skip, baaki kuch nahi, bas itna hi, aur kuch nahi, "by default",
  // "default rakho/rehne do", sab default hai, rest default, rest skip, that's all, bas, "बाकी सब डिफ़ॉल्ट", "बाकि सब default है",
  // "और बाखी by default", "baaki by default", "baki sabbha"
  const isSkipAll =
    /\b(?:baaki\s+sab\s+default|baaki\s+default|baaki\s+sab\s+skip|baaki\s+kuch\s+nahi|bas\s+itna\s+hi|bas\s+itna|aur\s+kuch\s+nahi|by\s+default|default\s+rakho|default\s+rehne\s+do|sab\s+default\s+hai|sab\s+default|rest\s+default|rest\s+skip|that'?s\s+all|baaki\s+by\s+default|aur\s+baaki\s+by\s+default|all\s+default|baaki\s+sab|baki\s+sab|baaki\s+sabhi|baki\s+sabhi|baaki\s+sabbha|baki\s+sabbha|baaki\s+sabh|baki\s+sabh|बाकी\s+सब\s+डिफ़ॉल्ट|बाकी\s+सब\s+डिफॉल्ट|बाकी\s+डिफ़ॉल्ट|बाकी\s+डिफॉल्ट|बाकी\s+सब\s+default|बाकी\s+default|बाकी\s+सब|बाकी\s+सभी)\b/i.test(clean) ||
    clean === 'bas' ||
    clean === 'बस';

  if (isSkipAll) {
    return { type: 'skip_all' };
  }

  // 5. skip_field
  // "<field word> (nahi|नहीं|नी|ni|na) (chahiye|karna|karni|hai|rakhna|dena)", "<field> mat karo", "no <field>",
  // "<field> koi bhi nahi / कोई भी नहीं", "<field> skip"
  const fieldList = [
    { field: 'reminder', words: 'reminder|yaad|रिमाइंडर|याद' },
    { field: 'repeatPattern', words: 'repeat|dohrana|रिपीट|दोहराना' },
    { field: 'description', words: 'description|details|vivaran|विवरण|डिस्क्रिप्शन' },
    { field: 'checkpoints', words: 'checkpoint|checkpoints|kaam\\s+ki\\s+list|चेकपॉइंट' },
    { field: 'attachments', words: 'attachment|attachments|photo|file|फोटो|फाइल|अटैचमेंट' },
    { field: 'priorityDays', words: 'priority\\s*days|prioritydays' },
    { field: 'priority', words: 'priority|प्रायोरिटी' },
  ];

  for (const { field, words } of fieldList) {
    const p1 = new RegExp(`(?:${words})\\s+(?:koi\\s+bhi\\s+|कोई\\s+भी\\s+)?(?:nahi|नहीं|नी|ni|na|unhe)\\s*(?:chahiye|चाहिए|karna|करना|karni|hai|rakhna|dena)?`, 'iu');
    const p2 = new RegExp(`(?:${words})\\s+(?:mat\\s+lagao|mat\\s+karo|mat\\s+rakho|skip|off|chhod\\s+do|band\\s+karo)`, 'iu');
    const p3 = new RegExp(`(?:no|mat|nahi|नहीं|bina)\\s+(?:${words})`, 'iu');
    const p4 = new RegExp(`(?:${words})\\s+(?:koi\\s+bhi\\s+nahi|कोई\\s+भी\\s+नहीं)`, 'iu');

    if (p1.test(clean) || p2.test(clean) || p3.test(clean) || p4.test(clean)) {
      return { type: 'skip_field', field };
    }
  }

  return null;
}

module.exports = {
  collapseRepeatedUtterance,
  normalizeTranscript,
  detectUserIntent,
  levenshtein,
  MISHEARD_NUMBERS_HINDI,
  MISHEARD_NUMBERS_ROMAN,
};
