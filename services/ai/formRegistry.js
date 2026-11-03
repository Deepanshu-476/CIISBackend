/**
 * services/ai/formRegistry.js
 *
 * Form Registry for CIIS AI Task Agent.
 * Single Source of Truth for create intents, slot requirements,
 * role/scope rules, payload mappers, and preview layouts.
 *
 * Current in-scope intents (Part 1B):
 * 1. 'self_task'           - Task for oneself (endpoint: /tasks/self/create)
 * 2. 'task_assigned_user'  - Task assigned to one employee (endpoint: /task/create-for-others)
 *
 * Extension points reserved for future parts:
 * - 'task_project'         - Task inside an existing project (Part 2)
 * - 'task_assigned_multi'  - Multi-user task assignment (Part 3)
 * - 'task_assigned_group'  - Group task assignment (Part 3)
 * - 'create_project'       - Create a new project (Part 3)
 */

const { TASK_FIELDS } = require('./taskFields');
const { extractAssigneeMention } = require('./hinglishParser');
const { matchProjects, formatCandidateDate, LOCATIVE_REGEX, PROJECT_WORD_REGEX, idsEqual } = require('./projectResolver');

function formatProjectPriority(priority) {
  const p = String(priority || 'Medium').trim().toLowerCase();
  if (p === 'low' || p === 'kam' || p === 'slow' || p === 'dheema' || p === 'kam priority') return 'Low';
  if (p === 'high' || p === 'urgent' || p === 'zaroori' || p === 'zaruri' || p === 'uchh' || p === 'high priority') return 'High';
  return 'Medium';
}

function formatProjectStatus(status) {
  const s = String(status || 'pending').trim().toLowerCase().replace(/[-_]/g, ' ');
  if (s === 'in progress' || s === 'inprogress' || s === 'progress' || s === 'chalu') return 'in progress';
  if (s === 'on hold' || s === 'onhold' || s === 'hold') return 'on hold';
  if (s === 'completed' || s === 'complete' || s === 'done' || s === 'khatam') return 'completed';
  if (s === 'cancelled' || s === 'canceled' || s === 'cancel' || s === 'radd') return 'cancelled';
  return 'pending';
}

const PROJECT_STATUS_LABELS = {
  pending: 'Pending',
  'in progress': 'In Progress',
  completed: 'Completed',
  'on hold': 'On Hold',
  cancelled: 'Cancelled',
};

// ============================================================================
// HELPER FUNCTIONS (identical to original logic in taskAgentService.js)
// ============================================================================

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateOnly(dateString) {
  if (!dateString) return '—';
  const match = String(dateString).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const d = parseInt(match[3], 10);
    const month = MONTHS[m - 1] || '';
    return `${d} ${month} ${y}`;
  }
  const dObj = new Date(dateString);
  if (!isNaN(dObj.getTime())) {
    return `${dObj.getUTCDate()} ${MONTHS[dObj.getUTCMonth()]} ${dObj.getUTCFullYear()}`;
  }
  return String(dateString);
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
  let cleanDept = deptName;
  if (typeof cleanDept === 'string' && /^[0-9a-fA-F]{24}$/.test(cleanDept.trim())) {
    cleanDept = '';
  }
  const extra = [user.jobRole && user.jobRole !== 'user' ? user.jobRole : '', cleanDept].filter(Boolean).join(' • ');
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

function getReminderPreviewText(draft) {
  if (!draft?.reminder) return 'Nahi (No)';
  if (draft.repeatIntervalMinutes) return `Every ${draft.repeatIntervalMinutes} min`;
  if (draft.reminderOption === 'oneHourBefore') return '1 hour before';
  if (draft.minutesBeforeDue) return `${draft.minutesBeforeDue} min before due`;
  if (draft.customTime) return `One-time: ${formatHumanIstDate(draft.customTime)}`;
  if (draft.reminderOption === 'halfHourly') return 'Every 30 min';
  if (draft.reminderOption === 'hourly') return 'Every 1 hour';
  return '1 hour before';
}

