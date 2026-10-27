const { taskDraftSchema, getSchemaForIntent } = require('./aiSchemas');
const { getModel } = require('./llm');
const { parseHinglishSlots, applyTitleFallback, isInvalidOrCommandTitle, isSkip, isSkipAll, isInitiationPhrase } = require('./hinglishParser');
const { consumeTaskBudget } = require('../../middleware/aiTaskBudget');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatIstReference(date = new Date()) {
  const shifted = new Date(date.getTime() + INDIA_OFFSET_MS);
  const pad = n => String(n).padStart(2, '0');
  const year = shifted.getUTCFullYear();
  const month = pad(shifted.getUTCMonth() + 1);
  const day = pad(shifted.getUTCDate());
  const hours = pad(shifted.getUTCHours());
  const minutes = pad(shifted.getUTCMinutes());
  const weekday = WEEKDAYS[shifted.getUTCDay()];

  return {
    dateString: `${year}-${month}-${day}`,
    timeString: `${hours}:${minutes}`,
    weekday,
    isoReference: `${year}-${month}-${day}T${hours}:${minutes}:00+05:30`
  };
}

/**
 * Merge deterministic parser slots and LLM extracted slots into accumulated draft.
 * Merge rule:
 * - Deterministic parser values win for date/time (dueDateTime).
 * - LLM values win for title/description unless empty.
 * - If title is still empty, title fallback applies.
 */
