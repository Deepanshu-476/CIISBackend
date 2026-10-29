const mongoose = require('mongoose');
const { extractTaskDraft, mergeDraft } = require('./taskExtractor');
const { getScopeInfo, isAssigneeInScope } = require('./taskScope');
const { resolveAssignee, escapeRegex } = require('./assigneeResolver');
const { getModelName } = require('./llm');
const { TASK_FIELDS, TASK_FIELD_ORDER } = require('./taskFields');
const { parseHinglishSlots, isSkip, isSkipAll, isSelfPhrase, isFillerPhrase, extractAssigneeMention, extractMultipleAssignees, isInvalidOrCommandTitle, cleanAssigneeName, isValidAssigneeCandidate, detectPersonInActionTitle } = require('./hinglishParser');
const { detectUserIntent, normalizeTranscript } = require('./sttNormalizer');
const User = require('../../models/User');
const Department = require('../../models/Department');
const { Project: DefaultProjectModel } = require('../../HR-CDS/models/Project');
const {
  resolveProject,
  resolveProjectAssignee,
  getAccessibleProjects,
  buildProjectCandidateChips,
  buildAccessibleProjectChips,
  formatCandidateDate,
  requiresProjectDistinguishing,
  hasProjectAccess,
  idsEqual,
  phoneticNormalize,
} = require('./projectResolver');

const {
  FORM_REGISTRY,
  detectIntent,
  migrateDraftBetweenIntents,
  getIntentSlots,
  checkIntentAccess,
  formatHumanIstDate,
  formatAssigneeLabel,
  getCleanCheckpoints,
  buildReminderPayload,
  getReminderPreviewText,
  formatProjectPriority,
  formatProjectStatus,
  PROJECT_STATUS_LABELS,
  STATUS_LABELS,
} = require('./formRegistry');

const {
  createLedger,
  mergeIntoLedger,
  syncAssigneeLedgerDerivedFields,
  isAssigneeLedgerComplete,
  getFirstUnresolvedLedgerEntry,
  evaluateLedgerEntry,
  updateLedgerWithPick,
  removeLedgerEntry,
  buildUnresolvedEntryPrompt,
} = require('./assigneeLedger');

const {
  formatIstDate,
  extractCreateProjectSlotsFromMessage,
  parseProjectDate,
  findDuplicateProject,
} = require('./projectSlotFiller');

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getIstDateShifted(d = new Date()) {
  return new Date(d.getTime() + INDIA_OFFSET_MS);
}

