/**
 * Senior QA AI Verification Suite
 * Full end-to-end integration and robustness tests across:
 * 1. Audio STT Layer (Groq Whisper, format checks, corrupt slice rejection)
 * 2. NLU & Extraction Layer (Hinglish, Devanagari, multi-turn, anti-loop)
 * 3. Live Server HTTP API Endpoints (/api/ai/transcribe, /api/ai/task-agent/parse)
 * 4. Task Creation Contract & DB Persistence
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const assert = require('assert/strict');

const { transcribeAudio, detectAudioFormat } = require('../services/ai/transcribeService');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const User = require('../models/User');

const BASE_URL = 'http://localhost:3000';

async function runSeniorQaSuite() {
  console.log('======================================================');
  console.log('🧪 SENIOR QA AI VERIFICATION SUITE');
  console.log('======================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function markTest(testName, fn) {
    totalTests++;
    return async () => {
      process.stdout.write(`▶ [TEST ${totalTests}] ${testName}... `);
      const start = Date.now();
      try {
        await fn();
        const duration = Date.now() - start;
        console.log(`✅ PASSED (${duration}ms)`);
        passedTests++;
      } catch (err) {
        console.log(`❌ FAILED: ${err.message}`);
        console.error(err);
        throw err;
      }
    };
  }

  // Connect to DB
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const testUser = await User.findOne({ isActive: true }).lean();
  assert.ok(testUser, 'Active user must exist in DB for authentication');
  const token = jwt.sign({ id: testUser._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

  // -------------------------------------------------------------------------
  // SECTION 1: Audio STT & Format Safeguards
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 1: Audio STT & Format Safeguards ---');

  await markTest('1.1 Detects valid WebM EBML header (magic 1a45dfa3)', async () => {
    const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'speech_sample.webm');
    const audioBuf = fs.readFileSync(fixturePath);
    const detected = detectAudioFormat(audioBuf, 'audio/webm', 'recording.webm');
    assert.equal(detected.ext, 'webm');
    assert.equal(detected.hex, '1a45dfa3');
  })();

  await markTest('1.2 Rejects corrupt/headerless WebM cluster slice (magic 43c38100) before Groq API', async () => {
    // Simulate a headerless slice (WebM cluster tag 0x43, 0xC3, 0x81, 0x00)
    const corruptBuf = Buffer.from([0x43, 0xc3, 0x81, 0x00, 0x1f, 0x43, 0xb6, 0x75, ...new Array(500).fill(0x01)]);
    let rejected = false;
    try {
      await transcribeAudio(corruptBuf, { mimetype: 'audio/webm', originalname: 'recording.webm' });
    } catch (err) {
      rejected = true;
      assert.equal(err.code, 'STT_BAD_AUDIO');
    }
    assert.ok(rejected, 'Corrupt slice without EBML header must be rejected as STT_BAD_AUDIO');
  })();

  await markTest('1.3 Live Groq Whisper transcription with valid Hindi/Hinglish speech sample', async () => {
    const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'speech_sample.webm');
    const audioBuf = fs.readFileSync(fixturePath);
    const result = await transcribeAudio(audioBuf, { mimetype: 'audio/webm', originalname: 'recording.webm', language: 'hi' });
    assert.ok(result.text, 'Transcription must return text');
    assert.ok(result.text.length > 2, 'Transcript must have meaningful text');
    assert.ok(result.duration > 0, 'Audio duration must be reported');
  })();

  // -------------------------------------------------------------------------
  // SECTION 2: AI Task Agent Multi-Turn & NLU
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 2: AI Task Agent Multi-Turn & NLU ---');

  await markTest('2.1 Single-turn rich extraction (Title + Description + Priority + Due Date)', async () => {
    const richInput = 'Task naam Voice Pipeline. Description creating audio connections. Priority high. Kal subah 10 baje.';
    const res = await parseTaskRequest({
      req: { user: testUser },
      message: richInput,
      language: 'hinglish',
      draft: {},
    });
    assert.ok(res.draft.title, 'Title must be extracted');
    assert.ok(res.draft.description, 'Description must be extracted');
    assert.equal(res.draft.priority, 'high');
    assert.ok(res.draft.dueDateTime, 'Due date must be extracted');
    assert.ok(['status', 'reminder'].includes(res.field), `Next question should be status or reminder, got ${res.field}`);
  })();

  await markTest('2.2 Guided multi-turn flow with "koi nahi" and "baaki sab default"', async () => {
    // Turn 1: "Mera naya task banao" -> asks title
    const t1 = await parseTaskRequest({
      req: { user: testUser },
      message: 'Mera naya task banao',
      draft: {},
    });
    assert.equal(t1.field, 'title');

    // Turn 2: "Website Redesign" -> asks due date
    const t2 = await parseTaskRequest({
      req: { user: testUser },
      message: 'Website Redesign',
      draft: t1.draft,
    });
    assert.equal(t2.draft.title, 'Website Redesign');
    assert.equal(t2.field, 'dueDateTime');

    // Turn 3: "kal shaam 6 baje" -> asks description
    const t3 = await parseTaskRequest({
      req: { user: testUser },
      message: 'kal shaam 6 baje',
      draft: t2.draft,
    });
    assert.ok(t3.draft.dueDateTime);
    assert.equal(t3.field, 'description');

    // Turn 4: "baaki sab default" -> skips all remaining optional fields -> READY
    const t4 = await parseTaskRequest({
      req: { user: testUser },
      message: 'baaki sab default',
      draft: t3.draft,
    });
    assert.equal(t4.status, 'ready');
    assert.ok(t4.payload, 'Payload must be generated');
    assert.ok(t4.preview, 'Preview card must be generated');
    assert.equal(t4.preview.title, 'Website Redesign');
  })();

  await markTest('2.3 Anti-loop guard: Repeated unknown answer stops asking and provides guidance', async () => {
    const draft = {
      title: 'Audit Report',
      description: 'Review quarterly financials',
      dueDateTime: '2026-10-22T10:00:00+05:30',
      asked: ['title', 'description', 'dueDateTime', 'priority'],
      askCounts: { priority: 1 },
    };
    // 2nd turn answering unknown word for priority
    const res = await parseTaskRequest({
      req: { user: testUser },
      message: 'kuch bhi samajh nahi aaya',
      draft,
    });
    assert.equal(res.field, 'priority');
    assert.ok(res.reply.includes('Low, Medium ya High'), 'Must give explicit choices on 2nd attempt');
    assert.ok(res.chips.some(c => c.label === 'Medium'));
  })();

  // -------------------------------------------------------------------------
  // SECTION 3: Live HTTP API Endpoints on http://localhost:3000
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Live HTTP Endpoints (Integration) ---');

  await markTest('3.1 POST /api/ai/transcribe HTTP 200 with real audio file', async () => {
    const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'speech_sample.webm');
    const audioBuf = fs.readFileSync(fixturePath);
    const formData = new FormData();
    const blob = new Blob([audioBuf], { type: 'audio/webm' });
    formData.append('audio', blob, 'recording.webm');
    formData.append('language', 'hi');

    const res = await fetch(`${BASE_URL}/api/ai/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.text);
  })();

  await markTest('3.2 POST /api/ai/task-agent/parse HTTP 200 conversational turn', async () => {
    const res = await fetch(`${BASE_URL}/api/ai/task-agent/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: 'Task name Customer Onboarding, kal dopahar 2 baje',
        language: 'hinglish',
      }),
    });
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.draft.title, 'Customer Onboarding');
  })();

  // -------------------------------------------------------------------------
  // SECTION 4: Live Task Creation Contract & Execution
  // -------------------------------------------------------------------------
  console.log('\n--- SECTION 4: Live Task Creation Contract ---');

  await markTest('4.1 Completes full flow and POSTs generated payload to create task in DB', async () => {
    // Ready turn
    const readyRes = await parseTaskRequest({
      req: { user: testUser },
      message: 'Task name Senior QA Task, priority high, due tomorrow 11 am',
      draft: {
        title: 'Senior QA Task',
        description: 'Verified by senior QA suite',
        dueDateTime: '2026-10-22T11:00:00+05:30',
        priority: 'high',
        reminder: true,
        reminderOption: 'oneHourBefore',
        skipped: ['checkpoints', 'attachments', 'priorityDays', 'repeatPattern'],
        asked: ['title', 'description', 'dueDateTime', 'priority', 'reminder'],
      },
    });

    assert.equal(readyRes.status, 'ready');
    const { endpoint, method, fields } = readyRes.payload;
    assert.ok(endpoint);
    assert.equal(method, 'POST');

    // Post to endpoint exactly as AIChatDrawer does
    const formData = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      formData.append(k, v);
    }

    const createRes = await fetch(`${BASE_URL}/api${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    assert.equal(createRes.status, 201, `Task creation must return 201 Created, got ${createRes.status}`);
    const createData = await createRes.json();
    assert.equal(createData.success, true);
    assert.equal(createData.task.title, 'Senior QA Task');
    assert.equal(createData.task.priority, 'high');
  })();

  console.log('\n======================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} SENIOR QA TESTS PASSED SUCCESSFULLY!`);
  console.log('======================================================\n');

  await mongoose.disconnect();
}

runSeniorQaSuite().catch((err) => {
  console.error('\n❌ QA Suite Terminated with Failure:', err);
  process.exit(1);
});
