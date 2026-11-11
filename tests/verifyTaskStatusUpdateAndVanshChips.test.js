const assert = require('assert');
const { parseTaskRequest, handleCrmUpdate, resolveUserAllowedIntents } = require('../services/ai/taskAgentService');
const { filterWelcomeButtonsByPermissions } = require('../../CIIS/src/hooks/taskAgentPureLogic');

async function runTests() {
  console.log('=== TEST SUITE: verifyTaskStatusUpdateAndVanshChips ===\n');

  // --------------------------------------------------------------------------
  // TEST 1: Task Status Update updates statusByUser, overallStatus, and completed
  // --------------------------------------------------------------------------
  console.log('--- Test 1: Task Status Update via AI Assistant ---');
  const userId = '6acdf4f3d2a8c22d6f2b2e27';
  const testUser = {
    _id: userId,
    name: 'Vansh Test',
    role: 'Employee',
    companyRole: 'Employee',
    companyCode: 'TECH100'
  };

  const mockTask = {
    _id: 'task_auto_1',
    title: 'Automated Test Task',
    status: 'in-progress',
    overallStatus: 'in-progress',
    taskFor: 'self',
    statusByUser: [
      { user: userId, status: 'in-progress', updatedAt: new Date('2026-11-10T10:00:00Z') }
    ],
    statusHistory: [
      { status: 'in-progress', changedBy: userId, changedByType: 'user', changedAt: new Date('2026-11-10T10:00:00Z') }
    ],
    completed: false
  };

  const req = { user: testUser };
  const deps = { tasks: [mockTask] };

  const updateResult = await handleCrmUpdate(
    'Automated Test Task task ka status change karke completed kardo',
    req,
    deps,
    'hinglish',
    {}
  );

  console.log('AI Response Reply:', updateResult.reply);
  console.log('taskUpdated flag:', updateResult.taskUpdated);
  console.log('Updated Task status:', mockTask.status);
  console.log('Updated Task overallStatus:', mockTask.overallStatus);
  console.log('Updated Task completed:', mockTask.completed);
  console.log('Updated Task statusByUser:', JSON.stringify(mockTask.statusByUser));
  console.log('Updated Task statusHistory length:', mockTask.statusHistory.length);

  assert.strictEqual(updateResult.taskUpdated, true, 'Result must flag taskUpdated');
  assert.strictEqual(mockTask.status, 'completed', 'status must be completed');
  assert.strictEqual(mockTask.overallStatus, 'completed', 'overallStatus must be completed');
  assert.strictEqual(mockTask.completed, true, 'completed flag must be true');

  const userStatusObj = mockTask.statusByUser.find(s => String(s.user) === userId);
  assert.ok(userStatusObj, 'Must find statusByUser for user');
  assert.strictEqual(userStatusObj.status, 'completed', 'statusByUser.status must be updated to completed!');

  const historyLast = mockTask.statusHistory[mockTask.statusHistory.length - 1];
  assert.strictEqual(historyLast.status, 'completed', 'statusHistory must log completed change');

  console.log('✔ Test 1 Passed: Task status correctly updated in DB model and statusByUser\n');

  // --------------------------------------------------------------------------
  // TEST 2: Vansh Test RBAC Chips - Must NOT contain "Add new client"
  // --------------------------------------------------------------------------
  console.log('--- Test 2: Vansh Test RBAC Chips without Client Access ---');
  const vanshSidebarConfig = {
    menuItems: [
      { id: 'dashboard', name: 'Dashboard', path: '/ciisUser/dashboard' },
      { id: 'attendance', name: 'Attendance', path: '/ciisUser/attendance' },
      { id: 'task-management', name: 'Task Management', path: '/ciisUser/task-management' },
      { id: 'my-projects', name: 'My Projects', path: '/ciisUser/my-projects' }
    ]
  };

  // Even if companyDetails originally had allowedPages with emp-client:
  // With our fix, getStoredPagePermissions does NOT include companyDetails.allowedPages!
  const vanshPagePermissions = ['/ciisUser/dashboard', '/ciisUser/attendance', '/ciisUser/task-management', '/ciisUser/my-projects'];

  const vanshChipsEn = filterWelcomeButtonsByPermissions(testUser, {
    sidebarConfig: vanshSidebarConfig,
    pagePermissions: vanshPagePermissions,
    language: 'en'
  });

  const chipLabelsEn = vanshChipsEn.map(c => c.label);
  console.log('Vansh English Chips:', chipLabelsEn);

  assert.ok(chipLabelsEn.includes('Create personal task'), 'Must include Create personal task');
  assert.ok(chipLabelsEn.includes('Create task in project'), 'Must include Create task in project');
  assert.ok(!chipLabelsEn.includes('Add new client'), 'Must NOT include Add new client when user lacks client access!');
  assert.ok(!chipLabelsEn.includes('Assign task to someone'), 'Must NOT include Assign task to someone');
  assert.ok(!chipLabelsEn.includes('Create new project'), 'Must NOT include Create new project');

  const vanshChipsHi = filterWelcomeButtonsByPermissions(testUser, {
    sidebarConfig: vanshSidebarConfig,
    pagePermissions: vanshPagePermissions,
    language: 'hinglish'
  });
  const chipLabelsHi = vanshChipsHi.map(c => c.label);
  console.log('Vansh Hinglish Chips:', chipLabelsHi);

  assert.ok(chipLabelsHi.includes('Personal task banana'), 'Must include Personal task banana');
  assert.ok(chipLabelsHi.includes('Project mein task banana/assign karna'), 'Must include Project task in Hinglish');
  assert.ok(!chipLabelsHi.includes('Naya client jodein'), 'Must NOT include Naya client jodein!');

  console.log('✔ Test 2 Passed: Vansh Test does not see Add new client chip\n');

  // --------------------------------------------------------------------------
  // TEST 3: User WITH Client Access DOES see "Add new client"
  // --------------------------------------------------------------------------
  console.log('--- Test 3: User With Client Page in Sidebar Config ---');
  const clientManagerSidebarConfig = {
    menuItems: [
      { id: 'dashboard', name: 'Dashboard', path: '/ciisUser/dashboard' },
      { id: 'emp-client', name: 'Clients', path: '/ciisUser/emp-client' }
    ]
  };

  const clientManagerChips = filterWelcomeButtonsByPermissions(testUser, {
    sidebarConfig: clientManagerSidebarConfig,
    pagePermissions: ['/ciisUser/dashboard', '/ciisUser/emp-client'],
    language: 'en'
  });

  const cmLabels = clientManagerChips.map(c => c.label);
  console.log('Client Manager Chips:', cmLabels);
  assert.ok(cmLabels.includes('Add new client'), 'User with emp-client MUST see Add new client');

  console.log('✔ Test 3 Passed: User with client access sees Add new client\n');

  // --------------------------------------------------------------------------
  // TEST 4: Backend resolveUserAllowedIntents for Vansh
  // --------------------------------------------------------------------------
  console.log('--- Test 4: Backend resolveUserAllowedIntents for Vansh ---');
  const backendAllowedVansh = resolveUserAllowedIntents(testUser, { hasAccess: false, isOwner: false }, {
    sidebarMenuItems: vanshSidebarConfig.menuItems,
    accessibleProjects: [{ _id: 'proj_1', name: 'ai agent' }]
  });
  console.log('Backend Allowed Intents for Vansh:', backendAllowedVansh);

  assert.ok(backendAllowedVansh.includes('self_task'), 'Must allow self_task');
  assert.ok(backendAllowedVansh.includes('task_project'), 'Must allow task_project');
  assert.ok(!backendAllowedVansh.includes('create_client'), 'Must NOT allow create_client for Vansh');
  assert.ok(!backendAllowedVansh.includes('task_assigned_user'), 'Must NOT allow task_assigned_user');

  console.log('✔ Test 4 Passed: Backend strictly denies create_client for Vansh\n');

  console.log('====================================');
  console.log('ALL 4 TESTS PASSED SUCCESSFULLY! 🎯');
  console.log('====================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