function hasExplicitFieldEditIntent(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase();
  if (/(?:title|naam|नाम|description|विवरण|डिस्क्रिप्शन|priority|प्रायोरिटी|status|स्टेटस|due|baje|बजे|time|samay|समय|date|tarikh|tareekh|तारीख|minute|min|मिनट|hour|ghanta|घंटा|reminder|रिमाइंडर|checkpoints|चेकपॉइंट|assign|project)/iu.test(clean)) {
    return true;
  }
  if (/(?:badlo|badal|change|बदलो|बदल|set\s+karo|rakho|रखो)/iu.test(clean)) {
    return true;
  }
  if (/(?<![\p{L}\p{M}])(?:kal|कल|aaj|आज|tomorrow|today)(?![\p{L}\p{M}])/iu.test(clean)) {
    return true;
  }
  return false;
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
  const isDbReady = Boolean(deps.User || deps.Department || (mongoose && mongoose.connection && mongoose.connection.readyState === 1));
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
    assignees: Array.isArray(draft?.assignees) ? [...draft.assignees] : [],
    assignedUsers: Array.isArray(draft?.assignedUsers) ? [...draft.assignedUsers] : [],
    pendingAssigneeNames: Array.isArray(draft?.pendingAssigneeNames) ? [...draft.pendingAssigneeNames] : [],
    allMentionedAssignees: Array.isArray(draft?.allMentionedAssignees) ? [...draft.allMentionedAssignees] : [],
    removedAssignees: Array.isArray(draft?.removedAssignees) ? [...draft.removedAssignees] : [],
    assigneeLedger: Array.isArray(draft?.assigneeLedger) ? draft.assigneeLedger.map(e => ({ ...e })) : [],
    suggestedAssignee: draft?.suggestedAssignee ?? null,
    titlePersonCandidate: draft?.titlePersonCandidate ?? null,
    titlePersonHandled: Boolean(draft?.titlePersonHandled),
    branchId: draft?.branchId ?? null,
    intent: draft?.intent || (draft?.taskFor === 'others' ? 'task_assigned_user' : 'self_task'),
    taskFor: draft?.taskFor || 'self',
    wantsOthers: Boolean(draft?.wantsOthers),
    projectId: draft?.projectId ?? null,
    projectName: draft?.projectName ?? null,
    dueDate: draft?.dueDate ?? draft?.dueDateTime ?? null,
    file: draft?.file ?? null,
    pdfFile: draft?.pdfFile ?? null,
    askCounts: typeof draft?.askCounts === 'object' && draft?.askCounts ? { ...draft.askCounts } : {},
    skipped: Array.isArray(draft?.skipped) ? [...draft.skipped] : [],
    asked: Array.isArray(draft?.asked) ? [...draft.asked] : [],
    attachmentsCount: typeof draft?.attachmentsCount === 'number' ? draft.attachmentsCount : 0,
    name: draft?.name ?? draft?.projectName ?? null,
    startDate: draft?.startDate ?? null,
    endDate: draft?.endDate ?? null,
    members: Array.isArray(draft?.members) ? [...draft.members] : [],
    duplicateHandled: Boolean(draft?.duplicateHandled),
    chainedTaskId: draft?.chainedTaskId ?? null,
    documentPdf: draft?.documentPdf ?? draft?.pdfFile ?? draft?.file ?? null,
    client: draft?.client ?? null,
    company: draft?.company ?? null,
    city: draft?.city ?? null,
    projectManager: Array.isArray(draft?.projectManager) ? [...draft.projectManager] : [],
    team: Array.isArray(draft?.team) ? [...draft.team] : [],
    moreDetailsDone: Boolean(draft?.moreDetailsDone),
    activeDetailsGroup: draft?.activeDetailsGroup ?? null,
    industry: draft?.industry ?? null,
    gst: draft?.gst ?? null,
    pan: draft?.pan ?? null,
    website: draft?.website ?? null,
    address: draft?.address ?? null,
    state: draft?.state ?? null,
    country: draft?.country ?? null,
    pincode: draft?.pincode ?? null,
    notes: draft?.notes ?? null,
  };

  // Snapshot initially filled fields before turn execution
  const initialFilled = {
    title: Boolean(draft?.title && String(draft.title).trim()),
    description: Boolean(draft?.description !== null && draft?.description !== undefined && String(draft.description).trim()),
    dueDateTime: Boolean(draft?.dueDateTime && new Date(draft.dueDateTime).getTime() > now.getTime()),
    dueDate: Boolean(draft?.dueDate || (draft?.dueDateTime && new Date(draft.dueDateTime).getTime() > now.getTime())),
    project: Boolean(draft?.projectId || draft?.projectName),
    priority: Boolean(draft?.priority),
    status: Boolean(draft?.status),
    assignee: Boolean(draft?.assigneeId || (draft?.taskFor === 'others' && draft?.assigneeName)),
    reminder: Boolean(draft?.reminder !== null && draft?.reminder !== undefined),
    priorityDays: Boolean(draft?.priorityDays),
    repeatPattern: Boolean(draft?.repeatPattern),
    checkpoints: Boolean(Array.isArray(draft?.checkpoints) && draft.checkpoints.length > 0),
    name: Boolean(draft?.name && String(draft.name).trim()),
    startDate: Boolean(draft?.startDate),
    endDate: Boolean(draft?.endDate),
    members: Boolean(Array.isArray(draft?.members) && draft.members.length > 0),
  };

  const initialValues = {
    title: draft?.title ?? null,
    description: draft?.description ?? null,
    dueDateTime: draft?.dueDateTime ?? null,
    dueDate: draft?.dueDate ?? draft?.dueDateTime ?? null,
    projectId: draft?.projectId ?? null,
    projectName: draft?.projectName ?? null,
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

  // Retrieve accessible projects tenant-safely
  const accessibleProjects = Array.isArray(deps.accessibleProjects)
    ? deps.accessibleProjects
    : await getAccessibleProjects(req, deps);

  const companyId = req?.user?.company?._id || req?.user?.company || req?.user?.companyId;
  const rawCompanyCode = req?.user?.companyCode || req?.user?.company?.companyCode || '';
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

  // Direct project pick from pick or action
  const targetPickedProjectId = (action?.type === 'pickProject' ? (action.projectId || action.value) : null) ||
    action?.pickProject?.projectId ||
    pick?.projectId ||
    pick?.pickProject?.projectId ||
    (action?.type === 'set' && action?.field === 'projectId' ? action.value : null);

  if (targetPickedProjectId) {
    actionHandled = true;
    const matchedProj = accessibleProjects.find((p) => idsEqual(p._id, targetPickedProjectId));
    if (matchedProj) {
      if (currentDraft.intent !== 'task_project') {
        const migration = migrateDraftBetweenIntents(currentDraft.intent, 'task_project', currentDraft);
        Object.assign(currentDraft, migration.newDraft);
      }
      currentDraft.projectId = String(matchedProj._id);
      currentDraft.projectName = matchedProj.projectName;
      currentDraft.project = matchedProj.projectName;
      currentDraft.projectStartDate = matchedProj.startDate;
      currentDraft.projectIdSuffix = String(matchedProj._id).slice(-6);
      currentDraft.showDistinguishing = Boolean(
        currentDraft.showDistinguishing || requiresProjectDistinguishing(matchedProj, accessibleProjects)
      );
      currentDraft.intent = 'task_project';
      currentDraft.taskFor = 'project';
      if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
      currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'project');
    } else {
      notices.push('Selected project aapke access scope mein nahi hai.');
    }
  }

  if (action && typeof action === 'object') {
    actionHandled = true;
    switch (action.type) {
      case 'confirm_duplicate_project_name':
        currentDraft.duplicateHandled = true;
        break;
      case 'change_project_name':
        currentDraft.name = null;
        currentDraft.duplicateHandled = false;
        break;
      case 'chain_task':
        currentDraft.intent = 'task_project';
        currentDraft.taskFor = 'project';
        currentDraft.projectId = action.projectId || currentDraft.projectId || (currentDraft._id ? String(currentDraft._id) : null);
        currentDraft.projectName = action.projectName || currentDraft.projectName || currentDraft.name;
        currentDraft.title = null;
        currentDraft.description = null;
        currentDraft.dueDateTime = null;
        currentDraft.dueDate = null;
        currentDraft.assigneeId = null;
        currentDraft.assigneeName = null;
        currentDraft.assignees = [];
        currentDraft.assignedUsers = [];
        currentDraft.assigneeLedger = [];
        currentDraft.pendingAssigneeNames = [];
        currentDraft.asked = ['project'];
        currentDraft.skipped = [];
        break;
      case 'finish_chain':
        return {
          success: true,
          status: 'created',
          field: 'done',
          reply: 'Theek hai, naya task nahi banaya gaya. Agar kuch aur chahiye toh batayein!',
          speech: 'ठीक है, नया टास्क नहीं बनाया गया।',
          speakText: 'Theek hai, naya task nahi banaya gaya.',
          draft: null,
          chips: [],
          notices: [],
          progress: { done: 10, total: 10 },
          canAssignOthers,
          meta: { model: modelName },
        };
      case 'keep_title_person':
        currentDraft.titlePersonHandled = true;
        currentDraft.titlePersonCandidate = null;
        break;
      case 'remove_pending_assignee':
      case 'remove_assignee': {
        const toRemove = String(action.name || action.value || action.assigneeId || '').toLowerCase();
        removeLedgerEntry(currentDraft, { name: action.name || action.value, userId: action.assigneeId });
        currentDraft.removedAssignees = Array.isArray(currentDraft.removedAssignees)
          ? [...new Set([...currentDraft.removedAssignees, toRemove])]
          : [toRemove];
        if (Array.isArray(currentDraft.pendingAssigneeNames)) {
          currentDraft.pendingAssigneeNames = currentDraft.pendingAssigneeNames.filter(n =>
            !String(n).toLowerCase().includes(toRemove) && !toRemove.includes(String(n).toLowerCase())
          );
        }
        if (Array.isArray(currentDraft.assignees)) {
          currentDraft.assignees = currentDraft.assignees.filter(a =>
            !String(a.name || '').toLowerCase().includes(toRemove) &&
            !toRemove.includes(String(a.name || '').toLowerCase()) &&
            String(a.id || a._id).toLowerCase() !== toRemove
          );
          currentDraft.assignedUsers = currentDraft.assignees.map(a => String(a.id || a._id));
          if (currentDraft.assignees.length === 1) {
            currentDraft.assigneeId = currentDraft.assignees[0].id;
            currentDraft.assigneeName = currentDraft.assignees[0].name;
            currentDraft.assigneeLabel = currentDraft.assignees[0].label;
          } else if (currentDraft.assignees.length === 0) {
            currentDraft.assigneeId = null;
            currentDraft.assigneeName = null;
            currentDraft.assigneeLabel = null;
          } else {
            currentDraft.assigneeId = currentDraft.assignees[0].id;
            currentDraft.assigneeName = currentDraft.assignees.map(a => a.name).join(', ');
            currentDraft.assigneeLabel = currentDraft.assignees.map(a => a.name).join(', ');
          }
        }
        notices.push(`"${action.name || action.value || 'Assignee'}" ko chhod diya gaya hai.`);
        break;
      }
      case 'set_team_member': {
        const pickedId = String(action.assigneeId || action.value || '');
        const pickedName = action.value || action.name || '';
        updateLedgerWithPick(currentDraft, {
          assigneeId: pickedId,
          name: pickedName,
          pool: [],
        });
        syncAssigneeLedgerDerivedFields(currentDraft);
        const resolvedEntries = (currentDraft.assigneeLedger || []).filter(e => e.status === 'resolved' && e.userId);
        if (resolvedEntries.length > 0) {
          currentDraft.projectManager = resolvedEntries.map(e => ({
            id: e.userId,
            name: e.user?.name || e.displayName || e.rawName,
            label: e.user?.label || e.displayName || e.rawName,
            department: e.user?.department || 'General',
          }));
          currentDraft.team = currentDraft.projectManager.map(m => m.id);
        }
        currentDraft.intent = 'create_client';
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'projectManager' && f !== 'team');
        currentDraft.skipped = (currentDraft.skipped || []).filter(f => f !== 'projectManager' && f !== 'team');
        actionHandled = true;
        break;
      }
      case 'set_project_member': {
        const pickedId = String(action.assigneeId || action.value || '');
        const pickedName = action.value || action.name || '';
        updateLedgerWithPick(currentDraft, {
          assigneeId: pickedId,
          name: pickedName,
          pool: [],
        });
        syncAssigneeLedgerDerivedFields(currentDraft);
        const resolvedEntries = (currentDraft.assigneeLedger || []).filter(e => e.status === 'resolved' && e.userId);
        if (resolvedEntries.length > 0) {
          currentDraft.members = resolvedEntries.map(e => ({
            id: e.userId,
            name: e.displayName || e.rawName,
            label: e.displayName || e.rawName,
          }));
        }
        currentDraft.intent = 'create_project';
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'members');
        currentDraft.skipped = (currentDraft.skipped || []).filter(f => f !== 'members');
        actionHandled = true;
        break;
      }
      case 'set':
        if (action.field === 'taskFor') {
          if (action.value === 'project') {
            const migration = migrateDraftBetweenIntents(currentDraft.intent, 'task_project', currentDraft);
            Object.assign(currentDraft, migration.newDraft);
            currentDraft.taskFor = 'project';
          } else {
            const targetIntent = action.value === 'others' ? 'task_assigned_user' : 'self_task';
            const migration = migrateDraftBetweenIntents(currentDraft.intent, targetIntent, currentDraft);
            Object.assign(currentDraft, migration.newDraft);
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
          }
        } else if (action.field === 'intent') {
          const targetIntent = action.value;
          if (FORM_REGISTRY[targetIntent]) {
            const migration = migrateDraftBetweenIntents(currentDraft.intent, targetIntent, currentDraft);
            Object.assign(currentDraft, migration.newDraft);
          }
        } else if (action.field === 'removeAssignee' || action.field === 'remove_pending_assignee' || action.type === 'remove_pending_assignee') {
          const removedName = String(action.value || action.name || action.assigneeId || '');
          removeLedgerEntry(currentDraft, { name: removedName, userId: action.assigneeId });
          notices.push(`"${action.name || action.value || 'Assignee'}" ko chhod diya gaya hai.`);
        } else if (action.field === 'assignee') {
          if (currentDraft.intent === 'self_task') {
            currentDraft.taskFor = 'others';
            currentDraft.wantsOthers = true;
            currentDraft.intent = 'task_assigned_user';
          }
          currentDraft.titlePersonHandled = true;
          currentDraft.titlePersonCandidate = null;
          if (action.value && !action.assigneeId && !pick?.assigneeId) {
            currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, [action.value]);
            syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.displayName || e.rawName,
              label: e.displayName || e.rawName,
            }));
          }
        }
          }
          if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
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
        } else if (action.field === 'members') {
          if (action.value === 'creator_only' || action.value === 'Sirf main' || action.value === 'main') {
            const creatorName = req?.user?.name || 'Aap';
            const creatorId = String(req?.user?._id || req?.user?.id || 'creator');
            currentDraft.members = [{ id: creatorId, name: creatorName, label: creatorName }];
          } else if (Array.isArray(action.value)) {
            currentDraft.members = action.value;
          } else if (typeof action.value === 'string') {
            if (action.assigneeId && Array.isArray(currentDraft.assigneeLedger)) {
              const unres = getFirstUnresolvedLedgerEntry(currentDraft);
              if (unres) {
                unres.status = 'resolved';
                unres.userId = String(action.assigneeId);
                unres.displayName = action.value;
                unres.user = {
                  id: String(action.assigneeId),
                  _id: String(action.assigneeId),
                  name: action.value,
                  label: action.value,
                  department: action.department || 'General',
                };
              }
              const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
              currentDraft.members = resolvedEntries.map(e => ({
                id: e.userId,
                name: e.user?.name || e.displayName || e.rawName,
                label: e.user?.label || e.displayName || e.rawName,
                department: e.user?.department || 'General',
              }));
            } else {
              const mNames = extractMultipleAssignees(action.value).names;
              if (mNames && mNames.length > 0) {
                currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, mNames);
              }
            }
          }
          if (!currentDraft.asked.includes('members')) currentDraft.asked.push('members');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'members');
        } else if (action.field) {
          currentDraft[action.field] = action.value;
          if (!currentDraft.asked.includes(action.field)) currentDraft.asked.push(action.field);
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== action.field);
        }
        break;
      case 'pickProject':
        // Project selection handled by targetPickedProjectId above
        break;
      case 'skip': {
        const targetField = action.field || lastAskedField;
        if (targetField) {
          if (targetField === 'title') {
            currentDraft.title = null;
            currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'title');
            return {
              success: true,
              status: 'needs_input',
              field: 'title',
              reply: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
              speech: 'टास्क का नाम ज़रूरी है, इसको स्किप नहीं कर सकते। कृपया टास्क का नाम बताएं।',
              speakText: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
              draft: currentDraft,
              missing: ['title'],
              chips: [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 0, total: 10 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
          if (currentDraft.intent === 'create_project' && ['name', 'description', 'startDate', 'endDate', 'members'].includes(targetField)) {
            currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== targetField);
            const msgMap = {
              name: 'Project ka naam zaroori hai, isko skip nahi kar sakte. Kripya project ka naam batayein:',
              description: 'Project ka description zaroori hai, isko skip nahi kar sakte. Kripya description batayein:',
              startDate: 'Project ki start date zaroori hai, isko skip nahi kar sakte. Kripya start date batayein:',
              endDate: 'Project ki end date zaroori hai, isko skip nahi kar sakte. Kripya end date batayein:',
              members: 'Kam se kam ek team member zaroori hai, isko skip nahi kar sakte. Project mein kaun kaun members honge? Naam batayein (aap khud shamil honge)',
            };
            return {
              success: true,
              status: 'needs_input',
              field: targetField,
              reply: msgMap[targetField] || `${targetField} zaroori hai.`,
              speech: msgMap[targetField] || `${targetField} zaroori hai.`,
              speakText: msgMap[targetField] || `${targetField} zaroori hai.`,
              draft: currentDraft,
              missing: [targetField],
              chips: targetField === 'members' ? [{ label: 'Sirf main', action: { type: 'set', field: 'members', value: 'creator_only' } }] : [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 0, total: 6 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
          if (currentDraft.intent === 'create_client' && ['client', 'company', 'city', 'projectManager'].includes(targetField)) {
            currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== targetField);
            const msgMap = {
              client: 'Client ka naam zaroori hai, isko skip nahi kar sakte. Kripya client ka naam batayein:',
              company: 'Company ka naam zaroori hai, isko skip nahi kar sakte. Kripya company ka naam batayein:',
              city: 'City zaroori hai, isko skip nahi kar sakte. Kripya city batayein:',
              projectManager: 'Kam se kam ek team member chunna zaroori hai, isko skip nahi kar sakte. Kripya team member ka naam batayein:',
            };
            return {
              success: true,
              status: 'needs_input',
              field: targetField,
              reply: msgMap[targetField] || `${targetField} zaroori hai.`,
              speech: msgMap[targetField] || `${targetField} zaroori hai.`,
              speakText: msgMap[targetField] || `${targetField} zaroori hai.`,
              draft: currentDraft,
              missing: [targetField],
              chips: [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 0, total: 4 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
          if (!currentDraft.skipped.includes(targetField)) currentDraft.skipped.push(targetField);
          if (targetField === 'description') currentDraft.description = '';
          if (targetField === 'priority') currentDraft.priority = currentDraft.intent === 'task_project' ? 'Medium' : 'medium';
          if (targetField === 'status') currentDraft.status = currentDraft.intent === 'task_project' ? 'pending' : 'pending';
          if (targetField === 'reminder') currentDraft.reminder = false;
          if (targetField === 'priorityDays') currentDraft.priorityDays = '1';
          if (targetField === 'repeatPattern') currentDraft.repeatPattern = 'none';
          if (targetField === 'checkpoints') currentDraft.checkpoints = [];
          if (targetField === 'attachments' || targetField === 'file') {
            currentDraft.attachmentsCount = 0;
            currentDraft.file = null;
            currentDraft.pdfFile = null;
          }
          if (targetField === 'assignee' && currentDraft.intent === 'task_project' && formatProjectStatus(currentDraft.status) !== 'in progress') {
            currentDraft.assigneeId = null;
            currentDraft.assigneeName = null;
            currentDraft.assigneeLabel = null;
          }
        }
        break;
      }
      case 'skip_all': {
        const allOptional = currentDraft.intent === 'create_project'
          ? ['priority', 'status', 'pdfFile']
          : (currentDraft.intent === 'create_client'
            ? ['email', 'phone', 'industry', 'gst', 'pan', 'website', 'address', 'state', 'country', 'pincode', 'description', 'notes', 'more_details']
            : ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file']);
        if (currentDraft.intent === 'create_client') {
          currentDraft.moreDetailsDone = true;
        }
        // In task_project when status is not 'in progress', assignee is optional ONLY IF not already set
        if (
          currentDraft.intent === 'task_project' &&
          formatProjectStatus(currentDraft.status) !== 'in progress' &&
          !currentDraft.assigneeId &&
          !currentDraft.assigneeName &&
          (!Array.isArray(currentDraft.assignees) || currentDraft.assignees.length === 0)
        ) {
          if (!currentDraft.skipped.includes('assignee')) currentDraft.skipped.push('assignee');
        }
        allOptional.forEach((fieldKey) => {
          if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
          if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
            if (fieldKey === 'description') currentDraft.description = '';
            if (fieldKey === 'priority') currentDraft.priority = currentDraft.intent === 'task_project' ? 'Medium' : 'medium';
            if (fieldKey === 'status') currentDraft.status = currentDraft.intent === 'task_project' ? 'pending' : 'pending';
            if (fieldKey === 'reminder') currentDraft.reminder = false;
            if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
            if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
            if (fieldKey === 'attachments' || fieldKey === 'file') {
              currentDraft.attachmentsCount = 0;
              currentDraft.file = null;
              currentDraft.pdfFile = null;
            }
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
        if (action.field === 'project') {
          currentDraft.projectId = null;
          currentDraft.projectName = null;
          currentDraft.project = null;
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'project');
          currentDraft.asked = currentDraft.asked.filter((f) => f !== 'project');
        } else if (action.field === 'assignee') {
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

  // Form Registry deterministic intent detection
  const detectedIntentResult = detectIntent({
    message: trimmedMessage,
    draft: currentDraft,
    canAssignOthers,
    accessibleProjects,
  });

  if (detectedIntentResult.isAmbiguous) {
    return {
      success: true,
      status: 'needs_input',
      field: 'intent',
      reply: detectedIntentResult.question,
      speech: 'क्या यह टास्क किसी प्रोजेक्ट के अंदर बनाना है या सामान्य टास्क?',
      speakText: 'Kya yeh task kisi project ke andar banana hai ya normal task?',
      draft: currentDraft,
      missing: ['intent'],
      chips: detectedIntentResult.chips,
      candidates: [],
      notices,
      progress: { done: 0, total: 10 },
      canAssignOthers,
      intent: { type: 'ambiguous_intent' },
      meta: { model: modelName },
    };
  }

  if (detectedIntentResult.isExplicit && detectedIntentResult.isSupported && detectedIntentResult.intent !== currentDraft.intent) {
    const migration = migrateDraftBetweenIntents(currentDraft.intent, detectedIntentResult.intent, currentDraft);
    Object.assign(currentDraft, migration.newDraft);
  }

  // Permission enforcement for create_project:
  if (currentDraft.intent === 'create_project' || detectedIntentResult.intent === 'create_project') {
    const { canCreateProject } = require('./formRegistry');
    if (!canCreateProject(req?.user, scope)) {
      return {
        success: true,
        status: 'needs_input',
        field: 'intent',
        reply: 'Aapko naya project create karne ki permission nahi hai. Aap normal task ya project task bana sakte hain.',
        speech: 'आपको नया प्रोजेक्ट बनाने की अनुमति नहीं है।',
        speakText: 'Aapko naya project create karne ki permission nahi hai.',
        draft: null,
        chips: [
          { label: 'Task banao', action: { type: 'set', field: 'intent', value: 'self_task' } },
        ],
        notices: [],
        canAssignOthers,
        intent: { type: 'permission_denied' },
        meta: { model: modelName },
      };
    }
    currentDraft.intent = 'create_project';
    if (detectedIntentResult.projectName && !currentDraft.name) {
      currentDraft.name = detectedIntentResult.projectName;
    }
  }

  // Permission enforcement for create_client (Item 8):
  if (currentDraft.intent === 'create_client' || detectedIntentResult.intent === 'create_client') {
    const { canCreateClient } = require('./formRegistry');
    if (!canCreateClient(req?.user, scope)) {
      return {
        success: true,
        status: 'needs_input',
        field: 'intent',
        reply: 'Aapko naya client create karne ki permission nahi hai. Kripya admin se sampark karein.',
        speech: 'आपको नया क्लाइंट बनाने की अनुमति नहीं है।',
        speakText: 'Aapko naya client create karne ki permission nahi hai.',
        draft: null,
        chips: [],
        notices: [],
        canAssignOthers,
        intent: { type: 'permission_denied' },
        meta: { model: modelName },
      };
    }
    currentDraft.intent = 'create_client';
    if (detectedIntentResult.clientName && !currentDraft.client) {
      currentDraft.client = detectedIntentResult.clientName;
    }
    if (detectedIntentResult.clientSlots) {
      const cSlots = detectedIntentResult.clientSlots;
      if (cSlots.client && !currentDraft.client) currentDraft.client = cSlots.client;
      if (cSlots.company && !currentDraft.company) currentDraft.company = cSlots.company;
      if (cSlots.city && !currentDraft.city) currentDraft.city = cSlots.city;
      if (cSlots.email && !currentDraft.email) currentDraft.email = cSlots.email;
      if (cSlots.phone && !currentDraft.phone) currentDraft.phone = cSlots.phone;
      if (cSlots.gst && !currentDraft.gst) currentDraft.gst = cSlots.gst;
      if (cSlots.pan && !currentDraft.pan) currentDraft.pan = cSlots.pan;
      if (cSlots.website && !currentDraft.website) currentDraft.website = cSlots.website;
      if (cSlots.address && !currentDraft.address) currentDraft.address = cSlots.address;
      if (cSlots.state && !currentDraft.state) currentDraft.state = cSlots.state;
      if (cSlots.pincode && !currentDraft.pincode) currentDraft.pincode = cSlots.pincode;
      if (cSlots.industry && !currentDraft.industry) currentDraft.industry = cSlots.industry;
      if (cSlots.description && !currentDraft.description) currentDraft.description = cSlots.description;
      if (cSlots.notes && !currentDraft.notes) currentDraft.notes = cSlots.notes;
    }
  }

  // Permission enforcement: if user cannot assign others, force to self_task
  if (!canAssignOthers && (currentDraft.taskFor === 'others' || currentDraft.intent === 'task_assigned_user')) {
    currentDraft.taskFor = 'self';
    currentDraft.wantsOthers = false;
    currentDraft.intent = 'self_task';
    currentDraft.assigneeName = null;
    currentDraft.assigneeId = null;
    currentDraft.assigneeLabel = null;
    currentDraft.assignees = [];
    currentDraft.assignedUsers = [];
    currentDraft.pendingAssigneeNames = [];
    notices.push('Aapko dusron ko task assign karne ki permission nahi hai, isliye ye aapke liye banaunga.');
  }

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
      speakText: 'Task creation cancel kar diya gaya hai.',
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

  const wasAlreadyReady = (draft?.status === 'ready' || draft?.status === 'confirming');
  if (wasAlreadyReady && !actionHandled && trimmedMessage) {
    const isAffirmative = detectedIntent?.type === 'confirm_yes' || detectedIntent?.type === 'create_now';
    const isNegative = detectedIntent?.type === 'confirm_no';
    const isFieldEdit = hasExplicitFieldEditIntent(trimmedMessage);

    if (!isAffirmative && !isNegative && !isFieldEdit) {
      // Unrecognized noise in confirming state - do not mutate draft!
      const readyConfig = TASK_FIELDS.ready;
      let payload;
      let preview;
      if (currentDraft.intent === 'task_project') {
        payload = FORM_REGISTRY.task_project.buildPayload(currentDraft);
        preview = FORM_REGISTRY.task_project.buildPreview(currentDraft);
      } else if (currentDraft.assigneeId && currentDraft.taskFor === 'others') {
        payload = FORM_REGISTRY.task_assigned_user.buildPayload(currentDraft);
        preview = FORM_REGISTRY.task_assigned_user.buildPreview(currentDraft);
      } else {
        payload = FORM_REGISTRY.self_task.buildPayload(currentDraft);
        preview = FORM_REGISTRY.self_task.buildPreview(currentDraft);
      }

      return {
        success: true,
        status: 'ready',
        field: 'ready',
        reply: 'Samajh nahi aaya. Create kar doon? Haan ya nahi bolein, ya bataiye kya badalna hai.',
        speech: 'समझ नहीं आया। क्या बना दूं? हां या नहीं बोलें, या बताइए क्या बदलना है।',
        speakText: 'Samajh nahi aaya. Create kar doon? Haan ya nahi bolein.',
        draft: currentDraft,
        missing: [],
        chips: typeof readyConfig.chips === 'function' ? readyConfig.chips() : [],
        candidates: [],
        notices,
        progress: { done: 10, total: 10 },
        canAssignOthers,
        payload,
        preview,
        intent: { type: 'unrecognized_noise' },
        meta: { model: modelName },
      };
    }
  }

  if (!actionHandled && trimmedMessage) {
    if (/\b(?:name|naam|title)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
      currentDraft.name = null;
      currentDraft.projectName = null;
      currentDraft.title = null;
      currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'name' && f !== 'title');
      actionHandled = true;
    } else if (/\b(?:dates?|tareekh|tarikh)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
      currentDraft.startDate = null;
      currentDraft.endDate = null;
      currentDraft.dueDateTime = null;
      currentDraft.dueDate = null;
      currentDraft.asked = (currentDraft.asked || []).filter(f => !['startDate', 'endDate', 'dueDate', 'dueDateTime'].includes(f));
      actionHandled = true;
    }

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

    // 2a-2. Answering person confirmation from action title question ("Priya ko assign karna hai?")
    if (!actionHandled && (lastAskedField === 'assigneeConfirmation' || currentDraft.titlePersonCandidate)) {
      const isNo = /^(?:nahi|no|title\s+mein\s+hi\s+hai|title\s+mein\s+hai|nahi\s+title|rehne\s+do|khud\s+ka\s+hai|khud\s+ke\s+liye|khud\s+hi)\b/i.test(trimmedMessage);
      const isYes = /^(?:haan|ha|yes|assign\s+karo|assign\s+kar\s+do|kar\s+do|kardo|haan\s+assign)\b/i.test(trimmedMessage);
      if (isNo) {
        currentDraft.titlePersonHandled = true;
        currentDraft.titlePersonCandidate = null;
        actionHandled = true;
      } else if (isYes && (currentDraft.titlePersonCandidate || currentDraft.assigneeName)) {
        const pName = currentDraft.titlePersonCandidate || currentDraft.assigneeName;
        currentDraft.titlePersonHandled = true;
        currentDraft.taskFor = 'others';
        currentDraft.wantsOthers = true;
        currentDraft.intent = 'task_assigned_user';
        currentDraft.assigneeName = pName;
        currentDraft.titlePersonCandidate = null;
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
        actionHandled = true;
      }
    }

    // 2a-3. Date Question Isolation: Answering a date question is parsed ONLY as a date.
    // Never pass it to the member/assignee parser!
    if (!actionHandled && (lastAskedField === 'startDate' || lastAskedField === 'endDate')) {
      const isDateSkip = isSkip(trimmedMessage) || isSkipAll(trimmedMessage);
      const isStart = lastAskedField === 'startDate';

      if (isDateSkip) {
        // Date is required in create_project, so skip is refused
        return {
          success: true,
          status: 'needs_input',
          field: lastAskedField,
          reply: isStart
            ? 'Project ki start date zaroori hai, isko skip nahi kar sakte. Kripya start date batayein (jaise: "03-11-2026" ya "kal se"):'
            : 'Project ki end date zaroori hai, isko skip nahi kar sakte. Kripya end date batayein (jaise: "30-11-2026" ya "1 mahine baad"):',
          speech: isStart
            ? 'प्रोजेक्ट की स्टार्ट डेट ज़रूरी है। कृपया स्टार्ट डेट बताएं।'
            : 'प्रोजेक्ट की एंड डेट ज़रूरी है। कृपया एंड डेट बताएं।',
          speakText: isStart
            ? 'Project ki start date zaroori hai. Kripya start date batayein.'
            : 'Project ki end date zaroori hai. Kripya end date batayein.',
          draft: currentDraft,
          missing: [lastAskedField],
          chips: isStart
            ? [
                { label: 'Aaj se', action: { type: 'set', field: 'startDate', value: formatIstDate(now) } },
                { label: 'Kal se', action: { type: 'set', field: 'startDate', value: formatIstDate(new Date(now.getTime() + 86400000)) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ]
            : [
                { label: '30 din baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('30 din baad', now) } },
                { label: '1 mahine baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('1 mahine', now) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ],
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: isStart ? 2 : 3, total: 6 },
          payload: null,
          preview: null,
          intent: null,
          meta: { model: modelName },
        };
      }

      const parsedDate = parseProjectDate(trimmedMessage, now);
      if (parsedDate) {
        if (isStart) {
          currentDraft.startDate = parsedDate;
          actionHandled = true;
        } else {
          // endDate
          if (currentDraft.startDate && parsedDate < currentDraft.startDate) {
            notices.push('End date start date se pehle nahi ho sakti. Kripya valid end date batayein.');
            currentDraft.endDate = null;
            return {
              success: true,
              status: 'needs_input',
              field: 'endDate',
              reply: 'End date start date se pehle nahi ho sakti. Kripya valid end date batayein (jaise: "30-11-2026" ya "1 mahine baad"):',
              speech: 'एंड डेट स्टार्ट डेट से पहले नहीं हो सकती। कृपया सही एंड डेट बताएं।',
              speakText: 'End date start date se pehle nahi ho sakti. Kripya valid end date batayein.',
              draft: currentDraft,
              missing: ['endDate'],
              chips: [
                { label: '30 din baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('30 din baad', now) } },
                { label: '1 mahine baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('1 mahine', now) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 3, total: 6 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          } else {
            currentDraft.endDate = parsedDate;
            actionHandled = true;
          }
        }
      } else {
        // Date could not be parsed: re-ask the same question with two example formats and chips
        return {
          success: true,
          status: 'needs_input',
          field: lastAskedField,
          reply: isStart
            ? 'Project kis date se shuru hoga? Kripya date batayein (jaise: "03-11-2026" ya "kal se"):'
            : 'Project kab tak complete hona chahiye? Kripya date batayein (jaise: "30-11-2026" ya "1 mahine baad"):',
          speech: isStart
            ? 'प्रोजेक्ट किस तारीख से शुरू होगा? कृपया तारीख बताएं जैसे 03-11-2026 या कल से।'
            : 'प्रोजेक्ट कब तक पूरा होना चाहिए? कृपया तारीख बताएं जैसे 30-11-2026 या एक महीने बाद।',
          speakText: isStart
            ? 'Project kis date se shuru hoga? Kripya date batayein jaise 03-11-2026 ya kal se.'
            : 'Project kab tak complete hona chahiye? Kripya date batayein jaise 30-11-2026 ya ek mahine baad.',
          draft: currentDraft,
          missing: [lastAskedField],
          chips: isStart
            ? [
                { label: 'Aaj se', action: { type: 'set', field: 'startDate', value: formatIstDate(now) } },
                { label: 'Kal se', action: { type: 'set', field: 'startDate', value: formatIstDate(new Date(now.getTime() + 86400000)) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ]
            : [
                { label: '30 din baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('30 din baad', now) } },
                { label: '1 mahine baad', action: { type: 'set', field: 'endDate', value: parseProjectDate('1 mahine', now) } },
                { label: 'Cancel', action: { type: 'cancel' } },
              ],
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: isStart ? 2 : 3, total: 6 },
          payload: null,
          preview: null,
          intent: null,
          meta: { model: modelName },
        };
      }
    }

    // 2b. Check if message mentions assignee(s) or contains edit commands (add/remove)
    const multiAssigneeResult = extractMultipleAssignees(trimmedMessage);
    const { names: mentionedNames, editAction } = multiAssigneeResult;

    if (editAction && canAssignOthers && currentDraft.intent !== 'create_project') {
      if (editAction.type === 'remove') {
        removeLedgerEntry(currentDraft, { name: editAction.name });
        notices.push(`"${editAction.name}" ko task se hata diya gaya hai.`);
        actionHandled = true;
      } else if (editAction.type === 'add') {
        currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, [editAction.name]);
        syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.displayName || e.rawName,
              label: e.displayName || e.rawName,
            }));
          }
        }
        if (currentDraft.intent !== 'task_project') {
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          currentDraft.intent = 'task_assigned_user';
        }
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
        actionHandled = true;
      }
    } else if (mentionedNames && mentionedNames.length > 0 && canAssignOthers && currentDraft.intent !== 'create_project') {
      currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, mentionedNames);
      syncAssigneeLedgerDerivedFields(currentDraft);
      if (currentDraft.intent !== 'task_project') {
        currentDraft.wantsOthers = true;
        currentDraft.taskFor = 'others';
        currentDraft.intent = 'task_assigned_user';
      }
      currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
    } else if (!mentionedNames?.length && lastAskedField === 'assignee' && canAssignOthers && currentDraft.intent !== 'create_project' && !actionHandled) {
      const cleanCandidate = cleanAssigneeName(trimmedMessage);
      const isNegative = detectedIntent?.type === 'cancel' || detectedIntent?.type === 'confirm_no';
      if (cleanCandidate && isValidAssigneeCandidate(cleanCandidate) && !isNegative && !isSkip(trimmedMessage) && !isSkipAll(trimmedMessage)) {
        currentDraft.assigneeLedger = mergeIntoLedger(currentDraft.assigneeLedger, [cleanCandidate]);
        syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.displayName || e.rawName,
              label: e.displayName || e.rawName,
            }));
          }
        }
        if (currentDraft.intent !== 'task_project') {
          currentDraft.wantsOthers = true;
          currentDraft.taskFor = 'others';
          currentDraft.intent = 'task_assigned_user';
        }
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
      }
    }

    // 2c-project. Direct answering for create_project slots
    if (currentDraft.intent === 'create_project' && !actionHandled) {
      if (lastAskedField === 'name' && trimmedMessage && !isSkip(trimmedMessage)) {
        currentDraft.name = trimmedMessage;
        currentDraft.duplicateHandled = false;
        actionHandled = true;
      } else if (lastAskedField === 'description' && trimmedMessage && !isSkip(trimmedMessage)) {
        currentDraft.description = trimmedMessage;
        actionHandled = true;
      } else if (lastAskedField === 'startDate' && trimmedMessage && !isSkip(trimmedMessage)) {
        const parsed = parseProjectDate(trimmedMessage, now);
        currentDraft.startDate = parsed || trimmedMessage;
        actionHandled = true;
      } else if (lastAskedField === 'endDate' && trimmedMessage && !isSkip(trimmedMessage)) {
        const parsed = parseProjectDate(trimmedMessage, now);
        currentDraft.endDate = parsed || trimmedMessage;
        actionHandled = true;
      } else if (lastAskedField === 'members' && trimmedMessage) {
        if (/^(?:sirf\s+main|sirf\s+mai|main|mai|main\s+akela|akela|self|creator_only)/i.test(trimmedMessage)) {
          const creatorName = req?.user?.name || 'Aap';
          const creatorId = String(req?.user?._id || req?.user?.id || 'creator');
          currentDraft.members = [{ id: creatorId, name: creatorName, label: creatorName }];
          actionHandled = true;
        } else if (isSkip(trimmedMessage) || isSkipAll(trimmedMessage)) {
          return {
            success: true,
            status: 'needs_input',
            field: 'members',
            reply: 'Kam se kam ek team member zaroori hai, isko skip nahi kar sakte. Project mein kaun kaun members honge? Naam batayein (aap khud shamil honge)',
            speech: 'कम से कम एक टीम सदस्य जरूरी है। कृपया सदस्य बताएं या सिर्फ मैं चुनें।',
            speakText: 'Kam se kam ek team member zaroori hai. Project mein kaun kaun members honge?',
            draft: currentDraft,
            missing: ['members'],
            chips: [
              { label: 'Sirf main', action: { type: 'set', field: 'members', value: 'creator_only' } },
              { label: 'Cancel', action: { type: 'cancel' } },
            ],
            candidates: [],
            notices,
            canAssignOthers,
            progress: { done: 4, total: 6 },
            payload: null,
            preview: null,
            intent: null,
            meta: { model: modelName },
          };
        } else {
          const mExt = extractMultipleAssignees(trimmedMessage);
          const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (trimmedMessage.trim() ? [trimmedMessage.trim()] : []);
          if (mNames && mNames.length > 0) {
            currentDraft.assigneeName = trimmedMessage;
            currentDraft.assigneeLedger = createLedger(mNames);
            if (!currentDraft.asked.includes('members')) currentDraft.asked.push('members');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'members');
          }
        }
      } else {
        const pSlots = extractCreateProjectSlotsFromMessage(trimmedMessage, now);
        if (pSlots.name && !currentDraft.name) currentDraft.name = pSlots.name;
        if (pSlots.priority && !currentDraft.priority) currentDraft.priority = pSlots.priority;
        if (pSlots.status && !currentDraft.status) currentDraft.status = pSlots.status;
        if (pSlots.startDate && !currentDraft.startDate) currentDraft.startDate = pSlots.startDate;
        if (pSlots.endDate && !currentDraft.endDate) currentDraft.endDate = pSlots.endDate;
        if (pSlots.membersText && (!currentDraft.members || currentDraft.members.length === 0)) {
          const mExt = extractMultipleAssignees(pSlots.membersText);
          const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (pSlots.membersText.trim() ? [pSlots.membersText.trim()] : []);
          if (mNames && mNames.length > 0) {
            currentDraft.assigneeName = pSlots.membersText;
            currentDraft.assigneeLedger = createLedger(mNames);
          }
        }
      }
    }

    // 2c-client. Direct answering for create_client slots
    if (currentDraft.intent === 'create_client' && !actionHandled) {
      const {
        extractCreateClientSlots,
        isValidEmail,
        isValidPhone,
        isValidGST,
        isValidPAN,
        isValidPincode,
        cleanPhone,
      } = require('./clientSlotFiller');

      // Edit commands for create_client
      if (/\b(?:email)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.email = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'email');
        actionHandled = true;
      } else if (/\bcity\s+([a-zA-Z\s_-]+?)\s*(?:karo|rakho|kar\s*do|set)\b/i.test(trimmedMessage)) {
        const cityMatch = trimmedMessage.match(/\bcity\s+([a-zA-Z\s_-]+?)\s*(?:karo|rakho|kar\s*do|set)\b/i);
        if (cityMatch && cityMatch[1]) {
          currentDraft.city = cityMatch[1].trim();
          actionHandled = true;
        }
      } else if (/\b(?:city)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.city = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'city');
        actionHandled = true;
      } else if (/\b(?:company)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.company = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'company');
        actionHandled = true;
      } else if (/\b(?:client|name|naam)\s*(?:badlo|badal|change|karo|do)\b/i.test(trimmedMessage)) {
        currentDraft.client = null;
        currentDraft.asked = (currentDraft.asked || []).filter(f => f !== 'client');
        actionHandled = true;
      }

      if (!actionHandled) {
        if (lastAskedField === 'client' && trimmedMessage && !isSkip(trimmedMessage)) {
          currentDraft.client = trimmedMessage;
          currentDraft.duplicateHandled = false;
          actionHandled = true;
        } else if (lastAskedField === 'company' && trimmedMessage && !isSkip(trimmedMessage)) {
          currentDraft.company = trimmedMessage;
          currentDraft.duplicateHandled = false;
          actionHandled = true;
        } else if (lastAskedField === 'city' && trimmedMessage && !isSkip(trimmedMessage)) {
          currentDraft.city = trimmedMessage;
          actionHandled = true;
        } else if ((lastAskedField === 'projectManager' || lastAskedField === 'team') && trimmedMessage) {
          if (isSkip(trimmedMessage) || isSkipAll(trimmedMessage)) {
            return {
              success: true,
              status: 'needs_input',
              field: 'projectManager',
              reply: 'Kam se kam ek team member chunna zaroori hai, isko skip nahi kar sakte. Kripya team member ka naam batayein:',
              speech: 'कम से कम एक टीम सदस्य चुनना जरूरी है।',
              speakText: 'Kam se kam ek team member chunna zaroori hai. Kripya team member ka naam batayein:',
              draft: currentDraft,
              missing: ['projectManager'],
              chips: [],
              candidates: [],
              notices,
              canAssignOthers,
              progress: { done: 3, total: 4 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          } else {
            const mExt = extractMultipleAssignees(trimmedMessage);
            const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (trimmedMessage.trim() ? [trimmedMessage.trim()] : []);
            if (mNames && mNames.length > 0) {
              currentDraft.assigneeName = trimmedMessage;
              currentDraft.assigneeLedger = createLedger(mNames);
              if (!currentDraft.asked.includes('projectManager')) currentDraft.asked.push('projectManager');
            }
          }
        } else if (lastAskedField === 'more_details') {
          if (/^(?:nahi|bas|no|nahi\s*bas|nahi\s*dena|done|khatam|skip|chhod\s*do)/i.test(trimmedMessage)) {
            currentDraft.moreDetailsDone = true;
            actionHandled = true;
          } else if (/contact/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'contact';
            actionHandled = true;
          } else if (/business/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'business';
            actionHandled = true;
          } else if (/address/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'address';
            actionHandled = true;
          } else if (/notes/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = 'notes';
            actionHandled = true;
          }
        } else if (currentDraft.activeDetailsGroup) {
          // Answering active details group
          if (/^(?:chhod\s*do|skip|nahi|bas)/i.test(trimmedMessage)) {
            currentDraft.activeDetailsGroup = null;
            actionHandled = true;
          } else {
            const cSlots = extractCreateClientSlots(trimmedMessage);
            if (currentDraft.activeDetailsGroup === 'contact') {
              if (cSlots.email) {
                if (isValidEmail(cSlots.email)) currentDraft.email = cSlots.email;
                else notices.push('Email format galat hai. Udaharan: name@example.com.');
              }
              if (cSlots.phone) {
                if (isValidPhone(cSlots.phone)) currentDraft.phone = cleanPhone(cSlots.phone);
                else notices.push('Phone number 10 digits ka hona chahiye (udaharan: 9876543210).');
              }
              currentDraft.activeDetailsGroup = null;
              actionHandled = true;
            } else if (currentDraft.activeDetailsGroup === 'business') {
              if (cSlots.industry) currentDraft.industry = cSlots.industry;
              if (cSlots.gst) {
                if (isValidGST(cSlots.gst)) currentDraft.gst = cSlots.gst.toUpperCase();
                else notices.push('GST format galat hai (udaharan: 22AAAAA0000A1Z5).');
              }
              if (cSlots.pan) {
                if (isValidPAN(cSlots.pan)) currentDraft.pan = cSlots.pan.toUpperCase();
                else notices.push('PAN format galat hai (udaharan: ABCDE1234F).');
              }
              if (cSlots.website) currentDraft.website = cSlots.website;
              currentDraft.activeDetailsGroup = null;
              actionHandled = true;
            } else if (currentDraft.activeDetailsGroup === 'address') {
              if (cSlots.address) currentDraft.address = cSlots.address;
              if (cSlots.state) currentDraft.state = cSlots.state;
              if (cSlots.pincode) {
                if (isValidPincode(cSlots.pincode)) currentDraft.pincode = cSlots.pincode;
                else notices.push('Pincode 6 digits ka hona chahiye (udaharan: 110001).');
              }
              currentDraft.activeDetailsGroup = null;
              actionHandled = true;
            } else if (currentDraft.activeDetailsGroup === 'notes') {
              if (cSlots.description) currentDraft.description = cSlots.description;
              if (cSlots.notes) currentDraft.notes = cSlots.notes;
              currentDraft.activeDetailsGroup = null;
              actionHandled = true;
            }
          }
        } else {
          // Conversational or one-shot input
          const cSlots = extractCreateClientSlots(trimmedMessage);
          if (cSlots.client && !currentDraft.client) currentDraft.client = cSlots.client;
          if (cSlots.company && !currentDraft.company) currentDraft.company = cSlots.company;
          if (cSlots.city && !currentDraft.city) currentDraft.city = cSlots.city;
          if (cSlots.email && !currentDraft.email) {
            if (isValidEmail(cSlots.email)) currentDraft.email = cSlots.email;
            else notices.push('Email format galat hai. Udaharan: name@example.com.');
          }
          if (cSlots.phone && !currentDraft.phone) {
            if (isValidPhone(cSlots.phone)) currentDraft.phone = cleanPhone(cSlots.phone);
            else notices.push('Phone number 10 digits ka hona chahiye (udaharan: 9876543210).');
          }
          if (cSlots.gst && !currentDraft.gst) {
            if (isValidGST(cSlots.gst)) currentDraft.gst = cSlots.gst.toUpperCase();
            else notices.push('GST format galat hai (udaharan: 22AAAAA0000A1Z5).');
          }
          if (cSlots.pan && !currentDraft.pan) {
            if (isValidPAN(cSlots.pan)) currentDraft.pan = cSlots.pan.toUpperCase();
            else notices.push('PAN format galat hai (udaharan: ABCDE1234F).');
          }
          if (cSlots.website && !currentDraft.website) currentDraft.website = cSlots.website;
          if (cSlots.address && !currentDraft.address) currentDraft.address = cSlots.address;
          if (cSlots.state && !currentDraft.state) currentDraft.state = cSlots.state;
          if (cSlots.pincode && !currentDraft.pincode) {
            if (isValidPincode(cSlots.pincode)) currentDraft.pincode = cSlots.pincode;
            else notices.push('Pincode 6 digits ka hona chahiye (udaharan: 110001).');
          }
          if (cSlots.industry && !currentDraft.industry) currentDraft.industry = cSlots.industry;
          if (cSlots.description && !currentDraft.description) currentDraft.description = cSlots.description;
          if (cSlots.notes && !currentDraft.notes) currentDraft.notes = cSlots.notes;
          if (cSlots.membersText && (!currentDraft.projectManager || currentDraft.projectManager.length === 0)) {
            const mExt = extractMultipleAssignees(cSlots.membersText);
            const mNames = mExt.names && mExt.names.length > 0 ? mExt.names : (cSlots.membersText.trim() ? [cSlots.membersText.trim()] : []);
            if (mNames && mNames.length > 0) {
              currentDraft.assigneeName = cSlots.membersText;
              currentDraft.assigneeLedger = createLedger(mNames);
            }
          }
        }
      }
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
          /^(?:haan|ha|yes|on|kar\s*do|laga\s*do|कर\s*दो|हाँ|हां|haanji|hnji|sure|ok|okay|yep|true)$/iu.test(cleanMsg) ||
          /^(?:haan|ha|yes|on|kar\s*do|laga\s*do|कर\s*दो|हाँ|हां)(?:[\s]|$)/iu.test(cleanMsg) ||
          /(?:1|one|ek|hour|ghant|baad|pehle|before|half|30|aadha|hourly|har\s*ghant|एक|घंटे|घंटा|बाद|पहले)/iu.test(cleanMsg);
        const isNegative = /^(?:nahi|no|off|band|mat\s*lagao|nahi\s*chahiye|rehne\s*do|नहीं|ना|false)$/iu.test(cleanMsg) ||
          /^(?:nahi|no|off|mat\s*lagao)(?:[\s]|$)/iu.test(cleanMsg);

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
        const allOptional = currentDraft.intent === 'create_project'
          ? ['priority', 'status', 'pdfFile']
          : (currentDraft.intent === 'create_client'
            ? ['email', 'phone', 'industry', 'gst', 'pan', 'website', 'address', 'state', 'country', 'pincode', 'description', 'notes', 'more_details']
            : ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile']);
        if (currentDraft.intent === 'create_client') {
          currentDraft.moreDetailsDone = true;
        }
        allOptional.forEach((fieldKey) => {
          if (!currentDraft.skipped.includes(fieldKey)) currentDraft.skipped.push(fieldKey);
          if (currentDraft[fieldKey] === null || currentDraft[fieldKey] === undefined) {
            if (fieldKey === 'description') currentDraft.description = '';
            if (fieldKey === 'priority') currentDraft.priority = currentDraft.intent === 'task_project' ? 'Medium' : 'medium';
            if (fieldKey === 'status') currentDraft.status = currentDraft.intent === 'task_project' ? 'pending' : 'pending';
            if (fieldKey === 'reminder') currentDraft.reminder = false;
            if (fieldKey === 'priorityDays') currentDraft.priorityDays = '1';
            if (fieldKey === 'repeatPattern') currentDraft.repeatPattern = 'none';
            if (fieldKey === 'checkpoints') currentDraft.checkpoints = [];
            if (fieldKey === 'attachments' || fieldKey === 'file' || fieldKey === 'pdfFile') {
              currentDraft.attachmentsCount = 0;
              currentDraft.file = null;
              currentDraft.pdfFile = null;
            }
          }
        });
        actionHandled = true;
      } else if (!actionHandled && isPureIntent && (detectedIntent.type === 'create_now' || detectedIntent.type === 'confirm_yes')) {
        // If required fields are filled, skip optional fields and proceed
        if (currentDraft.title && currentDraft.dueDateTime) {
          const allOptional = ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile'];
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

        if (!actionHandled && lastAskedField === 'title' && (isSkip(trimmedMessage) || isSkipAll(trimmedMessage))) {
          currentDraft.title = null;
          currentDraft.skipped = (currentDraft.skipped || []).filter((f) => f !== 'title');
          actionHandled = true;
          return {
            success: true,
            status: 'needs_input',
            field: 'title',
            reply: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
            speech: 'टास्क का नाम ज़रूरी है, इसको स्किप नहीं कर सकते। कृपया टास्क का नाम बताएं।',
            speakText: 'Task ka naam zaroori hai, isko skip nahi kar sakte. Kripya task ka naam batayein:',
            draft: currentDraft,
            missing: ['title'],
            chips: [],
            candidates: [],
            notices,
            canAssignOthers,
            progress: { done: 0, total: 10 },
            payload: null,
            preview: null,
            intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
            meta: { model: modelName },
          };
        }

        if (lastAskedField === 'description' && (!currentDraft.description) && (!detSlots.description) && trimmedMessage.length <= 300 && !isPureIntent && !isSkip(trimmedMessage)) {
          detSlots.description = trimmedMessage;
        }

        if (lastAskedField === 'title' && (!currentDraft.title) && (!detSlots.title) && trimmedMessage.length <= 100 && !isFillerPhrase(trimmedMessage) && !isPureIntent && !isSkip(trimmedMessage)) {
          detSlots.title = trimmedMessage;
        }

        if (lastAskedField === 'assignee' && (!currentDraft.assigneeId) && (!currentDraft.assigneeName) && (!detSlots.assigneeName) && trimmedMessage.length <= 50 && !isSkip(trimmedMessage)) {
          detSlots.assigneeName = trimmedMessage;
        }

        const { redactPIIForLLM } = require('./clientSlotFiller');
        const { redactedText: sanitizedForLlm, piiMap } = redactPIIForLLM(trimmedMessage);
        if (piiMap.email && !currentDraft.email) currentDraft.email = piiMap.email;
        if (piiMap.phone && !currentDraft.phone) currentDraft.phone = piiMap.phone;
        if (piiMap.gst && !currentDraft.gst) currentDraft.gst = piiMap.gst;
        if (piiMap.pan && !currentDraft.pan) currentDraft.pan = piiMap.pan;
        if (piiMap.pincode && !currentDraft.pincode) currentDraft.pincode = piiMap.pincode;

        // Invoke LLM extractor only if not action/pure-skip/handled
        let extracted = {};
        const shouldCallLlm = !actionHandled && !isPureIntent && !isSkip(trimmedMessage) && !isSkipAll(trimmedMessage);
        if (shouldCallLlm) {
          try {
            extracted = (await extractFn({
              message: sanitizedForLlm,
              now,
              previousDraft: currentDraft,
              req,
              intent: currentDraft.intent,
              canAssignOthers,
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
        if (currentDraft.intent === 'create_project') {
          currentDraft.title = null;
          currentDraft.assigneeName = null;
          currentDraft.assignees = [];
          currentDraft.assignedUsers = [];
          if (currentDraft.priority) currentDraft.priority = formatProjectPriority(currentDraft.priority);
        } else if (currentDraft.intent === 'create_client') {
          currentDraft.title = null;
          currentDraft.assigneeName = null;
          currentDraft.assignees = [];
          currentDraft.assignedUsers = [];
        } else if (currentDraft.intent === 'task_project') {
          if (currentDraft.priority) currentDraft.priority = formatProjectPriority(currentDraft.priority);
        }

        // Intent promotion: if assigneeName is extracted and user can assign others, ensure intent is task_assigned_user
        if (currentDraft.assigneeName && canAssignOthers && currentDraft.intent === 'self_task') {
          currentDraft.intent = 'task_assigned_user';
          currentDraft.taskFor = 'others';
          currentDraft.wantsOthers = true;
        } else if (!canAssignOthers && currentDraft.intent !== 'task_project' && currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client') {
          currentDraft.intent = 'self_task';
          currentDraft.taskFor = 'self';
          currentDraft.wantsOthers = false;
          currentDraft.assigneeName = null;
          currentDraft.assigneeId = null;
          currentDraft.assigneeLabel = null;
          currentDraft.assignees = [];
          currentDraft.assignedUsers = [];
          currentDraft.pendingAssigneeNames = [];
        }

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
          const allOptional = ['description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'file', 'pdfFile'];
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
              if (fieldKey === 'file') currentDraft.file = null;
              if (fieldKey === 'pdfFile') currentDraft.pdfFile = null;
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
            if (target === 'file') currentDraft.file = null;
            if (target === 'pdfFile') currentDraft.pdfFile = null;
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
          if (target === 'file') currentDraft.file = null;
          if (target === 'pdfFile') currentDraft.pdfFile = null;
        }
      }
    }
  }

  // Title sanity guard: reject command sentences/assignee echoes as task titles
  if (currentDraft.title && isInvalidOrCommandTitle(currentDraft.title, rawMessage, currentDraft.assigneeName)) {
    currentDraft.title = null;
  }

  // -------------------------------------------------------------
  // STEP 2g: Track newly extracted fields this turn for multi-field acknowledgement
  // -------------------------------------------------------------
  const newlyExtracted = [];
  if (currentDraft.intent === 'create_client') {
    if (!initialFilled.client && currentDraft.client && String(currentDraft.client).trim()) {
      newlyExtracted.push({ key: 'client', label: 'client', display: `"${currentDraft.client}"` });
    }
    if (!initialFilled.company && currentDraft.company && String(currentDraft.company).trim()) {
      newlyExtracted.push({ key: 'company', label: 'company', display: `"${currentDraft.company}"` });
    }
    if (!initialFilled.city && currentDraft.city && String(currentDraft.city).trim()) {
      newlyExtracted.push({ key: 'city', label: 'city', display: `"${currentDraft.city}"` });
    }
  } else if (currentDraft.intent === 'create_project') {
    if (!initialFilled.name && currentDraft.name && String(currentDraft.name).trim()) {
      newlyExtracted.push({ key: 'name', label: 'project name', display: `"${currentDraft.name}"` });
    }
    if (!initialFilled.startDate && currentDraft.startDate) {
      newlyExtracted.push({ key: 'startDate', label: 'start date', display: formatHumanIstDate(currentDraft.startDate) });
    }
    if (!initialFilled.endDate && currentDraft.endDate) {
      newlyExtracted.push({ key: 'endDate', label: 'end date', display: formatHumanIstDate(currentDraft.endDate) });
    }
    if (!initialFilled.members && Array.isArray(currentDraft.members) && currentDraft.members.length > 0) {
      const mNames = currentDraft.members.map(m => m.name || m.label || 'Member').join(', ');
      newlyExtracted.push({ key: 'members', label: 'members', display: mNames });
    }
  } else {
    if (!initialFilled.project && (currentDraft.projectId || currentDraft.projectName)) {
      newlyExtracted.push({ key: 'project', label: 'project', display: `"${currentDraft.projectName || currentDraft.project}"` });
    }
    if (!initialFilled.title && currentDraft.title && String(currentDraft.title).trim()) {
      newlyExtracted.push({ key: 'title', label: 'naam', display: `"${currentDraft.title}"` });
    }
    if (!initialFilled.assignee && (currentDraft.assigneeId || (currentDraft.taskFor === 'others' && currentDraft.assigneeName))) {
      newlyExtracted.push({ key: 'assignee', label: 'assignee', display: currentDraft.assigneeLabel || currentDraft.assigneeName });
    }
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
  if (!initialFilled.dueDate && currentDraft.dueDate && currentDraft.intent === 'task_project') {
    newlyExtracted.push({ key: 'dueDate', label: 'due date', display: formatHumanIstDate(currentDraft.dueDate) });
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
    const labelOrder = ['project', 'naam', 'description', 'priority', 'status', 'due date', 'assignee', 'reminder', 'checkpoints'];
    newlyExtracted.sort((a, b) => labelOrder.indexOf(a.label) - labelOrder.indexOf(b.label));

    const labels = newlyExtracted.map((item) => item.label);
    const joinedLabels = labels.length === 2
      ? `${labels[0]} aur ${labels[1]}`
      : `${labels.slice(0, -1).join(', ')} aur ${labels[labels.length - 1]}`;

    const summaryParts = newlyExtracted.map((item) => `${item.label} = ${item.display}`);
    const summaryLine = `Kya samjha: ${summaryParts.join(', ')}`;

    ackPrefix = `Samajh gaya: ${joinedLabels} mil gaye.\n${summaryLine}\n\n`;

    const hindiLabelMap = {
      project: 'प्रोजेक्ट',
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
  } else if (newlyExtracted.length === 1 && newlyExtracted[0].key === 'project') {
    ackPrefix = `Project "${currentDraft.projectName || currentDraft.project}" select ho gaya hai.\n\n`;
    speechPrefix = `प्रोजेक्ट "${currentDraft.projectName || currentDraft.project}" चुन लिया गया है। `;
  } else if (newlyExtracted.length === 1 && newlyExtracted[0].key === 'name' && currentDraft.intent === 'create_project') {
    ackPrefix = `Project "${currentDraft.name}" create kar rahe hain.\n\n`;
    speechPrefix = `प्रोजेक्ट "${currentDraft.name}" बना रहे हैं। `;
  }

  // -------------------------------------------------------------
  // STEP 3: Assignee disambiguation & scope validation
  // -------------------------------------------------------------
  let currentProject = null;

  if (currentDraft.intent === 'task_project') {
    // 3a. Resolve Project
    if (!currentDraft.projectId) {
      const projRes = await resolveProject({
        req,
        message: trimmedMessage,
        projectNameText: currentDraft.projectName,
        accessibleProjects,
      }, deps);

      if (projRes.status === 'single') {
        currentProject = projRes.project;
        currentDraft.projectId = String(currentProject._id);
        currentDraft.projectName = currentProject.projectName;
        currentDraft.project = currentProject.projectName;
        currentDraft.projectStartDate = currentProject.startDate;
        currentDraft.projectIdSuffix = String(currentProject._id).slice(-6);
        currentDraft.showDistinguishing = Boolean(
          currentDraft.showDistinguishing || requiresProjectDistinguishing(currentProject, accessibleProjects)
        );
        if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
        currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'project');
      } else if (projRes.status === 'multiple') {
        if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
        return {
          success: true,
          status: 'needs_disambiguation',
          field: 'project',
          reply: projRes.reply,
          speech: projRes.speech,
          speakText: projRes.speech || projRes.reply,
          draft: currentDraft,
          missing: ['projectId'],
          chips: projRes.chips,
          candidates: projRes.projects || [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          meta: { model: modelName },
        };
      } else {
        if (!currentDraft.asked.includes('project')) currentDraft.asked.push('project');
        return {
          success: true,
          status: 'needs_input',
          field: 'project',
          reply: projRes.reply,
          speech: projRes.speech,
          speakText: projRes.speech || projRes.reply,
          draft: currentDraft,
          missing: ['projectId'],
          chips: projRes.chips,
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          meta: { model: modelName },
        };
      }
    } else {
      currentProject = accessibleProjects.find((p) => idsEqual(p._id, currentDraft.projectId));
      if (!currentProject) {
        currentDraft.projectId = null;
        currentDraft.projectName = null;
        currentDraft.project = null;
        currentDraft.projectStartDate = null;
        currentDraft.projectIdSuffix = null;
        currentDraft.showDistinguishing = false;
        const projRes = await resolveProject({
          req,
          message: trimmedMessage,
          projectNameText: null,
          accessibleProjects,
        }, deps);
        return {
          success: true,
          status: 'needs_input',
          field: 'project',
          reply: 'Chuna gaya project nahi mila ya aapke paas access nahi hai. Niche se chun lein:',
          speech: 'चुना गया प्रोजेक्ट नहीं मिला। नीचे से चुन लें।',
          speakText: 'Chuna gaya project nahi mila. Niche se chun lein.',
          draft: currentDraft,
          missing: ['projectId'],
          chips: projRes.chips,
          candidates: [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          meta: { model: modelName },
        };
      }
      currentDraft.projectName = currentProject.projectName;
      currentDraft.project = currentProject.projectName;
      currentDraft.projectStartDate = currentProject.startDate;
      currentDraft.projectIdSuffix = String(currentProject._id).slice(-6);
      currentDraft.showDistinguishing = Boolean(
        currentDraft.showDistinguishing || requiresProjectDistinguishing(currentProject, accessibleProjects)
      );
    }

    // 3b. Resolve Project Assignee against project members via Name Ledger
    const wantsProjectAssignee = Boolean(
      (currentDraft.pendingAssigneeNames && currentDraft.pendingAssigneeNames.length > 0) ||
      currentDraft.assigneeName ||
      pick?.assigneeId ||
      action?.assigneeId ||
      currentDraft.assigneeId ||
      (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0) ||
      (Array.isArray(currentDraft.assigneeLedger) && currentDraft.assigneeLedger.length > 0)
    );

    if (wantsProjectAssignee && currentProject) {
      if (!Array.isArray(currentDraft.assigneeLedger) || currentDraft.assigneeLedger.length === 0) {
        const rawName = currentDraft.assigneeName || currentDraft.assigneeLabel;
        if (rawName) {
          const multi = extractMultipleAssignees(rawName);
          const names = multi.names && multi.names.length > 0 ? multi.names : [rawName];
          currentDraft.assigneeLedger = createLedger(names);
          if (currentDraft.assigneeId) {
            updateLedgerWithPick(currentDraft, {
              assigneeId: currentDraft.assigneeId,
              name: rawName,
              pool: currentProject.users || [],
            });
          }
        } else if (currentDraft.assigneeId) {
          const member = (currentProject.users || []).find((u) => idsEqual(u._id || u, currentDraft.assigneeId));
          const mName = member?.name || 'Member';
          currentDraft.assigneeLedger = createLedger([mName]);
          updateLedgerWithPick(currentDraft, {
            assigneeId: currentDraft.assigneeId,
            name: mName,
            pool: currentProject.users || [],
          });
        }
      }

      // Handle direct chip pick
      const pickedId = pick?.assigneeId || (action?.field === 'assignee' && action.assigneeId ? action.assigneeId : null);
      if (pickedId) {
        const member = (currentProject.users || []).find((u) => idsEqual(u._id || u, pickedId));
        if (member) {
          updateLedgerWithPick(currentDraft, {
            assigneeId: String(member._id || member),
            name: member.name,
            pool: currentProject.users || [],
          });
          if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
          currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
        } else {
          notices.push('Selected user is project ke member nahi hain.');
        }
      }

      // If user typed/spoke answering an assignee prompt
      if (trimmedMessage && !pickedId && !action?.assigneeId) {
        const isAffirmativeInput = /^(?:haan|ha|han|yes|yep|yeah|sahi|theek|thik|ji|ok|okay)\b/i.test(trimmedMessage) || detectedIntent?.type === 'confirm_yes';
        const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
        if (isAffirmativeInput && currentDraft.suggestedAssignee && unresolved) {
          updateLedgerWithPick(currentDraft, {
            assigneeId: String(currentDraft.suggestedAssignee.id || currentDraft.suggestedAssignee._id),
            name: currentDraft.suggestedAssignee.name,
            targetName: unresolved.rawName,
            pool: currentProject.users || [],
          });
          currentDraft.suggestedAssignee = null;
        } else if (unresolved && !hasExplicitFieldEditIntent(trimmedMessage) && !isSkip(trimmedMessage) && !isSkipAll(trimmedMessage)) {
          const directMatch = (currentProject.users || []).find(u => {
            const uName = String(u.name || '').toLowerCase();
            return uName.includes(trimmedMessage.toLowerCase()) || trimmedMessage.toLowerCase().includes(uName);
          });
          if (directMatch) {
            updateLedgerWithPick(currentDraft, {
              assigneeId: String(directMatch._id || directMatch),
              name: directMatch.name,
              targetName: unresolved.rawName,
              pool: currentProject.users || [],
            });
          }
        }
      }

      // Fetch company users for not_member differentiation
      let companyUsers = [];
      if (Array.isArray(deps.companyUsers)) {
        companyUsers = deps.companyUsers;
      } else if (isDbReady && UserModel && typeof UserModel.find === 'function' && companyId) {
        try {
          companyUsers = await UserModel.find({ company: companyId, isActive: true })
            .select('_id name email employeeId jobRole department')
            .lean();
        } catch {
          companyUsers = [];
        }
      }

      // Evaluate unresolved ledger entries
      const pool = currentProject.users || [];
      const resolvedNotices = [];
      for (const entry of currentDraft.assigneeLedger) {
        if (entry.status === 'resolved') {
          const isMember = pool.some(u => idsEqual(u._id || u, entry.userId));
          const inScope = isMember || (await isAssigneeInScopeFn(req, scope, entry.userId, deps));
          if (!inScope) {
            entry.status = 'open';
            entry.userId = null;
            entry.resolvedUser = null;
          } else {
            continue;
          }
        }
        if (entry.status === 'removed_by_user') continue;
        evaluateLedgerEntry(entry, pool, companyUsers, { isProject: true });
        if (entry.status === 'resolved') {
          resolvedNotices.push(`${entry.user.name} add ho gaye`);
        }
      }
      syncAssigneeLedgerDerivedFields(currentDraft);

      const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
      if (unresolved) {
        if (unresolved.status === 'fuzzy_suggestions' && unresolved.suggestedUser) {
          currentDraft.suggestedAssignee = unresolved.suggestedUser;
        }
        const prefixH = resolvedNotices.length > 0 ? `${resolvedNotices.join('. ')}. ` : '';
        const prefixHi = resolvedNotices.length > 0 ? `${resolvedNotices.join('. ')}। ` : '';
        const promptObj = buildUnresolvedEntryPrompt(unresolved, prefixH, prefixHi);
        return {
          success: true,
          status: promptObj.status,
          field: 'assignee',
          reply: promptObj.reply,
          speech: promptObj.speech,
          speakText: promptObj.speech || promptObj.reply,
          draft: currentDraft,
          missing: ['assigneeId'],
          chips: promptObj.chips,
          candidates: unresolved.candidates || [],
          notices,
          canAssignOthers,
          progress: { done: 0, total: 10 },
          payload: null,
          preview: null,
          intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
          meta: { model: modelName },
        };
      } else if (resolvedNotices.length > 0) {
        notices.push(...resolvedNotices);
      }
    }
  } else if ((currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client') || ((currentDraft.intent === 'create_project' || currentDraft.intent === 'create_client') && (currentDraft.asked.includes('members') || currentDraft.asked.includes('projectManager') || lastAskedField === 'members' || lastAskedField === 'projectManager' || (Array.isArray(currentDraft.assigneeLedger) && currentDraft.assigneeLedger.length > 0)))) {
    // 3c. Regular Assignee disambiguation & scope validation (self_task & task_assigned_user, or create_project members / create_client team)
    const wantsAssignee = Boolean(
      (currentDraft.pendingAssigneeNames && currentDraft.pendingAssigneeNames.length > 0) ||
      currentDraft.assigneeName ||
      pick?.assigneeId ||
      action?.assigneeId ||
      currentDraft.assigneeId ||
      (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0) ||
      (Array.isArray(currentDraft.assigneeLedger) && currentDraft.assigneeLedger.length > 0)
    );

    if (wantsAssignee) {
      if (!canAssignOthers && currentDraft.intent !== 'create_project' && currentDraft.intent !== 'create_client') {
        currentDraft.taskFor = 'self';
        currentDraft.wantsOthers = false;
        currentDraft.intent = 'self_task';
        currentDraft.assigneeName = null;
        currentDraft.assigneeId = null;
        currentDraft.assigneeLabel = null;
        currentDraft.assignees = [];
        currentDraft.assignedUsers = [];
        currentDraft.pendingAssigneeNames = [];
        currentDraft.assigneeLedger = [];
        notices.push('Aapko dusron ko task assign karne ki permission nahi hai, isliye ye aapke liye banaunga.');
      } else {
        if (!Array.isArray(currentDraft.assigneeLedger) || currentDraft.assigneeLedger.length === 0) {
          const rawName = currentDraft.assigneeName || currentDraft.assigneeLabel;
          if (rawName) {
            const multi = extractMultipleAssignees(rawName);
            const names = multi.names && multi.names.length > 0 ? multi.names : [rawName];
            currentDraft.assigneeLedger = createLedger(names);
            if (currentDraft.assigneeId) {
              updateLedgerWithPick(currentDraft, {
                assigneeId: currentDraft.assigneeId,
                name: rawName,
                pool: [],
              });
            }
          } else if (currentDraft.assigneeId) {
            currentDraft.assigneeLedger = createLedger(['User']);
            updateLedgerWithPick(currentDraft, {
              assigneeId: currentDraft.assigneeId,
              name: 'User',
              pool: [],
            });
          }
        }

        // Direct chip pick
        const pickedId = pick?.assigneeId || (action?.field === 'assignee' && action.assigneeId ? action.assigneeId : null);
        if (pickedId) {
          let foundUser = null;
          if (isDbReady && mongoose.Types.ObjectId.isValid(pickedId) && companyId) {
            try {
              foundUser = await UserModel.findOne({
                _id: pickedId,
                company: companyId,
                isActive: true,
                ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
              }).select('_id name employeeId jobRole department branch').lean();
            } catch {
              foundUser = null;
            }
          }
          if (!foundUser) {
            foundUser = {
              _id: pickedId,
              id: pickedId,
              name: action?.value || pick?.name || pick?.value || 'User',
              department: action?.department || 'General',
            };
          }

          const inScope = await isAssigneeInScopeFn(req, scope, foundUser._id || foundUser.id, deps);
          if (!inScope) {
            notices.push('Selected user aapke branch ya department scope se bahar hain. Kripya kisi aur ko chunein.');
          } else {
            let deptDisplay = String(foundUser.department || '').trim();
            if (isDbReady && mongoose.Types.ObjectId.isValid(deptDisplay) && DeptModel) {
              try {
                const dDoc = await DeptModel.findOne({ _id: deptDisplay, company: companyId })
                  .select('name departmentName')
                  .lean();
                if (dDoc) deptDisplay = dDoc.name || dDoc.departmentName || deptDisplay;
              } catch {}
            }
            foundUser.department = deptDisplay || 'General';
            foundUser.label = formatAssigneeLabel(foundUser, deptDisplay);

            updateLedgerWithPick(currentDraft, {
              assigneeId: String(foundUser._id || foundUser.id),
              name: foundUser.name,
              targetName: action?.targetName || action?.assigneeTargetName,
              pool: [foundUser],
            });
            if (!currentDraft.asked.includes('assignee')) currentDraft.asked.push('assignee');
            currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
          }
        }

        // If user typed/spoke answering an assignee prompt
        if (trimmedMessage && !pickedId && !action?.assigneeId) {
          const isAffirmativeInput = /^(?:haan|ha|han|yes|yep|yeah|sahi|theek|thik|ji|ok|okay)\b/i.test(trimmedMessage) || detectedIntent?.type === 'confirm_yes';
          const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
          if (isAffirmativeInput && currentDraft.suggestedAssignee && unresolved) {
            updateLedgerWithPick(currentDraft, {
              assigneeId: String(currentDraft.suggestedAssignee.id || currentDraft.suggestedAssignee._id),
              name: currentDraft.suggestedAssignee.name,
              targetName: unresolved.rawName,
              pool: [currentDraft.suggestedAssignee],
            });
            currentDraft.suggestedAssignee = null;
          }
        }

        // Evaluate unresolved ledger entries
        const resolvedNotices = [];
        for (const entry of (currentDraft.assigneeLedger || [])) {
          if (entry.status === 'resolved') {
            // Re-verify that entry.userId actually belongs to the authenticated user's company
            // Never trust client-supplied userId or status: 'resolved'
            const inScope = await isAssigneeInScopeFn(req, scope, entry.userId, deps);
            if (!inScope) {
              entry.status = 'open';
              entry.userId = null;
              entry.resolvedUser = null;
            } else {
              continue;
            }
          }
          if (entry.status === 'removed_by_user') continue;

          const resolution = await resolveAssigneeFn({
            name: entry.rawName,
            requester: req.user,
          }, deps);

          if (resolution.status === 'fuzzy') {
            entry.status = 'ambiguous';
            entry.isFuzzy = true;
            entry.suggestedName = resolution.suggestedName || resolution.user?.name;
            const candUser = resolution.user;
            const id = String(candUser.id || candUser._id);
            entry.candidates = [{
              id,
              _id: id,
              name: candUser.name,
              employeeId: candUser.employeeId || '',
              jobRole: candUser.jobRole && candUser.jobRole !== 'user' ? candUser.jobRole : '',
              department: candUser.department || 'General',
              label: `Did you mean ${candUser.name}?`,
            }];
            continue;
          } else if (resolution.status === 'multiple') {
            entry.status = 'ambiguous';
            const rawCandidates = resolution.candidates || [];
            let deptMap = new Map();
            if (isDbReady && companyId) {
              const deptIdsToLookup = rawCandidates
                .map((c) => String(c.department || ''))
                .filter((d) => mongoose.Types.ObjectId.isValid(d));
              if (deptIdsToLookup.length > 0 && DeptModel) {
                try {
                  const deptDocs = await DeptModel.find({
                    _id: { $in: deptIdsToLookup },
                    company: companyId,
                  }).select('_id name departmentName').lean();
                  (deptDocs || []).forEach((d) => {
                    deptMap.set(String(d._id), d.name || d.departmentName || '');
                  });
                } catch {}
              }
            }

            entry.candidates = rawCandidates.map((c) => {
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
            continue; // Record ambiguous and continue resolving other entries
          } else if (resolution.status === 'single') {
            const candidateUser = resolution.user;
            const inScope = await isAssigneeInScopeFn(req, scope, candidateUser._id || candidateUser.id, deps);
            if (inScope) {
              const idStr = String(candidateUser._id || candidateUser.id);
              entry.status = 'resolved';
              entry.userId = idStr;
              entry.user = {
                id: idStr,
                _id: idStr,
                name: candidateUser.name,
                label: candidateUser.label || formatAssigneeLabel(candidateUser, candidateUser.department),
                department: candidateUser.department || 'General',
              };
              entry.candidates = [];
              resolvedNotices.push(`${candidateUser.name} add ho gaye`);
            } else {
              notices.push(`${candidateUser.name} aapke branch ya department scope se bahar hain.`);
              entry.status = 'not_member';
            }
          } else if (resolution.status === 'none') {
            notices.push(`"${entry.displayName || entry.rawName}" naam ka koi employee nahi mila. Kripya sahi naam batayein.`);
            entry.status = 'not_found';
          }
        }

        syncAssigneeLedgerDerivedFields(currentDraft);

        if (currentDraft.intent === 'create_project' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.members = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.user?.name || e.displayName || e.rawName,
              label: e.user?.label || e.displayName || e.rawName,
              department: e.user?.department || 'General',
            }));
          }
        }

        if (currentDraft.intent === 'create_client' && Array.isArray(currentDraft.assigneeLedger)) {
          const resolvedEntries = currentDraft.assigneeLedger.filter(e => e.status === 'resolved' && e.userId);
          if (resolvedEntries.length > 0) {
            currentDraft.projectManager = resolvedEntries.map(e => ({
              id: e.userId,
              name: e.user?.name || e.displayName || e.rawName,
              label: e.user?.label || e.displayName || e.rawName,
            }));
            currentDraft.team = currentDraft.projectManager;
            currentDraft.members = currentDraft.projectManager;
          }
        }

        const unresolved = getFirstUnresolvedLedgerEntry(currentDraft);
        if (unresolved) {
          if (unresolved.status === 'ambiguous') {
            candidates = unresolved.candidates || [];
            const isFuzzy = Boolean(unresolved.isFuzzy);
            const isClientFlow = currentDraft.intent === 'create_client';
            const isProjectFlow = currentDraft.intent === 'create_project';
            const actionType = isClientFlow ? 'set_team_member' : (isProjectFlow ? 'set_project_member' : 'set');
            const targetField = isClientFlow ? 'team' : (isProjectFlow ? 'members' : 'assignee');
            const disambigNoticePrefix = notices.length > 0 ? notices.join(' ') + '\n\n' : '';
            return {
              success: true,
              status: 'needs_disambiguation',
              field: targetField,
              reply: disambigNoticePrefix + (isFuzzy
                ? `Kya aapka matlab "${unresolved.suggestedName}" hai?`
                : `"${unresolved.displayName || unresolved.rawName}" naam ke multiple users mile hain. Kripya list me se sahi user chunein.`),
              speech: isFuzzy
                ? `क्या आपका मतलब "${unresolved.suggestedName}" है?`
                : `"${unresolved.displayName || unresolved.rawName}" नाम के कई कर्मचारी मिले हैं। कृपया सही कर्मचारी चुनें।`,
              speakText: isFuzzy
                ? `Kya aapka matlab ${unresolved.suggestedName} hai?`
                : `"${unresolved.displayName || unresolved.rawName}" naam ke multiple users mile hain. Sahi user chunein.`,
              draft: currentDraft,
              missing: [targetField === 'members' ? 'members' : (targetField === 'team' ? 'projectManager' : 'assigneeId')],
              chips: candidates.map((c) => ({
                label: isFuzzy ? `Did you mean ${c.name}?` : (c.label || c.name),
                action: {
                  type: actionType,
                  field: targetField,
                  value: c.name,
                  assigneeId: String(c.id || c._id),
                  department: c.department,
                },
              })),
              candidates,
              notices,
              canAssignOthers,
              progress: { done: 4, total: 6 },
              payload: null,
              preview: null,
              intent: null,
              meta: { model: modelName },
            };
          }
        } else if (resolvedNotices.length > 0) {
          notices.push(...resolvedNotices);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // STEP 4: Guided Slot-Filling Sequence (Exactly one next question)
  // -------------------------------------------------------------
  // 3c. Disambiguate person in action title (e.g. "Call Priya about invoice kal 5 baje")
  if (canAssignOthers && currentDraft.taskFor !== 'others' && currentDraft.intent !== 'task_project' && !currentDraft.titlePersonHandled) {
    const personInTitle = currentDraft.titlePersonCandidate || detectPersonInActionTitle(currentDraft.title || rawMessage);
    if (personInTitle) {
      currentDraft.titlePersonCandidate = personInTitle;
      if (!currentDraft.asked.includes('assigneeConfirmation')) currentDraft.asked.push('assigneeConfirmation');
      return {
        success: true,
        status: 'needs_input',
        field: 'assigneeConfirmation',
        reply: `${ackPrefix}${personInTitle} ko assign karna hai?`,
        speech: `${speechPrefix}${personInTitle} को असाइन करना है?`,
        speakText: `${personInTitle} ko assign karna hai?`,
        draft: currentDraft,
        missing: ['assigneeConfirmation'],
        chips: [
          { label: 'Haan, assign karo', action: { type: 'set', field: 'assignee', value: personInTitle } },
          { label: 'Nahi, title mein hi hai', action: { type: 'keep_title_person', name: personInTitle } },
        ],
        candidates: [],
        notices,
        canAssignOthers,
        progress: { done: 1, total: 8 },
        meta: { model: modelName },
      };
    }
  }

  let activeIntent = currentDraft.intent;
  if (activeIntent !== 'task_project' && activeIntent !== 'create_project' && activeIntent !== 'create_client') {
    const isOthersTask = Boolean(
      canAssignOthers &&
      currentDraft.taskFor === 'others' &&
      (currentDraft.wantsOthers || currentDraft.assigneeName || currentDraft.assigneeId) &&
      !currentDraft.skipped.includes('assignee')
    );
    activeIntent = isOthersTask ? 'task_assigned_user' : 'self_task';
    currentDraft.intent = activeIntent;
  }

  // Duplicate project name check:
  if (activeIntent === 'create_project' && currentDraft.name && !currentDraft.duplicateHandled) {
    const dup = findDuplicateProject(currentDraft.name, accessibleProjects);
    if (dup) {
      if (!currentDraft.asked.includes('name')) currentDraft.asked.push('name');
      const dupStatus = dup.status ? (dup.status.charAt(0).toUpperCase() + dup.status.slice(1)) : 'Active';
      const dupDate = dup.startDate ? formatHumanIstDate(dup.startDate) : 'No date';
      const dupMembersCount = Array.isArray(dup.users) ? dup.users.length : 0;
      const dupSummary = `Status: ${dupStatus}, Start: ${dupDate}, ${dupMembersCount} members`;

      return {
        success: true,
        status: 'needs_disambiguation',
        field: 'name',
        reply: `Is naam ka project pehle se maujood hai: "${dup.projectName}" (${dupSummary}). Kya aap yahi naam rakhna chahte hain ya doosra naam chunna chahte hain?`,
        speech: `इस नाम का प्रोजेक्ट पहले से मौजूद है। क्या आप यही नाम रखना चाहते हैं या दूसरा नाम चुनना चाहते हैं?`,
        speakText: `Is naam ka project pehle se maujood hai: "${dup.projectName}". Kya aap yahi naam rakhna chahte hain?`,
        draft: currentDraft,
        missing: ['name'],
        chips: [
          { label: `Haan, yahi naam rakhein (${dupStatus})`, action: { type: 'confirm_duplicate_project_name' } },
          { label: 'Doosra naam batayein', action: { type: 'change_project_name' } },
        ],
        candidates: [dup],
        notices,
        canAssignOthers,
      };
    }
  }

  // Duplicate client name check (Item 5):
  if (activeIntent === 'create_client' && currentDraft.client && !currentDraft.duplicateHandled) {
    const { findDuplicateClient } = require('./clientSlotFiller');
    const accessibleClients = scope.accessibleClients || [];
    const dupResult = findDuplicateClient(currentDraft.client, currentDraft.company, accessibleClients);
    if (dupResult) {
      if (!currentDraft.asked.includes('client')) currentDraft.asked.push('client');
      if (dupResult.type === 'both') {
        return {
          success: true,
          status: 'needs_disambiguation',
          field: 'client',
          reply: `Client "${currentDraft.client}" aur company "${currentDraft.company}" pehle se maujood hai.`,
          speech: 'क्लाइंट और कंपनी पहले से मौजूद है।',
          speakText: `Client "${currentDraft.client}" aur company "${currentDraft.company}" pehle se maujood hai.`,
          draft: currentDraft,
          missing: ['client'],
          chips: [
            { label: 'Doosra naam batayein', action: { type: 'change_client_name' } },
            { label: 'Cancel', action: { type: 'cancel' } },
          ],
          candidates: [dupResult.client],
          notices,
          canAssignOthers,
        };
      } else {
        return {
          success: true,
          status: 'needs_disambiguation',
          field: 'client',
          reply: `Client "${currentDraft.client}" pehle se maujood hai. Existing client mein nayi company add karna abhi support nahi hai.`,
          speech: 'क्लाइंट पहले से मौजूद है।',
          speakText: `Client "${currentDraft.client}" pehle se maujood hai.`,
          draft: currentDraft,
          missing: ['client'],
          chips: [
            { label: 'Doosra naam batayein', action: { type: 'change_client_name' } },
            { label: 'Cancel', action: { type: 'cancel' } },
          ],
          candidates: [dupResult.client],
          notices,
          canAssignOthers,
        };
      }
    }
  }
  const activeFields = getIntentSlots(activeIntent, currentDraft);

  // In project task: if status is 'in progress' and no assignee, unskip assignee
  if (activeIntent === 'task_project' && formatProjectStatus(currentDraft.status) === 'in progress' && !currentDraft.assigneeId) {
    currentDraft.skipped = currentDraft.skipped.filter((f) => f !== 'assignee');
  }

  // Check which field is missing next
  let nextFieldKey = null;

  for (const fieldKey of activeFields) {
    if (currentDraft.skipped.includes(fieldKey)) {
      continue;
    }

    if (fieldKey === 'client') {
      if (!currentDraft.client || !String(currentDraft.client).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'company') {
      if (!currentDraft.company || !String(currentDraft.company).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'city') {
      if (!currentDraft.city || !String(currentDraft.city).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'projectManager') {
      const hasPm = (Array.isArray(currentDraft.projectManager) && currentDraft.projectManager.length > 0) ||
                    (Array.isArray(currentDraft.team) && currentDraft.team.length > 0) ||
                    (Array.isArray(currentDraft.members) && currentDraft.members.length > 0);
      if (!hasPm) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'more_details') {
      if (!currentDraft.moreDetailsDone) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'name') {
      if (!currentDraft.name || !String(currentDraft.name).trim()) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'startDate') {
      if (!currentDraft.startDate) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'endDate') {
      if (!currentDraft.endDate) {
        nextFieldKey = fieldKey;
        break;
      }
      if (currentDraft.startDate && currentDraft.endDate) {
        const s = new Date(currentDraft.startDate).getTime();
        const e = new Date(currentDraft.endDate).getTime();
        if (!isNaN(s) && !isNaN(e) && e < s) {
          notices.push('End date start date se pehle nahi ho sakti. Kripya naya end date batayein.');
          currentDraft.endDate = null;
          nextFieldKey = fieldKey;
          break;
        }
      }
    } else if (fieldKey === 'members') {
      const hasMembers = (Array.isArray(currentDraft.members) && currentDraft.members.length > 0) ||
        (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0);
      if (!hasMembers) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'project') {
      if (!currentDraft.projectId) {
        nextFieldKey = fieldKey;
        break;
      }
    } else if (fieldKey === 'assignee') {
      if (activeIntent === 'task_project') {
        if (formatProjectStatus(currentDraft.status) === 'in progress' && !currentDraft.assigneeId) {
          nextFieldKey = fieldKey;
          break;
        }
        if (!currentDraft.assigneeId && !currentDraft.skipped.includes('assignee') && (currentDraft.asked.includes('assignee') || currentDraft.wantsOthers || currentDraft.assigneeName)) {
          nextFieldKey = fieldKey;
          break;
        }
      } else {
        if (!currentDraft.assigneeId) {
          nextFieldKey = fieldKey;
          break;
        }
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
    } else if (fieldKey === 'dueDate') {
      const rawDue = currentDraft.dueDate || currentDraft.dueDateTime;
      if (!rawDue) {
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
    } else if (fieldKey === 'attachments' || fieldKey === 'file') {
      if (!currentDraft.asked.includes(fieldKey) && currentDraft.attachmentsCount === 0 && !currentDraft.file && !currentDraft.pdfFile) {
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
    } else if (f === 'name' && (currentDraft.name || currentDraft.projectName)) {
      done += 1;
    } else if (f === 'startDate' && currentDraft.startDate) {
      done += 1;
    } else if (f === 'endDate' && currentDraft.endDate) {
      done += 1;
    } else if (f === 'members' && ((Array.isArray(currentDraft.members) && currentDraft.members.length > 0) || (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0))) {
      done += 1;
    } else if (f === 'pdfFile' && (currentDraft.asked.includes(f) || currentDraft.pdfFile || currentDraft.documentPdf)) {
      done += 1;
    } else if (f === 'project' && currentDraft.projectId) {
      done += 1;
    } else if (f === 'assignee' && currentDraft.assigneeId) {
      done += 1;
    } else if (f === 'title' && currentDraft.title) {
      done += 1;
    } else if (f === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) {
      done += 1;
    } else if (f === 'dueDate' && (currentDraft.dueDate || currentDraft.dueDateTime)) {
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
    } else if ((f === 'attachments' || f === 'file') && (currentDraft.asked.includes(f) || currentDraft.attachmentsCount > 0 || currentDraft.file || currentDraft.pdfFile)) {
      done += 1;
    }
  }

  // -------------------------------------------------------------
  // STEP 5: Return Question OR Ready status
  // -------------------------------------------------------------
  if (nextFieldKey) {
    currentDraft.asked = currentDraft.asked.filter((f) => f !== nextFieldKey);
    currentDraft.asked.push(nextFieldKey);

    // Anti-looping counter & question selection
    const priorAskCount = currentDraft.askCounts[nextFieldKey] || 0;
    currentDraft.askCounts[nextFieldKey] = priorAskCount + 1;
    const isReAsk = priorAskCount >= 1; // Already asked at least once before

    const fieldConfig = TASK_FIELDS[nextFieldKey] || {};
    const isPastDueTime = nextFieldKey === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() <= now.getTime();

    const hasCommandInMsg = /\b(?:task|assign|banao|bana\s*do|create|kar\s*do|kardo|karo)\b/i.test(rawMessage);
    const askTitleQuestion = (nextFieldKey === 'title' && !isReAsk && hasCommandInMsg)
      ? 'Task ka naam kya hoga?'
      : null;
    const askTitleSpeech = (nextFieldKey === 'title' && !isReAsk && hasCommandInMsg)
      ? 'टास्क का नाम क्या होगा?'
      : null;

    let replyText = isPastDueTime
      ? 'Yeh samay beet chuka hai. Kripya naya time batayein ya kal ka samay chunein.'
      : (askTitleQuestion || ((isReAsk && fieldConfig.reAskQuestion?.reply)
        ? fieldConfig.reAskQuestion.reply
        : (fieldConfig.question?.reply || 'Agli detail batayein:')));

    let speechText = isPastDueTime
      ? 'यह समय बीत चुका है। कृपया नया समय बताएं या कल का समय चुनें।'
      : (askTitleSpeech || ((isReAsk && fieldConfig.reAskQuestion?.speech)
        ? fieldConfig.reAskQuestion.speech
        : (fieldConfig.question?.speech || 'अगली डिटेल बताएं:')));

    let chipsList = [];
    if (activeIntent === 'task_project' && nextFieldKey === 'assignee' && currentProject) {
      chipsList = (currentProject.users || []).slice(0, 8).map((m) => ({
        label: m.name,
        action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id || m) },
      }));
      if (formatProjectStatus(currentDraft.status) !== 'in progress') {
        chipsList.push({ label: 'Bina assignee ke', action: { type: 'skip', field: 'assignee' } });
      }
      chipsList.push({ label: 'Cancel', action: { type: 'cancel' } });
    } else if (activeIntent === 'create_client') {
      if (nextFieldKey === 'client') {
        replyText = ackPrefix + 'Client ka naam batayein (zaroori hai):';
        speechText = 'क्लाइंट का नाम बताएं (ज़रूरी है):';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'company') {
        replyText = ackPrefix + 'Company ka naam batayein (zaroori hai):';
        speechText = 'कंपनी का नाम बताएं (ज़रूरी है):';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'city') {
        replyText = ackPrefix + 'City ka naam batayein (zaroori hai):';
        speechText = 'सिटी का नाम बताएं (ज़रूरी है):';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'projectManager') {
        replyText = ackPrefix + 'Team member ka naam batayein jo is client ko manage karenge (kam se kam ek member zaroori hai):';
        speechText = 'टीम मेंबर का नाम बताएं जो इस क्लाइंट को मैनेज करेंगे:';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'more_details') {
        if (currentDraft.activeDetailsGroup === 'contact') {
          replyText = ackPrefix + 'Email aur phone number batayein (optional):';
          speechText = 'ईमेल और फ़ोन नंबर बताएं:';
          chipsList = [{ label: 'Chhod do', action: { type: 'finish_details_group' } }, { label: 'Nahi, bas', action: { type: 'finish_more_details' } }];
        } else if (currentDraft.activeDetailsGroup === 'business') {
          replyText = ackPrefix + 'Industry, GST, PAN aur website batayein (optional):';
          speechText = 'इंडस्ट्री, जीएसटी, पैन और वेबसाइट बताएं:';
          chipsList = [{ label: 'Chhod do', action: { type: 'finish_details_group' } }, { label: 'Nahi, bas', action: { type: 'finish_more_details' } }];
        } else if (currentDraft.activeDetailsGroup === 'address') {
          replyText = ackPrefix + 'Address, state aur pincode batayein (optional):';
          speechText = 'एड्रेस, स्टेट और पिनकोड बताएं:';
          chipsList = [{ label: 'Chhod do', action: { type: 'finish_details_group' } }, { label: 'Nahi, bas', action: { type: 'finish_more_details' } }];
        } else if (currentDraft.activeDetailsGroup === 'notes') {
          replyText = ackPrefix + 'Description ya notes batayein (optional):';
          speechText = 'डिस्क्रिप्शन या नोट्स बताएं:';
          chipsList = [{ label: 'Chhod do', action: { type: 'finish_details_group' } }, { label: 'Nahi, bas', action: { type: 'finish_more_details' } }];
        } else {
          replyText = ackPrefix + 'Aur details dena hain?';
          speechText = 'और डिटेल्स देना हैं?';
          chipsList = [
            { label: 'Contact', action: { type: 'select_details_group', group: 'contact' } },
            { label: 'Business', action: { type: 'select_details_group', group: 'business' } },
            { label: 'Address', action: { type: 'select_details_group', group: 'address' } },
            { label: 'Notes', action: { type: 'select_details_group', group: 'notes' } },
            { label: 'Nahi, bas', action: { type: 'finish_more_details' } },
          ];
        }
      }
    } else if (activeIntent === 'create_project') {
      if (nextFieldKey === 'name') {
        replyText = ackPrefix + 'Naye project ka naam kya hoga?';
        speechText = 'नए प्रोजेक्ट का नाम क्या होगा?';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'description') {
        replyText = ackPrefix + 'Project ka description batayein (zaroori hai):';
        speechText = 'प्रोजेक्ट का Description बताइए (जरूरी है)।';
        chipsList = [{ label: 'Cancel', action: { type: 'cancel' } }];
      } else if (nextFieldKey === 'startDate') {
        const todayStr = formatIstDate(now);
        const tomorrowDate = new Date(now);
        tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
        const tomorrowStr = formatIstDate(tomorrowDate);
        replyText = ackPrefix + 'Project kis date se shuru hoga? (Start Date batayein)';
        speechText = 'प्रोजेक्ट किस तारीख से शुरू होगा?';
        chipsList = [
          { label: 'Aaj se', action: { type: 'set', field: 'startDate', value: todayStr } },
          { label: 'Kal se', action: { type: 'set', field: 'startDate', value: tomorrowStr } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'endDate') {
        const oneMonthDate = new Date(now);
        oneMonthDate.setUTCDate(oneMonthDate.getUTCDate() + 30);
        const nextMonthDate = new Date(now);
        nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
        replyText = ackPrefix + 'Project kab tak complete hona chahiye? (End Date batayein)';
        speechText = 'प्रोजेक्ट कब तक पूरा होना चाहिए?';
        chipsList = [
          { label: 'Aaj se 30 din', action: { type: 'set', field: 'endDate', value: formatIstDate(oneMonthDate) } },
          { label: 'Agle mahine tak', action: { type: 'set', field: 'endDate', value: formatIstDate(nextMonthDate) } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      } else if (nextFieldKey === 'priority') {
        replyText = ackPrefix + 'Project ki priority kya rakhein?';
        speechText = 'प्रोजेक्ट की Priority क्या रखें?';
        chipsList = [
          { label: 'Medium', action: { type: 'set', field: 'priority', value: 'Medium' } },
          { label: 'High', action: { type: 'set', field: 'priority', value: 'High' } },
          { label: 'Low', action: { type: 'set', field: 'priority', value: 'Low' } },
        ];
      } else if (nextFieldKey === 'status') {
        replyText = ackPrefix + 'Project ka status kya rakhein?';
        speechText = 'प्रोजेक्ट का स्टेटस क्या रखें?';
        chipsList = [
          { label: 'Active', action: { type: 'set', field: 'status', value: 'Active' } },
          { label: 'Planning', action: { type: 'set', field: 'status', value: 'Planning' } },
          { label: 'On Hold', action: { type: 'set', field: 'status', value: 'On Hold' } },
        ];
      } else if (nextFieldKey === 'members') {
        replyText = ackPrefix + 'Project mein kaun kaun members honge? Naam batayein (aap khud shamil honge)';
        speechText = 'प्रोजेक्ट में कौन-कौन सदस्य होंगे? नाम बताएं, आप खुद शामिल होंगे।';
        chipsList = [
          { label: 'Sirf main', action: { type: 'set', field: 'members', value: 'creator_only' } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      }
    } else if (activeIntent === 'task_project' && nextFieldKey === 'project') {
      chipsList = buildAccessibleProjectChips(accessibleProjects, 5);
    } else if (activeIntent === 'task_project' && nextFieldKey === 'priority') {
      chipsList = [
        { label: 'Low', action: { type: 'set', field: 'priority', value: 'Low' } },
        { label: 'Medium', action: { type: 'set', field: 'priority', value: 'Medium' } },
        { label: 'High', action: { type: 'set', field: 'priority', value: 'High' } },
        { label: 'Baaki sab default', action: { type: 'skip_all' } },
      ];
    } else if (activeIntent === 'task_project' && nextFieldKey === 'status') {
      chipsList = [
        { label: 'Pending', action: { type: 'set', field: 'status', value: 'pending' } },
        { label: 'In Progress', action: { type: 'set', field: 'status', value: 'in progress' } },
        { label: 'Completed', action: { type: 'set', field: 'status', value: 'completed' } },
        { label: 'On Hold', action: { type: 'set', field: 'status', value: 'on hold' } },
        { label: 'Cancelled', action: { type: 'set', field: 'status', value: 'cancelled' } },
      ];
    } else if (activeIntent === 'task_project' && nextFieldKey === 'file') {
      chipsList = [
        { label: 'Nahi (Skip)', action: { type: 'skip', field: 'file' } },
        { label: 'Baaki sab default', action: { type: 'skip_all' } },
      ];
    } else if (isReAsk && typeof fieldConfig.reAskChips === 'function') {
      chipsList = fieldConfig.reAskChips(now);
    } else if (typeof fieldConfig.chips === 'function') {
      chipsList = fieldConfig.chips(now);
    }

    // Filter out chips for fields that are ALREADY filled in the draft
    chipsList = chipsList.filter((chip) => {
      const field = chip?.action?.field || chip?.field;
      if (field === 'dueDateTime' && currentDraft.dueDateTime && new Date(currentDraft.dueDateTime).getTime() > now.getTime()) return false;
      if (field === 'dueDate' && currentDraft.dueDate) return false;
      if (field === 'project' && currentDraft.projectId) return false;
      if (field === 'priority' && currentDraft.priority) return false;
      if (field === 'status' && currentDraft.status) return false;
      if (field === 'description' && currentDraft.description !== null && currentDraft.description !== undefined) return false;
      if (field === 'title' && currentDraft.title) return false;
      return true;
    });

    // For Owner/Admin on the first question of a new normal task, offer [Khud ke liye] [Kisi aur ke liye]
    const isFirstQuestion = currentDraft.asked.filter((f) => f !== 'assignee' && f !== 'project').length <= 1;
    if (activeIntent !== 'task_project' && canAssignOthers && isFirstQuestion && currentDraft.taskFor !== 'others' && nextFieldKey !== 'assignee') {
      chipsList = [
        { label: 'Khud ke liye', action: { type: 'set', field: 'taskFor', value: 'self' } },
        { label: 'Kisi aur ke liye', action: { type: 'set', field: 'taskFor', value: 'others' } },
        ...chipsList,
      ];
    }

    if (ackPrefix && !replyText.startsWith(ackPrefix)) {
      replyText = ackPrefix + replyText;
    }
    if (notices.length > 0 && !replyText.includes(notices[0])) {
      replyText = notices.join(' ') + '\n\n' + replyText;
    }

    return {
      success: true,
      status: 'needs_input',
      field: nextFieldKey,
      reply: replyText,
      speech: speechText,
      speakText: speechText || replyText,
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

  // Strict Draft Validation via Form Registry before declaring READY
  const activeFormConfig = FORM_REGISTRY[currentDraft.intent] || FORM_REGISTRY.self_task;
  const draftValidation = activeFormConfig.validateDraft
    ? activeFormConfig.validateDraft(currentDraft, currentProject)
    : { valid: true };

  if (!draftValidation.valid) {
    const invalidField = draftValidation.field || 'assignee';
    currentDraft.asked = currentDraft.asked.filter((f) => f !== invalidField);

    let validationChips = [];
    if (invalidField === 'assignee' && currentProject) {
      validationChips = (currentProject.users || []).slice(0, 8).map((m) => ({
        label: m.name,
        action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id || m) },
      }));
      if (formatProjectStatus(currentDraft.status) !== 'in progress') {
        validationChips.push({ label: 'Bina assignee ke', action: { type: 'skip', field: 'assignee' } });
      }
      validationChips.push({ label: 'Cancel', action: { type: 'cancel' } });
    }

    const replyMsg = `${draftValidation.reason}. Kripya ${invalidField === 'assignee' ? 'assignee' : invalidField} select karein:`;
    const speechMsg = invalidField === 'assignee'
      ? 'कृपया इस प्रोजेक्ट के किसी सदस्य को असाइन करें।'
      : 'कृपया आवश्यक जानकारी बताएं।';

    return {
      success: true,
      status: 'needs_input',
      field: invalidField,
      reply: replyMsg,
      speech: speechMsg,
      speakText: speechMsg || replyMsg,
      draft: currentDraft,
      missing: [invalidField],
      chips: validationChips,
      candidates: [],
      notices,
      progress: { done, total },
      canAssignOthers,
      intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
      meta: { model: modelName },
    };
  }

  // Pre-ready guard: Every mentioned name must be resolved or removed_by_user
  if (!isAssigneeLedgerComplete(currentDraft)) {
    const nextUnresolved = getFirstUnresolvedLedgerEntry(currentDraft);
    if (nextUnresolved) {
      const promptObj = buildUnresolvedEntryPrompt(nextUnresolved);
      return {
        success: true,
        status: promptObj.status,
        field: 'assignee',
        reply: promptObj.reply,
        speech: promptObj.speech,
        speakText: promptObj.speech || promptObj.reply,
        draft: currentDraft,
        missing: ['assigneeId'],
        chips: promptObj.chips,
        candidates: nextUnresolved.candidates || [],
        notices,
        canAssignOthers,
        progress: { done: 0, total: 10 },
        payload: null,
        preview: null,
        intent: detectedIntent ? { type: detectedIntent.type, field: detectedIntent.field } : null,
        meta: { model: modelName },
      };
    }
  }

  // All fields are handled -> Status: READY
  const cleanedCheckpoints = getCleanCheckpoints(currentDraft.checkpoints);
  const isFinalOthers = Boolean(
    (currentDraft.assigneeId || (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0)) &&
    currentDraft.taskFor === 'others'
  );
  const taskFor = currentDraft.intent === 'task_project' ? 'project' : (isFinalOthers ? 'others' : 'self');

  let payload;
  let preview;

  if (currentDraft.intent === 'create_client') {
    payload = FORM_REGISTRY.create_client.buildPayload(currentDraft, req?.user || {}, {
      companyCode: req?.user?.companyCode,
      branchId: req?.user?.branchId || currentDraft.branchId,
    });
    preview = FORM_REGISTRY.create_client.buildPreview(currentDraft, req?.user || {});
  } else if (currentDraft.intent === 'create_project') {
    currentDraft.status = currentDraft.status || 'Active';
    currentDraft.priority = currentDraft.priority || 'Medium';
    payload = FORM_REGISTRY.create_project.buildPayload(currentDraft, req?.user || {}, {
      branchId: req?.user?.branchId || currentDraft.branchId,
      companyIdentifier: req?.user?.companyIdentifier,
    });
    preview = FORM_REGISTRY.create_project.buildPreview(currentDraft, req?.user || {});
  } else if (currentDraft.intent === 'task_project') {
    const verifiedProj = accessibleProjects.find((p) => idsEqual(p._id, currentDraft.projectId));
    if (!verifiedProj) {
      notices.push('Project access verify nahi ho saka.');
    }
    payload = FORM_REGISTRY.task_project.buildPayload(currentDraft);
    preview = FORM_REGISTRY.task_project.buildPreview(currentDraft);
  } else if (isFinalOthers) {
    payload = FORM_REGISTRY.task_assigned_user.buildPayload(currentDraft);
    preview = FORM_REGISTRY.task_assigned_user.buildPreview(currentDraft);
  } else {
    payload = FORM_REGISTRY.self_task.buildPayload(currentDraft);
    preview = FORM_REGISTRY.self_task.buildPreview(currentDraft);
  }

  const readyConfig = TASK_FIELDS.ready;

  if (wantsEditPrompt) {
    const editChips = currentDraft.intent === 'task_project'
      ? [
        { label: 'Priority badlo', action: { type: 'ask', field: 'priority' } },
        { label: 'Date badlo', action: { type: 'ask', field: 'dueDate' } },
        { label: 'Reminder badlo', action: { type: 'ask', field: 'reminder' } },
        { label: 'Haan, create karo', action: { type: 'confirm' } },
      ]
      : [
        { label: 'Priority badlo', action: { type: 'ask', field: 'priority' } },
        { label: 'Date/Time badlo', action: { type: 'ask', field: 'dueDateTime' } },
        { label: 'Reminder badlo', action: { type: 'ask', field: 'reminder' } },
        { label: 'Haan, create karo', action: { type: 'confirm' } },
      ];

    return {
      success: true,
      status: 'ready',
      field: 'ready',
      reply: 'Ji batayein kya changes karne hain? Main kar dungi.',
      speech: 'जी बताएं क्या बदलाव करने हैं? मैं कर दूंगी।',
      speakText: 'Ji batayein kya changes karne hain? Main kar dungi.',
      draft: currentDraft,
      missing: [],
      chips: editChips,
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
  if (initialValues.dueDate && currentDraft.dueDate && initialValues.dueDate !== currentDraft.dueDate) {
    const formattedDue = formatHumanIstDate(currentDraft.dueDate);
    modifiedFields.push({ key: 'dueDate', labelHinglish: `due date (${formattedDue})`, labelHindi: `ड्यू डेट (${formattedDue})` });
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
  if (initialValues.assigneeId && currentDraft.assigneeId && initialValues.assigneeId !== currentDraft.assigneeId) {
    modifiedFields.push({ key: 'assignee', labelHinglish: 'assignee', labelHindi: 'कर्मचारी' });
  }
  if (initialValues.projectId && currentDraft.projectId && initialValues.projectId !== currentDraft.projectId) {
    modifiedFields.push({ key: 'project', labelHinglish: `project ("${currentDraft.projectName}")`, labelHindi: `प्रोजेक्ट ("${currentDraft.projectName}")` });
  }

  let finalReply = ackPrefix + readyConfig.question.reply;
  let readySpeech = speechPrefix
    ? `${speechPrefix}${readyConfig.question.speech}`
    : (currentDraft.title ? `टास्क "${currentDraft.title}" तैयार है। ${readyConfig.question.speech}` : readyConfig.question.speech);
  let finalSpeech = readySpeech;

  if (currentDraft.intent === 'create_client') {
    const { maskEmail } = require('./clientSlotFiller');
    const emailNotice = currentDraft.email
      ? `Create karne par client ko login details ka email jayega: ${maskEmail(currentDraft.email)}`
      : 'Email nahi diya gaya, system auto-generated login banayega';
    finalReply = ackPrefix + `Client "${currentDraft.client}" (${currentDraft.company}, ${currentDraft.city}) ka draft taiyar hai.\n\n${emailNotice}\n\nKya main create kar doon?`;
    finalSpeech = `क्लाइंट "${currentDraft.client}" का ड्राफ्ट तैयार है। क्या मैं बना दूं?`;
    readyChips = [
      { label: 'Create karo', action: { type: 'confirm' } },
      { label: 'Edit', action: { type: 'edit' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  } else if (currentDraft.intent === 'create_project') {
    const memberCount = Array.isArray(currentDraft.members) ? currentDraft.members.length : 0;
    const memberStr = memberCount > 0 ? `Team members (${memberCount + 1}) add ho gaye hain (aap bhi member honge)` : 'Aap member honge';
    finalReply = ackPrefix + `Naya project "${currentDraft.name}" create karne ke liye draft tayar hai. Start date: ${currentDraft.startDate}, End date: ${currentDraft.endDate}. ${memberStr}. Kya main create kar doon?`;
    finalSpeech = `नया प्रोजेक्ट "${currentDraft.name}" बनाने के लिए तैयार है। आप भी सदस्य होंगे। क्या मैं बना दूं?`;
    readyChips = [
      { label: 'Haan, create kar do', action: { type: 'confirm' } },
      { label: 'Edit karein', action: { type: 'edit' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  } else if (currentDraft.intent === 'task_project' && currentDraft.projectName) {
    const last6 = currentDraft.projectId ? String(currentDraft.projectId).slice(-6) : '';
    const dateStr = currentDraft.projectStartDate ? formatCandidateDate(currentDraft.projectStartDate) : '';
    const distinguishingSuffix = (currentDraft.showDistinguishing && last6)
      ? ` (Start: ${dateStr || 'No date'}, #${last6})`
      : '';
    const projectDisplayTitle = `${currentDraft.projectName}${distinguishingSuffix}`;

    const assigneesList = Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0
      ? currentDraft.assignees
      : (currentDraft.assigneeId ? [{ name: currentDraft.assigneeName || currentDraft.assigneeLabel, id: currentDraft.assigneeId }] : []);

    let whoHinglish = '';
    let whoHindi = '';
    if (assigneesList.length > 1) {
      const names = assigneesList.map(a => a.name || a.label);
      if (names.length === 2) {
        whoHinglish = `${names[0]} aur ${names[1]}`;
        whoHindi = `${names[0]} और ${names[1]}`;
      } else {
        whoHinglish = `${names.slice(0, -1).join(', ')} aur ${names[names.length - 1]}`;
        whoHindi = `${names.slice(0, -1).join(', ')} और ${names[names.length - 1]}`;
      }
    } else if (assigneesList.length === 1) {
      whoHinglish = assigneesList[0].name || currentDraft.assigneeName || currentDraft.assigneeLabel;
      whoHindi = whoHinglish;
    }

    if (whoHinglish) {
      finalReply = ackPrefix + `Project "${projectDisplayTitle}" ke andar ${whoHinglish} ko task "${currentDraft.title}" assign karne ke liye draft tayar hai. Kya main create kar doon?`;
      finalSpeech = `प्रोजेक्ट "${currentDraft.projectName}" में ${whoHindi} को टास्क "${currentDraft.title}" असाइन करने के लिए तैयार है। क्या मैं बना दूं?`;
    } else {
      finalReply = ackPrefix + `Project "${projectDisplayTitle}" ke andar task "${currentDraft.title}" tayar hai. Kya main create kar doon?`;
      finalSpeech = `प्रोजेक्ट "${currentDraft.projectName}" में टास्क "${currentDraft.title}" तैयार है। क्या मैं बना दूं?`;
    }
  } else if (currentDraft.intent === 'task_assigned_user' && (currentDraft.assignees?.length || currentDraft.assigneeName || currentDraft.assigneeLabel)) {
    let whoHinglish = '';
    let whoHindi = '';
    if (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 1) {
      const names = currentDraft.assignees.map(a => a.name || a.label);
      if (names.length === 2) {
        whoHinglish = `${names[0]} aur ${names[1]}`;
        whoHindi = `${names[0]} और ${names[1]}`;
      } else {
        whoHinglish = `${names.slice(0, -1).join(', ')} aur ${names[names.length - 1]}`;
        whoHindi = `${names.slice(0, -1).join(', ')} और ${names[names.length - 1]}`;
      }
    } else {
      whoHinglish = currentDraft.assigneeName || currentDraft.assigneeLabel;
      whoHindi = whoHinglish;
    }
    finalReply = ackPrefix + `${whoHinglish} ko task "${currentDraft.title}" assign karne ke liye draft tayar hai. Kya main create kar doon?`;
    finalSpeech = `${whoHindi} को टास्क "${currentDraft.title}" असाइन करने के लिए तैयार है। क्या मैं बना दूं?`;
    if (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 1) {
      finalSpeech = `${whoHinglish} ko task assign karna hai. Create kar doon?`;
    }
  }

  if (modifiedFields.length > 0) {
    const labelsHinglish = modifiedFields.map((f) => f.labelHinglish).join(', ');
    const labelsHindi = modifiedFields.map((f) => f.labelHindi).join(', ');
    finalReply = `Ji aapka ${labelsHinglish} change kar diya hai. Kya main task create kar doon?`;
    finalSpeech = `जी आपका ${labelsHindi} बदल दिया है। क्या मैं टास्क क्रिएट कर दूं?`;
  }

  const unhandledUnresolved = (currentDraft.assigneeLedger || []).filter(
    (e) => (e.status === 'not_found' || e.status === 'not_member') && !e.reported
  );
  if (unhandledUnresolved.length > 0) {
    unhandledUnresolved.forEach((e) => {
      e.reported = true;
      const msg = e.status === 'not_member'
        ? `"${e.displayName || e.rawName}" aapke branch ya department scope se bahar hain.`
        : `"${e.displayName || e.rawName}" naam ka koi employee nahi mila. Kripya sahi naam batayein.`;
      if (!notices.includes(msg)) notices.push(msg);
    });
  }
  if (notices.length > 0 && !finalReply.includes(notices[0])) {
    finalReply = notices.join(' ') + '\n\n' + finalReply;
  }

  return {
    success: true,
    status: 'ready',
    field: 'ready',
    reply: finalReply,
    speech: finalSpeech,
    speakText: finalSpeech || finalReply,
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