const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

test('Personal task is never hijacked into project task and speaks English', async () => {
  const user = { _id: 'u1', name: 'Test Admin', role: 'Company Owner', companyCode: 'ACME100' };
  const accessibleProjects = [
    { _id: 'p1', projectName: 'zz ai testing', status: 'active', users: ['u1', 'u2'] },
    { _id: 'p2', projectName: 'TechSoft Core Platform', status: 'active', users: ['u1'] }
  ];
  const companyUsers = [
    { _id: 'u1', name: 'Test Admin', role: 'Company Owner' },
    { _id: 'u2', name: 'Gaurav Rajput', role: 'Staff' },
    { _id: 'u3', name: 'Simran Kaur', role: 'Staff' },
    { _id: 'u4', name: 'Aarav Sharma', role: 'Staff' },
    { _id: 'u5', name: 'Vansh Test', role: 'Staff' }
  ];

  const deps = { accessibleProjects, companyUsers };

  console.log('--- Turn 1: User creates personal task with title, desc, due date, reminder ---');
  const msg1 = 'Create my personal task. Task name testing of CRM description creating pipeline due date today 7 pm reminder no left.';
  const res1 = await parseTaskRequest({ req: { user }, message: msg1, draft: {} }, deps);

  console.log('Status 1:', res1.status, 'Field 1:', res1.field);
  console.log('Draft Intent 1:', res1.draft?.intent);
  console.log('Draft taskFor 1:', res1.draft?.taskFor);
  console.log('Draft project 1:', res1.draft?.projectName);
  console.log('Draft title 1:', res1.draft?.title);
  console.log('Draft desc 1:', res1.draft?.description);
  console.log('Draft reminder 1:', res1.draft?.reminder);
  console.log('Language 1:', res1.language);
  console.log('Reply 1:\n', res1.reply);

  assert.equal(res1.draft?.intent, 'self_task', 'Intent MUST be self_task');
  assert.equal(res1.draft?.taskFor, 'self', 'taskFor MUST be self');
  assert.equal(res1.draft?.projectName || null, null, 'Project MUST NOT be zz ai testing');
  assert.equal(res1.language, 'en', 'Language must be detected as en');
  assert.equal(res1.speakTextHi, null, 'speakTextHi must be null for English turn');
  assert.ok(!res1.reply.includes('due date, due date'), 'Must NOT duplicate due date');
  assert.ok(!res1.reply.includes('Understood: project ='), 'Must NOT hijack project');
  assert.ok(!res1.reply.includes('Priority kya rakhein'), 'Must NOT speak Hinglish question for English query');
  assert.ok(res1.reply.includes('What priority should we set'), 'Must ask priority in English');

  console.log('\n--- Turn 2: User responds High ---');
  const res2 = await parseTaskRequest({ req: { user }, message: 'High', draft: res1.draft }, deps);
  console.log('Status 2:', res2.status, 'Field 2:', res2.field);
  console.log('Reply 2:\n', res2.reply);
  assert.equal(res2.draft?.priority, 'high');
  assert.ok(!res2.reply.includes('Task ka status kya rakhna hai'), 'Must NOT ask status in Hinglish');
  assert.ok(res2.reply.includes('What should be the task status'), 'Must ask status in English');

  console.log('\n--- Turn 3: User responds In Progress ---');
  const res3 = await parseTaskRequest({ req: { user }, message: 'In Progress', draft: res2.draft }, deps);
  console.log('Status 3:', res3.status, 'Field 3:', res3.field);
  console.log('Reply 3:\n', res3.reply);
  console.log('Chips 3:\n', res3.chips);

  // In personal task, must NEVER ask for employee/assignee
  assert.ok(!res3.reply.includes('Kiske liye task banana hai'), 'Must NEVER ask for employee name in personal task');
  assert.ok(!res3.reply.includes('Gaurav Rajput'), 'Must NOT list employees');

  console.log('\n--- Turn 4: User clicks Skip remaining / Default ---');
  const res4 = await parseTaskRequest({ req: { user }, action: { type: 'skip_all' }, draft: res3.draft }, deps);
  console.log('Status 4:', res4.status, 'Field 4:', res4.field);
  console.log('Reply 4:\n', res4.reply);
  console.log('Chips 4:\n', res4.chips);

  assert.equal(res4.status, 'ready', 'Status MUST be ready');
  assert.equal(res4.language, 'en');
  assert.ok(res4.reply.includes('Personal task "testing of CRM" is ready') || res4.reply.includes('Shall I create it'), 'Must confirm task ready');
  assert.ok(res4.chips.some(c => c.action?.type === 'confirm'), 'Must offer confirm chip');
});
