const assert = require('assert');
const { isExportQuery, handleExportRequest } = require('../services/ai/aiExportReportHandler');

async function runTests() {
  const testCases = [
    {
      msg: 'merko meri attendenc sheet chaiye h',
      expectType: 'attendance',
      expectUrlContains: 'attendance?type=self'
    },
    {
      msg: 'admin ko ajj ki sheet chiaye',
      expectType: 'attendance',
      expectUrlContains: 'attendance?type=today'
    },
    {
      msg: 'admin ko sabke task ki sheet chaiye h',
      expectType: 'tasks',
      expectUrlContains: 'tasks?type=all'
    },
    {
      msg: 'single user k task ki chaiye to vo b aaj ki',
      expectType: 'tasks',
      expectUrlContains: 'tasks?type=self&date=today'
    },
    {
      msg: 'project k jitne task h un sb ki pdf',
      expectType: 'project',
      expectUrlContains: 'project'
    },
    {
      msg: 'client k task h unki sheet',
      expectType: 'client_tasks',
      expectUrlContains: 'client'
    },
    {
      msg: 'kitne client h unki sheet shath me pta chale kiska subscrption chal rha h kab expire hoga kitnne task h kitne complte h konsi konsi service h usnke pass',
      expectType: 'clients_master',
      expectUrlContains: 'clients-master'
    }
  ];

  const dummyReq = { user: { _id: '123', name: 'Test User', companyCode: 'TEST' } };
  const dummyDeps = {
    accessibleProjects: [{ _id: 'proj1', projectName: 'Alpha Project' }],
    accessibleClients: [{ _id: 'client1', client: 'Acme Corp' }],
    companyUsers: [{ _id: 'u1', name: 'Rahul' }]
  };
  const dummyDraft = {};

  let passed = 0;
  for (const tc of testCases) {
    const isExport = isExportQuery(tc.msg);
    assert.strictEqual(isExport, true, `Query should be detected as export: ${tc.msg}`);

    const res = await handleExportRequest({
      message: tc.msg,
      req: dummyReq,
      deps: dummyDeps,
      currentDraft: dummyDraft,
      isEn: false
    });

    assert.ok(res, `Result should exist for: ${tc.msg}`);
    assert.ok(Array.isArray(res.chips) && res.chips.length > 0, `Chips should exist for: ${tc.msg}`);

    const hasExpectedUrl = res.chips.some(c => c.action?.url && c.action.url.includes(tc.expectUrlContains));
    assert.strictEqual(hasExpectedUrl, true, `Expected URL containing "${tc.expectUrlContains}" for: ${tc.msg}`);

    console.log(`[PASS] "${tc.msg.slice(0, 42)}..." -> ${res.chips[0].label}`);
    passed++;
  }

  console.log(`\nSuccessfully passed all ${passed}/${testCases.length} AI Export tests!`);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
