const assert = require('assert');
const { parseTaskRequest, resolveUserAllowedIntents } = require('../services/ai/taskAgentService');
const { filterWelcomeButtonsByPermissions } = require('../../CIIS/src/hooks/taskAgentPureLogic');

async function runTests() {
  console.log('=== TEST SUITE: verifyAllTasksCountAndRbacChips ===\n');

  // --------------------------------------------------------------------------
  // TEST 1: RBAC Greeting Chips for Pankaj (Employee without admin-task-create)
  // --------------------------------------------------------------------------
  console.log('--- Test 1: Frontend filterWelcomeButtonsByPermissions for Pankaj ---');
  const pankajUser = {
    _id: 'u_pankaj',
    name: 'Pankaj',
    role: 'Employee',
    companyRole: 'Employee',
    companyCode: 'TECH100',
    // Pankaj has general Task Management and My Projects, but NOT admin-task-create or admin-project
    allowedPages: ['/ciisUser/task-management', '/ciisUser/my-projects', '/ciisUser/attendance']
  };

  const frontendChipsEn = filterWelcomeButtonsByPermissions(pankajUser, { language: 'en' });
  const chipLabelsEn = frontendChipsEn.map(c => c.label);
  console.log('Pankaj English Chips:', chipLabelsEn);

  assert.ok(chipLabelsEn.includes('Create personal task'), 'Must include Create personal task');
  assert.ok(chipLabelsEn.includes('Create task in project'), 'Must include Create task in project for user with My Projects');
  assert.ok(!chipLabelsEn.includes('Assign task to someone'), 'Must NOT include Assign task to someone');
  assert.ok(!chipLabelsEn.includes('Create new project'), 'Must NOT include Create new project');

  const frontendChipsHi = filterWelcomeButtonsByPermissions(pankajUser, { language: 'hinglish' });
  const chipLabelsHi = frontendChipsHi.map(c => c.label);
  console.log('Pankaj Hinglish Chips:', chipLabelsHi);

  assert.ok(chipLabelsHi.includes('Personal task banana'), 'Must include Personal task banana');
  assert.ok(chipLabelsHi.includes('Project mein task banana/assign karna'), 'Must include Project task in Hinglish');
  assert.ok(!chipLabelsHi.includes('Kisi ko task assign karna'), 'Must NOT include Kisi ko task assign karna');
  assert.ok(!chipLabelsHi.includes('Naya project banana'), 'Must NOT include Naya project banana');

  console.log('✔ Test 1 Passed: Pankaj sees personal task and project task creation, but not assign task or new project\n');

  // --------------------------------------------------------------------------
  // TEST 2: Backend resolveUserAllowedIntents for Pankaj
  // --------------------------------------------------------------------------
  console.log('--- Test 2: Backend resolveUserAllowedIntents for Pankaj ---');
  const backendAllowed = resolveUserAllowedIntents(pankajUser, { hasAccess: false, isOwner: false });
  console.log('Pankaj Backend Allowed Intents:', backendAllowed);

  assert.ok(backendAllowed.includes('self_task'), 'Must allow self_task');
  assert.ok(backendAllowed.includes('task_project'), 'Must allow task_project for user with My Projects');
  assert.ok(!backendAllowed.includes('task_assigned_user'), 'Must NOT allow task_assigned_user');
  assert.ok(!backendAllowed.includes('create_project'), 'Must NOT allow create_project');

  console.log('✔ Test 2 Passed: Backend strictly denies task_assigned_user for Pankaj\n');

  // --------------------------------------------------------------------------
  // TEST 3: Admin User sees full privileged chips
  // --------------------------------------------------------------------------
  console.log('--- Test 3: Privileged Admin User ---');
  const adminUser = {
    _id: 'u_admin',
    name: 'Test Admin',
    role: 'Company Owner',
    companyRole: 'Company Owner',
    companyCode: 'TECH100'
  };

  const adminChips = filterWelcomeButtonsByPermissions(adminUser, { language: 'en' });
  const adminLabels = adminChips.map(c => c.label);
  console.log('Admin Chips:', adminLabels);
  assert.ok(adminLabels.includes('Create personal task'));
  assert.ok(adminLabels.includes('Assign task to someone'));
  assert.ok(adminLabels.includes('Create new project'));

  console.log('✔ Test 3 Passed: Admin user has full access\n');

  // --------------------------------------------------------------------------
  // TEST 4: Unified Task Query (how many all time all tasks i have ?)
  // --------------------------------------------------------------------------
  console.log('--- Test 4: Unified Task Query: how many all time all tasks i have ? ---');
  // 9 personal tasks + 1 project task (hlo1)
  const mockTasks = [
    { title: 'Testing of CIIS AI assistant', overallStatus: 'pending', taskSource: 'self', dueDateTime: new Date('2026-11-11T14:30:00Z') },
    { title: 'hlo1', overallStatus: 'pending', taskSource: 'project', projectName: 'ai agent', dueDateTime: new Date('2026-11-11T11:35:00Z') },
    { title: ';LIGYUTRDSXFCGVBJNKM', overallStatus: 'pending', taskSource: 'self', dueDateTime: new Date('2026-11-13T04:40:00Z') },
    { title: 'ARETGHYDSHGFDS', overallStatus: 'overdue', isOverdue: true, taskSource: 'self', dueDateTime: new Date('2026-11-09T04:39:00Z') },
    { title: 'DFGHFJASDFGDHF', overallStatus: 'overdue', isOverdue: true, taskSource: 'self', dueDateTime: new Date('2026-11-06T06:40:00Z') },
    { title: 'ASDFGHF', overallStatus: 'rejected', taskSource: 'self', dueDateTime: new Date('2026-11-15T04:38:00Z') },
    { title: 'TEST 4', overallStatus: 'overdue', isOverdue: true, taskSource: 'self', dueDateTime: new Date('2026-11-07T04:38:00Z') },
    { title: 'test 3', overallStatus: 'overdue', isOverdue: true, taskSource: 'self', dueDateTime: new Date('2026-11-06T22:56:00Z') },
    { title: 'test 2', overallStatus: 'overdue', isOverdue: true, taskSource: 'self', dueDateTime: new Date('2026-11-05T22:37:00Z') },
    { title: 'test 1', overallStatus: 'overdue', isOverdue: true, taskSource: 'self', dueDateTime: new Date('2026-11-06T04:36:00Z') }
  ];

  const resAll = await parseTaskRequest({
    req: { user: pankajUser },
    message: 'how many all time all tasks i have ?'
  }, { tasks: mockTasks });

  console.log('Query Reply:\n', resAll.reply);

  assert.ok(resAll.reply.includes('10'), 'Must show 10 tasks in total');
  assert.ok(resAll.reply.includes('hlo1'), 'Must include the project task hlo1');
  assert.ok(resAll.reply.includes('ai agent'), 'Must show project name ai agent');
  assert.ok(resAll.reply.includes('Testing of CIIS AI assistant'), 'Must include personal task');

  console.log('✔ Test 4 Passed: Unified task count returns all 10 tasks including project task hlo1\n');

  // --------------------------------------------------------------------------
  // TEST 5: Hinglish Task Query (mera all time all task ka count batao)
  // --------------------------------------------------------------------------
  console.log('--- Test 5: Hinglish Task Query: all time all task ka count batao ---');
  const resHi = await parseTaskRequest({
    req: { user: pankajUser },
    message: 'all time all task ka count batao'
  }, { tasks: mockTasks });

  console.log('Hinglish Query Reply:\n', resHi.reply);
  assert.ok(resHi.reply.includes('10'), 'Must show 10 tasks in Hinglish');
  assert.ok(resHi.reply.includes('hlo1'), 'Must include hlo1 in Hinglish output');

  console.log('✔ Test 5 Passed: Hinglish all tasks count returns 10 tasks\n');

  // --------------------------------------------------------------------------
  // TEST 6: Project Task Creation Flow for Pankaj
  // --------------------------------------------------------------------------
  console.log('--- Test 6: Project Task Creation Flow for Pankaj ---');
  const mockProjects = [
    { _id: 'p_ai', projectName: 'ai agent', users: [{ _id: 'u_pankaj', name: 'Pankaj' }, { _id: 'u_admin', name: 'Test Admin' }] }
  ];

  const resProj1 = await parseTaskRequest({
    req: { user: pankajUser },
    action: { type: 'set_intent', intent: 'task_project' }
  }, { accessibleProjects: mockProjects });

  console.log('Project Task Turn 1 Status:', resProj1.status);
  console.log('Project Task Turn 1 Field:', resProj1.field);
  console.log('Project Task Turn 1 Reply:\n', resProj1.reply);
  assert.ok(resProj1.reply.includes('ai agent') || resProj1.chips.some(c => c.label.includes('ai agent')), 'Must present accessible project');

  console.log('✔ Test 6 Passed: Project task creation flow is active and accessible for Pankaj\n');

  console.log('======================================================');
  console.log('>>> ALL RBAC CHIPS AND UNIFIED TASK COUNT TESTS PASSED! <<<');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});

