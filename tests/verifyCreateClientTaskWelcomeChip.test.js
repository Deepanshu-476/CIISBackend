const assert = require('node:assert');
const { resolveUserAllowedIntents } = require('../services/ai/taskAgentService');
const { buildChips } = require('../services/ai/formRegistry');

console.log('=== TEST 1: Admin / Owner should see "Create client task" in welcome chips ===');
const adminUser = {
  _id: 'u_admin',
  name: 'Test Admin',
  role: 'Super Admin',
  permissions: []
};
const adminAllowed = resolveUserAllowedIntents(adminUser, {}, {});
assert.ok(adminAllowed.includes('create_client_task'), 'Admin should have create_client_task');
const adminChipsEn = buildChips(null, 'welcome', { allowedIntents: adminAllowed, language: 'en' });
assert.ok(adminChipsEn.some(c => c.label === 'Create client task'), 'Admin should see "Create client task" chip in EN');
const adminChipsHi = buildChips(null, 'welcome', { allowedIntents: adminAllowed, language: 'hi' });
assert.ok(adminChipsHi.some(c => c.label === 'Client task banana'), 'Admin should see "Client task banana" chip in Hinglish');
console.log('✓ Test 1 passed!');

console.log('\n=== TEST 2: Employee with "task-management" / "Create Task" page should see "Create client task" ===');
const taskUser = {
  _id: 'u_emp',
  name: 'Vansh Employee',
  role: 'Employee',
  allowedPages: ['/ciisUser/task-management']
};
const taskAllowed = resolveUserAllowedIntents(taskUser, {}, {});
assert.ok(taskAllowed.includes('create_client_task'), 'Task management page user should have create_client_task');
const taskChips = buildChips(null, 'welcome', { allowedIntents: taskAllowed, language: 'en' });
assert.ok(taskChips.some(c => c.label === 'Create client task'), 'Task management user should see chip');
console.log('✓ Test 2 passed!');

console.log('\n=== TEST 3: Regular employee WITHOUT task-management or client access should NOT see "Create client task" ===');
const plainEmp = {
  _id: 'u_plain',
  name: 'Plain Employee',
  role: 'Employee',
  allowedPages: ['/ciisUser/attendance', '/ciisUser/leaves']
};
const plainAllowed = resolveUserAllowedIntents(plainEmp, {}, {});
assert.ok(!plainAllowed.includes('create_client_task'), 'Plain employee should not have create_client_task');
const plainChips = buildChips(null, 'welcome', { allowedIntents: plainAllowed, language: 'en' });
assert.ok(!plainChips.some(c => c.label === 'Create client task'), 'Plain employee should NOT see chip');
console.log('✓ Test 3 passed!');

console.log('\n=== TEST 4: Logged-in employee with standard req.user (no allowedPages set) has Create Task access by default ===');
const vanshUser = {
  _id: 'u_vansh',
  name: 'Vansh Gupta',
  role: 'employee',
  companyCode: 'TECH334753'
};
const vanshAllowed = resolveUserAllowedIntents(vanshUser, {}, {});
assert.ok(vanshAllowed.includes('create_client_task'), 'Vansh should have create_client_task allowed');
const vanshChips = buildChips(null, 'welcome', { allowedIntents: vanshAllowed, language: 'en' });
assert.ok(vanshChips.some(c => c.label === 'Create client task'), 'Vansh should see Create client task chip');
console.log('✓ Test 4 passed!');

console.log('\n=== TEST 5: parseTaskRequest with action set_intent create_client_task for employee Vansh must NOT be permission denied ===');
const { parseTaskRequest } = require('../services/ai/taskAgentService');
(async () => {
  const parseRes = await parseTaskRequest({
    req: { user: vanshUser },
    action: { type: 'set_intent', intent: 'create_client_task' },
    message: ''
  }, {
    accessibleClients: [{ _id: 'c1', client: 'saniha - cds', services: ['Web Development'] }],
    accessibleProjects: []
  });
  assert.notStrictEqual(parseRes.intent?.type, 'permission_denied', 'Must NOT be permission denied');
  assert.ok(!parseRes.reply.includes('access nahi hai'), 'Reply must not deny permission');
  assert.ok(parseRes.reply.includes('client') || parseRes.field === 'client', 'Must prompt for client');
  console.log('✓ Test 5 passed!');

  console.log('\n======================================================');
  console.log('>>> ALL WELCOME CHIP RBAC VERIFICATIONS PASSED 100% <<<');
  console.log('======================================================');
})();

