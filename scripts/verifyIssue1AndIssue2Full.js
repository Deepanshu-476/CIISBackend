const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { parseHinglishSlots, parseHinglishDateTime } = require('../services/ai/hinglishParser');
const { normalizeTranscript } = require('../services/ai/sttNormalizer');

async function testIssues() {
  console.log('🧪 Starting Verification for User Exact Utterances...\n');

  const fixedNow = new Date('2026-10-22T10:00:00+05:30');
  const mockReq = {
    user: { _id: '507f1f77bcf86cd799439011', role: 'employee', company: '507f191e810c19729de860ea' },
    body: {},
  };
  const mockScope = { isPrivileged: false, companyUsers: [], departments: [] };

  // ==========================================
  // TEST 1: SCREENSHOT 1 UTTERANCE
  // "Mera task banau task ka naam CIIS Network description creating pipeline of CRM due date aaj sham chay baj kar pchas minute priority high status in progress reminder every two minutes baki sir by default."
  // ==========================================
  console.log('--- TEST 1: Screenshot 1 Initial Full Utterance ---');
  const utterance1 = "Mera task banau task ka naam CIIS Network description creating pipeline of CRM due date aaj sham chay baj kar pchas minute priority high status in progress reminder every two minutes baki sir by default.";
  
  const slots1 = parseHinglishSlots(utterance1, fixedNow);
  console.log('  Slots from Utterance 1:', JSON.stringify(slots1, null, 2));

  assert.equal(slots1.title, 'CIIS Network', 'Title should be "CIIS Network"');
  assert.equal(slots1.priority, 'high', 'Priority should be "high"');
  assert.equal(slots1.status, 'in-progress', 'Status should be "in-progress"');
  assert.equal(slots1.reminder, true, 'Reminder should be true');
  assert.equal(slots1.repeatIntervalMinutes, 2, 'Repeat interval should be 2 min');
  assert.ok(slots1.dueDateTime, 'dueDateTime must be extracted');
  assert.ok(slots1.dueDateTime.includes('18:50:00+05:30'), `dueDateTime should be 18:50 (6:50 PM), got: ${slots1.dueDateTime}`);
  console.log('  ✔ Utterance 1 correctly parsed "chay baj kar pchas minute" as 18:50 (6:50 PM)!');

  // Parse via taskAgentService
  const res1 = await parseTaskRequest({
    req: mockReq,
    message: utterance1,
    draft: {},
  }, {
    now: fixedNow,
    getScopeInfo: async () => mockScope,
  });

  assert.equal(res1.status, 'ready');
  assert.equal(res1.draft.title, 'CIIS Network');
  assert.ok(res1.draft.dueDateTime.includes('18:50:00+05:30'));
  assert.ok(res1.preview.dueLabel.includes('6:50 PM'), `Preview should display 6:50 PM, got: ${res1.preview.dueLabel}`);
  assert.equal(res1.draft.priority, 'high');
  assert.equal(res1.draft.status, 'in-progress');
  assert.equal(res1.draft.repeatIntervalMinutes, 2);
  console.log('  ✔ Task Agent Service ready result verified with 6:50 PM dueLabel!');

  // ==========================================
  // TEST 2: SCREENSHOT 2 EDIT UTTERANCE
  // "नहीं, time change karo, time rakhna hai 6 bach kar 50 minute, 6.50 p.m. प्रश्राइब लुएगा"
  // ==========================================
  console.log('\n--- TEST 2: Screenshot 2 Modification Utterance ---');
  const utterance2 = "नहीं, time change karo, time rakhna hai 6 bach kar 50 minute, 6.50 p.m. प्रश्राइब लुएगा";

  // Suppose previously due time was 6:00 PM (as seen in screenshot 2)
  const baseReadyDraft = {
    title: 'CIIS Network',
    description: 'creating pipeline of CRM',
    dueDateTime: '2026-10-22T18:00:00+05:30', // Currently 6:00 PM in user's screenshot
    priority: 'high',
    status: 'in-progress',
    reminder: true,
    repeatIntervalMinutes: 2,
    reminderOption: 'interval',
    asked: ['title', 'dueDateTime', 'description', 'priority', 'status', 'reminder'],
    skipped: ['priorityDays', 'repeatPattern', 'checkpoints', 'attachments'],
    askCounts: {},
  };

  const slots2 = parseHinglishSlots(utterance2, fixedNow, baseReadyDraft.dueDateTime);
  console.log('  Slots from Utterance 2:', JSON.stringify(slots2, null, 2));
  assert.ok(slots2.dueDateTime, 'dueDateTime should be extracted from "6 bach kar 50 minute, 6.50 p.m."');
  assert.ok(slots2.dueDateTime.includes('18:50:00+05:30'), `dueDateTime should be 18:50 (6:50 PM), got: ${slots2.dueDateTime}`);
  console.log('  ✔ Utterance 2 correctly extracted "6 bach kar 50 minute" & "6.50 p.m." as 18:50!');

  // Execute parseTaskRequest with base draft
  const res2 = await parseTaskRequest({
    req: mockReq,
    message: utterance2,
    draft: baseReadyDraft,
  }, {
    now: fixedNow,
    getScopeInfo: async () => mockScope,
  });

  console.log('  Result status:', res2.status);
  console.log('  Updated dueDateTime:', res2.draft.dueDateTime);
  console.log('  Preview dueLabel:', res2.preview.dueLabel);
  console.log('  Reply text:', res2.reply);
  console.log('  Speech text:', res2.speech);

  assert.equal(res2.status, 'ready');
  assert.ok(res2.draft.dueDateTime.includes('18:50:00+05:30'), 'Draft dueDateTime must be updated to 18:50 (6:50 PM)');
  assert.ok(res2.preview.dueLabel.includes('6:50 PM'), `Preview label must show 6:50 PM, got: ${res2.preview.dueLabel}`);
  assert.ok(res2.reply.includes('due time'), 'Reply must explicitly mention due time');
  assert.ok(res2.reply.includes('6:50 PM'), 'Reply must mention 6:50 PM');
  assert.ok(res2.reply.includes('Kya main task create kar doon?'), 'Reply must prompt to create task');
  assert.ok(res2.speech.includes('ड्यू टाइम'), 'Speech must mention ड्यू टाइम');
  console.log('  ✔ Issue 1 & Issue 2 verified with user exact speech transcripts!');

  console.log('\n🎉 ALL LIVE USER REGRESSION TESTS PASSED 100%!');
}

testIssues().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
