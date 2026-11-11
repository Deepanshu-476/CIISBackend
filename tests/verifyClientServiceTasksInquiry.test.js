const assert = require('assert');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

async function runTests() {
  console.log('=== TEST SUITE: verifyClientServiceTasksInquiry ===\n');

  const mockUser = {
    _id: 'u_admin',
    name: 'Admin User',
    role: 'Company Owner',
    companyRole: 'Company Owner',
    companyCode: 'TECH100',
    company: 'c_test'
  };

  const mockClients = [
    {
      _id: 'c_sarla',
      client: 'Sarla Rani',
      company: 'Bloom And Blush',
      services: ['Meesho account & listing', 'amazon account & listing', 'video'],
      status: 'Active'
    },
    {
      _id: 'c_amit',
      client: 'Amit Sharma',
      company: 'Live nature',
      services: ['creative production', 'video', 'google ads'],
      status: 'Active'
    }
  ];

  const mockClientTasks = [
    {
      _id: 'ct_1',
      clientId: 'c_sarla',
      service: 'Meesho account & listing',
      name: 'Meesho Catalog Upload',
      status: 'in-progress',
      assignee: 'Prashant',
      dueDate: new Date('2026-11-20T10:00:00Z')
    },
    {
      _id: 'ct_2',
      clientId: 'c_sarla',
      service: 'Meesho account & listing',
      name: 'Price Optimization',
      status: 'pending',
      assignee: 'Anshul',
      dueDate: new Date('2026-11-22T10:00:00Z')
    },
    {
      _id: 'ct_3',
      clientId: 'c_sarla',
      service: 'video',
      name: 'Reels Editing',
      status: 'completed',
      assignee: 'Deepanshu',
      dueDate: new Date('2026-11-10T10:00:00Z')
    },
    {
      _id: 'ct_4',
      clientId: 'c_amit',
      service: 'creative production',
      name: 'Banner Design 1',
      status: 'in-progress',
      assignee: 'Taniya'
    }
  ];

  const mockDeps = {
    accessibleClients: mockClients,
    clientTasks: mockClientTasks,
    services: ['Meesho account & listing', 'amazon account & listing', 'video', 'creative production', 'google ads']
  };

  // --------------------------------------------------------------------------
  // TEST 1: Specific Service Tasks Query (Sarla Rani ki Meesho service ke tasks)
  // --------------------------------------------------------------------------
  console.log('--- Test 1: Specific Service Tasks Query ---');
  const res1 = await parseTaskRequest({
    req: { user: mockUser },
    message: 'Sarla Rani ki Meesho service ke tasks batao'
  }, mockDeps);

  console.log('Reply 1:\n', res1.reply);
  assert.ok(res1.reply.includes('Sarla Rani'), 'Must mention client Sarla Rani');
  assert.ok(res1.reply.includes('Meesho account & listing'), 'Must mention service name');
  assert.ok(res1.reply.includes('Meesho Catalog Upload'), 'Must list task 1');
  assert.ok(res1.reply.includes('Price Optimization'), 'Must list task 2');
  assert.ok(res1.chips.some(c => c.label.includes('Meesho account & listing mein task banana')), 'Must offer task creation chip for service');
  console.log('✔ Test 1 Passed: Specific service tasks successfully listed\n');

  // --------------------------------------------------------------------------
  // TEST 2: All Tasks Across Services for Client (Sarla Rani client ki services ke tasks)
  // --------------------------------------------------------------------------
  console.log('--- Test 2: All Tasks Across Services for Client ---');
  const res2 = await parseTaskRequest({
    req: { user: mockUser },
    message: 'Sarla Rani client ki services ke tasks dikhao'
  }, mockDeps);

  console.log('Reply 2:\n', res2.reply);
  assert.ok(res2.reply.includes('Sarla Rani'), 'Must mention client Sarla Rani');
  assert.ok(res2.reply.includes('Meesho account & listing'), 'Must list Meesho service section');
  assert.ok(res2.reply.includes('video'), 'Must list video service section');
  assert.ok(res2.reply.includes('Meesho Catalog Upload'), 'Must include task under Meesho');
  assert.ok(res2.reply.includes('Reels Editing'), 'Must include task under video');
  console.log('✔ Test 2 Passed: Grouped service tasks successfully listed\n');

  // --------------------------------------------------------------------------
  // TEST 3: Specific Service with 0 tasks (Sarla Rani ki amazon service ke tasks)
  // --------------------------------------------------------------------------
  console.log('--- Test 3: Specific Service with 0 tasks ---');
  const res3 = await parseTaskRequest({
    req: { user: mockUser },
    message: 'Sarla Rani ki amazon service ke tasks batao'
  }, mockDeps);

  console.log('Reply 3:\n', res3.reply);
  assert.ok(res3.reply.includes('amazon account & listing'), 'Must mention amazon service');
  assert.ok(res3.reply.includes('koi task add nahi hai') || res3.reply.includes('no tasks'), 'Must inform no tasks');
  console.log('✔ Test 3 Passed: Informs user that service has 0 tasks and invites creation\n');

  // --------------------------------------------------------------------------
  // TEST 4: General Client Details includes Task Count & Drill-down chip
  // --------------------------------------------------------------------------
  console.log('--- Test 4: General Client Details Inquiry ---');
  const res4 = await parseTaskRequest({
    req: { user: mockUser },
    message: 'Amit Sharma client ki details dikhao'
  }, mockDeps);

  console.log('Reply 4:\n', res4.reply);
  assert.ok(res4.reply.includes('Amit Sharma'), 'Must mention client Amit Sharma');
  assert.ok(res4.reply.includes('Client Tasks') || res4.reply.includes('task(s)'), 'Must mention task count');
  assert.ok(res4.chips.some(c => c.label.includes('Services ke tasks dekhna')), 'Must provide chip to drill down');
  console.log('✔ Test 4 Passed: Client details include tasks and drill-down chip\n');

  // --------------------------------------------------------------------------
  // TEST 5: General Query without client name (client services ke tasks dikhao)
  // --------------------------------------------------------------------------
  console.log('--- Test 5: General Query without client name ---');
  const res5 = await parseTaskRequest({
    req: { user: mockUser },
    message: 'client services ke tasks dikhao'
  }, mockDeps);

  console.log('Reply 5:\n', res5.reply);
  assert.ok(res5.reply.includes('Sarla Rani') && res5.reply.includes('Amit Sharma'), 'Must list registered clients and their services');
  assert.ok(res5.chips.some(c => c.label.includes('ke tasks')), 'Must offer client tasks chips');
  console.log('✔ Test 5 Passed: Invites user with client names, services and chips\n');

  console.log('======================================================');
  console.log('>>> ALL CLIENT SERVICE TASKS INQUIRY TESTS PASSED! <<<');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
