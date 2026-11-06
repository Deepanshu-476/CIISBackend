const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

(async () => {
  const user = { _id: 'u1', name: 'Pankaj Bhatia', role: 'Company Owner', companyCode: 'TECH334753' };

  const mockProjects = [
    {
      _id: 'p_ai',
      projectName: 'ai agent',
      status: 'active',
      startDate: new Date('2026-11-03T05:30:00Z'),
      users: ['u1', 'u2', 'u3'],
      tasks: []
    }
  ];

  const deps = {
    accessibleProjects: mockProjects,
    companyUsers: [
      { _id: 'u1', name: 'Pankaj Bhatia' },
      { _id: 'u2', name: 'Test Admin' },
      { _id: 'u3', name: 'Vansh Test' }
    ]
  };

  console.log('--- Step 1: User asks in English about project status ---');
  const res1 = await parseTaskRequest({
    req: { user },
    message: 'Tell me what is the status of AI agent project?'
  }, deps);

  console.log('Res 1 Language:', res1.language);
  console.log('Res 1 Reply:\n', res1.reply);
  assert.equal(res1.language, 'en');
  assert.ok(res1.reply.includes('ai agent'));
  assert.ok(res1.reply.includes('*active*'));
  assert.ok(res1.draft?.lastProjectId);

  console.log('\n--- Step 2: User says in English: "Change the status of this project, make it planning." ---');
  const res2 = await parseTaskRequest({
    req: { user },
    message: 'Change the status of this project, make it planning.',
    draft: res1.draft
  }, deps);

  console.log('Res 2 Status:', res2.status);
  console.log('Res 2 Language:', res2.language);
  console.log('Res 2 SpeakTextHi:', res2.speakTextHi);
  console.log('Res 2 Speech:', res2.speech);
  console.log('Res 2 Reply:\n', res2.reply);

  // Issue 1 Verification:
  assert.equal(mockProjects[0].status, 'planning', 'Project status in mock/DB MUST be planning');
  assert.ok(res2.reply.includes('ai agent'), 'Must mention project ai agent');
  assert.ok(res2.reply.includes('planning'), 'Must mention updated status planning');
  assert.ok(!res2.reply.includes('Task ka naam'), 'Must NOT start creating a task!');
  assert.ok(!res2.reply.includes('select ho gaya hai'), 'Must NOT give task selection bubble!');

  // Issue 2 Verification:
  assert.equal(res2.language, 'en', 'Language MUST be English');
  assert.equal(res2.speakTextHi, null, 'speakTextHi MUST be null so voice does NOT speak Hindi');
  assert.ok(res2.reply.includes('has been successfully updated'), 'Reply MUST be in English');
  assert.ok(!res2.speech.includes('safaltapoorvak') && !res2.speech.includes('kar diya'), 'Speech must NOT contain Hindi words');

  console.log('\n--- Step 3: User says in Hinglish: "ai agent project ka status active kardo" ---');
  const res3 = await parseTaskRequest({
    req: { user },
    message: 'ai agent project ka status active kardo',
    draft: res2.draft
  }, deps);

  console.log('Res 3 Status:', res3.status);
  console.log('Res 3 Language:', res3.language);
  console.log('Res 3 Reply:\n', res3.reply);
  assert.equal(mockProjects[0].status, 'active');
  assert.equal(res3.language, 'hinglish');
  assert.ok(res3.reply.includes('safaltapoorvak'));

  console.log('\n============================================================');
  console.log('>>> BOTH ISSUE 1 AND ISSUE 2 VERIFIED & PASSED 100%! <<<');
  console.log('============================================================');
})();

