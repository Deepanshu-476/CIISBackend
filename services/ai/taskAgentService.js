const mongoose = require('mongoose');
const { extractTaskDraft, mergeDraft } = require('./taskExtractor');
const { getScopeInfo, isAssigneeInScope } = require('./taskScope');
const { resolveAssignee, escapeRegex } = require('./assigneeResolver');
const { getModelName } = require('./llm');
const { TASK_FIELDS, TASK_FIELD_ORDER } = require('./taskFields');
const { parseHinglishSlots, isSkip, isSkipAll, isSelfPhrase, isFillerPhrase, extractAssigneeMention } = require('./hinglishParser');
const { detectUserIntent, normalizeTranscript } = require('./sttNormalizer');
const User = require('../../models/User');
const Department = require('../../models/Department');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getIstDateShifted(d = new Date()) {
  return new Date(d.getTime() + INDIA_OFFSET_MS);
}

function formatHumanIstDate(dateString) {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;
  const shifted = new Date(d.getTime() + INDIA_OFFSET_MS);
  const day = shifted.getUTCDate();
  const month = MONTHS[shifted.getUTCMonth()];
  const year = shifted.getUTCFullYear();
  let hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
}

function formatAssigneeLabel(user, deptName = '') {
  const parts = [user.name];
  if (user.employeeId) parts.push(`(${user.employeeId})`);
  const extra = [user.jobRole && user.jobRole !== 'user' ? user.jobRole : '', deptName].filter(Boolean).join(' • ');
  if (extra) parts.push(`— ${extra}`);
  return parts.join(' ');
}

function getCleanCheckpoints(checkpoints) {
  if (!Array.isArray(checkpoints)) return [];
  return checkpoints
    .map((c) => {
      if (typeof c === 'string') return { title: c.trim(), completed: false };
      if (c && typeof c === 'object' && c.title) return { title: String(c.title).trim(), completed: Boolean(c.completed) };
      return null;
    })
    .filter((c) => c && c.title);
}

function buildReminderPayload(settings = {}) {
  const enabled = Boolean(settings.enabled);
  if (!enabled) {
    return {
      enabled: false,
      options: [],
      reminderTime: null,
      customTime: null,
      repeatIntervalMinutes: null,
      minutesBeforeDue: null,
    };
  }

  const options = Array.isArray(settings.options) ? [...settings.options] : [];
  if (settings.reminderOption && !options.includes(settings.reminderOption)) {
    options.push(settings.reminderOption);
  }

  const repeatIntervalMinutes = settings.repeatIntervalMinutes ? Number(settings.repeatIntervalMinutes) : null;
  if (repeatIntervalMinutes && !options.includes('interval')) {
    options.push('interval');
  }

  const minutesBeforeDue = settings.minutesBeforeDue ? Number(settings.minutesBeforeDue) : null;
  if (minutesBeforeDue && !options.includes('beforeDue') && settings.reminderOption !== 'oneHourBefore') {
    options.push('beforeDue');
  }

  const customTime = settings.customTime || (settings.reminderTime ? (settings.reminderTime instanceof Date ? settings.reminderTime.toISOString() : String(settings.reminderTime)) : null);
  if (customTime && !options.includes('custom')) {
    options.push('custom');
  }

  if (options.length === 0) {
    options.push('oneHourBefore');
  }

  return {
    enabled: true,
    options: [...new Set(options)],
    reminderTime: settings.reminderTime || (customTime ? new Date(customTime) : null),
    customTime: customTime || null,
    repeatIntervalMinutes: repeatIntervalMinutes || null,
    minutesBeforeDue: minutesBeforeDue || null,
  };
}