function mergeDraft(previous = {}, extracted = {}, deterministic = {}, rawMessage = '') {
  const prev = previous || {};
  const ext = extracted || {};
  const det = deterministic || {};

  // Title: LLM wins unless empty, else deterministic wins, else title fallback
  let title = null;
  const candidateAssignee = ext.assigneeName || det.assigneeName || prev.assigneeName || '';
  if (ext.title !== null && ext.title !== undefined && String(ext.title).trim() !== '') {
    title = String(ext.title).trim();
  } else if (det.title !== null && det.title !== undefined && String(det.title).trim() !== '') {
    title = String(det.title).trim();
  } else if (prev.title !== null && prev.title !== undefined && String(prev.title).trim() !== '') {
    title = String(prev.title).trim();
  } else {
    title = applyTitleFallback(null, rawMessage);
  }

  if (title && isInvalidOrCommandTitle(title, rawMessage, candidateAssignee)) {
    title = null;
  }

  // Description: LLM wins unless empty, else deterministic wins, else previous
  let description = null;
  if (ext.description !== null && ext.description !== undefined && String(ext.description).trim() !== '') {
    description = String(ext.description).trim();
  } else if (det.description !== null && det.description !== undefined && String(det.description).trim() !== '') {
    description = String(det.description).trim();
  } else {
    description = prev.description !== undefined && prev.description !== null ? prev.description : null;
  }

  // Due Date & Time: Deterministic wins for date/time, else LLM, else previous
  let dueDateTime = null;
  if (det.dueDateTime !== null && det.dueDateTime !== undefined) {
    dueDateTime = det.dueDateTime;
  } else if (ext.dueDateTime !== null && ext.dueDateTime !== undefined) {
    dueDateTime = ext.dueDateTime;
  } else {
    dueDateTime = prev.dueDateTime || null;
  }

  // Priority
  const priority = det.priority || ext.priority || prev.priority || null;

  // Status
  const status = det.status || ext.status || prev.status || null;

  // Checkpoints
  let checkpoints = prev.checkpoints || [];
  if (Array.isArray(det.checkpoints) && det.checkpoints.length > 0) {
    checkpoints = det.checkpoints;
  } else if (Array.isArray(ext.checkpoints) && ext.checkpoints.length > 0) {
    checkpoints = ext.checkpoints.map(c => (typeof c === 'string' ? { title: c, completed: false } : c));
  }

  // Reminder & options
  const reminder = det.reminder !== undefined ? det.reminder : (ext.reminder !== undefined && ext.reminder !== null ? ext.reminder : (prev.reminder !== undefined ? prev.reminder : null));
  const repeatIntervalMinutes = det.repeatIntervalMinutes !== undefined && det.repeatIntervalMinutes !== null
    ? det.repeatIntervalMinutes
    : (ext.repeatIntervalMinutes !== undefined && ext.repeatIntervalMinutes !== null ? ext.repeatIntervalMinutes : (prev.repeatIntervalMinutes || null));
  const minutesBeforeDue = det.minutesBeforeDue !== undefined && det.minutesBeforeDue !== null
    ? det.minutesBeforeDue
    : (ext.minutesBeforeDue !== undefined && ext.minutesBeforeDue !== null ? ext.minutesBeforeDue : (prev.minutesBeforeDue || null));
  const customTime = det.customTime || ext.customTime || prev.customTime || null;
  const reminderTime = det.reminderTime || ext.reminderTime || prev.reminderTime || null;

  let reminderOption = det.reminderOption || ext.reminderOption || prev.reminderOption || null;
  if (!reminderOption && reminder) {
    if (repeatIntervalMinutes) {
      reminderOption = repeatIntervalMinutes === 30 ? 'halfHourly' : (repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
    } else if (minutesBeforeDue) {
      reminderOption = minutesBeforeDue === 60 ? 'oneHourBefore' : 'beforeDue';
    } else if (customTime || reminderTime) {
      reminderOption = 'custom';
    } else {
      reminderOption = 'oneHourBefore';
    }
  }

  const priorityDays = det.priorityDays || ext.priorityDays || prev.priorityDays || null;
  const repeatPattern = det.repeatPattern || ext.repeatPattern || prev.repeatPattern || null;
  const repeatDays = ext.repeatDays || prev.repeatDays || [];
  const recurrenceEndDate = ext.recurrenceEndDate || prev.recurrenceEndDate || null;

  // Assignee: never overwrite a resolved assigneeId with null from a subsequent merge/turn
  let assigneeName = prev.assigneeName || null;
  let assigneeId = prev.assigneeId || null;
  let assigneeLabel = prev.assigneeLabel || null;

  const rawExtAssignee = ext.assigneeName || det.assigneeName;
  if (rawExtAssignee !== null && rawExtAssignee !== undefined) {
    const cleanExtName = String(rawExtAssignee).trim();
    const cleanPrevName = prev.assigneeName ? String(prev.assigneeName).trim() : '';

    if (cleanExtName && cleanExtName.toLowerCase() !== cleanPrevName.toLowerCase()) {
      // If we already have a resolved assigneeId, do NOT drop it unless explicitly reassigning
      const isExplicitReassign = /\b(?:assign|kisko|kiske\s*liye|ko\s*assign)\b/i.test(rawMessage);
      if (!prev.assigneeId || isExplicitReassign) {
        assigneeName = cleanExtName;
        assigneeId = null;
        assigneeLabel = null;
      }
    } else if (cleanExtName) {
      assigneeName = cleanExtName;
    }
  }

  let taskFor = prev.taskFor || 'self';
  let wantsOthers = Boolean(prev.wantsOthers);
  if (prev.intent === 'task_project' || prev.projectId || prev.taskFor === 'project') {
    taskFor = 'project';
  } else if (assigneeName || rawExtAssignee) {
    taskFor = 'others';
    wantsOthers = true;
  }
  const askCounts = typeof prev.askCounts === 'object' && prev.askCounts ? { ...prev.askCounts } : {};
  const skipped = Array.isArray(prev.skipped) ? [...prev.skipped] : [];
  const asked = Array.isArray(prev.asked) ? [...prev.asked] : [];
  const attachmentsCount = typeof prev.attachmentsCount === 'number' ? prev.attachmentsCount : 0;

  const projectName = det.projectName || ext.projectName || prev.projectName || null;
  const projectId = prev.projectId || null;
  const dueDate = det.dueDate || ext.dueDate || prev.dueDate || dueDateTime || null;

  return {
    projectName,
    projectId,
    title,
    description,
    dueDate,
    dueDateTime,
    priority,
    status,
    reminder,
    reminderOption,
    repeatIntervalMinutes,
    minutesBeforeDue,
    customTime,
    reminderTime,
    priorityDays,
    repeatPattern,
    repeatDays,
    recurrenceEndDate,
    checkpoints,
    assigneeName,
    assigneeId,
    assigneeLabel,
    branchId: prev.branchId || null,
    taskFor,
    wantsOthers,
    askCounts,
    skipped,
    asked,
    attachmentsCount,
  };
}

/**
 * Maps a provider error to a standardized internal code and logs a single sanitized line.
 * Never logs API keys or user prompts.
 */
function classifyAndLogGroqError(err) {
  const status = err?.status || err?.statusCode || err?.response?.status || err?.cause?.status || err?.cause?.statusCode;
  const rawCode = err?.code || err?.cause?.code || '';
  const rawMsg = String(err?.message || err?.cause?.message || '').replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
  const safeMsg = rawMsg.slice(0, 200);

  let mappedCode = null;

  if (status === 401 || status === 403 || /401|403|unauthorized|forbidden|invalid api key/i.test(rawMsg)) {
    mappedCode = 'LLM_AUTH';
  } else if (status === 404 || /404|model_not_found|model not found|does not exist/i.test(rawMsg)) {
    mappedCode = 'LLM_MODEL';
  } else if (status === 429 || /429|rate_limit|rate limit|too many requests/i.test(rawMsg)) {
    mappedCode = 'LLM_RATE_LIMIT';
  } else if (
    rawCode === 'ECONNRESET' ||
    rawCode === 'ETIMEDOUT' ||
    rawCode === 'ENOTFOUND' ||
    rawCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    err?.name === 'TimeoutError' ||
    /timeout|connect|network|fetch failed|econnrefused/i.test(rawMsg)
  ) {
    mappedCode = 'LLM_NETWORK';
  }

  const logStatus = status || 'none';
  const logCode = mappedCode || rawCode || 'UNKNOWN';
  console.error(`[ai] groq error status=${logStatus} code=${logCode} msg=${safeMsg}`);

  if (mappedCode) {
    const error = new Error(safeMsg);
    error.code = mappedCode;
    error.status = status;
    error.cause = err;
    return error;
  }

  return null;
}

function normaliseExtracted(data, message = '') {
  let title = typeof data?.title === 'string' ? data.title.trim() : null;
  if (title === '' || title?.toLowerCase() === 'null') title = null;
  if (title) {
    const titleCutMatch = title.match(/^(.+?)(?:\.\s+|\s+(?:description|details|priority|due|deadline|reminder|kal|aaj|tomorrow)\b)/i);
    if (titleCutMatch && titleCutMatch[1]) {
      title = titleCutMatch[1];
    }
    title = title.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
    title = title.replace(/^(?:task\s+naam|task\s+name|title|task\s+title)\s*[:=\-]?\s*/i, '');
    title = title.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
    if (title.length > 80) {
      title = title.slice(0, 80).trim();
    }
    if (isInitiationPhrase(title)) {
      title = null;
    }
  }

  let description = typeof data?.description === 'string' ? data.description.trim() : null;
  if (description === '' || description?.toLowerCase() === 'null') description = null;
  if (description) {
    const descCutMatch = description.match(/^(.+?)(?:\.\s+(?:priority|due|deadline|reminder|kal|aaj|tomorrow)|(?:\.\s+)?\b(?:priority|due|deadline|reminder|kal\s+subah|kal\s+shaam|aaj\s+shaam|today|tomorrow)\b)/i);
    if (descCutMatch && descCutMatch[1]) {
      description = descCutMatch[1];
    }
    description = description.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
    description = description.replace(/^(?:description|details|vivaran)\s*[:=\-]?\s*/i, '');
    description = description.replace(/^[.,;:\s]+|[.,;:\s]+$/g, '').trim();
  }

  let assigneeName = typeof data?.assigneeName === 'string' ? data.assigneeName.trim() : null;
  if (
    assigneeName === '' ||
    assigneeName?.toLowerCase() === 'null' ||
    assigneeName?.toLowerCase() === 'none' ||
    assigneeName?.toLowerCase() === 'undefined'
  ) {
    assigneeName = null;
  }

  // IGNORE self-introductions in assignee:
  // e.g. "my name is Kanika", "hello my name is Kanika", "i am Kanika", "mera naam Kanika"
  if (assigneeName && message) {
    const selfIntroMatch = message.match(/\b(?:my\s+name\s+is|i\s+am|mera\s+naam|main\s+hoon)\s+([a-zA-Z\u0900-\u097F]+)/i);
    if (selfIntroMatch && selfIntroMatch[1] && !/\b(?:assign\s+to|ko\s+assign|task\s+to)\b/i.test(message)) {
      if (selfIntroMatch[1].trim().toLowerCase() === assigneeName.toLowerCase()) {
        assigneeName = null;
      }
    }
  }

  const checkpoints = (Array.isArray(data?.checkpoints) ? data.checkpoints : [])
    .map(c => (typeof c === 'string' ? c.trim() : (typeof c?.title === 'string' ? c.title.trim() : '')))
    .filter(Boolean)
    .slice(0, 10);

  let dueDateTime = null;
  if (data?.dueDateTime && typeof data.dueDateTime === 'string') {
    const trimmedDue = data.dueDateTime.trim();
    const parsedTimestamp = Date.parse(trimmedDue);
    if (!isNaN(parsedTimestamp)) {
      dueDateTime = trimmedDue;
    }
  }

  let reminder = null;
  if (typeof data?.reminder === 'boolean') {
    reminder = data.reminder;
  }

  let repeatIntervalMinutes = typeof data?.repeatIntervalMinutes === 'number' && data.repeatIntervalMinutes > 0
    ? data.repeatIntervalMinutes
    : null;
  let minutesBeforeDue = typeof data?.minutesBeforeDue === 'number' && data.minutesBeforeDue > 0
    ? data.minutesBeforeDue
    : null;
  let customTime = typeof data?.customTime === 'string' && data.customTime.trim() ? data.customTime.trim() : null;
  let reminderTime = typeof data?.reminderTime === 'string' && data.reminderTime.trim() ? data.reminderTime.trim() : null;

  let reminderOption = null;
  if (data?.reminderOption && ['hourly', 'halfHourly', 'oneHourBefore', 'interval', 'beforeDue', 'custom'].includes(data.reminderOption)) {
    reminderOption = data.reminderOption;
  } else if (reminder) {
    if (repeatIntervalMinutes) {
      reminderOption = repeatIntervalMinutes === 30 ? 'halfHourly' : (repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
    } else if (minutesBeforeDue) {
      reminderOption = minutesBeforeDue === 60 ? 'oneHourBefore' : 'beforeDue';
    } else if (customTime || reminderTime) {
      reminderOption = 'custom';
    } else {
      reminderOption = 'oneHourBefore';
    }
  }

  let status = null;
  if (data?.status && ['pending', 'in-progress', 'completed', 'approved', 'rejected', 'onhold', 'reopen', 'cancelled', 'overdue', 'in progress', 'on hold'].includes(data.status)) {
    status = data.status;
  }

  const projectName = typeof data?.projectName === 'string' && data.projectName.trim() ? data.projectName.trim() : null;
  const dueDate = data?.dueDate || dueDateTime || null;

  return {
    projectName,
    title,
    description,
    checkpoints,
    priority: data?.priority || null,
    status,
    dueDate,
    dueDateTime,
    assigneeName,
    reminder,
    reminderOption,
    repeatIntervalMinutes,
    minutesBeforeDue,
    customTime,
    reminderTime,
    priorityDays: data?.priorityDays !== null && data?.priorityDays !== undefined ? String(data.priorityDays).trim() : null,
    repeatPattern: data?.repeatPattern || null,
    repeatDays: Array.isArray(data?.repeatDays) ? data.repeatDays : [],
    recurrenceEndDate: data?.recurrenceEndDate || null,
  };
}

/**
 * Technical term dictionary to convert Devanagari transliterations of English technical terms
 * back to standard English spelling.
 */
function restoreEnglishTechnicalTerms(text) {
  if (!text) return text;
  const map = {
    'पाइपलाइन': 'pipeline',
    'कनेक्शन': 'connection',
    'डेटाबेस': 'database',
    'सर्वर': 'server',
    'माइग्रेशन': 'migration',
    'बैकअप': 'backup',
    'क्लाइंट': 'client',
    'डेमो': 'demo',
    'प्रेजेंटेशन': 'presentation',
    'रिपोर्ट': 'report',
    'सॉफ्टवेयर': 'software',
    'प्रोजेक्ट': 'project',
  };
  let result = text;
  for (const [hindi, english] of Object.entries(map)) {
    result = result.split(hindi).join(english);
  }
  return result;
}

async function extractTaskDraft({ message, now = new Date(), previousDraft = null, model = null, req = null, intent = null, canAssignOthers = false }) {
  const llm = model || getModel({ temperature: 0, maxTokens: 1500 });
  const schema = intent && getSchemaForIntent ? getSchemaForIntent(intent, canAssignOthers) : taskDraftSchema;
  const structuredLlm = llm.withStructuredOutput(schema, { name: 'task_draft' });
  const ref = formatIstReference(now);
  const tomorrowIst = new Date(now.getTime() + INDIA_OFFSET_MS + 24 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const tomorrowDateStr = `${tomorrowIst.getUTCFullYear()}-${pad(tomorrowIst.getUTCMonth() + 1)}-${pad(tomorrowIst.getUTCDate())}`;

  const systemPrompt = `You are a precise task extraction engine for an Indian enterprise workforce management system.
Your role is to strictly extract task draft details from the user's message in English, Hinglish, or Devanagari Hindi into the specified schema.

Current Reference Time (Asia/Kolkata timezone, UTC+05:30):
- Current Date: ${ref.dateString}
- Current Day of Week: ${ref.weekday}
- Current Time: ${ref.timeString} (+05:30)

RULES FOR EXTRACTION:
1. SPEECH-TO-TEXT ROBUSTNESS & NOISE TOKENS:
   - Tolerate common speech-to-text (STT) phonetic errors:
     * "cal" -> "kal" (tomorrow)
     * "vah" / "woh" -> it / that
     * "jaega" / "jayega" -> will be
     * "aj" / "aaj" -> today
   - STT transcripts often insert filler/noise words such as "jn", "jan", "ok", "so", "uh", "um" before dates, times, or keywords (e.g. "due date, jn tomorrow 10:10 am" -> due tomorrow 10:10 am). Ignore these noise tokens completely!
   - When the input contains Devanagari Hindi, convert the extracted title and description into Roman Hinglish, and restore English technical terms into standard English spelling (e.g. "पाइपलाइन" -> "pipeline", "डेटाबेस" -> "database", "बैकअप" -> "backup").
   - NEVER invent or hallucinate values not mentioned in the message or previous draft.

2. GREETINGS & SELF-INTRODUCTIONS:
   - Users frequently start with self-introductions or greetings: "Hello", "Hi", "Namaste", "My name is <X>", "I am <X>", "Mera naam <X> hai".
   - IGNORE self-introductions! The person speaking is NOT the assignee and their name is NOT the task title.
   - Set assigneeName to null unless the message explicitly commands assigning to another person (e.g., "assign to <Name>", "<Name> ko assign").

3. RELATIVE DATES & TIMES:
   - "aaj", "aj", "today" -> ${ref.dateString}
   - "kal", "cal", "kl", "tomorrow" -> target tomorrow date (${tomorrowDateStr})
   - "parso", "day after tomorrow" -> target date 2 days after ${ref.dateString}
   - "subah", "morning", "AM" explicitly indicates AM (e.g. "subah 10:00" -> 10:00:00).
   - "shaam", "sham", "evening", "PM" indicates PM (e.g. "shaam 6 baje" -> 18:00:00).
   - "dopahar", "afternoon" indicates PM (e.g. "dopahar 2 baje" -> 14:00:00).
   - "raat", "night" indicates PM.
   - Format dueDateTime strictly as ISO-8601 with +05:30 timezone offset (e.g. "YYYY-MM-DDTHH:mm:ss+05:30").

4. TITLE & DESCRIPTION EXTRACTION:
   - "task name is X", "task naam X", "title is X", "task is X", "call it X", "name it X", "uska naam yah/yeh X ho" -> title is "X"
   - "description, Y", "description Y", "details Y", "uska description Y" -> description is "Y"
   - CUT VALUES AT SENTENCE BOUNDARIES (". ") and at the next field keyword ("description", "priority", "due", "deadline", "reminder", "repeat", "checkpoints", "kal", "aaj", "tomorrow", "aur", "and").
   - NEVER let the title absorb subsequent sentences or field keywords like "Description ...", "Priority ...", or "Kal ...".
   - Clean all leading and trailing punctuation (periods, commas, colons) from title and description.

5. REMINDER EXTRACTION:
   - "reminder on", "reminder lagao", "reminder 1 hour baad", "reminder 1 ghante baad", "reminder 1 hour pehle", "1 hour baad reminder" -> reminder: true, reminderOption: "oneHourBefore"
   - "har 1 ghante me reminder", "every hour reminder", "hourly reminder" -> reminder: true, reminderOption: "hourly"
   - "har 30 min me reminder", "aadhe ghante me reminder", "half hour reminder" -> reminder: true, reminderOption: "halfHourly"
   - "reminder nahi chahiye", "reminder off", "no reminder" -> reminder: false, reminderOption: null

6. STATUS EXTRACTION:
   - "in progress", "status in progress", "chal raha hai", "chalu" -> status: "in-progress"
   - "completed", "status completed", "done", "complete", "khatam" -> status: "completed"
   - "on hold", "status on hold", "hold par" -> status: "onhold"
   - "pending", "status pending" -> status: "pending"
   - "rejected" -> status: "rejected"
   - "cancelled" -> status: "cancelled"
   - "overdue" -> status: "overdue"
   - "reopen" -> status: "reopen"

FEW-SHOT EXAMPLES:
Example 1:
User: "Hello, my name is Kanika and task name is A Voice Assistant, description, creating pipeline of A Voice Assistant, priority high due date, jn tomorrow 10:10 am"
Output:
{
  "title": "A Voice Assistant",
  "description": "Creating pipeline of A Voice Assistant",
  "dueDateTime": "${tomorrowDateStr}T10:10:00+05:30",
  "priority": "high",
  "checkpoints": [],
  "assigneeName": null
}

Example 2:
User: "task name is Database backup, priority low, deadline today 6 pm"
Output:
{
  "title": "Database backup",
  "description": null,
  "dueDateTime": "${ref.dateString}T18:00:00+05:30",
  "priority": "low",
  "checkpoints": [],
  "assigneeName": null
}

Example 3:
User: "title: GST report description: Q3 filing due tomorrow 10 am"
Output:
{
  "title": "GST report",
  "description": "Q3 filing",
  "dueDateTime": "${tomorrowDateStr}T10:00:00+05:30",
  "priority": null,
  "checkpoints": [],
  "assigneeName": null
}

Example 4:
User: "Mera task create karo uska naam yah voice change ho aur uska description pipeline connection and vah cal Subah 10:00 complete ho jaega"
Output:
{
  "title": "Voice change",
  "description": "Pipeline connection",
  "dueDateTime": "${tomorrowDateStr}T10:00:00+05:30",
  "priority": null,
  "checkpoints": [],
  "assigneeName": null
}

Example 5:
User: "Task naam Voice Assistant. Description creating pipeline. Priority high. Kal subah 10 baje."
Output:
{
  "title": "Voice Assistant",
  "description": "Creating pipeline",
  "dueDateTime": "${tomorrowDateStr}T10:00:00+05:30",
  "priority": "high",
  "checkpoints": [],
  "assigneeName": null
}`;

  const cleanMessage = restoreEnglishTechnicalTerms(String(message || '').trim());
  const userPrompt = `USER MESSAGE TO EXTRACT:\n"""\n${cleanMessage}\n"""`;

  const inputMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  let rawResult;
  try {
    rawResult = await structuredLlm.invoke(inputMessages);
    // Increment budget ONLY on successful LLM call
    if (req) {
      await consumeTaskBudget(req).catch(err => console.error('consumeTaskBudget error:', err.message));
    }
  } catch (firstErr) {
    const providerErr = classifyAndLogGroqError(firstErr);
    if (providerErr && (providerErr.code === 'LLM_AUTH' || providerErr.code === 'LLM_MODEL')) {
      throw providerErr;
    }
    if (providerErr && providerErr.code === 'LLM_RATE_LIMIT') {
      return null;
    }

    try {
      rawResult = await structuredLlm.invoke(inputMessages);
      if (req) {
        await consumeTaskBudget(req).catch(err => console.error('consumeTaskBudget error:', err.message));
      }
    } catch (secondErr) {
      classifyAndLogGroqError(secondErr);
      // PART C Rule 4: DO NOT fail the whole turn on LLM error. Return null so deterministic parser result is used.
      return null;
    }
  }

  const parsed = (schema || taskDraftSchema).safeParse(rawResult);
  if (!parsed.success) {
    console.error(`[ai] groq error status=none code=LLM_BAD_OUTPUT msg=schema validation failed: ${parsed.error.message.slice(0, 200)}`);
    return null;
  }

  return normaliseExtracted(parsed.data, message);
}

module.exports = {
  extractTaskDraft,
  mergeDraft,
  normaliseExtracted,
  classifyAndLogGroqError,
  formatIstReference,
  restoreEnglishTechnicalTerms,
};
