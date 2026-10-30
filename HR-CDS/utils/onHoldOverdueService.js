const {
  DAY_MS, isOnHold, isFinished, validDate,
  indiaDateKey, inferHoldStart, evaluateHoldDeadline,
} = require('./onHoldDeadline');

const HOLD_STATUSES = ['onhold', 'on hold', 'on-hold'];
const SYSTEM_USER_ID = '000000000000000000000001';
const idOf = value => String(value?._id || value?.id || value || '');
const sameDate = (left, right) => (validDate(left)?.getTime() || 0) === (validDate(right)?.getTime() || 0);
const reason = 'On hold for at least 24 hours and employee present on the deadline day';

const taskHoldEntries = task => {
  if (isFinished(task.overallStatus) || task.overallStatus === 'overdue') return [];
  const states = task.statusByUser || [];
  const ids = task.taskFor === 'self'
    ? [idOf(task.createdBy)]
    : [...new Set([...(task.assignedUsers || []).map(idOf), ...states.map(item => idOf(item.user))])];
  return ids.filter(Boolean).flatMap(id => {
    const state = states.find(item => idOf(item.user) === id);
    if (isFinished(state?.status) || state?.status === 'overdue') return [];
    if (!isOnHold(task.overallStatus) && !isOnHold(state?.status)) return [];
    return [{id, state, clock: isOnHold(state?.status) && state.holdStartedAt ? state : task}];
  });
};

const planTaskUpdate = (task, presentByUser, now) => {
  const entries = taskHoldEntries(task);
  if (!entries.length) return null;
  const states = (task.statusByUser || []).map(item => ({...item}));
  const overdueUsers = [];
  const waiting = [];
  let changed = false;
  for (const {id, state, clock} of entries) {
    const startedAt = inferHoldStart(clock === task && !isOnHold(task.overallStatus) ? state : clock, now);
    const result = evaluateHoldDeadline({startedAt, checkAt: clock.holdOverdueCheckAt, now, presentDays: presentByUser.get(id) || new Set()});
    let target = states.find(item => idOf(item.user) === id);
    if (!target) { target = {user: id, status: 'onhold', updatedAt: now}; states.push(target); changed = true; }
    if (!sameDate(target.holdStartedAt, startedAt) || !sameDate(target.holdOverdueCheckAt, result.nextCheckAt)) changed = true;
    target.holdStartedAt = startedAt;
    target.holdOverdueCheckAt = result.nextCheckAt;
    if (result.overdue) {
      target.status = 'overdue'; target.updatedAt = now; target.remarks = reason;
      overdueUsers.push(id); changed = true;
    } else {
      waiting.push(result.nextCheckAt);
    }
  }
  if (!changed) return null;
  const responsibleUsers = task.taskFor === 'self' ? [idOf(task.createdBy)] : [...new Set([...(task.assignedUsers || []).map(idOf), ...states.map(item => idOf(item.user))])];
  const allOverdue = states.some(item => item.status === 'overdue') && responsibleUsers.filter(Boolean).every(id => {
    const state = states.find(item => idOf(item.user) === id);
    return state && (isFinished(state.status) || state.status === 'overdue');
  });
  const set = {statusByUser: states};
  if (isOnHold(task.overallStatus)) {
    set.holdStartedAt = inferHoldStart(task, now);
    set.holdOverdueCheckAt = waiting.length ? new Date(Math.min(...waiting.map(date => date.getTime()))) : task.holdOverdueCheckAt;
  }
  if (allOverdue) {
    set.overallStatus = 'overdue'; set.markedOverdueAt = now; set.overdueReason = reason;
  }
  const update = {$set: set};
  if (overdueUsers.length) update.$push = {statusHistory: {status: 'overdue', changedBy: SYSTEM_USER_ID, changedByType: 'system', changedAt: now, remarks: `${reason}. Employees: ${overdueUsers.join(', ')}`}};
  return {update, overdueUsers};
};

