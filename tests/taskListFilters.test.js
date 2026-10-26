const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCleanListFilters, calculateUnifiedTaskStats } = require('../HR-CDS/controllers/taskHelper');

const future = new Date(Date.now() + 86400e3).toISOString();
const tasks = [
  { _id: '1', priority: 'high', status: 'pending', dueDateTime: future },
  { _id: '2', priority: 'high', status: 'completed', dueDateTime: future },
  { _id: '3', priority: 'medium', status: 'in-progress', dueDateTime: future },
  { _id: '4', priority: 'low', status: 'pending', dueDateTime: future },
];
const filter = status => applyCleanListFilters(tasks, { query: { status } }).map(task => task._id);

test('priority stat cards (status=<level>-priority) filter by priority on /tasks/all', () => {
  assert.deepEqual(filter('high-priority'), ['1', '2']);
  assert.deepEqual(filter('medium-priority'), ['3']);
  assert.deepEqual(filter('low-priority'), ['4']);
  assert.deepEqual(filter('pending'), ['1', '4']);
});

test('/tasks/all stats carry the same priority breakdown as /tasks/counts', () => {
  const stats = calculateUnifiedTaskStats(tasks);
  assert.deepEqual(stats.highPriority, { count: 2, completed: 1, percentage: 50 });
  assert.deepEqual(stats.mediumPriority, { count: 1, completed: 0, percentage: 0 });
  assert.deepEqual(stats.lowPriority, { count: 1, completed: 0, percentage: 0 });
  assert.equal(stats.total, 4);
});
