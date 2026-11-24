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
      msg: 'export my attendence sheet',
      expectType: 'attendance',
      expectUrlContains: 'attendance?type=self'
    },
    {
      msg: 'mere ko meri attendence sheet chayeye',
      expectType: 'attendance',
      expectUrlContains: 'attendance?type=self'
    },
    {
      msg: 'admin ko ajj ki sheet chiaye',
      expectType: 'attendance',
      expectUrlContains: 'attendance?type=all&date=today'
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
      expectType: 'client_tasks_prompt',
      expectUrlContains: 'client'
    },
    {
      msg: 'Acme Corp client ke tasks ki sheet',
      expectType: 'client_tasks',
      expectUrlContains: 'client'
    },
    {
      msg: 'export client sheet',
      expectType: 'clients_master',
      expectUrlContains: 'clients-master'
    },
    {
      msg: 'client sheet download',
      expectType: 'clients_master',
      expectUrlContains: 'clients-master'
    },
    {
      msg: 'export full month attendance sheet',
      expectType: 'attendance',
      expectUrlContains: 'month=this'
    },
    {
      msg: 'kal ki attendance sheet chahiye',
      expectType: 'attendance',
      expectUrlContains: 'date=yesterday'
    },
    {
      msg: 'pichle hafte ki attendance sheet',
      expectType: 'attendance',
      expectUrlContains: 'date=last_week'
    },
    {
      msg: 'is hafte ki attendance export karo',
      expectType: 'attendance',
      expectUrlContains: 'date=this_week'
    },
    {
      msg: 'export projects sheet',
      expectType: 'projects_master',
      expectUrlContains: 'projects-master'
    },
    {
      msg: 'manage projects sheet',
      expectType: 'projects_master',
      expectUrlContains: 'projects-master'
    },
    {
      msg: 'kitne client h unki sheet shath me pta chale kiska subscrption chal rha h kab expire hoga kitnne task h kitne complte h konsi konsi service h usnke pass',
      expectType: 'clients_master',
      expectUrlContains: 'clients-master'
    },
    {
      msg: 'export attendence of october month',
      expectType: 'attendance',
      expectUrlContains: 'month=10'
    },
    {
      msg: 'mujhe kanika kai task ki pdf do',
      expectType: 'tasks',
      expectUrlContains: 'userName=Kanika'
    },
    {
      msg: 'give me saniha client sheet',
      expectType: 'client_tasks',
      expectUrlContains: 'client/c_saniha/tasks'
    },
    {
      msg: 'give me ciis netwrok project pdf',
      expectType: 'project',
      expectUrlContains: 'project/proj_ciis/tasks'
    }
  ];

  const dummyReq = { user: { _id: '123', name: 'Test User', companyCode: 'TEST' } };
  const dummyDeps = {
    accessibleProjects: [
      { _id: 'proj1', projectName: 'Alpha Project' },
      { _id: 'proj_ciis', projectName: 'CIIS Network' }
    ],
    accessibleClients: [
      { _id: 'client1', client: 'Acme Corp' },
      { _id: 'c_saniha', client: 'Saniha Enterprises' }
    ],
    companyUsers: [
      { _id: 'u1', name: 'Rahul' },
      { _id: 'u_kanika', name: 'Kanika Rana' }
    ]
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

    if (tc.expectType !== 'client_tasks_prompt') {
      const hasPdfChip = res.chips.some(c => c.label.includes('PDF') || (c.action?.url && c.action.url.includes('format=pdf')));
      assert.strictEqual(hasPdfChip, true, `Expected PDF download chip for: ${tc.msg}`);
    }

    console.log(`[PASS] "${tc.msg.slice(0, 42)}..." -> ${res.chips[0].label}`);
    passed++;
  }

  const negativeCases = ['task banao', 'create personal task', 'kisi ko task assign karna', 'skip', 'high'];
  for (const neg of negativeCases) {
    assert.strictEqual(isExportQuery(neg), false, `Should NOT be export query: ${neg}`);
  }
  console.log(`[PASS] All ${negativeCases.length} negative creation queries correctly ignored by isExportQuery.`);

  console.log(`\nSuccessfully passed all ${passed}/${testCases.length} AI Export tests!`);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
