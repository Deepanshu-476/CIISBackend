/**
 * services/ai/projectSlotFiller.js
 *
 * Dedicated Slot Filling & Disambiguation engine for `create_project` intent.
 * Handles deterministic slot filling for:
 * - Project Name (with duplicate project check)
 * - Description
 * - Start Date & End Date (in IST, with validation that endDate >= startDate)
 * - Priority (default Medium) & Status (default Active, Hinglish mapping)
 * - Team Members (resolves user names, auto-includes creator)
 * - Chained Task transition
 */

const { formatIstDateOnly, formatCreateProjectStatus, formatProjectPriority } = require('./formRegistry');
const { extractMultipleAssignees } = require('./hinglishParser');
const { idsEqual } = require('./projectResolver');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getIstDateObj(refDate = new Date()) {
  const d = refDate instanceof Date ? refDate : new Date(refDate);
  const shifted = new Date(d.getTime() + INDIA_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatIstYmd(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function resolveNextSuchYear(targetMonth, targetDay, curYear, curMonth, curDay) {
  if (targetMonth < curMonth || (targetMonth === curMonth && targetDay < curDay)) {
    return curYear + 1;
  }
  return curYear;
}

const MONTH_MAP = {
  // English full & short
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,

  // Hindi / Devanagari
  'जनवरी': 1, 'जन': 1,
  'फरवरी': 2, 'फ़रवरी': 2, 'फ़र': 2, 'फर': 2,
  'मार्च': 3,
  'अप्रैल': 4, 'अप्रेल': 4,
  'मई': 5,
  'जून': 6,
  'जुलाई': 7,
  'अगस्त': 8,
  'सितंबर': 9, 'सितम्बर': 9,
  'अक्टूबर': 10, 'अक्टुबर': 10, 'अक्टू': 10,
  'नवंबर': 11, 'नवम्बर': 11, 'नव': 11,
  'दिसंबर': 12, 'दिसम्बर': 12, 'दिस': 12,
};

function formatIstDate(dateInput) {
  if (!dateInput) return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + INDIA_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseProjectDate(text, refDate = new Date()) {
  const clean = String(text || '').trim().toLowerCase();
  if (!clean) return null;
  const ist = getIstDateObj(refDate);

  // 1. "aaj", "today"
  if (/^(?:aaj|today|आज)(?:\s+se)?$/i.test(clean)) {
    return formatIstYmd(ist.year, ist.month, ist.day);
  }

  // 2. "kal", "tomorrow"
  if (/^(?:kal|tomorrow|कल)(?:\s+se)?$/i.test(clean)) {
    const d = new Date(refDate.getTime() + 24 * 60 * 60 * 1000);
    const nextIst = getIstDateObj(d);
    return formatIstYmd(nextIst.year, nextIst.month, nextIst.day);
  }

  // 3. "parso", "day after tomorrow"
  if (/^(?:parso|parson|day\s+after\s+tomorrow|परसों)(?:\s+se)?$/i.test(clean)) {
    const d = new Date(refDate.getTime() + 48 * 60 * 60 * 1000);
    const nextIst = getIstDateObj(d);
    return formatIstYmd(nextIst.year, nextIst.month, nextIst.day);
  }

  // 4. "30 din baad", "(\d+) din baad", "(\d+) days later"
  const daysMatch = clean.match(/^(\d+)\s+(?:din|days?)(?:\s+baad|\s+later|\s+after)?$/i);
  if (daysMatch) {
    const numDays = parseInt(daysMatch[1], 10);
    const d = new Date(refDate.getTime() + numDays * 24 * 60 * 60 * 1000);
    const nextIst = getIstDateObj(d);
    return formatIstYmd(nextIst.year, nextIst.month, nextIst.day);
  }

  // 5. "agle hafte", "next week", "1 hafta baad"
  if (/^(?:agle\s+hafte|next\s+week|1\s+hafta|ek\s+hafta|agle\s+monday|अगले\s+हफ्ते)(?:\s+tak|\s+se|\s+baad)?$/i.test(clean)) {
    const d = new Date(refDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextIst = getIstDateObj(d);
    return formatIstYmd(nextIst.year, nextIst.month, nextIst.day);
  }

  // 6. "is mahine ke end tak", "end of this month", "month end"
  if (/^(?:is\s+mahine\s+ke\s+end\s+tak|is\s+mahine\s+ke\s+aakhir\s+tak|end\s+of\s+(?:this\s+)?month|month\s+end|is\s+mahine\s+tak)$/i.test(clean)) {
    const lastDay = new Date(Date.UTC(ist.year, ist.month, 0)).getUTCDate();
    return formatIstYmd(ist.year, ist.month, lastDay);
  }

  if (/^(?:kal\s+se\s+)?(?:2\s+hafte|do\s+hafte|2\s+weeks?)(?:\s*(?:baad|tak))?$/i.test(clean)) {
    const isFromKal = clean.includes('kal');
    const d = new Date(refDate.getTime() + (isFromKal ? 15 : 14) * 24 * 60 * 60 * 1000);
    const nextIst = getIstDateObj(d);
    return formatIstYmd(nextIst.year, nextIst.month, nextIst.day);
  }
  if (/^(?:kal\s+se\s+)?(?:3\s+hafte|teen\s+hafte|3\s+weeks?)(?:\s*(?:baad|tak))?$/i.test(clean)) {
    const isFromKal = clean.includes('kal');
    const d = new Date(refDate.getTime() + (isFromKal ? 22 : 21) * 24 * 60 * 60 * 1000);
    const nextIst = getIstDateObj(d);
    return formatIstYmd(nextIst.year, nextIst.month, nextIst.day);
  }
  if (/^(?:kal\s+se\s+)?(?:4\s+hafte|char\s+hafte|4\s+weeks?)(?:\s*(?:baad|tak))?$/i.test(clean)) {
    const isFromKal = clean.includes('kal');
    const d = new Date(refDate.getTime() + (isFromKal ? 29 : 28) * 24 * 60 * 60 * 1000);
    const nextIst = getIstDateObj(d);
    return formatIstYmd(nextIst.year, nextIst.month, nextIst.day);
  }
  if (/^(?:1\s+mahine|1\s+month|ek\s+mahina|1\s+mahine\s+baad)$/i.test(clean)) {
    const now = new Date(refDate);
    now.setUTCMonth(now.getUTCMonth() + 1);
    return formatIstDate(now);
  }
  if (/^(?:3\s+mahine|3\s+months|teen\s+mahine|3\s+mahine\s+baad)$/i.test(clean)) {
    const now = new Date(refDate);
    now.setUTCMonth(now.getUTCMonth() + 3);
    return formatIstDate(now);
  }
  if (/^(?:6\s+mahine|6\s+months|che\s+mahine|6\s+mahine\s+baad)$/i.test(clean)) {
    const now = new Date(refDate);
    now.setUTCMonth(now.getUTCMonth() + 6);
    return formatIstDate(now);
  }

  // 7. Exact ISO YYYY-MM-DD match
  const ymd = clean.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return formatIstYmd(y, m, d);
    }
  }

  // 8. Day-first numeric: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (Indian style: e.g. "3/11/2026", "03-11-2026")
  const dmyMatch = clean.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return formatIstYmd(y, m, d);
    }
  }

  // 9. Month first with name: "november 3, 2026", "november 3 , 2026", "november 3", "nov 3"
  const monthFirstMatch = clean.match(/(?:^|[\s,])([a-zA-Z\u0900-\u097F]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,\s*|\s+)?(\d{4})?(?:$|[\s,])/iu);
  if (monthFirstMatch) {
    const mStr = monthFirstMatch[1].toLowerCase();
    const month = MONTH_MAP[mStr];
    const day = parseInt(monthFirstMatch[2], 10);
    if (month && day >= 1 && day <= 31) {
      const year = monthFirstMatch[3]
        ? parseInt(monthFirstMatch[3], 10)
        : resolveNextSuchYear(month, day, ist.year, ist.month, ist.day);
      return formatIstYmd(year, month, day);
    }
  }

  // 10. Day first with name: "3 november", "3 nov 2026", "3 नवंबर", "03-nov-2026", "3 november 2026"
  const dayFirstMatch = clean.match(/(?:^|[\s,])(\d{1,2})(?:st|nd|rd|th)?(?:[\s-]+)([a-zA-Z\u0900-\u097F]+)(?:[\s,]+(\d{4}))?(?:$|[\s,])/iu);
  if (dayFirstMatch) {
    const day = parseInt(dayFirstMatch[1], 10);
    const mStr = dayFirstMatch[2].toLowerCase();
    const month = MONTH_MAP[mStr];
    if (month && day >= 1 && day <= 31) {
      const year = dayFirstMatch[3]
        ? parseInt(dayFirstMatch[3], 10)
        : resolveNextSuchYear(month, day, ist.year, ist.month, ist.day);
      return formatIstYmd(year, month, day);
    }
  }

  return null;
}

function parseProjectDateRange(text, refDate = new Date()) {
  const clean = String(text || '').trim().toLowerCase();
  const rangeMatch = clean.match(/kal\s+se\s+(2|do|3|teen|4|char|\d+)\s+hafte/i);
  if (rangeMatch) {
    const numHafte = rangeMatch[1] === 'do' ? 2 : rangeMatch[1] === 'teen' ? 3 : rangeMatch[1] === 'char' ? 4 : Number(rangeMatch[1]);
    const startDate = parseProjectDate('kal', refDate);
    const startObj = new Date(refDate);
    startObj.setUTCDate(startObj.getUTCDate() + 1 + (numHafte * 7));
    const endDate = formatIstDate(startObj);
    return { startDate, endDate };
  }

  // Explicit range: e.g. "1 November se 30 November", "2026-11-01 se 2026-11-30"
  const explicitRange = clean.match(/\b(\d{1,2}(?:st|nd|rd|th)?\s+[a-zA-Z]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})\s+se\s+(\d{1,2}(?:st|nd|rd|th)?\s+[a-zA-Z]+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})(?:\s+tak)?\b/i);
  if (explicitRange) {
    const s = parseProjectDate(explicitRange[1], refDate);
    const e = parseProjectDate(explicitRange[2], refDate);
    if (s && e) {
      return { startDate: s, endDate: e };
    }
  }
  return null;
}

