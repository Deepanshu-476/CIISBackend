/**
 * services/ai/clientSlotFiller.js
 *
 * Dedicated Slot Filling, Privacy Redaction & Disambiguation engine for `create_client` intent.
 * Handles:
 * - Deterministic PII extraction & redaction (<EMAIL>, <PHONE>, <GST>, <PAN>, <PIN>)
 * - PII Masking for logs and user overlay (e.g. jo***om, 98***10)
 * - Format validation matching AddClientPage (email, 10-digit phone, GST, PAN, 6-digit pin)
 * - Required slots: client name, company name, city, team (min 1 member)
 * - Optional slot groups: Contact (email, phone), Business (industry, gst, pan, website),
 *   Address (address, state, country, pincode), Notes (description, notes)
 * - Duplicate client / company checks
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGITS_REGEX = /^\d{10}$/;
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i;
const PINCODE_REGEX = /^\d{6}$/;
const WEBSITE_REGEX = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i;

// Pre-LLM Regex for PII detection
const PII_PATTERNS = {
  EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/g,
  GST: /\b\d{2}[A-Za-z]{5}\d{4}[A-Za-z]{1}[1-9A-Za-z]{1}Z[0-9A-Za-z]{1}\b/g,
  PAN: /\b[A-Za-z]{5}\d{4}[A-Za-z]{1}\b/g,
  PHONE: /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g,
  PIN: /\b\d{6}\b/g,
};

/**
 * Deterministically extracts and replaces PII with placeholders before sending text to LLM.
 */
function redactPIIForLLM(text) {
  if (!text || typeof text !== 'string') return { redactedText: text, piiMap: {} };
  const piiMap = {};
  let redacted = text;

  // 1. Email
  redacted = redacted.replace(PII_PATTERNS.EMAIL, (m) => {
    piiMap.email = m.trim();
    return '<EMAIL>';
  });

  // 2. GST
  redacted = redacted.replace(PII_PATTERNS.GST, (m) => {
    piiMap.gst = m.trim().toUpperCase();
    return '<GST>';
  });

  // 3. PAN
  redacted = redacted.replace(PII_PATTERNS.PAN, (m) => {
    piiMap.pan = m.trim().toUpperCase();
    return '<PAN>';
  });

  // 4. Phone
  redacted = redacted.replace(PII_PATTERNS.PHONE, (m) => {
    const digits = m.replace(/\D/g, '').slice(-10);
    piiMap.phone = digits;
    return '<PHONE>';
  });

  // 5. Pincode
  redacted = redacted.replace(PII_PATTERNS.PIN, (m) => {
    piiMap.pincode = m.trim();
    return '<PIN>';
  });

  return { redactedText: redacted, piiMap };
}

/**
 * Masks an identifier for logs, DEV overlay, or error text.
 * Displays first 2 and last 2 characters with *** in between.
 */
function maskIdentifier(val) {
  if (!val) return '—';
  const str = String(val).trim();
  if (str.length <= 4) return '***';
  return `${str.slice(0, 2)}***${str.slice(-2)}`;
}

/**
 * Formats a masked preview string for card / speech.
 */
