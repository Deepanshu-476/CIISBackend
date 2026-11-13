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
  assert.ok(!res3.chips.some(c => c.label.includes('Skip')), 'Description must not have skip chip');

  console.log('\n=== STEP 4: User provides description ===');
  const res4 = await parseTaskRequest({
    req: mockReq,
    message: 'Detailed CRM client task description',
    draft: res3.draft
  }, deps);

  console.log('res4.field:', res4.field);
  console.log('res4.reply:', res4.reply);
  console.log('res4.chips:', res4.chips?.map(c => c.label));
  assert.equal(res4.field, 'dueDateTime');
  assert.equal(res4.draft.description, 'Detailed CRM client task description');
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
  // In Create Client Task, assignee is ALWAYS the logged-in user (no other employee can be chosen)
  // So it directly proceeds to priority without asking who to assign to!
  assert.equal(res5.field, 'priority');
  assert.equal(res5.draft.assignee, 'Test Admin');

  console.log('\n=== STEP 6: User selects Priority "High" ===');
  const res6 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'set', field: 'priority', value: 'High' },
    draft: res5.draft
  }, deps);

  console.log('res6.field:', res6.field);
  console.log('res6.reply:', res6.reply);
  console.log('res6.chips:', res6.chips?.map(c => c.label));
  assert.equal(res6.field, 'reminder');

  console.log('\n=== STEP 7: User types reminder "every 10 min." (Reproduction of Image 2) ===');
  const res7 = await parseTaskRequest({
    req: mockReq,
    message: 'every 10 min.',
    draft: res6.draft
  }, deps);

  console.log('res7.field:', res7.field);
  console.log('res7.reply:', res7.reply);
  console.log('res7.chips:', res7.chips?.map(c => c.label));
  console.log('res7.draft.reminderSettings:', res7.draft.reminderSettings);
  assert.equal(res7.field, 'checkpoints');
  assert.equal(typeof res7.draft.reminderSettings, 'object', 'reminderSettings MUST be an object, NEVER boolean');
  assert.equal(res7.draft.reminderSettings.enabled, true);

  console.log('\n=== STEP 8: User provides comma-separated Checkpoints "new 1, new 2, new 3" (Image 2 test) ===');
  const res8 = await parseTaskRequest({
    req: mockReq,
    message: 'new 1, new 2, new 3',
    draft: res7.draft
  }, deps);

  console.log('res8.status:', res8.status);
  console.log('res8.field:', res8.field);
  console.log('res8.reply:', res8.reply);
  console.log('res8.payload:', res8.payload);
  console.log('res8.preview:', res8.preview);

  assert.equal(res8.status, 'ready');
  assert.equal(res8.payload.endpoint, '/tasks/client-tasks/client/client_asdfg_123/service/Web%20Development');
  assert.equal(res8.payload.method, 'POST');
  assert.equal(res8.payload.fields.name, 'testing ai agent');
  assert.equal(res8.payload.fields.description, 'Detailed CRM client task description');
  assert.equal(res8.payload.fields.assignee, 'Test Admin');
  assert.equal(res8.payload.fields.priority, 'High');
  assert.equal(res8.payload.fields.checkpoints.length, 3);
  assert.equal(res8.payload.fields.checkpoints[0].title, 'new 1');
  assert.equal(res8.payload.fields.checkpoints[1].title, 'new 2');
  assert.equal(res8.payload.fields.checkpoints[2].title, 'new 3');
  assert.equal(res8.payload.fields.reminderSettings.enabled, true);
  assert.equal(res8.preview.entity, 'client_task');
  assert.equal(res8.preview.client, 'asdfg');
  assert.equal(res8.preview.service, 'Web Development');

  console.log('\n=== STEP 9: User confirms creation ===');
  const res9 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'confirm' },
    draft: res8.draft
  }, deps);

  console.log('res9.status:', res9.status);
  console.log('res9.reply:', res9.reply);
  console.log('res9.chips:', res9.chips?.map(c => c.label));
  assert.equal(res9.status, 'created');
  assert.match(res9.reply, /testing ai agent.*Web Development.*successfully/);
  assert.ok(res9.chips.some(c => c.label.includes('Web Development mein aur task add karein')));
  assert.ok(res9.chips.some(c => c.label === 'Main Menu'));

  console.log('\n=== TEST FLOW B: Pending Service Tasks (Select for Edit) Flow ===');
  const pendingDeps = {
    ...deps,
    servicePendingTasks: [
      {
        _id: 'pending_task_1',
        id: 'pending_task_1',
        name: 'Core Feature Integration',
        description: 'Implement core modules',
        dueDate: '2026-11-18T18:00:00.000Z',
        priority: 'High',
        checkpoints: [{ title: 'Module A', completed: false }]
      },
      {
        _id: 'pending_task_2',
        id: 'pending_task_2',
        name: 'QA & Staging Release',
        description: 'Test on staging server',
        dueDate: '2026-11-25T18:00:00.000Z',
        priority: 'Medium',
        checkpoints: []
      }
    ]
  };

  const pRes1 = await parseTaskRequest({
    req: mockReq,
    action: { type: 'set_client_task_service', service: 'Web Development' },
    draft: {
      intent: 'create_client_task',
      client: 'asdfg',
      clientId: 'client_asdfg_123',
      asked: ['client']
    }
  }, pendingDeps);

  console.log('pRes1.field:', pRes1.field);
  console.log('pRes1.reply:', pRes1.reply);
  console.log('pRes1.chips:', pRes1.chips?.map(c => c.label));
  assert.equal(pRes1.field, 'select_pending_task', 'Should show pending tasks for Web Development');
  assert.ok(pRes1.chips.some(c => c.label === 'Core Feature Integration'));
  assert.ok(pRes1.chips.some(c => c.label === 'QA & Staging Release'));
  assert.ok(pRes1.chips.some(c => c.label === 'Naya task likhein'));

  console.log('\n=== User selects pending task "Core Feature Integration" ===');
  const pRes2 = await parseTaskRequest({
    req: mockReq,
    action: pRes1.chips.find(c => c.label === 'Core Feature Integration').action,
    draft: pRes1.draft
  }, pendingDeps);

  console.log('pRes2.draft.title:', pRes2.draft.title);
  console.log('pRes2.draft.clientTaskId:', pRes2.draft.clientTaskId);
  console.log('pRes2.field:', pRes2.field);
  assert.equal(pRes2.draft.title, 'Core Feature Integration');
  assert.equal(pRes2.draft.clientTaskId, 'pending_task_1');
  assert.equal(pRes2.draft.assignee, 'Test Admin');

  console.log('\n======================================================');
  console.log('>>> ALL CLIENT SERVICE TASK QA TESTS PASSED 100% <<<');
  console.log('======================================================');
})();
