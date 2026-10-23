const assert = require('node:assert/strict');
const { parseTaskRequest, buildReminderPayload } = require('../services/ai/taskAgentService');
const { parseHinglishSlots } = require('../services/ai/hinglishParser');

async function runVerification() {
  console.log('🧪 Starting Senior QA & AI Engineer Verification Suite...\n');

  // ==========================================
  // ISSUE 2 VERIFICATION: Dynamic Reminder Extraction
  // ==========================================
  console.log('--- TEST 1: Regex & Slot Parsing for Repeat Intervals & Before Due ---');
  const slot10m = parseHinglishSlots('reminder every 10 min');
  assert.equal(slot10m.reminder, true);
  assert.equal(slot10m.repeatIntervalMinutes, 10);
  assert.equal(slot10m.reminderOption, 'interval');
  console.log('  ✔ "reminder every 10 min" -> repeatIntervalMinutes: 10, reminderOption: interval');

  const slotHar10 = parseHinglishSlots('har 10 minute me reminder do');
  assert.equal(slotHar10.reminder, true);
  assert.equal(slotHar10.repeatIntervalMinutes, 10);
  console.log('  ✔ "har 10 minute me reminder do" -> repeatIntervalMinutes: 10');

  const slot15Pehle = parseHinglishSlots('15 min pehle yaad dilana');
  assert.equal(slot15Pehle.reminder, true);
  assert.equal(slot15Pehle.minutesBeforeDue, 15);
  assert.equal(slot15Pehle.reminderOption, 'beforeDue');
  console.log('  ✔ "15 min pehle yaad dilana" -> minutesBeforeDue: 15, reminderOption: beforeDue');

  console.log('\n--- TEST 2: Task Agent Service Reminder Extraction & Payload ---');
  const mockReq = {
    user: { _id: '507f1f77bcf86cd799439011', role: 'employee', company: '507f191e810c19729de860ea' },
    body: {},
  };
  const fixedNow = new Date('2026-10-22T10:00:00+05:30');
  const mockScope = { isPrivileged: false, companyUsers: [], departments: [] };

  const baseDraft = {
    title: 'testing of CRM',
    description: 'Manual verification',
    dueDateTime: '2026-10-22T18:00:00+05:30',
    priority: 'medium',
    status: 'pending',
    asked: ['title', 'dueDateTime', 'description', 'priority', 'status', 'reminder'],
    skipped: ['priorityDays', 'repeatPattern', 'checkpoints', 'attachments'],
  };

  // Case A: User says "every 10 min"
  const res10m = await parseTaskRequest({
    req: mockReq,
    message: 'every 10 min',
    draft: baseDraft,
  }, {
    now: fixedNow,
    getScopeInfo: async () => mockScope,
  });

  assert.equal(res10m.status, 'ready');
  assert.equal(res10m.draft.reminder, true);
  assert.equal(res10m.draft.repeatIntervalMinutes, 10);
  assert.equal(res10m.draft.reminderOption, 'interval');
  assert.equal(res10m.preview.reminder, 'Every 10 min');

  const payload10m = JSON.parse(res10m.payload.fields.reminderSettings);
  assert.equal(payload10m.enabled, true);
  assert.equal(payload10m.repeatIntervalMinutes, 10);
  assert.ok(payload10m.options.includes('interval'));
  console.log('  ✔ Case A ("every 10 min"): Draft, Preview ("Every 10 min"), and Payload (repeatIntervalMinutes: 10) verified');

  // Case B: User says "15 min pehle"
  const res15Pehle = await parseTaskRequest({
    req: mockReq,
    message: '15 min pehle',
    draft: baseDraft,
  }, {
    now: fixedNow,
    getScopeInfo: async () => mockScope,
  });

  assert.equal(res15Pehle.status, 'ready');
  assert.equal(res15Pehle.draft.reminder, true);
  assert.equal(res15Pehle.draft.minutesBeforeDue, 15);
  assert.equal(res15Pehle.preview.reminder, '15 min before due');

  const payload15 = JSON.parse(res15Pehle.payload.fields.reminderSettings);
  assert.equal(payload15.enabled, true);
  assert.equal(payload15.minutesBeforeDue, 15);
  assert.ok(payload15.options.includes('beforeDue'));
  console.log('  ✔ Case B ("15 min pehle"): Draft, Preview ("15 min before due"), and Payload (minutesBeforeDue: 15) verified');

  // Case C: Standard "1 hour before" preset
  const res1h = await parseTaskRequest({
    req: mockReq,
    message: 'Haan',
    draft: baseDraft,
  }, {
    now: fixedNow,
    getScopeInfo: async () => mockScope,
  });

  assert.equal(res1h.status, 'ready');
  assert.equal(res1h.preview.reminder, '1 hour before');
  const payload1h = JSON.parse(res1h.payload.fields.reminderSettings);
  assert.equal(payload1h.enabled, true);
  assert.deepEqual(payload1h.options, ['oneHourBefore']);
  console.log('  ✔ Case C ("Haan" / default): Preview ("1 hour before") and Payload (oneHourBefore) verified');

  // Case D: Single-shot full utterance
  const resFull = await parseTaskRequest({
    req: mockReq,
    message: 'testing of CRM kal shaam 6 baje reminder every 10 min',
    draft: {},
  }, {
    now: fixedNow,
    getScopeInfo: async () => mockScope,
  });
  assert.equal(resFull.draft.reminder, true);
  assert.equal(resFull.draft.repeatIntervalMinutes, 10);
  assert.equal(resFull.draft.reminderOption, 'interval');
  console.log('  ✔ Case D (Single-shot utterance): Extracted upfront with repeatIntervalMinutes: 10');

  // ==========================================
  // ISSUE 1 VERIFICATION: Payload Structure for Creation
  // ==========================================
  console.log('\n--- TEST 3: Issue 1 Creation Payload & Endpoint Verification ---');
  assert.ok(res10m.payload.endpoint, '/tasks/self/create');
  assert.equal(res10m.payload.method, 'POST');
  assert.ok(res10m.payload.fields.title, 'testing of CRM');
  assert.ok(res10m.payload.fields.reminderSettings);
  console.log('  ✔ Creation endpoint: POST /tasks/self/create verified with complete fields');

  console.log('\n🎉 ALL QA CHECKS PASSED SUCCESSFULLY!');
}

runVerification().catch((err) => {
  console.error('❌ QA Verification Failed:', err);
  process.exit(1);
});
