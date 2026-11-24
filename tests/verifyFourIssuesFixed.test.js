const assert = require('assert');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { TASK_FIELDS } = require('../services/ai/taskFields');

async function runTests() {
  console.log('=== TEST 1: Edit Priority (Hinglish & English) ===');
  const loggedInUser = {
    _id: 'emp_123',
    id: 'emp_123',
    name: 'Vansh Test',
    role: 'Employee'
  };

  const initialDraft = {
    intent: 'create_client_task',
    client: 'sakshi',
    clientId: 'cli_1',
    service: 'Web Development',
    title: 'sadfgh',
    description: 'sdfh',
    dueDateTime: '2026-11-16T18:00:00.000Z',
    dueDate: '2026-11-16',
    priority: 'Medium',
    assignee: 'Vansh Test',
    assigneeId: 'emp_123',
    checkpoints: [],
    checkpointsAsked: true,
    asked: ['client', 'service', 'title', 'description', 'dueDateTime', 'priority', 'reminder', 'checkpoints'],
  };

  const deps = {
    accessibleClients: [{ _id: 'cli_1', client: 'sakshi', services: ['Web Development'] }],
    servicePendingTasks: []
  };

  // User sends "priority change karke high karo"
  const editRes1 = await parseTaskRequest({
    req: { user: loggedInUser },
    message: 'priority change karke high karo',
    draft: { ...initialDraft },
    action: null
  }, deps);

  console.log('editRes1.draft.priority:', editRes1.draft.priority);
  console.log('editRes1.draft.checkpoints:', editRes1.draft.checkpoints);
  assert.equal(editRes1.draft.priority, 'High', 'Priority must be updated to High');
  assert.equal(editRes1.draft.checkpoints.length, 0, 'Checkpoints must NOT be created from priority edit message');

  // User sends in English "change priority to low"
  const editRes2 = await parseTaskRequest({
    req: { user: loggedInUser },
    message: 'change priority to low',
    language: 'en',
    draft: { ...initialDraft, priority: 'High' },
    action: null
  }, deps);

  console.log('editRes2.draft.priority:', editRes2.draft.priority);
  assert.equal(editRes2.draft.priority, 'Low', 'Priority must be updated to Low');
  assert.equal(editRes2.draft.checkpoints.length, 0, 'Checkpoints must be empty');
  console.log('Test 1 PASSED ✅\n');

  console.log('=== TEST 2: English Language Consistency in create_client_task ===');
  const enRes1 = await parseTaskRequest({
    req: { user: loggedInUser },
    message: 'Create client task',
    language: 'en',
    draft: { intent: 'create_client_task' },
    action: null
  }, deps);

  console.log('enRes1.reply:', enRes1.reply);
  assert.ok(enRes1.reply.includes('Which client'), 'Prompt must be in English');
  assert.ok(!enRes1.reply.includes('Kaun se'), 'Must not contain Hinglish');
  console.log('Test 2 PASSED ✅\n');

  console.log('=== TEST 3: Reminder Chips in English and Hinglish ===');
  const enChips = TASK_FIELDS.reminder.chips(new Date(), true);
  console.log('enChips:', enChips.map(c => c.label));
  assert.equal(enChips[0].label, 'Yes');
  assert.equal(enChips[3].label, 'No');
  assert.equal(enChips[4].label, 'Skip remaining');

  const hiChips = TASK_FIELDS.reminder.chips(new Date(), false);
  console.log('hiChips:', hiChips.map(c => c.label));
  assert.equal(hiChips[0].label, 'Haan');
  assert.equal(hiChips[3].label, 'Nahi');
  console.log('Test 3 PASSED ✅\n');

  console.log('=== TEST 4: Attachment Prompt & Exactly 2 Chips ===');
  const enAttachChips = TASK_FIELDS.attachments.chips(new Date(), true);
  console.log('enAttachChips:', enAttachChips.map(c => c.label));
  assert.equal(enAttachChips.length, 2, 'Must have exactly 2 chips');
  assert.equal(enAttachChips[0].label, 'No');
  assert.equal(enAttachChips[1].label, 'Skip remaining');

  const hiAttachChips = TASK_FIELDS.attachments.chips(new Date(), false);
  console.log('hiAttachChips:', hiAttachChips.map(c => c.label));
  assert.equal(hiAttachChips.length, 2, 'Must have exactly 2 chips');
  assert.equal(hiAttachChips[0].label, 'Nahi');
  assert.equal(hiAttachChips[1].label, 'Skip remaining');

  console.log('Question EN:', TASK_FIELDS.attachments.question.replyEn);
  assert.equal(TASK_FIELDS.attachments.question.replyEn, 'Would you like to attach any file or image? If yes, please upload it, otherwise click on No.');
  console.log('Question HI:', TASK_FIELDS.attachments.question.reply);
  assert.equal(TASK_FIELDS.attachments.question.reply, 'Kya aap koi file ya image attach karna chahte hain? Agar haan toh upload karein, nahi toh "Nahi" par click karein.');
  console.log('Test 4 PASSED ✅\n');

  console.log('==================================================');
  console.log('>>> ALL 4 REPORTED ISSUES VERIFIED & RESOLVED! <<<');
  console.log('==================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

