const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  FORM_REGISTRY,
  detectIntent,
  buildChips,
  assertChipsAllowed,
  SLOT_CHIPS_TABLE,
  GLOBAL_CONTROLS,
  FLOW_FIRST_QUESTION_HINTS,
  getCleanDepartment,
  formatMemberChipLabel,
} = require('../services/ai/formRegistry');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

describe('Chips per Flow, Form Registry, Member Chips & Info Questions Suite', () => {

  test('1. SLOT_CHIPS_TABLE & buildChips invariant: all slots produce valid chips and assertChipsAllowed passes', () => {
    const intents = Object.keys(SLOT_CHIPS_TABLE);
    assert.deepEqual(intents.sort(), [
      'create_client',
      'create_client_plan',
      'create_client_task',
      'create_project',
      'self_task',
      'task_assigned_user',
      'task_project',
    ].sort());

    const mockCtx = {
      companyUsers: [
        { _id: 'u1', name: 'Vansh Sharma', role: 'Staff', department: { name: 'Engineering' } },
        { _id: 'u2', name: 'Simran Kaur', role: 'Staff', departmentName: 'Marketing' },
      ],
      accessibleProjects: [{ _id: 'p1', projectName: 'Project Alpha' }],
      accessibleClients: [{ _id: 'c1', client: 'Acme Corp', company: 'Acme Inc' }],
      clientServices: ['Web Development', 'Cloud Architecture'],
      services: ['Web Development', 'Cloud Architecture'],
      clientPlans: [{ _id: 'pl1', name: 'Starter', price: 25000 }],
      draft: { team: [], services: [] },
    };

    for (const intent of intents) {
      for (const slot of SLOT_CHIPS_TABLE[intent]) {
        const chips = buildChips(intent, slot, mockCtx);
        assert.ok(Array.isArray(chips), `Chips for ${intent}.${slot} should be array`);
        assert.ok(chips.length > 0, `Chips for ${intent}.${slot} should not be empty`);

        // Check runtime invariant
        assert.doesNotThrow(() => {
          assertChipsAllowed(intent, slot, chips);
        }, `assertChipsAllowed failed on ${intent}.${slot}`);

        // Invariant: no chip should change intent within a flow slot (outside welcome)
        if (slot !== 'welcome') {
          for (const c of chips) {
            if (c.action?.type === 'set_intent' || (c.action?.type === 'set' && c.action?.field === 'intent')) {
              const targetIntent = c.action?.intent || c.action?.value;
              assert.equal(targetIntent, intent, `Chip ${c.label} changed intent in ${intent}.${slot}`);
            }
          }
        }

        // Invariant: [Khud ke liye] and [Kisi aur ke liye] must never exist in any of these flow slots
        const labels = chips.map((c) => c.label);
        assert.ok(!labels.includes('Khud ke liye'), `Leaked [Khud ke liye] in ${intent}.${slot}`);
        assert.ok(!labels.includes('Kisi aur ke liye'), `Leaked [Kisi aur ke liye] in ${intent}.${slot}`);
      }
    }
  });

  test('2. Welcome Menu: 6 buttons map to exact 6 intents and first question includes hint line', () => {
    const welcomeChips = buildChips(null, 'welcome');
    assert.equal(welcomeChips.length, 6);

    const expected = [
      { label: 'Personal task banana', intent: 'self_task' },
      { label: 'Kisi ko task assign karna', intent: 'task_assigned_user' },
      { label: 'Naya project banana', intent: 'create_project' },
      { label: 'Project mein task banana/assign karna', intent: 'task_project' },
      { label: 'Naya client add karna', intent: 'create_client' },
      { label: 'Client plan banana', intent: 'create_client_plan' },
    ];

    expected.forEach((exp, idx) => {
      assert.equal(welcomeChips[idx].label, exp.label);
      assert.equal(welcomeChips[idx].action.intent, exp.intent);

      // Verify hint line is defined for each
      assert.ok(FLOW_FIRST_QUESTION_HINTS[exp.intent], `Missing hint for ${exp.intent}`);
      assert.match(FLOW_FIRST_QUESTION_HINTS[exp.intent], /Aap ek saath bol sakte hain, jaise:/);
    });
  });

  test('3. Member chips: roster of 45 people shows 30 + [Aur dikhao], page 1 shows remaining', () => {
    const users45 = Array.from({ length: 45 }, (_, i) => ({
      _id: `u_${i + 1}`,
      name: `Person ${i + 1}`,
      departmentName: i % 2 === 0 ? 'Engineering' : 'Sales',
    }));

    // Page 0:
    const ctxPage0 = { companyUsers: users45, draft: { team: [] } };
    const chipsP0 = buildChips('create_client', 'team', ctxPage0);

    const labelsP0 = chipsP0.map((c) => c.label);
    assert.equal(labelsP0[0], 'Person 1 (Engineering)');
    assert.equal(labelsP0[29], 'Person 30 (Sales)');
    assert.ok(labelsP0.includes('Aur dikhao'), 'Should include Aur dikhao');
    assert.ok(labelsP0.includes('Done') || labelsP0.includes('Ho gaya'), 'Should include Done');
    assert.ok(labelsP0.includes('Cancel'), 'Should include Cancel');

    // Page 1:
    const ctxPage1 = { companyUsers: users45, memberPage: 1, draft: { team: [] } };
    const chipsP1 = buildChips('create_client', 'team', ctxPage1);
    const labelsP1 = chipsP1.map((c) => c.label);
    assert.equal(labelsP1[0], 'Person 31 (Engineering)');
    assert.equal(labelsP1[14], 'Person 45 (Engineering)');
    assert.ok(!labelsP1.includes('Aur dikhao'), 'Last page should not have Aur dikhao');
  });

  test('4. Member chips multi-select: toggle selection, checkmark, remove on tap, Sirf main in create_project', () => {
    const user1 = { _id: 'u1', name: 'Vansh Sharma', department: { name: 'Engineering' } };
    const user2 = { _id: 'u2', name: 'Simran Kaur', departmentName: 'Marketing' };

    // With user1 already selected
    const ctx = {
      companyUsers: [user1, user2],
      draft: { members: ['Vansh Sharma'] },
    };

    const chips = buildChips('create_project', 'members', ctx);
    const vanshChip = chips.find((c) => c.label.includes('Vansh Sharma'));
    const simranChip = chips.find((c) => c.label.includes('Simran Kaur'));

    assert.ok(vanshChip, 'Vansh chip should be present');
    assert.equal(vanshChip.label, '✓ Vansh Sharma (Engineering)');
    assert.equal(vanshChip.action.type, 'remove_member');

    assert.ok(simranChip, 'Simran chip should be present');
    assert.equal(simranChip.label, 'Simran Kaur (Marketing)');
    assert.equal(simranChip.action.type, 'add_member');

    const labels = chips.map((c) => c.label);
    assert.ok(labels.includes('Sirf main'), 'create_project should include Sirf main');
    assert.ok(labels.includes('Done') || labels.includes('Ho gaya'), 'create_project should include Done');
  });

  test('5. Task project assignee: restricted only to project members', () => {
    const projMembers = [
      { _id: 'pm1', name: 'Project Member 1', departmentName: 'Tech' },
    ];
    const otherUsers = [
      { _id: 'pm1', name: 'Project Member 1', departmentName: 'Tech' },
      { _id: 'outside1', name: 'Outside Person', departmentName: 'Legal' },
    ];

    const ctx = {
      project: { members: projMembers },
      companyUsers: otherUsers,
    };

    const chips = buildChips('task_project', 'assignee', ctx);
    const labels = chips.map((c) => c.label);
    assert.ok(labels.includes('Project Member 1 (Tech)'));
    assert.ok(!labels.includes('Outside Person (Legal)'), 'Non-project members must not appear in project task assignee');
  });

  test('6. Deterministic Info Questions: members, services, plans, clients, projects (Devanagari + Hinglish) with zero PII', async () => {
    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const deps = {
      accessibleProjects: [{ _id: 'p1', projectName: 'Project Apollo' }],
      accessibleClients: [{ _id: 'c1', client: 'ZZ Tech', company: 'ZZ Corp' }],
      companyUsers: [
        { _id: 'u1', name: 'Vansh Sharma', role: 'Staff', department: { name: 'Engineering' }, email: 'vansh@test.com', phone: '9876543210' },
        { _id: 'u2', name: 'Simran Kaur', role: 'Staff', departmentName: 'Marketing', email: 'simran@test.com', phone: '9876543211' },
      ],
      services: ['Web Development', 'Cloud Architecture'],
      clientPlans: [{ _id: 'plan1', name: 'Growth Starter', price: 25000 }],
    };

    const draft = {
      intent: 'create_client',
      client: 'AI Client',
      asked: ['client'],
      skipped: [],
      askCounts: {},
    };

    // A. Members info question in Hinglish
    const resMembers = await parseTaskRequest({ req: mockReq, message: 'kaun kaun members hain', draft }, deps);
    assert.ok(resMembers.reply.includes('Vansh Sharma (Engineering)'));
    assert.ok(resMembers.reply.includes('Simran Kaur (Marketing)'));
    assert.ok(!resMembers.reply.includes('vansh@test.com'), 'Email must NOT leak in members info');
    assert.ok(!resMembers.reply.includes('9876543210'), 'Phone must NOT leak in members info');
    assert.ok(!resMembers.reply.includes('u1'), 'ID must NOT leak in members info');
    assert.ok(resMembers.reply.includes('Client ka naam batayein (zaroori hai):'), 'Must repeat pending slot question');
    assert.equal(resMembers.draft.client, 'AI Client', 'Draft must remain untouched');

    // B. Members info question in Devanagari
    const resMembersHi = await parseTaskRequest({ req: mockReq, message: 'टीम के लोग कौन हैं', draft }, deps);
    assert.ok(resMembersHi.reply.includes('Vansh Sharma (Engineering)'));

    // C. Services info question
    const resServices = await parseTaskRequest({ req: mockReq, message: 'services kaun si hain', draft }, deps);
    assert.ok(resServices.reply.includes('Web Development'));
    assert.ok(resServices.reply.includes('Cloud Architecture'));
    assert.ok(resServices.reply.includes('Client ka naam batayein (zaroori hai):'));

    // D. Plans info question
    const resPlans = await parseTaskRequest({ req: mockReq, message: 'plans kya hain', draft }, deps);
    assert.ok(resPlans.reply.includes('Growth Starter (₹25,000)'));

    // E. Clients info question in Devanagari
    const resClients = await parseTaskRequest({ req: mockReq, message: 'क्लाइंट्स दिखाओ', draft }, deps);
    assert.ok(resClients.reply.includes('ZZ Tech (ZZ Corp)'));

    // F. Projects info question
    const resProjects = await parseTaskRequest({ req: mockReq, message: 'projects dikhao', draft }, deps);
    assert.ok(resProjects.reply.includes('Project Apollo'));
  });

  test('7. assertChipsAllowed enforces invariant: throws on illegal chip or leaked Khud ke liye in flow', () => {
    // Attempting to inject leaked Khud ke liye into create_client
    assert.throws(() => {
      assertChipsAllowed('create_client', 'client', [{ label: 'Khud ke liye', action: { type: 'set_intent', intent: 'self_task' } }]);
    }, /leaked into intent="create_client"/);

    // Attempting to change intent from create_project to create_client inside a slot
    assert.throws(() => {
      assertChipsAllowed('create_project', 'name', [{ label: 'Go to client', action: { type: 'set_intent', intent: 'create_client' } }]);
    }, /changes intent from "create_project" to "create_client"/);
  });

  test('8. Regression: Naya client add karna starts create_client directly (no task fields mix), hint lines removed', async () => {
    const { parseRequestSchema } = require('../services/ai/aiSchemas');
    const parsed = parseRequestSchema.safeParse({ action: { type: 'set_intent', intent: 'create_client' } });
    assert.ok(parsed.success);
    assert.equal(parsed.data.action?.type, 'set_intent');
    assert.equal(parsed.data.action?.intent, 'create_client');

    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const deps = { accessibleProjects: [], accessibleClients: [], companyUsers: [], services: [], clientPlans: [] };

    // Via button action:
    const resAction = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set_intent', intent: 'create_client' },
      message: 'Naya client add karna',
    }, deps);
    assert.equal(resAction.field, 'client');
    assert.equal(resAction.draft?.intent, 'create_client');
    assert.equal(resAction.reply, 'Client ka naam batayein (zaroori hai):');
    assert.doesNotMatch(resAction.reply, /Task ka naam/i);
    assert.doesNotMatch(resAction.reply, /Aap ek saath bol sakte hain/i);

    // Via typed message:
    const resTyped = await parseTaskRequest({
      req: mockReq,
      message: 'Naya client add karna',
    }, deps);
    assert.equal(resTyped.field, 'client');
    assert.equal(resTyped.draft?.intent, 'create_client');
    assert.equal(resTyped.reply, 'Client ka naam batayein (zaroori hai):');

    // Create task question has NO hint line:
    const resTask = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set_intent', intent: 'self_task' },
      message: 'Personal task banana',
    }, deps);
    assert.equal(resTask.field, 'title');
    assert.equal(resTask.draft?.intent, 'self_task');
    assert.doesNotMatch(resTask.reply, /Aap ek saath bol sakte hain/i);
  });
  test('9. Full dropdown member chips in create_client, toggle selection, and info question typo tolerance', async () => {
    const roster = [
      { _id: 'u1', name: 'Test Admin', role: 'Staff' },
      { _id: 'u2', name: 'Vansh Test', role: 'Staff' },
      { _id: 'u3', name: 'Aarav Sharma', role: 'Staff' },
      { _id: 'u4', name: 'Diya Patel', role: 'Staff' },
      { _id: 'u5', name: 'Arjun Verma', role: 'Staff' },
    ];
    const servicesList = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design'];
    const plansList = [{ _id: 'p1', name: 'Growth Starter Plan', price: 25000 }];

    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const deps = {
      accessibleProjects: [],
      accessibleClients: [],
      companyUsers: roster,
      services: servicesList,
      clientPlans: plansList,
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
    };

    // When create_client asks for projectManager
    const resPm = await parseTaskRequest({
      req: mockReq,
      draft: {
        intent: 'create_client',
        client: 'AI Client',
        company: 'ZZ Tech',
        city: 'Mohali',
        status: 'Active',
        email: 'client@example.com',
        asked: ['client', 'company', 'city', 'status', 'email'],
      },
    }, deps);

    assert.equal(resPm.field, 'projectManager');
    assert.match(resPm.reply, /Team member ka naam batayein/);
    const chipLabels = resPm.chips.map(c => c.label);
    assert.ok(chipLabels.some(l => l.includes('Test Admin')), 'Should include Test Admin chip');
    assert.ok(chipLabels.some(l => l.includes('Vansh Test')), 'Should include Vansh Test chip');
    assert.ok(chipLabels.some(l => l.includes('Aarav Sharma')), 'Should include Aarav Sharma chip');
    assert.ok(chipLabels.includes('Done') || chipLabels.includes('Ho gaya'), 'Should include Done chip');
    assert.ok(chipLabels.includes('Cancel'), 'Should include Cancel chip');

    // Test info question with typo: 'kon kon se membera hai team main ?'
    const resInfo = await parseTaskRequest({
      req: mockReq,
      message: 'kon kon se membera hai team main ?',
      draft: resPm.draft,
    }, deps);

    assert.equal(resInfo.field, 'projectManager');
    assert.match(resInfo.reply, /Available members/i);
    assert.doesNotMatch(resInfo.reply, /naam ka koi employee nahi mila/i);
    assert.ok(resInfo.reply.includes('Test Admin'));

    // Tap to add member Vansh Test -> moves to services with full service chips
    const addAction = resPm.chips.find(c => c.label.includes('Vansh Test'))?.action;
    assert.ok(addAction, 'Add member action should exist');
    assert.equal(addAction.type, 'add_member');

    const resAdded = await parseTaskRequest({
      req: mockReq,
      action: addAction,
      draft: resPm.draft,
    }, deps);

    assert.equal(resAdded.field, 'clientPlan');
    assert.match(resAdded.reply, /plan lagana hai/i);

    // Skip plan to move to services
    const resServices = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip_client_plan' },
      draft: resAdded.draft,
    }, deps);

    assert.equal(resServices.field, 'services');
    assert.match(resServices.reply, /services deni hain/i);
    const serviceChipLabels = resServices.chips.map(c => c.label);
    assert.ok(serviceChipLabels.includes('Cloud Architecture'), 'Should include Cloud Architecture');
    assert.ok(serviceChipLabels.includes('SEO Optimization'), 'Should include SEO Optimization');
    assert.ok(serviceChipLabels.includes('Done') || serviceChipLabels.includes('Ho gaya'), 'Should include Done');
  });
  test('10. Add 1, Add 2, Add 3: Multi-select member chips, multi-select services, and unknown service re-ask guard', async () => {
    const roster = [
      { _id: 'u1', name: 'Test Admin', role: 'Company Owner' },
      { _id: 'u2', name: 'Vansh Test', role: 'Staff' },
      { _id: 'u3', name: 'Ishita Singh', role: 'Staff' },
      { _id: 'u4', name: 'Gaurav Rajput', role: 'Staff' },
    ];
    const servicesList = ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development'];
    const plansList = [{ _id: 'p1', name: 'Growth Starter Plan', price: 25000 }];

    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const deps = {
      accessibleProjects: [],
      accessibleClients: [],
      companyUsers: roster,
      services: servicesList,
      clientPlans: plansList,
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
    };

    // Add 1: Multi-select member chips via set_team_members
    const resMultiMembers = await parseTaskRequest({
      req: mockReq,
      action: {
        type: 'set_team_members',
        members: ['Vansh Test', 'Ishita Singh', 'Gaurav Rajput'],
        userIds: ['u2', 'u3', 'u4'],
      },
      draft: {
        intent: 'create_client',
        client: 'AI Client',
        company: 'ZZ Tech',
        city: 'Mohali',
        status: 'Active',
        email: 'client@example.com',
        asked: ['client', 'company', 'city', 'status', 'email'],
      },
    }, deps);

    assert.equal(resMultiMembers.field, 'clientPlan', 'After selecting multiple members, moves to clientPlan');
    assert.equal(resMultiMembers.draft.team.length, 3, 'All 3 members must be stored');

    // Skip plan to move to free services
    const resFree = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip_client_plan' },
      draft: resMultiMembers.draft,
    }, deps);
    assert.equal(resFree.field, 'services');

    // Add 3: When asked for services and user types unknown service (e.g. "Thank you."), agent must stay on services and re-ask
    const resUnknown = await parseTaskRequest({
      req: mockReq,
      message: 'Thank you.',
      draft: resFree.draft,
    }, deps);

    assert.equal(resUnknown.field, 'services', 'Must stay on services slot');
    assert.match(resUnknown.reply, /hamari services mein nahi hai/i, 'Must explicitly tell user that the service is not in company services');
    assert.ok(resUnknown.chips.some(c => c.label === 'Cloud Architecture'), 'Must show available service chips');
    assert.equal(resUnknown.field, 'services', 'Must stay on services');

    // Add 2: Multi-select service chips via set_client_services
    const resMultiServices = await parseTaskRequest({
      req: mockReq,
      action: {
        type: 'set_client_services',
        services: ['Cloud Architecture', 'Web Development'],
      },
      draft: resMultiMembers.draft,
    }, deps);

    assert.equal(resMultiServices.field, 'more_details', 'After submitting services in create_client, moves directly to more_details (tasks are added in Client Details)');
    assert.deepEqual(resMultiServices.draft.services, ['Cloud Architecture', 'Web Development'], 'Both services must be saved');
  });
  test('11. Issue 1, 2, 3, 4: Team members include Test Admin, Vansh Test, Aarav Sharma together without split, Done chip, and logo upload/skip never loops', async () => {
    const roster = [
      { _id: 'u1', name: 'Test Admin', role: 'Management' },
      { _id: 'u2', name: 'Vansh Test', role: 'Staff' },
      { _id: 'u3', name: 'Aarav Sharma', role: 'Staff' },
      { _id: 'u4', name: 'mjhg', companyRole: 'Client', role: 'Client' }, // should be filtered out
      { _id: 'u5', name: 'new client', role: 'client' }, // should be filtered out
    ];

    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const deps = {
      accessibleProjects: [],
      accessibleClients: [],
      companyUsers: roster,
      services: ['Web Development', 'Cloud Architecture'],
      clientPlans: [{ _id: 'p1', name: 'Starter Plan' }],
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
    };

    // 1. Team chips test: Test Admin, Vansh Test, Aarav Sharma are present, client accounts are excluded, Done chip exists
    const resPm = await parseTaskRequest({
      req: mockReq,
      draft: {
        intent: 'create_client',
        client: 'AI Client',
        company: 'ZZ Tech',
        city: 'Mohali',
        status: 'Active',
        email: 'client@example.com',
        asked: ['client', 'company', 'city', 'status', 'email'],
      },
    }, deps);

    const labels = resPm.chips.map(c => c.label);
    assert.ok(labels.some(l => l.includes('Test Admin')), 'Test Admin must be in first page chips');
    assert.ok(labels.some(l => l.includes('Vansh Test')), 'Vansh Test must be in first page chips');
    assert.ok(labels.some(l => l.includes('Aarav Sharma')), 'Aarav Sharma must be in first page chips');
    assert.ok(!labels.some(l => l.includes('mjhg')), 'Client accounts must NOT be in team chips');
    assert.ok(!labels.some(l => l.includes('new client')), 'Client accounts must NOT be in team chips');
    assert.ok(labels.includes('Done'), 'Chip must be labeled Done');

    // 2. Logo upload test: attaching logo advances to "Aur kuch dena hai?" and never re-asks for logo
    const resLogoAsk = await parseTaskRequest({
      req: mockReq,
      action: { type: 'select_details_group', group: 'logo' },
      draft: {
        intent: 'create_client',
        client: 'AI Client',
        company: 'ZZ Tech',
        city: 'Mohali',
        email: 'test@example.com',
        projectManager: ['Test Admin'],
        team: ['u1'],
        teamDone: true,
        services: ['Web Development'],
        servicesDone: true,
        clientPlanId: 'p1',
        clientPlanDone: true,
        status: 'Active',
        subscriptionStartDate: '2026-11-03',
        serviceTasksDone: true,
        asked: ['client', 'company', 'city', 'status', 'projectManager', 'services', 'clientPlan', 'subscriptionStartDate'],
      },
    }, deps);

    assert.equal(resLogoAsk.field, 'more_details');
    assert.match(resLogoAsk.reply, /company ka logo upload karein/i);

    // Now user attaches logo file
    const resLogoAttached = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'companyLogoName', value: 'Screenshot.png' },
      draft: resLogoAsk.draft,
    }, deps);

    assert.equal(resLogoAttached.field, 'more_details');
    assert.doesNotMatch(resLogoAttached.reply, /company ka logo upload karein/i, 'Must NOT re-ask for logo once attached');
    assert.match(resLogoAttached.reply, /Aur kuch dena hai|Aur details dena hain/i);

    // 3. Skip logo test: skipping logo advances immediately and never re-asks
    const resLogoSkip = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip_client_field', field: 'logo' },
      draft: resLogoAsk.draft,
    }, deps);

    assert.equal(resLogoSkip.field, 'more_details');
    assert.doesNotMatch(resLogoSkip.reply, /company ka logo upload karein/i, 'Must NOT re-ask for logo when skipped');
    assert.match(resLogoSkip.reply, /Aur kuch dena hai|Aur details dena hain/i);
  });

  test('12. Natural Language Date parsing & Client services/subscription preservation', async () => {
    const { parseRelativeOrAbsoluteDate, calculateEndDate } = require('../services/ai/clientSlotFiller');

    // 1. Natural language date parsing tests
    assert.equal(parseRelativeOrAbsoluteDate('4 november 2026'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('4 nov 2026'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('4th nov 2026'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('4th november'), `${new Date().getFullYear()}-11-04`);
    assert.equal(parseRelativeOrAbsoluteDate('november 4, 2026'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('nov 4 2026'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('04-11-2026'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('4/11/2026'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('2026-11-04'), '2026-11-04');
    assert.equal(parseRelativeOrAbsoluteDate('४ नवंबर २०२६'), '2026-11-04');

    // End date calculation test
    assert.equal(calculateEndDate('2026-11-04', 1), '2026-12-04');
    assert.equal(calculateEndDate('2026-11-04', 3), '2027-02-04');

    // 2. Client payload preserves services and builds subscription
    const config = FORM_REGISTRY.create_client;
    const draft = {
      client: 'kanika',
      company: 'ciis network',
      city: 'mohali',
      projectManager: ['Divya Tiwari'],
      services: ['Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development'],
      clientPlanId: 'plan_123',
      clientPlanMonths: 1,
      clientPlanPrice: 25000,
      subscriptionStartDate: '2026-11-04',
    };
    const payload = config.buildPayload(draft, { name: 'Test Admin', companyCode: 'TECH' }, {});
    assert.deepEqual(payload.fields.services, [
      'Mobile App Development',
      'SEO Optimization',
      'UI/UX Design',
      'Web Development',
    ]);
    assert.equal(payload.fields.clientPlanId, 'plan_123');
    assert.equal(payload.fields.subscription.length, 1);
    assert.equal(payload.fields.subscription[0].startDate, '2026-11-04');
    assert.equal(payload.fields.subscription[0].endDate, '2026-12-04');
    assert.equal(payload.fields.subscription[0].price, 25000);
  });

  test('13. create_client status slot & Chhod do button removed', async () => {
    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const deps = { accessibleProjects: [], accessibleClients: [], companyUsers: [], services: [], clientPlans: [] };

    // 1. Status slot is asked after city
    const resStatus = await parseTaskRequest({
      req: mockReq,
      draft: {
        intent: 'create_client',
        client: 'Kanika Client',
        company: 'CIIS',
        city: 'Mohali',
        asked: ['client', 'company', 'city'],
      },
    }, deps);
    assert.equal(resStatus.field, 'status');
    assert.match(resStatus.reply, /Client ka status kya rakhna hai/i);
    const chipLabels = resStatus.chips.map(c => c.label);
    assert.deepEqual(chipLabels, ['Active', 'On Hold', 'Inactive', 'Cancel']);

    // 2. Setting status via chip or text -> advances to required email slot
    const resStatusAnswered = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'status', value: 'Active' },
      draft: resStatus.draft,
    }, deps);
    assert.equal(resStatusAnswered.draft.status, 'Active');
    assert.equal(resStatusAnswered.field, 'email');
    assert.match(resStatusAnswered.reply, /email address batayein \(zaroori hai\)/i);

    // 3. Optional details (e.g. address) NEVER include "Chhod do"
    const resAddr = await parseTaskRequest({
      req: mockReq,
      action: { type: 'ask_client_details_group', group: 'address' },
      draft: {
        intent: 'create_client',
        client: 'Kanika Client',
        company: 'CIIS',
        city: 'Mohali',
        status: 'Active',
        email: 'test@example.com',
        teamDone: true,
        projectManager: ['Test Admin'],
        team: ['u1'],
        servicesDone: true,
        services: ['SEO'],
        clientPlanDone: true,
        asked: ['client', 'company', 'city', 'status', 'projectManager', 'services', 'clientPlan'],
      },
    }, deps);
    assert.match(resAddr.reply, /Office address batayein \(optional\)/i);
    const addrChipLabels = resAddr.chips.map(c => c.label);
    assert.ok(!addrChipLabels.includes('Chhod do'), 'Chhod do must NOT be present in chips');
    assert.ok(addrChipLabels.includes('Skip'), 'Skip must be present');
    assert.ok(addrChipLabels.includes('Nahi, bas'), 'Nahi, bas must be present');
  });

  test('14. task_assigned_user: starts with assignee, multi-select chips, no reminder/repeat/status mismatch', async () => {
    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const compUsers = [
      { _id: 'u1', id: 'u1', name: 'Vansh Test', department: 'IT DEPARTMENT' },
      { _id: 'u2', id: 'u2', name: 'Aarav Sharma', department: 'SALES DEPARTMENT' },
      { _id: 'u3', id: 'u3', name: 'Diya Patel', department: 'IT DEPARTMENT' },
    ];
    const deps = {
      accessibleProjects: [],
      accessibleClients: [],
      companyUsers: compUsers,
      services: [],
      clientPlans: [],
    };

    // Step 1: User clicks "Kisi ko task assign karna"
    const step1 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set_intent', intent: 'task_assigned_user' },
      draft: {},
    }, deps);

    // Intent must stay task_assigned_user (never forced to self_task)
    assert.equal(step1.draft.intent, 'task_assigned_user');
    assert.equal(step1.draft.taskFor, 'others');
    assert.equal(step1.field, 'assignee');
    assert.match(step1.reply, /Task kisse assign karna hai/i);

    // Member chips should have Vansh Test, Aarav Sharma, Diya Patel + Done + Cancel
    const chipLabels = step1.chips.map(c => c.label);
    assert.ok(chipLabels.some(l => l.includes('Vansh Test')));
    assert.ok(chipLabels.some(l => l.includes('Aarav Sharma')));
    assert.ok(chipLabels.includes('Done'));

    // Step 2: User selects Vansh Test chip directly (immediately advances to title)
    const step2 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'add_member', name: 'Vansh Test', userId: 'u1' },
      draft: step1.draft,
    }, deps);

    assert.equal(step2.draft.intent, 'task_assigned_user');
    assert.equal(step2.draft.assignees.length, 1);
    assert.equal(step2.draft.assignees[0].name, 'Vansh Test');
    assert.equal(step2.field, 'title');
    assert.match(step2.reply, /Task ka naam/i);

    // Step 3: Multi-select via set_team_members also works and advances to title
    const step3 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set_team_members', members: ['Vansh Test', 'Aarav Sharma'], userIds: ['u1', 'u2'] },
      draft: step1.draft,
    }, deps);

    assert.equal(step3.draft.intent, 'task_assigned_user');
    assert.equal(step3.draft.assignees.length, 2);
    assert.equal(step3.field, 'title');
    assert.match(step3.reply, /Task ka naam/i);

    // Step 4: Verify slots in task_assigned_user do NOT contain reminder or repeat
    const slots = FORM_REGISTRY.task_assigned_user.slots;
    assert.ok(!slots.includes('reminder'), 'reminder should not be in slots');
    assert.ok(!slots.includes('repeatPattern'), 'repeatPattern should not be in slots');
    assert.ok(!slots.includes('status'), 'status should not be in slots');

    // Step 5: Test preview output
    const preview = FORM_REGISTRY.task_assigned_user.buildPreview({
      title: 'Fix auth bug',
      description: 'Fix the login auth issue',
      dueDateTime: '2026-11-05T18:00:00.000Z',
      priority: 'high',
      assignees: [{ id: 'u1', name: 'Vansh Test', department: 'IT DEPARTMENT' }],
      checkpoints: ['Check logs', 'Deploy patch'],
    });

    assert.equal(preview.taskFor, 'others');
    assert.equal(preview.assignees.length, 1);
    assert.equal(preview.assignees[0].name, 'Vansh Test');
    assert.equal(preview.reminder, null);
    assert.equal(preview.repeat, null);
  });

  after(() => {
    setTimeout(() => {
      process.exit(0);
    }, 100).unref();
  });

  test('15. Required Email, Plan-driven services filtering & Manual Plan creation subflow', async () => {
    const mockReq = { user: { role: 'Company Owner', companyCode: 'ACME100', permissions: [] } };
    const deps = {
      accessibleProjects: [],
      accessibleClients: [],
      companyUsers: [{ _id: 'u1', id: 'u1', name: 'Test Admin' }],
      services: ['Cloud Architecture', 'Mobile App Development', 'SEO Optimization', 'UI/UX Design', 'Web Development'],
      clientPlans: [
        {
          _id: 'plan_test_1000',
          name: 'Test 1000',
          price: 1000,
          months: 1,
          services: [
            { service: 'Mobile App Development' },
            { service: 'SEO Optimization' },
            { service: 'Web Development' }
          ]
        }
      ]
    };

    // Part A: Email is strictly required and cannot be skipped
    const stepEmail = await parseTaskRequest({
      req: mockReq,
      draft: {
        intent: 'create_client',
        client: 'Kanika Client',
        company: 'CIIS',
        city: 'Mohali',
        status: 'Active',
        asked: ['client', 'company', 'city', 'status']
      }
    }, deps);
    assert.equal(stepEmail.field, 'email');
    assert.match(stepEmail.reply, /email address batayein \(zaroori hai\)/i);

    // Try skipping email
    const stepSkipEmail = await parseTaskRequest({
      req: mockReq,
      message: 'Skip',
      draft: stepEmail.draft
    }, deps);
    assert.equal(stepSkipEmail.field, 'email');
    assert.match(stepSkipEmail.reply, /email address zaroori hai, isko skip nahi kar sakte/i);

    // Enter invalid email
    const stepInvalidEmail = await parseTaskRequest({
      req: mockReq,
      message: 'kanika_at_ciis',
      draft: stepEmail.draft
    }, deps);
    assert.equal(stepInvalidEmail.field, 'email');
    assert.match(stepInvalidEmail.reply, /Email format galat hai/i);

    // Enter valid email -> advances to projectManager
    const stepValidEmail = await parseTaskRequest({
      req: mockReq,
      message: 'kanika@ciisnetwork.com',
      draft: stepEmail.draft
    }, deps);
    assert.equal(stepValidEmail.draft.email, 'kanika@ciisnetwork.com');
    assert.equal(stepValidEmail.field, 'projectManager');

    // Select team member -> advances to clientPlan
    const stepPlan = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set_team_members', members: ['Test Admin'], userIds: ['u1'] },
      draft: stepValidEmail.draft
    }, deps);
    assert.equal(stepPlan.field, 'clientPlan');
    assert.match(stepPlan.reply, /kaun sa plan lagana hai/i);
    const planChipLabels = stepPlan.chips.map(c => c.label);
    assert.ok(planChipLabels.some(l => l.includes('Test 1000')), 'Test 1000 plan chip must be present');
    assert.ok(!planChipLabels.includes('Select plan manually'), 'Select plan manually chip must NOT be present in create_client');
    assert.ok(planChipLabels.includes('Bina plan ke (Free)'), 'Bina plan ke (Free) chip must be present');

    // Part B: Select plan "Test 1000" -> auto-sets plan services and moves directly to subscriptionStartDate
    const stepSelectedPlan = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set_client_plan', planId: 'plan_test_1000', planName: 'Test 1000' },
      draft: stepPlan.draft
    }, deps);
    assert.equal(stepSelectedPlan.field, 'subscriptionStartDate');
    assert.deepEqual(stepSelectedPlan.draft.services, ['Mobile App Development', 'SEO Optimization', 'Web Development'], 'Plan services auto-populated');

    // Part C: Manual Plan Creation Subflow (Image 2)
    const stepManualStart = await parseTaskRequest({
      req: mockReq,
      action: { type: 'start_manual_plan' },
      draft: stepPlan.draft
    }, deps);
    assert.equal(stepManualStart.field, 'manual_plan_name');
    assert.match(stepManualStart.reply, /Plan ka naam batayein/i);

    // Step 1: Name
    const stepManualName = await parseTaskRequest({
      req: mockReq,
      message: 'Growth Custom Plan',
      draft: stepManualStart.draft
    }, deps);
    assert.equal(stepManualName.field, 'manual_plan_price');
    assert.match(stepManualName.reply, /price.*kitna hoga/i);

    // Step 2: Price
    const stepManualPrice = await parseTaskRequest({
      req: mockReq,
      message: '15000',
      draft: stepManualName.draft
    }, deps);
    assert.equal(stepManualPrice.field, 'manual_plan_months');
    assert.match(stepManualPrice.reply, /Plan duration kitne months/i);

    // Step 3: Duration
    const stepManualMonths = await parseTaskRequest({
      req: mockReq,
      message: '3 months',
      draft: stepManualPrice.draft
    }, deps);
    assert.equal(stepManualMonths.field, 'manual_plan_status');
    assert.match(stepManualMonths.reply, /Plan status kya rakhna hai/i);

    // Step 4: Status
    const stepManualStatus = await parseTaskRequest({
      req: mockReq,
      message: 'Active',
      draft: stepManualMonths.draft
    }, deps);
    assert.equal(stepManualStatus.field, 'manual_plan_description');
    assert.match(stepManualStatus.reply, /description/i);

    // Step 5: Description
    const stepManualDesc = await parseTaskRequest({
      req: mockReq,
      message: 'Custom full suite for client',
      draft: stepManualStatus.draft
    }, deps);
    assert.equal(stepManualDesc.field, 'manual_plan_services');
    assert.match(stepManualDesc.reply, /services include karni hain/i);

    // Step 6: Select Services & Finish
    const stepManualSvc = await parseTaskRequest({
      req: mockReq,
      action: { type: 'add_manual_plan_service', service: 'Mobile App Development' },
      draft: stepManualDesc.draft
    }, deps);
    const stepManualReady = await parseTaskRequest({
      req: mockReq,
      action: { type: 'finish_manual_plan_services' },
      draft: stepManualSvc.draft
    }, deps);
    assert.equal(stepManualReady.field, 'manual_plan_ready');
    assert.match(stepManualReady.reply, /Client Plan Preview/i);
    const readyChips = stepManualReady.chips.map(c => c.label);
    assert.ok(readyChips.includes('Save and use plan'), 'Must have Save and use plan chip');
    assert.ok(readyChips.includes('Edit'), 'Must have Edit chip');
    assert.ok(readyChips.includes('Cancel'), 'Must have Cancel chip');

    // Step 7: Click Save and use plan -> sets plan and services on client and proceeds to next client slot
    const stepSavedAndUsed = await parseTaskRequest({
      req: mockReq,
      action: { type: 'save_and_use_plan' },
      draft: stepManualReady.draft
    }, deps);
    assert.equal(stepSavedAndUsed.draft.clientPlanName, 'Growth Custom Plan');
    assert.equal(stepSavedAndUsed.draft.clientPlanPrice, 15000);
    assert.equal(stepSavedAndUsed.draft.clientPlanMonths, 3);
    assert.deepEqual(stepSavedAndUsed.draft.services, ['Mobile App Development']);
    assert.equal(stepSavedAndUsed.field, 'subscriptionStartDate');
    assert.match(stepSavedAndUsed.reply, /subscription start date batayein/i);

    // Part D: Standalone create_client_plan flow & Reflection in create_client
    const stepPlanInit = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set_intent', intent: 'create_client_plan' },
      draft: {}
    }, deps);
    assert.equal(stepPlanInit.draft.intent, 'create_client_plan');
    assert.equal(stepPlanInit.field, 'name');
    assert.match(stepPlanInit.reply, /Plan ka naam kya rakhna hai/i);

    // 1. Name
    const stepPlanName = await parseTaskRequest({
      req: mockReq,
      message: 'Diamond Ultra Plan',
      draft: stepPlanInit.draft
    }, deps);
    assert.equal(stepPlanName.field, 'price');
    assert.match(stepPlanName.reply, /Plan ka price.*kitna hoga/i);

    // 2. Price
    const stepPlanPrice = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'price', value: 12000 },
      draft: stepPlanName.draft
    }, deps);
    assert.equal(stepPlanPrice.field, 'months');
    assert.match(stepPlanPrice.reply, /Plan ki duration kitne mahine/i);

    // 3. Duration
    const stepPlanMonths = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'months', value: 6 },
      draft: stepPlanPrice.draft
    }, deps);
    assert.equal(stepPlanMonths.field, 'status');
    assert.match(stepPlanMonths.reply, /Plan ka status kya rakhna hai/i);

    // 4. Status
    const stepPlanStatus = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'status', value: 'Active' },
      draft: stepPlanMonths.draft
    }, deps);
    assert.equal(stepPlanStatus.field, 'description');
    assert.match(stepPlanStatus.reply, /Plan ka description kya likhna hai/i);

    // 5. Description
    const stepPlanDesc = await parseTaskRequest({
      req: mockReq,
      message: 'All inclusive premium services',
      draft: stepPlanStatus.draft
    }, deps);
    assert.equal(stepPlanDesc.field, 'services');
    assert.match(stepPlanDesc.reply, /services shamil karni hain/i);

    // 6. Services multi-select & Done
    const stepPlanSvc1 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'toggle_plan_service', service: 'Mobile App Development' },
      draft: stepPlanDesc.draft
    }, deps);
    const stepPlanSvc2 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'toggle_plan_service', service: 'SEO Optimization' },
      draft: stepPlanSvc1.draft
    }, deps);

    // 6b. Service Tasks
    const stepPlanServicesDone = await parseTaskRequest({
      req: mockReq,
      action: { type: 'finish_plan_services' },
      draft: stepPlanSvc2.draft
    }, deps);
    assert.equal(stepPlanServicesDone.field, 'serviceTasks');
    assert.match(stepPlanServicesDone.reply, /in services mein koi task add karna chahte hain/i);

    // Add a service task
    const stepPlanAddTask = await parseTaskRequest({
      req: mockReq,
      action: { type: 'add_service_task', service: 'Mobile App Development', name: 'Collect Docs', priority: 'High', dueInDays: 15 },
      draft: stepPlanServicesDone.draft
    }, deps);

    // Finish service tasks -> Ready
    const stepPlanReady = await parseTaskRequest({
      req: mockReq,
      action: { type: 'finish_service_tasks' },
      draft: stepPlanAddTask.draft
    }, deps);
    assert.equal(stepPlanReady.status, 'ready');
    assert.equal(stepPlanReady.field, 'ready');
    assert.match(stepPlanReady.reply, /Client Plan "Diamond Ultra Plan" ka draft taiyar hai/i);
    assert.equal(stepPlanReady.payload.endpoint, '/client-plans');
    assert.equal(stepPlanReady.preview.name, 'Diamond Ultra Plan');

    // 7. Confirm creation
    const stepPlanCreated = await parseTaskRequest({
      req: mockReq,
      action: { type: 'confirm' },
      draft: stepPlanReady.draft
    }, deps);
    assert.equal(stepPlanCreated.status, 'created');
    assert.match(stepPlanCreated.reply, /Diamond Ultra Plan.*successfully create aur save ho gaya hai/i);

    // 8. Verify the newly created plan immediately shows up in create_client plan chips!
    const stepNewClientPlan = await parseTaskRequest({
      req: mockReq,
      draft: {
        intent: 'create_client',
        client: 'Test New Client',
        company: 'ABC Corp',
        city: 'Delhi',
        status: 'Active',
        email: 'test@abc.com',
        projectManager: ['Test Admin'],
        teamDone: true,
        asked: ['client', 'company', 'city', 'status', 'email', 'projectManager']
      }
    }, deps);
    assert.equal(stepNewClientPlan.field, 'clientPlan');
    const newClientPlanChips = stepNewClientPlan.chips.map(c => c.label);
    assert.ok(newClientPlanChips.some(l => l.includes('Diamond Ultra Plan')), 'Diamond Ultra Plan must appear in create_client plan chips');
    assert.ok(!newClientPlanChips.includes('Select plan manually'), 'Select plan manually chip must NOT be present');
  });

  test('15. Context-aware Cancel & Description Skip (Koi nahi / Skip) & Service Tasks flow', async () => {
    const mockReq = {
      user: {
        role: 'Company Owner',
        companyCode: 'ACME100',
        permissions: ['admin-task-create'],
      }
    };
    const deps = {
      accessibleProjects: [],
      accessibleClients: [],
      companyUsers: [{ _id: 'u1', name: 'Test Admin', role: 'Company Owner' }],
      services: ['Web Development', 'Mobile App Development'],
      clientPlans: []
    };

    // A. Cancel in create_client says Client add karna cancel...
    const cancelClient = await parseTaskRequest({
      req: mockReq,
      action: { type: 'cancel' },
      draft: { intent: 'create_client', client: 'Kanika' }
    }, deps);
    assert.equal(cancelClient.status, 'cancelled');
    assert.match(cancelClient.reply, /Client add karna cancel kar diya gaya hai/i);
    assert.ok(cancelClient.chips.some(c => c.label === 'Naya Client Add Karein'));

    // B. Cancel in create_client_plan says Client plan banana cancel...
    const cancelPlan = await parseTaskRequest({
      req: mockReq,
      action: { type: 'cancel' },
      draft: { intent: 'create_client_plan', name: 'Bronze Plan' }
    }, deps);
    assert.equal(cancelPlan.status, 'cancelled');
    assert.match(cancelPlan.reply, /Client plan banana cancel kar diya gaya hai/i);
    assert.ok(cancelPlan.chips.some(c => c.label === 'Naya Plan Banayein'));

    // C. Description skip with "Koi nahi / Skip"
    const planDescTurn = await parseTaskRequest({
      req: mockReq,
      message: 'Koi nahi / Skip',
      draft: {
        intent: 'create_client_plan',
        name: 'Platinum Plan',
        price: 5000,
        months: 1,
        status: 'Active',
        asked: ['name', 'price', 'months', 'status', 'description']
      }
    }, deps);
    assert.equal(planDescTurn.draft.descriptionSkipped, true);
    assert.equal(planDescTurn.field, 'services');
    assert.match(planDescTurn.reply, /services shamil karni hain/i);

    // D. Service Tasks query in create_client
    const clientServicesDone = await parseTaskRequest({
      req: mockReq,
      action: { type: 'finish_client_services' },
      draft: {
        intent: 'create_client',
        client: 'Kanika Corp',
        company: 'Kanika Pvt Ltd',
        city: 'Mohali',
        status: 'Active',
        email: 'kanika@corp.com',
        projectManager: ['Test Admin'],
        teamDone: true,
        services: ['Web Development'],
        servicesDone: true,
        clientPlanSkipped: true,
        asked: ['client', 'company', 'city', 'status', 'email', 'projectManager', 'clientPlan', 'services']
      }
    }, deps);
    assert.equal(clientServicesDone.field, 'more_details', 'create_client bypasses serviceTasks and moves directly to more_details');

    // C. create_client_plan DOES ask for service tasks
    const planServicesDone = await parseTaskRequest({
      req: mockReq,
      draft: {
        intent: 'create_client_plan',
        name: 'Silver Plan',
        price: 5000,
        months: 1,
        status: 'Active',
        description: '',
        descriptionDone: true,
        services: ['Web Development'],
        servicesDone: true,
        asked: ['name', 'price', 'months', 'status', 'description', 'services']
      }
    }, deps);
    assert.equal(planServicesDone.field, 'serviceTasks');
    assert.match(planServicesDone.reply, /in services mein koi task add karna chahte hain/i);
    const serviceTaskChips = planServicesDone.chips.map(c => c.label);
    assert.ok(serviceTaskChips.includes('Haan, task add karein'));
    assert.ok(serviceTaskChips.includes('Nahi, aage badhein'));
  });

});
