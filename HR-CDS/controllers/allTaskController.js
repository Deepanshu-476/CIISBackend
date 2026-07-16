
const {
  Task,
  ClientTask,
  Client,
  Project,
  Group,
  User,
  parsePositiveInt,
  getCleanTaskDateRange,
  normalizeTaskStatus,
  isTaskOverdueForStatus,
  calculateUnifiedTaskStats,
  groupTasksByDate,
  sortTasksNewestFirst,
  paginateTasks,
  getRequestCompanyCode,
  applyCleanListFilters,
  sendCleanTaskList,
  normalizeProjectTaskStatus,
  getProjectTaskAssignedBy
} = require('./taskHelper');


const queryAllUserTasks = async (userId, companyCode, queryOptions = {}) => {
  const targetUser = await User.findById(userId).select('name email').lean();
  const targetUserId = userId.toString();
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
  const hasSearch = String(queryOptions.search || '').trim();
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
  if (hasSearch) {
    personalQuery.$and = [
      ...(personalQuery.$and || []),
      { $or: [{ title: new RegExp(hasSearch, 'i') }, { description: new RegExp(hasSearch, 'i') }] }
    ];
  }

  const clients = await Client.find(companyFilter ? { companyCode: companyFilter } : {}).select('_id').lean();
  const clientIds = clients.map(c => c._id);

  const clientQuery = {
    ...(companyFilter ? { clientId: { $in: clientIds } } : {}),
    $or: [
      { assigneeId: userId },
      { assignee: targetUserId },
      { assignee: targetUser?.name },
      { assignee: targetUser?.email }
    ].filter(condition => Object.values(condition)[0])
  };
  if (dateOr) clientQuery.$and = [{ $or: [{ dueDate: range }, { createdAt: range }, { updatedAt: range }] }];
  if (priority) clientQuery.priority = new RegExp(`^${priority}$`, 'i');
  if (hasSearch) {
    clientQuery.$and = [
      ...(clientQuery.$and || []),
      { $or: [{ name: new RegExp(hasSearch, 'i') }, { description: new RegExp(hasSearch, 'i') }] }
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

  const projectQuery = { tasks: { $elemMatch: projectTaskElemMatch } };

  const [personalTasks, clientTasks, projectTasks] = await Promise.all([
    Task.find(personalQuery)
      .select('title description dueDate dueDateTime priority overallStatus statusByUser assignedUsers assignedGroups createdBy companyCode taskFor onHoldReleasedAt createdAt updatedAt')
      .populate('assignedUsers', 'name email')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean(),
    
    ClientTask.find(clientQuery)
      .select('name description dueDate priority status completed clientId createdAt updatedAt assignee assigneeId')
      .populate('clientId', 'name email company phone companyCode')
      .sort({ createdAt: -1 })
      .lean(),

    Project.find(projectQuery)
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
    const isOverdue = isTaskOverdueForStatus(t.dueDateTime || t.dueDate, userStatus, t);
    const displayStatus = isOverdue ? 'overdue' : userStatus;

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
    const isOverdue = isTaskOverdueForStatus(t.dueDate, clientStatus, t);
    const displayStatus = isOverdue ? 'overdue' : clientStatus;

    return {
      _id: t._id,
      title: t.name || 'Untitled Task',
      description: t.description || t.name || '',
      dueDate: t.dueDate,
      dueDateTime: t.dueDate,
      completed: t.completed,
      priority: String(t.priority || 'Medium').toLowerCase(),
      status: displayStatus,
      userStatus: clientStatus,
      clientName: t.clientId?.name || 'Unknown Client',
      createdAt: t.createdAt,
      source: 'client',
      taskSource: 'client',
      __taskSource: 'client'
    };
  });

  const projectFormatted = [];
  projectTasks.forEach(project => {
    (project.tasks || []).forEach(task => {
      const assignedTo = task.assignedTo?._id || task.assignedTo;
      const isAssignedToUser = assignedTo?.toString() === targetUserId;
      if (!isAssignedToUser) return;

      const projectStatus = normalizeProjectTaskStatus(task.status);
      const isOverdue = isTaskOverdueForStatus(task.dueDate, projectStatus, task);
      const displayStatus = isOverdue ? 'overdue' : projectStatus;
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


const getFilterDate = (task, dateField) => {
  const normalizedField = String(dateField || '').toLowerCase();
  if (normalizedField === 'createdat' || normalizedField === 'createddate') return task.createdAt;
  if (normalizedField === 'updatedat' || normalizedField === 'updateddate') return task.updatedAt || task.createdAt;
  return task.dueDateTime || task.dueDate || task.createdAt;
};

const getFilterStatus = (task) => {
  const status = normalizeTaskStatus(task.userStatus || task.status || task.overallStatus || 'pending');
  return isTaskOverdueForStatus(task.dueDateTime || task.dueDate, status, task) ? 'overdue' : status;
};

const filterUserTasks = (tasks, queryParams) => {
  const { status, search, period, fromDate, toDate, priority, dateField } = queryParams;
  const range = getCleanTaskDateRange({ period: fromDate || toDate ? 'all' : period, fromDate, toDate });
  const query = search ? String(search).trim().toLowerCase() : '';

  return tasks.filter(t => {
    if (status && status !== 'all') {
      const requestedStatus = normalizeTaskStatus(status);
      if (getFilterStatus(t) !== requestedStatus) return false;
    }
    if (priority && priority !== 'all' && String(t.priority || '').toLowerCase() !== String(priority).toLowerCase()) {
      return false;
    }
    if (query) {
      const haystack = [t.title, t.description, t.clientName, t.projectName].map(v => String(v || '').toLowerCase()).join(' ');
      if (!haystack.includes(query)) return false;
    }
    if (range) {
      const sourceDate = getFilterDate(t, dateField);
      const dateVal = new Date(sourceDate);
      if (isNaN(dateVal.getTime())) return false;
      if (range.$gte && dateVal < range.$gte) return false;
      if (range.$lte && dateVal > range.$lte) return false;
    }
    return true;
  });
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
};

const calculateUserStatusCounts = (filtered) => {
  const counts = {
    total: filtered.length,
    pending: 0,
    'in-progress': 0,
    completed: 0,
    overdue: 0,
    rejected: 0,
    onhold: 0,
    reopen: 0,
    cancelled: 0
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

  return {
    total,
    pending: toStat(counts.pending),
    inProgress: toStat(counts['in-progress']),
    completed: toStat(counts.completed),
    overdue: toStat(counts.overdue),
    rejected: toStat(counts.rejected),
    onhold: toStat(counts.onhold),
    onHold: toStat(counts.onhold),
    reopen: toStat(counts.reopen),
    cancelled: toStat(counts.cancelled)
  };
};


exports.getAllMyTaskViews = async (req, res) => {
  try {
    const {
      fetchPersonalTaskList,
      fetchAssignedToMeTaskList,
      fetchAssignedClientTaskList,
      fetchAssignedProjectTaskList
    } = require('./taskHelper');

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


exports.getAllMyTaskStats = async (req, res) => {
  try {
    const {
      fetchPersonalTaskList,
      fetchAssignedToMeTaskList,
      fetchAssignedClientTaskList,
      fetchAssignedProjectTaskList
    } = require('./taskHelper');

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


exports.getUserAllTasksPaginated = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 10, 50);

    const allTasks = await queryAllUserTasks(userId, req.user.companyCode, req.query);
    const filtered = filterUserTasks(allTasks, req.query);

    const sortedFiltered = sortTasksNewestFirst(filtered);

    
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

    filtered.forEach(task => {
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

    res.json({
      success: true,
      userId,
      tasks,
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


exports.getUserTaskStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const allTasks = await queryAllUserTasks(userId, req.user.companyCode, req.query);
    const filtered = filterUserTasks(allTasks, req.query);

    const statusCounts = calculateUserStatusCounts(filtered);

    res.json({
      success: true,
      statusCounts
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getUsersTaskStatsBatch = async (req, res) => {
  try {
    const userIds = Array.isArray(req.body?.userIds)
      ? req.body.userIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];

    if (userIds.length === 0) {
      return res.json({ success: true, statsByUser: {} });
    }

    const queryParams = { ...req.query, ...(req.body?.filters || {}) };
    const entries = await mapWithConcurrency(userIds, 6, async (userId) => {
      try {
        const allTasks = await queryAllUserTasks(userId, req.user.companyCode, queryParams);
        const filtered = filterUserTasks(allTasks, queryParams);
        return [userId, calculateUserStatusCounts(filtered)];
      } catch (err) {
        return [userId, calculateUserStatusCounts([])];
      }
    });

    res.json({
      success: true,
      statsByUser: Object.fromEntries(entries)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getCompanyAllTaskOverview = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id || req.user._id).lean();
    if (!currentUser) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const rawRole = String(currentUser.companyRole || currentUser.role || currentUser.jobRole || '').toLowerCase();
    const isOwnerScope = ['owner', 'admin', 'super-admin', 'superadmin', 'hr'].includes(rawRole);
    const query = { isActive: true };

    if (currentUser.company) query.company = currentUser.company;
    else if (currentUser.companyCode) query.companyCode = currentUser.companyCode;

    if (!isOwnerScope && currentUser.department) {
      query.department = currentUser.department;
    }

    const users = await User.find(query)
      .select('name email role companyRole jobRole employeeType employeeId company department companyCode isActive createdAt')
      .sort({ name: 1 })
      .lean();

    const includeStats = String(req.query.includeStats || '').toLowerCase() === 'true';
    if (!includeStats) {
      return res.json({
        success: true,
        users,
        statsByUser: {},
        summary: {
          totalUsers: users.length,
          totalTasks: 0,
          statsDeferred: true,
        }
      });
    }

    const queryParams = {
      period: req.query.fromDate || req.query.toDate ? 'all' : (req.query.period || 'today'),
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      status: req.query.status || 'all',
      priority: req.query.priority || 'all',
      search: req.query.search || '',
    };

    const entries = await mapWithConcurrency(users, 6, async (user) => {
      const userId = String(user._id);
      try {
        const allTasks = await queryAllUserTasks(userId, req.user.companyCode || currentUser.companyCode, queryParams);
        const filtered = filterUserTasks(allTasks, queryParams);
        return [userId, calculateUserStatusCounts(filtered)];
      } catch {
        return [userId, calculateUserStatusCounts([])];
      }
    });

    const statsByUser = Object.fromEntries(entries);
    const usersWithStats = users.map(user => ({
      ...user,
      taskStats: statsByUser[String(user._id)]
    }));

    res.json({
      success: true,
      users: usersWithStats,
      statsByUser,
      summary: {
        totalUsers: usersWithStats.length,
        totalTasks: Object.values(statsByUser).reduce((sum, item) => sum + Number(item?.total || 0), 0),
      }
    });
  } catch (err) {
    console.error('Company all task overview error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
