const test = require('node:test');
const assert = require('node:assert/strict');
const {weeklyOffUserIdsForDate} = require('../HR-CDS/utils/attendanceWeekOffSummary');

const departments = [{_id: 'dept1', name: 'Sales', workingDays: 6}, {_id: 'dept2', name: 'Support', workingDays: 7}];
const users = [{_id: 'a', department: 'dept1', weekOffDays: [4]}, {_id: 'b', departmentName: 'Sales', weekOffDays: [7]}, {_id: 'c', department: 'dept2'}];

test('admin daily attendance uses employee weekdays and department entitlement', () => {
  assert.deepEqual(weeklyOffUserIdsForDate(users, departments, [], '2026-11-12'), ['a']);
  assert.deepEqual(weeklyOffUserIdsForDate(users, departments, [], '2026-11-15'), ['b']);
});

test('approved swap changes both the original and replacement off day for only its employee', () => {
  const swaps = [{user: 'a', status: 'Approved', weekStartKey: '2026-11-09', fromDateKey: '2026-11-12', toDateKey: '2026-11-13'}];
  assert.deepEqual(weeklyOffUserIdsForDate(users, departments, swaps, '2026-11-12'), []);
  assert.deepEqual(weeklyOffUserIdsForDate(users, departments, swaps, '2026-11-13'), ['a']);
  assert.deepEqual(weeklyOffUserIdsForDate(users, departments, swaps, '2026-11-19'), ['a']);
});

test('working-day history is applied to the date being exported', () => {
  const history = [{_id: 'dept1', name: 'Sales', workingDays: 7,
    workingDayHistory: [{effectiveFrom: '2026-01-01', workingDays: 6}, {effectiveFrom: '2026-11-16', workingDays: 7}]}];
  assert.deepEqual(weeklyOffUserIdsForDate(users.slice(0, 1), history, [], '2026-11-12'), ['a']);
  assert.deepEqual(weeklyOffUserIdsForDate(users.slice(0, 1), history, [], '2026-11-19'), []);
});
