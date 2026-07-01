
const Task = require('../models/Task');
const ClientTask = require('../models/ClientTask');
const Client = require('../models/Client');
const { Project } = require('../models/Project');
const User = require('../../models/User');
const Group = require('../models/Group');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const moment = require('moment');
const { sendEmail } = require('../../utils/sendEmail');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { notifyDirectUsers, notifyPageUsers } = require('../utils/systemNotificationService');

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

const isTaskOverdueForStatus = (dueDateTime, status) => {
  if (!dueDateTime) return false;
  if (status === 'overdue') return true;
  const dueDate = new Date(dueDateTime);
  if (isNaN(dueDate.getTime())) return false;
  return dueDate < new Date() && !['completed', 'cancelled', 'approved'].includes(status);
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

    if (isTaskOverdueForStatus(task.dueDateTime || task.dueDate, status)) {
      status = 'overdue';
    }

    if (counts[status] !== undefined) {
      counts[status]++;
    } else {
      counts.pending++;
    }
  });

  const total = tasks.length;
  const pct = count => total > 0 ? Math.round((count / total) * 100) : 0;

  return {
    total,
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

const getTaskSourceAwareDate = task => {
  if (!task) return null;
  const source = String(task.__taskSource || task.taskSource || task.source || '').toLowerCase();
  if (source === 'client') {
    return task.dueDate || task.dueDateTime || task.createdAt;
  }
  if (source === 'project') {
    let statusUpdateDate = null;
    if (task.activityLogs && task.activityLogs.length > 0) {
      const statusLogs = task.activityLogs.filter(log => log.type === 'status_change' || log.type === 'status_changed');
      if (statusLogs.length > 0) {
        const sortedLogs = [...statusLogs].sort((a, b) => new Date(b.performedAt || b.createdAt || 0) - new Date(a.performedAt || a.createdAt || 0));
        statusUpdateDate = sortedLogs[0].performedAt || sortedLogs[0].createdAt;
      }
    }
    return statusUpdateDate || task.updatedAt || task.createdAt;
  }
  if (source === 'self' || source === 'personal') {
    return task.createdAt;
  }
  return task.dueDateTime || task.dueDate || task.createdAt;
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
  const dateValue = getTaskSourceAwareDate(task);
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
  const companyCode = req.user?.companyCode || user?.companyCode || user?.company?.companyCode;
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

  const users = await User.find({ _id: { $in: [...new Set(userIds)] } }).select('name role email').lean();
  const userMap = {};
  users.forEach(u => { userMap[u._id.toString()] = u; });

  return tasks.map(task => {
    if (!task.statusByUser) return task;
    const info = task.statusByUser.map(s => {
      const u = userMap[s.user.toString()];
      return {
        userId: s.user,
        name: u?.name || 'Unknown',
        role: u?.role || 'N/A',
        email: u?.email || 'N/A',
        status: s.status,
        ...(s.status === 'approved' && { approvedByUser: `${u?.name} (${u?.role})` }),
        ...(s.status === 'rejected' && { rejectedByUser: `${u?.name} (${u?.role})` })
      };
    });
    return { ...task, statusInfo: info };
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

const sendTaskStatusUpdateEmail = async (task, updatedUser, oldStatus, newStatus) => {
  try {
    const subject = `🔄 Task Status Updated: ${task.title}`;
    const html = `<div style="font-family: Arial; padding: 20px;">
      <h2>Task Status Updated</h2>
      <p>Hello <strong>${task.createdBy.name}</strong>,</p>
      <p><strong>${updatedUser.name}</strong> has updated the task status:</p>
      <p>Task: ${task.title}</p>
      <p>Status: ${oldStatus.toUpperCase()} → ${newStatus.toUpperCase()}</p>
    </div>`;
    await sendEmail(task.createdBy.email, subject, html, { skipNotification: true });
  } catch (err) {
    console.error('❌ Email failed:', err);
  }
};

const getCleanFilterDate = (task, dateField) => {
  const normalizedField = String(dateField || '').toLowerCase();
  if (normalizedField === 'createdat' || normalizedField === 'createddate') {
    return task.createdAt;
  }
  return task.dueDateTime || task.dueDate || task.createdAt;
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
      if (requestedStatus === 'overdue') {
        const taskOverdue = isTaskOverdueForStatus(t.dueDateTime || t.dueDate, t.status || t.overallStatus);
        if (!taskOverdue && normalizeTaskStatus(t.status) !== 'overdue') return false;
      } else if (normalizeTaskStatus(t.status) !== requestedStatus) {
        return false;
      }
    }
    if (priority && priority !== 'all' && String(t.priority || '').toLowerCase() !== String(priority).toLowerCase()) return false;
    if (overdue && overdue !== 'all') {
      const taskOverdue = isTaskOverdueForStatus(t.dueDateTime || t.dueDate, t.status || t.overallStatus);
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
  const pagination = req ? paginateTasks(sortedTasks, req) : null;
  const responseTasks = pagination ? pagination.tasks : sortedTasks;

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

const fetchPersonalTaskList = async (req) => {
  const companyCode = req.user.companyCode;
  const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
  const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

  const tasks = await Task.find({
    companyCode: companyFilter,
    createdBy: req.user._id,
    taskFor: 'self',
    isActive: true
  }).populate('assignedUsers', 'name email').populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();

  const enriched = await enrichStatusInfo(tasks);
  return enriched.map(t => ({ ...t, status: normalizeTaskStatus(t.overallStatus), taskSource: 'self', __taskSource: 'self' }));
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
  }).populate('assignedUsers', 'name email').populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();

  const enriched = await enrichStatusInfo(tasks);
  return enriched.map(t => {
    const userEntry = t.statusByUser?.find(s => (s.user?._id || s.user)?.toString() === currentUserId.toString());
    const status = userEntry?.status || t.overallStatus || 'pending';
    return { ...t, status: normalizeTaskStatus(status), taskSource: 'assigned', __taskSource: 'assigned' };
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
  }).populate('clientId', 'client name email company phone companyCode').sort({ createdAt: -1 }).lean();

  return tasks.map(t => {
    const status = t.completed ? 'completed' : normalizeTaskStatus(t.status || 'pending');
    return {
      _id: t._id,
      title: t.name,
      name: t.name,
      description: t.description || t.name,
      dueDate: t.dueDate,
      dueDateTime: t.dueDate,
      completed: t.completed,
      status,
      priority: (t.priority || 'Medium').toLowerCase(),
      clientName: t.clientId?.client || t.clientId?.name || 'Unknown Client',
      clientId: t.clientId,
      files: t.files || [],
      remarks: t.remarks || [],
      createdAt: t.createdAt,
      taskSource: 'client',
      __taskSource: 'client',
      isOverdue: isTaskOverdueForStatus(t.dueDate, status)
    };
  });
};

const fetchAssignedProjectTaskList = async (req) => {
  const currentUserId = (req.user._id || req.user.id).toString();

  const projects = await Project.find({ 'tasks.assignedTo': currentUserId })
    .select('projectName description createdBy users tasks createdAt updatedAt')
    .populate('createdBy', 'name email')
    .populate('tasks.assignedTo', 'name email')
    .populate('tasks.createdBy', 'name email')
    .populate('tasks.activityLogs.performedBy', 'name email')
    .lean();

  const tasks = [];

  projects.forEach(project => {
    (project.tasks || []).forEach(task => {
      const assignedTo = task.assignedTo?._id || task.assignedTo;
      const isAssignedToMe = assignedTo?.toString() === currentUserId;
      if (!isAssignedToMe) return;

      const status = normalizeProjectTaskStatus(task.status);
      const lastActivityAt = task.updatedAt || task.createdAt || project.updatedAt || project.createdAt;
      const assignedBy = getProjectTaskAssignedBy(task, project);

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
        assignedTo: task.assignedTo,
        createdBy: assignedBy,
        assignedBy,
        assignedByName: assignedBy?.name || assignedBy?.email || 'Unknown',
        assignedToName: task.assignedTo?.name || 'Unknown',
        assignedToEmail: task.assignedTo?.email || '',
        projectName: project.projectName,
        projectTaskId: task._id,
        files: task.pdfFile?.path ? [{
          filename: task.pdfFile.filename,
          originalName: task.pdfFile.filename,
          path: task.pdfFile.path
        }] : [],
        remarks: task.remarks || [],
        activityLogs: task.activityLogs || [],
        createdAt: task.createdAt || project.createdAt,
        updatedAt: task.updatedAt || project.updatedAt,
        lastActivityAt,
        source: 'project',
        taskSource: 'project',
        __taskSource: 'project',
        isOverdue: isTaskOverdueForStatus(task.dueDate, status)
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
  sendTaskStatusUpdateEmail,
  applyCleanListFilters,
  sendCleanTaskList,
  normalizeProjectTaskStatus,
  getProjectTaskAssignedBy,
  fetchPersonalTaskList,
  fetchAssignedToMeTaskList,
  fetchAssignedClientTaskList,
  fetchAssignedProjectTaskList
};
