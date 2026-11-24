const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.NODE_ENV = 'test';

const { Types } = require('mongoose');
const Task = require('../HR-CDS/models/Task');
const {
  validateRecurrenceSettings,
  normalizeTaskRecurrenceFields,
  getNextRecurringDate,
  buildRecurringTaskClone,
  getIndiaDayRange,
} = require('../HR-CDS/utils/taskRecurrence');
const {
  generateRecurringOccurrences,
  processRecurringTemplate,
  runRecurringTaskSweep,
} = require('../HR-CDS/cron/recurringTasks');

test('validateRecurrenceSettings validates repeat end dates accurately', () => {
  const baseDue = new Date('2026-11-25T10:00:00.000Z');

  // Not recurring -> no error
  assert.equal(validateRecurrenceSettings({ isRecurring: false }, baseDue), null);

  // Missing end date
  assert.equal(
    validateRecurrenceSettings({ isRecurring: true, recurrenceEndDate: null }, baseDue),
    'Please select repeat end date.'
  );

  // End date before due date
  const pastEnd = new Date('2026-11-20T10:00:00.000Z');
  assert.equal(
    validateRecurrenceSettings({ isRecurring: true, recurrenceEndDate: pastEnd }, baseDue),
    'Repeat end date cannot be before due date.'
  );

  // End date beyond 1 year
  const farEnd = new Date('2028-01-01T10:00:00.000Z');
  assert.equal(
    validateRecurrenceSettings({ isRecurring: true, recurrenceEndDate: farEnd }, baseDue),
    'Repeat end date can be at most 1 year after due date.'
  );

  // Valid end date
  const validEnd = new Date('2026-12-25T10:00:00.000Z');
  assert.equal(
    validateRecurrenceSettings({ isRecurring: true, recurrenceEndDate: validEnd }, baseDue),
    null
  );
});

test('normalizeTaskRecurrenceFields sets recurrence flags and IST end bound', () => {
  const normalized = normalizeTaskRecurrenceFields({
    repeatPattern: 'daily',
    repeatDays: ['monday', 'friday'],
    recurrenceEndDate: '2026-12-01',
  });

  assert.equal(normalized.isRecurring, true);
  assert.equal(normalized.repeatPattern, 'daily');
  assert.deepEqual(normalized.repeatDays, ['monday', 'friday']);
  assert.ok(normalized.recurrenceEndDate instanceof Date);

  // None pattern
  const noneNorm = normalizeTaskRecurrenceFields({
    repeatPattern: 'none',
  });
  assert.equal(noneNorm.isRecurring, false);
  assert.equal(noneNorm.repeatPattern, 'none');
});

test('buildRecurringTaskClone sanitizes populated fields and preserves taskFor others', () => {
  const creatorId = new Types.ObjectId();
  const branchId = new Types.ObjectId();
  const groupId = new Types.ObjectId();
  const assigneeId = new Types.ObjectId();
  const templateId = new Types.ObjectId();

  const templateTask = {
    _id: templateId,
    title: 'Daily Standup Sync',
    description: 'Sync with team',
    dueDateTime: new Date('2026-11-24T10:00:00.000Z'),
    priority: 'high',
    companyCode: 'COMP-101',
    taskFor: 'others',
    isRecurring: true,
    repeatPattern: 'daily',
    repeatDays: [],
    recurrenceEndDate: new Date('2026-12-10T18:29:59.999Z'),
    // Populated fields simulate populated Mongoose documents:
    createdBy: { _id: creatorId, name: 'Manager Bob' },
    branch: { _id: branchId, name: 'Delhi Main' },
    assignedUsers: [{ _id: assigneeId, name: 'Alice' }],
    assignedGroups: [{ _id: groupId, name: 'Dev Team' }],
    reminderSettings: { enabled: true, options: ['15m'] }
  };

  const occurrenceDate = new Date('2026-11-25T10:00:00.000Z');
  const clone = buildRecurringTaskClone(templateTask, occurrenceDate);

  assert.ok(clone, 'Clone should be built');
  assert.equal(clone.taskFor, 'others');
  assert.equal(String(clone.recurrenceSourceId), String(templateId));
  assert.equal(clone.recurrenceOccurrenceKey, occurrenceDate.toISOString());
  assert.equal(String(clone.createdBy), String(creatorId), 'createdBy should be extracted as ObjectId/string');
  assert.equal(String(clone.branch), String(branchId), 'branch should be extracted as ObjectId/string');
  assert.equal(String(clone.assignedGroups[0]), String(groupId), 'assignedGroups should be extracted as ObjectId/string');
  assert.equal(String(clone.assignedUsers[0]), String(assigneeId));
  assert.equal(clone.overallStatus, 'pending');
  assert.equal(clone.statusByUser[0].status, 'pending');
});

test('generateRecurringOccurrences and processRecurringTemplate reject cloned occurrences', async () => {
  const clonedTask = {
    _id: new Types.ObjectId(),
    recurrenceSourceId: new Types.ObjectId(), // It has a parent!
    isRecurring: true,
    repeatPattern: 'daily',
  };

  const genResult = await generateRecurringOccurrences(clonedTask);
  assert.deepEqual(genResult, { created: 0, skipped: true }, 'Cloned tasks must not generate occurrences');

  const procResult = await processRecurringTemplate(clonedTask);
  assert.deepEqual(procResult, { created: 0, skipped: true }, 'Cloned tasks must not be processed as templates');
});

test('runRecurringTaskSweep builds safe query including recurrenceSourceId null even with custom filter', async (t) => {
  let capturedQuery = null;
  t.mock.method(Task, 'find', (query) => {
    capturedQuery = query;
    return {
      select: () => ({
        lean: async () => []
      })
    };
  });

  await runRecurringTaskSweep({ companyCode: 'COMP-101', $or: [{ status: 'active' }] });

  assert.ok(capturedQuery?.$and, 'Query must use $and to preserve template criteria');
  const hasTemplateSourceCondition = capturedQuery.$and.some(c => (
    c.$or && c.$or.some(o => o.recurrenceSourceId === null)
  ));
  assert.ok(hasTemplateSourceCondition, 'Query must enforce recurrenceSourceId null/missing');
});

test('assignedTaskController.createTaskForOthers enforces recurrence validation', async () => {
  const { createTaskForOthers } = require('../HR-CDS/controllers/assignedTaskController');
  const userId = new Types.ObjectId();

  const req = {
    user: { _id: userId, companyCode: 'COMP-101' },
    body: {
      title: 'Weekly Assigned Meeting',
      dueDateTime: new Date('2026-11-25T10:00:00.000Z').toISOString(),
      assignedUsers: JSON.stringify([new Types.ObjectId().toString()]),
      repeatPattern: 'daily',
      // recurrenceEndDate is omitted!
    }
  };

  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; }
  };

  await createTaskForOthers(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.data?.error, 'Please select repeat end date.');
});
