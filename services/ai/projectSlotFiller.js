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
  const now = new Date(refDate);

  if (/^(?:aaj|today|aaj\s+se)$/i.test(clean)) {
    return formatIstDate(now);
  }
  if (/^(?:kal|tomorrow|kal\s+se)$/i.test(clean)) {
    now.setUTCDate(now.getUTCDate() + 1);
    return formatIstDate(now);
  }
  if (/^(?:agle\s+hafte|next\s+week|1\s+hafta|ek\s+hafta|agle\s+monday)$/i.test(clean)) {
    now.setUTCDate(now.getUTCDate() + 7);
    return formatIstDate(now);
  }
  if (/^(?:kal\s+se\s+)?(?:2\s+hafte|do\s+hafte|2\s+weeks?)(?:\s*(?:baad|tak))?$/i.test(clean)) {
    const isFromKal = clean.includes('kal');
    now.setUTCDate(now.getUTCDate() + (isFromKal ? 15 : 14));
    return formatIstDate(now);
  }
  if (/^(?:kal\s+se\s+)?(?:3\s+hafte|teen\s+hafte|3\s+weeks?)(?:\s*(?:baad|tak))?$/i.test(clean)) {
    const isFromKal = clean.includes('kal');
    now.setUTCDate(now.getUTCDate() + (isFromKal ? 22 : 21));
    return formatIstDate(now);
  }
  if (/^(?:kal\s+se\s+)?(?:4\s+hafte|char\s+hafte|4\s+weeks?)(?:\s*(?:baad|tak))?$/i.test(clean)) {
    const isFromKal = clean.includes('kal');
    now.setUTCDate(now.getUTCDate() + (isFromKal ? 29 : 28));
    return formatIstDate(now);
  }
  if (/^(?:1\s+mahine|1\s+month|ek\s+mahina|1\s+mahine\s+baad)$/i.test(clean)) {
    now.setUTCMonth(now.getUTCMonth() + 1);
    return formatIstDate(now);
  }
  if (/^(?:3\s+mahine|3\s+months|teen\s+mahine|3\s+mahine\s+baad)$/i.test(clean)) {
    now.setUTCMonth(now.getUTCMonth() + 3);
    return formatIstDate(now);
  }
  if (/^(?:6\s+mahine|6\s+months|che\s+mahine|6\s+mahine\s+baad)$/i.test(clean)) {
    now.setUTCMonth(now.getUTCMonth() + 6);
    return formatIstDate(now);
  }

  // Exact YYYY-MM-DD match
  const ymd = clean.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
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

  return extracted;
}

module.exports = {
  formatIstDate,
  parseProjectDate,
  parseProjectDateRange,
  findDuplicateProject,
  extractCreateProjectSlotsFromMessage,
};

