const assert = require('assert');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
const { filterWelcomeButtonsByPermissions } = require('../../CIIS/src/hooks/taskAgentPureLogic');

async function runComprehensiveTests() {
  console.log('--- STARTING COMPREHENSIVE QA TEST SUITE ---');

  // MOCK DATA
  const mockUserPankaj = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Pankaj Bhatia',
    userName: 'pankaj',
    role: 'user',
    userRole: 'Developer',
    companyCode: 'COMP1',
    company: '654321654321654321654321'
  };

  const mockAdminUser = {
    _id: '507f1f77bcf86cd799439099',
    name: 'Test Admin',
    userName: 'admin',
    role: 'admin',
    userRole: 'Super Admin',
    isSuperAdmin: true,
    companyCode: 'COMP1',
    company: '654321654321654321654321'
  };

  // Pankaj's sidebar config (has 'Create Task' and 'My Projects', but NO 'Admin Create Task')
  const pankajSidebarConfig = {
    menuItems: [
      { name: 'Dashboard', path: '/ciisUser/dashboard' },
      { name: 'Work', children: [
        { name: 'Create Task', path: '/ciisUser/create-task' },
        { name: 'My Projects', path: '/ciisUser/projects' }
      ]}
    ]
  };

  // Admin's sidebar config (has 'Admin Create Task')
  const adminSidebarConfig = {
    menuItems: [
      { name: 'Dashboard', path: '/admin/dashboard' },
      { name: 'Work', children: [
        { name: 'Create Task', path: '/ciisUser/create-task' },
        { name: 'My Projects', path: '/ciisUser/projects' },
        { name: 'Admin Create Task', path: '/ciisUser/admin-task-create' }
      ]}
    ]
  };

  // Shared project
  const sampleProject = {
    _id: '6ae9cdda627d4aeb5cc6862b',
    projectName: 'ai agent',
    status: 'active',
    priority: 'high',
    users: [
      { _id: '507f1f77bcf86cd799439011', name: 'Pankaj Bhatia', role: 'Developer' },
      { _id: '507f1f77bcf86cd799439099', name: 'Test Admin', role: 'Super Admin' }
    ],
    tasks: [
      {
        _id: 'task-proj-1',
        title: 'hlo1',
        status: 'pending',
        priority: 'medium',
        assignedUsers: ['507f1f77bcf86cd799439011'],
        remarks: []
      },
      {
        _id: 'task-proj-2',
        title: 'Implement Voice UI',
        status: 'in progress',
        priority: 'high',
        assignedUsers: ['507f1f77bcf86cd799439011'],
        remarks: []
      }
    ]
  };

  // Personal tasks
  const samplePersonalTasks = [
    {
      _id: 'task-pers-1',
      title: 'hlo',
      status: 'pending',
      overallStatus: 'pending',
      priority: 'medium',
      user: '507f1f77bcf86cd799439011'
    },
    {
      _id: 'task-pers-2',
      title: 'Testing of CIIS AI assistant',
      status: 'pending',
      overallStatus: 'pending',
      priority: 'high',
      user: '507f1f77bcf86cd799439011'
    }
  ];

  // Client list where a client is named 'CIIS'
  const sampleClients = [
    {
      _id: 'client-1',
      client: 'CIIS',
      name: 'CIIS Network Corp',
      services: ['AI Development'],
      status: 'Active'
    }
  ];

  const commonDeps = {
    accessibleProjects: [sampleProject],
    projects: [sampleProject],
    tasks: samplePersonalTasks,
    accessibleClients: sampleClients,
    clients: sampleClients
  };

  // =========================================================================
  // TEST 1: Issue 1 - Clean extraction of task candidate with English stopwords
  // =========================================================================
  console.log('\n[TEST 1] Task Status Update Extraction: "change the status of hlo task to completed"');
  const res1 = await parseTaskRequest({
    message: 'change the status of hlo task to completed',
    language: 'en',
    req: { user: mockUserPankaj }
  }, commonDeps);

  assert.strictEqual(res1.success, true, 'Status update must succeed');
  assert.ok(/completed/i.test(res1.reply), 'Reply must confirm completion');
  assert.strictEqual(samplePersonalTasks[0].status, 'completed', 'hlo task status must be completed');
  console.log('✓ TEST 1 passed:', res1.reply);

  // =========================================================================
  // TEST 2: Issue 1b - "change the status of hlo task make it completed"
  // =========================================================================
  console.log('\n[TEST 2] Task Status Update with "make it": "change the status of hlo task make it completed"');
  samplePersonalTasks[0].status = 'pending'; // reset
  const res2 = await parseTaskRequest({
    message: 'change the status of hlo task make it completed',
    language: 'en',
    req: { user: mockUserPankaj }
  }, commonDeps);

  assert.strictEqual(res2.success, true);
  assert.strictEqual(samplePersonalTasks[0].status, 'completed');
  console.log('✓ TEST 2 passed:', res2.reply);

  // =========================================================================
  // TEST 3: Issue 2 - Welcome Chips RBAC for Pankaj (No Admin Create Task)
  // =========================================================================
  console.log('\n[TEST 3] Welcome chips RBAC: Pankaj must NOT have "Assign task to someone" chip');
  const pankajChips = filterWelcomeButtonsByPermissions(mockUserPankaj, {
    sidebarConfig: pankajSidebarConfig,
    language: 'en'
  });
  const pankajLabels = pankajChips.map(c => c.label);
  console.log('Pankaj chips:', pankajLabels);
  assert.ok(pankajLabels.includes('Create personal task'), 'Should include Personal task');
  assert.ok(pankajLabels.includes('Create task in project'), 'Should include Create task in project');
  assert.ok(!pankajLabels.includes('Assign task to someone'), 'MUST NOT include Assign task to someone');
  assert.strictEqual(pankajChips.length, 2, 'Pankaj should have exactly 2 chips');

  const adminChips = filterWelcomeButtonsByPermissions(mockAdminUser, {
    sidebarConfig: adminSidebarConfig,
    language: 'en'
  });
  const adminLabels = adminChips.map(c => c.label);
  console.log('Admin chips:', adminLabels);
  assert.ok(adminLabels.includes('Assign task to someone'), 'Admin MUST have Assign task to someone');
  console.log('✓ TEST 3 passed: RBAC chips strictly enforced');

  // =========================================================================
  // TEST 4: Issue 3 - Updating "Testing of CIIS AI assistant" personal task
  // User does NOT have client access, but this is a Personal Task!
  // =========================================================================
  console.log('\n[TEST 4] Personal task with "CIIS" in title: Must NOT trigger client permission block');
  const res4 = await parseTaskRequest({
    message: 'mere Testing of CIIS AI assistant ka status change karke completed kardo',
    language: 'hinglish',
    req: { user: mockUserPankaj }
  }, commonDeps);

  assert.strictEqual(res4.success, true, 'Must succeed without client permission error');
  assert.ok(!/Client page ka access nahi hai/i.test(res4.reply), 'Must NOT mention client permission denial');
  assert.ok(/completed/i.test(res4.reply), 'Reply must confirm completed');
  assert.strictEqual(samplePersonalTasks[1].status, 'completed', 'Personal task status must be completed');
  console.log('✓ TEST 4 passed:', res4.reply);

  // =========================================================================
  // TEST 5: Issue 4 - Multi-turn Project Context Retention
  // Turn 1: Project Details query. Turn 2: "es project mai total kitne tasks hain ?"
  // =========================================================================
  console.log('\n[TEST 5] Multi-turn context: "es project mai total kitne tasks hain ?"');
  // First turn:
  const turn1 = await parseTaskRequest({
    message: 'ai agent project details',
    req: { user: mockUserPankaj }
  }, commonDeps);

  assert.ok(turn1.draft?.lastProjectId, 'Turn 1 must save lastProjectId in draft');
  assert.strictEqual(turn1.draft.lastProjectId, '6ae9cdda627d4aeb5cc6862b');

  // Second turn: pass draft and history
  const turn2 = await parseTaskRequest({
    message: 'es project mai total kitne tasks hain ?',
    draft: turn1.draft,
    history: [
      { role: 'user', content: 'ai agent project details' },
      { role: 'assistant', content: turn1.reply }
    ],
    req: { user: mockUserPankaj }
  }, commonDeps);

  console.log('Turn 2 reply:\n', turn2.reply);
  assert.ok(/ai agent/i.test(turn2.reply), 'Turn 2 must reference "ai agent" project');
  assert.ok(/hlo1/i.test(turn2.reply), 'Turn 2 must list project task "hlo1"');
  assert.ok(/Implement Voice UI/i.test(turn2.reply), 'Turn 2 must list project task "Implement Voice UI"');
  assert.ok(!/kul 51 task/i.test(turn2.reply), 'Must NOT return the 51 personal tasks!');
  console.log('✓ TEST 5 passed: Multi-turn project tasks answered accurately');

  // =========================================================================
  // TEST 6: Project Task Update inside "ai agent"
  // =========================================================================
  console.log('\n[TEST 6] Project task update: "hlo1 task ka status change karke completed kardo"');
  const res6 = await parseTaskRequest({
    message: 'hlo1 task ka status change karke completed kardo with remark all done',
    req: { user: mockUserPankaj }
  }, commonDeps);

  assert.strictEqual(res6.success, true);
  assert.ok(/completed/i.test(res6.reply));
  assert.strictEqual(sampleProject.tasks[0].status, 'completed');
  assert.ok(sampleProject.tasks[0].remarks.some(r => r.text === 'all done'));
  console.log('✓ TEST 6 passed:', res6.reply);

  // =========================================================================
  // TEST 7: Inaccessible Project Guard
  // Outside user attempting to query or update tasks in a project they do NOT belong to
  // =========================================================================
  console.log('\n[TEST 7] Inaccessible Project RBAC Guard');
  const unassignedUser = {
    _id: '999999999999999999999999',
    name: 'Outside User',
    role: 'user',
    userRole: 'Staff',
    companyCode: 'COMP1'
  };

  const res7 = await parseTaskRequest({
    action: { type: 'view_project', projectId: '6ae9cdda627d4aeb5cc6862b' },
    req: { user: unassignedUser }
  }, {
    accessibleProjects: [sampleProject],
    projects: [sampleProject]
  });

  assert.ok(/access nahi hai/i.test(res7.reply), 'Must deny access to unassigned project');
  console.log('✓ TEST 7 passed: Inaccessible project properly blocked');

  console.log('\n======================================================');
  console.log('🎉 ALL 7 COMPREHENSIVE QA TEST SUITES PASSED FLAWLESSLY!');
  console.log('======================================================\n');
}

runComprehensiveTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
