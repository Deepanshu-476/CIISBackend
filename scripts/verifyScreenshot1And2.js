const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { parseHinglishSlots, parseHinglishDateTime } = require('../services/ai/hinglishParser');
const { normalizeTranscript } = require('../services/ai/sttNormalizer');
require('dotenv').config();

async function verifyScreenshot1And2() {
  console.log('🧪 Verifying Exact Screenshot 1 & 2 Scenario...\n');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const fixedNow = new Date('2026-10-22T08:00:00.000Z'); // 1:30 PM IST on Oct 22
  const mockReq = {
    user: {
      _id: new mongoose.Types.ObjectId().toString(),
      role: 'employee',
      company: new mongoose.Types.ObjectId().toString()
    },
    body: {},
  };

  // 1. Initial creation
  const initialText = "Mera task banau task ka naam langchain description creating pipeline of langchain due date aaj sham chay baje priority high status in progress reminder every two minutes baki sir by default.";
  const res1 = await parseTaskRequest({
    req: mockReq,
    message: initialText,
    draft: {},
  }, {
    now: fixedNow,
    getScopeInfo: async () => ({ isPrivileged: false, companyUsers: [], departments: [] }),
  });

  console.log('Turn 1 (Initial):');
  console.log('  Draft Due:', res1.draft.dueDateTime);
  console.log('  Preview Due:', res1.preview.dueLabel);
  console.log('  Status:', res1.status);
  assert.equal(res1.status, 'ready');
  assert.ok(res1.draft.dueDateTime.includes('18:00:00+05:30'));

  // 2. Exact user utterance from Screenshot 1: "नहीं, time रखना है, 6 बज़ कर 10 मिनट।"
  const editUtterance = "नहीं, time रखना है, 6 बज़ कर 10 मिनट।";
  const res2 = await parseTaskRequest({
    req: mockReq,
    message: editUtterance,
    draft: res1.draft,
  }, {
    now: fixedNow,
    getScopeInfo: async () => ({ isPrivileged: false, companyUsers: [], departments: [] }),
  });

  console.log('\nTurn 2 (Exact Screenshot Utterance):');
  console.log('  Utterance:', editUtterance);
  console.log('  Draft Due:', res2.draft.dueDateTime);
  console.log('  Preview Due:', res2.preview?.dueLabel);
  console.log('  Payload Field dueDateTime:', res2.payload?.fields?.dueDateTime);
  console.log('  Status:', res2.status);
  console.log('  Reply:', res2.reply);
  console.log('  Speech:', res2.speech);

  assert.equal(res2.status, 'ready');
  assert.ok(res2.draft.dueDateTime.includes('18:10:00+05:30'), 'Draft must be updated to 18:10 (6:10 PM)');
  assert.ok(res2.preview.dueLabel.includes('6:10 PM'), 'Preview label must show 6:10 PM');
  assert.ok(res2.payload.fields.dueDateTime.includes('18:10:00+05:30'), 'Creation payload must have 18:10');
  assert.ok(res2.reply.includes('6:10 PM'), 'Reply text must confirm 6:10 PM');

  console.log('\n======================================================');
  console.log('🎉 EXACT SCREENSHOT 1 & 2 VERIFICATION PASSED 100%!');
  console.log('======================================================');
  await mongoose.disconnect();
}

verifyScreenshot1And2().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
