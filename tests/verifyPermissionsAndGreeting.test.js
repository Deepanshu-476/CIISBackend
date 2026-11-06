const assert = require('node:assert');
const {
  parseTaskRequest,
  getWelcomeMessage,
  resolveUserAllowedIntents,
  getPermissionDeniedReply
} = require('../services/ai/taskAgentService');
const { buildChips } = require('../services/ai/formRegistry');

(async () => {
  console.log('=== TEST 1: Dynamic Time-based Greeting & User First Name ===');
  const morningDate = new Date('2026-11-05T09:30:00+05:30');
  const afternoonDate = new Date('2026-11-05T14:15:00+05:30');
  const eveningDate = new Date('2026-11-05T19:00:00+05:30');

  const userKanika = { name: 'Kanika Sharma', role: 'employee' };

  // 1a. English greeting (default)
  const morningMsgEn = getWelcomeMessage(userKanika, morningDate, 'en');
  console.log('Morning English message:', morningMsgEn.reply);
  assert.equal(morningMsgEn.reply, 'Good morning Kanika! What would you like to do today?');
  assert.equal(morningMsgEn.speakText, 'Good morning Kanika! What would you like to do today?');

  // 1b. Hinglish greeting
  const morningMsgHi = getWelcomeMessage(userKanika, morningDate, 'hinglish');
  console.log('Morning Hinglish message:', morningMsgHi.reply);
  assert.equal(morningMsgHi.reply, 'Good morning Kanika! Aap aaj kya karna chahte hain?');
  assert.ok(morningMsgHi.speech.includes('गुड मॉर्निंग'));

  const afternoonMsg = getWelcomeMessage(userKanika, afternoonDate, 'en');
  console.log('Afternoon message:', afternoonMsg.reply);
  assert.equal(afternoonMsg.reply, 'Good afternoon Kanika! What would you like to do today?');

  const eveningMsg = getWelcomeMessage(userKanika, eveningDate, 'en');
  console.log('Evening message:', eveningMsg.reply);
  assert.equal(eveningMsg.reply, 'Good evening Kanika! What would you like to do today?');

  // Fallback when user has no name
  const anonymousMsg = getWelcomeMessage({ role: 'employee' }, morningDate, 'en');
  assert.equal(anonymousMsg.reply, 'Good morning! I am your CIIS AI Assistant. What would you like to do today?');
  console.log('Test 1 passed: Dynamic greeting works for all times of day, pure English default and Hinglish!');

  console.log('\n=== TEST 2: Permission Resolution (Privileged vs Restricted) ===');
  const ownerUser = { role: 'Company Owner', companyCode: 'ACME' };
  const ownerIntents = resolveUserAllowedIntents(ownerUser);
  assert.equal(ownerIntents.length, 7);
  assert.ok(ownerIntents.includes('self_task'));
  assert.ok(ownerIntents.includes('create_client'));
  assert.ok(ownerIntents.includes('create_project'));

  const restrictedUser = { _id: 'u_emp', name: 'Rahul Verma', role: 'employee', companyCode: 'ACME' };
  const restrictedIntents = resolveUserAllowedIntents(restrictedUser, {}, { strictPermissions: true });
  console.log('Restricted employee allowed intents:', restrictedIntents);
  assert.deepEqual(restrictedIntents, ['self_task']);

  const clientAllowedUser = {
    _id: 'u_mgr',
    name: 'Vansh',
    role: 'employee',
    companyCode: 'ACME',
    allowedPages: ['/ciisUser/emp-client']
  };
  const clientAllowedIntents = resolveUserAllowedIntents(clientAllowedUser, {}, { strictPermissions: true });
  console.log('Client-manager allowed intents:', clientAllowedIntents);
  assert.ok(clientAllowedIntents.includes('self_task'));
  assert.ok(clientAllowedIntents.includes('create_client'));
  assert.ok(!clientAllowedIntents.includes('create_project'));
  console.log('Test 2 passed: Permission resolution differentiates roles and assigned pages correctly!');

  console.log('\n=== TEST 3: Welcome Chips Filtering ===');
  const restrictedChips = buildChips(null, 'welcome', { allowedIntents: restrictedIntents });
  console.log('Restricted chips count:', restrictedChips.length, 'labels:', restrictedChips.map(c => c.label));
  assert.equal(restrictedChips.length, 1);
  assert.equal(restrictedChips[0].label, 'Personal task banana');

  const ownerChips = buildChips(null, 'welcome', { allowedIntents: ownerIntents });
  console.log('Owner chips count:', ownerChips.length);
  assert.equal(ownerChips.length, 6);
  console.log('Test 3 passed: Welcome chips filtered to exactly allowed intents!');

  console.log('\n=== TEST 4: Unauthorized Intent Interception in parseTaskRequest ===');
  const reqRestricted = {
    user: restrictedUser,
  };

  const restrictedScopeDeps = {
    getScopeInfo: async () => ({ hasAccess: false, isOwner: false, branchIds: [], departmentIds: [] }),
    accessibleProjects: [],
    accessibleClients: [],
    strictPermissions: true,
  };

  // Case A: Restricted employee clicks or sends set_intent: 'create_client'
  const resClickDenied = await parseTaskRequest({
    req: reqRestricted,
    action: { type: 'set_intent', intent: 'create_client' },
    draft: {}
  }, restrictedScopeDeps);
  console.log('Case A (action denied) reply:', resClickDenied.reply);
  assert.equal(resClickDenied.field, 'welcome');
  assert.ok(resClickDenied.reply.includes('access nahi hai'));
  assert.equal(resClickDenied.chips.length, 1);
  assert.equal(resClickDenied.chips[0].label, 'Personal task banana');

  // Case B: Restricted employee clicks reset / main menu
  const resReset = await parseTaskRequest({
    req: reqRestricted,
    action: { type: 'reset' }
  }, restrictedScopeDeps);
  console.log('Case B (reset for restricted user) chips:', resReset.chips.map(c => c.label));
  assert.equal(resReset.chips.length, 1);
  assert.equal(resReset.chips[0].label, 'Personal task banana');
  assert.ok(resReset.reply.includes('Rahul'));

  // Case C: Restricted employee sends free text "Naya client add karna hai"
  const resTextDenied = await parseTaskRequest({
    req: reqRestricted,
    message: 'Naya client add karna hai',
    draft: {}
  }, restrictedScopeDeps);
  console.log('Case C (free text denied) reply:', resTextDenied.reply);
  assert.ok(resTextDenied.reply.includes('access nahi hai'));
  assert.equal(resTextDenied.chips.length, 1);
  assert.equal(resTextDenied.chips[0].label, 'Personal task banana');

  console.log('Test 4 passed: Unauthorized intents are safely intercepted and denied politely!');

  console.log('\n=== TEST 5: Conversational Chit-Chat & Greeting (Screenshot Bug Fix) ===');
  // Case A: User sends "gud morning , how are u" (exact reproduction of bug from screenshot)
  const resChitChat = await parseTaskRequest({
    req: { user: userKanika },
    message: 'gud morning , how are u',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: [],
    accessibleClients: []
  });
  console.log('Chit-chat response reply:', resChitChat.reply);
  // Ensure NO employee search / "employee nahi mila" error
  assert.ok(!resChitChat.reply.includes('employee nahi mila'));
  assert.ok(!resChitChat.reply.includes('kisse assign karna hai'));
  assert.ok(resChitChat.reply.includes('Kanika'));
  assert.ok(resChitChat.reply.toLowerCase().includes('doing great') || resChitChat.reply.toLowerCase().includes('good morning'));
  assert.equal(resChitChat.field, 'welcome');
  assert.equal(resChitChat.status, 'open');
  assert.equal(resChitChat.draft, null);
  // English chips returned because input was English
  assert.ok(resChitChat.chips.some(c => c.label === 'Create personal task'));
  console.log('Test 5 passed: "gud morning , how are u" answered naturally in English with chips and 0 errors!');

  console.log('\n=== TEST 6: Strict CRM Boundary & Out of Scope Guardrails ===');
  // Case A: User asks about medicine/fever
  const resMedical = await parseTaskRequest({
    req: { user: userKanika },
    message: 'mujhe bukhar hai koi medicine batao',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: [],
    accessibleClients: []
  });
  console.log('Medical out-of-scope response:', resMedical.reply);
  assert.ok(resMedical.reply.includes('CIIS CRM Assistant'));
  assert.ok(resMedical.reply.includes('dawai') || resMedical.reply.includes('medical') || resMedical.reply.includes('sirf aapke CRM'));
  assert.equal(resMedical.field, 'welcome');
  assert.equal(resMedical.draft, null);

  // Case B: General knowledge trivia
  const resTrivia = await parseTaskRequest({
    req: { user: userKanika },
    message: 'what is the capital of india',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: [],
    accessibleClients: []
  });
  console.log('Trivia out-of-scope response:', resTrivia.reply);
  assert.ok(resTrivia.reply.includes('CIIS CRM Assistant'));
  assert.ok(resTrivia.reply.toLowerCase().includes('cannot answer') || resTrivia.reply.toLowerCase().includes('only assist'));
  console.log('Test 6 passed: Out-of-scope questions strictly rejected!');

  console.log('\n=== TEST 7: CRM Read Query (Tasks list) ===');
  const mockTasks = [
    { title: 'Prepare Client Proposal', overallStatus: 'pending', dueDateTime: new Date('2026-11-06T15:00:00Z') },
    { title: 'Update Dashboard UI', overallStatus: 'in-progress', dueDateTime: new Date('2026-11-07T18:00:00Z') }
  ];
  const resCrmQuery = await parseTaskRequest({
    req: { user: userKanika },
    message: 'show my tasks',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    tasks: mockTasks,
    accessibleProjects: [],
    accessibleClients: []
  });
  console.log('CRM Query response:\n', resCrmQuery.reply);
  assert.ok(resCrmQuery.reply.includes('Prepare Client Proposal'));
  assert.ok(resCrmQuery.reply.includes('Update Dashboard UI'));
  assert.equal(resCrmQuery.field, 'welcome');
  console.log('Test 7 passed: CRM queries answered with structured data!');

  console.log('\n=== TEST 8: User Failure Cases from Screenshots ===');
  // 8A. Mood greeting (Image 2)
  const resMood = await parseTaskRequest({
    req: { user: userKanika },
    message: 'gud morning aj mera mood bhuut asha hai aj mai bhuut kush hu',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: [],
    accessibleClients: []
  });
  console.log('Mood response reply:', resMood.reply);
  assert.ok(resMood.reply.toLowerCase().includes('mood') || resMood.reply.toLowerCase().includes('khush') || resMood.reply.toLowerCase().includes('great'));
  assert.equal(resMood.draft, null, 'Draft must be null, never create a task from mood greeting');
  assert.equal(resMood.field, 'welcome');

  // 8B. In-progress task status query with typos "hia ?" (Image 3)
  const resStatusQuery = await parseTaskRequest({
    req: { user: userKanika },
    message: 'abhi mera kon sa task in progress mein hia ?',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    tasks: mockTasks,
    accessibleProjects: [],
    accessibleClients: []
  });
  console.log('Status query reply:\n', resStatusQuery.reply);
  assert.ok(resStatusQuery.reply.includes('Update Dashboard UI'), 'Must list the in-progress task');
  assert.ok(!resStatusQuery.reply.includes('Prepare Client Proposal'), 'Must not list pending tasks when asked specifically for in-progress');
  assert.equal(resStatusQuery.draft, null, 'Draft must be null, never create a task titled "abhi mera kon sa task..."');
  assert.equal(resStatusQuery.field, 'welcome');

  // 8C. Greeting with comma "gud morning , how are u" (Image 1)
  const resGreetingComma = await parseTaskRequest({
    req: { user: userKanika },
    message: 'gud morning , how are u',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: [],
    accessibleClients: []
  });
  console.log('Greeting comma reply:', resGreetingComma.reply);
  assert.ok(resGreetingComma.reply.toLowerCase().includes('good morning') || resGreetingComma.reply.toLowerCase().includes('doing great'));
  assert.ok(!resGreetingComma.reply.includes('naam ka koi employee nahi mila'), 'Must NEVER extract employee name from greeting');
  assert.equal(resGreetingComma.draft, null);
  console.log('Test 8 passed: All 3 screenshot failure cases verified and fixed!');

  console.log('\n=== TEST 9: Project & Task Query Precision Suite ===');
  const mockProjects = [
    { projectName: 'CIIS Network Portal', status: 'Active' },
    { projectName: 'Mobile App 2.0', status: 'Pending' }
  ];

  // 9A: Project count query in Hindi/Hinglish: "abhi mere crm mai kitne projects hai"
  const resProjCount = await parseTaskRequest({
    req: { user: userKanika },
    message: 'abhi mere crm mai kitne projects hai',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: mockProjects,
    accessibleClients: []
  });
  console.log('Project count query reply:\n', resProjCount.reply);
  assert.ok(resProjCount.reply.includes('2 project(s) ka access hai'));
  assert.ok(resProjCount.reply.includes('CIIS Network Portal'));
  assert.equal(resProjCount.draft, null, 'Must NOT create a task from project count query');
  assert.equal(resProjCount.field, 'welcome');

  // 9B: Greeting + Project query combined: "gud morning tell me about which projects i have"
  const resGreetProj = await parseTaskRequest({
    req: { user: userKanika },
    message: 'gud morning tell me about which projects i have',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: mockProjects,
    accessibleClients: []
  });
  console.log('Greeting + Project query reply:\n', resGreetProj.reply);
  assert.ok(resGreetProj.reply.toLowerCase().includes('good morning'));
  assert.ok(resGreetProj.reply.includes('CIIS Network Portal'));
  assert.equal(resGreetProj.draft, null, 'Must NOT create a task or swallow inquiry into bare chit-chat');
  assert.equal(resGreetProj.field, 'welcome');

  // 9C: Task status query with typo "personal taks": "check karke batao mera kon sa personal taks abhi in progress hai"
  const resTypoTask = await parseTaskRequest({
    req: { user: userKanika },
    message: 'check karke batao mera kon sa personal taks abhi in progress hai',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    tasks: mockTasks,
    accessibleProjects: mockProjects,
    accessibleClients: []
  });
  console.log('Typo task query reply:\n', resTypoTask.reply);
  assert.ok(resTypoTask.reply.includes('Update Dashboard UI'));
  assert.ok(!resTypoTask.reply.includes('Prepare Client Proposal'));
  assert.equal(resTypoTask.draft, null, 'Must NOT ask for task name or create task');
  assert.equal(resTypoTask.field, 'welcome');
  console.log('Test 9 passed: Project queries and typo queries handled with 100% human intelligence!');

  console.log('\n=== TEST 10: Client Queries & Client Service Task Suite ===');
  const mockClients = [
    { _id: 'c1', client: 'TechSoft Solutions', company: 'TechSoft Inc', services: ['Cloud Architecture', 'Web Development'] }
  ];

  // 10A: Devanagari client query: "चेक करू मेरी CRM में कितने क्लाइज़ हैं?"
  const resClientDevanagari = await parseTaskRequest({
    req: { user: userKanika },
    message: 'चेक करू मेरी CRM में कितने क्लाइज़ हैं?',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: mockProjects,
    accessibleClients: mockClients
  });
  console.log('Devanagari client query reply:\n', resClientDevanagari.reply);
  assert.ok(resClientDevanagari.reply.includes('TechSoft Solutions'));
  assert.equal(resClientDevanagari.draft, null);
  assert.equal(resClientDevanagari.field, 'welcome');

  // 10B: Whisper phonetic typo query: "Oh, cek guru miri project my kidney clients here."
  const resWhisperClient = await parseTaskRequest({
    req: { user: userKanika },
    message: 'Oh, cek guru miri project my kidney clients here.',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: mockProjects,
    accessibleClients: mockClients
  });
  console.log('Whisper phonetic client query reply:\n', resWhisperClient.reply);
  assert.ok(resWhisperClient.reply.includes('TechSoft Solutions'));
  assert.equal(resWhisperClient.draft, null);

  // 10C: Breaking out of a project slot waiting loop
  const resBreakLoop = await parseTaskRequest({
    req: { user: userKanika },
    message: 'check karo mere crm mai kitne clients hain',
    draft: { intent: 'task_project', asked: ['project'] }
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: mockProjects,
    accessibleClients: mockClients
  });
  console.log('Break project loop reply:\n', resBreakLoop.reply);
  assert.ok(resBreakLoop.reply.includes('TechSoft Solutions'));
  assert.equal(resBreakLoop.draft, null, 'Must break out of project question loop and answer client query');

  // 10D: Adding a task to a client's service: "TechSoft client ki Cloud service mein task add karo"
  const resClientServiceTask = await parseTaskRequest({
    req: { user: userKanika },
    message: 'TechSoft client ki Cloud Architecture service mein task add karo',
    draft: {}
  }, {
    getScopeInfo: async () => ({ isOwner: true }),
    accessibleProjects: mockProjects,
    accessibleClients: mockClients
  });
  console.log('Client service task reply:\n', resClientServiceTask.reply);
  assert.equal(resClientServiceTask.draft.intent, 'create_client_task');
  assert.equal(resClientServiceTask.draft.client, 'TechSoft Solutions');
  assert.equal(resClientServiceTask.draft.service, 'Cloud Architecture');
  console.log('Test 10 passed: Client queries and Client Service Task creation working seamlessly across sections!');

  console.log('\n======================================================');
  console.log('>>> ALL PERMISSION, GREETING & CONVERSATIONAL TESTS PASSED 100% <<<');
  console.log('======================================================');
  process.exit(0);
})();