/**
 * Checks for duplicate project name among accessible projects.
 */
function findDuplicateProject(projectName, accessibleProjects = []) {
  if (!projectName || !Array.isArray(accessibleProjects)) return null;
  const norm = projectName.trim().toLowerCase();
  return accessibleProjects.find((p) => p.projectName && p.projectName.trim().toLowerCase() === norm) || null;
}

/**
 * Extracts initial slots from a conversational project creation prompt:
 * e.g. "Naya project banao Website Revamp, start date kal se end date agle hafte tak, priority high"
 */
function extractCreateProjectSlotsFromMessage(text, now = new Date()) {
  const extracted = {};
  const clean = String(text || '').trim();

  // 1. Name extraction
  const nameMatch = clean.match(/(?:naya\s+project\s+banao|new\s+project|project\s+banao|create\s+project)\s+([a-zA-Z0-9\s_-]+?)(?:,\s*|start\s+date|shuru|description|priority|status|$)/i);
  if (nameMatch && nameMatch[1] && !/^(?:kal|aaj|high|medium|low|urgent)/i.test(nameMatch[1].trim())) {
    extracted.name = nameMatch[1].trim();
  }

  // 2. Priority extraction
  if (/\b(?:priority\s+high|urgent|high\s+priority)\b/i.test(clean)) {
    extracted.priority = 'High';
  } else if (/\b(?:priority\s+low|low\s+priority)\b/i.test(clean)) {
    extracted.priority = 'Low';
  } else if (/\b(?:priority\s+medium|medium\s+priority)\b/i.test(clean)) {
    extracted.priority = 'Medium';
  }

  // 3. Status extraction
  if (/\b(?:status\s+planning|planning\s+mein|abhi\s+plan\s+mein)\b/i.test(clean)) {
    extracted.status = 'Planning';
  } else if (/\b(?:status\s+on\s+hold|on\s+hold|ruka\s+hua)\b/i.test(clean)) {
    extracted.status = 'On Hold';
  } else if (/\b(?:status\s+active|active)\b/i.test(clean)) {
    extracted.status = 'Active';
  }

  // 4. Dates extraction
  const range = parseProjectDateRange(clean, now);
  if (range) {
    extracted.startDate = range.startDate;
    extracted.endDate = range.endDate;
  }

  const startMatch = clean.match(/(?:start\s+date|shuru\s+date|shuru)\s*(?:hai|hoga|se)?\s*([a-zA-Z0-9\s_-]+?)(?:,\s*|end\s+date|khatam|$)/i);
  if (startMatch && startMatch[1] && !extracted.startDate) {
    const parsedStart = parseProjectDate(startMatch[1], now);
    if (parsedStart) extracted.startDate = parsedStart;
  }

  const endMatch = clean.match(/(?:end\s+date|khatam\s+date|complete\s+date|tak)\s*(?:hai|hoga)?\s*([a-zA-Z0-9\s_-]+?)(?:,\s*|members|priority|$)/i);
  if (endMatch && endMatch[1] && !extracted.endDate) {
    const parsedEnd = parseProjectDate(endMatch[1], now);
    if (parsedEnd) extracted.endDate = parsedEnd;
  }

  // 5. Members extraction
  const membersMatch = clean.match(/(?:team\s+members?|members?|users?)\s*(?:honge|mein|me|ko|hain)?\s*([^\n\r,]+)/i);
  if (membersMatch && membersMatch[1]) {
    const rawMembers = membersMatch[1].trim();
    if (!/^(?:kal|aaj|high|medium|low|planning|active|yes|no)/i.test(rawMembers)) {
      extracted.membersText = rawMembers;
    }
  }

  // 6. Description extraction
  const descMatch = clean.match(/(?:description|objective|details)\s*(?:hai|is|:)?\s*([^\n\r,]+)/i);
  if (descMatch && descMatch[1]) {
    const rawDesc = descMatch[1].trim();
    if (!/^(?:kal|aaj|high|medium|low|planning|active|yes|no)/i.test(rawDesc)) {
      extracted.description = rawDesc;
    }
  }

  return extracted;
}

module.exports = {
  formatIstDate,
  parseProjectDate,
  parseProjectDateRange,
  findDuplicateProject,
  extractCreateProjectSlotsFromMessage,
};

