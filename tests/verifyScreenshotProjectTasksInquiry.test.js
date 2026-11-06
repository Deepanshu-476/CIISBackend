const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

(async () => {
  const user = { name: 'Test', role: 'Company Owner', companyCode: 'ACME100' };

  const mockUsers = [
    { _id: 'u1', name: 'Aarav Sharma' },
    { _id: 'u2', name: 'Kavya Bansal' },
    { _id: 'u3', name: 'Gaurav Rajput' },
    { _id: 'u4', name: 'Vansh Test' },
    { _id: 'u5', name: 'Test Admin' }
  ];

  const mockProjects = [
    {
      _id: 'p_ciis',
      projectName: 'ciis netwrok',
      status: 'planning',
      users: ['u1', 'u2', 'u3', 'u4', 'u5'],
      tasks: [
        { title: 'Core Network Setup', status: 'pending', priority: 'high' },
        { title: 'API Integration', status: 'in-progress', priority: 'medium' }
      ]
    },
    { _id: 'p1', projectName: 'TechSoft Core Platform', status: 'active', users: ['u1'], tasks: [] },
    { _id: 'p2', projectName: 'zz ai testing', status: 'planning', users: ['u2'], tasks: [] }
  ];

  const deps = {
    accessibleProjects: mockProjects,
    companyUsers: mockUsers
  };

  console.log('--- Test 1: User asks total projects (mere crm mai total kitne projects hain ?) ---');
  const res1 = await parseTaskRequest({ req: { user }, message: 'mere crm mai total kitne projects hain ?' }, deps);
  console.log('Reply 1:\n', res1.reply);
  assert.ok(res1.reply.includes('3 project(s)') || res1.reply.includes('ciis netwrok'));

  console.log('\n--- Test 2: User asks both members AND tasks (ciis network mai kitne members hai and kitne tasks hain ?) ---');
  const res2 = await parseTaskRequest({ req: { user }, message: 'ciis network mai kitne members hai and kitne tasks hain ?' }, deps);
  console.log('Reply 2:\n', res2.reply);
  console.log('Draft 2:', res2.draft);
  assert.ok(res2.reply.includes('ciis netwrok'));
  assert.ok(res2.reply.includes('5 member(s)'));
  assert.ok(res2.reply.includes('2 task(s)'));
  assert.ok(res2.reply.includes('Aarav Sharma'));
  assert.ok(res2.reply.includes('Kavya Bansal'));
  assert.equal(res2.draft?.lastProjectId, 'p_ciis');

  console.log('\n--- Test 3: Follow-up using pronoun (es project mai total kitne task hain ?) ---');
  const res3 = await parseTaskRequest({
    req: { user },
    message: 'es project mai total kitne task hain ?',
    draft: res2.draft
  }, deps);
  console.log('Reply 3:\n', res3.reply);
  assert.ok(res3.reply.includes('ciis netwrok'), 'Must refer to ciis netwrok project');
  assert.ok(res3.reply.includes('2 task(s)'), 'Must report 2 tasks');
  assert.ok(res3.reply.includes('Core Network Setup'), 'Must list project tasks');
  assert.ok(!res3.reply.includes('Aapke paas 3 project(s) ka access hai'), 'Must NOT dump all projects');
  assert.ok(!res3.reply.includes('TechSoft Core Platform'), 'Must NOT list other projects');

  console.log('\n======================================================');
  console.log('>>> ALL SCREENSHOT PROJECT & TASK TESTS PASSED 100%! <<<');
  console.log('======================================================');
})();

