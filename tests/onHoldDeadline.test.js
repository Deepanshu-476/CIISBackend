const test = require('node:test');
const assert = require('node:assert/strict');
const {DAY_MS, indiaDateKey, inferHoldStart, trackHoldClock, evaluateHoldDeadline} = require('../HR-CDS/utils/onHoldDeadline');
const {planTaskUpdate, planSingleTaskUpdate, createOnHoldOverdueService} = require('../HR-CDS/utils/onHoldOverdueService');
const start = new Date('2026-10-16T08:30:00Z');
const first = new Date(start.getTime() + DAY_MS);
const second = new Date(first.getTime() + DAY_MS);
const present = date => new Set([indiaDateKey(date)]);

test('a present employee cannot be marked overdue even one millisecond before 24 hours', () => {
  const result = evaluateHoldDeadline({startedAt: start, now: new Date(first - 1), presentDays: present(first)});
  assert.equal(result.overdue, false);
  assert.equal(result.nextCheckAt.getTime(), first.getTime());
});

test('at exactly 24 hours a present employee is eligible regardless of the original due date', () => {
  const result = evaluateHoldDeadline({startedAt: start, now: first, presentDays: present(first)});
  assert.equal(result.overdue, true);
  assert.equal(result.nextCheckAt.getTime(), first.getTime());
});

test('absence postpones a full 24 hours; checking in later does not shorten the postponed window', () => {
  const firstResult = evaluateHoldDeadline({startedAt: start, now: first});
  assert.equal(firstResult.overdue, false);
  assert.equal(firstResult.nextCheckAt.getTime(), second.getTime());
  const later = evaluateHoldDeadline({startedAt: start, checkAt: second, now: new Date(first.getTime() + 3600000), presentDays: present(first)});
  assert.equal(later.overdue, false);
  const nextDay = evaluateHoldDeadline({startedAt: start, checkAt: second, now: second, presentDays: present(second)});
  assert.equal(nextDay.overdue, true);
});

test('consecutive absences and a missed scheduler run advance to the next 24-hour checkpoint', () => {
  const now = new Date(start.getTime() + DAY_MS * 5 + 3600000);
  const result = evaluateHoldDeadline({startedAt: start, now});
  assert.equal(result.overdue, false);
  assert.equal(result.nextCheckAt.getTime(), start.getTime() + DAY_MS * 6);
  assert.equal(evaluateHoldDeadline({startedAt: start, now, presentDays: present(second)}).overdue, true);
});

test('attendance uses the deadline India date across UTC midnight, including weekends only when actually present', () => {
  assert.equal(indiaDateKey('2026-10-16T18:29:59Z'), '2026-10-16');
  assert.equal(indiaDateKey('2026-10-16T18:30:00Z'), '2026-10-17');
  const held = new Date('2026-10-16T19:00:00Z');
  const deadline = new Date(held.getTime() + DAY_MS);
  assert.equal(evaluateHoldDeadline({startedAt: held, now: deadline, presentDays: new Set(['2026-10-17'])}).overdue, false);
  assert.equal(evaluateHoldDeadline({startedAt: held, now: deadline, presentDays: new Set(['2026-10-18'])}).overdue, true);
});

test('model clock starts on entering hold, survives unrelated saves and resets on a fresh hold cycle', () => {
  const task = {};
  trackHoldClock(task, 'on hold', true, start);
  assert.equal(task.holdOverdueCheckAt.getTime(), first.getTime());
  trackHoldClock(task, 'onhold', false, new Date(start.getTime() + 10000));
  assert.equal(task.holdStartedAt.getTime(), start.getTime());
  trackHoldClock(task, 'in-progress', true, first);
  assert.equal(task.holdStartedAt, null);
  trackHoldClock(task, 'onhold', true, second);
  assert.equal(task.holdOverdueCheckAt.getTime(), second.getTime() + DAY_MS);
});

test('legacy held tasks use their latest recorded hold transition, not their original task due date', () => {
  const task = {dueDateTime: new Date('2025-01-01'), updatedAt: second, statusHistory: [{status: 'onhold', changedAt: start}]};
  assert.equal(inferHoldStart(task).getTime(), start.getTime());
  trackHoldClock(task, 'onhold', false, second);
  assert.equal(task.holdOverdueCheckAt.getTime(), first.getTime());
});

test('assigned task checks each employee separately and preserves completed employees', () => {
  const task = {_id: 'task', overallStatus: 'onhold', holdStartedAt: start, holdOverdueCheckAt: first, assignedUsers: ['present', 'absent', 'done'], statusByUser: [
    {user: 'present', status: 'onhold', holdStartedAt: start, holdOverdueCheckAt: first},
    {user: 'absent', status: 'onhold', holdStartedAt: start, holdOverdueCheckAt: first},
    {user: 'done', status: 'completed'},
  ]};
  const plan = planTaskUpdate(task, new Map([['present', present(first)]]), first);
  assert.equal(plan.update.$set.statusByUser[0].status, 'overdue');
  assert.equal(plan.update.$set.statusByUser[1].status, 'onhold');
  assert.equal(plan.update.$set.statusByUser[1].holdOverdueCheckAt.getTime(), second.getTime());
  assert.equal(plan.update.$set.statusByUser[2].status, 'completed');
  assert.equal(plan.update.$set.overallStatus, undefined);
  assert.deepEqual(plan.overdueUsers, ['present']);
});

