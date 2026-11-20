const assert = require('assert');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

async function runTests() {
  console.log('--- STARTING PROJECT INQUIRY & TASK UPDATE TESTS ---');

  const regularUser = {
    _id: '507f1f77bcf86cd799439022',
    name: 'Pankaj Bhatia',
    role: 'user',
    companyCode: 'COMP1'
  };

  const outsideUser = {
    _id: '507f1f77bcf86cd799439033',
    name: 'Outside User',
    role: 'user',
    companyCode: 'COMP1'
  };

  const sampleProject = {
    _id: '6ae9cdda627d4aeb5cc6862b',
    projectName: 'ai agent',
    status: 'active',
    priority: 'high',
    startDate: new Date('2026-11-03'),
    endDate: new Date('2026-11-07'),
    description: 'abcd',
    users: [
      { _id: '507f1f77bcf86cd799439022', name: 'Pankaj Bhatia', email: 'pankaj@ciis.in', role: 'Developer' },
      { _id: '507f1f77bcf86cd799439044', name: 'Vansh Test', email: 'vansh@ciis.in', role: 'Tester' },
      { _id: '507f1f77bcf86cd799439055', name: 'Test Admin', email: 'admin@ciis.in', role: 'Project Manager' }
    ],
    tasks: [
      {
        _id: '6ae9cdda627d4aeb5cc68699',
        title: 'hlo1',
        description: 'zxcvbnjm',
        status: 'pending',
        priority: 'medium',
        assignedUsers: [
          { _id: '507f1f77bcf86cd799439022', name: 'Pankaj Bhatia' },
          { _id: '507f1f77bcf86cd799439044', name: 'Vansh Test' }
        ],
        dueDateTime: new Date('2026-11-11T17:05:00'),
        remarks: [],
        activityLogs: []
      },
      {
        _id: '6ae9cdda627d4aeb5cc68688',
        title: 'zxcvb',
        description: 'sdfc',
        status: 'pending',
        priority: 'medium',
        assignedUsers: [],
        dueDateTime: null,
        remarks: [],
        activityLogs: []
      },
      {
        _id: '6ae9cdda627d4aeb5cc68677',
        title: 'hlo 4',
        description: 'sdfgh',
        status: 'on hold',
        priority: 'high',
        assignedUsers: [
          { _id: '507f1f77bcf86cd799439055', name: 'Test Admin' }
        ],
        dueDateTime: new Date('2026-11-12T10:00:00'),
        remarks: [],
        activityLogs: []
      }
    ]
  };

  const mockDeps = {
    accessibleProjects: [sampleProject],
    projects: [sampleProject],
    users: sampleProject.users,
    companyUsers: sampleProject.users
  };

  // TEST 1: Project Details inquiry by user with access
  console.log('Test 1: Project Details Inquiry (matching Image 2)...');
  const res1 = await parseTaskRequest({
    message: 'ai agent project details',
    req: { user: regularUser }
  }, mockDeps);

  assert.strictEqual(res1.success, true, 'Should succeed');
  assert(res1.reply.includes('📁 **Project: ai agent**'), 'Reply should have project title');
  assert(res1.reply.includes('• **Status**: Active'), 'Reply should show status');
  assert(res1.reply.includes('• **Priority**: High'), 'Reply should show priority');
  assert(res1.reply.includes('3 Members (Pankaj Bhatia, Vansh Test, Test Admin)'), 'Reply should show members count and names');
  assert(res1.reply.includes('• **Total Tasks**: 3 Tasks (2 Pending, 1 On Hold)'), 'Reply should show total tasks and breakdown');
  assert(res1.chips.some(c => c.action?.type === 'view_project_tasks'), 'Should include View Tasks chip');
  assert(res1.chips.some(c => c.action?.type === 'view_project_members'), 'Should include Team members chip');
  console.log('✅ Test 1 Passed: Project Details formatted correctly.');

  // TEST 2: Team Members inquiry ("kitne team members hai or kon kon sai team members hai")
  console.log('Test 2: Team Members Inquiry...');
  const res2 = await parseTaskRequest({
    message: 'ai agent project mein kitne team members hai or kon kon sai team members hai',
    req: { user: regularUser }
  }, mockDeps);

  assert.strictEqual(res2.success, true, 'Should succeed');
  assert(res2.reply.includes('3 team member(s)'), 'Should report 3 team members');
  assert(res2.reply.includes('Pankaj Bhatia'), 'Should include Pankaj Bhatia');
  assert(res2.reply.includes('Vansh Test'), 'Should include Vansh Test');
  assert(res2.reply.includes('Test Admin'), 'Should include Test Admin');
  assert(res2.reply.includes('pankaj@ciis.in'), 'Should include member email');
  console.log('✅ Test 2 Passed: Team members inquiry matches requirements.');

  // TEST 3: Project Tasks inquiry ("view tasks" / "project tasks dikhao" matching Image 3)
  console.log('Test 3: Project Tasks Inquiry...');
  const res3 = await parseTaskRequest({
    message: 'ai agent project ke tasks dikhao',
    req: { user: regularUser }
  }, mockDeps);

  assert.strictEqual(res3.success, true, 'Should succeed');
  assert(res3.reply.includes('📋 Project **ai agent** ke tasks (Total 3 tasks):'), 'Should show total tasks heading');
  assert(res3.reply.includes('1. **hlo1**'), 'Should show task 1 hlo1');
  assert(res3.reply.includes('Status**: Pending | **Priority**: Medium'), 'Should show status and priority');
  assert(res3.reply.includes('Assignees**: Pankaj Bhatia, Vansh Test'), 'Should show assignees');
  assert(res3.reply.includes('2. **zxcvb**'), 'Should show task 2');
  assert(res3.reply.includes('3. **hlo 4**'), 'Should show task 3');
  assert(res3.chips.some(c => c.action?.type === 'update_project_task_status'), 'Should offer status update chip');
  console.log('✅ Test 3 Passed: Project tasks cards match Image 3.');

  // TEST 4: Clicking "Check project details" chip ({ type: 'view_project', projectId })
  console.log('Test 4: Clicking "Check project details" chip...');
  const res4 = await parseTaskRequest({
    action: { type: 'view_project', projectId: '6ae9cdda627d4aeb5cc6862b' },
    req: { user: regularUser }
  }, mockDeps);

  assert.strictEqual(res4.success, true, 'Chip action should succeed');
  assert(res4.reply.includes('📁 **Project: ai agent**'), 'Should return project details');
  assert(!res4.reply.includes('Aapke account mein es page ka access nahi hai'), 'Should NEVER show permission denied error');
  console.log('✅ Test 4 Passed: Chip action returns project details without permission error.');

  // TEST 5: Project Task Status update with remark ("hlo1 task ka status change karke in progress kardo with remark all done")
  console.log('Test 5: Project Task Status update with remark...');
  const res5 = await parseTaskRequest({
    message: 'hlo1 task ka status change karke in progress kardo with remark all done',
    req: { user: regularUser }
  }, mockDeps);

  assert.strictEqual(res5.success, true, 'Status update should succeed');
  assert.strictEqual(res5.taskUpdated, true, 'Should flag taskUpdated: true');
  assert(res5.reply.includes('hlo1'), 'Reply should name the updated task');
  assert(res5.reply.includes('in progress'), 'Reply should mention in progress status');
  assert(res5.reply.includes('all done'), 'Reply should display remark');
  assert.strictEqual(sampleProject.tasks[0].status, 'in progress', 'Task status in project should be updated');
  assert(sampleProject.tasks[0].remarks.some(r => r.text === 'all done'), 'Remark should be saved');
  console.log('✅ Test 5 Passed: Project task status and remark updated successfully.');

  // TEST 6: Project Task Edit ("hlo1 task ko edit karke priority high kardo")
  console.log('Test 6: Project Task Edit...');
  const res6 = await parseTaskRequest({
    message: 'hlo1 task ko edit karke priority high kardo',
    req: { user: regularUser }
  }, mockDeps);

  assert.strictEqual(res6.success, true, 'Edit should succeed');
  assert.strictEqual(res6.taskUpdated, true, 'Should flag taskUpdated: true');
  assert(res6.reply.toLowerCase().includes('high'), 'Reply should confirm high priority');
  assert.strictEqual(sampleProject.tasks[0].priority, 'high', 'Task priority in project should be updated');
  console.log('✅ Test 6 Passed: Project task priority edited successfully.');

  // TEST 7: Inaccessible project access denial for outsideUser
  console.log('Test 7: RBAC Access denial for outside user...');
  const res7 = await parseTaskRequest({
    action: { type: 'view_project', projectId: '6ae9cdda627d4aeb5cc6862b' },
    req: { user: outsideUser }
  }, {
    ...mockDeps,
    accessibleProjects: [sampleProject], // project exists, but outsideUser is not in project.users
    projects: [sampleProject]
  });

  assert(res7.reply.includes('access nahi hai') || res7.reply.includes('access'), 'Should deny access');
  console.log('✅ Test 7 Passed: Outside user is strictly denied access.');

  console.log('\n🎉 ALL 7 PROJECT INQUIRY & TASK UPDATE TESTS PASSED!');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