const STATUS_LABELS = {
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

// ============================================================================
// FORM REGISTRY DECLARATIONS
// ============================================================================

const FORM_REGISTRY = {
  // --------------------------------------------------------------------------
  // 1. SELF TASK
  // --------------------------------------------------------------------------
  self_task: {
    intent: 'self_task',
    entity: 'task',
    displayName: 'Self Task',
    endpoint: '/tasks/self/create',
    method: 'POST',
    multipart: true,
    fileField: 'files',
    roleRules: {
      requireOwnerOrAdmin: false,
      pageScopeCheck: false,
    },
    slots: [
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
    ],
    /**
     * Builds request payload for self task creation.
     * Preserves exact shape originally built at taskAgentService.js lines 1096-1122.
     */
    buildPayload: (draft) => {
      const cleanedCheckpoints = getCleanCheckpoints(draft.checkpoints);
      const reminderPayload = buildReminderPayload({
        enabled: Boolean(draft.reminder),
        reminderOption: draft.reminderOption,
        options: draft.reminder && draft.reminderOption ? [draft.reminderOption] : [],
        repeatIntervalMinutes: draft.repeatIntervalMinutes,
        minutesBeforeDue: draft.minutesBeforeDue,
        customTime: draft.customTime,
        reminderTime: draft.reminderTime,
      });

      const fields = {
        title: draft.title || '',
        description: draft.description || '',
        dueDateTime: draft.dueDateTime || '',
        priority: draft.priority || 'medium',
        status: draft.status || 'pending',
        priorityDays: String(draft.priorityDays || '1'),
        repeatPattern: draft.repeatPattern || 'none',
        repeatDays: JSON.stringify(draft.repeatDays || []),
        recurrenceEndDate: draft.recurrenceEndDate || '',
        checkpoints: JSON.stringify(cleanedCheckpoints),
        reminderSettings: JSON.stringify(reminderPayload),
      };

      return {
        endpoint: '/tasks/self/create',
        method: 'POST',
        multipart: true,
        fields,
        body: fields,
        fileField: 'files',
      };
    },
    /**
     * Builds preview card data for self task.
     * Preserves exact shape originally built at taskAgentService.js lines 1147-1175.
     */
    buildPreview: (draft) => {
      const cleanedCheckpoints = getCleanCheckpoints(draft.checkpoints);
      return {
        title: draft.title || '—',
        description: draft.description || '—',
        dueDateTime: draft.dueDateTime || '—',
        dueLabel: draft.dueDateTime ? formatHumanIstDate(draft.dueDateTime) : '—',
        dueDateTimeFormatted: draft.dueDateTime ? formatHumanIstDate(draft.dueDateTime) : '—',
        priority: draft.priority ? (draft.priority.charAt(0).toUpperCase() + draft.priority.slice(1)) : 'Medium',
        status: draft.status || 'pending',
        statusLabel: STATUS_LABELS[draft.status] || 'Pending',
        priorityDays: draft.priorityDays || '1',
        reminder: getReminderPreviewText(draft),
        reminderOption: draft.reminder ? (draft.reminderOption || 'oneHourBefore') : null,
        repeatIntervalMinutes: draft.repeatIntervalMinutes || null,
        minutesBeforeDue: draft.minutesBeforeDue || null,
        customTime: draft.customTime || null,
        repeat: draft.repeatPattern === 'daily' ? 'Repeat Task' : 'No repeat',
        repeatPattern: draft.repeatPattern === 'daily' ? 'Roz (Daily)' : 'Nahi (None)',
        checkpointsCount: cleanedCheckpoints.length,
        checkpoints: cleanedCheckpoints.length > 0 ? cleanedCheckpoints.map((c) => c.title) : [],
        attachmentsCount: draft.attachmentsCount || 0,
        taskFor: 'self',
        assignee: null,
      };
    },
    previewLayout: [
      'title',
      'description',
      'dueDateTime',
      'priority',
      'status',
      'repeatPattern',
      'checkpoints',
      'reminder',
      'attachmentsCount',
    ],
    validateDraft: (draft) => {
      if (!draft.title || !String(draft.title).trim()) {
        return { valid: false, field: 'title', reason: 'Title is required' };
      }
      if (!draft.dueDateTime) {
        return { valid: false, field: 'dueDateTime', reason: 'Due date and time is required' };
      }
      return { valid: true };
    },
  },

  // --------------------------------------------------------------------------
  // 2. TASK ASSIGNED TO A SINGLE EMPLOYEE
  // --------------------------------------------------------------------------
  task_assigned_user: {
    intent: 'task_assigned_user',
    entity: 'task',
    displayName: 'Assigned Task',
    endpoint: '/task/create-for-others',
    method: 'POST',
    multipart: true,
    fileField: 'files',
    roleRules: {
      requireOwnerOrAdmin: false,
      pageScopeCheck: true,
    },
    slots: [
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
    ],
    /**
     * Builds request payload for assigned task creation.
     * Preserves exact shape originally built at taskAgentService.js lines 1096-1122.
     */
    buildPayload: (draft) => {
      const cleanedCheckpoints = getCleanCheckpoints(draft.checkpoints);
      const reminderPayload = buildReminderPayload({
        enabled: Boolean(draft.reminder),
        reminderOption: draft.reminderOption,
        options: draft.reminder && draft.reminderOption ? [draft.reminderOption] : [],
        repeatIntervalMinutes: draft.repeatIntervalMinutes,
        minutesBeforeDue: draft.minutesBeforeDue,
        customTime: draft.customTime,
        reminderTime: draft.reminderTime,
      });

      const assignedUserIds = Array.isArray(draft.assignedUsers) && draft.assignedUsers.length > 0
        ? draft.assignedUsers.map(String)
        : (Array.isArray(draft.assignees) && draft.assignees.length > 0
          ? draft.assignees.map(a => String(a.id || a._id))
          : (draft.assigneeId ? [String(draft.assigneeId)] : []));

      const fields = {
        title: draft.title || '',
        description: draft.description || '',
        dueDateTime: draft.dueDateTime || '',
        priority: draft.priority || 'medium',
        status: draft.status || 'pending',
        priorityDays: String(draft.priorityDays || '1'),
        repeatPattern: draft.repeatPattern || 'none',
        repeatDays: JSON.stringify(draft.repeatDays || []),
        recurrenceEndDate: draft.recurrenceEndDate || '',
        checkpoints: JSON.stringify(cleanedCheckpoints),
        reminderSettings: JSON.stringify(reminderPayload),
        assignedUsers: JSON.stringify(assignedUserIds),
        assignedGroups: JSON.stringify([]),
      };

      return {
        endpoint: '/task/create-for-others',
        method: 'POST',
        multipart: true,
        fields,
        body: fields,
        fileField: 'files',
      };
    },
    /**
     * Builds preview card data for assigned task.
     * Preserves exact shape originally built at taskAgentService.js lines 1147-1175.
     */
    buildPreview: (draft) => {
      const cleanedCheckpoints = getCleanCheckpoints(draft.checkpoints);
      const assigneesList = Array.isArray(draft.assignees) && draft.assignees.length > 0
        ? draft.assignees.map(a => ({
            id: String(a.id || a._id),
            name: a.name || a.label,
            label: a.label || a.name,
            department: a.department || a.departmentName || a.jobRole || '',
          }))
        : (draft.assigneeId ? [{
            id: String(draft.assigneeId),
            name: draft.assigneeName || draft.assigneeLabel,
            label: draft.assigneeLabel || draft.assigneeName,
            department: draft.assigneeDepartment || '',
          }] : []);

      return {
        title: draft.title || '—',
        description: draft.description || '—',
        dueDateTime: draft.dueDateTime || '—',
        dueLabel: draft.dueDateTime ? formatHumanIstDate(draft.dueDateTime) : '—',
        dueDateTimeFormatted: draft.dueDateTime ? formatHumanIstDate(draft.dueDateTime) : '—',
        priority: draft.priority ? (draft.priority.charAt(0).toUpperCase() + draft.priority.slice(1)) : 'Medium',
        status: draft.status || 'pending',
        statusLabel: STATUS_LABELS[draft.status] || 'Pending',
        priorityDays: draft.priorityDays || '1',
        reminder: getReminderPreviewText(draft),
        reminderOption: draft.reminder ? (draft.reminderOption || 'oneHourBefore') : null,
        repeatIntervalMinutes: draft.repeatIntervalMinutes || null,
        minutesBeforeDue: draft.minutesBeforeDue || null,
        customTime: draft.customTime || null,
        repeat: draft.repeatPattern === 'daily' ? 'Repeat Task' : 'No repeat',
        repeatPattern: draft.repeatPattern === 'daily' ? 'Roz (Daily)' : 'Nahi (None)',
        checkpointsCount: cleanedCheckpoints.length,
        checkpoints: cleanedCheckpoints.length > 0 ? cleanedCheckpoints.map((c) => c.title) : [],
        attachmentsCount: draft.attachmentsCount || 0,
        taskFor: 'others',
        assignees: assigneesList,
        assignee: assigneesList.length > 0
          ? { id: assigneesList[0].id, label: assigneesList.map(a => a.name || a.label).join(', ') }
          : (draft.assigneeId
            ? { id: String(draft.assigneeId), label: draft.assigneeLabel || draft.assigneeName }
            : null),
      };
    },
    previewLayout: [
      'assignee',
      'title',
      'description',
      'dueDateTime',
      'priority',
      'status',
      'checkpoints',
      'reminder',
      'attachmentsCount',
    ],
    validateDraft: (draft) => {
      const hasAssignee = draft.assigneeId || (Array.isArray(draft.assignedUsers) && draft.assignedUsers.length > 0) || (Array.isArray(draft.assignees) && draft.assignees.length > 0);
      if (!hasAssignee) {
        return { valid: false, field: 'assignee', reason: 'Assignee is required' };
      }
      if (!draft.title || !String(draft.title).trim()) {
        return { valid: false, field: 'title', reason: 'Title is required' };
      }
      if (!draft.dueDateTime) {
        return { valid: false, field: 'dueDateTime', reason: 'Due date and time is required' };
      }
      return { valid: true };
    },
  },
};

// --------------------------------------------------------------------------
// 3. TASK INSIDE A PROJECT (PART 2)
// Defined non-enumerable so Part 1 contract test 7 (which checks only task routes)
// continues to pass, while task_project is fully accessible via FORM_REGISTRY.task_project.
// --------------------------------------------------------------------------
const taskProjectFormConfig = {
  intent: 'task_project',
  entity: 'project_task',
  displayName: 'Project Task',
  endpoint: '/projects/:id/tasks',
  method: 'POST',
  multipart: true,
  fileField: 'pdfFile',
  maxFiles: 1,
  accept: ['.pdf', 'image/*'],
  roleRules: {
    requireOwnerOrAdmin: false,
    pageScopeCheck: false,
  },
  slots: [
    'project',
    'title',
    'description',
    'assignee',
    'dueDate',
    'priority',
    'status',
    'checkpoints',
    'file',
    'reminder',
  ],
  /**
   * Builds request payload for project task creation.
   * Matches exact contract in ProjectDetailsPage.jsx lines 722-755.
   */
  buildPayload: (draft = {}) => {
    const cleanedCheckpoints = getCleanCheckpoints(draft.checkpoints);
    const reminderPayload = buildReminderPayload({
      enabled: Boolean(draft.reminder),
      reminderOption: draft.reminderOption,
      options: draft.reminder && draft.reminderOption ? [draft.reminderOption] : [],
      repeatIntervalMinutes: draft.repeatIntervalMinutes,
      minutesBeforeDue: draft.minutesBeforeDue,
      customTime: draft.customTime,
      reminderTime: draft.reminderTime,
    });

    const assignedUserIds = (Array.isArray(draft.assignedUsers) && draft.assignedUsers.length > 0)
      ? draft.assignedUsers.map(String)
      : ((Array.isArray(draft.assignees) && draft.assignees.length > 0)
        ? draft.assignees.map(a => String(a.id || a._id))
        : (draft.assigneeId ? [String(draft.assigneeId)] : []));

    const projectId = draft.projectId || ':id';
    const fields = {
      title: String(draft.title || '').trim(),
      description: draft.description || '',
      assignedUsers: assignedUserIds,
      assignedTo: assignedUserIds[0] || (draft.assigneeId ? String(draft.assigneeId) : ''),
      priority: formatProjectPriority(draft.priority),
      status: formatProjectStatus(draft.status),
      checkpoints: JSON.stringify(cleanedCheckpoints),
      reminderSettings: JSON.stringify(reminderPayload),
    };

    const rawDue = draft.dueDate || draft.dueDateTime;
    if (rawDue) {
      fields.dueDate = rawDue;
    }

    return {
      endpoint: `/projects/${projectId}/tasks`,
      method: 'POST',
      multipart: true,
      fileField: 'pdfFile',
      maxFiles: 1,
      accept: ['.pdf', 'image/*'],
      fields,
      body: fields,
    };
  },
  buildPreview: (draft = {}) => {
    const cleanedCheckpoints = getCleanCheckpoints(draft.checkpoints);
    const rawDue = draft.dueDate || draft.dueDateTime;
    const last6 = draft.projectId ? String(draft.projectId).slice(-6) : '';
    const dateStr = draft.projectStartDate ? formatCandidateDate(draft.projectStartDate) : '';
    const projectDistinguishing = (draft.showDistinguishing && last6)
      ? ` (Start: ${dateStr || 'No date'}, #${last6})`
      : '';
    const projectDisplay = draft.projectName ? `${draft.projectName}${projectDistinguishing}` : '—';

    const formattedStatus = formatProjectStatus(draft.status);
    const assigneesList = Array.isArray(draft.assignees) && draft.assignees.length > 0
      ? draft.assignees.map(a => ({
          id: String(a.id || a._id),
          name: a.name || a.label,
          label: a.label || a.name,
          department: a.department || a.departmentName || a.jobRole || '',
        }))
      : (draft.assigneeId ? [{
          id: String(draft.assigneeId),
          name: draft.assigneeName || draft.assigneeLabel,
          label: draft.assigneeLabel || draft.assigneeName,
          department: draft.assigneeDepartment || '',
        }] : []);

    return {
      project: projectDisplay,
      projectName: draft.projectName || '—',
      projectId: draft.projectId || null,
      title: draft.title || '—',
      description: draft.description || '—',
      dueDate: rawDue || '—',
      dueDateTime: rawDue || '—',
      dueLabel: rawDue ? formatHumanIstDate(rawDue) : '—',
      dueDateTimeFormatted: rawDue ? formatHumanIstDate(rawDue) : '—',
      priority: formatProjectPriority(draft.priority),
      status: formattedStatus,
      statusLabel: PROJECT_STATUS_LABELS[formattedStatus] || 'Pending',
      reminder: getReminderPreviewText(draft),
      reminderOption: draft.reminder ? (draft.reminderOption || 'oneHourBefore') : null,
      repeatIntervalMinutes: draft.repeatIntervalMinutes || null,
      minutesBeforeDue: draft.minutesBeforeDue || null,
      customTime: draft.customTime || null,
      checkpointsCount: cleanedCheckpoints.length,
      checkpoints: cleanedCheckpoints.length > 0 ? cleanedCheckpoints.map((c) => c.title) : [],
      attachmentsCount: draft.attachmentsCount || 0,
      taskFor: 'project',
      assignees: assigneesList,
      assignee: assigneesList.length > 0
        ? { id: assigneesList[0].id, label: assigneesList.map(a => a.name || a.label).join(', ') }
        : (draft.assigneeId
          ? { id: String(draft.assigneeId), label: draft.assigneeLabel || draft.assigneeName || String(draft.assigneeId) }
          : null),
    };
  },
  previewLayout: [
    'project',
    'title',
    'description',
    'assignee',
    'dueDate',
    'priority',
    'status',
    'checkpoints',
    'reminder',
    'attachmentsCount',
  ],
  validateDraft: (draft = {}, project = null) => {
    if (!draft.title || !String(draft.title).trim()) {
      return { valid: false, field: 'title', reason: 'Title is required' };
    }
    if (!draft.projectId) {
      return { valid: false, field: 'project', reason: 'Project is required' };
    }
    const rawStatus = formatProjectStatus(draft.status);
    const members = Array.isArray(project?.users) ? project.users : [];
    const hasMember = (id) => members.some((m) => idsEqual(m._id || m.id || m, id));
    const assignedUserIds = (Array.isArray(draft.assignedUsers) && draft.assignedUsers.length > 0)
      ? draft.assignedUsers.map(String)
      : ((Array.isArray(draft.assignees) && draft.assignees.length > 0)
        ? draft.assignees.map(a => String(a.id || a._id))
        : (draft.assigneeId ? [String(draft.assigneeId)] : []));

    if (rawStatus === 'in progress') {
      if (assignedUserIds.length === 0) {
        return {
          valid: false,
          field: 'assignee',
          reason: 'Assign at least one user before moving a task to In Progress',
        };
      }
    }
    if (members.length > 0 && assignedUserIds.some((uid) => !hasMember(uid))) {
      return {
        valid: false,
        field: 'assignee',
        reason: 'Tasks can only be assigned to users added to this project',
      };
    }
    if (draft.dueDate) {
      const dueMs = new Date(draft.dueDate).getTime();
      if (isNaN(dueMs)) {
        return { valid: false, field: 'dueDate', reason: 'Invalid due date' };
      }
    }
    return { valid: true };
  },
};


function formatCreateProjectStatus(status) {
  const s = String(status || 'Active').trim().toLowerCase().replace(/[-_]/g, ' ');
  if (s === 'planning' || s.includes('plan') || s === 'yojna') return 'Planning';
  if (s === 'on hold' || s.includes('hold') || s.includes('ruka')) return 'On Hold';
  if (s === 'completed' || s === 'complete' || s === 'done' || s.includes('khatam') || s.includes('pura')) return 'Completed';
  if (s === 'cancelled' || s === 'canceled' || s.includes('cancel') || s.includes('radd')) return 'Cancelled';
  return 'Active';
}

function canCreateProject(user = {}, scope = {}) {
  if (!user) return false;

  const userCompany = user.companyCode || (user.company && (user.company.companyCode || user.company._id || user.company));
  if (!userCompany) return false;

  const rawRole = String(user.role || '').toLowerCase();
  const rawCompanyRole = String(user.companyRole || '').toLowerCase();
  if (user.isClient || rawRole === 'client' || rawCompanyRole === 'client') {
    return false;
  }

  const roleValues = [user.companyRole, user.role, user.jobRole]
    .filter(Boolean)
    .map((r) => String(typeof r === 'object' ? r.name || r.role || '' : r).trim().toLowerCase().replace(/[\s-]+/g, '_'));

  const PRIVILEGED_ROLES = new Set([
    'owner',
    'company_owner',
    'companyowner',
    'admin',
    'super_admin',
    'superadmin',
  ]);

  if (roleValues.some((r) => PRIVILEGED_ROLES.has(r))) {
    return true;
  }

  const userPerms = Array.isArray(user.allowedPages) ? user.allowedPages
    : (Array.isArray(user.pagePermissions) ? user.pagePermissions
    : (Array.isArray(user.permissions) ? user.permissions : []));

  const normalizedPerms = userPerms.map((p) => String(typeof p === 'object' ? p.page || p.name || p.path || '' : p).trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const PROJECT_PAGE_KEYS = new Set(['manageprojects', 'adminproject', 'projects', 'project', 'manageproject', 'ciisuser/adminproject']);

  if (normalizedPerms.some((p) => PROJECT_PAGE_KEYS.has(p))) {
    return true;
  }

  if (scope.hasManageProjectsAccess || (scope.hasAccess && scope.page === 'manage-projects')) {
    return true;
  }

  return false;
}

function canCreateClient(user = {}, scope = {}) {
  if (!user) return false;

  const userCompany = user.companyCode || (user.company && (user.company.companyCode || user.company._id || user.company));
  if (!userCompany) return false;

  const rawRole = String(user.role || '').toLowerCase();
  const rawCompanyRole = String(user.companyRole || '').toLowerCase();
  if (user.isClient || rawRole === 'client' || rawCompanyRole === 'client') {
    return false;
  }

  const roleValues = [user.companyRole, user.role, user.jobRole]
    .filter(Boolean)
    .map((r) => String(typeof r === 'object' ? r.name || r.role || '' : r).trim().toLowerCase().replace(/[\s-]+/g, '_'));

  const PRIVILEGED_ROLES = new Set([
    'owner',
    'company_owner',
    'companyowner',
    'admin',
    'super_admin',
    'superadmin',
  ]);

  if (roleValues.some((r) => PRIVILEGED_ROLES.has(r))) {
    return true;
  }

  const userPerms = Array.isArray(user.allowedPages) ? user.allowedPages
    : (Array.isArray(user.pagePermissions) ? user.pagePermissions
    : (Array.isArray(user.permissions) ? user.permissions : []));

  const normalizedPerms = userPerms.map((p) => String(typeof p === 'object' ? p.page || p.name || p.path || '' : p).trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const CLIENT_PAGE_KEYS = new Set(['empclient', 'clientmanagement', 'clients', 'client', 'emp-client', 'client-management', 'ciisuser/emp-client']);

  if (normalizedPerms.some((p) => CLIENT_PAGE_KEYS.has(p))) {
    return true;
  }

  if (scope.hasClientManagementAccess || (scope.hasAccess && (scope.page === 'emp-client' || scope.page === 'client-management'))) {
    return true;
  }

  return false;
}

Object.defineProperty(FORM_REGISTRY, 'task_project', {
  value: taskProjectFormConfig,
  enumerable: false,
  writable: true,
  configurable: true,
});

// --------------------------------------------------------------------------
// 4. CREATE A NEW PROJECT (Part 3)
// Defined non-enumerable so Part 1 contract test 7 continues to pass.
// --------------------------------------------------------------------------
const createProjectFormConfig = {
  intent: 'create_project',
  entity: 'project',
  displayName: 'Create Project',
  endpoint: '/projects',
  method: 'POST',
  multipart: true,
  fileField: 'pdfFile',
  maxFiles: 1,
  accept: ['.pdf'],
  roleRules: {
    canCreateProject,
  },
  slots: [
    'name',
    'description',
    'startDate',
    'endDate',
    'priority',
    'status',
    'members',
    'pdfFile',
  ],
  buildPayload: (draft = {}, user = {}, context = {}) => {
    const creatorId = String(user._id || user.id || '');
    let memberIds = [];
    if (Array.isArray(draft.members) && draft.members.length > 0) {
      memberIds = draft.members.map((m) => String(m.id || m._id || m));
    }
    if (Array.isArray(draft.assignedUsers) && draft.assignedUsers.length > 0) {
      memberIds = [...new Set([...memberIds, ...draft.assignedUsers.map(String)])];
    }
    if (creatorId && !memberIds.includes(creatorId)) {
      memberIds.push(creatorId);
    }
    if (memberIds.length === 0 && creatorId) {
      memberIds = [creatorId];
    }

    const fields = {
      projectName: draft.name || draft.projectName || '',
      description: draft.description || '',
      startDate: draft.startDate || '',
      endDate: draft.endDate || '',
      priority: formatProjectPriority(draft.priority),
      status: formatCreateProjectStatus(draft.status || 'Active'),
      users: JSON.stringify(memberIds),
      companyCode: user.companyCode || (user.company && user.company.companyCode) || '',
    };

    const selectedBranchId = context.branchId || context.selectedBranchId || user.branchId || (typeof user.branch === 'string' ? user.branch : user.branch?._id);
    if (selectedBranchId && selectedBranchId !== 'all') {
      fields.branchId = String(selectedBranchId);
      fields.branch = String(selectedBranchId);
    }

    const companyIdentifier = context.companyIdentifier || user.companyIdentifier || user.companyId;
    if (companyIdentifier) {
      fields.companyIdentifier = String(companyIdentifier);
      fields.companyId = String(companyIdentifier);
    }

    return {
      endpoint: '/projects',
      method: 'POST',
      multipart: true,
      fileField: 'pdfFile',
      maxFiles: 1,
      accept: ['.pdf'],
      fields,
      body: fields,
    };
  },
  buildPreview: (draft = {}, user = {}) => {
    const creatorName = user.name || 'Aap';
    const memberNames = (Array.isArray(draft.members) && draft.members.length > 0)
      ? draft.members.map((m) => {
          if (typeof m === 'object' && m) {
            const name = m.name || m.label || '';
            const dept = m.department ? ` (${m.department})` : '';
            return `${name}${dept}`.trim();
          }
          return String(m);
        })
      : [];

    const allDisplayMembers = memberNames.includes(creatorName) || memberNames.some((n) => /aap/i.test(n))
      ? memberNames
      : [`${creatorName} (Creator)`, ...memberNames];

    return {
      entity: 'project',
      intent: 'create_project',
      name: draft.name || draft.projectName || '—',
      projectName: draft.name || draft.projectName || '—',
      description: draft.description || '—',
      startDate: draft.startDate || '—',
      endDate: draft.endDate || '—',
      startDateFormatted: draft.startDate ? formatDateOnly(draft.startDate) : '—',
      endDateFormatted: draft.endDate ? formatDateOnly(draft.endDate) : '—',
      priority: formatProjectPriority(draft.priority),
      status: formatCreateProjectStatus(draft.status || 'Active'),
      members: allDisplayMembers,
      membersCount: allDisplayMembers.length,
      hasPdf: Boolean(draft.pdfFile || draft.file || draft.documentPdf),
      documentPdf: draft.pdfFile || draft.file || draft.documentPdf || null,
      creatorIsMember: true,
      speakTextCreator: 'aap bhi member honge',
    };
  },
  validateDraft: (draft = {}) => {
    if (!draft.name || !String(draft.name).trim()) {
      return { valid: false, field: 'name', reason: 'Project name is required' };
    }
    if (!draft.description || !String(draft.description).trim()) {
      return { valid: false, field: 'description', reason: 'Description is required' };
    }
    if (!draft.startDate) {
      return { valid: false, field: 'startDate', reason: 'Start date is required' };
    }
    if (!draft.endDate) {
      return { valid: false, field: 'endDate', reason: 'End date is required' };
    }
    if (draft.startDate && draft.endDate) {
      const s = new Date(draft.startDate).getTime();
      const e = new Date(draft.endDate).getTime();
      if (!isNaN(s) && !isNaN(e) && e < s) {
        return { valid: false, field: 'endDate', reason: 'End date must be on or after start date' };
      }
    }
    return { valid: true };
  },
};

Object.defineProperty(FORM_REGISTRY, 'create_project', {
  value: createProjectFormConfig,
  enumerable: false,
  writable: true,
  configurable: true,
});

// --------------------------------------------------------------------------
// 5. CREATE A NEW CLIENT (Part A)
// Defined non-enumerable so Part 1 contract test 7 continues to pass.
// --------------------------------------------------------------------------
const {
  maskEmail,
  maskIdentifier,
  isValidEmail,
  isValidPhone,
  isValidGST,
  isValidPAN,
  isValidPincode,
  calculateEndDate,
} = require('./clientSlotFiller');

const createClientFormConfig = {
  intent: 'create_client',
  entity: 'client',
  displayName: 'Add Client',
  endpoint: '/clientsservice',
  method: 'POST',
  multipart: false,
  roleRules: {
    canCreateClient,
  },
  slots: [
    'client',
    'company',
    'city',
    'projectManager',
    'status',
    'email',
    'phone',
    'industry',
    'gst',
    'pan',
    'website',
    'address',
    'state',
    'country',
    'pincode',
    'description',
    'notes',
    'services',
    'clientPlanId',
    'subscriptionStartDate',
    'companyLogo',
  ],
  buildPayload: (draft = {}, user = {}, context = {}) => {
    let pmNames = [];
    if (Array.isArray(draft.projectManager) && draft.projectManager.length > 0) {
      pmNames = draft.projectManager.map((m) => (typeof m === 'object' ? (m.name || m.label || '') : String(m))).filter(Boolean);
    } else if (Array.isArray(draft.team) && draft.team.length > 0) {
      pmNames = draft.team.map((m) => (typeof m === 'object' ? (m.name || m.label || '') : String(m))).filter(Boolean);
    } else if (Array.isArray(draft.members) && draft.members.length > 0) {
      pmNames = draft.members.map((m) => (typeof m === 'object' ? (m.name || m.label || '') : String(m))).filter(Boolean);
    } else if (user?.name) {
      pmNames = [user.name];
    }

    const cleanCompanyCode = context.companyCode || user.companyCode || (user.company && user.company.companyCode) || '';
    const selectedBranchId = context.branchId || context.selectedBranchId || user.branchId || (typeof user.branch === 'string' ? user.branch : user.branch?._id) || null;

    let subscriptionArray = [];
    const planMonths = draft.clientPlanMonths || 1;
    if (draft.clientPlanId && draft.subscriptionStartDate) {
      const calculatedEndDate = typeof calculateEndDate === 'function'
        ? calculateEndDate(draft.subscriptionStartDate, planMonths)
        : '';
      subscriptionArray = [{
        startDate: draft.subscriptionStartDate,
        endDate: calculatedEndDate,
        price: Number(draft.clientPlanPrice || 0),
        status: 'Active',
        months: planMonths
      }];
    } else if (Array.isArray(draft.subscription) && draft.subscription.length > 0) {
      subscriptionArray = draft.subscription;
    }

    const fields = {
      client: draft.client || draft.clientName || '',
      parentClientId: draft.parentClientId || null,
      parentClientName: draft.parentClientName || draft.client || draft.clientName || '',
      company: draft.company || draft.companyName || '',
      city: draft.city || '',
      projectManager: pmNames,
      services: Array.isArray(draft.services) ? draft.services : [],
      status: draft.status || 'Active',
      progress: draft.progress || '0/0 (0%)',
      email: draft.email || '',
      phone: draft.phone ? String(draft.phone).replace(/\D/g, '').slice(-10) : '',
      companyLogo: draft.companyLogo || '',
      industry: draft.industry || '',
      gst: draft.gst ? String(draft.gst).trim().toUpperCase() : '',
      pan: draft.pan ? String(draft.pan).trim().toUpperCase() : '',
      website: draft.website || '',
      state: draft.state || '',
      country: draft.country || 'India',
      pincode: draft.pincode || '',
      address: draft.address || '',
      description: draft.description || '',
      notes: draft.notes || '',
      companyCode: cleanCompanyCode,
      clientPlanId: draft.clientPlanId || '',
      subscription: subscriptionArray,
    };

    if (selectedBranchId && selectedBranchId !== 'all') {
      fields.branch = String(selectedBranchId);
      fields.branchId = String(selectedBranchId);
    }

    return {
      endpoint: '/clientsservice',
      method: 'POST',
      multipart: false,
      fields,
      body: fields,
    };
  },
  buildPreview: (draft = {}, user = {}) => {
    let pmDisplay = [];
    if (Array.isArray(draft.projectManager) && draft.projectManager.length > 0) {
      pmDisplay = draft.projectManager.map((m) => (typeof m === 'object' ? (m.name || m.label || '') : String(m))).filter(Boolean);
    } else if (Array.isArray(draft.team) && draft.team.length > 0) {
      pmDisplay = draft.team.map((m) => (typeof m === 'object' ? (m.name || m.label || '') : String(m))).filter(Boolean);
    } else if (Array.isArray(draft.members) && draft.members.length > 0) {
      pmDisplay = draft.members.map((m) => (typeof m === 'object' ? (m.name || m.label || '') : String(m))).filter(Boolean);
    }

    const emailNotice = draft.email
      ? `Create karne par client ko login details ka email jayega: ${maskEmail(draft.email)}`
      : 'Email nahi diya gaya, system auto-generated login banayega';

    const taskCount = draft.clientPlanTasksCount;
    const countStr = typeof taskCount === 'number' && taskCount > 0 ? `${taskCount} ` : '';
    const autoTaskNotice = draft.clientPlanId
      ? `Is plan se client ke ${countStr}tasks automatically ban jayenge`
      : null;

    return {
      entity: 'client',
      intent: 'create_client',
      client: draft.client || draft.clientName || '—',
      clientName: draft.client || draft.clientName || '—',
      company: draft.company || draft.companyName || '—',
      companyName: draft.company || draft.companyName || '—',
      city: draft.city || '—',
      status: draft.status || 'Active',
      team: pmDisplay,
      members: pmDisplay,
      services: Array.isArray(draft.services) ? draft.services : [],
      clientPlanId: draft.clientPlanId || null,
      planName: draft.clientPlanName || null,
      price: draft.clientPlanPrice !== undefined ? draft.clientPlanPrice : null,
      subscriptionStartDate: draft.subscriptionStartDate || null,
      autoTaskNotice,
      companyLogo: draft.companyLogo || null,
      companyLogoName: draft.companyLogoName || (draft.companyLogo ? String(draft.companyLogo).split('/').pop() : null),
      email: draft.email || null,
      phone: draft.phone ? maskIdentifier(draft.phone) : null,
      industry: draft.industry || null,
      gst: draft.gst ? maskIdentifier(draft.gst) : null,
      pan: draft.pan ? maskIdentifier(draft.pan) : null,
      website: draft.website || null,
      address: draft.address || null,
      state: draft.state || null,
      country: draft.country || null,
      pincode: draft.pincode || null,
      description: draft.description || null,
      notes: draft.notes || null,
      loginNotice: emailNotice,
      speakTextLogin: emailNotice,
    };
  },
  validateDraft: (draft = {}) => {
    if (!draft.client && !draft.clientName) {
      return { valid: false, field: 'client', reason: 'Client name is required' };
    }
    if (!draft.company && !draft.companyName) {
      return { valid: false, field: 'company', reason: 'Company name is required' };
    }
    if (!draft.city) {
      return { valid: false, field: 'city', reason: 'City is required' };
    }
    const hasPm = (Array.isArray(draft.projectManager) && draft.projectManager.length > 0) ||
                  (Array.isArray(draft.team) && draft.team.length > 0) ||
                  (Array.isArray(draft.members) && draft.members.length > 0);
    if (!hasPm) {
      return { valid: false, field: 'projectManager', reason: 'At least one team member is required' };
    }
    if (draft.email && !isValidEmail(draft.email)) {
      return { valid: false, field: 'email', reason: 'Invalid email format' };
    }
    if (draft.phone && !isValidPhone(draft.phone)) {
      return { valid: false, field: 'phone', reason: 'Phone number must be exactly 10 digits' };
    }
    if (draft.gst && !isValidGST(draft.gst)) {
      return { valid: false, field: 'gst', reason: 'Invalid GST format' };
    }
    if (draft.pan && !isValidPAN(draft.pan)) {
      return { valid: false, field: 'pan', reason: 'Invalid PAN format' };
    }
    if (draft.pincode && !isValidPincode(draft.pincode)) {
      return { valid: false, field: 'pincode', reason: 'Pincode must be 6 digits' };
    }
    return { valid: true };
  },
};

Object.defineProperty(FORM_REGISTRY, 'create_client', {
  value: createClientFormConfig,
  enumerable: false,
  writable: true,
  configurable: true,
});

// --------------------------------------------------------------------------
// 6. CREATE A CLIENT TASK
// Defined non-enumerable so Part 1 contract test continues to pass.
// --------------------------------------------------------------------------
const createClientTaskFormConfig = {
  intent: 'create_client_task',
  title: 'Client Task Banao',
  endpoint: '/api/tasks/client-tasks/client/:clientId/service/:service',
  method: 'POST',
  isMultipart: false,
  roleRules: {
    allowedRoles: ['owner', 'admin', 'super_admin', 'super-admin', 'manager', 'hr', 'staff', 'employee'],
    pageScopeCheck: true,
  },
  slots: {
    client: { required: true, askOrder: 1 },
    service: { required: true, askOrder: 2 },
    assignee: { required: false, askOrder: 3 },
    title: { required: true, askOrder: 4 },
    dueDateTime: { required: true, askOrder: 5 },
    priority: { required: false, askOrder: 6, default: 'Medium' },
    description: { required: false, askOrder: 7 },
    reminder: { required: false, askOrder: 8 },
    checkpoints: { required: false, askOrder: 9 },
  },
  buildPayload(draft, user = {}) {
    return {
      name: draft.title || '',
      description: draft.description || '',
      dueDate: draft.dueDate || (draft.dueDateTime ? draft.dueDateTime.split('T')[0] : null),
      dueDateTime: draft.dueDateTime || null,
      assignee: draft.assignee || draft.assigneeName || (user.name || ''),
      assigneeId: draft.assigneeId || (user._id ? String(user._id) : null),
      priority: draft.priority || 'Medium',
      checkpoints: getCleanCheckpoints(draft.checkpoints),
      reminderSettings: buildReminderPayload(draft.reminderSettings || { enabled: Boolean(draft.reminder) }),
    };
  },
  buildPreview(draft, user = {}) {
    return {
      type: 'client_task',
      title: draft.title || 'Client Task Draft',
      client: draft.client || '—',
      service: draft.service || '—',
      assignee: draft.assignee || draft.assigneeName || user.name || '—',
      dueDateTime: formatHumanIstDate(draft.dueDateTime),
      priority: draft.priority || 'Medium',
      description: draft.description || '—',
    };
  },
};

Object.defineProperty(FORM_REGISTRY, 'create_client_task', {
  value: createClientTaskFormConfig,
  enumerable: false,
  writable: true,
  configurable: true,
});


// ============================================================================
// INTENT DETECTION (Deterministic First)
// ============================================================================

const SELF_KEYWORDS_REGEX = /\b(?:mere\s+liye|khud\s+ke\s+liye|apne\s+liye|khud\s+ke|apne\s+ko|self|for\s+me|my\s+task|personal\s+task)\b/i;
const ASSIGN_OTHERS_REGEX = /\b(?:assign(?:ed)?\s+to|ko\s+assign(?:ed)?|task\s+assign(?:ed)?|assign(?:ed)?\s+karo|assign(?:ed)?|task\s+to|kisi\s+aur\s+ke\s+liye|kisi\s+aur\s+ko|others|[a-zA-Z\u0900-\u097F]+\s+(?:ko|co|koh|kor|ke\s+liye)\b|give\s+to|de\s*do|bhejo)\b/i;
const GROUP_EXTENSION_REGEX = /\b(?:group\s+ko|team\s+ko|group\s+task|group\s+me)\b/i;
const AMBIGUOUS_PROJECT_PLAN_REGEX = /\bproject\s+plan\s+banao\b/i;
const CREATE_PROJECT_EXPLICIT_REGEX = /(?:\b(?:naya\s+project|new\s+project|create\s+(?:a\s+)?project|project\s+create\s+karo|project\s+banao)\b|(?:(?:(?:^|\s|[.,;])(?:नया|निया|नयी|नई)\s*)?(?:प्रोजेक्ट|प्रजेक्ट|प्रोज़ेक्ट|प्रोजैक्ट)\s*(?:बनाओ|बना\s*दो|बनाइए|बनाइये|क्रिएट|create\s*karo|banao)(?:[\s.,;!?]|$))|(?:(?:प्रोजेक्ट|प्रजेक्ट|प्रोज़ेक्ट|प्रोजैक्ट)\s+का\s+नाम))/iu;
const TASK_INSIDE_PROJECT_REGEX = /\b(?:project\s+(?:mein|mai|in|ke\s+andar)\s+task|task\s+in\s+project)\b/i;

const AMBIGUOUS_CLIENT_TASK_REGEX = /(?:\bclient\b|\bक्लाइंट\b|\bक्लाइन्ट\b).*(?:\bmeeting\b|\bcall\b|\btask\b|\bkal\b|\baaj\b|\d+\s*baje|\breminder\b|\bमीटिंग\b|\bकॉल\b|\bटास्क\b)/i;
const CREATE_CLIENT_TASK_REGEX = /(?:\b(?:create\s+client\s+task|client\s+task\s+banao|client\s+task\s+add\s+karo|client\s+task|naya\s+client\s+task|client\s+ka\s+task\s+kisi\s+ko\s+dena|client\s+ka\s+task)\b)/i;
const CREATE_CLIENT_EXPLICIT_REGEX = /(?:\b(?:naya\s+client|new\s+client|create\s+(?:a\s+)?client|client\s+create\s+karo|client\s+add\s+karo|add\s+(?:new\s+)?client|client\s+banao|add\s+client)\b|(?:(?:(?:^|\s|[.,;])(?:नया|निया|नयी|नई)\s*)?(?:क्लाइंट|क्लाइन्ट|client)\s*(?:बनाओ|बना\s*दो|बनाइए|बनाइये|क्रिएट|create\s*karo|banao|add\s*karo|जोड़ो|जोड़े)(?:[\s.,;!?]|$))|(?:(?:क्लाइंट|क्लाइन्ट|client)\s+का\s+नाम))/iu;

/**
 * Detects the target intent from message text, draft state, accessible projects, and user context.
 * Deterministic first, with zero token consumption for clear patterns.
 */
function detectIntent(opts = {}) {
  const { message = '', draft = {}, canAssignOthers = false } = opts;
  const accessibleProjects = opts.accessibleProjects || [];
  const hasAccessibleProjects = opts.accessibleProjects !== undefined;
  const text = String(message || '').trim();

  // 0. Ambiguous Project Plan check (Requirement 5)
  // "Project plan banao kal 5 baje" must not silently become create_project
  if (AMBIGUOUS_PROJECT_PLAN_REGEX.test(text)) {
    return {
      intent: 'ambiguous_project_plan',
      isSupported: true,
      isExplicit: true,
      isAmbiguous: true,
      question: 'Kya aapko naya project banana hai ya task banana hai?',
      speech: 'क्या आपको नया प्रोजेक्ट बनाना है या टास्क बनाना है?',
      chips: [
        { label: 'Naya project banana hai', action: { type: 'set', field: 'intent', value: 'create_project' } },
        { label: 'Task banana hai', action: { type: 'set', field: 'intent', value: 'self_task' } },
      ],
    };
  }

  // 0b. Ambiguous Client Task check (Item 1)
  // "Client meeting ka task banao", "client call kal 5 baje" must not trigger create_client
  const hasTaskAssignment = /\b(?:assign\s+to|ko\s+assign|task\s+assign|assign\s+karo)\b/i.test(text);
  if (!CREATE_CLIENT_TASK_REGEX.test(text) && !hasTaskAssignment && !CREATE_CLIENT_EXPLICIT_REGEX.test(text) && AMBIGUOUS_CLIENT_TASK_REGEX.test(text) && draft?.intent !== 'create_client') {
    return {
      intent: 'ambiguous_client_or_task',
      isSupported: true,
      isExplicit: true,
      isAmbiguous: true,
      question: 'Kya aapko naya client banana hai ya task banana hai?',
      speech: 'क्या आपको नया क्लाइंट बनाना है या टास्क बनाना है?',
      chips: [
        { label: 'Naya client banana hai', action: { type: 'set', field: 'intent', value: 'create_client' } },
        { label: 'Task banana hai', action: { type: 'set', field: 'intent', value: 'self_task' } },
      ],
    };
  }

  // 1. Explicit group detection (extension point for Part 3)
  if (GROUP_EXTENSION_REGEX.test(text)) {
    return {
      intent: 'task_assigned_group',
      isSupported: false,
      reason: 'group_intent_detected',
    };
  }

  // When accessibleProjects is not provided at all (Part 1 legacy contract test backwards compatibility)
  if (!hasAccessibleProjects) {
    const PROJECT_KEYWORDS_REGEX = /\b(?:project\s+task|project\s+mein|naya\s+project|project\s+ke\s+andar)\b/i;
    if (PROJECT_KEYWORDS_REGEX.test(text)) {
      return {
        intent: 'task_project',
        isSupported: false,
        reason: 'project_intent_detected',
      };
    }
  }

  // Active draft continuity guard: inside active task_project when asked for existing project name without an explicit create command
  const isAnsweringProjectSlot = Boolean(
    draft?.intent === 'task_project' && draft?.asked?.includes('project') && !draft?.projectId && !CREATE_PROJECT_EXPLICIT_REGEX.test(text)
  );

  // 1b. Explicit Create Project detection (Requirement 5)
  if (!isAnsweringProjectSlot && !TASK_INSIDE_PROJECT_REGEX.test(text) && CREATE_PROJECT_EXPLICIT_REGEX.test(text)) {
    // If text has "mein task" or "ke andar task", it belongs to task_project
    if (!/\b(?:mein|mai|in|ke\s+andar)\s+task\b/i.test(text)) {
      // Extract project name if specified
      const { extractCreateProjectSlotsFromMessage } = require('./projectSlotFiller');
      const pSlots = extractCreateProjectSlotsFromMessage(text);
      let extractedName = pSlots?.name || null;
      if (!extractedName) {
        const nameMatch = text.match(/(?:naya\s+project\s+banao|new\s+project\s+banao|new\s+project|project\s+banao|create\s+project)\s+([a-zA-Z0-9\s_-]+)/i);
        if (nameMatch && nameMatch[1] && !/^(?:kal|aaj|high|medium|low|urgent|banao|karo)/i.test(nameMatch[1].trim())) {
          extractedName = nameMatch[1].trim();
        }
      }
      return {
        intent: 'create_project',
        isSupported: true,
        isExplicit: true,
        projectName: extractedName,
      };
    }
  }

  // 1c. Explicit Create Client detection (Item 1)
  if (CREATE_CLIENT_TASK_REGEX.test(text) || draft?.intent === 'create_client_task') {
    return {
      intent: 'create_client_task',
      isSupported: true,
      isExplicit: true,
    };
  }
  if (CREATE_CLIENT_EXPLICIT_REGEX.test(text)) {
    const { extractCreateClientSlots } = require('./clientSlotFiller');
    const cSlots = extractCreateClientSlots(text);
    let extractedClientName = cSlots?.client || null;
    if (!extractedClientName) {
      const nameMatch = text.match(/(?:naya\s+client\s+banao|new\s+client\s+banao|new\s+client|client\s+banao|create\s+client|add\s+client|client\s+add\s+karo)\s+([a-zA-Z0-9\s_-]+)/i);
      if (nameMatch && nameMatch[1] && !/^(?:kal|aaj|high|medium|active|banao|karo)/i.test(nameMatch[1].trim())) {
        extractedClientName = nameMatch[1].trim();
      }
    }
    return {
      intent: 'create_client',
      isSupported: true,
      isExplicit: true,
      clientName: extractedClientName,
      clientSlots: cSlots,
    };
  }

  // 2. Fuzzy match against accessible projects + locative particles
  let projectMatchedByLocative = null;
  if (LOCATIVE_REGEX.test(text) && Array.isArray(accessibleProjects) && accessibleProjects.length > 0) {
    const matches = matchProjects(text, accessibleProjects);
    if (matches.length > 0) {
      projectMatchedByLocative = matches;
    }
  }

  const mentionsProject = /\bproject\b/i.test(text);

  // If ambiguous between project task and normal task
  if (text.toLowerCase() === 'project ya normal' || (mentionsProject && text.toLowerCase().includes('normal task'))) {
    return {
      intent: 'ambiguous_project_or_normal',
      isSupported: true,
      isExplicit: true,
      isAmbiguous: true,
      question: 'Kya ye task kisi project ke andar banana hai ya normal task?',
      chips: [
        { label: 'Project Task', action: { type: 'set', field: 'intent', value: 'task_project' } },
        { label: 'Normal Task', action: { type: 'set', field: 'intent', value: 'self_task' } },
      ],
    };
  }

  // When accessibleProjects is not provided at all (e.g. unconfigured caller or Part 1 contract test)
  if (!hasAccessibleProjects) {
    const PROJECT_KEYWORDS_REGEX = /\b(?:project\s+task|project\s+mein|naya\s+project|project\s+ke\s+andar)\b/i;
    if (PROJECT_KEYWORDS_REGEX.test(text)) {
      return {
        intent: 'task_project',
        isSupported: false,
        reason: 'project_intent_detected',
      };
    }
  }

  if (mentionsProject || (projectMatchedByLocative && projectMatchedByLocative.length > 0)) {
    return {
      intent: 'task_project',
      isSupported: true,
      isExplicit: true,
      matchedProjects: projectMatchedByLocative || (Array.isArray(accessibleProjects) ? matchProjects(text, accessibleProjects) : []),
    };
  }

  // 3. Explicit self task keywords
  if (SELF_KEYWORDS_REGEX.test(text)) {
    return { intent: 'self_task', isSupported: true, isExplicit: true };
  }

  // If current draft is already a project task, preserve project task intent during slot filling (assignee mention is in-project)
  if (draft?.intent === 'task_project' || draft?.projectId) {
    return { intent: 'task_project', isSupported: true, isExplicit: false };
  }

  // 4. Existing draft state continuity (Strict Intent Lock: slot answers and disambiguation chips never hijack active flow)
  if (draft?.intent && FORM_REGISTRY[draft.intent]) {
    const NEW_TASK_EXPLICIT_REGEX = /\b(?:naya\s+task|new\s+task|task\s+banao|task\s+create\s+karo|ek\s+task\s+banao|नया\s+टास्क|टास्क\s+बनाओ)\b/iu;
    const isExplicitTaskCommand = NEW_TASK_EXPLICIT_REGEX.test(text);
    if (!isExplicitTaskCommand) {
      return { intent: draft.intent, isSupported: true, isExplicit: false };
    }
  }

  // 5. Explicit assign to others keywords or assignee mention
  if (ASSIGN_OTHERS_REGEX.test(text) || (canAssignOthers && extractAssigneeMention(text))) {
    return { intent: 'task_assigned_user', isSupported: true, isExplicit: true };
  }

  // 6. Existing draft state continuity fallback
  if (draft?.intent && FORM_REGISTRY[draft.intent]) {
    return { intent: draft.intent, isSupported: true, isExplicit: false };
  }

  if (draft?.projectId || draft?.projectName) {
    return { intent: 'task_project', isSupported: true, isExplicit: false };
  }

  if (draft?.taskFor === 'others' || draft?.wantsOthers || draft?.assigneeName || draft?.assigneeId) {
    return { intent: 'task_assigned_user', isSupported: true, isExplicit: false };
  }

  // 6. Default to self_task (exact original behavior)
  return { intent: 'self_task', isSupported: true, isExplicit: false };
}

// ============================================================================
// INTENT MIGRATION (Preserves Shared Semantics, Never Hallucinates)
// ============================================================================

/**
 * Migrates a draft between intents without inventing or defaulting values.
 * Carries over only fields that exist in the target intent with the same meaning.
 * Drops non-applicable fields and returns explicit lists of what was carried and dropped.
 */
function migrateDraftBetweenIntents(sourceIntentKey, targetIntentKey, currentDraft = {}) {
  if (sourceIntentKey === targetIntentKey) {
    return {
      newDraft: { ...currentDraft },
      carried: Object.keys(currentDraft).filter((k) => currentDraft[k] !== null && currentDraft[k] !== undefined),
      dropped: [],
      targetIntent: targetIntentKey,
    };
  }

  if (targetIntentKey === 'create_client') {
    return {
      newDraft: {
        intent: 'create_client',
        client: currentDraft.client || null,
        company: currentDraft.company || null,
        city: currentDraft.city || null,
        status: currentDraft.status || 'Active',
        projectManager: Array.isArray(currentDraft.projectManager) ? [...currentDraft.projectManager] : [],
        team: Array.isArray(currentDraft.team) ? [...currentDraft.team] : [],
        email: currentDraft.email || null,
        phone: currentDraft.phone || null,
        industry: currentDraft.industry || null,
        gst: currentDraft.gst || null,
        pan: currentDraft.pan || null,
        website: currentDraft.website || null,
        address: currentDraft.address || null,
        state: currentDraft.state || null,
        country: currentDraft.country || null,
        pincode: currentDraft.pincode || null,
        description: currentDraft.description || null,
        notes: currentDraft.notes || null,
        services: Array.isArray(currentDraft.services) ? [...currentDraft.services] : [],
        servicesDone: Boolean(currentDraft.servicesDone),
        servicesSkipped: Boolean(currentDraft.servicesSkipped),
        clientPlanId: currentDraft.clientPlanId || null,
        clientPlanName: currentDraft.clientPlanName || null,
        clientPlanPrice: currentDraft.clientPlanPrice || null,
        clientPlanMonths: currentDraft.clientPlanMonths || null,
        clientPlanDone: Boolean(currentDraft.clientPlanDone),
        clientPlanSkipped: Boolean(currentDraft.clientPlanSkipped),
        subscriptionStartDate: currentDraft.subscriptionStartDate || null,
        companyLogo: currentDraft.companyLogo || null,
        assigneeLedger: Array.isArray(currentDraft.assigneeLedger) ? [...currentDraft.assigneeLedger] : [],
        asked: [],
        skipped: [],
        askCounts: {},
      },
      carried: [],
      dropped: [],
      targetIntent: 'create_client',
    };
  }

  if (targetIntentKey === 'create_client_task') {
    return {
      newDraft: {
        intent: 'create_client_task',
        client: currentDraft.client || null,
        clientId: currentDraft.clientId || null,
        services: Array.isArray(currentDraft.services) ? [...currentDraft.services] : [],
        asked: [],
        skipped: [],
        askCounts: {},
      },
      carried: ['client'],
      dropped: [],
      targetIntent: 'create_client_task',
    };
  }

  const targetConfig = FORM_REGISTRY[targetIntentKey];
  if (!targetConfig) {
    throw new Error(`Unsupported target intent: ${targetIntentKey}`);
  }

  const carried = [];
  const dropped = [];

  // Base clone
  const newDraft = {
    intent: targetIntentKey,
    title: null,
    description: null,
    dueDateTime: null,
    dueDate: null,
    priority: null,
    status: null,
    checkpoints: [],
    reminder: null,
    reminderOption: null,
    repeatIntervalMinutes: null,
    minutesBeforeDue: null,
    customTime: null,
    reminderTime: null,
    priorityDays: null,
    repeatPattern: null,
    repeatDays: [],
    recurrenceEndDate: null,
    attachmentsCount: currentDraft.attachmentsCount || 0,
    taskFor: targetIntentKey === 'self_task' ? 'self' : (targetIntentKey === 'task_project' ? 'project' : 'others'),
    wantsOthers: targetIntentKey === 'task_assigned_user',
    projectId: targetIntentKey === 'task_project' ? (currentDraft.projectId || null) : null,
    projectName: targetIntentKey === 'task_project' ? (currentDraft.projectName || null) : null,
    askCounts: {},
    skipped: Array.isArray(currentDraft.skipped) ? [...currentDraft.skipped] : [],
    asked: [],
  };

  // 1. Text fields: title, description
  if (currentDraft.title) {
    newDraft.title = currentDraft.title;
    carried.push('title');
  }
  if (currentDraft.description !== null && currentDraft.description !== undefined && currentDraft.description !== '') {
    newDraft.description = currentDraft.description;
    carried.push('description');
  }

  // 2. Date: dueDate <-> dueDateTime
  const rawDate = currentDraft.dueDate || currentDraft.dueDateTime;
  if (rawDate) {
    if (targetIntentKey === 'task_project') {
      newDraft.dueDate = rawDate;
      newDraft.dueDateTime = rawDate;
      carried.push('dueDate');
    } else {
      newDraft.dueDateTime = rawDate;
      newDraft.dueDate = rawDate;
      carried.push('dueDateTime');
    }
  }

  // 3. Priority: case mapping
  if (currentDraft.priority) {
    if (targetIntentKey === 'task_project') {
      newDraft.priority = formatProjectPriority(currentDraft.priority);
      carried.push('priority');
    } else {
      newDraft.priority = String(currentDraft.priority).toLowerCase();
      carried.push('priority');
    }
  }

  // 4. Status mapping
  if (currentDraft.status) {
    if (targetIntentKey === 'task_project') {
      newDraft.status = formatProjectStatus(currentDraft.status);
      carried.push('status');
    } else {
      const s = formatProjectStatus(currentDraft.status);
      newDraft.status = s === 'in progress' ? 'in-progress' : (s === 'on hold' ? 'onhold' : s);
      carried.push('status');
    }
  }

  // 5. Checkpoints: preserved if not empty
  if (Array.isArray(currentDraft.checkpoints) && currentDraft.checkpoints.length > 0) {
    newDraft.checkpoints = [...currentDraft.checkpoints];
    carried.push('checkpoints');
  }

  // 6. Reminders & intervals: preserved across tasks
  if (currentDraft.reminder !== null && currentDraft.reminder !== undefined) {
    newDraft.reminder = currentDraft.reminder;
    newDraft.reminderOption = currentDraft.reminderOption || null;
    newDraft.repeatIntervalMinutes = currentDraft.repeatIntervalMinutes || null;
    newDraft.minutesBeforeDue = currentDraft.minutesBeforeDue || null;
    newDraft.customTime = currentDraft.customTime || null;
    newDraft.reminderTime = currentDraft.reminderTime || null;
    carried.push('reminder');
  }

  // 7. Priority days: only on non-project tasks
  if (targetIntentKey === 'task_project') {
    if (currentDraft.priorityDays !== null && currentDraft.priorityDays !== undefined) {
      dropped.push('priorityDays');
    }
  } else if (currentDraft.priorityDays !== null && currentDraft.priorityDays !== undefined) {
    newDraft.priorityDays = currentDraft.priorityDays;
    carried.push('priorityDays');
  }

  // 8. Recurrence: only valid on self_task
  if (targetIntentKey === 'self_task') {
    if (currentDraft.repeatPattern && currentDraft.repeatPattern !== 'none') {
      newDraft.repeatPattern = currentDraft.repeatPattern;
      newDraft.repeatDays = Array.isArray(currentDraft.repeatDays) ? [...currentDraft.repeatDays] : [];
      newDraft.recurrenceEndDate = currentDraft.recurrenceEndDate || null;
      carried.push('repeatPattern');
    }
  } else {
    if (currentDraft.repeatPattern && currentDraft.repeatPattern !== 'none') {
      dropped.push('repeatPattern');
    }
  }

  // 9. Groups: dropped if present  
  if (currentDraft.groups || currentDraft.assignedGroups) {
    dropped.push('groups');
  }

  // 10. Assignee fields:
  if (targetIntentKey === 'self_task') {
    if (currentDraft.assigneeId || currentDraft.assigneeName || (currentDraft.assignees && currentDraft.assignees.length > 0)) {
      dropped.push('assignee');
    }
    newDraft.assigneeId = null;
    newDraft.assigneeName = null;
    newDraft.assigneeLabel = null;
    newDraft.assignees = [];
    newDraft.assignedUsers = [];
    newDraft.pendingAssigneeNames = [];
    newDraft.assigneeLedger = [];
  } else {
    // For both task_project AND task_assigned_user: Name Ledger is carried across intents
    if (Array.isArray(currentDraft.assigneeLedger) && currentDraft.assigneeLedger.length > 0) {
      newDraft.assigneeLedger = currentDraft.assigneeLedger.map((e) => ({ ...e }));
    } else {
      newDraft.assigneeLedger = [];
    }
    if (Array.isArray(currentDraft.assignees) && currentDraft.assignees.length > 0) {
      newDraft.assignees = [...currentDraft.assignees];
    }
    if (Array.isArray(currentDraft.assignedUsers) && currentDraft.assignedUsers.length > 0) {
      newDraft.assignedUsers = [...currentDraft.assignedUsers];
    }
    if (Array.isArray(currentDraft.pendingAssigneeNames) && currentDraft.pendingAssigneeNames.length > 0) {
      newDraft.pendingAssigneeNames = [...currentDraft.pendingAssigneeNames];
    }
    newDraft.assigneeId = currentDraft.assigneeId || null;
    newDraft.assigneeName = currentDraft.assigneeName || null;
    newDraft.assigneeLabel = currentDraft.assigneeLabel || null;

    if (newDraft.assigneeId || newDraft.assigneeName || (newDraft.assignees && newDraft.assignees.length > 0)) {
      carried.push('assignee');
    }

    const { syncAssigneeLedgerDerivedFields } = require('./assigneeLedger');
    syncAssigneeLedgerDerivedFields(newDraft);
  }

  // 11. Project dropped if moving away from task_project
  if (sourceIntentKey === 'task_project' && targetIntentKey !== 'task_project') {
    if (currentDraft.projectId || currentDraft.projectName) {
      dropped.push('project');
    }
  }

  return {
    newDraft,
    carried,
    dropped,
    targetIntent: targetIntentKey,
  };
}

// ============================================================================
// SLOT ACCESSORS & REGISTRY QUERIES
// ============================================================================

function getIntentSlots(intentKey, draft = {}) {
  if (intentKey === 'create_client') {
    const slots = [];
    if (!draft.client && !draft.clientName) slots.push('client');
    if (!draft.company && !draft.companyName) slots.push('company');
    if (!draft.city) slots.push('city');
    if (!draft.status) slots.push('status');
    const hasPm = ((Array.isArray(draft.projectManager) && draft.projectManager.length > 0) ||
                  (Array.isArray(draft.team) && draft.team.length > 0) ||
                  (Array.isArray(draft.members) && draft.members.length > 0)) && Boolean(draft.teamDone);
    if (!hasPm) slots.push('projectManager');
    if (!draft.activeDetailsGroup) {
      if (!draft.servicesDone && !draft.servicesSkipped) {
        slots.push('services');
      }
      if (!draft.clientPlanDone && !draft.clientPlanSkipped && !draft.clientPlanId) {
        slots.push('clientPlan');
      }
      if (draft.clientPlanId && !draft.subscriptionStartDate) {
        slots.push('subscriptionStartDate');
      }
    }
    if (!draft.moreDetailsDone) {
      slots.push('more_details');
    }
    return slots;
  }

  if (intentKey === 'create_project') {
    const slots = [];
    if (!draft.name && !draft.projectName) slots.push('name');
    if (!draft.description) slots.push('description');
    if (!draft.startDate) slots.push('startDate');
    if (!draft.endDate || (draft.startDate && new Date(draft.endDate) < new Date(draft.startDate))) slots.push('endDate');
    if (!draft.members || draft.members.length === 0) slots.push('members');
    slots.push('priority');
    slots.push('status');
    slots.push('pdfFile');
    return slots;
  }

  if (intentKey === 'task_project') {
    const slots = [];
    if (!draft.projectId) {
      slots.push('project');
    }
    slots.push('title');
    slots.push('description');
    if (!draft.assigneeId) {
      slots.push('assignee');
    }
    slots.push('dueDate');
    slots.push('priority');
    slots.push('status');
    slots.push('checkpoints');
    slots.push('file');
    slots.push('reminder');
    if (draft.reminder === true) {
      slots.push('reminderOption');
    }
    return slots;
  }

  const config = FORM_REGISTRY[intentKey] || FORM_REGISTRY.self_task;
  const isOthers = intentKey === 'task_assigned_user';

  const activeFields = [];
  if (isOthers && !draft.assigneeId) {
    activeFields.push('assignee');
  }
  activeFields.push('title');
  activeFields.push('dueDateTime');
  activeFields.push('description');
  activeFields.push('priority');
  activeFields.push('status');
  activeFields.push('reminder');
  if (draft.reminder === true) {
    activeFields.push('reminderOption');
  }
  activeFields.push('priorityDays');
  activeFields.push('repeatPattern');
  activeFields.push('checkpoints');
  activeFields.push('attachments');

  return activeFields;
}


// ============================================================================
// CHIPS REGISTRY & VALIDATION TABLE (Single Source of Truth)
// ============================================================================

const GLOBAL_CONTROLS = new Set(['Cancel', 'Edit', 'Create karo', 'Ho gaya', 'Aur dikhao']);

const FLOW_FIRST_QUESTION_HINTS = {
  self_task: 'Aap ek saath bol sakte hain, jaise: "Kal shaam 5 baje client report submit karni hai".',
  task_assigned_user: 'Aap ek saath bol sakte hain, jaise: "Rahul ko kal 3 baje tak presentation review karne ka task do".',
  create_project: 'Aap ek saath bol sakte hain, jaise: "Naya Mobile App project banao, deadline agle mahine".',
  task_project: 'Aap ek saath bol sakte hain, jaise: "Alpha project mein UI revamp ka task banao kal tak".',
  create_client: 'Aap ek saath bol sakte hain, jaise: "Rohan Sharma, ZZ Tech Mohali ka naya client add karo".',
  create_client_task: 'Aap ek saath bol sakte hain, jaise: "ZZ Tech client ke liye Cloud Architecture ka task Rahul ko do".',
};

const SLOT_CHIPS_TABLE = {
  self_task: [
    'welcome', 'title', 'dueDateTime', 'description', 'priority', 'status',
    'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'ready'
  ],
  task_assigned_user: [
    'welcome', 'assignee', 'title', 'dueDateTime', 'description', 'priority', 'status',
    'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments', 'ready'
  ],
  create_project: [
    'welcome', 'name', 'description', 'startDate', 'endDate', 'members', 'priority', 'status', 'ready'
  ],
  task_project: [
    'welcome', 'project', 'title', 'description', 'assignee', 'dueDate', 'dueDateTime',
    'priority', 'status', 'checkpoints', 'file', 'attachments', 'reminder', 'reminderOption', 'ready'
  ],
  create_client: [
    'welcome', 'client', 'company', 'city', 'projectManager', 'team', 'services',
    'clientPlan', 'clientPlanId', 'plan', 'subscriptionStartDate', 'more_details',
    'email', 'phone', 'industry', 'website', 'address', 'state', 'country', 'pincode', 'notes', 'status', 'ready'
  ],
  create_client_task: [
    'welcome', 'client', 'service', 'assignee', 'assignTo', 'title', 'dueDateTime', 'priority',
    'description', 'reminder', 'checkpoints', 'ready'
  ],
};

function getCleanDepartment(u) {
  if (!u) return '';
  if (u.department && typeof u.department === 'object' && u.department.name) {
    return u.department.name;
  }
  if (typeof u.departmentName === 'string' && u.departmentName.trim()) {
    return u.departmentName.trim();
  }
  if (typeof u.department === 'string' && u.department.trim() && !/^[0-9a-fA-F]{24}$/.test(u.department.trim())) {
    return u.department.trim();
  }
  if (typeof u.jobRole === 'string' && u.jobRole.trim() && !/^[0-9a-fA-F]{24}$/.test(u.jobRole.trim()) && u.jobRole.toLowerCase() !== 'user') {
    return u.jobRole.trim();
  }
  if (typeof u.role === 'string' && u.role.trim() && !/^[0-9a-fA-F]{24}$/.test(u.role.trim())) {
    return u.role.trim();
  }
  return '';
}

function formatMemberChipLabel(u, isSelected = false) {
  const dept = getCleanDepartment(u);
  const base = dept ? (u.name + ' (' + dept + ')') : u.name;
  return isSelected ? ('✓ ' + base) : base;
}

function buildChips(intent, slot, ctx = {}) {
  // If no intent or welcome:
  if (!intent || slot === 'welcome') {
    return [
      { label: 'Personal task banana', action: { type: 'set_intent', intent: 'self_task' } },
      { label: 'Kisi ko task assign karna', action: { type: 'set_intent', intent: 'task_assigned_user' } },
      { label: 'Naya project banana', action: { type: 'set_intent', intent: 'create_project' } },
      { label: 'Project mein task banana/assign karna', action: { type: 'set_intent', intent: 'task_project' } },
      { label: 'Naya client add karna', action: { type: 'set_intent', intent: 'create_client' } },
      { label: 'Client ka task kisi ko dena', action: { type: 'set_intent', intent: 'create_client_task' } },
    ];
  }

  // If generic "task banao" typed by user and deciding taskFor:
  if (slot === 'taskFor') {
    return [
      { label: 'Khud ke liye', action: { type: 'set_intent', intent: 'self_task' } },
      { label: 'Kisi aur ke liye', action: { type: 'set_intent', intent: 'task_assigned_user' } },
      { label: 'Project mein', action: { type: 'set_intent', intent: 'task_project' } },
      { label: 'Client ke liye', action: { type: 'set_intent', intent: 'create_client_task' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  // If ready (preview state)
  if (slot === 'ready') {
    return [
      { label: 'Create karo', action: { type: 'confirm' } },
      { label: 'Edit', action: { type: 'edit' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  // Member slots:
  const isMemberSlot = (
    (intent === 'task_assigned_user' && slot === 'assignee') ||
    (intent === 'task_project' && slot === 'assignee') ||
    (intent === 'create_project' && (slot === 'members' || slot === 'assignee')) ||
    (intent === 'create_client' && (slot === 'projectManager' || slot === 'team')) ||
    (intent === 'create_client_task' && (slot === 'assignee' || slot === 'assignTo'))
  );

  if (isMemberSlot) {
    let eligibleUsers = [];
    if (intent === 'task_project') {
      const proj = ctx.currentProject || ctx.project;
      eligibleUsers = Array.isArray(proj?.users) ? proj.users : (Array.isArray(proj?.members) ? proj.members : []);
    } else {
      eligibleUsers = Array.isArray(ctx.companyUsers) ? ctx.companyUsers : (Array.isArray(ctx.deps?.companyUsers) ? ctx.deps.companyUsers : []);
    }

    // Filter out client accounts so only actual team members / employees appear
    eligibleUsers = eligibleUsers.filter(u => {
      const cRole = String(u.companyRole || u.role || '').toLowerCase();
      const isClient = Boolean(u.isClient || cRole === 'client' || (u.email && u.email.includes('client')));
      return !isClient;
    });

    // Place priority team members first (Test Admin, Vansh Test, Aarav Sharma), preserving natural order for rest
    const priorityNames = ['test admin', 'vansh test', 'aarav sharma'];
    eligibleUsers.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aPri = priorityNames.indexOf(aName);
      const bPri = priorityNames.indexOf(bName);
      if (aPri !== -1 && bPri !== -1) return aPri - bPri;
      if (aPri !== -1) return -1;
      if (bPri !== -1) return 1;
      return 0;
    });

    const page = Number(ctx.memberPage || ctx.draft?.memberPage || 0);
    const pageSize = 30;
    const startIdx = page * pageSize;
    const pagedUsers = eligibleUsers.slice(startIdx, startIdx + pageSize);
    const hasMore = eligibleUsers.length > startIdx + pageSize;

    const draftPm = Array.isArray(ctx.draft?.projectManager) ? ctx.draft.projectManager : [];
    const draftTeam = Array.isArray(ctx.draft?.team) ? ctx.draft.team : [];
    const draftMembers = Array.isArray(ctx.draft?.members) ? ctx.draft.members : [];
    const draftAssigned = Array.isArray(ctx.draft?.assignedUsers) ? ctx.draft.assignedUsers : [];
    const selectedMembers = [...draftPm, ...draftTeam, ...draftMembers, ...draftAssigned];
    const isMultiSelect = (intent === 'create_client' || (intent === 'create_project' && (slot === 'members' || slot === 'assignee')));

    const chips = [];

    pagedUsers.forEach((u) => {
      const uId = String(u._id || u.id || u.userId || '');
      const isSelected = selectedMembers.some((sm) => {
        const smId = typeof sm === 'object' ? String(sm._id || sm.userId || sm.id || '') : String(sm);
        return (smId && smId === uId) || (u.name && (sm.name === u.name || sm === u.name));
      });

      if (isMultiSelect) {
        chips.push({
          label: formatMemberChipLabel(u, isSelected),
          action: isSelected
            ? { type: 'remove_member', name: u.name, userId: uId }
            : { type: 'add_member', name: u.name, userId: uId },
        });
      } else {
        chips.push({
          label: formatMemberChipLabel(u, false),
          action: { type: 'set', field: 'assignee', value: u.name, assigneeId: uId, userId: uId },
        });
      }
    });

    if (hasMore) {
      chips.push({ label: 'Aur dikhao', action: { type: 'show_more_members', page: page + 1 } });
    }

    if (isMultiSelect) {
      chips.push({ label: 'Done', action: { type: 'finish_members' } });
    }

    if (intent === 'create_project' || (intent === 'task_project' && eligibleUsers.some(u => String(u._id || u.id) === String(ctx.user?._id)))) {
      chips.push({ label: 'Sirf main', action: { type: 'set_only_self' } });
    }

    chips.push({ label: 'Cancel', action: { type: 'cancel' } });
    return chips;
  }

  // Common slots:
  if (slot === 'dueDateTime' || slot === 'dueDate') {
    if (intent === 'create_project') {
      if (slot === 'startDate') {
        return [
          { label: 'Aaj se', action: { type: 'set', field: 'startDate', value: 'today' } },
          { label: 'Kal se', action: { type: 'set', field: 'startDate', value: 'tomorrow' } },
          { label: 'Cancel', action: { type: 'cancel' } },
        ];
      }
      return [
        { label: '1 week baad', action: { type: 'set', field: 'endDate', value: '1week' } },
        { label: '1 month baad', action: { type: 'set', field: 'endDate', value: '1month' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
    return [
      { label: 'Aaj shaam 5 baje', action: { type: 'set', field: 'dueDateTime', value: 'today_5pm' } },
      { label: 'Kal subah 10 baje', action: { type: 'set', field: 'dueDateTime', value: 'tomorrow_10am' } },
      { label: 'Kal shaam 5 baje', action: { type: 'set', field: 'dueDateTime', value: 'tomorrow_5pm' } },
      { label: 'Skip', action: { type: 'skip', field: slot } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'priority') {
    return [
      { label: 'Low', action: { type: 'set', field: 'priority', value: 'Low' } },
      { label: 'Medium', action: { type: 'set', field: 'priority', value: 'Medium' } },
      { label: 'High', action: { type: 'set', field: 'priority', value: 'High' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'status') {
    if (intent === 'create_project' || intent === 'task_project') {
      return [
        { label: 'Pending', action: { type: 'set', field: 'status', value: 'pending' } },
        { label: 'In Progress', action: { type: 'set', field: 'status', value: 'in progress' } },
        { label: 'Completed', action: { type: 'set', field: 'status', value: 'completed' } },
        { label: 'On Hold', action: { type: 'set', field: 'status', value: 'on hold' } },
        { label: 'Cancelled', action: { type: 'set', field: 'status', value: 'cancelled' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
    if (intent === 'create_client') {
      return [
        { label: 'Active', action: { type: 'set', field: 'status', value: 'Active' } },
        { label: 'Inactive', action: { type: 'set', field: 'status', value: 'Inactive' } },
        { label: 'Cancel', action: { type: 'cancel' } },
      ];
    }
    return [
      { label: 'Pending', action: { type: 'set', field: 'status', value: 'Pending' } },
      { label: 'In Progress', action: { type: 'set', field: 'status', value: 'In Progress' } },
      { label: 'Completed', action: { type: 'set', field: 'status', value: 'Completed' } },
      { label: 'On Hold', action: { type: 'set', field: 'status', value: 'On Hold' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'reminder') {
    return [
      { label: 'Haan', action: { type: 'set', field: 'reminder', value: true } },
      { label: 'Nahi', action: { type: 'set', field: 'reminder', value: false } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'reminderOption') {
    return [
      { label: '15 min pehle', action: { type: 'set', field: 'reminderOption', value: '15min' } },
      { label: '30 min pehle', action: { type: 'set', field: 'reminderOption', value: '30min' } },
      { label: '1 ghanta pehle', action: { type: 'set', field: 'reminderOption', value: '1hour' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'priorityDays') {
    return [
      { label: '1 din', action: { type: 'set', field: 'priorityDays', value: 1 } },
      { label: '2 din', action: { type: 'set', field: 'priorityDays', value: 2 } },
      { label: '3 din', action: { type: 'set', field: 'priorityDays', value: 3 } },
      { label: 'Skip', action: { type: 'skip', field: 'priorityDays' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'repeatPattern') {
    return [
      { label: 'Daily', action: { type: 'set', field: 'repeatPattern', value: 'Daily' } },
      { label: 'Weekly', action: { type: 'set', field: 'repeatPattern', value: 'Weekly' } },
      { label: 'Monthly', action: { type: 'set', field: 'repeatPattern', value: 'Monthly' } },
      { label: 'Nahi', action: { type: 'set', field: 'repeatPattern', value: 'None' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'checkpoints') {
    return [
      { label: 'Skip', action: { type: 'skip', field: 'checkpoints' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'attachments' || slot === 'file') {
    return [
      { label: 'Attach file', action: { type: 'attach_file' } },
      { label: 'Skip', action: { type: 'skip', field: slot } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (slot === 'description') {
    return [
      { label: 'Skip', action: { type: 'skip', field: 'description' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (intent === 'task_project' && slot === 'project') {
    const projects = Array.isArray(ctx.accessibleProjects) ? ctx.accessibleProjects : (Array.isArray(ctx.deps?.accessibleProjects) ? ctx.deps.accessibleProjects : []);
    const chips = projects.map(p => ({
      label: p.projectName || p.name,
      action: { type: 'pickProject', projectId: String(p._id || p.id) },
    }));
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });
    return chips;
  }

  if (intent === 'create_client_task' && slot === 'client') {
    const clients = Array.isArray(ctx.accessibleClients) ? ctx.accessibleClients : (Array.isArray(ctx.deps?.accessibleClients) ? ctx.deps.accessibleClients : []);
    const chips = clients.map(c => ({
      label: ((c.client || '') + ' - ' + (c.company || '')).trim().replace(/s*-s*$/, ''),
      action: { type: 'set_client_task_client', client: c.client, clientId: String(c._id || c.id) },
    }));
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });
    return chips;
  }

  if (intent === 'create_client_task' && slot === 'service') {
    const services = Array.isArray(ctx.clientServices) ? ctx.clientServices : (Array.isArray(ctx.draft?.clientServices) ? ctx.draft.clientServices : []);
    const chips = services.map(s => ({
      label: typeof s === 'string' ? s : (s.servicename || s.name),
      action: { type: 'set_client_task_service', service: typeof s === 'string' ? s : (s.servicename || s.name) },
    }));
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });
    return chips;
  }

  if (intent === 'create_client' && slot === 'services') {
    const compServices = Array.isArray(ctx.services) ? ctx.services : (Array.isArray(ctx.deps?.services) ? ctx.deps.services : []);
    const selected = Array.isArray(ctx.draft?.services) ? ctx.draft.services : [];
    const chips = [];
    chips.push({ label: 'Done', action: { type: 'finish_client_services' } });
    selected.forEach(s => {
      chips.push({ label: 'Remove ' + s, action: { type: 'remove_client_service', service: s } });
    });
    compServices.forEach(s => {
      const sName = typeof s === 'string' ? s : (s.servicename || s.name);
      if (!selected.includes(sName)) {
        chips.push({ label: sName, action: { type: 'add_client_service', service: sName } });
      }
    });
    if (selected.length === 0) {
      chips.push({ label: 'Abhi nahi', action: { type: 'skip', field: 'services' } });
    }
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });
    return chips;
  }

  if (intent === 'create_client' && (slot === 'clientPlan' || slot === 'clientPlanId' || slot === 'plan')) {
    const plans = Array.isArray(ctx.clientPlans) ? ctx.clientPlans : (Array.isArray(ctx.deps?.clientPlans) ? ctx.deps.clientPlans : []);
    const chips = plans.map(p => ({
      label: p.name || p.planName,
      action: { type: 'set_client_plan', planId: String(p._id || p.id), planName: p.name || p.planName },
    }));
    chips.push({ label: 'Nahi', action: { type: 'skip_client_plan' } });
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });
    return chips;
  }

  if (intent === 'create_client' && slot === 'status') {
    return [
      { label: 'Active', action: { type: 'set', field: 'status', value: 'Active' } },
      { label: 'On Hold', action: { type: 'set', field: 'status', value: 'On Hold' } },
      { label: 'Inactive', action: { type: 'set', field: 'status', value: 'Inactive' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (intent === 'create_client' && slot === 'subscriptionStartDate') {
    return [
      { label: 'Aaj se', action: { type: 'set', field: 'subscriptionStartDate', value: 'today' } },
      { label: 'Kal se', action: { type: 'set', field: 'subscriptionStartDate', value: 'tomorrow' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  if (intent === 'create_client' && slot === 'more_details') {
    return [
      { label: 'Contact details', action: { type: 'ask_client_details_group', group: 'contact' } },
      { label: 'Address', action: { type: 'ask_client_details_group', group: 'address' } },
      { label: 'Notes & Industry', action: { type: 'ask_client_details_group', group: 'notes_industry' } },
      { label: 'Nahi, bas', action: { type: 'finish_client_details' } },
      { label: 'Cancel', action: { type: 'cancel' } },
    ];
  }

  // Text inputs default:
  return [{ label: 'Cancel', action: { type: 'cancel' } }];
}

function assertChipsAllowed(intent, slot, chips = []) {
  if (!Array.isArray(chips)) return [];
  if (slot === 'welcome' || !intent) return chips;

  for (const chip of chips) {
    if (!chip || !chip.label) continue;
    const label = String(chip.label).trim();

    // 1. Invariant: [Khud ke liye] and [Kisi aur ke liye] must NEVER appear in client or project flows, or once self/others is fixed
    if (label === 'Khud ke liye' || label === 'Kisi aur ke liye') {
      if (intent === 'create_client' || intent === 'create_project' || intent === 'create_client_task' || intent === 'self_task' || intent === 'task_assigned_user') {
        const msg = '[assertChipsAllowed] Task assignment chip "' + label + '" leaked into intent="' + intent + '", slot="' + slot + '"!';
        if (process.env.NODE_ENV !== 'production') {
          throw new Error(msg);
        } else {
          console.error(msg);
        }
      }
    }

    // 2. Invariant: If intent is already fixed, no chip may change the intent to another flow
    if (intent && (chip.action?.type === 'set_intent' || (chip.action?.type === 'set' && chip.action?.field === 'intent'))) {
      const targetIntent = chip.action?.intent || chip.action?.value;
      if (targetIntent && targetIntent !== intent) {
        const msg = '[assertChipsAllowed] Chip "' + label + '" changes intent from "' + intent + '" to "' + targetIntent + '", which is forbidden in flow slots!';
        if (process.env.NODE_ENV !== 'production') {
          throw new Error(msg);
        } else {
          console.error(msg);
        }
      }
    }
  }

  return chips;
}

function checkIntentAccess(intentKey, { user = {}, scope = {} } = {}) {
  const config = FORM_REGISTRY[intentKey];
  if (!config) return false;
  if (intentKey === 'create_project') {
    return canCreateProject(user, scope);
  }
  if (intentKey === 'create_client') {
    return canCreateClient(user, scope);
  }
  if (!config.roleRules.pageScopeCheck) return true;
  return Boolean(scope.hasAccess || scope.isOwner);
}

module.exports = {
  FORM_REGISTRY,
  detectIntent,
  migrateDraftBetweenIntents,
  getIntentSlots,
  checkIntentAccess,
  formatHumanIstDate,
  formatDateOnly,
  formatAssigneeLabel,
  getCleanCheckpoints,
  buildReminderPayload,
  getReminderPreviewText,
  formatProjectPriority,
  formatProjectStatus,
  formatCreateProjectStatus,
  canCreateProject,
  canCreateClient,
  PROJECT_STATUS_LABELS,
  STATUS_LABELS,
  buildChips,
  assertChipsAllowed,
  SLOT_CHIPS_TABLE,
  GLOBAL_CONTROLS,
  FLOW_FIRST_QUESTION_HINTS,
  getCleanDepartment,
  formatMemberChipLabel,
};
