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

console.log('\n======================================================');
console.log('>>> ALL WELCOME CHIP RBAC VERIFICATIONS PASSED 100% <<<');
console.log('======================================================');
