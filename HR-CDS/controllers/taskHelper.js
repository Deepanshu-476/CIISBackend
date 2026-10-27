
const Task = require('../models/Task');
const ClientTask = require('../models/ClientTask');
const Client = require('../models/Client');
const { Project } = require('../models/Project');
const User = require('../../models/User');
const Group = require('../models/Group');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const mongoose = require('mongoose');
const moment = require('moment');
const { sendEmail } = require('../../utils/sendEmail');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { notifyDirectUsers, notifyPageUsers } = require('../utils/systemNotificationService');
const {
  normalizeTaskRecurrenceFields,
} = require('../utils/taskRecurrence');

const TASK_USER_POPULATE_FIELDS = 'name email role jobRole companyRole profileImage avatar department branch assignedBranches';
const TASK_GROUP_POPULATE_FIELDS = 'name members description';
const TASK_CREATOR_POPULATE_FIELDS = 'name email role jobRole companyRole profileImage avatar department branch';

const parsePositiveInt = (value, fallback, max = 100) => {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const getCleanTaskDateRange = ({ period = 'all', fromDate, toDate }) => {
  if (fromDate || toDate) {
    const range = {};
    if (fromDate) {
      const start = new Date(fromDate);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        range.$gte = start;
      }
    }
    if (toDate) {
      const end = new Date(toDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
      }
    }
    return Object.keys(range).length ? range : null;
  }

  if (period === 'all') return null;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today':
      return { $gte: startOfDay, $lte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999) };
    case 'yesterday': {
      const start = new Date(startOfDay);
      start.setDate(start.getDate() - 1);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { $gte: start, $lte: end };
    }
    case 'this-week':
    case 'week': {
      const start = new Date(startOfDay);
      start.setDate(startOfDay.getDate() - startOfDay.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { $gte: start, $lte: end };
    }
    case 'last-week': {
      const start = new Date(startOfDay);
      start.setDate(startOfDay.getDate() - startOfDay.getDay() - 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { $gte: start, $lte: end };
    }
    case 'this-month':
    case 'month':
      return {
        $gte: new Date(now.getFullYear(), now.getMonth(), 1),
        $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      };
    case 'last-month':
      return {
        $gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        $lte: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      };
    case '7days': {
      const start = new Date(startOfDay);
      start.setDate(start.getDate() - 7);
      return { $gte: start, $lte: now };
    }
    case '30days': {
      const start = new Date(startOfDay);
      start.setDate(start.getDate() - 30);
      return { $gte: start, $lte: now };
    }
    case '90days': {
      const start = new Date(startOfDay);
      start.setDate(start.getDate() - 90);
      return { $gte: start, $lte: now };
    }
    default:
      return null;
  }
};

const normalizeTaskStatus = status => {
  if (!status) return 'pending';
  const val = String(status).toLowerCase().trim();
  const map = {
    'in progress': 'in-progress',
    inprogress: 'in-progress',
    'in-progress': 'in-progress',
    'on hold': 'onhold',
    onhold: 'onhold',
    're open': 'reopen',
    're-open': 'reopen',
    cancelled: 'cancelled',
    canceled: 'cancelled'
  };
  return map[val] || val;
};

