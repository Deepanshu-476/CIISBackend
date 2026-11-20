const assert = require('node:assert/strict');
const axios = require('axios');
const mongoose = require('mongoose');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
require('dotenv').config();

async function testTaskCreation() {
  console.log('🧪 Testing Task Creation Endpoint & Field Verification...');

  // 1. Get taskAgentService result for the user's exact utterance
  const fixedNow = new Date();
  const mockReq = {
    user: { _id: new mongoose.Types.ObjectId().toString(), role: 'employee', company: new mongoose.Types.ObjectId().toString() },
    body: {},
  };

  const utterance = "Mera task banau task ka naam CIIS Network description creating pipeline of CRM due date aaj sham chay baj kar pchas minute priority high status in progress reminder every two minutes baki sir by default.";

  const res = await parseTaskRequest({
    req: mockReq,
    message: utterance,
    draft: {},
  }, {
    now: fixedNow,
    getScopeInfo: async () => ({ isPrivileged: false, companyUsers: [], departments: [] }),
  });

  console.log('Draft Due:', res.draft.dueDateTime);
  console.log('Preview Due Label:', res.preview.dueLabel);
  console.log('Payload Endpoint:', res.payload.endpoint);
  console.log('Payload DueDateTime field:', res.payload.fields.dueDateTime);

  assert.ok(res.draft.dueDateTime.includes('18:50:00+05:30'), 'Draft must have 18:50');
  assert.ok(res.preview.dueLabel.includes('6:50 PM'), 'Preview label must have 6:50 PM');
  assert.ok(res.payload.fields.dueDateTime.includes('18:50:00+05:30'), 'Payload fields dueDateTime must have 18:50');

  // 2. Test edit turn: "नहीं, time change karo, time rakhna hai 6 bach kar 50 minute, 6.50 p.m. प्रश्राइब लुएगा"
  const editUtterance = "नहीं, time change karo, time rakhna hai 6 bach kar 50 minute, 6.50 p.m. प्रश्राइब लुएगा";
  const oldDraft = {
    title: 'CIIS Network',
    description: 'creating pipeline of CRM',
    dueDateTime: '2026-10-22T18:00:00+05:30', // Old 6:00 PM
    priority: 'high',
    status: 'in-progress',
    reminder: true,
    repeatIntervalMinutes: 2,
    reminderOption: 'interval',
    skipped: ['priorityDays', 'repeatPattern', 'checkpoints', 'attachments'],
    asked: ['title', 'dueDateTime', 'description', 'priority', 'status', 'reminder'],
    askCounts: {},
  };

  const resEdit = await parseTaskRequest({
    req: mockReq,
    message: editUtterance,
    draft: oldDraft,
  }, {
    now: fixedNow,
    getScopeInfo: async () => ({ isPrivileged: false, companyUsers: [], departments: [] }),
  });

  console.log('\n--- Edit Turn Test ---');
  console.log('Edit Draft Due:', resEdit.draft.dueDateTime);
  console.log('Edit Preview Due Label:', resEdit.preview.dueLabel);
  console.log('Edit Reply:', resEdit.reply);
  console.log('Edit Speech:', resEdit.speech);

  assert.equal(resEdit.status, 'ready');
  assert.ok(resEdit.draft.dueDateTime.includes('18:50:00+05:30'));
  assert.ok(resEdit.preview.dueLabel.includes('6:50 PM'));
  assert.ok(resEdit.reply.includes('6:50 PM'));
  assert.ok(resEdit.speech.includes('6:50 PM'));

  console.log('\n🎉 ALL CREATION PAYLOAD & TIME EDIT VERIFICATIONS PASSED 100%!');
}

testTaskCreation().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