function maskEmail(email) {
  if (!email) return '';
  const parts = String(email).trim().split('@');
  if (parts.length !== 2) return maskIdentifier(email);
  const name = parts[0];
  const domain = parts[1];
  const maskedName = name.length <= 2 ? `${name}***` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${maskedName}@${domain}`;
}

function isValidEmail(email) {
  return EMAIL_REGEX.test(String(email || '').trim());
}

function cleanPhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '').slice(-10);
}

function isValidPhone(phone) {
  const digits = cleanPhone(phone);
  return PHONE_DIGITS_REGEX.test(digits);
}

function isValidGST(gst) {
  return GST_REGEX.test(String(gst || '').trim());
}

function isValidPAN(pan) {
  return PAN_REGEX.test(String(pan || '').trim());
}

function isValidPincode(pincode) {
  return PINCODE_REGEX.test(String(pincode || '').trim());
}

function isValidWebsite(website) {
  return WEBSITE_REGEX.test(String(website || '').trim());
}

/**
 * Extracts slot values from one-shot text or conversational input.
 */

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getIstNow(now = new Date()) {
  return new Date(now.getTime() + INDIA_OFFSET_MS);
}

function formatYmd(year, month, day) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

function getIstToday(now = new Date()) {
  const ist = getIstNow(now);
  return formatYmd(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

function getIstTomorrow(now = new Date()) {
  const ist = new Date(now.getTime() + INDIA_OFFSET_MS + 24 * 60 * 60 * 1000);
  return formatYmd(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

function calculateEndDate(startDate, months = 1) {
  if (!startDate) return '';
  const m = String(startDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    let year = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    month += parseInt(months, 10);
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    const pad = (n) => String(n).padStart(2, '0');
    const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const safeDay = Math.min(day, maxDays);
    return `${year}-${pad(month)}-${pad(safeDay)}`;
  }
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + parseInt(months, 10));
  return d.toISOString().split('T')[0];
}

const MONTH_MAP = {
  january: 1, jan: 1, 'जनवरी': 1,
  february: 2, feb: 2, 'फ़रवरी': 2, 'फरवरी': 2,
  march: 3, mar: 3, 'मार्च': 3,
  april: 4, apr: 4, 'अप्रैल': 4,
  may: 5, 'मई': 5,
  june: 6, jun: 6, 'जून': 6,
  july: 7, jul: 7, 'जुलाई': 7,
  august: 8, aug: 8, 'अगस्त': 8,
  september: 9, sep: 9, sept: 9, 'सितंबर': 9, 'सितम्बर': 9,
  october: 10, oct: 10, 'अक्टूबर': 10,
  november: 11, nov: 11, 'नवंबर': 11, 'नवम्बर': 11,
  december: 12, dec: 12, 'दिसंबर': 12, 'दिसम्बर': 12,
};

function normalizeDevanagariDigits(str) {
  return String(str || '').replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
}

function parseRelativeOrAbsoluteDate(raw, now = new Date()) {
  if (!raw || typeof raw !== 'string') return '';
  let str = normalizeDevanagariDigits(raw.trim().toLowerCase());

  // Strip prefixes / noise like "se", "ko", "date", "start date"
  str = str.replace(/^(?:date|start\s*date|tarikh|tareekh|from)\s*[:=]?\s*/i, '');

  const ist = getIstNow(now);
  const curYear = ist.getUTCFullYear();
  const curMonth = ist.getUTCMonth() + 1;
  const curDay = ist.getUTCDate();

  // 1. Relative keywords
  if (/\b(?:aaj|today|abhi)\b/i.test(str)) {
    return formatYmd(curYear, curMonth, curDay);
  }
  if (/\b(?:kal|tomorrow)\b/i.test(str) && !/\b(?:beeta|pehle|yesterday)\b/i.test(str)) {
    return getIstTomorrow(now);
  }
  if (/\b(?:parso|parson|day\s+after\s+tomorrow)\b/i.test(str)) {
    const d = new Date(now.getTime() + INDIA_OFFSET_MS + 2 * 24 * 60 * 60 * 1000);
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (/\b(?:tarso|tarson)\b/i.test(str)) {
    const d = new Date(now.getTime() + INDIA_OFFSET_MS + 3 * 24 * 60 * 60 * 1000);
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  // "N din baad / N days later"
  const daysMatch = str.match(/\b(\d+)\s*(?:din|days?)\s*(?:baad|bad|after|later)\b/i);
  if (daysMatch) {
    const n = parseInt(daysMatch[1], 10);
    const d = new Date(now.getTime() + INDIA_OFFSET_MS + n * 24 * 60 * 60 * 1000);
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  // "N hafte baad / N weeks later" or "next week / agle hafte"
  if (/\b(?:next\s*week|agle?\s*hafte)\b/i.test(str)) {
    const d = new Date(now.getTime() + INDIA_OFFSET_MS + 7 * 24 * 60 * 60 * 1000);
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const weeksMatch = str.match(/\b(\d+)\s*(?:hafte|hafta|weeks?)\s*(?:baad|bad|after|later)\b/i);
  if (weeksMatch) {
    const n = parseInt(weeksMatch[1], 10);
    const d = new Date(now.getTime() + INDIA_OFFSET_MS + n * 7 * 24 * 60 * 60 * 1000);
    return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  // "N mahine baad / N months later" or "next month / agle mahine"
  if (/\b(?:next\s*month|agle?\s*mahine)\b/i.test(str)) {
    let y = curYear;
    let m = curMonth + 1;
    if (m > 12) { m -= 12; y += 1; }
    const maxDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return formatYmd(y, m, Math.min(curDay, maxDays));
  }

  // 2. ISO format YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return formatYmd(y, m, d);
    }
  }

  // 3. DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  const ddmmyyyy = str.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (ddmmyyyy) {
    let y = parseInt(ddmmyyyy[3], 10);
    if (y < 100) y += 2000;
    const m = parseInt(ddmmyyyy[2], 10);
    const d = parseInt(ddmmyyyy[1], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return formatYmd(y, m, d);
    }
  }

  // 4. Textual month dates: "4 november 2026", "4th nov 2026", "4 nov", "4 नवंबर 2026"
  // Day Month Year pattern
  const dayMonthPattern = /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?|[./-])([a-zA-Z\u0900-\u097F]+)(?:(?:\s+|[./,-]+)(\d{2,4}))?\b/i;
  const dmMatch = str.match(dayMonthPattern);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const monthKey = dmMatch[2].toLowerCase();
    const month = MONTH_MAP[monthKey];
    if (month && day >= 1 && day <= 31) {
      let year = dmMatch[3] ? parseInt(dmMatch[3], 10) : curYear;
      if (year < 100) year += 2000;
      return formatYmd(year, month, day);
    }
  }

  // Month Day Year pattern: "november 4 2026", "nov 4th, 2026", "nov 4"
  const monthDayPattern = /\b([a-zA-Z\u0900-\u097F]+)(?:\s+)(\d{1,2})(?:st|nd|rd|th)?(?:(?:\s*,?\s*|[./,-]+)(\d{2,4}))?\b/i;
  const mdMatch = str.match(monthDayPattern);
  if (mdMatch) {
    const monthKey = mdMatch[1].toLowerCase();
    const month = MONTH_MAP[monthKey];
    const day = parseInt(mdMatch[2], 10);
    if (month && day >= 1 && day <= 31) {
      let year = mdMatch[3] ? parseInt(mdMatch[3], 10) : curYear;
      if (year < 100) year += 2000;
      return formatYmd(year, month, day);
    }
  }

  // 5. Native Date fallback for other English dates
  try {
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      return formatYmd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  } catch {}

  return '';
}

function extractCreateClientSlots(text, piiMap = {}) {
  const extracted = {};
  const clean = String(text || '').trim();

  // Incorporate already extracted PII
  if (piiMap.email && isValidEmail(piiMap.email)) extracted.email = piiMap.email;
  if (piiMap.phone && isValidPhone(piiMap.phone)) extracted.phone = cleanPhone(piiMap.phone);
  if (piiMap.gst && isValidGST(piiMap.gst)) extracted.gst = piiMap.gst.toUpperCase();
  if (piiMap.pan && isValidPAN(piiMap.pan)) extracted.pan = piiMap.pan.toUpperCase();
  if (piiMap.pincode && isValidPincode(piiMap.pincode)) extracted.pincode = piiMap.pincode;

  // Direct extraction for email / phone / gst / pan if not in piiMap
  if (!extracted.email) {
    const em = clean.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}/);
    if (em && isValidEmail(em[0])) extracted.email = em[0];
  }
  if (!extracted.phone) {
    const ph = clean.match(/(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/);
    if (ph) {
      const c = cleanPhone(ph[0]);
      if (isValidPhone(c)) extracted.phone = c;
    }
  }
  if (!extracted.gst) {
    const gstMatch = clean.match(/\b\d{2}[A-Za-z]{5}\d{4}[A-Za-z]{1}[1-9A-Za-z]{1}Z[0-9A-Za-z]{1}\b/);
    if (gstMatch && isValidGST(gstMatch[0])) extracted.gst = gstMatch[0].toUpperCase();
  }
  if (!extracted.pan) {
    const panMatch = clean.match(/\b[A-Za-z]{5}\d{4}[A-Za-z]{1}\b/);
    if (panMatch && isValidPAN(panMatch[0])) extracted.pan = panMatch[0].toUpperCase();
  }
  if (!extracted.pincode) {
    const pinMatch = clean.match(/\b\d{6}\b/);
    if (pinMatch && isValidPincode(pinMatch[0])) extracted.pincode = pinMatch[0];
  }

  // 1. Client Name extraction
  const clientExplicit = clean.match(/(?:client\s+(?:ka\s+naam|naam|name)|(?:client\s+)?name\s*(?:is|hai|:))\s*[:=]?\s*([a-zA-Z0-9\s_-]+?)(?=[.,;]|company|city|team|email|phone|gst|$)/iu);
  if (clientExplicit && clientExplicit[1] && !/^(?:kal|aaj|high|medium|active|banao|karo)/i.test(clientExplicit[1].trim())) {
    extracted.client = clientExplicit[1].trim();
  } else {
    const clientMatch = clean.match(/(?:(?:naya\s+client\s+banao|new\s+client\s+banao|new\s+client|client\s+banao|client\s+add\s+karo|create\s+client|(?:(?:नया|निया|नयी|नई)\s*)?(?:क्लाइंट|क्लाइन्ट|client)\s*(?:बनाओ|बना\s*दो|बनाइए|बनाइये|क्रिएट)))\s+([a-zA-Z0-9\s_-]+?)(?:,\s*|company|city|team|email|$)/iu);
    if (clientMatch && clientMatch[1] && !/^(?:kal|aaj|high|medium|active|banao|karo)/i.test(clientMatch[1].trim())) {
      extracted.client = clientMatch[1].trim();
    }
  }

  // 2. Company Name extraction
  const compMatch = clean.match(/(?:company\s*(?:ka\s+naam|name|naam)?\s*(?:is|hai|:)?)\s*[:=]?\s*([a-zA-Z0-9\s_.-]+?)(?=[.,;]|city|team|email|phone|gst|pan|$)/iu);
  if (compMatch && compMatch[1]) {
    const cName = compMatch[1].trim();
    if (!/^(?:kal|aaj|active|banao|karo|nahi)/i.test(cName)) {
      extracted.company = cName;
    }
  }

  // 3. City extraction
  const cityMatch = clean.match(/(?:city|sheher|shahar|शहर|सिटी)\s*(?:is|hai|:)?\s*([a-zA-Z\s_-]+?)(?=[.,;]|team|email|phone|gst|pan|state|$)/iu);
  if (cityMatch && cityMatch[1]) {
    const cCity = cityMatch[1].trim();
    if (!/^(?:kal|aaj|active|banao|karo|nahi)/i.test(cCity)) {
      extracted.city = cCity;
    }
  }

  // 3b. Status extraction
  const statusMatch = clean.match(/(?:client\s+)?status\s*(?:is|hai|:)?\s*(active|on\s*hold|inactive)/iu);
  if (statusMatch && statusMatch[1]) {
    const s = statusMatch[1].trim().toLowerCase();
    if (s.includes('hold')) extracted.status = 'On Hold';
    else if (s.includes('inactive')) extracted.status = 'Inactive';
    else extracted.status = 'Active';
  }

  // 4. Team / Project Manager extraction
  const teamMatch = clean.match(/(?:team\s*members?|team|manager|project\s*manager|managed\s+by|मेंबर्स|टीम)\s*(?:honge|mein|me|ko|hai|hain|:)?\s*([^\n\r,;]+?)(?=\s*(?:email|phone|gst|pan|city|status|$))/iu);
  if (teamMatch && teamMatch[1]) {
    const rawTeam = teamMatch[1].trim();
    if (!/^(?:active|high|medium|nahi|yes|no)/i.test(rawTeam)) {
      extracted.membersText = rawTeam;
    }
  }

  // 5. Industry
  const indMatch = clean.match(/(?:industry|ind)\s*(?:is|hai|:)?\s*([a-zA-Z0-9\s_-]+?)(?=[.,;]|gst|pan|website|$)/iu);
  if (indMatch && indMatch[1]) {
    extracted.industry = indMatch[1].trim();
  }

  // 6. Website
  const webMatch = clean.match(/(?:website|web|site)\s*(?:is|hai|:)?\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/iu);
  if (webMatch && webMatch[1]) {
    extracted.website = webMatch[1].trim();
  }

  // 7. Address & State & Country
  const addrMatch = clean.match(/(?:address|pata|पता)\s*(?:is|hai|:)?\s*([^\n\r,;]+)/iu);
  if (addrMatch && addrMatch[1]) {
    extracted.address = addrMatch[1].trim();
  }
  const stateMatch = clean.match(/(?:state|rajya|राज्य)\s*(?:is|hai|:)?\s*([a-zA-Z\s]+)/iu);
  if (stateMatch && stateMatch[1]) {
    extracted.state = stateMatch[1].trim();
  }

  // 8. Description & Notes
  const descMatch = clean.match(/(?:description|विवरण)\s*(?:is|hai|:)?\s*([^\n\r]+)/iu);
  if (descMatch && descMatch[1]) {
    extracted.description = descMatch[1].trim();
  }
  const notesMatch = clean.match(/(?:notes?|टिप्पणी)\s*(?:is|hai|:)?\s*([^\n\r]+)/iu);
  if (notesMatch && notesMatch[1]) {
    extracted.notes = notesMatch[1].trim();
  }


  // 9. Services
  const servMatch = clean.match(/(?:services?|service)\s*[:=]?\s*([^,;\n]+?)(?=\s*(?:,|$|\b(?:plan|shuru|start|team|city|company|industry|email|phone)\b))/iu);
  if (servMatch && servMatch[1]) {
    const rawServ = servMatch[1].trim();
    if (!/^(?:kal|aaj|active|banao|karo|nahi|done)/i.test(rawServ)) {
      extracted.servicesText = rawServ;
      const parts = rawServ.split(/\s*(?:,|\baur\b|\band\b)\s*/i)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/^(?:aur|and|services?|de\s*do|rakh\s*do)$/i.test(s));
      if (parts.length > 0) extracted.services = parts;
    }
  }

  // 10. Client Plan
  const planMatch = clean.match(/(?:(?:client\s+)?plan\s*[:=]?\s*([a-zA-Z0-9_-]+)|([a-zA-Z0-9_-]+)\s+plan)/iu);
  if (planMatch) {
    const rawPlan = (planMatch[1] || planMatch[2]).trim();
    if (!/^(?:nahi|no|none|cancel)$/i.test(rawPlan)) {
      extracted.clientPlan = rawPlan;
    } else {
      extracted.clientPlan = 'none';
    }
  }

  // 11. Subscription Start Date
  const startMatch = clean.match(/(?:(?:subscription\s+)?(?:start\s+date|shuru|start)\s*(?:tarikh|date)?\s*(?:is|hai|:)?\s*([^\n\r,;]+))/iu);
  if (startMatch && startMatch[1]) {
    const rawDate = startMatch[1].trim();
    const parsedDate = parseRelativeOrAbsoluteDate(rawDate);
    if (parsedDate) {
      extracted.subscriptionStartDate = parsedDate;
      extracted.subscriptionStartDateRaw = rawDate;
    }
  }

  // 12. Company Logo
  const logoMatch = clean.match(/(?:logo|company\s+logo)\s*(?:is|hai|:)?\s*([a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|webp))/iu);
  if (logoMatch && logoMatch[1]) {
    extracted.companyLogo = logoMatch[1].trim();
  }

  return extracted;
}

/**
 * Checks for duplicate client among accessible clients.
 */
function findDuplicateClient(clientName, companyName, accessibleClients = []) {
  if (!clientName || !Array.isArray(accessibleClients)) return null;
  const normClient = clientName.trim().toLowerCase();
  const normComp = companyName ? companyName.trim().toLowerCase() : '';

  // 1. Both match
  if (normComp) {
    const exactMatch = accessibleClients.find((c) => {
      const cName = (c.client || '').trim().toLowerCase();
      const compName = (c.company || '').trim().toLowerCase();
      return cName === normClient && compName === normComp;
    });
    if (exactMatch) {
      return { type: 'both', client: exactMatch };
    }
  }

  // 2. Client name match only
  const clientOnlyMatch = accessibleClients.find((c) => {
    const cName = (c.client || '').trim().toLowerCase();
    return cName === normClient;
  });
  if (clientOnlyMatch) {
    return { type: 'client_only', client: clientOnlyMatch };
  }

  return null;
}

module.exports = {
  EMAIL_REGEX,
  PHONE_DIGITS_REGEX,
  GST_REGEX,
  PAN_REGEX,
  PINCODE_REGEX,
  WEBSITE_REGEX,
  redactPIIForLLM,
  maskIdentifier,
  maskEmail,
  isValidEmail,
  isValidPhone,
  isValidGST,
  isValidPAN,
  isValidPincode,
  isValidWebsite,
  cleanPhone,
  calculateEndDate,
  parseRelativeOrAbsoluteDate,
  getIstToday,
  getIstTomorrow,
  extractCreateClientSlots,
  findDuplicateClient,
};

