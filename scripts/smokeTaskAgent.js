/**
 * Smoke test script for AI Task Agent with REAL parseTaskRequest and Groq LLM.
 *
 * Runs 4 realistic messages in order and prints status, reply, draft.dueDateTime, and chips count.
 * Guaranteed never to create any Task document in MongoDB.
 *
 * Usage: node scripts/smokeTaskAgent.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const Task = require('../HR-CDS/models/Task');

// Guard to guarantee a Task document is NEVER created or saved
Task.create = () => {
  throw new Error('ILLEGAL ACTION: Task.create was invoked during smoke test!');
};
Task.prototype.save = () => {
  throw new Error('ILLEGAL ACTION: Task.prototype.save was invoked during smoke test!');
};

async function main() {
  console.log('========================================');
  console.log('🤖 AI Task Agent Smoke Test (Real Groq LLM)');
  console.log('========================================\n');

  // 1. Check GROQ_API_KEY
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || !groqKey.trim()) {
    console.error('❌ Missing GROQ_API_KEY in environment (.env).');
    console.error('Please set GROQ_API_KEY to run the live smoke test.');
    process.exit(1);
  }

  // 2. Check MONGO_URI
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri || !mongoUri.trim()) {
    console.error('❌ Missing MONGO_URI in environment (.env).');
    console.error('Please set MONGO_URI to connect to database for assignee/scope resolution.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB successfully.\n');
  } catch (err) {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const userId = process.env.SMOKE_USER_ID || new mongoose.Types.ObjectId().toString();
  const companyId = process.env.SMOKE_COMPANY_ID || new mongoose.Types.ObjectId().toString();
  const companyCode = process.env.SMOKE_COMPANY_CODE || 'COMP-01';

  const fakeReq = {
    user: {
      _id: userId,
      id: userId,
      company: companyId,
      companyCode: companyCode,
      companyRole: 'manager',
      jobRole: 'Manager',
      name: 'Smoke Test Manager'
    }
  };

  const printStepResult = (stepLabel, message, result) => {
    console.log(`--- [Step ${stepLabel}] "${message}" ---`);
    console.log(`• Status:          ${result.status}`);
    console.log(`• Reply:           ${result.reply}`);
    console.log(`• draft.dueDateTime: ${result.draft?.dueDateTime || 'null'}`);
    console.log(`• Chips count:     ${Array.isArray(result.chips) ? result.chips.length : 0}`);
    if (result.payload) {
      console.log(`• Payload Endpoint: ${result.payload.endpoint}`);
    }
    console.log('');
  };

  try {
    // a) "Prepare GST report for Q3"
    const msgA = 'Prepare GST report for Q3';
    const resA = await parseTaskRequest({
      req: fakeReq,
      message: msgA,
      language: 'hinglish',
      draft: {}
    });
    printStepResult('a', msgA, resA);

    // b) "Submit weekly timesheet tomorrow 5pm"
    const msgB = 'Submit weekly timesheet tomorrow 5pm';
    const resB = await parseTaskRequest({
      req: fakeReq,
      message: msgB,
      language: 'en',
      draft: {}
    });
    printStepResult('b', msgB, resB);

    // c) "Ashutosh ko bolo client presentation prepare kare kal 4 baje tak"
    const msgC = 'Ashutosh ko bolo client presentation prepare kare kal 4 baje tak';
    const resC = await parseTaskRequest({
      req: fakeReq,
      message: msgC,
      language: 'hinglish',
      draft: {}
    });
    printStepResult('c', msgC, resC);

    // d) "kal 6 baje tak" (with previous draft from (a))
    const msgD = 'kal 6 baje tak';
    const resD = await parseTaskRequest({
      req: fakeReq,
      message: msgD,
      language: 'hinglish',
      draft: resA.draft
    });
    printStepResult('d', msgD, resD);

    console.log('✅ All 4 smoke test steps completed successfully without writing any Task.');
  } catch (err) {
    console.error('❌ Error executing smoke test steps:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  }
}

main();