test('an individually held assignee is checked even when overall task status is in-progress', () => {
  const task = {overallStatus: 'in-progress', assignedUsers: ['held', 'working'], statusByUser: [
    {user: 'held', status: 'onhold', holdStartedAt: start, holdOverdueCheckAt: first},
    {user: 'working', status: 'in-progress'},
  ]};
  const plan = planTaskUpdate(task, new Map([['held', present(first)]]), first);
  assert.equal(plan.update.$set.statusByUser[0].status, 'overdue');
  assert.equal(plan.update.$set.statusByUser[1].status, 'in-progress');
  assert.equal(plan.update.$set.overallStatus, undefined);
});

test('completed, cancelled and already overdue tasks never transition again', () => {
  for (const status of ['completed', 'approved', 'cancelled', 'rejected', 'overdue']) {
    assert.equal(planTaskUpdate({overallStatus: status, assignedUsers: ['u']}, new Map(), first), null);
    assert.equal(planSingleTaskUpdate({status, holdStartedAt: start}, ['u'], new Map(), first), null);
  }
  assert.equal(planSingleTaskUpdate({status: 'onhold', completed: true, holdStartedAt: start}, ['u'], new Map([['u', present(first)]]), first), null);
});

function model(rows, {race = false} = {}) {
  return {
    calls: [],
    find(filter) {
      this.calls.push(['find', filter]);
      const query = {sort() {return query;}, limit() {return query;}, select() {return query;}, lean: async () => rows};
      return query;
    },
    async updateOne(filter, update) {
      this.calls.push(['update', filter, update]);
      return {modifiedCount: race ? 0 : 1};
    },
  };
}
function fixture({presentEmployee = true, race = false} = {}) {
  const stamp = new Date(start);
  const common = {holdStartedAt: start, holdOverdueCheckAt: first, updatedAt: stamp};
  const Task = model([
    {_id: 'personal', ...common, taskFor: 'self', createdBy: 'u', overallStatus: 'onhold', statusByUser: [{user: 'u', status: 'onhold', ...common}]},
    {_id: 'assigned', ...common, assignedUsers: ['u'], overallStatus: 'onhold', statusByUser: [{user: 'u', status: 'onhold', ...common}]},
  ], {race});
  const ClientTask = model([{_id: 'client', ...common, assigneeId: 'u', status: 'onhold', completed: false}], {race});
  const Project = model([{_id: 'project', updatedAt: stamp, tasks: [{_id: 'subtask', ...common, assignedTo: 'u', status: 'on hold'}]}], {race});
  const Attendance = model(presentEmployee ? [{user: 'u', date: new Date('2026-10-16T18:30:00Z'), inTime: new Date('2026-10-17T04:00:00Z'), outTime: new Date('2026-10-17T06:00:00Z'), status: 'PRESENT'}] : []);
  const notifications = [];
  const run = createOnHoldOverdueService({Task, ClientTask, Project, Attendance, notifyDirectUsers: async message => notifications.push(message)});
  return {Task, ClientTask, Project, Attendance, notifications, run};
}

test('scheduled service moves personal, assigned, client and project holds to overdue when present', async () => {
  const app = fixture();
  await app.run(first);
  assert.equal(app.Task.calls.filter(([type]) => type === 'update').length, 2);
  for (const [, , update] of app.Task.calls.filter(([type]) => type === 'update')) assert.equal(update.$set.overallStatus, 'overdue');
  assert.equal(app.ClientTask.calls.find(([type]) => type === 'update')[2].$set.status, 'overdue');
  const project = app.Project.calls.find(([type]) => type === 'update')[2].$set.tasks[0];
  assert.equal(project.status, 'overdue');
  assert(project.activityLogs[0].performedBy);
  assert.equal(app.notifications.length, 4);
});

test('scheduled service postpones all four task types when absent without sending overdue notifications', async () => {
  const app = fixture({presentEmployee: false});
  await app.run(first);
  const clientUpdate = app.ClientTask.calls.find(([type]) => type === 'update')[2].$set;
  assert.equal(clientUpdate.status, undefined);
  assert.equal(clientUpdate.holdOverdueCheckAt.getTime(), second.getTime());
  const projectUpdate = app.Project.calls.find(([type]) => type === 'update')[2].$set.tasks[0];
  assert.equal(projectUpdate.status, 'on hold');
  assert.equal(projectUpdate.holdOverdueCheckAt.getTime(), second.getTime());
  assert.equal(app.notifications.length, 0);
});

test('concurrent completion or status changes prevent stale overdue writes and notifications', async () => {
  const app = fixture({race: true});
  const result = await app.run(first);
  assert.equal(result.updated, 0);
  assert.equal(app.notifications.length, 0);
  const filter = app.ClientTask.calls.find(([type]) => type === 'update')[1];
  assert(filter.updatedAt);
  assert.equal(filter.status, 'onhold');
  assert.deepEqual(filter.completed, {$ne: true});
});

test('an assignee with no status entry prevents prematurely marking the whole shared task overdue', () => {
  const task = {overallStatus: 'in-progress', assignedUsers: ['held', 'not-started'], statusByUser: [
    {user: 'held', status: 'onhold', holdStartedAt: start, holdOverdueCheckAt: first},
  ]};
  const plan = planTaskUpdate(task, new Map([['held', present(first)]]), first);
  assert.equal(plan.update.$set.statusByUser[0].status, 'overdue');
  assert.equal(plan.update.$set.overallStatus, undefined);
});
