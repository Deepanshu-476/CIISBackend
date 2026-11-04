const { parseTaskRequest } = require('../services/ai/taskAgentService');
const assert = require('node:assert');

(async () => {
  const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: ['admin-task-create'] } };
  const deps = {
    services: ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization']
  };

  let draft = {
    intent: 'create_client_plan',
    name: 'demo 1',
    price: 3000,
    months: 1,
    status: 'Active',
    description: '',
    descriptionDone: true,
    services: ['Cloud Architecture', 'Mobile App Development'],
    servicesDone: true,
    asked: ['name', 'price', 'months', 'status', 'description', 'services', 'serviceTasks']
  };

  console.log('--- Step 1: User says Haan, task add karein ---');
  let res1 = await parseTaskRequest({ req: mockReq, action: { type: 'start_add_service_tasks' }, draft }, deps);
  console.log('res1 reply:', res1.reply);
  assert.match(res1.reply, /Service select kijiye jisme task add karna hai/);

  console.log('--- Step 2: User selects Cloud Architecture ---');
  let res2 = await parseTaskRequest({ req: mockReq, action: { type: 'select_task_service', service: 'Cloud Architecture' }, draft: res1.draft }, deps);
  console.log('res2 reply:', res2.reply);
  assert.equal(res2.reply, 'Task ka naam batao jo "Cloud Architecture" mein add karna hai:');

  console.log('--- Step 3: User inputs task name testing 1 ---');
  let res3 = await parseTaskRequest({ req: mockReq, message: 'testing 1', draft: res2.draft }, deps);
  console.log('res3 reply:', res3.reply);
  assert.match(res3.reply, /"testing 1" task "Cloud Architecture" mein add ho gaya\. Ismein koi aur task create karna hai ya kisi aur service mein task create karna hai\?/);
  assert.equal(res3.draft.lastAddedService, 'Cloud Architecture');

  console.log('--- Step 4: Intelligent continuation - user just enters testing 2 ---');
  let res4 = await parseTaskRequest({ req: mockReq, message: 'testing 2', draft: res3.draft }, deps);
  console.log('res4 reply:', res4.reply);
  assert.match(res4.reply, /"testing 2" task "Cloud Architecture" mein add ho gaya\. Ismein koi aur task create karna hai ya kisi aur service mein task create karna hai\?/);
  const cloudTasks = res4.draft.serviceTasks['Cloud Architecture'];
  console.log('Cloud tasks count:', cloudTasks.length);
  assert.equal(cloudTasks.length, 2);
  assert.equal(cloudTasks[0].name, 'testing 1');
  assert.equal(cloudTasks[1].name, 'testing 2');

  console.log('--- Step 5: User clicks or says Kisi aur service mein ---');
  let res5 = await parseTaskRequest({ req: mockReq, message: 'Kisi aur service mein', draft: res4.draft }, deps);
  console.log('res5 reply:', res5.reply);
  assert.match(res5.reply, /Service select kijiye jisme task add karna hai/);

  console.log('--- Step 6: User clicks Done / Aage badhein ---');
  let res6 = await parseTaskRequest({ req: mockReq, action: { type: 'finish_service_tasks' }, draft: res5.draft }, deps);
  console.log('res6 status:', res6.status);
  console.log('res6 payload endpoint:', res6.payload.endpoint);
  assert.equal(res6.status, 'ready');
  assert.equal(res6.payload.endpoint, '/client-plans');
  assert.equal(res6.payload.fields.services[0].tasks.length, 2);
  assert.equal(res6.payload.fields.services[0].tasks[0].name, 'testing 1');
  assert.equal(res6.payload.fields.services[0].tasks[1].name, 'testing 2');

  console.log('\n>>> ALL 6 STEP VERIFICATIONS PASSED 100%! <<<');
})();
