const { parseTaskRequest } = require('../services/ai/taskAgentService');
const assert = require('node:assert');

(async () => {
  const mockReq = {
    user: {
      _id: 'u_admin',
      name: 'Test Admin',
      role: 'Company Owner',
      companyCode: 'TECH334753',
      permissions: ['admin-task-create']
    }
  };

  const deps = {
    accessibleClients: [
      {
        _id: 'client_asdfg_123',
        id: 'client_asdfg_123',
        client: 'asdfg',
        company: 'asdf',
        services: ['Web Development', 'Mobile App Development'],
        projectManager: [
          { _id: 'u1', id: 'u1', name: 'Test Admin', role: 'Company Owner' },
          { _id: 'u2', id: 'u2', name: 'Vansh Test', role: 'Staff' },
          { _id: 'u3', id: 'u3', name: 'Aarav Sharma', role: 'Staff' }
        ]
      }
    ],
    companyUsers: [
      { _id: 'u1', id: 'u1', name: 'Test Admin', role: 'Company Owner' },
      { _id: 'u2', id: 'u2', name: 'Vansh Test', role: 'Staff' },
      { _id: 'u3', id: 'u3', name: 'Aarav Sharma', role: 'Staff' }
    ]
  };

  console.log('=== STEP 1: User clicks "Is Client Ke Liye Task Banayein" ===');
  let draft = {};
  const res1 = await parseTaskRequest({
    req: mockReq,
    message: 'Is Client Ke Liye Task Banayein',
    action: {
      type: 'set_intent',
      intent: 'create_client_task',
      client: 'asdfg',
      clientId: 'client_asdfg_123',
      clientServices: ['Web Development', 'Mobile App Development']
    },
    draft
  }, deps);

  console.log('res1.field:', res1.field);
  console.log('res1.reply:', res1.reply);
  console.log('res1.chips:', res1.chips?.map(c => c.label));
  assert.equal(res1.field, 'service', 'Should directly ask for service, not ambiguous intent');
  assert.match(res1.reply, /Service select kijiye/);
  assert.ok(res1.chips.some(c => c.label === 'Web Development'));
  assert.ok(res1.chips.some(c => c.label === 'Mobile App Development'));

  console.log('\n=== STEP 2: User selects service "Web Development" ===');
  const res2 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'set_client_task_service', service: 'Web Development' },
    draft: res1.draft
  }, deps);

  console.log('res2.field:', res2.field);
  console.log('res2.reply:', res2.reply);
  assert.equal(res2.field, 'title');
  assert.match(res2.reply, /Web Development/);

  console.log('\n=== STEP 3: User inputs task name "testing ai agent" ===');
  const res3 = await parseTaskRequest({
    req: mockReq,
    message: 'testing ai agent',
    draft: res2.draft
  }, deps);

  console.log('res3.field:', res3.field);
  console.log('res3.reply:', res3.reply);
  console.log('res3.chips:', res3.chips?.map(c => c.label));
  assert.equal(res3.field, 'description');
  assert.equal(res3.draft.title, 'testing ai agent');
  assert.ok(res3.chips.some(c => c.label.includes('Skip')));

  console.log('\n=== STEP 4: User skips description ===');
  const res4 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'skip_client_task_description' },
    draft: res3.draft
  }, deps);

  console.log('res4.field:', res4.field);
  console.log('res4.reply:', res4.reply);
  console.log('res4.chips:', res4.chips?.map(c => c.label));
  assert.equal(res4.field, 'dueDateTime');
  assert.equal(res4.draft.description, '');
  assert.ok(res4.chips.some(c => c.label.includes('Aaj shaam')));

  console.log('\n=== STEP 5: User sets Due Date & Time ===');
  const res5 = await parseTaskRequest({
    req: mockReq,
    message: 'Aaj shaam 6:00 PM',
    draft: res4.draft
  }, deps);

  console.log('res5.field:', res5.field);
  console.log('res5.reply:', res5.reply);
  console.log('res5.chips:', res5.chips?.map(c => c.label));
  assert.equal(res5.field, 'assignee', 'Should ask assignee next, NEVER reminder or repeat');
  assert.ok(res5.chips.some(c => c.label === 'Test Admin'));
  assert.ok(res5.chips.some(c => c.label === 'Vansh Test'));
  assert.ok(res5.chips.some(c => c.label === 'Aarav Sharma'));

  console.log('\n=== STEP 6: User selects Assignee "Test Admin" ===');
  const res6 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'set_client_task_assignee', assignee: 'Test Admin', assigneeId: 'u1' },
    draft: res5.draft
  }, deps);

  console.log('res6.field:', res6.field);
  console.log('res6.reply:', res6.reply);
  console.log('res6.chips:', res6.chips?.map(c => c.label));
  assert.equal(res6.field, 'priority');
  assert.equal(res6.draft.assignee, 'Test Admin');

  console.log('\n=== STEP 7: User selects Priority "High" ===');
  const res7 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'set', field: 'priority', value: 'High' },
    draft: res6.draft
  }, deps);

  console.log('res7.status:', res7.status);
  console.log('res7.field:', res7.field);
  console.log('res7.reply:', res7.reply);
  console.log('res7.payload:', res7.payload);
  console.log('res7.preview:', res7.preview);

  assert.equal(res7.status, 'ready');
  assert.equal(res7.payload.endpoint, '/tasks/client-tasks/client/client_asdfg_123/service/Web%20Development');
  assert.equal(res7.payload.method, 'POST');
  assert.equal(res7.payload.fields.name, 'testing ai agent');
  assert.equal(res7.payload.fields.assignee, 'Test Admin');
  assert.equal(res7.payload.fields.priority, 'High');
  assert.equal(res7.preview.entity, 'client_task');
  assert.equal(res7.preview.client, 'asdfg');
  assert.equal(res7.preview.service, 'Web Development');

  console.log('\n=== STEP 8: User confirms creation ===');
  const res8 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'confirm' },
    draft: res7.draft
  }, deps);

  console.log('res8.status:', res8.status);
  console.log('res8.reply:', res8.reply);
  console.log('res8.chips:', res8.chips?.map(c => c.label));
  assert.equal(res8.status, 'created');
  assert.match(res8.reply, /testing ai agent.*Web Development.*successfully/);
  assert.ok(res8.chips.some(c => c.label.includes('Web Development mein aur task add karein')));
  assert.ok(res8.chips.some(c => c.label === 'Main Menu'));

  console.log('\n======================================================');
  console.log('>>> ALL 8 STEPS OF CLIENT SERVICE TASK PASSED 100% <<<');
  console.log('======================================================');
})();
