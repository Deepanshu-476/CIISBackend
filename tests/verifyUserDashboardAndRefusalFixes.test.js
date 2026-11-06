const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

(async () => {
  const user = { _id: 'u_test', name: 'Test', role: 'Company Owner', companyCode: 'TECH334753' };

  const mockUsers = [
    { _id: 'u1', name: 'Vansh Test', role: 'Staff' }
  ];

  const mockProjects = [
    {
      _id: 'p1',
      projectName: 'ai agent',
      status: 'active',
      users: ['u1'],
      tasks: [
        { title: 'tesging', status: 'pending', priority: 'medium' }
      ]
    },
    { _id: 'p2', projectName: 'TechSoft Core Platform', status: 'active', users: [] },
    { _id: 'p3', projectName: 'TechSoft Core Platform', status: 'active', users: [] }, // duplicate entry in DB
    { _id: 'p4', projectName: 'zz ai testing', status: 'planning', users: [] }
  ];

  const mockTasks = [
    { title: 'AI agent', overallStatus: 'overdue', dueDateTime: new Date('2026-11-04T13:30:00.000Z') },
    { title: 'AI agent', overallStatus: 'overdue', dueDateTime: new Date('2026-11-04T12:30:00.000Z') },
    { title: 'ai agent testing', overallStatus: 'overdue', dueDateTime: new Date('2026-11-03T12:30:00.000Z') },
    { title: 'Naya project banao ZZ AI Test', overallStatus: 'completed', dueDateTime: new Date('2026-10-30T11:17:00.000Z') }
  ];

  const deps = {
    accessibleProjects: mockProjects,
    companyUsers: mockUsers,
    tasks: mockTasks,
    now: new Date('2026-11-05T13:08:36.000Z') // 18:38:36 IST on 5 Nov 2026
  };

  console.log('--- Test 1: User asks today tasks (mere aj kai kitne task hain ?) ---');
  const res1 = await parseTaskRequest({
    req: { user },
    message: 'mere aj kai kitne task hain ?'
  }, deps);
  console.log('Reply 1:\n', res1.reply);
  assert.ok(res1.reply.includes('0 task') || res1.reply.includes('koi task scheduled nahi hai'), 'Must report 0 tasks for today');
  assert.ok(!res1.reply.includes('(10 mile)'), 'Must NOT report 10 tasks for today');
  assert.ok(!res1.reply.includes('(4 mile)'), 'Must NOT report past tasks as today tasks');

  console.log('\n--- Test 2: User says "mera new task banao" ---');
  const res2 = await parseTaskRequest({
    req: { user },
    message: 'mera new task banao'
  }, deps);
  console.log('Reply 2:\n', res2.reply);
  console.log('Status 2:', res2.status, 'Field 2:', res2.field);
  assert.ok(!res2.reply.includes('Main aapke liye naya task create nahi kar sakta'), 'Must NOT refuse task creation');
  assert.ok(!res2.reply.includes('sirf CRM data'), 'Must NOT give read-only excuse');
  assert.equal(res2.status, 'needs_input');
  assert.equal(res2.field, 'title');

  console.log('\n--- Test 3: User says "mera ai agent project main vansh ko task assign karo task ka naam tesging" ---');
  const res3 = await parseTaskRequest({
    req: { user },
    message: 'mera ai agent project main vansh ko task assign karo task ka naam tesging'
  }, deps);
  console.log('Reply 3:\n', res3.reply);
  console.log('Status 3:', res3.status, 'Field 3:', res3.field);
  console.log('Draft 3:', {
    project: res3.draft?.projectName,
    assignee: res3.draft?.assigneeName,
    title: res3.draft?.title
  });
  assert.ok(!res3.reply.includes('permission nahi hai'), 'Must NOT claim permission error');
  assert.ok(!res3.reply.includes('manually jaakar'), 'Must NOT tell user to do it manually');
  assert.equal(res3.draft?.projectName, 'ai agent');
  assert.equal(res3.draft?.assigneeName, 'Vansh Test');
  assert.ok(['testing', 'tesging'].includes(res3.draft?.title?.toLowerCase()));
  assert.ok(res3.field === 'description' || res3.field === 'dueDateTime', 'Next slot must be description or dueDateTime');

  console.log('\n--- Test 4: Project list deduplication (mere crm mai total kitne projects hain ?) ---');
  const res4 = await parseTaskRequest({
    req: { user },
    message: 'mere crm mai total kitne projects hain ?'
  }, deps);
  console.log('Reply 4:\n', res4.reply);
  // In mockProjects, TechSoft Core Platform was repeated twice. Total unique: 3 (ai agent, TechSoft Core Platform, zz ai testing)
  assert.ok(res4.reply.includes('3 project(s)'), 'Must report 3 unique projects');
  const countTechSoft = (res4.reply.match(/TechSoft Core Platform/g) || []).length;
  assert.equal(countTechSoft, 1, 'TechSoft Core Platform must appear only once');

  console.log('\n--- Test 5: Project task status mutation (tesging task ka status in-progress kardo) ---');
  const res5 = await parseTaskRequest({
    req: { user },
    message: 'tesging task ka status in-progress kardo'
  }, deps);
  console.log('Reply 5:\n', res5.reply);
  assert.ok(res5.reply.includes('tesging'));
  assert.ok(res5.reply.includes('in-progress'));
  assert.equal(mockProjects[0].tasks[0].status, 'in-progress');

  console.log('\n======================================================');
  console.log('>>> ALL 5 SCREENSHOT & DASHBOARD FIXES PASSED 100%! <<<');
  console.log('======================================================');
})();
