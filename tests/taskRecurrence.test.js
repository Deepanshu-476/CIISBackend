const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRecurrenceSettings, normalizeTaskRecurrenceFields } = require('../HR-CDS/utils/taskRecurrence');

const due = '2026-10-26T12:30:00.000Z'; // 26 Oct, 6:00 pm IST
const repeat = endDate => ({ isRecurring: true, recurrenceEndDate: normalizeTaskRecurrenceFields({ repeatPattern: 'daily', recurrenceEndDate: endDate }).recurrenceEndDate });

test('repeat tasks need an end date between the due day and one year later', () => {
  assert.equal(validateRecurrenceSettings({ isRecurring: false }, due), null);
  assert.equal(validateRecurrenceSettings({ isRecurring: true, recurrenceEndDate: null }, due), 'Please select repeat end date.');
  assert.equal(validateRecurrenceSettings(repeat('2026-10-25'), due), 'Repeat end date cannot be before due date.');
  assert.equal(validateRecurrenceSettings(repeat('2026-10-26'), due), null);
  assert.equal(validateRecurrenceSettings(repeat('2027-10-26'), due), null);
  assert.equal(validateRecurrenceSettings(repeat('2027-10-27'), due), 'Repeat end date can be at most 1 year after due date.');
});

test('a picked end date covers that whole IST day', () => {
  const { recurrenceEndDate } = normalizeTaskRecurrenceFields({ repeatPattern: 'daily', recurrenceEndDate: '2026-10-29' });
  assert.equal(recurrenceEndDate.toISOString(), '2026-10-29T18:29:59.999Z');
});
