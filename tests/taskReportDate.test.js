const test = require('node:test');
const assert = require('node:assert/strict');
const { getTaskReportDate, getUserStatusChangedAt, applyCleanListFilters } = require('../HR-CDS/controllers/taskHelper');

const created = '2026-10-27T05:00:00.000Z';
const due = '2026-11-04T12:00:00.000Z';
const changed = '2026-10-30T09:00:00.000Z';
const iso = value => new Date(value).toISOString();

test('an untouched task is listed on its due date, not its created date (every task type)', () => {
  for (const source of ['self', 'assigned', 'client', 'project']) {
    assert.equal(iso(getTaskReportDate({ __taskSource: source, status: 'pending', createdAt: created, dueDateTime: due })), due, source);
  }
});

test('a task whose status was changed before the due date is listed on the change date', () => {
  for (const status of ['in-progress', 'onhold', 'pending', 'completed']) {
    const task = { status, createdAt: created, dueDateTime: due, statusChangedAt: changed };
    assert.equal(iso(getTaskReportDate(task)), changed, status);
  }
});

test('a completed task uses its completion time', () => {
  assert.equal(iso(getTaskReportDate({ status: 'completed', dueDate: due, completedAt: changed })), changed);
});

test('client activity logs (createdAt) count as status changes for older tasks', () => {
  const task = { status: 'in-progress', dueDate: due, activityLogs: [{ action: 'status_updated', description: 'Status changed', createdAt: changed }] };
  assert.equal(iso(getTaskReportDate(task)), changed);
});

test('statusByUser written at creation is not a status change', () => {
  const user = '000000000000000000000001';
  assert.equal(getUserStatusChangedAt({ createdAt: created, statusByUser: [{ user, status: 'pending', updatedAt: created }] }, user), null);
  assert.equal(iso(getUserStatusChangedAt({ createdAt: created, statusByUser: [{ user, status: 'pending', updatedAt: changed }] }, user)), changed);
  // A change saved right after creation still counts when statusChangedAt is recorded.
  assert.equal(iso(getUserStatusChangedAt({ createdAt: created, statusByUser: [{ user, status: 'pending', updatedAt: created, statusChangedAt: created }] }, user)), created);
});

test('Task model stamps statusChangedAt on a status change, but not on automatic overdue', async () => {
  const Task = require('../HR-CDS/models/Task');
  const user = '000000000000000000000001';
  const task = new Task({ title: 't', description: 't', taskFor: 'self', createdBy: user, companyCode: 'X', statusByUser: [{ user, status: 'pending' }] });
  task.isNew = false;
  task.statusByUser[0].status = 'onhold';
  await task.validate();
  const hooks = Task.schema.s.hooks;
  await new Promise((resolve, reject) => hooks.execPre('save', task, [{}], error => (error ? reject(error) : resolve())));
  assert.ok(task.statusByUser[0].statusChangedAt instanceof Date);
  const overdue = new Task({ title: 't', description: 't', taskFor: 'self', createdBy: user, companyCode: 'X', statusByUser: [{ user, status: 'pending' }] });
  overdue.isNew = false;
  overdue.statusByUser[0].status = 'overdue';
  await new Promise((resolve, reject) => hooks.execPre('save', overdue, [{}], error => (error ? reject(error) : resolve())));
  assert.equal(overdue.statusByUser[0].statusChangedAt, null);
});

test('a date filter on the due date day finds the untouched task; created day does not', () => {
  const tasks = [{ _id: 'a', status: 'pending', createdAt: created, dueDateTime: due }];
  const on = date => applyCleanListFilters(tasks, { query: { fromDate: date, toDate: date } }).map(task => task._id);
  assert.deepEqual(on('2026-11-04'), ['a']);
  assert.deepEqual(on('2026-10-27'), []);
});

test('old records with empty log/status entries do not break the Today filter', () => {
  const tasks = [
    { _id: 'bad', status: 'completed', activityLogs: [null], statusByUser: [null], statusHistory: [] },
    { _id: 'ok', status: 'in-progress', statusChangedAt: new Date().toISOString() },
  ];
  const ids = applyCleanListFilters(tasks, { query: { period: 'today' } }).map(task => task._id);
  assert.deepEqual(ids, ['ok']);
});
