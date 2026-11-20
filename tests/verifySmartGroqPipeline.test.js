const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

(async () => {
  const user = { name: 'Test Admin', role: 'Company Owner', companyCode: 'ACME100' };

  const mockUsers = [
    { _id: 'u1', name: 'Test Admin' },
    { _id: 'u2', name: 'Vansh Test' },
    { _id: 'u3', name: 'Simran Kaur' },
    { _id: 'u4', name: 'Aarav Sharma' }
  ];

  const mockProjects = [
    { _id: 'p1', projectName: 'ai agent', status: 'Active', users: ['u1', 'u2', 'u3'] },
    { _id: 'p2', projectName: 'TechSoft Platform', status: 'Active', users: ['u4'] }
  ];

  const mockClients = [
    { _id: 'c1', client: 'Kanika', company: 'abc', activeClientPlan: { name: 'Growth Starter', price: 25000 }, services: ['Web Development', 'Cloud Architecture'] },
    { _id: 'c2', client: 'Acme Test Client', company: 'Acme Global Tech', services: ['Web Development'] }
  ];

  const deps = {
    accessibleProjects: mockProjects,
    accessibleClients: mockClients,
    companyUsers: mockUsers
  };

  console.log('--- Test 1: User Query: ai agent project mai kitne members or kon kon sai members add hai ---');
  const res1 = await parseTaskRequest({
    req: { user },
    message: 'ai agent project mai kitne members or kon kon sai members add hai'
  }, deps);
  console.log('Status 1:', res1.status);
  console.log('Reply 1:\n', res1.reply);
  assert.ok(!res1.draft?.title, 'Must NOT start creating a dummy task');
  assert.ok(res1.reply.includes('3'), 'Must mention 3 members');
  assert.ok(res1.reply.includes('Test Admin') || res1.reply.includes('Vansh Test'), 'Must list actual member names');

  console.log('\n--- Test 2: User Query: kin clients ko maine growth plan diya hai? ---');
  const res2 = await parseTaskRequest({
    req: { user },
    message: 'kin clients ko maine growth plan diya hai?'
  }, deps);
  console.log('Reply 2:\n', res2.reply);
  assert.equal(res2.draft, null);
  assert.ok(res2.reply.includes('Kanika'));
  assert.ok(res2.reply.includes('Growth Starter'));

  console.log('\n--- Test 3: Natural chit-chat / Feeling: today i fell so tired ---');
  const res3 = await parseTaskRequest({
    req: { user },
    message: 'today i fell so tired'
  }, deps);
  console.log('Reply 3:\n', res3.reply);
  assert.equal(res3.draft, null);
  assert.ok(res3.reply.toLowerCase().includes('tired') || res3.reply.toLowerCase().includes('rest') || res3.reply.toLowerCase().includes('aaram'));

  console.log('\n--- Test 4: General Knowledge off-topic query: tell me how to make tea and who is the pm of india ---');
  const res4 = await parseTaskRequest({
    req: { user },
    message: 'tell me how to make tea and who is the pm of india'
  }, deps);
  console.log('Reply 4:\n', res4.reply);
  assert.equal(res4.draft, null);
  assert.ok(res4.reply.includes('CIIS CRM Assistant') || res4.reply.includes('CRM'));

  console.log('\n--- Test 5: Deterministic Form Action: Naya project banana button click ---');
  const res5 = await parseTaskRequest({
    req: { user },
    action: { type: 'set_intent', intent: 'create_project' }
  }, deps);
  console.log('Status 5:', res5.status);
  console.log('Draft Intent 5:', res5.draft?.intent);
  assert.equal(res5.draft?.intent, 'create_project');
  assert.equal(res5.status, 'needs_input');

  console.log('\n======================================================');
  console.log('>>> ALL 5 SMART GROQ PIPELINE TESTS PASSED 100%! <<<');
  console.log('======================================================');
})();