async function parseTaskRequest({
  req,
  message,
  language = 'hinglish',
  draft = {},
  pick = null,
  action = null,
}, deps = {}) {
  const now = deps.now instanceof Date ? deps.now : new Date();
  const extractFn = deps.extractFn || extractTaskDraft;
  const scopeInfoFn = deps.getScopeInfo || getScopeInfo;
  const isAssigneeInScopeFn = deps.isAssigneeInScope || isAssigneeInScope;
  const resolveAssigneeFn = deps.resolveAssignee || resolveAssignee;
  const UserModel = deps.User || User;
  const DeptModel = deps.Department || Department;
  const modelName = deps.getModelName ? deps.getModelName() : getModelName();

  // Initialize draft structure
  const currentDraft = {
    title: draft?.title ?? null,
    description: draft?.description ?? null,
    dueDateTime: draft?.dueDateTime ?? null,
    priority: draft?.priority ?? null,
    status: draft?.status ?? null,
    reminder: draft?.reminder ?? null,
    reminderOption: draft?.reminderOption ?? null,
    repeatIntervalMinutes: draft?.repeatIntervalMinutes ?? null,
    minutesBeforeDue: draft?.minutesBeforeDue ?? null,
    customTime: draft?.customTime ?? null,
    reminderTime: draft?.reminderTime ?? null,
    priorityDays: draft?.priorityDays ?? null,
    repeatPattern: draft?.repeatPattern ?? null,
    repeatDays: Array.isArray(draft?.repeatDays) ? [...draft.repeatDays] : [],
    recurrenceEndDate: draft?.recurrenceEndDate ?? null,
    checkpoints: Array.isArray(draft?.checkpoints) ? [...draft.checkpoints] : [],
    assigneeName: draft?.assigneeName ?? null,
    assigneeId: draft?.assigneeId ?? null,
    assigneeLabel: draft?.assigneeLabel ?? null,
    branchId: draft?.branchId ?? null,
    taskFor: draft?.taskFor || 'self',
    wantsOthers: Boolean(draft?.wantsOthers),
    askCounts: typeof draft?.askCounts === 'object' && draft?.askCounts ? { ...draft.askCounts } : {},
    skipped: Array.isArray(draft?.skipped) ? [...draft.skipped] : [],
    asked: Array.isArray(draft?.asked) ? [...draft.asked] : [],
    attachmentsCount: typeof draft?.attachmentsCount === 'number' ? draft.attachmentsCount : 0,
  };

  // Snapshot initially filled fields before turn execution
  const initialFilled = {
    title: Boolean(draft?.title && String(draft.title).trim()),
    description: Boolean(draft?.description !== null && draft?.description !== undefined && String(draft.description).trim()),
    dueDateTime: Boolean(draft?.dueDateTime && new Date(draft.dueDateTime).getTime() > now.getTime()),
    priority: Boolean(draft?.priority),
    status: Boolean(draft?.status),
    assignee: Boolean(draft?.assigneeId || (draft?.taskFor === 'others' && draft?.assigneeName)),
    reminder: Boolean(draft?.reminder !== null && draft?.reminder !== undefined),
    priorityDays: Boolean(draft?.priorityDays),
    repeatPattern: Boolean(draft?.repeatPattern),
    checkpoints: Boolean(Array.isArray(draft?.checkpoints) && draft.checkpoints.length > 0),
  };

  const initialValues = {
    title: draft?.title ?? null,
    description: draft?.description ?? null,
    dueDateTime: draft?.dueDateTime ?? null,
    priority: draft?.priority ?? null,
    status: draft?.status ?? null,
    reminder: draft?.reminder ?? null,
    reminderOption: draft?.reminderOption ?? null,
    repeatIntervalMinutes: draft?.repeatIntervalMinutes ?? null,
    minutesBeforeDue: draft?.minutesBeforeDue ?? null,
    assigneeId: draft?.assigneeId ?? null,
    assigneeName: draft?.assigneeName ?? null,
  };

  const notices = [];
  let candidates = [];

  // Determine user scope
  const scope = await scopeInfoFn(req, deps);
  const canAssignOthers = Boolean(scope?.hasAccess);

  const companyId = req.user?.company?._id || req.user?.company || req.user?.companyId;
  const rawCompanyCode = req.user?.companyCode || req.user?.company?.companyCode || '';
  const baseCode = typeof rawCompanyCode === 'string' ? rawCompanyCode.split('-')[0].trim() : '';
  const companyCodeFilter = baseCode
    ? { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') }
    : (rawCompanyCode || undefined);

  // Determine the active field that was asked on the previous turn
  const lastAskedField = currentDraft.asked.length > 0
    ? currentDraft.asked[currentDraft.asked.length - 1]
    : null;

  // -------------------------------------------------------------
  // STEP 1: Handle deterministic action or pick (NO LLM, FREE)
  // -------------------------------------------------------------
  let actionHandled = false;
  let wantsEditPrompt = false;

  if (action && typeof action === 'object') {
    actionHandled = true;
    switch (action.type) {
      case 'set':
        if (action.field === 'taskFor') {
          currentDraft.taskFor = action.value === 'others' ? 'others' : 'self';
          if (action.value === 'others') {
            currentDraft.wantsOthers = true;
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
          } else {
            currentDraft.wantsOthers = false;
            currentDraft.assigneeId = null;
            currentDraft.assigneeName = null;
            currentDraft.assigneeLabel = null;
            if (!currentDraft.skipped.includes('assignee')) currentDraft.skipped.push('assignee');
          }
        } else if (action.field === 'reminder') {
          currentDraft.reminder = Boolean(action.value);
          if (currentDraft.reminder) {
            currentDraft.reminderOption = currentDraft.reminderOption || 'oneHourBefore';
          } else {
            currentDraft.reminderOption = null;
            currentDraft.repeatIntervalMinutes = null;
            currentDraft.minutesBeforeDue = null;
            currentDraft.customTime = null;
            currentDraft.reminderTime = null;
          }
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder');
        } else if (action.field === 'reminderOption') {
          currentDraft.reminderOption = action.value || 'oneHourBefore';
          currentDraft.reminder = true;
          if (action.value === 'hourly') currentDraft.repeatIntervalMinutes = 60;
          if (action.value === 'halfHourly') currentDraft.repeatIntervalMinutes = 30;
          if (action.value === 'oneHourBefore') currentDraft.minutesBeforeDue = null;
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
        } else if (action.field === 'repeatIntervalMinutes') {
          currentDraft.repeatIntervalMinutes = Number(action.value);
          currentDraft.reminder = true;
          currentDraft.reminderOption = currentDraft.repeatIntervalMinutes === 30 ? 'halfHourly' : (currentDraft.repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
        } else if (action.field === 'minutesBeforeDue') {
          currentDraft.minutesBeforeDue = Number(action.value);
          currentDraft.reminder = true;
          currentDraft.reminderOption = currentDraft.minutesBeforeDue === 60 ? 'oneHourBefore' : 'beforeDue';
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
        } else if (action.field === 'customTime' || action.field === 'reminderTime') {
          currentDraft.customTime = action.value;
          currentDraft.reminderTime = action.value;
          currentDraft.reminder = true;
          currentDraft.reminderOption = 'custom';
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
        } else if (action.field) {
          currentDraft[action.field] = action.value;
          if (!currentDraft.asked.includes(action.field)) currentDraft.asked.push(action.field);
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== action.field);
        }
        break;
      case 'skip': {
        const targetField = action.field || lastAskedField;
        if (targetField) {
          if (!currentDraft.skipped.includes(targetField)) currentDraft.skipped.push(targetField);
          if (targetField === 'description') currentDraft.description = '';
          if (targetField === 'priority') currentDraft.priority = 'medium';
          if (targetField === 'status') currentDraft.status = 'pending';
          if (targetField === 'reminder') currentDraft.reminder = false;
          if (targetField === 'priorityDays') currentDraft.priorityDays = '1';
          if (targetField === 'repeatPattern') currentDraft.repeatPattern = 'none';
          if (targetField === 'checkpoints') currentDraft.checkpoints = [];
          if (targetField === 'attachments') currentDraft.attachmentsCount = 0;
        }
        break;
      }
      case 'skip_all': {
        const allOptional = ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments'];
        allOptional.forEach((fieldKey) => {
          if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
          if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
            if (fieldKey === 'description') currentDraft.description = '';
            if (fieldKey === 'priority') currentDraft.priority = 'medium';
            if (fieldKey === 'status') currentDraft.status = 'pending';
            if (fieldKey === 'reminder') currentDraft.reminder = false;
            if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
            if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
            if (fieldKey === 'attachments') currentDraft.attachmentsCount = 0;
          }
        });
        break;
      }
      case 'attachments':
        currentDraft.attachmentsCount = Number(action.count || 0);
        if (!currentDraft.asked.includes('attachments')) currentDraft.asked.push('attachments');
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'attachments');
        break;
      case 'ask':
        if (action.field) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== action.field);
          currentDraft[action.field] = null;
          if (action.field === 'reminder') {
            currentDraft.reminder = null;
            currentDraft.reminderOption = null;
            currentDraft.repeatIntervalMinutes = null;
            currentDraft.minutesBeforeDue = null;
            currentDraft.customTime = null;
          }
          currentDraft.asked = currentDraft.asked.filter((f) => f !== action.field);
        }
        break;
      case 'edit':
        if (action.field === 'assignee') {
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
          currentDraft.assigneeId = null;
          currentDraft.assigneeName = null;
          currentDraft.assigneeLabel = null;
        } else if (action.field) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== action.field);
          currentDraft[action.field] = null;
          currentDraft.asked = currentDraft.asked.filter((f) => f !== action.field);
        } else {
          wantsEditPrompt = true;
        }
        break;
      case 'confirm':
      default:
        break;
    }
  }

  const rawMessage = typeof message === 'string' ? message.trim() : '';
  const trimmedMessage = rawMessage ? normalizeTranscript(rawMessage) : '';
  const detectedIntent = trimmedMessage ? detectUserIntent(trimmedMessage) : null;

  // -------------------------------------------------------------
  // Cancel Intent: immediately stops creation and returns cancelled status
  // -------------------------------------------------------------
  if (detectedIntent?.type === 'cancel') {
    return {
      success: true,
      status: 'cancelled',
      field: null,
      reply: 'Task creation cancel kar diya gaya hai. Jab chahein naya task shuru karein.',
      speech: 'टास्क कैंसिल कर दिया गया है। जब चाहें नया टास्क शुरू करें।',
      draft: currentDraft,
      missing: [],
      chips: [{ label: 'Naya Task Banayein', action: { type: 'reset' } }],
      candidates: [],
      notices: [],
      progress: { done: 0, total: 10 },
      intent: { type: 'cancel' },
      meta: { model: modelName },
    };
  }

  if (!actionHandled && trimmedMessage) {
    // 2a. Deterministic self words check (NO LLM, FREE)
    if (isSelfPhrase(trimmedMessage)) {
      currentDraft.taskFor = 'self';
      currentDraft.wantsOthers = false;
      currentDraft.assigneeId = null;
      currentDraft.assigneeName = null;
      currentDraft.assigneeLabel = null;
      if (!currentDraft.skipped.includes('assignee')) currentDraft.skipped.push('assignee');
      if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');

      // If message was purely a self phrase, mark handled so it won't become a task title
      const cleanSelf = trimmedMessage.replace(/[.,!?;:]/g, '').trim().toLowerCase();
      const pureSelfTokens = ['khud ke liye', 'apne liye', 'mere liye', 'mujhe', 'self', 'me', 'myself', 'for me', 'खुद के लिए', 'अपने लिए', 'मेरे लिए', 'मैं'];
      if (pureSelfTokens.includes(cleanSelf)) {
        actionHandled = true;
      }
    }

    // 2b. Check if message explicitly mentions another person's name
    const mentionedAssignee = extractAssigneeMention(trimmedMessage);
    if (mentionedAssignee && canAssignOthers) {
      currentDraft.assigneeName = mentionedAssignee;
      currentDraft.wantsOthers = true;
      currentDraft.taskFor = 'others';
      currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
    }

    // 2c. Intent & Extraction Handling
    if (!actionHandled) {
      const hasOtherFieldIntent = /(?:title|naam|नाम|description|विवरण|priority|प्रायोरिटी|status|स्टेटस|due|time|samay|समय|kal|कल|aaj|आज|tomorrow|today|tarikh|tareekh|तारीख|date|change|badal|badlo|बदलो)/i.test(trimmedMessage);

      // Direct answer to reminder question when reminder is pending
      if (!actionHandled && lastAskedField === 'reminder' && (currentDraft.reminder === null || currentDraft.reminder === undefined) && !hasOtherFieldIntent && !/\b(?:task|create|banao|submit)\b/i.test(trimmedMessage)) {
        const cleanMsg = trimmedMessage.trim().toLowerCase().replace(/[.,!?;:]/g, '');
        const intervalMatch = cleanMsg.match(/(?:repeat\s+)?(?:every|har|repeat\s+every|har\s+ek|interval\s*of)\s*(\d+)\s*(?:min(?:ute)?s?|m|मिनट)/i) ||
          cleanMsg.match(/(\d+)\s*(?:min(?:ute)?s?|m|मिनट)\s*(?:ka\s*)?(?:repeat\s*)?(?:reminder|interval)/i) ||
          cleanMsg.match(/^(\d+)\s*(?:min|minute|m)$/i);
        const beforeDueMatch = cleanMsg.match(/(?:due\s*(?:se|time\s*se)?\s*)?(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i) ||
          cleanMsg.match(/(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i);

        const isAffirmative = Boolean(intervalMatch || beforeDueMatch) ||
          /^(?:haan|ha|yes|on|kar\s*do|laga\s*do|कर\s*दो|हाँ|हां|haanji|hnji|sure|ok|okay|yep|true)$/i.test(cleanMsg) ||
          /^(?:haan|ha|yes|on|kar\s*do|laga\s*do|कर\s*दो|हाँ|हां)\b/i.test(cleanMsg) ||
          /(?:1|one|ek|hour|ghant|baad|pehle|before|half|30|aadha|hourly|har\s*ghant|एक|घंटे|घंटा|बाद|पहले)/i.test(cleanMsg);
        const isNegative = /^(?:nahi|no|off|band|mat\s*lagao|nahi\s*chahiye|rehne\s*do|नहीं|ना|false)$/i.test(cleanMsg) ||
          /^(?:nahi|no|off|mat\s*lagao)\b/i.test(cleanMsg);

        if (isAffirmative) {
          currentDraft.reminder = true;
          if (intervalMatch) {
            currentDraft.repeatIntervalMinutes = parseInt(intervalMatch[1], 10);
            currentDraft.reminderOption = currentDraft.repeatIntervalMinutes === 30 ? 'halfHourly' : (currentDraft.repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
          } else if (beforeDueMatch) {
            const qty = parseInt(beforeDueMatch[1], 10);
            const unit = beforeDueMatch[2].toLowerCase();
            const mins = /ghant|hour|घंट/.test(unit) ? qty * 60 : qty;
            currentDraft.minutesBeforeDue = mins;
            currentDraft.reminderOption = mins === 60 ? 'oneHourBefore' : 'beforeDue';
          } else if (/(?:half|30|aadha|आधा)/i.test(cleanMsg)) {
            currentDraft.reminderOption = 'halfHourly';
            currentDraft.repeatIntervalMinutes = 30;
          } else if (/(?:hourly|every|har\s*(?:1\s*)?ghant|har\s*ghante|हर\s*घंटे)/i.test(cleanMsg)) {
            currentDraft.reminderOption = 'hourly';
            currentDraft.repeatIntervalMinutes = 60;
          } else {
            currentDraft.reminderOption = currentDraft.reminderOption || 'oneHourBefore';
            currentDraft.minutesBeforeDue = null;
          }
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder' && f !== 'reminderOption');
          actionHandled = true;
        } else if (isNegative) {
          currentDraft.reminder = false;
          currentDraft.reminderOption = null;
          currentDraft.repeatIntervalMinutes = null;
          currentDraft.minutesBeforeDue = null;
          currentDraft.customTime = null;
          currentDraft.reminderTime = null;
          if (!currentDraft.asked.includes('reminder')) currentDraft.asked.push('reminder');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder');
          actionHandled = true;
        }
      }

      // Check if message is a pure intent (e.g. standalone "baaki sab default", "cancel", "submit")
      const hasFieldKeywords = /(?:title|naam|नाम|description|विवरण|डिस्क्रिप्शन|priority|प्रायोरिटी|status|स्टेटस|due|kal|कल|aaj|आज|tomorrow|today|baje|बजे|baaj|baj|bach|time|samay|समय|date|tareekh|tarikh|तारीख|minute|min|मिनट|hour|ghanta|घंटा|pm|am|reminder|रिमाइंडर|checkpoints|चेकपॉइंट|assign|photo|file)/i.test(trimmedMessage);
      const isPureIntent = !actionHandled && detectedIntent && ['skip_all', 'create_now', 'confirm_yes', 'confirm_no'].includes(detectedIntent.type) && !hasFieldKeywords;

      if (!actionHandled && isPureIntent && detectedIntent.type === 'skip_all') {
        const allOptional = ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments'];
        allOptional.forEach((fieldKey) => {
          if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
          if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
            if (fieldKey === 'description') currentDraft.description = '';
            if (fieldKey === 'priority') currentDraft.priority = 'medium';
            if (fieldKey === 'status') currentDraft.status = 'pending';
            if (fieldKey === 'reminder') currentDraft.reminder = false;
            if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
            if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
            if (fieldKey === 'attachments') currentDraft.attachmentsCount = 0;
          }
        });
        actionHandled = true;
      } else if (!actionHandled && isPureIntent && (detectedIntent.type === 'create_now' || detectedIntent.type === 'confirm_yes')) {
        // If required fields are filled, skip optional fields and proceed
        if (currentDraft.title && currentDraft.dueDateTime) {
          const allOptional = ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments'];
          allOptional.forEach((f) => {
            if (!currentDraft.skipped.includes(f)) currentDraft.skipped.push(f);
          });
        }
        actionHandled = true;
      } else if (!actionHandled && isPureIntent && detectedIntent.type === 'confirm_no') {
        wantsEditPrompt = true;
        actionHandled = true;
      } else if (!actionHandled) {

        // Direct answer to reminderOption question
        if (!actionHandled && lastAskedField === 'reminderOption' && (currentDraft.reminderOption === null || currentDraft.reminderOption === undefined) && !hasOtherFieldIntent) {
          const cleanMsg = trimmedMessage.trim().toLowerCase();
          const intervalMatch = cleanMsg.match(/(?:repeat\s+)?(?:every|har|repeat\s+every|har\s+ek|interval\s*of)\s*(\d+)\s*(?:min(?:ute)?s?|m|मिनट)/i) ||
            cleanMsg.match(/(\d+)\s*(?:min(?:ute)?s?|m|मिनट)\s*(?:ka\s*)?(?:repeat\s*)?(?:reminder|interval)/i) ||
            cleanMsg.match(/^(\d+)\s*(?:min|minute|m)$/i);
          const beforeDueMatch = cleanMsg.match(/(?:due\s*(?:se|time\s*se)?\s*)?(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i) ||
            cleanMsg.match(/(\d+)\s*(min(?:ute)?s?|ghant[ae]|hour|hours|मिनट|घंटे|घंटा)\s*(?:pehle|before|पहले)/i);

          if (intervalMatch) {
            currentDraft.reminder = true;
            currentDraft.repeatIntervalMinutes = parseInt(intervalMatch[1], 10);
            currentDraft.reminderOption = currentDraft.repeatIntervalMinutes === 30 ? 'halfHourly' : (currentDraft.repeatIntervalMinutes === 60 ? 'hourly' : 'interval');
            actionHandled = true;
          } else if (beforeDueMatch) {
            currentDraft.reminder = true;
            const qty = parseInt(beforeDueMatch[1], 10);
            const unit = beforeDueMatch[2].toLowerCase();
            const mins = /ghant|hour|घंट/.test(unit) ? qty * 60 : qty;
            currentDraft.minutesBeforeDue = mins;
            currentDraft.reminderOption = mins === 60 ? 'oneHourBefore' : 'beforeDue';
            actionHandled = true;
          } else if (cleanMsg.includes('half') || cleanMsg.includes('30') || cleanMsg.includes('aadha') || cleanMsg.includes('आधा')) {
            currentDraft.reminderOption = 'halfHourly';
            currentDraft.repeatIntervalMinutes = 30;
            currentDraft.reminder = true;
            actionHandled = true;
          } else if (cleanMsg.includes('every') || cleanMsg.includes('har 1') || cleanMsg.includes('hourly') || cleanMsg.includes('har ghante') || cleanMsg.includes('हर')) {
            currentDraft.reminderOption = 'hourly';
            currentDraft.repeatIntervalMinutes = 60;
            currentDraft.reminder = true;
            actionHandled = true;
          } else if (cleanMsg.includes('1') || cleanMsg.includes('one') || cleanMsg.includes('pehle') || cleanMsg.includes('before') || cleanMsg.includes('ek') || cleanMsg.includes('ghant') || cleanMsg.includes('baad') || cleanMsg.includes('hour') || cleanMsg.includes('एक') || cleanMsg.includes('घंटे') || cleanMsg.includes('घंटा') || cleanMsg.includes('बाद') || cleanMsg.includes('पहले')) {
            currentDraft.reminderOption = 'oneHourBefore';
            currentDraft.minutesBeforeDue = null;
            currentDraft.reminder = true;
            actionHandled = true;
          }
          if (actionHandled) {
            if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
          }
        }

        // Direct answer to priority question
        if (!actionHandled && lastAskedField === 'priority' && (currentDraft.priority === null || currentDraft.priority === undefined) && !hasOtherFieldIntent) {
          const cleanMsg = trimmedMessage.trim().toLowerCase().replace(/[.,!?;:]/g, '');
          if (['low', 'kam', 'halka', 'लो'].includes(cleanMsg)) {
            currentDraft.priority = 'low';
            actionHandled = true;
          } else if (['high', 'urgent', 'jaruri', 'zaroori', 'हाई', 'ज़रूरी'].includes(cleanMsg)) {
            currentDraft.priority = 'high';
            actionHandled = true;
          } else if (['medium', 'normal', 'theek', 'मीडियम'].includes(cleanMsg)) {
            currentDraft.priority = 'medium';
            actionHandled = true;
          }
          if (actionHandled) {
            if (!currentDraft.asked.includes('priority')) currentDraft.asked.push('priority');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'priority');
          }
        }

        // Direct answer to status question
        if (!actionHandled && lastAskedField === 'status' && (currentDraft.status === null || currentDraft.status === undefined) && !hasOtherFieldIntent) {
          const cleanMsg = trimmedMessage.trim().toLowerCase().replace(/[.,!?;:]/g, '');
          const parsedStatus = TASK_FIELDS.status?.parse ? TASK_FIELDS.status.parse(cleanMsg) : null;
          if (parsedStatus) {
            currentDraft.status = parsedStatus;
            actionHandled = true;
            if (!currentDraft.asked.includes('status')) currentDraft.asked.push('status');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'status');
          }
        }

        // Deterministic extraction runs first
        const detSlots = parseHinglishSlots(trimmedMessage, now, currentDraft.dueDateTime);

        if (lastAskedField === 'description' && (!currentDraft.description) && (!detSlots.description) && trimmedMessage.length <= 300 && !isPureIntent && !isSkip(trimmedMessage)) {
          detSlots.description = trimmedMessage;
        }

        if (lastAskedField === 'title' && (!currentDraft.title) && (!detSlots.title) && trimmedMessage.length <= 100 && !isFillerPhrase(trimmedMessage) && !isPureIntent && !isSkip(trimmedMessage)) {
          detSlots.title = trimmedMessage;
        }

        if (lastAskedField === 'assignee' && (!currentDraft.assigneeId) && (!currentDraft.assigneeName) && (!detSlots.assigneeName) && trimmedMessage.length <= 50 && !isSkip(trimmedMessage)) {
          detSlots.assigneeName = trimmedMessage;
        }

        // Invoke LLM extractor only if not action/pure-skip/handled
        let extracted = {};
        const shouldCallLlm = !actionHandled && !isPureIntent && !isSkip(trimmedMessage) && !isSkipAll(trimmedMessage);
        if (shouldCallLlm) {
          try {
            extracted = (await extractFn({
              message: trimmedMessage,
              now,
              previousDraft: currentDraft,
              req,
            })) || {};
          } catch (llmErr) {
            const errCode = llmErr?.code || llmErr?.cause?.code || 'LLM_ERROR';
            const safeMsg = String(llmErr?.message || '').replace(/gsk_[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]').slice(0, 150);
            console.error(`[ai] llm extraction failed code=${errCode} msg=${safeMsg}`);
            extracted = {};
          }
        }

        // Merge extracted slots into draft
        const merged = mergeDraft(currentDraft, extracted, detSlots, trimmedMessage);
        Object.assign(currentDraft, merged);

        // If a previously skipped field was explicitly updated in this turn, remove it from skipped
        if (detSlots.priority || extracted.priority) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'priority');
        if (detSlots.status || extracted.status) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'status');
        if (detSlots.title || extracted.title) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'title');
        if (detSlots.description || extracted.description) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'description');
        if (detSlots.dueDateTime || extracted.dueDateTime) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'dueDateTime');
        if (detSlots.reminder !== undefined || extracted.reminder !== undefined) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminder');
          if (currentDraft.reminder) {
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
          }
        }
        if (detSlots.reminderOption || extracted.reminderOption) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'reminderOption');
          if (!currentDraft.asked.includes('reminderOption')) currentDraft.asked.push('reminderOption');
        }
        if ((Array.isArray(detSlots.checkpoints) && detSlots.checkpoints.length > 0) || (Array.isArray(extracted.checkpoints) && extracted.checkpoints.length > 0)) {
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'checkpoints');
        }
        if (detSlots.priorityDays || extracted.priorityDays) currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'priorityDays');

        // Apply intent AFTER extraction (when message contains both extraction AND intent)
        if (detectedIntent?.type === 'skip_all' || isSkipAll(trimmedMessage)) {
          const allOptional = ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments'];
          allOptional.forEach((fieldKey) => {
            if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
            if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
              if (fieldKey === 'description') currentDraft.description = '';
              if (fieldKey === 'priority') currentDraft.priority = 'medium';
              if (fieldKey === 'status') currentDraft.status = 'pending';
              if (fieldKey === 'reminder') currentDraft.reminder = false;
              if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
              if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
              if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
              if (fieldKey === 'attachments') currentDraft.attachmentsCount = 0;
            }
          });
        } else if (detectedIntent?.type === 'skip_field') {
          const target = detectedIntent.field || lastAskedField;
          if (target && !currentDraft.skipped.includes(target)) {
            currentDraft.skipped.push(target);
            if (target === 'description') currentDraft.description = '';
            if (target === 'priority') currentDraft.priority = 'medium';
            if (target === 'status') currentDraft.status = 'pending';
            if (target === 'reminder') currentDraft.reminder = false;
            if (target === 'priorityDays') currentDraft.priorityDays = '1';
            if (target === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (target === 'checkpoints') currentDraft.checkpoints = [];
            if (target === 'attachments') currentDraft.attachmentsCount = 0;
          }
        } else if (isSkip(trimmedMessage)) {
          const target = lastAskedField || 'description';
          if (!currentDraft.skipped.includes(target)) currentDraft.skipped.push(target);
          if (target === 'description') currentDraft.description = '';
          if (target === 'priority') currentDraft.priority = 'medium';
          if (target === 'status') currentDraft.status = 'pending';
          if (target === 'reminder') currentDraft.reminder = false;
          if (target === 'priorityDays') currentDraft.priorityDays = '1';
          if (target === 'repeatPattern') currentDraft.repeatPattern = 'none';
          if (target === 'checkpoints') currentDraft.checkpoints = [];
          if (target === 'attachments') currentDraft.attachmentsCount = 0;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 2g: Track newly extracted fields this turn for multi-field acknowledgement
  // -------------------------------------------------------------
  const newlyExtracted = [];
  if (!initialFilled.title && currentDraft.title && String(currentDraft.title).trim()) {
    newlyExtracted.push({ key: 'title', label: 'naam', display: `"${currentDraft.title}"` });
  }
  if (!initialFilled.description && currentDraft.description !== null && currentDraft.description !== undefined && String(currentDraft.description).trim()) {
    newlyExtracted.push({ key: 'description', label: 'description', display: `"${currentDraft.description}"` });
  }
  if (!initialFilled.priority && currentDraft.priority) {
    newlyExtracted.push({ key: 'priority', label: 'priority', display: currentDraft.priority });
  }
  if (!initialFilled.status && currentDraft.status) {
    newlyExtracted.push({ key: 'status', label: 'status', display: currentDraft.status });
  }
  if (!initialFilled.dueDateTime && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) {
    newlyExtracted.push({ key: 'dueDateTime', label: 'due date', display: formatHumanIstDate(currentDraft.dueDateTime) });
  }
  if (!initialFilled.assignee && (currentDraft.assigneeId || (currentDraft.taskFor === 'others' && currentDraft.assigneeName))) {
    newlyExtracted.push({ key: 'assignee', label: 'assignee', display: currentDraft.assigneeLabel || currentDraft.assigneeName });
  }
  if (!initialFilled.reminder && currentDraft.reminder !== null && currentDraft.reminder !== undefined) {
    let reminderDisplay = 'Haan';
    if (!currentDraft.reminder) {
      reminderDisplay = 'Nahi';
    } else if (currentDraft.repeatIntervalMinutes) {
      reminderDisplay = `Har ${currentDraft.repeatIntervalMinutes} min`;
    } else if (currentDraft.minutesBeforeDue) {
      reminderDisplay = `${currentDraft.minutesBeforeDue} min pehle`;
    } else if (currentDraft.customTime) {
      reminderDisplay = formatHumanIstDate(currentDraft.customTime);
    } else if (currentDraft.reminderOption === 'halfHourly') {
      reminderDisplay = 'Every 30 min';
    } else if (currentDraft.reminderOption === 'hourly') {
      reminderDisplay = 'Every 1 hour';
    } else if (currentDraft.reminderOption === 'oneHourBefore') {
      reminderDisplay = '1 hour before';
    }
    newlyExtracted.push({ key: 'reminder', label: 'reminder', display: reminderDisplay });
  }
  if (!initialFilled.checkpoints && Array.isArray(currentDraft.checkpoints) && currentDraft.checkpoints.length > 0) {
    newlyExtracted.push({ key: 'checkpoints', label: 'checkpoints', display: `${currentDraft.checkpoints.length} checkpoints` });
  }

  let ackPrefix = '';
  let speechPrefix = '';
  if (newlyExtracted.length >= 2) {
    const labelOrder = ['naam', 'description', 'priority', 'status', 'due date', 'assignee', 'reminder', 'checkpoints'];
    newlyExtracted.sort((a, b) => labelOrder.indexOf(a.label) - labelOrder.indexOf(b.label));

    const labels = newlyExtracted.map((item) => item.label);
    const joinedLabels = labels.length === 2
      ? `${labels[0]} aur ${labels[1]}`
      : `${labels.slice(0, -1).join(', ')} aur ${labels[labels.length - 1]}`;

    const summaryParts = newlyExtracted.map((item) => `${item.label} = ${item.display}`);
    const summaryLine = `Kya samjha: ${summaryParts.join(', ')}`;

    ackPrefix = `Samajh gaya: ${joinedLabels} mil gaye.\n${summaryLine}\n\n`;

    const hindiLabelMap = {
      naam: 'नाम',
      description: 'डिस्क्रिप्शन',
      priority: 'प्रायोरिटी',
      status: 'स्टेटस',
      'due date': 'ड्यू डेट',
      assignee: 'कर्मचारी',
      reminder: 'रिमाइंडर',
      checkpoints: 'चेकपॉइंट्स',
    };
    const speechLabels = newlyExtracted.map((item) => hindiLabelMap[item.label] || item.label);
    const joinedSpeechLabels = speechLabels.length === 2
      ? `${speechLabels[0]} और ${speechLabels[1]}`
      : `${speechLabels.slice(0, -1).join(', ')} और ${speechLabels[speechLabels.length - 1]}`;
    speechPrefix = `समझ गया: ${joinedSpeechLabels} मिल गए। `;
  }

  // -------------------------------------------------------------
  // STEP 3: Assignee disambiguation & scope validation
  // -------------------------------------------------------------
  const wantsAssignee = Boolean(currentDraft.assigneeName || pick?.assigneeId || currentDraft.assigneeId);

  if (wantsAssignee) {
    if (!canAssignOthers) {
      currentDraft.assigneeName = null;
      currentDraft.assigneeId = null;
      currentDraft.assigneeLabel = null;
      notices.push('Aapko dusron ko task assign karne ki permission nahi hai, isliye ye aapke liye banaunga.');
    } else if (pick?.assigneeId) {
      const validObjectId = mongoose.Types.ObjectId.isValid(pick.assigneeId);
      let foundUser = null;
      // Fail-closed: companyId ke bina query mat chalao (undefined filter Mongoose mein strip ho jaata hai = tenant leak).
      if (validObjectId && companyId) {
        foundUser = await UserModel.findOne({
          _id: pick.assigneeId,
          company: companyId,
          isActive: true,
          ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
        }).select('_id name employeeId jobRole department branch').lean();
      }

      if (foundUser) {
        const inScope = await isAssigneeInScopeFn(req, scope, foundUser._id, deps);
        if (!inScope) {
          notices.push('Selected user aapke branch ya department scope se bahar hain. Kripya kisi aur ko chunein.');
          currentDraft.assigneeId = null;
          currentDraft.assigneeLabel = null;
          currentDraft.assigneeName = null;
        } else {
          let deptDisplay = String(foundUser.department || '').trim();
          if (mongoose.Types.ObjectId.isValid(deptDisplay)) {
            // TENANT FIX (old line ~574): findById -> findOne with company filter
            const dDoc = await DeptModel.findOne({ _id: deptDisplay, company: companyId })
              .select('name departmentName')
              .lean();
            if (dDoc) deptDisplay = dDoc.name || dDoc.departmentName || deptDisplay;
          }
          currentDraft.assigneeId = String(foundUser._id);
          currentDraft.assigneeName = foundUser.name;
          currentDraft.assigneeLabel = formatAssigneeLabel(foundUser, deptDisplay);
        }
      }
    } else if (currentDraft.assigneeName && !currentDraft.assigneeId) {
      const resolution = await resolveAssigneeFn({
        name: currentDraft.assigneeName,
        requester: req.user,
      }, deps);

      if (resolution.status === 'multiple') {
        const rawCandidates = resolution.candidates || [];
        const deptIdsToLookup = rawCandidates
          .map((c) => String(c.department || ''))
          .filter((d) => mongoose.Types.ObjectId.isValid(d));

        let deptMap = new Map();
        if (deptIdsToLookup.length > 0 && companyId) {
          // TENANT FIX (old line ~596): company filter added
          const deptDocs = await DeptModel.find({
            _id: { $in: deptIdsToLookup },
            company: companyId,
          }).select('_id name departmentName').lean();
          (deptDocs || []).forEach((d) => {
            deptMap.set(String(d._id), d.name || d.departmentName || '');
          });
        }

        candidates = rawCandidates.map((c) => {
          const id = String(c.id || c._id);
          let dept = String(c.department || '').trim();
          if (mongoose.Types.ObjectId.isValid(dept) && deptMap.has(dept)) {
            dept = deptMap.get(dept);
          }
          const candObj = {
            id,
            _id: id,
            name: c.name,
            employeeId: c.employeeId || '',
            jobRole: c.jobRole && c.jobRole !== 'user' ? c.jobRole : '',
            department: dept || 'General',
          };
          candObj.label = c.label || formatAssigneeLabel(candObj, candObj.department);
          return candObj;
        });

        return {
          success: true,
          status: 'needs_disambiguation',
          field: 'assignee',
          reply: `"${currentDraft.assigneeName}" naam ke multiple users mile hain. Kripya list me se sahi user chunein.`,
          speech: `"${currentDraft.assigneeName}" नाम के कई कर्मचारी मिले हैं। कृपया सही कर्मचारी चुनें।`,
          draft: currentDraft,
          missing: ['assigneeId'],
          chips: [],
          candidates,
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
          meta: { model: modelName },
        };
      }

      if (resolution.status === 'single') {
        const candidateUser = resolution.user;
        const inScope = await isAssigneeInScopeFn(req, scope, candidateUser._id, deps);
        if (inScope) {
          currentDraft.assigneeId = String(candidateUser._id);
          currentDraft.assigneeName = candidateUser.name;
          currentDraft.assigneeLabel = formatAssigneeLabel(candidateUser, candidateUser.department);
        } else {
          notices.push(`${candidateUser.name} aapke branch ya department scope se bahar hain.`);
          currentDraft.assigneeId = null;
          currentDraft.assigneeLabel = null;
          currentDraft.assigneeName = null;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 4: Guided Slot-Filling Sequence (Exactly one next question)
  // -------------------------------------------------------------
  // Default is SELF. Do NOT ask "kiske liye" first. Ask it only if:
  // (i) the message mentions another person's name, or
  // (ii) the user tapped chip [Kisi aur ke liye] (currentDraft.wantsOthers === true).
  const isOthersTask = Boolean(
    canAssignOthers &&
    currentDraft.taskFor === 'others' &&
    (currentDraft.wantsOthers || currentDraft.assigneeName || currentDraft.assigneeId) &&
    !currentDraft.skipped.includes('assignee')
  );

  const activeFields = [];
  if (isOthersTask && !currentDraft.assigneeId) {
    activeFields.push('assignee');
  }
  activeFields.push('title');
  activeFields.push('dueDateTime');
  activeFields.push('description');
  activeFields.push('priority');
  activeFields.push('status');
  activeFields.push('reminder');
  if (currentDraft.reminder === true) {
    activeFields.push('reminderOption');
  }
  activeFields.push('priorityDays');
  activeFields.push('repeatPattern');
  activeFields.push('checkpoints');
  activeFields.push('attachments');

  // Check which field is missing next
  let nextFieldKey = null;

  for (const fieldKey of activeFields) {
    if (currentDraft.skipped.includes(fieldKey)) {
      continue;
    }

    if (fieldKey === 'assignee') {
      if (!currentDraft.assigneeId) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'title') {
      if (!currentDraft.title || !String(currentDraft.title).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'dueDateTime') {
      if (!currentDraft.dueDateTime) {
        nextFieldKey = fieldKey;
        break;
      }
      const dueMs = new Date(currentDraft.dueDateTime).getTime();
      if (isNaN(dueMs) || dueMs <= now.getTime()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'description') {
      if (currentDraft.description === null || currentDraft.description === undefined) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'priority') {
      if (!currentDraft.priority) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'status') {
      if (!currentDraft.status) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'reminder') {
      if (currentDraft.reminder === null || currentDraft.reminder === undefined) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'reminderOption') {
      if (!currentDraft.reminderOption) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'priorityDays') {
      if (!currentDraft.priorityDays) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'repeatPattern') {
      if (!currentDraft.repeatPattern) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'checkpoints') {
      if (!currentDraft.asked.includes('checkpoints') && (!currentDraft.checkpoints || currentDraft.checkpoints.length === 0)) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'attachments') {
      if (!currentDraft.asked.includes('attachments') && currentDraft.attachmentsCount === 0) {
        nextFieldKey = fieldKey;
        break;
      }
    }
  }

  // Calculate progress
  const total = activeFields.length;
  let done = 0;
  for (const f of activeFields) {
    if (currentDraft.skipped.includes(f)) {
      done += 1;
    } else if (f === 'assignee' && currentDraft.assigneeId) {
      done += 1;
    } else if (f === 'title' && currentDraft.title) {
      done += 1;
    } else if (f === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) {
      done += 1;
    } else if (f === 'description' && currentDraft.description !== null) {
      done += 1;
    } else if (f === 'priority' && currentDraft.priority) {
      done += 1;
    } else if (f === 'status' && currentDraft.status) {
      done += 1;
    } else if (f === 'reminder' && currentDraft.reminder !== null) {
      done += 1;
    } else if (f === 'reminderOption' && currentDraft.reminderOption) {
      done += 1;
    } else if (f === 'priorityDays' && currentDraft.priorityDays) {
      done += 1;
    } else if (f === 'repeatPattern' && currentDraft.repeatPattern) {
      done += 1;
    } else if (f === 'checkpoints' && (currentDraft.asked.includes('checkpoints') || (currentDraft.checkpoints && currentDraft.checkpoints.length > 0))) {
      done += 1;
    } else if (f === 'attachments' && (currentDraft.asked.includes('attachments') || currentDraft.attachmentsCount > 0)) {
      done += 1;
    }
  }

  // -------------------------------------------------------------
  // STEP 5: Return Question OR Ready status
  // -------------------------------------------------------------
  if (nextFieldKey) {
    // FIX: jis field ka sawaal abhi pooch rahe hain use hamesha list ke END mein rakho,
    // taaki agle turn par lastAskedField sahi ho (re-ask par purana order jawab ko galat field mein daal deta tha).
    currentDraft.asked = currentDraft.asked.filter((f) => f !== nextFieldKey);
    currentDraft.asked.push(nextFieldKey);

    // Anti-looping counter & question selection
    const priorAskCount = currentDraft.askCounts[nextFieldKey] || 0;
    currentDraft.askCounts[nextFieldKey] = priorAskCount + 1;
    const isReAsk = priorAskCount >= 1; // Already asked at least once before

    const fieldConfig = TASK_FIELDS[nextFieldKey] || {};
    const isPastDueTime = nextFieldKey === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() <= now.getTime();

    let replyText = isPastDueTime
      ? 'Yeh samay beet chuka hai. Kripya naya time batayein ya kal ka samay chunein.'
      : ((isReAsk && fieldConfig.reAskQuestion?.reply)
        ? fieldConfig.reAskQuestion.reply
        : (fieldConfig.question?.reply || 'Agli detail batayein:'));

    let speechText = isPastDueTime
      ? 'यह समय बीत चुका है। कृपया नया समय बताएं या कल का समय चुनें।'
      : ((isReAsk && fieldConfig.reAskQuestion?.speech)
        ? fieldConfig.reAskQuestion.speech
        : (fieldConfig.question?.speech || 'अगली डिटेल बताएं:'));

    // Visual reply has the ackPrefix summary; spoken speech remains concise
    replyText = ackPrefix + replyText;

    let chipsList = [];
    if (isReAsk && typeof fieldConfig.reAskChips === 'function') {
      chipsList = fieldConfig.reAskChips(now);
    } else if (typeof fieldConfig.chips === 'function') {
      chipsList = fieldConfig.chips(now);
    }

    // Filter out chips for fields that are ALREADY filled in the draft
    chipsList = chipsList.filter((chip) => {
      const field = chip?.action?.field || chip?.field;
      if (field === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) return false;
      if (field === 'priority' && currentDraft.priority) return false;
      if (field === 'status' && currentDraft.status) return false;
      if (field === 'description' && currentDraft.description !== null && currentDraft.description !== undefined) return false;
      if (field === 'title' && currentDraft.title) return false;
      return true;
    });

    // For Owner/Admin on the first question of a new task, offer [Khud ke liye] [Kisi aur ke liye]
    const isFirstQuestion = currentDraft.asked.filter((f) => f !== 'assignee').length <= 1;
    if (canAssignOthers && isFirstQuestion && currentDraft.taskFor !== 'others' && nextFieldKey !== 'assignee') {
      chipsList = [
        { label: 'Khud ke liye', action: { type: 'set', field: 'taskFor', value: 'self' } },
        { label: 'Kisi aur ke liye', action: { type: 'set', field: 'taskFor', value: 'others' } },
        ...chipsList,
      ];
    }

    return {
      success: true,
      status: 'needs_input',
      field: nextFieldKey,
      reply: replyText,
      speech: speechText,
      draft: currentDraft,
      missing: [nextFieldKey],
      chips: chipsList,
      candidates,
      notices,
      progress: { done, total },
      canAssignOthers,
      intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
      meta: { model: modelName },
    };
  }

  // All fields are handled -> Status: READY
  const cleanedCheckpoints = getCleanCheckpoints(currentDraft.checkpoints);
  const isFinalOthers = Boolean(currentDraft.assigneeId && currentDraft.taskFor === 'others');
  const taskFor = isFinalOthers ? 'others' : 'self';

  const reminderPayload = buildReminderPayload({
    enabled: Boolean(currentDraft.reminder),
    reminderOption: currentDraft.reminderOption,
    options: currentDraft.reminder && currentDraft.reminderOption ? [currentDraft.reminderOption] : [],
    repeatIntervalMinutes: currentDraft.repeatIntervalMinutes,
    minutesBeforeDue: currentDraft.minutesBeforeDue,
    customTime: currentDraft.customTime,
    reminderTime: currentDraft.reminderTime,
  });

  const fields = {
    title: currentDraft.title || '',
    description: currentDraft.description || '',
    dueDateTime: currentDraft.dueDateTime || '',
    priority: currentDraft.priority || 'medium',
    status: currentDraft.status || 'pending',
    priorityDays: String(currentDraft.priorityDays || '1'),
    repeatPattern: currentDraft.repeatPattern || 'none',
    repeatDays: JSON.stringify(currentDraft.repeatDays || []),
    recurrenceEndDate: currentDraft.recurrenceEndDate || '',
    checkpoints: JSON.stringify(cleanedCheckpoints),
    reminderSettings: JSON.stringify(reminderPayload),
    ...(isFinalOthers
      ? {
        assignedUsers: JSON.stringify([currentDraft.assigneeId]),
        assignedGroups: JSON.stringify([]),
      }
      : {}),
  };

  const payload = {
    endpoint: isFinalOthers ? '/task/create-for-others' : '/tasks/self/create',
    method: 'POST',
    multipart: true,
    fields,
    body: fields,
    fileField: 'files',
  };

  const statusLabels = {
    pending: 'Pending',
    'in-progress': 'In Progress',
    completed: 'Completed',
    onhold: 'On Hold',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    reopen: 'Reopen',
    overdue: 'Overdue',
    approved: 'Approved',
  };

  const getReminderPreviewText = (draft) => {
    if (!draft.reminder) return 'Nahi (No)';
    if (draft.repeatIntervalMinutes) return `Every ${draft.repeatIntervalMinutes} min`;
    if (draft.reminderOption === 'oneHourBefore') return '1 hour before';
    if (draft.minutesBeforeDue) return `${draft.minutesBeforeDue} min before due`;
    if (draft.customTime) return `One-time: ${formatHumanIstDate(draft.customTime)}`;
    if (draft.reminderOption === 'halfHourly') return 'Every 30 min';
    if (draft.reminderOption === 'hourly') return 'Every 1 hour';
    return '1 hour before';
  };

  const preview = {
    title: currentDraft.title || '—',
    description: currentDraft.description || '—',
    dueDateTime: currentDraft.dueDateTime || '—',
    dueLabel: currentDraft.dueDateTime ? formatHumanIstDate(currentDraft.dueDateTime) : '—',
    priority: currentDraft.priority ? (currentDraft.priority.charAt(0).toUpperCase() + currentDraft.priority.slice(1)) : 'Medium',
    status: currentDraft.status || 'pending',
    statusLabel: statusLabels[currentDraft.status] || 'Pending',
    priorityDays: currentDraft.priorityDays || '1',
    reminder: getReminderPreviewText(currentDraft),
    reminderOption: currentDraft.reminder ? (currentDraft.reminderOption || 'oneHourBefore') : null,
    repeatIntervalMinutes: currentDraft.repeatIntervalMinutes || null,
    minutesBeforeDue: currentDraft.minutesBeforeDue || null,
    customTime: currentDraft.customTime || null,
    repeat: currentDraft.repeatPattern === 'daily' ? 'Repeat Task' : 'No repeat',
    checkpoints: cleanedCheckpoints.length > 0 ? cleanedCheckpoints.map((c) => c.title) : [],
    attachmentsCount: currentDraft.attachmentsCount || 0,
    assignee: isFinalOthers ? { id: currentDraft.assigneeId, label: currentDraft.assigneeLabel } : null,
    taskFor,
  };

  const readyConfig = TASK_FIELDS.ready;

  if (wantsEditPrompt) {
    return {
      success: true,
      status: 'ready',
      field: 'ready',
      reply: 'Ji batayein kya changes karne hain? Main kar dungi.',
      speech: 'जी बताएं क्या बदलाव करने हैं? मैं कर दूंगी।',
      draft: currentDraft,
      missing: [],
      chips: [
        { label: 'Priority badlo', action: { type: 'ask', field: 'priority' } },
        { label: 'Date/Time badlo', action: { type: 'ask', field: 'dueDateTime' } },
        { label: 'Reminder badlo', action: { type: 'ask', field: 'reminder' } },
        { label: 'Haan, create karo', action: { type: 'confirm' } },
      ],
      candidates: [],
      notices,
      progress: { done: total, total },
      canAssignOthers,
      payload,
      preview,
      intent: { type: 'confirm_no' },
      meta: { model: modelName },
    };
  }

  const modifiedFields = [];
  if (initialValues.dueDateTime && currentDraft.dueDateTime && initialValues.dueDateTime !== currentDraft.dueDateTime) {
    const formattedDue = formatHumanIstDate(currentDraft.dueDateTime);
    modifiedFields.push({ key: 'dueDateTime', labelHinglish: `due time (${formattedDue})`, labelHindi: `ड्यू टाइम (${formattedDue})` });
  }
  if (initialValues.priority && currentDraft.priority && initialValues.priority !== currentDraft.priority) {
    modifiedFields.push({ key: 'priority', labelHinglish: `priority (${currentDraft.priority})`, labelHindi: `प्रायोरिटी (${currentDraft.priority})` });
  }
  if (initialValues.title && currentDraft.title && initialValues.title !== currentDraft.title) {
    modifiedFields.push({ key: 'title', labelHinglish: `title ("${currentDraft.title}")`, labelHindi: `नाम ("${currentDraft.title}")` });
  }
  if (initialValues.description !== null && currentDraft.description !== null && initialValues.description !== currentDraft.description) {
    modifiedFields.push({ key: 'description', labelHinglish: 'description', labelHindi: 'विवरण' });
  }
  if (initialValues.status && currentDraft.status && initialValues.status !== currentDraft.status) {
    modifiedFields.push({ key: 'status', labelHinglish: `status (${currentDraft.status})`, labelHindi: `स्टेटस (${currentDraft.status})` });
  }
  if (initialValues.reminder !== null && currentDraft.reminder !== null && (initialValues.reminder !== currentDraft.reminder || initialValues.repeatIntervalMinutes !== currentDraft.repeatIntervalMinutes || initialValues.minutesBeforeDue !== currentDraft.minutesBeforeDue || initialValues.reminderOption !== currentDraft.reminderOption)) {
    modifiedFields.push({ key: 'reminder', labelHinglish: `reminder (${getReminderPreviewText(currentDraft)})`, labelHindi: 'रिमाइंडर' });
  }
  if ((initialValues.assigneeId || initialValues.assigneeName) && (initialValues.assigneeId !== currentDraft.assigneeId || initialValues.assigneeName !== currentDraft.assigneeName)) {
    modifiedFields.push({ key: 'assignee', labelHinglish: 'assignee', labelHindi: 'कर्मचारी' });
  }

  let finalReply = ackPrefix + readyConfig.question.reply;
  let readySpeech = speechPrefix
    ? `${speechPrefix}${readyConfig.question.speech}`
    : (currentDraft.title ? `टास्क "${currentDraft.title}" तैयार है। ${readyConfig.question.speech}` : readyConfig.question.speech);
  let finalSpeech = readySpeech;

  if (modifiedFields.length > 0) {
    const labelsHinglish = modifiedFields.map((f) => f.labelHinglish).join(', ');
    const labelsHindi = modifiedFields.map((f) => f.labelHindi).join(', ');
    finalReply = `Ji aapka ${labelsHinglish} change kar diya hai. Kya main task create kar doon?`;
    finalSpeech = `जी आपका ${labelsHindi} बदल दिया है। क्या मैं टास्क क्रिएट कर दूं?`;
  }

  return {
    success: true,
    status: 'ready',
    field: 'ready',
    reply: finalReply,
    speech: finalSpeech,
    draft: currentDraft,
    missing: [],
    chips: typeof readyConfig.chips === 'function' ? readyConfig.chips() : [],
    candidates: [],
    notices,
    progress: { done: total, total },
    canAssignOthers,
    payload,
    preview,
    intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
    meta: { model: modelName },
  };
}

module.exports = {
  parseTaskRequest,
  formatHumanIstDate,
  formatAssigneeLabel,
  getCleanCheckpoints,
  buildReminderPayload,
};