const getTaskOverdueEligibilityDate = (dueDateTime, task) => {
  if (task?.onHoldReleasedAt) {
    const releasedAt = new Date(task.onHoldReleasedAt);
    if (!isNaN(releasedAt.getTime())) {
      return new Date(releasedAt.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  if (!dueDateTime) return null;
  const dueDate = new Date(dueDateTime);
  if (isNaN(dueDate.getTime())) return null;

  return dueDate;
};

const isTaskOverdueForStatus = (dueDateTime, status, task = null) => {
  if (!dueDateTime) return false;
  const normalizedStatus = normalizeTaskStatus(status);
  if (normalizedStatus === 'overdue') return true;
  if (['onhold', 'completed', 'approved', 'rejected', 'cancelled'].includes(normalizedStatus)) return false;
  const dueDate = getTaskOverdueEligibilityDate(dueDateTime, task);
  if (!dueDate) return false;
  return dueDate < new Date();
};

const isOnHoldStatus = status => normalizeTaskStatus(status) === 'onhold';

const canChangeFromOnHold = nextStatus => {
  return ['in-progress', 'completed'].includes(normalizeTaskStatus(nextStatus));
};

const parseTaskCheckpoints = value => {
  if (!value || value === 'null') return [];
  let raw = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map(item => {
      const title = typeof item === 'string' ? item : item?.title;
      const cleanTitle = String(title || '').trim();
      if (!cleanTitle) return null;

      const completed = Boolean(typeof item === 'object' ? item.completed : false);
      return {
        title: cleanTitle,
        completed,
        completedAt: completed ? (item?.completedAt ? new Date(item.completedAt) : new Date()) : null,
        completedBy: item?.completedBy || null
      };
    })
    .filter(Boolean);
};

const calculateUnifiedTaskStats = (tasks, userId) => {
  const counts = {
    pending: 0,
    'in-progress': 0,
    completed: 0,
    approved: 0,
    rejected: 0,
    onhold: 0,
    reopen: 0,
    cancelled: 0,
    overdue: 0
  };
  const priorities = { high: { count: 0, completed: 0 }, medium: { count: 0, completed: 0 }, low: { count: 0, completed: 0 } };

  tasks.forEach(task => {
    let status = 'pending';
    if (userId) {
      const userStatusEntry = task.statusByUser?.find(s =>
        (s.user?._id || s.user)?.toString() === userId.toString()
      );
      status = userStatusEntry?.status || task.status || task.overallStatus || 'pending';
    } else {
      status = task.status || task.overallStatus || 'pending';
    }

    status = normalizeTaskStatus(status);

    if (isTaskOverdueForStatus(task.dueDateTime || task.dueDate, status, task)) {
      status = 'overdue';
    }

    const priority = String(task.priority || '').toLowerCase();
    if (priorities[priority]) {
      priorities[priority].count++;
      if (status === 'completed' || status === 'approved') priorities[priority].completed++;
    }

    if (counts[status] !== undefined) {
      counts[status]++;
    } else {
      counts.pending++;
    }
  });

  const total = tasks.length;
  const pct = count => total > 0 ? Math.round((count / total) * 100) : 0;
  const priorityStat = ({ count, completed }) => ({ count, completed, percentage: count > 0 ? Math.round((completed / count) * 100) : 0 });

  return {
    total,
    highPriority: priorityStat(priorities.high),
    mediumPriority: priorityStat(priorities.medium),
    lowPriority: priorityStat(priorities.low),
    pending: { count: counts.pending, percentage: pct(counts.pending) },
    inProgress: { count: counts['in-progress'], percentage: pct(counts['in-progress']) },
    completed: { count: counts.completed, percentage: pct(counts.completed) },
    approved: { count: counts.approved, percentage: pct(counts.approved) },
    rejected: { count: counts.rejected, percentage: pct(counts.rejected) },
    onHold: { count: counts.onhold, percentage: pct(counts.onhold) },
    reopen: { count: counts.reopen, percentage: pct(counts.reopen) },
    cancelled: { count: counts.cancelled, percentage: pct(counts.cancelled) },
    overdue: { count: counts.overdue, percentage: pct(counts.overdue) }
  };
};

const getTaskCompletionDate = task => {
  const directDate = task?.completionDate || task?.completedAt;
  if (directDate) return directDate;

  const statusHistory = Array.isArray(task?.statusHistory) ? task.statusHistory : [];
  const compHistory = statusHistory
    .filter(entry => normalizeTaskStatus(entry?.status || entry?.newValue || entry?.newValues?.status) === 'completed'
      || String(entry?.remarks || '').toLowerCase().includes('completed'))
    .map(entry => entry.changedAt || entry.updatedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
  if (compHistory) return compHistory;

  const activityLogs = Array.isArray(task?.activityLogs) ? task.activityLogs : [];
  const compActivity = activityLogs
    .filter(entry => {
      const s = normalizeTaskStatus(entry?.newValue || entry?.newValues?.status || entry?.status);
      if (s === 'completed') return true;
      const desc = String(entry?.description || entry?.remarks || '').toLowerCase();
      return desc.includes('changed to completed') || desc.includes('marked as completed');
    })
    .map(entry => entry.performedAt || entry.changedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
  if (compActivity) return compActivity;

  const sbuComp = (Array.isArray(task?.statusByUser) ? task.statusByUser : [])
    .find(s => normalizeTaskStatus(s.status) === 'completed');
  if (sbuComp?.updatedAt) return sbuComp.updatedAt;

  return null;
};

const getTaskStatusChangeDate = task => {
  // Set by the status endpoints (and list fetchers for older tasks) when a user changes the status.
  if (task?.statusChangedAt) return task.statusChangedAt;

  const statusHistory = Array.isArray(task?.statusHistory) ? task.statusHistory : [];
  if (statusHistory.length > 0) {
    const last = statusHistory[statusHistory.length - 1];
    if (last?.changedAt) return last.changedAt;
  }

  const activityLogs = Array.isArray(task?.activityLogs) ? task.activityLogs : [];
  const statusLogs = activityLogs.filter(l => l.type === 'status_change' || l.type === 'status_changed' || l.action === 'status_updated' || l.field === 'status' || l.previousStatus || l.newStatus || String(l.description || l.remarks || '').toLowerCase().includes('status'));
  const logDate = log => log?.performedAt || log?.changedAt || log?.createdAt;
  if (statusLogs.length > 0) {
    const sorted = [...statusLogs].sort((a, b) => new Date(logDate(b) || 0) - new Date(logDate(a) || 0));
    if (logDate(sorted[0])) return logDate(sorted[0]);
  }

  if (task?.inProgressSince) return task.inProgressSince;

  const sbu = (Array.isArray(task?.statusByUser) ? task.statusByUser : [])
    .find(s => normalizeTaskStatus(s.status) !== 'pending');
  if (sbu?.updatedAt) return sbu.updatedAt;

  return null;
};

// The date a task is listed under: the day its status was last changed by a user,
// otherwise its due date. A task created today and due on the 4th shows on the 4th
// until someone changes its status.
const getTaskReportDate = task => {
  const status = normalizeTaskStatus(task?.userStatus || task?.status || task?.overallStatus);

  if (status === 'completed') {
    const compDate = getTaskCompletionDate(task) || task?.statusChangedAt;
    if (compDate) return compDate;
    return task?.dueDateTime || task?.dueDate || null;
  }

  // statusChangedAt is only recorded for real changes, so it also covers a task moved back to pending.
  const statusChangeDate = task?.statusChangedAt || (status !== 'pending' ? getTaskStatusChangeDate(task) : null);
  if (statusChangeDate) return statusChangeDate;

  if (task?.dueDateTime || task?.dueDate) {
    return task.dueDateTime || task.dueDate;
  }

  // Active task without due date is awaiting action today.
  if (['pending', 'in-progress', 'onhold', 'reopen'].includes(status)) {
    return new Date();
  }

  return null;
};

// When this user last changed the status. Entries saved since statusChangedAt
// existed carry it; for older ones an updatedAt later than creation counts.
const getUserStatusChangedAt = (task, userId) => {
  const entry = (Array.isArray(task?.statusByUser) ? task.statusByUser : [])
    .find(s => String(s?.user?._id || s?.user || '') === String(userId));
  if (entry?.statusChangedAt) return new Date(entry.statusChangedAt);
  // Older entries have no statusChangedAt: fall back to updatedAt.
  const changedAt = entry?.updatedAt ? new Date(entry.updatedAt) : null;
  const createdAt = task?.createdAt ? new Date(task.createdAt) : null;
  if (!changedAt || Number.isNaN(changedAt.getTime())) return null;
  if (createdAt && changedAt.getTime() - createdAt.getTime() < 60 * 1000) return null;
  return changedAt;
};

const STATUS_LOG_TYPES = ['status_change', 'status_changed'];
const CLIENT_STATUS_LOG_ACTIONS = ['status_updated', 'completed', 'reopened'];

// Latest status-change time per project task, for tasks saved before statusChangedAt existed.
const getProjectStatusChangeDates = async projectIds => {
  if (!projectIds.length) return new Map();
  const rows = await Project.aggregate([
    { $match: { _id: { $in: projectIds } } },
    { $unwind: '$tasks' },
    { $project: { taskId: '$tasks._id', at: { $max: { $map: {
      input: { $filter: { input: { $ifNull: ['$tasks.activityLogs', []] }, as: 'log', cond: { $in: ['$$log.type', STATUS_LOG_TYPES] } } },
      as: 'log', in: '$$log.performedAt'
    } } } } }
  ]);
  return new Map(rows.filter(row => row.at).map(row => [String(row.taskId), row.at]));
};

// Latest status-change time per client task, for tasks saved before statusChangedAt existed.
const getClientStatusChangeDates = async taskIds => {
  if (!taskIds.length) return new Map();
  const rows = await ClientTask.aggregate([
    { $match: { _id: { $in: taskIds } } },
    { $project: { at: { $max: { $map: {
      input: { $filter: { input: { $ifNull: ['$activityLogs', []] }, as: 'log', cond: { $in: ['$$log.action', CLIENT_STATUS_LOG_ACTIONS] } } },
      as: 'log', in: '$$log.createdAt'
    } } } } }
  ]);
  return new Map(rows.filter(row => row.at).map(row => [String(row._id), row.at]));
};

const getTaskSourceAwareDate = task => {
  if (!task) return null;
  return getTaskReportDate(task);
};

const groupTasksByDate = (tasks, dateField = 'createdAt', serialKey = 'serialNo') => {
  const grouped = {};

  tasks.forEach(task => {
    let dateValue = task[dateField] || task.createdAt;
    if (dateField === 'source-aware') {
      dateValue = getTaskSourceAwareDate(task);
    }
    const dateKey = dateValue ? moment(dateValue).format('DD-MM-YYYY') : 'No Date';
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(task);
  });

  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    if (a === 'No Date') return 1;
    if (b === 'No Date') return -1;
    return moment(b, 'DD-MM-YYYY').toDate() - moment(a, 'DD-MM-YYYY').toDate();
  });

  const sortedGrouped = {};
  sortedKeys.forEach(dateKey => {
    sortedGrouped[dateKey] = grouped[dateKey]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map((task, index) => ({
        ...task,
        [serialKey]: index + 1
      }));
  });

  return sortedGrouped;
};

const getTaskSortDate = task => {
  const dateValue = task?.createdAt || task?.createdDate || task?.updatedAt || getTaskSourceAwareDate(task);
  const date = new Date(dateValue || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const sortTasksNewestFirst = tasks => {
  return [...tasks].sort((a, b) => {
    const dateDiff = getTaskSortDate(b) - getTaskSortDate(a);
    if (dateDiff !== 0) return dateDiff;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
};

const paginateTasks = (tasks, req) => {
  const page = parsePositiveInt(req.query.page, 1);
  const limit = parsePositiveInt(req.query.limit, 10, 100);
  const total = tasks.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * limit;

  return {
    page: safePage,
    limit,
    total,
    pages,
    hasNext: safePage * limit < total,
    hasPrev: safePage > 1,
    tasks: tasks.slice(start, start + limit)
  };
};

const getRequestCompanyCode = (req, user = null) => {
  const companyCode = req?.user?.companyCode
    || req?.user?.company?.companyCode
    || user?.companyCode
    || user?.company?.companyCode
    || req?.headers?.['x-company-code']
    || req?.headers?.['companycode']
    || req?.headers?.['company-code']
    || req?.body?.companyCode;
  return typeof companyCode === 'string' ? companyCode.trim().toUpperCase() : companyCode;
};

const createNotification = async (userId, title, message, type, relatedTask = null, metadata = null) => {
  try {
    await notifyDirectUsers({
      userIds: [userId],
      targetPath: metadata?.targetPath || '/ciisUser/task-management',
      title,
      message,
      type,
      data: {
        ...(metadata || {}),
        ...(relatedTask ? { taskId: relatedTask, relatedTask } : {})
      },
      priority: metadata?.priority === 'high' ? 'high' : 'medium'
    });
  } catch (error) {
    console.error('❌ Error creating notification:', error);
  }
};

const createActivityLog = async (user, action, task, description, oldValues = null, newValues = null, req = null) => {
  try {
    if (!user || !user._id) return;
    await ActivityLog.create({
      user: user._id,
      action,
      task,
      description,
      oldValues,
      newValues,
      ipAddress: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.get('User-Agent')
    });
  } catch (error) {
    console.error('❌ Error creating activity log:', error);
  }
};

const enrichStatusInfo = async (tasks) => {
  if (!tasks || tasks.length === 0) return tasks;

  const userIds = [];
  tasks.forEach(task => {
    task.statusByUser?.forEach(s => {
      if (s.user) userIds.push(s.user.toString());
    });
  });

  if (userIds.length === 0) return tasks;

  const users = await User.find({ _id: { $in: [...new Set(userIds)] } }).select('name role jobRole companyRole email profileImage avatar department branch').lean();
  const userMap = {};
  users.forEach(u => { userMap[u._id.toString()] = u; });

  return tasks.map(task => {
    if (!task.statusByUser || !Array.isArray(task.statusByUser)) return task;
    const seenUserIds = new Set();
    const latestStatusByUser = [];
    for (let i = task.statusByUser.length - 1; i >= 0; i--) {
      const s = task.statusByUser[i];
      const uid = String(s.user?._id || s.user || '');
      if (!uid || seenUserIds.has(uid)) continue;
      seenUserIds.add(uid);
      latestStatusByUser.unshift(s);
    }

    const info = latestStatusByUser.map(s => {
      const uid = String(s.user?._id || s.user || '');
      const u = userMap[uid];
      let img = u?.profileImage || u?.avatar || null;
      if (typeof img === 'string' && img.startsWith('data:') && img.length > 500) {
        img = null;
      }
      return {
        userId: s.user,
        name: u?.name || 'Unknown',
        role: u?.role || u?.jobRole || u?.companyRole || 'N/A',
        email: u?.email || 'N/A',
        profileImage: img,
        department: u?.department || null,
        branch: u?.branch || null,
        status: s.status,
        ...(s.status === 'approved' && { approvedByUser: `${u?.name} (${u?.role || u?.jobRole || 'User'})` }),
        ...(s.status === 'rejected' && { rejectedByUser: `${u?.name} (${u?.role || u?.jobRole || 'User'})` })
      };
    });
    return { ...task, ...normalizeTaskRecurrenceFields(task), statusInfo: info, statusByUser: latestStatusByUser };
  });
};

const sendTaskCreationEmail = async (task, assignedUsers) => {
  try {
    for (const u of assignedUsers) {
      const subject = `🎯 New Task Assigned: ${task.title}`;
      const html = `<div style="font-family: Arial; padding: 20px;">
        <h2>New Task Assigned</h2>
        <p>Hello <strong>${u.name}</strong>,</p>
        <p>You have been assigned a new task: <strong>${task.title}</strong></p>
        <p>Priority: ${task.priority.toUpperCase()}</p>
        <p>Assigned By: ${task.createdBy.name}</p>
      </div>`;
      await sendEmail(u.email, subject, html, { skipNotification: true });
    }
  } catch (err) {
    console.error('❌ Email failed:', err);
  }
};


const getCleanFilterDate = (task, dateField) => {
  const normalizedField = String(dateField || '').toLowerCase();
  if (normalizedField === 'createdat' || normalizedField === 'createddate') {
    return task.createdAt;
  }
  if (normalizedField === 'updatedat' || normalizedField === 'updateddate') {
    return task.updatedAt || task.createdAt;
  }
  if (normalizedField === 'completedat' || normalizedField === 'completiondate') {
    return task.completionDate || task.completedAt;
  }
  if (normalizedField === 'reportdate' || normalizedField === 'completion-aware' || normalizedField === 'completionaware') {
    return getTaskReportDate(task);
  }
  if (normalizedField === 'source-aware' || normalizedField === 'sourceaware') {
    return getTaskSourceAwareDate(task);
  }
  return getTaskReportDate(task);
};

const getCleanTaskStatus = task => {
  const rawStatus = task.userStatus || task.status || task.overallStatus || 'pending';
  const normalized = normalizeTaskStatus(rawStatus);
  return isTaskOverdueForStatus(task.dueDateTime || task.dueDate, normalized, task) ? 'overdue' : normalized;
};

const matchesAssignedUser = (task, assignedTo) => {
  if (!assignedTo || assignedTo === 'all') return true;
  const target = String(assignedTo);
  const assignedUsers = Array.isArray(task.assignedUsers) ? task.assignedUsers : [];
  return assignedUsers.some(user => String(user?._id || user?.id || user) === target)
    || String(task.assignedTo?._id || task.assignedTo?.id || task.assignedTo || '') === target
    || String(task.userId?._id || task.userId?.id || task.userId || '') === target;
};

const applyCleanListFilters = (tasks, req) => {
  const { status, search, period, priority, overdue, assignedTo, dateField } = req.query;
  const fromDate = req.query.fromDate || req.query.startDate;
  const toDate = req.query.toDate || req.query.endDate;
  const range = getCleanTaskDateRange({ period: fromDate || toDate ? 'all' : period, fromDate, toDate });
  const query = search ? String(search).trim().toLowerCase() : '';

  return tasks.filter(t => {
    if (status && status !== 'all') {
      const requestedStatus = normalizeTaskStatus(status);
      const requestedPriority = String(status).toLowerCase().replace('-priority', '');
      const taskStatus = getCleanTaskStatus(t);
      if (['high', 'medium', 'low'].includes(requestedPriority)) {
        // Priority stat cards filter by priority, not by task status.
        if (String(t.priority || '').toLowerCase() !== requestedPriority) return false;
      } else if (requestedStatus === 'overdue') {
        if (taskStatus !== 'overdue') return false;
      } else if (taskStatus !== requestedStatus) {
        return false;
      }
    }
    if (priority && priority !== 'all' && String(t.priority || '').toLowerCase() !== String(priority).toLowerCase()) return false;
    if (overdue && overdue !== 'all') {
      const taskOverdue = getCleanTaskStatus(t) === 'overdue';
      if ((overdue === 'true' || overdue === 'overdue') && !taskOverdue) return false;
      if ((overdue === 'false' || overdue === 'not-overdue') && taskOverdue) return false;
    }
    if (!matchesAssignedUser(t, assignedTo)) return false;
    if (query) {
      const searchHaystack = [t.title, t.name, t.description, t.clientName, t.service].map(v => String(v || '').toLowerCase()).join(' ');
      if (!searchHaystack.includes(query)) return false;
    }
    if (range) {
      const sourceDate = getCleanFilterDate(t, dateField);
      const dateVal = new Date(sourceDate);
      if (isNaN(dateVal.getTime())) return false;
      if (range.$gte && dateVal < range.$gte) return false;
      if (range.$lte && dateVal > range.$lte) return false;
    }
    return true;
  });
};

const sendCleanTaskList = (res, tasks, view, dateField = 'createdAt', req = null) => {
  const sortedTasks = sortTasksNewestFirst(tasks);
  const shouldPaginate = req && !['true', '1', 'yes'].includes(String(req.query?.all || req.query?.noPagination || '').toLowerCase());
  const pagination = shouldPaginate ? paginateTasks(sortedTasks, req) : null;
  // reportDate is the day the task is listed under, so clients group by the same date the filters use.
  const responseTasks = (pagination ? pagination.tasks : sortedTasks)
    .map(task => ({ ...task, reportDate: getTaskReportDate(task) }));

  return res.json({
    success: true,
    view,
    groupedTasks: groupTasksByDate(responseTasks, dateField, 'serialNo'),
    tasks: responseTasks,
    stats: calculateUnifiedTaskStats(sortedTasks),
    count: responseTasks.length,
    total: sortedTasks.length,
    ...(pagination ? {
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        pages: pagination.pages,
        hasNext: pagination.hasNext,
        hasPrev: pagination.hasPrev
      }
    } : {})
  });
};

const normalizeProjectTaskStatus = status => {
  const normalized = normalizeTaskStatus(status || 'pending');
  if (normalized === 'in-progress') return 'in-progress';
  if (normalized === 'onhold') return 'onhold';
  return normalized;
};

const getProjectTaskAssignedBy = (task, project) => {
  const creationLog = (task.activityLogs || []).find(log => log.type === 'creation');
  return task.createdBy || creationLog?.performedBy || project.createdBy;
};

const fetchPersonalTaskList = async (req, { includeCreatedForOthers = false } = {}) => {
  const companyCode = req.user.companyCode;
  const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
  const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

  const tasks = await Task.find({
    companyCode: companyFilter,
    createdBy: req.user._id,
    ...(includeCreatedForOthers ? { taskFor: { $in: ['self', 'others'] } } : { taskFor: 'self' }),
    isActive: true
  })
    // Remarks and status history are loaded by their dedicated detail endpoints.
    // Keeping them out of list responses prevents large task documents from
    // dominating transfer and JSON serialization time.
    .select('-remarks -statusHistory')
    .populate('assignedUsers', TASK_USER_POPULATE_FIELDS)
    .populate('assignedGroups', TASK_GROUP_POPULATE_FIELDS)
    .populate('createdBy', TASK_CREATOR_POPULATE_FIELDS)
    .sort({ createdAt: -1 })
    .lean();

  const enriched = await enrichStatusInfo(tasks);
  return enriched.map(t => {
    const isPersonal = t.taskFor === 'self';
    // A task created for others is listed by the latest change any assignee made.
    const statusChangedAt = isPersonal
      ? getUserStatusChangedAt(t, req.user._id)
      : (t.statusByUser || [])
        .map(entry => getUserStatusChangedAt(t, entry?.user?._id || entry?.user))
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || null;
    return {
      ...t,
      statusChangedAt,
      status: normalizeTaskStatus(t.overallStatus),
      // Created-for-others tasks use the assigned update path, which permits
      // their creator to update the shared task status.
      taskSource: isPersonal ? 'self' : 'assigned',
      __taskSource: isPersonal ? 'self' : 'assigned'
    };
  });
};

const fetchAssignedToMeTaskList = async (req) => {
  const currentUserId = req.user._id || req.user.id;
  const groups = await Group.find({ members: currentUserId, isActive: true }).select('_id').lean();
  const groupIds = groups.map(g => g._id);

  const companyCode = req.user.companyCode;
  const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
  const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

  const tasks = await Task.find({
    companyCode: companyFilter,
    isActive: true,
    taskFor: 'others',
    createdBy: { $ne: currentUserId },
    $or: [
      { assignedUsers: currentUserId },
      { assignedGroups: { $in: groupIds } }
    ]
  })
    .select('-remarks -statusHistory')
    .populate('assignedUsers', TASK_USER_POPULATE_FIELDS)
    .populate('assignedGroups', TASK_GROUP_POPULATE_FIELDS)
    .populate('createdBy', TASK_CREATOR_POPULATE_FIELDS)
    .sort({ createdAt: -1 })
    .lean();

  const enriched = await enrichStatusInfo(tasks);
  return enriched.map(t => {
    const userEntry = t.statusByUser?.find(s => (s.user?._id || s.user)?.toString() === currentUserId.toString());
    const status = userEntry?.status || t.overallStatus || 'pending';
    return {
      ...t,
      statusChangedAt: getUserStatusChangedAt(t, currentUserId),
      status: normalizeTaskStatus(status),
      taskSource: 'assigned',
      __taskSource: 'assigned'
    };
  });
};

const fetchAssignedClientTaskList = async (req) => {
  const companyCode = getRequestCompanyCode(req);
  const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
  const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

  const clients = await Client.find(companyFilter ? { companyCode: companyFilter } : {}).select('_id').lean();
  const clientIds = clients.map(c => c._id);
  const currentUser = req.user;

  const tasks = await ClientTask.find({
    clientId: { $in: clientIds },
    $or: [
      { assigneeId: currentUser._id },
      { assignee: currentUser.id?.toString() },
      { assignee: currentUser._id?.toString() },
      { assignee: currentUser.name },
      { assignee: currentUser.email }
    ].filter(Boolean)
  })
    .select('-remarks -activityLogs')
    .populate('clientId', 'client name email company phone companyCode')
    .sort({ createdAt: -1 })
    .lean();
  const loggedChangeDates = await getClientStatusChangeDates(tasks.filter(t => !t.statusChangedAt).map(t => t._id));

  return tasks.map(t => {
    const status = t.completed ? 'completed' : normalizeTaskStatus(t.status || 'pending');
    return {
      _id: t._id,
      title: t.name,
      name: t.name,
      description: t.description || t.name,
      service: t.service || '',
      completedAt: t.completedAt || null,
      inProgressSince: t.inProgressSince || null,
      statusChangedAt: t.statusChangedAt || loggedChangeDates.get(String(t._id)) || null,
      dueDate: t.dueDate,
      dueDateTime: t.dueDate,
      completed: t.completed,
      status,
      priority: (t.priority || 'Medium').toLowerCase(),
      clientName: t.clientId?.client || t.clientId?.name || 'Unknown Client',
      clientId: t.clientId,
      checkpoints: t.checkpoints || [],
      files: t.files || [],
      remarks: t.remarks || [],
      createdAt: t.createdAt,
      taskSource: 'client',
      __taskSource: 'client',
      isOverdue: isTaskOverdueForStatus(t.dueDate, status, t)
    };
  });
};

const fetchAssignedProjectTaskList = async (req) => {
  const currentUserId = (req.user._id || req.user.id).toString();
  const currentUserObjectId = mongoose.Types.ObjectId.isValid(currentUserId)
    ? new mongoose.Types.ObjectId(currentUserId)
    : currentUserId;

  const projects = await Project.aggregate([
    { $match: { 'tasks.assignedTo': currentUserObjectId } },
    {
      $project: {
        projectName: 1,
        description: 1,
        createdBy: 1,
        createdAt: 1,
        updatedAt: 1,
        tasks: {
          $filter: {
            input: '$tasks',
            as: 'task',
            cond: { $eq: ['$$task.assignedTo', currentUserObjectId] }
          }
        }
      }
    },
    // List cards fetch remarks and activity only when the user opens their
    // respective dialogs. Keeping those unbounded arrays in the aggregate
    // makes the task-management page increasingly slow as history grows.
    { $addFields: { tasks: { $map: { input: '$tasks', as: 'task', in: { $mergeObjects: ['$$task', {
      loggedStatusChangedAt: { $max: { $map: {
        input: { $filter: { input: { $ifNull: ['$$task.activityLogs', []] }, as: 'log', cond: { $in: ['$$log.type', STATUS_LOG_TYPES] } } },
        as: 'log', in: '$$log.performedAt'
      } } }
    }] } } } } },
    { $unset: ['tasks.activityLogs', 'tasks.remarks'] }
  ]);

  const userIds = new Set();
  projects.forEach(project => {
    if (project.createdBy) userIds.add(String(project.createdBy));
    (project.tasks || []).forEach(task => {
      if (task.assignedTo) userIds.add(String(task.assignedTo));
      if (task.createdBy) userIds.add(String(task.createdBy));
      (task.assignedUsers || []).forEach(userId => {
        if (userId) userIds.add(String(userId));
      });
      (task.activityLogs || []).forEach(log => {
        if (log.performedBy) userIds.add(String(log.performedBy));
      });
    });
  });

  const users = userIds.size
    ? await User.find({ _id: { $in: [...userIds] } }).select(TASK_CREATOR_POPULATE_FIELDS).lean()
    : [];
  const usersById = new Map(users.map(user => [String(user._id), user]));
  const hydrateUser = value => {
    if (!value) return value;
    if (typeof value === 'object' && value.name) return value;
    return usersById.get(String(value)) || value;
  };

  const tasks = [];

  projects.forEach(project => {
    const projectCreatedBy = hydrateUser(project.createdBy);
    (project.tasks || []).forEach(task => {
      const assignedTo = hydrateUser(task.assignedTo);
      const assignedToId = assignedTo?._id || assignedTo;
      const isAssignedToMe = assignedTo?.toString() === currentUserId;
      const isHydratedAssignedToMe = assignedToId?.toString() === currentUserId;
      if (!isAssignedToMe && !isHydratedAssignedToMe) return;

      const assignedUsers = Array.isArray(task.assignedUsers)
        ? task.assignedUsers.map(hydrateUser)
        : [];
      const taskCreatedBy = hydrateUser(task.createdBy);
      const activityLogs = [];

      const status = normalizeProjectTaskStatus(task.status);
      const lastActivityAt = task.updatedAt || task.createdAt || project.updatedAt || project.createdAt;
      const assignedBy = getProjectTaskAssignedBy(
        { ...task, createdBy: taskCreatedBy, activityLogs },
        { ...project, createdBy: projectCreatedBy }
      );
      const latestActivityDate = (predicate) => activityLogs
        .filter(predicate)
        .map(log => log.performedAt || log.createdAt)
        .filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0] || null;
      const assignedAt = latestActivityDate(log => log.type === 'assignment');
      const statusUpdatedAt = latestActivityDate(log => (
        log.type === 'status_change' || log.type === 'status_changed'
      ));
      const completedAt = latestActivityDate(log => (
        (log.type === 'status_change' || log.type === 'status_changed') &&
        normalizeTaskStatus(log.newValue) === 'completed'
      ));

      tasks.push({
        _id: task._id,
        projectId: project._id,
        title: task.title || 'Untitled Project Task',
        name: task.title || 'Untitled Project Task',
        description: task.description || project.description || '',
        dueDate: task.dueDate,
        dueDateTime: task.dueDate,
        priority: String(task.priority || 'medium').toLowerCase(),
        status,
        userStatus: status,
        assignedTo,
        assignedUsers,
        createdBy: assignedBy,
        assignedBy,
        assignedByName: assignedBy?.name || assignedBy?.email || 'Unknown',
        assignedToName: assignedTo?.name || 'Unknown',
        assignedToEmail: assignedTo?.email || '',
        projectName: project.projectName,
        projectTaskId: task._id,
        checkpoints: task.checkpoints || [],
        files: task.pdfFile?.path ? [{
          filename: task.pdfFile.filename,
          originalName: task.pdfFile.filename,
          path: task.pdfFile.path
        }] : [],
        remarks: [],
        activityLogs,
        createdAt: task.createdAt || project.createdAt,
        updatedAt: task.updatedAt || project.updatedAt,
        lastActivityAt,
        assignedAt,
        statusUpdatedAt,
        completedAt: task.completionDate || completedAt,
        completionDate: task.completionDate || null,
        statusChangedAt: task.statusChangedAt || task.loggedStatusChangedAt || null,
        source: 'project',
        taskSource: 'project',
        __taskSource: 'project',
        isOverdue: isTaskOverdueForStatus(task.dueDate, status, task)
      });
    });
  });

  return tasks;
};

module.exports = {
  Task,
  ClientTask,
  Client,
  Project,
  User,
  Group,
  Notification,
  ActivityLog,
  moment,
  sendEmail,
  fs,
  path,
  sharp,
  notifyDirectUsers,
  notifyPageUsers,
  parsePositiveInt,
  getCleanTaskDateRange,
  normalizeTaskStatus,
  isOnHoldStatus,
  canChangeFromOnHold,
  parseTaskCheckpoints,
  isTaskOverdueForStatus,
  calculateUnifiedTaskStats,
  groupTasksByDate,
  getTaskSortDate,
  sortTasksNewestFirst,
  paginateTasks,
  getRequestCompanyCode,
  createNotification,
  createActivityLog,
  enrichStatusInfo,
  sendTaskCreationEmail,
  applyCleanListFilters,
  sendCleanTaskList,
  normalizeProjectTaskStatus,
  getProjectTaskAssignedBy,
  getTaskCompletionDate,
  getTaskStatusChangeDate,
  getTaskReportDate,
  getTaskSourceAwareDate,
  getUserStatusChangedAt,
  getClientStatusChangeDates,
  getProjectStatusChangeDates,
  STATUS_LOG_TYPES,
  fetchPersonalTaskList,
  fetchAssignedToMeTaskList,
  fetchAssignedClientTaskList,
  fetchAssignedProjectTaskList,
  TASK_USER_POPULATE_FIELDS,
  TASK_GROUP_POPULATE_FIELDS,
  TASK_CREATOR_POPULATE_FIELDS
};
