const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { parseHinglishSlots, parseHinglishDateTime } = require('../services/ai/hinglishParser');
const { normalizeTranscript } = require('../services/ai/sttNormalizer');
require('dotenv').config();

async function run530EndToEndVerification() {
  console.log('🧪 Starting 5:30 Time Fix End-To-End Verification...\n');
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

  const initialUtterances = [
    {
      text: "Mera task banau task ka naam AI Voice Agent description creating pipeline of CIIS Network due date aaj sham sadhe paanch priority high status in progress reminder every two minutes baki sir by default.",
      desc: "Sadhe paanch (5:30 PM)"
    },
    {
      text: "Mera task banau task ka naam AI Voice Agent description creating pipeline of CIIS Network due date aaj sham 5:30 priority high status in progress reminder every two minutes baki sir by default.",
      desc: "5:30 with colon (5:30 PM)"
    },
    {
      text: "Mera task banau task ka naam AI Voice Agent description creating pipeline of CIIS Network due date aaj sham 5 30 priority high status in progress reminder every two minutes baki sir by default.",
      desc: "5 30 space separated (5:30 PM)"
    },
    {
      text: "Mera task banau task ka naam AI Voice Agent description creating pipeline of CIIS Network due date aaj shaam paanch tees priority high status in progress reminder every two minutes baki sir by default.",
      desc: "Paanch tees (5:30 PM)"
    },
    {
      text: "Mera task banau task ka naam AI Voice Agent description creating pipeline of CIIS Network due date aaj shaam sadhe 5 priority high status in progress reminder every two minutes baki sir by default.",
      desc: "Sadhe 5 (5:30 PM)"
    }
  ];

  console.log('--- Phase 1: Testing Full Initial Utterance with 5:30 Variations ---');
  for (const { text, desc } of initialUtterances) {
    const res = await parseTaskRequest({
      req: mockReq,
      message: text,
      draft: {},
    }, {
      now: fixedNow,
      getScopeInfo: async () => ({ isPrivileged: false, companyUsers: [], departments: [] }),
    });

    console.log(`\nTesting: [${desc}]`);
    console.log(`  Draft Due: ${res.draft.dueDateTime}`);
    console.log(`  Preview Due Label: ${res.preview.dueLabel}`);
    console.log(`  Payload dueDateTime: ${res.payload.fields.dueDateTime}`);

    assert.ok(res.draft.dueDateTime.includes('17:30:00+05:30'), `Draft must be 17:30 for ${desc}`);
    assert.ok(res.preview.dueLabel.includes('5:30 PM'), `Preview must show 5:30 PM for ${desc}`);
    assert.ok(res.payload.fields.dueDateTime.includes('17:30:00+05:30'), `Payload must have 17:30 for ${desc}`);
    console.log(`  ✔ Correctly extracted 5:30 PM`);
  }

  console.log('\n--- Phase 2: Testing Edit Turn When Initial Due Was 6:00 PM (18:00) ---');
  const oldDraftAt6PM = {
    title: 'AI Voice Agent',
    description: 'creating pipeline of CIIS Network',
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

  const editPhrases = [
    { text: "nahi time change karo 5:30", desc: "nahi time change karo 5:30" },
    { text: "time change karo sadhe paanch", desc: "time change karo sadhe paanch" },
    { text: "time change karo saadhe 5", desc: "time change karo saadhe 5" },
    { text: "time rakhna hai 5:30 pm", desc: "time rakhna hai 5:30 pm" },
    { text: "5 30 pm", desc: "5 30 pm" },
    { text: "sadhe paanch", desc: "sadhe paanch" }
  ];

  for (const { text, desc } of editPhrases) {
    const resEdit = await parseTaskRequest({
      req: mockReq,
      message: text,
      draft: JSON.parse(JSON.stringify(oldDraftAt6PM)),
    }, {
      now: fixedNow,
      getScopeInfo: async () => ({ isPrivileged: false, companyUsers: [], departments: [] }),
    });

    console.log(`\nEdit Turn: [${desc}]`);
    console.log(`  Updated Due: ${resEdit.draft.dueDateTime}`);
    console.log(`  Preview Due: ${resEdit.preview.dueLabel}`);
    console.log(`  Reply: ${resEdit.reply}`);
    console.log(`  Speech: ${resEdit.speech}`);

    assert.equal(resEdit.status, 'ready');
    assert.ok(resEdit.draft.dueDateTime.includes('17:30:00+05:30'), `Draft must be updated to 17:30 for ${desc}`);
    assert.ok(resEdit.preview.dueLabel.includes('5:30 PM'), `Preview must be updated to 5:30 PM for ${desc}`);
    assert.ok(resEdit.reply.includes('5:30 PM'), `Reply must confirm 5:30 PM`);
    console.log(`  ✔ Correctly updated to 5:30 PM and confirmed`);
  }

  console.log('\n======================================================');
  console.log('🎉 ALL 5:30 CREATION & EDIT VERIFICATIONS PASSED 100%!');
  console.log('======================================================');
  await mongoose.disconnect();
}

run530EndToEndVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
