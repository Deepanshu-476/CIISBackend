const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.NODE_ENV = 'test';

const { Types } = require('mongoose');
const Attendance = require('../HR-CDS/models/Attendance');
const Task = require('../HR-CDS/models/Task');
const Group = require('../HR-CDS/models/Group');
const ClientTask = require('../HR-CDS/models/ClientTask');
const Client = require('../HR-CDS/models/Client');
const { Project } = require('../HR-CDS/models/Project');
const ActivityLog = require('../HR-CDS/models/ActivityLog');
const User = require('../models/User');
const taskController = require('../HR-CDS/controllers/taskController');
const assignedController = require('../HR-CDS/controllers/assignedTaskController');
const selfController = require('../HR-CDS/controllers/selfTaskController');
const projectController = require('../HR-CDS/controllers/projectController');
const clientController = require('../HR-CDS/controllers/ClientTask');
const {
  presentOnDayFilter,
  hasTaskAttendance,
  ensureTaskStatusAttendance,
} = require('../HR-CDS/utils/taskAttendance');
const { createOccurrenceIfMissing } = require('../HR-CDS/cron/recurringTasks');

const id = () => new Types.ObjectId();
const makeRes = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('presentOnDayFilter handles invalid date safely and includes overnight check for today', () => {
  const invalid = presentOnDayFilter(null);
  assert.deepEqual(invalid, { status: { $in: ['PRESENT', 'LATE', 'HALF DAY', 'HALFDAY', 'SHORT LEAVE'] }, _id: null });

  const now = new Date('2026-11-27T10:00:00.000Z');
  const todayFilter = presentOnDayFilter(now, now);
  assert.equal(todayFilter.$or.length, 3);
  assert.equal(todayFilter.$or[2].isClockedIn, true);

  const yesterday = new Date('2026-11-26T10:00:00.000Z');
  const pastFilter = presentOnDayFilter(yesterday, now);
  assert.equal(pastFilter.$or.length, 2);
});

test('hasTaskAttendance and ensureTaskStatusAttendance require present attendance', async (t) => {
  const userId = id();
  let capturedFilter = null;
  t.mock.method(Attendance, 'exists', async (filter) => {
    capturedFilter = filter;
    return null;
  });

  assert.equal(await hasTaskAttendance({ _id: userId }), false);
  assert.equal(String(capturedFilter.user), String(userId));
  assert.ok(capturedFilter.status.$in.includes('PRESENT'));

  const denied = makeRes();
  assert.equal(await ensureTaskStatusAttendance({ user: { _id: userId } }, denied), false);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'TASK_ATTENDANCE_REQUIRED');

  t.mock.method(Attendance, 'exists', async () => ({ _id: id() }));
  const allowed = makeRes();
  assert.equal(await ensureTaskStatusAttendance({ user: { _id: userId } }, allowed), true);
  assert.equal(allowed.statusCode, 200);
});

