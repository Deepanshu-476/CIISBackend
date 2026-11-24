const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

(async () => {
  const user = { _id: 'u1', name: 'Test Admin', role: 'Company Owner', companyCode: 'ACME100' };

  // 1. Mock 8 tasks (as in user screenshot)
  const mockTasks = Array.from({ length: 8 }, (_, i) => ({
    _id: 't' + (i + 1),
    title: 'Task Number ' + (i + 1),
    overallStatus: 'pending',
    dueDateTime: new Date('2026-11-10T10:00:00Z'),
    taskFor: 'self',
    createdBy: 'u1'
  }));

  console.log('--- Test 1: Query tasks (how many total task i have) ---');
  const resTasks = await parseTaskRequest({ req: { user }, message: 'how many total task i have' }, { tasks: mockTasks });

  console.log('Task Reply:\n', resTasks.reply);
  assert.ok(resTasks.reply.includes('8 found'), 'Must say 8 found');
  for (let i = 1; i <= 8; i++) {
    assert.ok(resTasks.reply.includes(`${i}. **Task Number ${i}**`), `Must include Task Number ${i}`);
  }

  // 2. Mock 7 projects (as in user screenshot where 6 projects existed but only 5 were shown)
  const mockProjects = Array.from({ length: 7 }, (_, i) => ({
    _id: 'p' + (i + 1),
    projectName: 'Project Alpha ' + (i + 1),
    status: 'Active'
  }));

  console.log('\n--- Test 2: Query projects (mere kitne projects hain) ---');
  const resProj = await parseTaskRequest({ req: { user }, message: 'mere kitne projects hain' }, { accessibleProjects: mockProjects });

  console.log('Project Reply:\n', resProj.reply);
  assert.ok(resProj.reply.includes('7 project(s)'));
  for (let i = 1; i <= 7; i++) {
    assert.ok(resProj.reply.includes(`${i}. **Project Alpha ${i}**`), `Must include Project Alpha ${i}`);
  }

  // 3. Mock 6 clients
  const mockClients = Array.from({ length: 6 }, (_, i) => ({
    _id: 'c' + (i + 1),
    client: 'Client Name ' + (i + 1),
    company: 'Company ' + (i + 1)
  }));

  console.log('\n--- Test 3: Query clients (mere kitne clients hain) ---');
  const resClients = await parseTaskRequest({ req: { user }, message: 'mere kitne clients hain' }, { accessibleClients: mockClients });

  console.log('Client Reply:\n', resClients.reply);
  assert.ok(resClients.reply.includes('6 client(s)'));
  for (let i = 1; i <= 6; i++) {
    assert.ok(resClients.reply.includes(`${i}. **Client Name ${i}**`), `Must include Client Name ${i}`);
  }

  console.log('\n=============================================================');
  console.log('>>> ALL 8 TASKS, PROJECTS & CLIENTS DISPLAY TEST PASSED 100%! <<<');
  console.log('=============================================================');
})();

