
const Task = require('../models/Task');
const ClientTask = require('../models/ClientTask');
const Client = require('../models/Client');
const { Project } = require('../models/Project');
const Attendance = require('../models/Attendance');
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

const getTaskOverdueEligibilityDate = (dueDateTime, task) => {
  if (!dueDateTime) return null;
  const dueDate = new Date(dueDateTime);
  if (isNaN(dueDate.getTime())) return null;

  if (task?.taskFor === 'self' && task?.onHoldReleasedAt) {
    const releasedAt = new Date(task.onHoldReleasedAt);
    if (!isNaN(releasedAt.getTime()) && dueDate <= releasedAt) {
      return new Date(releasedAt.getTime() + 24 * 60 * 60 * 1000);
    }
  }

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

const secondsToDurationLabel = seconds => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours <= 0 && minutes <= 0) return '0m';
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

const getTaskReportDateRange = query => {
  const range = getCleanTaskDateRange({
    period: query?.fromDate || query?.toDate ? 'all' : (query?.period || 'today'),
    fromDate: query?.fromDate,
    toDate: query?.toDate
  });
  if (range) return { start: range.$gte || null, end: range.$lte || null };

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const toValidWorkDate = value => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getOverlapSeconds = (start, end, windowStart, windowEnd) => {
  const safeStart = toValidWorkDate(start);
  const safeEnd = toValidWorkDate(end);
  if (!safeStart || !safeEnd || !windowStart || !windowEnd) return 0;
  const from = Math.max(safeStart.getTime(), windowStart.getTime());
  const to = Math.min(safeEnd.getTime(), windowEnd.getTime());
  return to > from ? Math.floor((to - from) / 1000) : 0;
};

const getClippedInterval = (start, end, windowStart, windowEnd) => {
  const safeStart = toValidWorkDate(start);
  const safeEnd = toValidWorkDate(end);
  if (!safeStart || !safeEnd || !windowStart || !windowEnd) return null;
  const from = Math.max(safeStart.getTime(), windowStart.getTime());
  const to = Math.min(safeEnd.getTime(), windowEnd.getTime());
  return to > from ? { start: new Date(from), end: new Date(to) } : null;
};

const getMergedIntervalSeconds = (intervals = []) => {
  const sorted = intervals
    .filter(interval => interval?.start && interval?.end)
    .map(interval => ({
      start: new Date(interval.start).getTime(),
      end: new Date(interval.end).getTime()
    }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return 0;

  const merged = [];
  sorted.forEach(interval => {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
      return;
    }
    last.end = Math.max(last.end, interval.end);
  });

  return merged.reduce((sum, interval) => sum + Math.floor((interval.end - interval.start) / 1000), 0);
};

const buildFirstProgressToCompletedSession = (events = [], currentStatus, windowEnd) => {
  const sorted = [...events]
    .map(event => ({
      status: normalizeTaskStatus(event.status),
      at: toValidWorkDate(event.at)
    }))
    .filter(event => event.status && event.at)
    .sort((a, b) => a.at - b.at);

  const firstInProgress = sorted.find(event => event.status === 'in-progress');
  if (!firstInProgress) return null;

  const completedEvents = sorted.filter(
    event => event.status === 'completed' && event.at >= firstInProgress.at
  );
  const lastCompleted = completedEvents[completedEvents.length - 1];

  if (lastCompleted) {
    return { start: firstInProgress.at, end: lastCompleted.at };
  }

  if (normalizeTaskStatus(currentStatus) === 'in-progress') {
    return { start: firstInProgress.at, end: windowEnd || new Date() };
  }

  return null;
};

const getTaskStatusEvents = task => {
  if (Array.isArray(task.statusHistory) && task.statusHistory.length > 0) {
    return task.statusHistory.map(entry => ({
      status: entry.status,
      at: entry.changedAt || entry.createdAt || entry.updatedAt
    }));
  }

  if (Array.isArray(task.activityLogs) && task.activityLogs.length > 0) {
    return task.activityLogs
      .map(entry => ({
        status: entry.newValue || entry.newValues?.status || entry.status,
        at: entry.performedAt || entry.createdAt || entry.updatedAt
      }))
      .filter(entry => entry.status);
  }

  return [];
};

const calculateTaskWork = (task, workWindow) => {
  if (!workWindow?.start || !workWindow?.end) return { seconds: 0, interval: null };

  const session = buildFirstProgressToCompletedSession(
    getTaskStatusEvents(task),
    task.userStatus || task.status || task.overallStatus,
    workWindow.end
  );

  let interval = session
    ? getClippedInterval(session.start, session.end, workWindow.start, workWindow.end)
    : null;
  let total = interval ? getOverlapSeconds(interval.start, interval.end, workWindow.start, workWindow.end) : 0;

  if (total === 0 && task.taskSource === 'client') {
    const storedSeconds = Number(task.timeSpent || 0);
    const activeInterval = normalizeTaskStatus(task.status) === 'in-progress' && task.inProgressSince
      ? getClippedInterval(task.inProgressSince, workWindow.end, workWindow.start, workWindow.end)
      : null;
    const activeSeconds = activeInterval ? getOverlapSeconds(activeInterval.start, activeInterval.end, workWindow.start, workWindow.end) : 0;
    total = storedSeconds + activeSeconds;
    interval = activeInterval;
  }

  return { seconds: Math.max(0, total), interval };
};

const getUserWorkWindow = async (userId, query) => {
  const range = getTaskReportDateRange(query);
  const attendance = await Attendance.findOne({
    user: userId,
    date: { $gte: range.start, $lte: range.end }
  }).sort({ date: -1 }).lean();

  const clockIn = toValidWorkDate(attendance?.inTime);
  const rawClockOut = toValidWorkDate(attendance?.outTime);
  const clockOut = rawClockOut || (attendance?.isClockedIn ? new Date() : null);
  const start = clockIn || range.start;
  const end = clockOut || range.end;
  const totalSeconds = clockIn && end ? Math.max(0, Math.floor((end - clockIn) / 1000)) : 0;

  return {
    start,
    end,
    attendance,
    summary: {
      clockIn,
      clockOut: rawClockOut,
      isClockedIn: Boolean(attendance?.isClockedIn),
      totalClockedSeconds: totalSeconds,
      totalClockedLabel: secondsToDurationLabel(totalSeconds)
    }
  };
};

const normalizeCodeBase = (code) => {
  if (!code) return '';
  return String(code).split('-')[0].trim().toUpperCase();
};

const isCompanyAllTaskEdit = (req) => (
  req.body?.allowCompanyAllTaskEdit === true ||
  req.body?.allowCompanyAllTaskEdit === 'true' ||
  req.headers?.['x-company-all-task-edit'] === 'true'
);

const isSameCompanyTaskRequest = (req, task) => {
  const requesterCompany = normalizeCodeBase(getRequestCompanyCode(req));
  const taskCompany = normalizeCodeBase(task?.companyCode);
  return Boolean(requesterCompany && taskCompany && requesterCompany === taskCompany);
};

const canManageTaskFromCompanyAll = (req, task) => (
  isCompanyAllTaskEdit(req) && isSameCompanyTaskRequest(req, task)
);

const parseTaskCheckpoints = value => {
  if (!value || value === 'null') return [];
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
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

const groupTasksByDate = (tasks, dateField = 'createdAt', serialKey = 'serialNo') => {
  const grouped = {};

  tasks.forEach(task => {
    let dateValue = task[dateField] || task.createdAt;
    if (dateField === 'source-aware') {
      const source = String(task.__taskSource || task.taskSource || '').toLowerCase();
      if (source === 'client') {
        dateValue = task.dueDate || task.dueDateTime || task.createdAt;
      } else if (source === 'project') {
        dateValue = task.lastActivityAt || task.updatedAt || task.createdAt;
      } else {
        dateValue = task.dueDateTime || task.dueDate || task.createdAt;
      }
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
  const dateValue = task?.createdAt || task?.createdDate || task?.updatedAt || task?.dueDateTime || task?.dueDate;
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
      isOverdue: isTaskOverdueForStatus(t.dueDate, status, t)
    };
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
        checkpoints: task.checkpoints || [],
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
        isOverdue: isTaskOverdueForStatus(task.dueDate, status, task)
      });
    });
  });

  return tasks;
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
        const taskOverdue = isTaskOverdueForStatus(t.dueDateTime || t.dueDate, t.status || t.overallStatus, t);
        if (!taskOverdue && normalizeTaskStatus(t.status) !== 'overdue') return false;
      } else if (normalizeTaskStatus(t.status) !== requestedStatus) {
        return false;
      }
    }
    if (priority && priority !== 'all' && String(t.priority || '').toLowerCase() !== String(priority).toLowerCase()) return false;
    if (overdue && overdue !== 'all') {
      const taskOverdue = isTaskOverdueForStatus(t.dueDateTime || t.dueDate, t.status || t.overallStatus, t);
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

 

exports.getPersonalTasks = async (req, res) => {
  try {
    const list = await fetchPersonalTaskList(req);
    return sendCleanTaskList(res, applyCleanListFilters(list, req), 'personal', 'createdAt');
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAssignedToMeTasks = async (req, res) => {
  try {
    const list = await fetchAssignedToMeTaskList(req);
    return sendCleanTaskList(res, applyCleanListFilters(list, req), 'assigned', 'createdAt');
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAssignedProjectTasks = async (req, res) => {
  try {
    const list = await fetchAssignedProjectTaskList(req);
    return sendCleanTaskList(res, applyCleanListFilters(list, req), 'project', 'createdAt');
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAllMyTaskViews = async (req, res) => {
  try {
    const [personal, assigned, client, project] = await Promise.all([
      fetchPersonalTaskList(req),
      fetchAssignedToMeTaskList(req),
      fetchAssignedClientTaskList(req),
      fetchAssignedProjectTaskList(req)
    ]);
    const list = applyCleanListFilters([...personal, ...assigned, ...client, ...project], req);
    return sendCleanTaskList(res, list, 'all', 'createdAt', req);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getPersonalTaskStats = async (req, res) => {
  try {
    const list = applyCleanListFilters(await fetchPersonalTaskList(req), req);
    return res.json({ success: true, view: 'personal', stats: calculateUnifiedTaskStats(list) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAssignedToMeTaskStats = async (req, res) => {
  try {
    const list = applyCleanListFilters(await fetchAssignedToMeTaskList(req), req);
    return res.json({ success: true, view: 'assigned', stats: calculateUnifiedTaskStats(list) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAllMyTaskStats = async (req, res) => {
  try {
    const [personal, assigned, client, project] = await Promise.all([
      fetchPersonalTaskList(req),
      fetchAssignedToMeTaskList(req),
      fetchAssignedClientTaskList(req),
      fetchAssignedProjectTaskList(req)
    ]);
    const list = applyCleanListFilters([...personal, ...assigned, ...client, ...project], req);
    return res.json({ success: true, view: 'all', stats: calculateUnifiedTaskStats(list) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getTasks = async (req, res) => {
  try {
    const [personal, assigned] = await Promise.all([
      fetchPersonalTaskList(req),
      fetchAssignedToMeTaskList(req)
    ]);
    const list = applyCleanListFilters([...personal, ...assigned], req);
    return sendCleanTaskList(res, list, 'tasks', 'createdAt', req);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getMyTasks = async (req, res) => {
  try {
    const list = await fetchAssignedToMeTaskList(req);
    const filtered = applyCleanListFilters(list, req);
    return sendCleanTaskList(res, filtered, 'my', 'createdAt', req);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAssignedTasks = async (req, res) => {
  try {
    const currentUserId = req.user._id || req.user.id;
    const tasks = await Task.find({
      companyCode: req.user.companyCode,
      createdBy: currentUserId,
      taskFor: 'others',
      isActive: true
    }).populate('assignedUsers', 'name role email').populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();

    const enriched = await enrichStatusInfo(tasks);
    const mapped = enriched.map(t => ({ ...t, status: normalizeTaskStatus(t.overallStatus) }));
    const filtered = sortTasksNewestFirst(applyCleanListFilters(mapped, req));
    const paginated = paginateTasks(filtered, req);

    return res.json({
      success: true,
      tasks: paginated.tasks,
      groupedTasks: groupTasksByDate(paginated.tasks, 'createdAt', 'assignedSerialNo'),
      total: paginated.total,
      pagination: paginated
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const handleTaskCreation = async (req, res, isSelf) => {
  const { title, description, dueDateTime, whatsappNumber, priorityDays, priority, assignedUsers, assignedGroups, checkpoints } = req.body;
  const companyCode = getRequestCompanyCode(req);
  
  if (!companyCode) {
    return res.status(400).json({ success: false, error: 'Company code is missing. Please login again.' });
  }

  let parsedUsers = isSelf ? [req.user._id.toString()] : [];
  if (!isSelf && assignedUsers && assignedUsers !== 'null') {
    parsedUsers = typeof assignedUsers === 'string' ? JSON.parse(assignedUsers) : assignedUsers;
  }

  const parsedGroups = !isSelf && assignedGroups && assignedGroups !== 'null' ? 
    (typeof assignedGroups === 'string' ? JSON.parse(assignedGroups) : assignedGroups) : [];

  const files = (req.files?.files || []).map(f => ({ filename: f.filename, originalName: f.originalname, path: f.path, uploadedBy: req.user._id }));
  const voiceNote = req.files?.voiceNote?.[0] ? { filename: req.files.voiceNote[0].filename, originalName: req.files.voiceNote[0].originalname, path: req.files.voiceNote[0].path, uploadedBy: req.user._id } : null;

  let parsedDue = null;
  if (dueDateTime) {
    parsedDue = new Date(dueDateTime);
    if (isNaN(parsedDue.getTime())) return res.status(400).json({ success: false, error: 'Invalid due date format' });
  }

  const statusByUser = parsedUsers.map(uid => ({ user: uid, status: 'pending' }));
  const parsedCheckpoints = parseTaskCheckpoints(checkpoints);

  const task = await Task.create({
    title,
    description,
    dueDateTime: parsedDue,
    whatsappNumber,
    priorityDays,
    priority: priority || 'medium',
    companyCode,
    assignedUsers: parsedUsers,
    assignedGroups: parsedGroups,
    statusByUser,
    checkpoints: parsedCheckpoints,
    files,
    voiceNote,
    createdBy: req.user._id,
    taskFor: isSelf ? 'self' : 'others',
    statusHistory: [{ status: 'pending', changedBy: req.user._id, remarks: isSelf ? 'Self task created' : 'Task assigned to others' }]
  });

  await task.populate('assignedUsers', 'name role email');
  await task.populate('createdBy', 'name email');

  if (task.assignedUsers?.length > 0) {
    await sendTaskCreationEmail(task, task.assignedUsers);
    const targetUsers = task.assignedUsers.map(u => u._id.toString()).filter(id => id !== req.user._id.toString());
    await notifyDirectUsers({
      userIds: targetUsers,
      targetPath: '/ciisUser/task-management',
      type: 'task_assigned',
      title: 'New Task Assigned',
      message: `${req.user.name} assigned you task "${title}"`,
      data: { taskId: task._id, title, priority, dueDateTime: parsedDue },
      priority: priority || 'medium'
    });
  }

  await createActivityLog(req.user, isSelf ? 'self_task_created' : 'task_created_for_others', task._id, `Created task: ${title}`, null, task.toObject(), req);

  return res.status(201).json({ success: true, task, message: 'Task created successfully' });
};

exports.createTaskForSelf = (req, res) => handleTaskCreation(req, res, true);
exports.createTaskForOthers = (req, res) => handleTaskCreation(req, res, false);
exports.createTask = (req, res) => {
  const isSelf = !req.body.assignedUsers || JSON.parse(req.body.assignedUsers || '[]').length === 0;
  return handleTaskCreation(req, res, isSelf);
};

exports.updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    const allowCompanyAllEdit = canManageTaskFromCompanyAll(req, task);
    if (task.createdBy.toString() !== req.user._id.toString() && !allowCompanyAllEdit) return res.status(403).json({ success: false, error: 'Not authorized' });

    const hasStatusChangedFromPending = task.overallStatus !== 'pending' || task.statusByUser.some(s => s.status !== 'pending');
    if (hasStatusChangedFromPending && !allowCompanyAllEdit) {
      return res.status(400).json({ success: false, error: 'Task cannot be edited after its status has changed from pending' });
    }

    const oldTask = task.toObject();

    if (req.files?.files) {
      task.files.push(...req.files.files.map(f => ({ filename: f.filename, originalName: f.originalname, path: f.path, uploadedBy: req.user._id })));
    }
    if (req.files?.voiceNote?.[0]) {
      task.voiceNote = { filename: req.files.voiceNote[0].filename, originalName: req.files.voiceNote[0].originalname, path: req.files.voiceNote[0].path, uploadedBy: req.user._id };
    }

    const fields = ['title', 'description', 'dueDateTime', 'whatsappNumber', 'priorityDays', 'priority'];
    fields.forEach(f => {
      if (req.body[f] !== undefined && req.body[f] !== 'null') task[f] = req.body[f];
    });

    if (req.body.assignedUsers) {
      task.assignedUsers = typeof req.body.assignedUsers === 'string' ? JSON.parse(req.body.assignedUsers) : req.body.assignedUsers;
      task.statusByUser = task.assignedUsers.map(uid => ({ user: uid, status: 'pending' }));
    }
    if (req.body.checkpoints !== undefined) {
      task.checkpoints = parseTaskCheckpoints(req.body.checkpoints);
    }

    await task.save();
    await createActivityLog(req.user, 'task_updated', task._id, `Updated task details`, oldTask, task.toObject(), req);

    res.json({ success: true, message: 'Task updated successfully', task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (task.createdBy.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, error: 'Not authorized' });

    task.isActive = false;
    await task.save();

    await createActivityLog(req.user, 'task_deleted', taskId, `Deleted task: ${task.title}`, task.toObject(), null, req);
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, remarks } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const currentUserId = (req.user._id || req.user.id).toString();
    const userCompanyCode = getRequestCompanyCode(req);

    const isCreator = task.createdBy.toString() === currentUserId;
    const isAssigned = task.assignedUsers.some(uid => uid.toString() === currentUserId);

    
    const userGroups = await Group.find({ members: req.user._id, isActive: true }).select('_id').lean();
    const groupIds = userGroups.map(g => g._id.toString());
    const isGroupAssigned = task.assignedGroups?.some(gid => groupIds.includes(gid.toString()));

    
    const isSameCompany = task.companyCode && userCompanyCode && 
      task.companyCode.toUpperCase() === userCompanyCode.toUpperCase();
    const allowCompanyAllEdit = canManageTaskFromCompanyAll(req, task);

    if (!isCreator && !isAssigned && !isGroupAssigned && !isSameCompany && !allowCompanyAllEdit) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const oldStatusEntry = task.statusByUser.find(s => s.user?.toString() === currentUserId);
    const oldStatus = oldStatusEntry?.status || task.overallStatus || 'pending';
    const normalizedStatus = normalizeTaskStatus(status);

    if (isOnHoldStatus(oldStatus) && !canChangeFromOnHold(normalizedStatus) && !allowCompanyAllEdit) {
      return res.status(400).json({
        success: false,
        error: 'On hold tasks can only be changed to in-progress or completed'
      });
    }

    if (
      normalizedStatus !== 'overdue' &&
      normalizeTaskStatus(oldStatus) === 'overdue' &&
      !allowCompanyAllEdit
    ) {
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

    if (
      !['overdue', 'onhold'].includes(normalizedStatus) &&
      isTaskOverdueForStatus(task.dueDateTime || task.dueDate, oldStatus, task) &&
      !allowCompanyAllEdit
    ) {
      if (!['onhold', 'completed', 'approved', 'rejected', 'cancelled', 'overdue'].includes(normalizeTaskStatus(oldStatus))) {
        task.markUserStatusOverdue(currentUserId, 'Automatically marked overdue after due time passed');
        await task.save();
      }
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

    if (oldStatus === 'completed' && status !== 'completed' && status !== 'reopen' && !allowCompanyAllEdit) {
      return res.status(400).json({ success: false, error: 'Completed tasks can only be reopened.' });
    }
    if (oldStatus === 'reopen' && status !== 'reopen' && status !== 'completed' && !allowCompanyAllEdit) {
      return res.status(400).json({ success: false, error: 'Reopened tasks can only be completed.' });
    }

    const updateUserStatusInList = (targetUserId, newStatus, userRemarks) => {
      const idx = task.statusByUser.findIndex(s => s.user?.toString() === targetUserId.toString());
      if (idx === -1) {
        task.statusByUser.push({ user: targetUserId, status: newStatus, updatedAt: new Date(), remarks: userRemarks });
      } else {
        task.statusByUser[idx].status = newStatus;
        task.statusByUser[idx].updatedAt = new Date();
        if (userRemarks) task.statusByUser[idx].remarks = userRemarks;
      }
    };

    if (task.taskFor === 'self') {
      const targetUserId = task.createdBy.toString();
      updateUserStatusInList(targetUserId, status, remarks);
      task.overallStatus = status;
      if (isOnHoldStatus(oldStatus) && normalizedStatus === 'in-progress') {
        task.onHoldReleasedAt = new Date();
      } else if (normalizedStatus === 'onhold') {
        task.onHoldReleasedAt = null;
      }
      if (status === 'completed') {
        task.completionDate = new Date();
      } else {
        task.completionDate = null;
      }
    } else {
      const isUpdaterAssignee = isAssigned || isGroupAssigned;
      if (isUpdaterAssignee) {
        updateUserStatusInList(currentUserId, status, remarks);

        if (status === 'completed') {
          let allCompleted = true;
          if (task.assignedUsers && task.assignedUsers.length > 0) {
            for (const uid of task.assignedUsers) {
              const entry = task.statusByUser.find(s => s.user?.toString() === uid.toString());
              if (!entry || !['completed', 'approved', 'cancelled'].includes(entry.status)) {
                allCompleted = false;
                break;
              }
            }
          }
          if (allCompleted) {
            task.overallStatus = 'completed';
            task.completionDate = new Date();
          } else if (['pending', 'overdue'].includes(task.overallStatus)) {
            task.overallStatus = 'in-progress';
          }
        } else if (status === 'in-progress') {
          if (['pending', 'overdue'].includes(task.overallStatus)) {
            task.overallStatus = 'in-progress';
          }
        } else {
          if (isCreator) {
            task.overallStatus = status;
            if (status === 'completed') task.completionDate = new Date();
          }
        }
      } else {
        task.overallStatus = status;
        if (status === 'completed') {
          task.completionDate = new Date();
        } else {
          task.completionDate = null;
        }

        const targetStatus = status === 'reopen' ? 'pending' : status;
        if (task.assignedUsers && task.assignedUsers.length > 0) {
          task.assignedUsers.forEach(uid => {
            updateUserStatusInList(uid, targetStatus, remarks || 'Updated by administrator');
          });
        }
        task.statusByUser.forEach(s => {
          s.status = targetStatus;
          s.updatedAt = new Date();
          if (remarks) s.remarks = remarks;
        });
      }
    }

    task.statusHistory.push({ status, changedBy: req.user._id, remarks: remarks || `Status changed from ${oldStatus} to ${status}` });

    await task.save();
    await task.populate('createdBy', 'name email');
    const updatedUser = await User.findById(req.user._id).select('name role email');

    if (!isCreator) {
      await createNotification(task.createdBy._id, 'Task Status Updated', `${updatedUser.name} updated task status to ${status}`, 'status_updated', task._id);
    }

    await createActivityLog(req.user, 'status_updated', task._id, `Updated task status to ${status}`, { status: oldStatus }, { status, remarks }, req);
    res.json({ success: true, message: 'Status updated successfully', data: { taskId, newStatus: status, overallStatus: task.overallStatus } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.addRemark = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { text } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    let imgPath = null;
    if (req.file) {
      const uploadDir = path.join(__dirname, '../../uploads/remarks');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filename = `remark_${Date.now()}_${req.user._id}.jpg`;
      const savePath = path.join(uploadDir, filename);
      imgPath = `remarks/${filename}`;

      await sharp(req.file.buffer).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(savePath);
    }

    const remark = { user: req.user._id, text: text || '', image: imgPath, createdAt: new Date() };
    task.remarks.push(remark);
    await task.save();

    await task.populate('remarks.user', 'name role email avatar');
    res.json({ success: true, message: 'Remark added successfully', remark: task.remarks[task.remarks.length - 1] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getRemarks = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId).populate('remarks.user', 'name role email avatar').select('remarks');
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, remarks: task.remarks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const ownerFilter = {$or: [{recipient: req.user._id}, {user: req.user._id}]};
    const filter = {...ownerFilter};
    if (req.query.unreadOnly === 'true') filter.isRead = false;
    
    
    
    const notifications = await Notification.find(filter).sort({ createdAt: -1 }).lean();
    const unreadCount = await Notification.countDocuments({...ownerFilter, isRead: false});
    res.json({ success: true, notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.markNotificationAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {_id: req.params.notificationId, $or: [{recipient: req.user._id}, {user: req.user._id}]},
      {isRead: true, readAt: new Date()},
      {new: true}
    );
    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.markAllNotificationsAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {$or: [{recipient: req.user._id}, {user: req.user._id}], isRead: false},
      {isRead: true, readAt: new Date()}
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getTaskActivityLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find({ task: req.params.taskId }).populate('user', 'name role email').sort({ createdAt: -1 }).lean();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUserActivityTimeline = async (req, res) => {
  try {
    const logs = await ActivityLog.find({ user: req.params.userId }).populate('task', 'title').populate('user', 'name role email').sort({ createdAt: -1 }).lean();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getAssignableUsers = async (req, res) => {
  try {
    const companyId = req.user.company?._id || req.user.company || req.user.companyId;
    const companyCode = req.user.companyCode || req.user.company?.companyCode;
    const userCompanyFilters = [];
    if (companyId) userCompanyFilters.push({company: companyId});
    if (companyCode) userCompanyFilters.push({companyCode});
    const userCompanyQuery = userCompanyFilters.length > 1 ? {$or: userCompanyFilters} : userCompanyFilters[0] || {};

    const users = await User.find({ isActive: true, _id: { $ne: req.user._id }, ...userCompanyQuery }).select('_id name email role jobRole company companyCode').lean();
    const companyUserIds = users.map(user => user._id);
    const groupCompanyFilters = [];
    if (companyId) groupCompanyFilters.push({company: companyId});
    if (companyCode) groupCompanyFilters.push({companyCode});
    if (companyUserIds.length) {
      groupCompanyFilters.push({
        company: {$exists: false},
        companyCode: {$exists: false},
        $or: [
          {createdBy: {$in: companyUserIds}},
          {members: {$in: companyUserIds}},
        ],
      });
    }
    const groupCompanyQuery = groupCompanyFilters.length ? {$or: groupCompanyFilters} : {};

    const groups = await Group.find({ isActive: true, ...groupCompanyQuery }).populate('members', 'name role email company companyCode').select('name description members company companyCode').lean();
    res.json({ success: true, users, groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getTaskStatusCounts = async (req, res) => {
  try {
    const [personal, assigned, project] = await Promise.all([
      fetchPersonalTaskList(req),
      fetchAssignedToMeTaskList(req),
      fetchAssignedProjectTaskList(req)
    ]);
    const list = applyCleanListFilters([...personal, ...assigned, ...project], req);
    res.json({ success: true, statistics: calculateUnifiedTaskStats(list) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUserDetailedAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = 'all' } = req.query;
    const dateRange = getCleanTaskDateRange({ period });

    const targetUser = await User.findById(userId).select('name email role employeeType joiningDate').lean();
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

    const groups = await Group.find({ members: userId, isActive: true }).select('_id').lean();
    const groupIds = groups.map(g => g._id);

    const filter = {
      isActive: true,
      companyCode: req.user.companyCode,
      $or: [{ assignedUsers: userId }, { assignedGroups: { $in: groupIds } }, { createdBy: userId }]
    };
    if (dateRange) filter.createdAt = dateRange;

    const tasks = await Task.find(filter).populate('assignedUsers', 'name role email').populate('createdBy', 'name role email').sort({ createdAt: -1 }).lean();

    const recentTasks = tasks.slice(0, 10).map(t => ({
      _id: t._id,
      title: t.title,
      type: t.createdBy?._id.toString() === userId ? 'created' : 'assigned',
      status: t.statusByUser?.find(s => s.user?.toString() === userId)?.status || 'pending',
      priority: t.priority,
      dueDate: t.dueDateTime,
      createdAt: t.createdAt
    }));

    res.json({
      success: true,
      userAnalytics: {
        userInfo: targetUser,
        summary: {
          totalInvolved: tasks.length,
          assigned: tasks.filter(t => t.assignedUsers?.some(u => u._id.toString() === userId)).length,
          created: tasks.filter(t => t.createdBy?._id.toString() === userId).length,
          groupTasks: tasks.filter(t => t.assignedGroups?.length > 0).length
        },
        statusAnalysis: calculateUnifiedTaskStats(tasks, userId),
        recentTasks
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

const queryAllUserTasks = async (userId, companyCode, queryOptions = {}) => {
  const groups = await Group.find({ members: userId, isActive: true }).select('_id').lean();
  const groupIds = groups.map(g => g._id);

  
  const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
  const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;
  const range = getCleanTaskDateRange({
    period: queryOptions.fromDate || queryOptions.toDate ? 'all' : queryOptions.period,
    fromDate: queryOptions.fromDate,
    toDate: queryOptions.toDate
  });
  const priority = queryOptions.priority && queryOptions.priority !== 'all'
    ? String(queryOptions.priority).toLowerCase()
    : '';
  const search = String(queryOptions.search || '').trim();
  const dateOr = range ? [
    { dueDateTime: range },
    { dueDate: range },
    { createdAt: range },
    { updatedAt: range }
  ] : null;

  const personalQuery = {
    isActive: true,
    companyCode: companyFilter,
    $or: [{ assignedUsers: userId }, { assignedGroups: { $in: groupIds } }, { createdBy: userId }]
  };
  if (dateOr) personalQuery.$and = [{ $or: dateOr }];
  if (priority) personalQuery.priority = new RegExp(`^${priority}$`, 'i');
  if (search) {
    personalQuery.$and = [
      ...(personalQuery.$and || []),
      { $or: [{ title: new RegExp(search, 'i') }, { description: new RegExp(search, 'i') }] }
    ];
  }

  const clientQuery = {
    $or: [
      { assigneeId: userId },
      { assignee: userId.toString() }
    ]
  };
  if (range) clientQuery.$and = [{ $or: [{ dueDate: range }, { createdAt: range }, { updatedAt: range }] }];
  if (priority) clientQuery.priority = new RegExp(`^${priority}$`, 'i');
  if (search) {
    clientQuery.$and = [
      ...(clientQuery.$and || []),
      { $or: [{ name: new RegExp(search, 'i') }, { description: new RegExp(search, 'i') }] }
    ];
  }

  const projectTaskElemMatch = { assignedTo: userId };
  if (range) {
    projectTaskElemMatch.$or = [
      { dueDate: range },
      { createdAt: range },
      { updatedAt: range }
    ];
  }
  if (priority) projectTaskElemMatch.priority = new RegExp(`^${priority}$`, 'i');

  const [personalTasks, clientTasks, projectTasks] = await Promise.all([
    Task.find(personalQuery)
      .select('title description dueDate dueDateTime priority priorityDays checkpoints overallStatus statusByUser statusHistory assignedUsers assignedGroups createdBy companyCode taskFor onHoldReleasedAt createdAt updatedAt')
      .populate('assignedUsers', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean(),
    
    ClientTask.find(clientQuery)
      .select('name description dueDate priority status completed checkpoints service timeSpent inProgressSince activityLogs clientId createdAt updatedAt assignee assigneeId')
      .populate('clientId', 'client name email company phone companyCode')
      .populate('assigneeId', 'name email role')
      .sort({ createdAt: -1 })
      .lean(),

    Project.find({ tasks: { $elemMatch: projectTaskElemMatch } })
      .select('projectName description createdBy tasks createdAt updatedAt')
      .populate('createdBy', 'name email')
      .populate('tasks.assignedTo', 'name email')
      .populate('tasks.createdBy', 'name email')
      .populate('tasks.activityLogs.performedBy', 'name email')
      .lean()
  ]);

  const personalFormatted = personalTasks.map(t => {
    const userStatus = normalizeTaskStatus(
      t.statusByUser?.find(item => item.user?.toString() === userId.toString())?.status || t.overallStatus || 'pending'
    );
    const createdById = (t.createdBy?._id || t.createdBy)?.toString();
    const taskSource = createdById === userId.toString() ? 'self' : 'assigned';
    const displayStatus = userStatus;

    return {
      ...t,
      title: t.title || 'Untitled Task',
      description: t.description || '',
      dueDate: t.dueDateTime || t.dueDate,
      dueDateTime: t.dueDateTime || t.dueDate,
      priority: String(t.priority || 'Medium').toLowerCase(),
      status: displayStatus,
      userStatus,
      source: taskSource,
      taskSource,
      __taskSource: taskSource
    };
  });

  const clientFormatted = clientTasks.map(t => {
    const clientStatus = t.completed ? 'completed' : normalizeTaskStatus(t.status || 'pending');
    const displayStatus = clientStatus;

    return {
      _id: t._id,
      title: t.name || 'Untitled Task',
      description: t.description || t.name || '',
      dueDate: t.dueDate,
      dueDateTime: t.dueDate,
      completed: t.completed,
      checkpoints: t.checkpoints || [],
      priority: String(t.priority || 'Medium').toLowerCase(),
      status: displayStatus,
      userStatus: clientStatus,
      clientName: t.clientId?.client || t.clientId?.name || 'Unknown Client',
      createdAt: t.createdAt,
      service: t.service || '',
      assignee: t.assignee || '',
      assigneeId: t.assigneeId,
      assigneeName: t.assigneeId?.name || t.assignee || 'Unassigned',
      timeSpent: t.timeSpent || 0,
      inProgressSince: t.inProgressSince || null,
      activityLogs: t.activityLogs || [],
      source: 'client',
      taskSource: 'client',
      __taskSource: 'client'
    };
  });

  const projectFormatted = [];
  projectTasks.forEach(project => {
    (project.tasks || []).forEach(task => {
      const assignedTo = task.assignedTo?._id || task.assignedTo;
      const targetUserId = userId.toString();
      const isAssignedToUser = assignedTo?.toString() === targetUserId;
      if (!isAssignedToUser) return;

      const projectStatus = normalizeProjectTaskStatus(task.status);
      const displayStatus = projectStatus;
      const assignedBy = getProjectTaskAssignedBy(task, project);

      projectFormatted.push({
        _id: task._id,
        projectId: project._id,
        title: task.title || 'Untitled Project Task',
        description: task.description || project.description || '',
        dueDate: task.dueDate,
        dueDateTime: task.dueDate,
        priority: String(task.priority || 'medium').toLowerCase(),
        status: displayStatus,
        userStatus: projectStatus,
        projectName: project.projectName,
        projectTaskId: task._id,
        createdBy: assignedBy,
        assignedTo: task.assignedTo,
        assignedBy,
        assignedByName: assignedBy?.name || assignedBy?.email || 'Unknown',
        assignedToName: task.assignedTo?.name || 'Unknown',
        assignedToEmail: task.assignedTo?.email || '',
        checkpoints: task.checkpoints || [],
        files: task.pdfFile?.path ? [{
          filename: task.pdfFile.filename,
          originalName: task.pdfFile.filename,
          path: task.pdfFile.path
        }] : [],
        remarks: task.remarks || [],
        activityLogs: task.activityLogs || [],
        createdAt: task.createdAt || project.createdAt,
        updatedAt: task.updatedAt || project.updatedAt,
        lastActivityAt: task.updatedAt || task.createdAt || project.updatedAt || project.createdAt,
        source: 'project',
        taskSource: 'project',
        __taskSource: 'project'
      });
    });
  });

  return [...personalFormatted, ...clientFormatted, ...projectFormatted];
};

const filterUserTasks = (tasks, query) => {
  const { period, search, status, priority, fromDate, toDate } = query;
  const range = getCleanTaskDateRange({ period: fromDate || toDate ? 'all' : period, fromDate, toDate });

  return tasks.filter(t => {
    
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      const textToSearch = [
        t.title,
        t.description,
        t.clientName,
        t.projectName,
        t._id?.toString()
      ].map(v => String(v || '').toLowerCase()).join(' ');

      if (!textToSearch.includes(q)) return false;
    }

    
    if (status && status !== 'all') {
      const queryStatus = normalizeTaskStatus(status);
      if (queryStatus === 'overdue') {
        const isOverdue = isTaskOverdueForStatus(t.dueDateTime || t.dueDate, t.userStatus, t);
        if (!isOverdue && t.status !== 'overdue') return false;
      } else {
        if (normalizeTaskStatus(t.status) !== queryStatus && normalizeTaskStatus(t.userStatus) !== queryStatus) {
          return false;
        }
      }
    }

    
    if (priority && priority !== 'all') {
      if (t.priority !== priority.toLowerCase()) return false;
    }

    
    if (range) {
      const dateToFilter = t.dueDateTime || t.dueDate || t.createdAt;
      const taskDate = dateToFilter ? new Date(dateToFilter) : null;
      if (!taskDate || Number.isNaN(taskDate.getTime())) return false;

      if (range.$gte && taskDate < range.$gte) return false;
      if (range.$lte && taskDate > range.$lte) return false;
    }

    return true;
  });
};

exports.getUserTaskStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const allTasks = await queryAllUserTasks(userId, req.user.companyCode, req.query);
    const filtered = filterUserTasks(allTasks, req.query);

    const counts = {
      total: filtered.length,
      pending: 0,
      'in-progress': 0,
      completed: 0,
      overdue: 0,
      onhold: 0
    };

    filtered.forEach(task => {
      const status = task.status;
      if (counts[status] !== undefined) {
        counts[status] += 1;
      } else if (status === 'pending') {
        counts.pending += 1;
      }
    });

    const total = filtered.length;
    const toStat = (count) => ({
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    });

    const statusCounts = {
      total: total,
      pending: toStat(counts.pending),
      inProgress: toStat(counts['in-progress']),
      completed: toStat(counts.completed),
      overdue: toStat(counts.overdue),
      onhold: toStat(counts.onhold)
    };

    res.json({ success: true, userId, statusCounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUsersWithTaskCounts = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id).lean();
    const users = await User.find({ isActive: true, company: currentUser.company }).select('name email role employeeType company companyCode').lean();

    
    const companyCode = req.user.companyCode;
    const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
    const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

    const usersWithCounts = await Promise.all(
      users.map(async (u) => {
        const groups = await Group.find({ members: u._id, isActive: true }).select('_id').lean();
        const groupIds = groups.map(g => g._id);

        const tasks = await Task.find({
          isActive: true,
          companyCode: companyFilter,
          $or: [{ assignedUsers: u._id }, { assignedGroups: { $in: groupIds } }, { createdBy: u._id }]
        }).lean();

        const stats = calculateUnifiedTaskStats(tasks, u._id);

        return {
          ...u,
          taskStats: {
            total: stats.total,
            pending: stats.pending.count,
            inProgress: stats.inProgress.count,
            completed: stats.completed.count,
            completionRate: stats.completed.percentage
          }
        };
      })
    );

    res.json({
      success: true,
      users: usersWithCounts,
      summary: {
        totalUsers: usersWithCounts.length,
        totalTasks: usersWithCounts.reduce((sum, item) => sum + item.taskStats.total, 0),
        averageCompletionRate: Math.round(usersWithCounts.reduce((sum, item) => sum + item.taskStats.completionRate, 0) / Math.max(usersWithCounts.length, 1))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getDepartmentUsersWithTaskCounts = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id).lean();
    const users = await User.find({ isActive: true, company: currentUser.company, department: currentUser.department }).select('name email role employeeType company department companyCode').lean();

    
    const companyCode = req.user.companyCode;
    const baseCode = typeof companyCode === 'string' ? companyCode.split('-')[0].trim() : '';
    const companyFilter = baseCode ? { $regex: new RegExp('^' + baseCode + '(-|$)', 'i') } : companyCode;

    const usersWithCounts = await Promise.all(
      users.map(async (u) => {
        const groups = await Group.find({ members: u._id, isActive: true }).select('_id').lean();
        const groupIds = groups.map(g => g._id);

        const tasks = await Task.find({
          isActive: true,
          companyCode: companyFilter,
          $or: [{ assignedUsers: u._id }, { assignedGroups: { $in: groupIds } }, { createdBy: u._id }]
        }).lean();

        const stats = calculateUnifiedTaskStats(tasks, u._id);

        return {
          ...u,
          taskStats: {
            total: stats.total,
            pending: stats.pending.count,
            inProgress: stats.inProgress.count,
            completed: stats.completed.count,
            completionRate: stats.completed.percentage
          }
        };
      })
    );

    res.json({ success: true, users: usersWithCounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUserTasks = async (req, res) => {
  try {
    const { userId } = req.params;
    const groups = await Group.find({ members: userId, isActive: true }).select('_id').lean();
    const groupIds = groups.map(g => g._id);

    const tasks = await Task.find({
      isActive: true,
      $or: [{ assignedUsers: userId }, { assignedGroups: { $in: groupIds } }, { createdBy: userId }]
    }).populate('assignedUsers', 'name email').populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();

    const enhanced = tasks.map(t => {
      const userStatus = t.statusByUser?.find(s => s.user?.toString() === userId);
      return {
        ...t,
        userStatus: userStatus?.status || 'pending',
        userStatusRemarks: userStatus?.remarks,
        userStatusUpdatedAt: userStatus?.updatedAt
      };
    });

    res.json({ success: true, userId, tasks: enhanced, total: enhanced.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUserAllTasksPaginated = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 10, 50);

    const allTasks = await queryAllUserTasks(userId, req.user.companyCode, req.query);
    const filtered = filterUserTasks(allTasks, req.query);
    const workWindow = await getUserWorkWindow(userId, req.query);
    const filteredWithWorkTime = filtered.map(task => {
      const work = calculateTaskWork(task, workWindow);
      return {
        ...task,
        workTime: {
          seconds: work.seconds,
          label: secondsToDurationLabel(work.seconds)
        },
        __workInterval: work.interval
      };
    });

    
    
    const sortedFiltered = sortTasksNewestFirst(filteredWithWorkTime);

    
    const total = sortedFiltered.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;
    const tasks = sortedFiltered.slice(start, start + limit);

    
    const counts = {
      total: total,
      pending: 0,
      'in-progress': 0,
      completed: 0,
      overdue: 0,
      onhold: 0
    };

    filteredWithWorkTime.forEach(task => {
      const status = task.status;
      if (counts[status] !== undefined) {
        counts[status] += 1;
      } else if (status === 'pending') {
        counts.pending += 1;
      }
    });

    const toStat = (count) => ({
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    });

    const calculatedStats = {
      total: total,
      pending: toStat(counts.pending),
      inProgress: toStat(counts['in-progress']),
      completed: toStat(counts.completed),
      overdue: toStat(counts.overdue),
      onhold: toStat(counts.onhold)
    };
    const trackedTaskSeconds = getMergedIntervalSeconds(filteredWithWorkTime.map(task => task.__workInterval));
    const untrackedSeconds = Math.max(0, (workWindow.summary.totalClockedSeconds || 0) - trackedTaskSeconds);
    const cleanTasks = tasks.map(({ __workInterval, ...task }) => task);

    res.json({
      success: true,
      userId,
      tasks: cleanTasks,
      workSummary: {
        ...workWindow.summary,
        trackedTaskSeconds,
        trackedTaskLabel: secondsToDurationLabel(trackedTaskSeconds),
        untrackedSeconds,
        untrackedLabel: secondsToDurationLabel(untrackedSeconds)
      },
      pagination: {
        page: safePage,
        limit,
        total,
        pages,
        hasNext: safePage * limit < total,
        hasPrev: safePage > 1
      },
      statusCounts: calculatedStats
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getOverdueTasks = async (req, res) => {
  try {
    const list = await fetchAssignedToMeTaskList(req);
    const overdue = list.filter(t => isTaskOverdueForStatus(t.dueDateTime, t.status, t));
    res.json({ success: true, overdueTasks: groupTasksByDate(overdue, 'dueDateTime', 'overdueSerialNo'), count: overdue.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUserOverdueTasks = async (req, res) => {
  try {
    const { userId } = req.params;
    const groups = await Group.find({ members: userId, isActive: true }).select('_id').lean();
    const groupIds = groups.map(g => g._id);

    const tasks = await Task.find({
      isActive: true,
      dueDateTime: { $lt: new Date() },
      $or: [{ assignedUsers: userId }, { assignedGroups: { $in: groupIds } }, { createdBy: userId }]
    }).populate('assignedUsers', 'name email').populate('createdBy', 'name email').sort({ dueDateTime: 1 }).lean();

    const overdueTasks = tasks.filter(t => {
      const userStatus = t.statusByUser?.find(item => item.user?.toString() === userId.toString())?.status || t.overallStatus || 'pending';
      return isTaskOverdueForStatus(t.dueDateTime || t.dueDate, userStatus, t);
    });

    res.json({ success: true, userId, overdueTasks: groupTasksByDate(overdueTasks, 'dueDateTime', 'overdueSerialNo'), count: overdueTasks.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.markTaskAsOverdue = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const userStatus = task.statusByUser?.find(
      item => item.user?.toString() === req.user._id.toString()
    )?.status;
    const currentStatus = normalizeTaskStatus(userStatus || task.overallStatus || 'pending');
    if (['onhold', 'completed', 'approved', 'rejected', 'cancelled'].includes(currentStatus)) {
      return res.status(400).json({ success: false, error: 'This task status cannot be marked as overdue' });
    }

    task.overallStatus = 'overdue';
    task.markedOverdueAt = new Date();
    task.statusHistory.push({ status: 'overdue', changedBy: req.user._id, remarks: 'Manually marked overdue' });
    await task.save();

    res.json({ success: true, message: 'Task marked as overdue successfully', task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateAllOverdueTasks = async (req, res) => {
  try {
    const result = await Task.updateAllOverdueTasks();
    res.json({ success: true, message: `Updated overdue tasks`, count: result.updated, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getOverdueSummary = async (req, res) => {
  try {
    const userId = req.params.userId || req.user._id;
    const groups = await Group.find({ members: userId, isActive: true }).select('_id').lean();
    const groupIds = groups.map(g => g._id);

    const tasks = await Task.find({
      isActive: true,
      dueDateTime: { $lt: new Date() },
      overallStatus: 'overdue',
      $or: [{ assignedUsers: userId }, { assignedGroups: { $in: groupIds } }, { createdBy: userId }]
    }).lean();

    res.json({
      success: true,
      userId,
      summary: {
        total: tasks.length,
        alreadyOverdue: tasks.length,
        potentialOverdue: 0,
        byPriority: {
          high: tasks.filter(t => t.priority === 'high').length,
          medium: tasks.filter(t => t.priority === 'medium').length,
          low: tasks.filter(t => t.priority === 'low').length
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.quickStatusUpdate = async (req, res) => {
  req.body.remarks = 'Quick status update';
  return exports.updateStatus(req, res);
};

exports.getTaskStatistics = exports.getTaskStatusCounts;

exports.snoozeTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { snoozeUntil } = req.body;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    task.snoozedUntil = new Date(snoozeUntil);
    task.isSnoozed = true;
    await task.save();

    res.json({ success: true, message: 'Task snoozed successfully', snoozedUntil: task.snoozedUntil });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.updateCreatorStatus = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;

    if (!['pending', 'completed'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status value. Must be pending or completed.' });
    }

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    if (task.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to change admin status' });
    }

    if (task.overallStatus === 'overdue') {
      return res.status(400).json({ success: false, error: 'Cannot change status of an overdue task' });
    }

    const oldCreatorStatus = (task.creatorStatus && typeof task.creatorStatus === 'object')
      ? task.creatorStatus.status
      : (typeof task.creatorStatus === 'string' ? task.creatorStatus : 'pending');
    task.creatorStatus = {
      status: status,
      updatedAt: new Date()
    };

    task.statusHistory.push({
      status: status,
      changedBy: req.user._id,
      remarks: `Admin status changed from ${oldCreatorStatus} to ${status}`
    });

    await task.save();

    res.json({
      success: true,
      message: 'Admin status updated successfully',
      task
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = exports;
void 0;
