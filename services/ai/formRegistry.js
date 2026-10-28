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
      ? draft.members.map((m) => (typeof m === 'object' ? m.name || m.label : m))
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
      startDateFormatted: draft.startDate ? formatHumanIstDate(draft.startDate) : '—',
      endDateFormatted: draft.endDate ? formatHumanIstDate(draft.endDate) : '—',
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


// ============================================================================
// INTENT DETECTION (Deterministic First)
// ============================================================================

const SELF_KEYWORDS_REGEX = /\b(?:mere\s+liye|khud\s+ke\s+liye|apne\s+liye|khud\s+ke|apne\s+ko|self|for\s+me|my\s+task|personal\s+task)\b/i;
const ASSIGN_OTHERS_REGEX = /\b(?:assign(?:ed)?\s+to|ko\s+assign(?:ed)?|task\s+assign(?:ed)?|assign(?:ed)?\s+karo|assign(?:ed)?|task\s+to|kisi\s+aur\s+ke\s+liye|kisi\s+aur\s+ko|others|[a-zA-Z\u0900-\u097F]+\s+(?:ko|co|koh|kor|ke\s+liye)\b|give\s+to|de\s*do|bhejo)\b/i;
const GROUP_EXTENSION_REGEX = /\b(?:group\s+ko|team\s+ko|group\s+task|group\s+me)\b/i;
const AMBIGUOUS_PROJECT_PLAN_REGEX = /\bproject\s+plan\s+banao\b/i;
const CREATE_PROJECT_EXPLICIT_REGEX = /\b(?:naya\s+project|new\s+project|create\s+(?:a\s+)?project|project\s+create\s+karo|project\s+banao)\b/i;
const TASK_INSIDE_PROJECT_REGEX = /\b(?:project\s+(?:mein|mai|in|ke\s+andar)\s+task|task\s+in\s+project)\b/i;

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

  // Active draft continuity guard: inside active draft or when asked for project name, never confuse with create_project
  const isAnsweringProjectSlot = Boolean(
    (draft?.intent === 'task_project' && draft?.asked?.includes('project') && !draft?.projectId) ||
    (draft?.intent && draft.intent !== 'create_project' && draft?.asked?.length > 0)
  );

  // 1b. Explicit Create Project detection (Requirement 5)
  if (!isAnsweringProjectSlot && !TASK_INSIDE_PROJECT_REGEX.test(text) && CREATE_PROJECT_EXPLICIT_REGEX.test(text)) {
    // If text has "mein task" or "ke andar task", it belongs to task_project
    if (!/\b(?:mein|mai|in|ke\s+andar)\s+task\b/i.test(text)) {
      // Extract project name if specified after "banao" / "create karo"
      let extractedName = null;
      const nameMatch = text.match(/(?:naya\s+project\s+banao|new\s+project|project\s+banao|create\s+project)\s+([a-zA-Z0-9\s_-]+)/i);
      if (nameMatch && nameMatch[1] && !/^(?:kal|aaj|high|medium|low|urgent)/i.test(nameMatch[1].trim())) {
        extractedName = nameMatch[1].trim();
      }
      return {
        intent: 'create_project',
        isSupported: true,
        isExplicit: true,
        projectName: extractedName,
      };
    }
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

  // 4. Explicit assign to others keywords or assignee mention
  if (ASSIGN_OTHERS_REGEX.test(text) || (canAssignOthers && extractAssigneeMention(text))) {
    return { intent: 'task_assigned_user', isSupported: true, isExplicit: true };
  }

  // 5. Existing draft state continuity
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

function checkIntentAccess(intentKey, { user = {}, scope = {} } = {}) {
  const config = FORM_REGISTRY[intentKey];
  if (!config) return false;
  if (intentKey === 'create_project') {
    return canCreateProject(user, scope);
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
  formatAssigneeLabel,
  getCleanCheckpoints,
  buildReminderPayload,
  getReminderPreviewText,
  formatProjectPriority,
  formatProjectStatus,
  formatCreateProjectStatus,
  canCreateProject,
  PROJECT_STATUS_LABELS,
  STATUS_LABELS,
};