const planSingleTaskUpdate = (task, recipients, presentByUser, now) => {
  if (!isOnHold(task.status) || task.completed === true) return null;
  const startedAt = inferHoldStart(task, now);
  const days = new Set(recipients.flatMap(id => [...(presentByUser.get(id) || [])]));
  const result = evaluateHoldDeadline({startedAt, checkAt: task.holdOverdueCheckAt, now, presentDays: days});
  if (!result.overdue && sameDate(task.holdStartedAt, startedAt) && sameDate(task.holdOverdueCheckAt, result.nextCheckAt)) return null;
  return {startedAt, ...result};
};

const createOnHoldOverdueService = ({Task, ClientTask, Project, Attendance, notifyDirectUsers = async () => {}}) => {
  const dueCheck = now => ({$or: [{holdOverdueCheckAt: {$lte: now}}, {holdOverdueCheckAt: null}]});
  const attendanceFor = async (items, now) => {
    const ids = new Set();
    let earliest = Infinity;
    for (const {task, users} of items) {
      users.forEach(id => id && ids.add(id));
      const firstCheck = inferHoldStart(task, now).getTime() + DAY_MS;
      const nextCheck = validDate(task.holdOverdueCheckAt)?.getTime() || firstCheck;
      earliest = Math.min(earliest, Math.max(firstCheck, nextCheck));
    }
    if (!ids.size || earliest > now.getTime()) return new Map();
    // Include the complete India calendar date of the earliest deadline.
    const start = new Date(`${indiaDateKey(new Date(earliest))}T00:00:00+05:30`);
    const end = new Date(`${indiaDateKey(now)}T00:00:00+05:30`);
    end.setTime(end.getTime() + DAY_MS);
    const records = await Attendance.find({user: {$in: [...ids]}, date: {$gte: start, $lt: end}, inTime: {$ne: null}})
      .select('user date inTime status').lean();
    const result = new Map();
    for (const record of records) {
      if (!validDate(record.inTime) || !validDate(record.date) || String(record.status || '').trim().toLowerCase() === 'absent') continue;
      const id = idOf(record.user);
      if (!result.has(id)) result.set(id, new Set());
      result.get(id).add(indiaDateKey(record.date));
    }
    return result;
  };
  const notify = async (task, users) => {
    if (!users.length) return;
    try {
      await notifyDirectUsers({userIds: [...new Set(users)], targetPath: '/ciisUser/task-management', type: 'task_overdue', title: 'Task Marked as Overdue', message: `Task "${task.title || task.name}" is overdue after the 24-hour On Hold attendance check.`, data: {taskId: task._id, taskTitle: task.title || task.name}, priority: 'high'});
    } catch (error) {console.error('On hold overdue notification failed:', error.message);}
  };
  const batches = async (Model, filter, process) => {
    let after;
    while (true) {
      const rows = await Model.find(after ? {$and: [filter, {_id: {$gt: after}}]} : filter).sort({_id: 1}).limit(200).lean();
      if (!rows.length) break;
      await process(rows);
      after = rows[rows.length - 1]._id;
      if (rows.length < 200) break;
    }
  };
  return async (now = new Date()) => {
    let updated = 0;
    const taskFilter = {isActive: true, overallStatus: {$nin: ['completed', 'approved', 'rejected', 'cancelled', 'overdue']}, $or: [
      {$and: [{overallStatus: {$in: HOLD_STATUSES}}, dueCheck(now)]},
      {statusByUser: {$elemMatch: {status: {$in: HOLD_STATUSES}, ...dueCheck(now)}}},
    ]};
    await batches(Task, taskFilter, async rows => {
      const items = rows.flatMap(task => taskHoldEntries(task).map(entry => ({task: entry.clock === task && !isOnHold(task.overallStatus) ? entry.state : entry.clock, users: [entry.id]})));
      const present = await attendanceFor(items, now);
      for (const task of rows) {
        const plan = planTaskUpdate(task, present, now);
        if (!plan) continue;
        const result = await Task.updateOne({_id: task._id, updatedAt: task.updatedAt || {$exists: false}, overallStatus: task.overallStatus}, plan.update);
        if (result.modifiedCount) {updated += 1; await notify(task, plan.overdueUsers);}
      }
    });
    await batches(ClientTask, {completed: {$ne: true}, status: {$in: HOLD_STATUSES}, ...dueCheck(now)}, async rows => {
      const present = await attendanceFor(rows.map(task => ({task, users: [idOf(task.assigneeId)].filter(Boolean)})), now);
      for (const task of rows) {
        const users = [idOf(task.assigneeId)].filter(Boolean);
        const plan = planSingleTaskUpdate(task, users, present, now);
        if (!plan) continue;
        const set = {holdStartedAt: plan.startedAt, holdOverdueCheckAt: plan.nextCheckAt};
        const update = {$set: set};
        if (plan.overdue) {
          set.status = 'overdue';
          set.totalHoldSeconds = Number(task.totalHoldSeconds || 0) + Math.max(0, Math.floor((now - plan.startedAt) / 1000));
          update.$push = {activityLogs: {action: 'on_hold_task_overdue', userName: 'System', description: reason, oldValues: {status: task.status}, newValues: {status: 'overdue'}, createdAt: now}};
        }
        const result = await ClientTask.updateOne({_id: task._id, updatedAt: task.updatedAt || {$exists: false}, status: task.status, completed: {$ne: true}}, update);
        if (result.modifiedCount) {updated += 1; if (plan.overdue) await notify(task, users);}
      }
    });
    await batches(Project, {status: {$nin: ['completed', 'cancelled']}, tasks: {$elemMatch: {status: {$in: HOLD_STATUSES}, ...dueCheck(now)}}}, async rows => {
      const recipients = task => [...new Set([task.assignedTo, ...(task.assignedUsers || [])].map(idOf).filter(Boolean))];
      const items = rows.flatMap(project => (project.tasks || []).filter(task => isOnHold(task.status)).map(task => ({task, users: recipients(task)})));
      const present = await attendanceFor(items, now);
      for (const project of rows) {
        const tasks = (project.tasks || []).map(task => ({...task}));
        const notifications = [];
        let changed = false;
        for (const task of tasks) {
          const users = recipients(task);
          const plan = planSingleTaskUpdate(task, users, present, now);
          if (!plan) continue;
          task.holdStartedAt = plan.startedAt; task.holdOverdueCheckAt = plan.nextCheckAt; changed = true;
          if (plan.overdue) {
            task.status = 'overdue'; task.updatedAt = now;
            task.activityLogs = [...(task.activityLogs || []), {type: 'status_change', performedBy: SYSTEM_USER_ID, description: reason, oldValue: 'on hold', newValue: 'overdue', performedAt: now}];
            notifications.push({task, users});
          }
        }
        if (!changed) continue;
        const result = await Project.updateOne({_id: project._id, updatedAt: project.updatedAt || {$exists: false}}, {$set: {tasks}});
        if (result.modifiedCount) {
          updated += 1;
          for (const item of notifications) await notify(item.task, item.users);
        }
      }
    });
    return {updated};
  };
};

let run;
const syncOnHoldTaskOverdue = now => {
  if (!run) run = createOnHoldOverdueService({
    Task: require('../models/Task'), ClientTask: require('../models/ClientTask'), Project: require('../models/Project').Project, Attendance: require('../models/Attendance'),
    notifyDirectUsers: require('./systemNotificationService').notifyDirectUsers,
  });
  return run(now);
};
module.exports = {createOnHoldOverdueService, syncOnHoldTaskOverdue, taskHoldEntries, planTaskUpdate, planSingleTaskUpdate};
