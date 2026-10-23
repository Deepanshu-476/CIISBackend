require('dotenv').config();
const { describe, it } = require('node:test');
const test = it;
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { parseTaskRequest, formatHumanIstDate, formatAssigneeLabel } = require('../services/ai/taskAgentService');
const { mergeDraft, extractTaskDraft, normaliseExtracted, classifyAndLogGroqError } = require('../services/ai/taskExtractor');
const { taskDraftSchema } = require('../services/ai/aiSchemas');
const { toJsonSchema } = require('@langchain/core/utils/json_schema');
const { resolveAssignee } = require('../services/ai/assigneeResolver');
const { parseTask } = require('../controllers/aiController');
const { parseHinglishSlots, applyTitleFallback } = require('../services/ai/hinglishParser');
const Task = require('../HR-CDS/models/Task');

describe('AI Task Agent Suite', () => {
  // Global spy to guarantee Task model is NEVER written or instantiated
  let taskCreateCalled = false;
  let taskSaveCalled = false;
  Task.create = (...args) => {
    taskCreateCalled = true;
    throw new Error('ILLEGAL: Task.create was called during AI task agent execution!');
  };
  Task.prototype.save = function (...args) {
    taskSaveCalled = true;
    throw new Error('ILLEGAL: Task.prototype.save was called during AI task agent execution!');
  };

  // Fixed reference time for deterministic testing: 2026-10-12 10:00:00 UTC = 2026-10-12 15:30:00 IST
  const fixedNow = new Date('2026-10-12T10:00:00.000Z');
  const companyId = new mongoose.Types.ObjectId();
  const requesterId = new mongoose.Types.ObjectId();

  const mockRequester = {
    _id: requesterId,
    id: requesterId,
    name: 'Test Employee',
    company: companyId,
    companyCode: 'COMP-01',
    companyRole: 'employee',
    jobRole: 'Developer',
  };

  const mockReq = {
    user: mockRequester,
  };

  const mockScope = { hasAccess: false, isOwner: false, branchIds: [], departmentIds: [] };

  it('1. missing title -> needs_input asks title in Hinglish and Hindi speech', async () => {
    const result = await parseTaskRequest({
      req: mockReq,
      message: 'shaam 6 baje tak',
      language: 'hinglish',
      draft: {},
    }, {
      now: fixedNow,
      extractFn: async () => ({
        title: null,
        description: null,
        checkpoints: [],
        priority: null,
        dueDateTime: '2026-10-12T18:00:00+05:30',
        assigneeName: null,
      }),
      getScopeInfo: async () => mockScope,
    });

    assert.equal(result.status, 'needs_input');
    assert.deepEqual(result.missing, ['title']);
    assert.equal(result.field, 'title');
    assert.equal(result.reply, 'Task ka naam kya rakhna hai?');
    assert.equal(result.speech, 'टास्क का नाम क्या रखना है?');
    assert.equal(result.payload, undefined);
  });

  it('2. title provided, no due -> needs_input asks due date + chips with +05:30', async () => {
    const result = await parseTaskRequest({
      req: mockReq,
      message: 'Prepare quarterly sales report',
      language: 'hinglish',
      draft: {},
    }, {
      now: fixedNow,
      extractFn: async () => ({
        title: 'Prepare quarterly sales report',
        description: null,
        checkpoints: [],
        priority: null,
        dueDateTime: null,
        assigneeName: null,
      }),
      getScopeInfo: async () => mockScope,
    });

    assert.equal(result.status, 'needs_input');
    assert.deepEqual(result.missing, ['dueDateTime']);
    assert.equal(result.field, 'dueDateTime');
    assert.equal(result.reply, 'Ye task kab tak complete hona chahiye? Date aur time batayein.');
    assert.ok(result.chips.length > 0);
    result.chips.forEach(chip => {
      assert.ok(chip.label);
      assert.ok(chip.value.includes('+05:30'), `Expected +05:30 timezone in ${chip.value}`);
      const chipDate = new Date(chip.value);
      assert.ok(chipDate.getTime() > fixedNow.getTime(), `Expected future time for chip ${chip.label}`);
    });
  });

  it('3. exact failing sentence extracts title, description, and tomorrow 10:00 IST', async () => {
    const msg = 'Mera task create karo uska naam yah voice change ho aur uska description pipeline connection and vah cal Subah 10:00 complete ho jaega';
    const det = parseHinglishSlots(msg, fixedNow);
    assert.equal(det.title, 'Voice change');
    assert.equal(det.description, 'Pipeline connection');
    assert.equal(det.dueDateTime, '2026-10-13T10:00:00+05:30');

    const result = await parseTaskRequest({
      req: mockReq,
      message: msg,
      language: 'hinglish',
      draft: {},
    }, {
      now: fixedNow,
      extractFn: async () => ({
        title: 'Voice change',
        description: 'Pipeline connection',
        dueDateTime: '2026-10-13T10:00:00+05:30',
        priority: null,
        checkpoints: [],
        assigneeName: null,
      }),
      getScopeInfo: async () => mockScope,
    });

    assert.equal(result.draft.title, 'Voice change');
    assert.equal(result.draft.description, 'Pipeline connection');
    assert.equal(result.draft.dueDateTime, '2026-10-13T10:00:00+05:30');
    // Next optional field is priority
    assert.equal(result.field, 'priority');
    assert.ok(result.reply.includes('Priority kya rakhein? Low, Medium ya High?'));
    assert.ok(result.reply.includes('Samajh gaya:'));
    assert.ok(result.reply.includes('Kya samjha:'));
  });

  it('4. skip words mark field as skipped and move to next question', async () => {
    // Current draft has title and dueDateTime; currently asking description
    const draft = {
      title: 'Voice change',
      dueDateTime: '2026-10-13T10:00:00+05:30',
      asked: ['title', 'dueDateTime', 'description'],
    };

    let extractCalled = false;
    const result = await parseTaskRequest({
      req: mockReq,
      message: 'koi nahi',
      language: 'hinglish',
      draft,
    }, {
      now: fixedNow,
      extractFn: async () => {
        extractCalled = true;
        return {};
      },
      getScopeInfo: async () => mockScope,
    });

    assert.equal(extractCalled, false, 'Skip words must not invoke LLM extractor');
    assert.ok(result.draft.skipped.includes('description'));
    assert.equal(result.draft.description, '');
    // Next question is priority
    assert.equal(result.field, 'priority');
  });

  it('5. "baaki sab default" skips all remaining optional fields and reaches ready', async () => {
    const draft = {
      title: 'Voice change',
      dueDateTime: '2026-10-13T10:00:00+05:30',
      asked: ['title', 'dueDateTime'],
    };

    let extractCalled = false;
    const result = await parseTaskRequest({
      req: mockReq,
      message: 'baaki sab default',
      language: 'hinglish',
      draft,
    }, {
      now: fixedNow,
      extractFn: async () => {
        extractCalled = true;
        return {};
      },
      getScopeInfo: async () => mockScope,
    });

    assert.equal(extractCalled, false, 'Skip-all must not invoke LLM extractor');
    assert.equal(result.status, 'ready');
    assert.equal(result.field, 'ready');
    assert.ok(result.payload);
    assert.equal(result.payload.endpoint, '/tasks/self/create');
    assert.equal(result.payload.multipart, true);
    assert.equal(result.payload.fields.title, 'Voice change');
    assert.equal(result.payload.fields.description, '', 'Empty description must stay blank in payload');
    assert.equal(result.payload.fields.priority, 'medium');
    assert.equal(result.payload.fields.priorityDays, '1');
    assert.equal(result.payload.fields.repeatPattern, 'none');
  });

  it('6. action chips (set, skip, skip_all, attachments) work without LLM', async () => {
    let extractCalled = false;
    const extractFn = async () => {
      extractCalled = true;
      return {};
    };

    // (a) Action set priority
    const resA = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'priority', value: 'high' },
      draft: { title: 'T', dueDateTime: '2026-10-13T10:00:00+05:30', description: '' },
    }, { now: fixedNow, extractFn, getScopeInfo: async () => mockScope });

    assert.equal(extractCalled, false);
    assert.equal(resA.draft.priority, 'high');

    // (b) Action attachments
    const resB = await parseTaskRequest({
      req: mockReq,
      action: { type: 'attachments', count: 2 },
      draft: { ...resA.draft, asked: ['attachments'] },
    }, { now: fixedNow, extractFn, getScopeInfo: async () => mockScope });

    assert.equal(extractCalled, false);
    assert.equal(resB.draft.attachmentsCount, 2);
  });

  it('7. LLM failure falls back smoothly to deterministic parser result', async () => {
    const msg = 'Mera task create karo uska naam yah voice change ho aur uska description pipeline connection and vah cal Subah 10:00 complete ho jaega';

    const result = await parseTaskRequest({
      req: mockReq,
      message: msg,
      language: 'hinglish',
      draft: {},
    }, {
      now: fixedNow,
      extractFn: async () => {
        const err = new Error('Groq 500 internal server error');
        err.code = 'LLM_BAD_OUTPUT';
        throw err;
      },
      getScopeInfo: async () => mockScope,
    });

    // Should NOT throw 500/502; deterministic slots should fill title, description, dueDateTime!
    assert.equal(result.draft.title, 'Voice change');
    assert.equal(result.draft.description, 'Pipeline connection');
    assert.equal(result.draft.dueDateTime, '2026-10-13T10:00:00+05:30');
    assert.equal(result.status, 'needs_input');
    assert.equal(result.field, 'priority');
  });

  it('8. payload.fields matches real form submit contract and has NO identity keys', async () => {
    const futureIso = '2026-10-13T18:00:00+05:30';
    const draft = {
      title: 'Submit quarterly GST report',
      description: '',
      dueDateTime: futureIso,
      priority: 'high',
      status: 'in-progress',
      reminder: true,
      reminderOption: 'hourly',
      priorityDays: '2',
      repeatPattern: 'none',
      repeatDays: [],
      checkpoints: [{ title: 'Check bank statement', completed: false }],
      attachmentsCount: 1,
      skipped: [],
      asked: ['title', 'dueDateTime', 'description', 'priority', 'status', 'reminder', 'reminderOption', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments'],
    };

    const result = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'attachments', value: 1 },
      draft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });

    assert.equal(result.status, 'ready');
    const p = result.payload;
    assert.equal(p.endpoint, '/tasks/self/create');
    assert.equal(p.method, 'POST');
    assert.equal(p.multipart, true);
    assert.equal(p.fileField, 'files');

    // Fields checks
    assert.equal(p.fields.title, 'Submit quarterly GST report');
    assert.equal(p.fields.description, '');
    assert.equal(p.fields.dueDateTime, futureIso);
    assert.equal(p.fields.priority, 'high');
    assert.equal(p.fields.status, 'in-progress');
    assert.equal(result.preview.status, 'in-progress');
    assert.equal(result.preview.statusLabel, 'In Progress');
    assert.equal(p.fields.priorityDays, '2');
    assert.equal(p.fields.repeatPattern, 'none');
    assert.equal(p.fields.repeatDays, '[]');
    assert.equal(p.fields.checkpoints, JSON.stringify([{ title: 'Check bank statement', completed: false }]));
    assert.ok(p.fields.reminderSettings.includes('"enabled":true'));
    assert.ok(p.fields.reminderSettings.includes('"hourly"'));

    // Identity keys MUST NOT be present
    assert.equal(p.fields.user, undefined);
    assert.equal(p.fields.company, undefined);
    assert.equal(p.fields.companyCode, undefined);
    assert.equal(p.fields.createdBy, undefined);
  });

  it('9. assignee handling: non-privileged employee falls back to self with notice', async () => {
    const employeeReq = {
      user: {
        _id: new mongoose.Types.ObjectId(),
        company: companyId,
        companyCode: 'COMP-01',
        companyRole: 'employee',
      },
    };

    const result = await parseTaskRequest({
      req: employeeReq,
      message: 'Assign to Rahul',
      language: 'hinglish',
      draft: {},
    }, {
      now: fixedNow,
      extractFn: async () => ({
        title: null,
        description: null,
        dueDateTime: null,
        priority: null,
        checkpoints: [],
        assigneeName: 'Rahul',
      }),
      getScopeInfo: async () => ({ hasAccess: false, isOwner: false, branchIds: [], departmentIds: [] }),
    });

    assert.equal(result.draft.assigneeName, null);
    assert.equal(result.draft.assigneeId, null);
    assert.ok(result.notices.some(n => n.includes('permission nahi hai')));
  });

  it('10. multiple assignees -> needs_disambiguation with candidates for admin', async () => {
    const adminReq = {
      user: {
        _id: requesterId,
        company: companyId,
        companyCode: 'COMP-01',
        companyRole: 'manager',
      },
    };
    const user1Id = new mongoose.Types.ObjectId().toString();
    const user2Id = new mongoose.Types.ObjectId().toString();

    const result = await parseTaskRequest({
      req: adminReq,
      message: 'Assign to Ashutosh',
      language: 'hinglish',
      draft: {},
    }, {
      now: fixedNow,
      extractFn: async () => ({
        title: null,
        description: null,
        dueDateTime: null,
        priority: null,
        checkpoints: [],
        assigneeName: 'Ashutosh',
      }),
      resolveAssignee: async () => ({
        status: 'multiple',
        candidates: [
          { id: user1Id, _id: user1Id, name: 'Ashutosh Sharma', employeeId: 'EMP-01', jobRole: 'Developer' },
          { id: user2Id, _id: user2Id, name: 'Ashutosh Verma', employeeId: 'EMP-02', jobRole: 'QA' },
        ],
      }),
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true, branchIds: ['all'], departmentIds: ['all'] }),
    });

    assert.equal(result.status, 'needs_disambiguation');
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0].name, 'Ashutosh Sharma');
    assert.equal(result.candidates[1].name, 'Ashutosh Verma');
  });

  it('11. controller error mapping tests (no buffering timeouts)', async () => {
    const origKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    const createMockRes = () => {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          return this;
        },
      };
      return res;
    };

    try {
      const res = createMockRes();
      const req = { user: mockRequester, body: { message: 'Create task' } };
      await parseTask(req, res, { getScopeInfo: async () => mockScope });
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, 'LLM_NOT_CONFIGURED');
    } finally {
      process.env.GROQ_API_KEY = origKey;
    }
  });

  it('12. Task.create and Task.prototype.save were never called', () => {
    assert.equal(taskCreateCalled, false, 'Task.create must never be called by AI layer');
    assert.equal(taskSaveCalled, false, 'Task.prototype.save must never be called by AI layer');
  });

  it('13. deterministic self words (EN/Hinglish/Devanagari) mark assignee as self and never ask again', async () => {
    const adminReq = { user: { ...mockRequester, companyRole: 'owner' } };
    const adminScope = { hasAccess: true, isOwner: true, branchIds: ['all'], departmentIds: ['all'] };

    const selfPhrases = [
      'khud ke liye',
      'apne liye',
      'mere liye',
      'mujhe',
      'self',
      'me',
      'myself',
      'for me',
      'खुद के लिए',
      'अपने लिए',
      'मेरे लिए',
      'मैं',
    ];

    for (const phrase of selfPhrases) {
      const res = await parseTaskRequest({
        req: adminReq,
        message: phrase,
      }, {
        now: fixedNow,
        getScopeInfo: async () => adminScope,
        extractFn: async () => ({}),
      });

      assert.equal(res.draft.taskFor, 'self', `Failed for phrase: ${phrase}`);
      assert.equal(res.draft.skipped.includes('assignee'), true, `Assignee should be in skipped for: ${phrase}`);
      // Should ask title, NOT assignee!
      assert.equal(res.field, 'title', `Next field should be title, not assignee for: ${phrase}`);
    }
  });

  it('14. assignee question asked twice with unknown answer stops looping and offers chips [Khud ke liye] [Naam type karein]', async () => {
    const adminReq = { user: { ...mockRequester, companyRole: 'owner' } };
    const adminScope = { hasAccess: true, isOwner: true, branchIds: ['all'], departmentIds: ['all'] };

    // Admin user initiates others flow
    const turn1 = await parseTaskRequest({
      req: adminReq,
      action: { type: 'set', field: 'taskFor', value: 'others' },
    }, {
      now: fixedNow,
      getScopeInfo: async () => adminScope,
    });
    assert.equal(turn1.field, 'assignee');

    // Turn 2: User provides gibberish or unknown name
    const turn2 = await parseTaskRequest({
      req: adminReq,
      message: 'koi anjaan vyakti',
      draft: turn1.draft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => adminScope,
      extractFn: async () => ({}),
      resolveAssignee: async () => ({ status: 'none', candidates: [] }),
    });

    assert.equal(turn2.field, 'assignee');
    // On second time asking assignee with no progress, should offer [Khud ke liye] [Naam type karein]
    assert.ok(turn2.chips.some(c => c.label === 'Khud ke liye'));
    assert.ok(turn2.chips.some(c => c.label === 'Naam type karein'));
    assert.notEqual(turn2.reply, turn1.reply, 'Should not repeat identical message');
  });

  it('15. generic anti-loop rule for ALL fields: asks with specific hint and examples on 2nd attempt', async () => {
    // Turn 1: user provides date only, agent asks title
    const turn1 = await parseTaskRequest({
      req: mockReq,
      message: 'kal subah 10 baje',
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
      extractFn: async () => ({}),
    });
    assert.equal(turn1.field, 'title');

    // Turn 2: message fails to provide title again
    const turn2 = await parseTaskRequest({
      req: mockReq,
      message: 'haan theek hai',
      draft: turn1.draft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
      extractFn: async () => ({}),
    });

    assert.equal(turn2.field, 'title');
    assert.notEqual(turn2.reply, turn1.reply, 'Title re-ask reply must be different and more specific');
    assert.ok(turn2.chips.length > 0, 'Re-ask title must provide example chips');
  });

  it('16. exact bug sentence extracts all 4 fields, acknowledges them, asks status next', async () => {
    const bugSentence = "Hello, my name is Kanika and task name is A Voice Assistant, description, creating pipeline of A Voice Assistant, priority high due date, jn tomorrow 10:10 am";

    const res = await parseTaskRequest({
      req: mockReq,
      message: bugSentence,
      draft: {},
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
      extractFn: async () => ({
        title: "A Voice Assistant",
        description: "Creating pipeline of A Voice Assistant",
        dueDateTime: "2026-10-13T10:10:00+05:30",
        priority: "high",
        assigneeName: null,
      }),
    });

    assert.equal(res.status, 'needs_input');
    assert.equal(res.field, 'status');
    assert.equal(res.draft.title, 'A Voice Assistant');
    assert.equal(res.draft.description, 'Creating pipeline of A Voice Assistant');
    assert.equal(res.draft.priority, 'high');
    assert.equal(res.draft.dueDateTime, '2026-10-13T10:10:00+05:30');
    assert.equal(res.draft.assigneeName, null);

    // Verify acknowledgment and Kya samjha summary
    assert.ok(res.reply.includes('Samajh gaya:'));
    assert.ok(res.reply.includes('naam, description, priority aur due date mil gaye.'));
    assert.ok(res.reply.includes('Kya samjha:'));
    assert.ok(res.reply.includes('naam = "A Voice Assistant"'));
    assert.ok(res.reply.includes('Task ka status kya rakhna hai?'));

    // Verify chips for status
    assert.ok(res.chips.some(c => c.label === 'Pending'));
    assert.ok(res.chips.some(c => c.label === 'In Progress'));
    assert.ok(res.chips.some(c => c.label === 'Completed'));
    assert.ok(res.chips.some(c => c.label === 'On Hold'));
    assert.ok(!res.chips.some(c => c.action?.field === 'dueDateTime'));
  });

  it('17. variants and self-intro testing', async () => {
    // Variant A: "task name is Database backup, priority low, deadline today 6 pm"
    const slotsA = parseHinglishSlots("task name is Database backup, priority low, deadline today 6 pm", fixedNow);
    assert.equal(slotsA.title, 'Database backup');
    assert.equal(slotsA.priority, 'low');
    assert.equal(slotsA.dueDateTime, '2026-10-12T18:00:00+05:30');

    // Variant B: "title: GST report description: Q3 filing due tomorrow 10 am"
    const slotsB = parseHinglishSlots("title: GST report description: Q3 filing due tomorrow 10 am", fixedNow);
    assert.equal(slotsB.title, 'GST report');
    assert.equal(slotsB.description, 'Q3 filing');
    assert.equal(slotsB.dueDateTime, '2026-10-13T10:00:00+05:30');

    // Variant C: Hinglish "uska naam X, priority high, kal subah 10 baje"
    const slotsC = parseHinglishSlots("uska naam X, priority high, kal subah 10 baje", fixedNow);
    assert.equal(slotsC.title, 'X');
    assert.equal(slotsC.priority, 'high');
    assert.equal(slotsC.dueDateTime, '2026-10-13T10:00:00+05:30');

    // Variant D: Devanagari variant "टास्क का नाम सर्वर बैकअप, प्रायोरिटी हाई, कल सुबह 10 बजे"
    const slotsD = parseHinglishSlots("टास्क का नाम सर्वर बैकअप, प्रायोरिटी हाई, कल सुबह 10 बजे", fixedNow);
    assert.ok(slotsD.dueDateTime);
    assert.equal(slotsD.dueDateTime, '2026-10-13T10:00:00+05:30');
    assert.equal(slotsD.priority, 'high');

    // Variant E: Pure self introduction "hello my name is Kanika"
    const selfTurn = await parseTaskRequest({
      req: mockReq,
      message: "hello my name is Kanika",
      draft: {},
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
      extractFn: async () => ({
        title: null,
        description: null,
        dueDateTime: null,
        priority: null,
        assigneeName: null,
      }),
    });
    // Nothing extracted, name NOT taken as title or assignee, asks title
    assert.equal(selfTurn.field, 'title');
    assert.equal(selfTurn.draft.title, null);
    assert.equal(selfTurn.draft.assigneeName, null);
  });

  it('18. multi-turn draft is preserved across turns and chips never reset filled fields', async () => {
    // Turn 1: rich sentence -> fills title, description, priority, dueDateTime; asks status
    const turn1 = await parseTaskRequest({
      req: mockReq,
      message: "Hello, my name is Kanika and task name is A Voice Assistant, description, creating pipeline of A Voice Assistant, priority high due date, jn tomorrow 10:10 am",
      draft: {},
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
      extractFn: async () => ({
        title: "A Voice Assistant",
        description: "Creating pipeline of A Voice Assistant",
        dueDateTime: "2026-10-13T10:10:00+05:30",
        priority: "high",
        assigneeName: null,
      }),
    });
    assert.equal(turn1.field, 'status');
    assert.equal(turn1.draft.title, 'A Voice Assistant');

    // Turn 2: User responds to status by selecting chip [In Progress]
    const turn2 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'status', value: 'in-progress' },
      draft: turn1.draft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(turn2.field, 'reminder');
    assert.equal(turn2.draft.status, 'in-progress');

    // Turn 3: User responds to reminder by selecting chip [Haan]
    const turn3 = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'reminder', value: true },
      draft: turn2.draft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    // With default option (oneHourBefore), reminder is fulfilled and agent moves to priorityDays
    assert.equal(turn3.field, 'priorityDays');
    assert.equal(turn3.draft.title, 'A Voice Assistant', 'Title must not be lost');
    assert.equal(turn3.draft.description, 'Creating pipeline of A Voice Assistant', 'Description must not be lost');
    assert.equal(turn3.draft.priority, 'high', 'Priority must not be lost');
    assert.equal(turn3.draft.status, 'in-progress', 'Status must not be lost');
    assert.equal(turn3.draft.dueDateTime, '2026-10-13T10:10:00+05:30', 'Due date must not be lost');
    assert.equal(turn3.draft.reminder, true);
    assert.equal(turn3.draft.reminderOption, 'oneHourBefore');
    // Chips on turn 3 must not contain due date, priority, or status chips
    assert.ok(!turn3.chips.some(c => c.action?.field === 'dueDateTime'));
    assert.ok(!turn3.chips.some(c => c.action?.field === 'priority'));
    assert.ok(!turn3.chips.some(c => c.action?.field === 'status'));
  });

  it('19. BUG B: Reminder parsing tests for Haan, No, and chip actions with preview & payload verification', async () => {
    const baseDraft = {
      title: 'Voice Pipeline',
      description: 'Test description',
      dueDateTime: '2026-10-13T10:00:00+05:30',
      priority: 'high',
      status: 'pending',
      asked: ['title', 'dueDateTime', 'description', 'priority', 'status', 'reminder'],
      skipped: ['priorityDays', 'repeatPattern', 'checkpoints', 'attachments'],
    };

    // 19a: User types "Haan" to reminder question
    const haanResult = await parseTaskRequest({
      req: mockReq,
      message: 'Haan',
      draft: baseDraft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(haanResult.draft.reminder, true);
    assert.equal(haanResult.draft.reminderOption, 'oneHourBefore');
    assert.equal(haanResult.status, 'ready');
    assert.equal(haanResult.preview.reminder, '1 hour before');
    const haanPayload = JSON.parse(haanResult.payload.fields.reminderSettings);
    assert.equal(haanPayload.enabled, true);
    assert.deepEqual(haanPayload.options, ['oneHourBefore']);

    // 19b: User types variations "ha", "yes", "on", "kar do", "हाँ", "हां"
    for (const affirmative of ['ha', 'yes', 'on', 'kar do', 'हाँ', 'हां']) {
      const res = await parseTaskRequest({
        req: mockReq,
        message: affirmative,
        draft: baseDraft,
      }, {
        now: fixedNow,
        getScopeInfo: async () => mockScope,
      });
      assert.equal(res.draft.reminder, true, `Expected reminder=true for "${affirmative}"`);
      assert.equal(res.draft.reminderOption, 'oneHourBefore');
    }

    // 19c: User types "nahi" / "no" / "off"
    const nahiResult = await parseTaskRequest({
      req: mockReq,
      message: 'nahi',
      draft: baseDraft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(nahiResult.draft.reminder, false);
    assert.equal(nahiResult.draft.reminderOption, null);
    assert.equal(nahiResult.status, 'ready');
    assert.equal(nahiResult.preview.reminder, 'Nahi (No)');
    const nahiPayload = JSON.parse(nahiResult.payload.fields.reminderSettings);
    assert.equal(nahiPayload.enabled, false);
    assert.deepEqual(nahiPayload.options, []);

    // 19d: Chip action { type: 'set', field: 'reminder', value: true } persists
    const chipOnResult = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'reminder', value: true },
      draft: baseDraft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(chipOnResult.draft.reminder, true);
    assert.equal(chipOnResult.draft.reminderOption, 'oneHourBefore');
    assert.equal(chipOnResult.status, 'ready');
    assert.equal(chipOnResult.preview.reminder, '1 hour before');
    const chipOnPayload = JSON.parse(chipOnResult.payload.fields.reminderSettings);
    assert.equal(chipOnPayload.enabled, true);
    assert.deepEqual(chipOnPayload.options, ['oneHourBefore']);

    // 19e: Chip action { type: 'set', field: 'reminder', value: false } persists
    const chipOffResult = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'reminder', value: false },
      draft: baseDraft,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(chipOffResult.draft.reminder, false);
    assert.equal(chipOffResult.draft.reminderOption, null);
    assert.equal(chipOffResult.status, 'ready');
    assert.equal(chipOffResult.preview.reminder, 'Nahi (No)');
    const chipOffPayload = JSON.parse(chipOffResult.payload.fields.reminderSettings);
    assert.equal(chipOffPayload.enabled, false);
    assert.deepEqual(chipOffPayload.options, []);

    // 19f: User responds to reminder question with relative time: "1 hour baad", "1 ghante baad", "1 hour pehle"
    for (const phrase of ['1 hour baad', '1 ghante baad', '1 hour pehle', '1 hour baad ka', 'ek ghante baad']) {
      const res = await parseTaskRequest({
        req: mockReq,
        message: phrase,
        draft: baseDraft,
      }, {
        now: fixedNow,
        getScopeInfo: async () => mockScope,
      });
      assert.equal(res.draft.reminder, true, `Expected reminder=true for "${phrase}"`);
      assert.equal(res.draft.reminderOption, 'oneHourBefore', `Expected oneHourBefore for "${phrase}"`);
      assert.equal(res.status, 'ready');
      assert.equal(res.preview.reminder, '1 hour before');
      const payload = JSON.parse(res.payload.fields.reminderSettings);
      assert.equal(payload.enabled, true);
      assert.deepEqual(payload.options, ['oneHourBefore']);
    }
  });

  it('20. BUG C: Exact sentence "Task naam Voice Assistant. Description creating pipeline. Priority high. Kal subah 10 baje." cuts at sentence boundaries and field keywords', async () => {
    const rawSentence = 'Task naam Voice Assistant. Description creating pipeline. Priority high. Kal subah 10 baje.';

    // Deterministic parser test
    const slots = parseHinglishSlots(rawSentence, fixedNow);
    assert.equal(slots.title, 'Voice Assistant');
    assert.equal(slots.description, 'Creating pipeline');
    assert.equal(slots.priority, 'high');
    assert.equal(slots.dueDateTime, '2026-10-13T10:00:00+05:30');

    // Full parseTaskRequest flow test
    const result = await parseTaskRequest({
      req: mockReq,
      message: rawSentence,
      draft: {},
    }, {
      now: fixedNow,
      extractFn: async () => ({
        title: 'Voice Assistant',
        description: 'Creating pipeline',
        priority: 'high',
        dueDateTime: '2026-10-13T10:00:00+05:30',
      }),
      getScopeInfo: async () => mockScope,
    });

    assert.equal(result.draft.title, 'Voice Assistant');
    assert.equal(result.draft.description, 'Creating pipeline');
    assert.equal(result.draft.priority, 'high');
    assert.equal(result.draft.dueDateTime, '2026-10-13T10:00:00+05:30');
    // Title must not contain the subsequent sentences
    assert.ok(!result.draft.title.toLowerCase().includes('description'));
    assert.ok(!result.draft.title.toLowerCase().includes('pipeline'));
    assert.ok(!result.draft.title.toLowerCase().includes('priority'));
    // Description must not contain priority or due date
    assert.ok(!result.draft.description.toLowerCase().includes('priority'));
    assert.ok(!result.draft.description.toLowerCase().includes('kal'));
  });

  it('21. ERROR 1: LLM schema must contain ONLY extractable fields with NO propertyNames; real Groq call succeeds without 400', async () => {
    // 1. JSON Schema validation
    const jsonSchema = toJsonSchema(taskDraftSchema);
    const schemaStr = JSON.stringify(jsonSchema);

    // Groq structured output rejects propertyNames (unsupported_propertyNames)
    assert.equal(schemaStr.includes('propertyNames'), false, 'LLM schema must not contain propertyNames');

    // Server-side state tracking fields must NOT be present in LLM schema
    assert.equal(schemaStr.includes('askCounts'), false, 'LLM schema must not contain askCounts');
    assert.equal(schemaStr.includes('skipped'), false, 'LLM schema must not contain skipped');
    assert.equal(schemaStr.includes('asked'), false, 'LLM schema must not contain asked');
    assert.equal(schemaStr.includes('attachmentsCount'), false, 'LLM schema must not contain attachmentsCount');
    assert.equal(schemaStr.includes('taskFor'), false, 'LLM schema must not contain taskFor');
    assert.equal(schemaStr.includes('wantsOthers'), false, 'LLM schema must not contain wantsOthers');

    // 2. Real Groq extraction call to prove HTTP 400 is gone
    if (process.env.GROQ_API_KEY) {
      const res = await extractTaskDraft({
        message: 'Task name Voice Assistant',
        now: fixedNow,
      });
      assert.ok(res, 'extractTaskDraft must return non-null result');
      assert.equal(res.title, 'Voice Assistant');
    }
  });

  it('22. ERROR 1: Failed LLM extraction call is logged with error code and falls back cleanly to deterministic parser slots', async () => {
    let errorLogged = false;
    const originalConsoleError = console.error;
    console.error = (...args) => {
      const msg = args.join(' ');
      if (msg.includes('[ai] llm extraction failed')) {
        errorLogged = true;
      }
      originalConsoleError.apply(console, args);
    };

    try {
      const result = await parseTaskRequest({
        req: mockReq,
        message: 'Task naam Voice Assistant, priority high',
        draft: {},
      }, {
        now: fixedNow,
        getScopeInfo: async () => mockScope,
        extractFn: async () => {
          const err = new Error('Groq structured output schema rejected');
          err.code = 'LLM_SCHEMA_ERROR';
          throw err;
        },
      });

      assert.equal(errorLogged, true, 'Error must be logged once per turn when LLM extraction fails');
      // Deterministic parser fallback must preserve the slots
      assert.equal(result.draft.title, 'Voice Assistant');
      assert.equal(result.draft.priority, 'high');
      assert.equal(result.status, 'needs_input');
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('23. Status extraction, direct answer, skip default, payload and preview verification', async () => {
    // 23a: Direct extraction of status from utterance
    const resA = await parseTaskRequest({
      req: mockReq,
      message: 'Task naam Bug Fix. Description Fix the bug. Kal sham 5 baje. Priority high. Status in progress.',
      draft: {},
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
      extractFn: async () => ({
        title: 'Bug Fix',
        description: 'Fix the bug',
        dueDateTime: '2026-10-13T17:00:00+05:30',
        priority: 'high',
        status: 'in-progress',
      }),
    });
    assert.equal(resA.draft.title, 'Bug Fix');
    assert.equal(resA.draft.description, 'Fix the bug');
    assert.equal(resA.draft.priority, 'high');
    assert.equal(resA.draft.status, 'in-progress');
    // Status is filled, so next asked field should be reminder
    assert.equal(resA.field, 'reminder');

    // 23b: Direct answer when status is asked
    const resB = await parseTaskRequest({
      req: mockReq,
      message: 'Completed',
      draft: {
        title: 'Report submit',
        description: 'Test desc',
        dueDateTime: '2026-10-13T17:00:00+05:30',
        priority: 'medium',
        asked: ['title', 'dueDateTime', 'description', 'priority', 'status'],
      },
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(resB.draft.status, 'completed');
    assert.equal(resB.field, 'reminder');

    // 23c: Skip status -> defaults to pending
    const resC = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip', field: 'status' },
      draft: {
        title: 'Report submit',
        dueDateTime: '2026-10-13T17:00:00+05:30',
        priority: 'medium',
        asked: ['title', 'dueDateTime', 'priority', 'status'],
      },
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(resC.draft.status, 'pending');

    // 23d: Skip all -> defaults status to pending and sets ready
    const resD = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip_all' },
      draft: {
        title: 'Report submit',
        dueDateTime: '2026-10-13T17:00:00+05:30',
        asked: ['title', 'dueDateTime'],
      },
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(resD.status, 'ready');
    assert.equal(resD.draft.status, 'pending');
    assert.equal(resD.payload.fields.status, 'pending');
    assert.equal(resD.preview.status, 'pending');
    assert.equal(resD.preview.statusLabel, 'Pending');

    // 23e: Ready state with explicit onhold status
    const resE = await parseTaskRequest({
      req: mockReq,
      action: { type: 'skip_all' },
      draft: {
        title: 'Report submit',
        dueDateTime: '2026-10-13T17:00:00+05:30',
        status: 'onhold',
        asked: ['title', 'dueDateTime', 'status'],
      },
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(resE.status, 'ready');
    assert.equal(resE.draft.status, 'onhold');
    assert.equal(resE.payload.fields.status, 'onhold');
    assert.equal(resE.preview.status, 'onhold');
    assert.equal(resE.preview.statusLabel, 'On Hold');
  });

  it('24. Dynamic reminder intervals (every 10 min, 15 min before due) and parameter extraction', async () => {
    // 24a: Direct answer to reminder question with "every 10 min"
    const draftForReminder = {
      title: 'testing of CRM',
      description: 'Test CRM features',
      dueDateTime: '2026-10-22T18:00:00+05:30',
      priority: 'medium',
      status: 'pending',
      asked: ['title', 'dueDateTime', 'description', 'priority', 'status', 'reminder'],
      skipped: ['priorityDays', 'repeatPattern', 'checkpoints', 'attachments'],
    };

    const res10m = await parseTaskRequest({
      req: mockReq,
      message: 'every 10 min',
      draft: draftForReminder,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });

    assert.equal(res10m.draft.reminder, true);
    assert.equal(res10m.draft.repeatIntervalMinutes, 10);
    assert.equal(res10m.draft.reminderOption, 'interval');
    assert.equal(res10m.preview.reminder, 'Every 10 min');
    const p10m = JSON.parse(res10m.payload.fields.reminderSettings);
    assert.equal(p10m.enabled, true);
    assert.equal(p10m.repeatIntervalMinutes, 10);
    assert.ok(p10m.options.includes('interval'));

    // 24b: Direct answer to reminder question in Hinglish: "har 10 minute me"
    const resHar10 = await parseTaskRequest({
      req: mockReq,
      message: 'har 10 minute me',
      draft: draftForReminder,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(resHar10.draft.reminder, true);
    assert.equal(resHar10.draft.repeatIntervalMinutes, 10);
    assert.equal(resHar10.preview.reminder, 'Every 10 min');

    // 24c: Direct answer with "15 min pehle" (minutesBeforeDue)
    const res15Pehle = await parseTaskRequest({
      req: mockReq,
      message: '15 min pehle',
      draft: draftForReminder,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(res15Pehle.draft.reminder, true);
    assert.equal(res15Pehle.draft.minutesBeforeDue, 15);
    assert.equal(res15Pehle.draft.reminderOption, 'beforeDue');
    assert.equal(res15Pehle.preview.reminder, '15 min before due');
    const p15 = JSON.parse(res15Pehle.payload.fields.reminderSettings);
    assert.equal(p15.enabled, true);
    assert.equal(p15.minutesBeforeDue, 15);
    assert.ok(p15.options.includes('beforeDue'));

    // 24d: Direct utterance with reminder every 10 min extracted upfront
    const resCombined = await parseTaskRequest({
      req: mockReq,
      message: 'testing of CRM kal shaam 6 baje reminder every 10 min',
      draft: {},
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(resCombined.draft.reminder, true);
    assert.equal(resCombined.draft.repeatIntervalMinutes, 10);
    assert.equal(resCombined.draft.reminderOption, 'interval');

    // 24e: Chip action with repeatIntervalMinutes: 10
    const resChip = await parseTaskRequest({
      req: mockReq,
      action: { type: 'set', field: 'repeatIntervalMinutes', value: 10 },
      draft: draftForReminder,
    }, {
      now: fixedNow,
      getScopeInfo: async () => mockScope,
    });
    assert.equal(resChip.draft.reminder, true);
    assert.equal(resChip.draft.repeatIntervalMinutes, 10);
    assert.equal(resChip.preview.reminder, 'Every 10 min');
  });
});

