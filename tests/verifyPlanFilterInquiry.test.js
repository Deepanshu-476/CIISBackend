const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

(async () => {
  const user = { name: 'Test', role: 'Company Owner', companyCode: 'ACME100' };
  const mockClients = [
    { _id: 'c1', client: 'Acme Test Client', company: 'Acme Global Tech', services: ['Web Development'] },
    { _id: 'c2', client: 'Raman', company: 'Alpha Solutions', services: ['SEO'] },
    { _id: 'c3', client: 'Raghav', company: 'Test', services: ['UI/UX'] },
    {
      _id: 'c4',
      client: 'Kanika',
      company: 'abc',
      services: ['Web Development', 'Cloud Architecture'],
      activeClientPlan: { name: 'Growth Starter', price: 25000 }
    }
  ];
  const mockPlans = [{ _id: 'plan1', name: 'Growth Starter', price: 25000 }, { _id: 'plan2', name: 'Enterprise', price: 100000 }];
  const deps = { accessibleClients: mockClients, clientPlans: mockPlans };

  console.log('--- Test 1: User screenshot query 1: kya maine kisi client ko growth plan diya hai? ---');
  const res1 = await parseTaskRequest({ req: { user }, message: 'kya maine kisi client ko growth plan diya hai?' }, deps);
  console.log('Reply 1:\n', res1.reply);
  console.log('Chips 1:', res1.chips);
  assert.equal(res1.draft, null);
  assert.ok(!res1.reply.includes('CRM mein **"maine"**'), 'Must NEVER say "maine" client nahi mila');
  assert.ok(res1.reply.includes('Kanika'));
  assert.ok(res1.reply.includes('Growth Starter'));
  assert.ok(res1.reply.includes('Haan!'));

  console.log('\n--- Test 2: User screenshot query 2: kon kon sai client ko maine growth plan diya hai ? ---');
  const res2 = await parseTaskRequest({ req: { user }, message: 'kon kon sai client ko maine growth plan diya hai ?' }, deps);
  console.log('Reply 2:\n', res2.reply);
  assert.equal(res2.draft, null);
  assert.ok(!res2.reply.includes('CRM mein **"maine"**'));
  assert.ok(res2.reply.includes('Kanika'));
  assert.ok(res2.reply.includes('Growth Starter'));

  console.log('\n--- Test 3: Plan not assigned to any client: kya kisi client ko enterprise plan diya hai? ---');
  const res3 = await parseTaskRequest({ req: { user }, message: 'kya kisi client ko enterprise plan diya hai?' }, deps);
  console.log('Reply 3:\n', res3.reply);
  assert.equal(res3.draft, null);
  assert.ok(res3.reply.includes('kisi bhi client ko abhi **Enterprise** plan assign nahi kiya gaya hai'));
  assert.ok(res3.reply.includes('Acme Test Client'));
  assert.ok(res3.reply.includes('Kanika'));

  console.log('\n--- Test 4: Regression check: client saniha ko kon si services and plan diya hain ? ---');
  const res4 = await parseTaskRequest({ req: { user }, message: 'client saniha ko kon si services and plan diya hain ?' }, deps);
  console.log('Reply 4:\n', res4.reply);
  assert.ok(res4.reply.includes('saniha'));
  assert.ok(res4.reply.includes('nahi mila'));

  console.log('\n--- Test 5: Direct single client inquiry: kanika client ko kon kon si services and plan diya hai ? ---');
  const res5 = await parseTaskRequest({ req: { user }, message: 'kanika client ko kon kon si services and plan diya hai ?' }, deps);
  console.log('Reply 5:\n', res5.reply);
  assert.ok(res5.reply.includes('Client **Kanika**'));
  assert.ok(res5.reply.includes('Growth Starter'));

  console.log('\n--- Test 6: Service filter inquiry: kon kon se client ko cloud architecture service di hai? ---');
  const res6 = await parseTaskRequest({ req: { user }, message: 'kon kon se client ko cloud architecture service di hai?' }, deps);
  console.log('Reply 6:\n', res6.reply);
  assert.ok(res6.reply.includes('Cloud Architecture'));
  assert.ok(res6.reply.includes('Kanika'));

  console.log('\n--- Test 7: Hindi/English phrasing: kin clients ko web development diya hai ---');
  const res7 = await parseTaskRequest({ req: { user }, message: 'kin clients ko web development diya hai' }, deps);
  console.log('Reply 7:\n', res7.reply);
  assert.ok(res7.reply.includes('Web Development'));
  assert.ok(res7.reply.includes('Acme Test Client'));
  assert.ok(res7.reply.includes('Kanika'));

  console.log('\n>>> ALL 7 TESTS PASSED 100%! <<<');
})();