test('all task status update handlers block absent users with 403 TASK_ATTENDANCE_REQUIRED', async (t) => {
  const userId = id();
  const taskId = id();
  const projectId = id();
  const user = { _id: userId, id: String(userId), company: id(), companyCode: 'TEST', role: 'employee' };

  t.mock.method(Attendance, 'exists', async () => null);
  t.mock.method(Group, 'find', () => ({ select: () => ({ lean: async () => [] }) }));

  const futureDue = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const taskDoc = {
    _id: taskId, companyCode: 'TEST', taskFor: 'self', createdBy: userId,
    assignedUsers: [userId], assignedGroups: [], statusByUser: [], statusHistory: [],
    overallStatus: 'pending', status: 'pending', dueDateTime: futureDue, dueDate: futureDue,
    assigneeId: userId, assignedTo: userId,
    save: () => assert.fail('Absent user must not save task status'),
  };

  t.mock.method(Task, 'findById', async () => taskDoc);
  t.mock.method(ClientTask, 'findById', async () => taskDoc);
  t.mock.method(Project, 'findOne', async () => ({
    _id: projectId, company: user.company, companyCode: 'TEST', createdBy: userId,
    tasks: [taskDoc],
  }));
  t.mock.method(Project, 'updateOne', () => assert.fail('Absent user must not update project task'));

  const makeReq = (body = { status: 'in-progress' }) => ({
    user,
    params: { taskId, projectId },
    headers: {},
    get: () => undefined,
    body,
  });

  for (const [name, handler, body] of [
    ['taskController.updateStatus', taskController.updateStatus, { status: 'in-progress' }],
    ['taskController.quickStatusUpdate', taskController.quickStatusUpdate, { status: 'in-progress' }],
    ['assignedController.updateStatus', assignedController.updateStatus, { status: 'in-progress' }],
    ['selfController.updateStatus', selfController.updateStatus, { status: 'in-progress' }],
    ['projectController.updateTaskStatus', projectController.updateTaskStatus, { status: 'in progress' }],
    ['clientController.updateAssignedTaskStatus', clientController.updateAssignedTaskStatus, { status: 'in-progress' }],
    ['clientController.toggleTaskCompletion', clientController.toggleTaskCompletion, {}],
  ]) {
    const res = makeRes();
    await handler(makeReq(body), res);
    assert.equal(res.statusCode, 403, `${name} returned ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'TASK_ATTENDANCE_REQUIRED', name);
  }
});

test('createOccurrenceIfMissing skips absent users and does not reset in-progress when 2nd assignee clocks in', async (t) => {
  const now = new Date('2026-11-27T05:00:00.000Z');
  const userA = id();
  const userB = id();
  const template = {
    _id: id(),
    title: 'Daily Check',
    taskFor: 'others',
    isRecurring: true,
    repeatPattern: 'daily',
    dueDateTime: new Date('2026-11-27T10:00:00.000Z'),
    createdBy: id(),
    assignedUsers: [userA, userB],
    assignedGroups: [],
    companyCode: 'TEST',
  };

  t.mock.method(Attendance, 'find', () => ({
    select: () => ({ lean: async () => [] })
  }));
  const skipped = await createOccurrenceIfMissing(template, template.dueDateTime, { now });
  assert.deepEqual(skipped, { created: false, skipped: true });

  t.mock.method(Attendance, 'find', () => ({
    select: () => ({ lean: async () => [{ user: userB }] })
  }));
  const updateCalls = [];
  t.mock.method(Task, 'updateOne', async (filter, update) => {
    updateCalls.push({ filter, update });
    return { upsertedCount: 0 };
  });

  const existingResult = await createOccurrenceIfMissing(template, template.dueDateTime, { now, userId: userB });
  assert.deepEqual(existingResult, { created: false, exists: true });
  assert.equal(updateCalls.length, 3);
  assert.equal(updateCalls[1].filter.overallStatus, 'completed');
  assert.equal(updateCalls[1].update.$set.overallStatus, 'in-progress');
  assert.equal(updateCalls[2].update.$set, undefined, 'Must not reset in-progress task back to pending');
});

test('getUserAllTasksPaginated returns 0 workedSeconds for absent user even with timeSpent/in-progress task', async (t) => {
  const userId = id();
  const company = id();
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  t.mock.method(User, 'findById', () => ({
    select: () => ({ lean: async () => ({ _id: userId, name: 'Test User', company, companyCode: 'TEST' }) }),
  }));
  t.mock.method(Client, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Group, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Task, 'find', () => ({
    select: () => ({
      populate: function () { return this; },
      sort: function () { return this; },
      lean: async () => [{
        _id: id(),
        title: 'Task 1',
        taskFor: 'self',
        createdBy: userId,
        assignedUsers: [userId],
        overallStatus: 'in-progress',
        statusByUser: [{ user: userId, status: 'in-progress', updatedAt: twoHoursAgo }],
        statusHistory: [{ status: 'in-progress', changedBy: userId, changedAt: twoHoursAgo }],
        timeSpent: 7200,
        createdAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
      }],
    }),
  }));
  t.mock.method(ClientTask, 'find', () => ({
    select: () => ({
      populate: function () { return this; },
      sort: function () { return this; },
      lean: async () => [],
    }),
  }));
  t.mock.method(Project, 'find', () => ({
    select: () => ({
      populate: function () { return this; },
      lean: async () => [],
    }),
  }));
  t.mock.method(ActivityLog, 'find', () => ({
    populate: () => ({ sort: () => ({ lean: async () => [] }) }),
  }));

  // Absent record (even if it has stale inTime) -> 0 worked time
  t.mock.method(Attendance, 'find', () => ({
    select: () => ({
      sort: function () { return this; },
      lean: async () => [{
        user: userId,
        date: now,
        inTime: twoHoursAgo,
        status: 'ABSENT',
        isClockedIn: false,
      }],
    }),
  }));
  t.mock.method(Attendance, 'findOne', () => ({
    select: () => ({ sort: () => ({ lean: async () => null }) }),
  }));

  const absentRes = makeRes();
  await taskController.getUserAllTasksPaginated({
    user: { _id: userId, company, companyCode: 'TEST' },
    params: { userId: String(userId) },
    query: { period: 'today' },
  }, absentRes);

  assert.equal(absentRes.statusCode, 200);
  assert.equal(absentRes.body.workSummary.workedSeconds, 0);
  assert.equal(absentRes.body.workSummary.workedLabel, '0m');

  // Present user with in-progress task -> counts in-progress seconds (even when filtered by status=pending)
  t.mock.method(Attendance, 'find', () => ({
    select: () => ({
      sort: function () { return this; },
      lean: async () => [{
        user: userId,
        date: now,
        inTime: twoHoursAgo,
        status: 'PRESENT',
        isClockedIn: true,
        breaks: [],
      }],
    }),
  }));

  const presentRes = makeRes();
  await taskController.getUserAllTasksPaginated({
    user: { _id: userId, company, companyCode: 'TEST' },
    params: { userId: String(userId) },
    query: { period: 'today', status: 'pending' },
  }, presentRes);

  assert.equal(presentRes.statusCode, 200);
  assert.ok(presentRes.body.workSummary.workedSeconds >= 7100, `Expected ~7200s, got ${presentRes.body.workSummary.workedSeconds}`);
  assert.notEqual(presentRes.body.workSummary.workedLabel, '0m');
});
