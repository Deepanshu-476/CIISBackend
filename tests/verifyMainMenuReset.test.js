const { parseTaskRequest } = require('../services/ai/taskAgentService');
const assert = require('node:assert');

(async () => {
  const mockReq = { user: { role: 'Company Owner', companyCode: 'TECH334753' } };

  console.log('--- Test 1: Action { type: "reset" } (clicking Main Menu button) ---');
  const res1 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'reset' },
    draft: {
      intent: 'create_client',
      client: 'Some Old Client',
      asked: ['client']
    }
  });

  console.log('res1.status:', res1.status);
  console.log('res1.field:', res1.field);
  console.log('res1.reply:', res1.reply);
  console.log('res1.chips count:', res1.chips?.length);
  console.log('res1.chips labels:', res1.chips?.map(c => c.label));

  assert.equal(res1.status, 'open');
  assert.equal(res1.field, 'welcome');
  assert.equal(res1.draft, null);
  assert.equal(res1.chips.length, 6);
  assert.equal(res1.chips[0].label, 'Personal task banana');
  assert.equal(res1.chips[1].label, 'Kisi ko task assign karna');
  assert.equal(res1.chips[2].label, 'Naya project banana');
  assert.equal(res1.chips[3].label, 'Project mein task banana/assign karna');
  assert.equal(res1.chips[4].label, 'Naya client add karna');
  assert.equal(res1.chips[5].label, 'Client plan banana');

  console.log('\n--- Test 2: User types "main menu" ---');
  const res2 = await parseTaskRequest({
    req: mockReq,
    message: 'main menu',
    draft: {
      intent: 'self_task',
      title: 'Random task',
      asked: ['title']
    }
  });

  console.log('res2.status:', res2.status);
  console.log('res2.chips count:', res2.chips?.length);
  assert.equal(res2.status, 'open');
  assert.equal(res2.field, 'welcome');
  assert.equal(res2.draft, null);
  assert.equal(res2.chips.length, 6);

  console.log('\n--- Test 3: User types "menu" ---');
  const res3 = await parseTaskRequest({
    req: mockReq,
    message: 'menu',
    draft: {
      intent: 'task_project',
      projectName: 'Test Proj'
    }
  });
  assert.equal(res3.status, 'open');
  assert.equal(res3.chips.length, 6);

  console.log('\n>>> ALL MAIN MENU RESET TESTS PASSED 100%! <<<');
  process.exit(0);
})();

