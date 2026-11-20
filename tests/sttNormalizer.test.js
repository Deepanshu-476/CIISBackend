/**
 * tests/sttNormalizer.test.js
 *
 * Unit tests (no network) for:
 * 1. STT transcript normalization (साथ वजे, बाखी, बाकि, डिफॉल्ट, noise tokens, fuzzy matching)
 * 2. Deterministic intent detection (skip_all, skip_field, create_now, cancel, confirm_yes, confirm_no)
 * 3. Exact screenshot transcripts from Whisper
 * 4. Zero LLM calls for pure intents
 * 5. skip_all while another question is pending -> moves immediately to 'ready'
 * 6. Filled fields are preserved and never re-asked
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  normalizeTranscript,
  detectUserIntent,
  levenshtein,
  MISHEARD_NUMBERS_HINDI,
  MISHEARD_NUMBERS_ROMAN,
} = require('../services/ai/sttNormalizer');
const { parseHinglishSlots } = require('../services/ai/hinglishParser');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

describe('PART 1 & 2: STT Normalizer & Deterministic Intent Suite', () => {

  describe('1. Transcript Normalization', () => {
    it('normalizes साथ वजे and Devanagari misheard numbers before बजे/वजे', () => {
      assert.strictEqual(normalizeTranscript('साथ वजे'), 'सात बजे');
      assert.strictEqual(normalizeTranscript('साथ बजे'), 'सात बजे');
      assert.strictEqual(normalizeTranscript('साठ वजे'), 'सात बजे');
      assert.strictEqual(normalizeTranscript('अट बजे'), 'आठ बजे');
      assert.strictEqual(normalizeTranscript('चर बजे'), 'चार बजे');
      assert.strictEqual(normalizeTranscript('पाच बजे'), 'पांच बजे');
      assert.strictEqual(normalizeTranscript('नो बजे'), 'नौ बजे');
      assert.strictEqual(normalizeTranscript('तिन बजे'), 'तीन बजे');
    });

    it('normalizes Roman saath baje and number homophones', () => {
      assert.strictEqual(normalizeTranscript('saath baje'), 'saat baje');
      assert.strictEqual(normalizeTranscript('shaam saath baje tak'), 'shaam saat baje tak');
      assert.strictEqual(normalizeTranscript('sath baje'), 'saat baje');
      assert.strictEqual(normalizeTranscript('kal char baje'), 'kal chaar baje');
      assert.strictEqual(normalizeTranscript('panch baje'), 'paanch baje');
    });

    it('normalizes baaki / baki / bakhi / बाखी / बाकि variants to "baaki"', () => {
      assert.ok(normalizeTranscript('बाखी').includes('baaki'));
      assert.ok(normalizeTranscript('बाकि सब ठीक है').includes('baaki'));
      assert.ok(normalizeTranscript('बाकी default').includes('baaki'));
      assert.ok(normalizeTranscript('bakhi by default').includes('baaki'));
      assert.ok(normalizeTranscript('baki sab skip').includes('baaki'));
    });

    it('normalizes डिफ़ॉल्ट / डिफ़ाल्ट / defalt to "default"', () => {
      assert.ok(normalizeTranscript('डिफ़ॉल्ट').includes('default'));
      assert.ok(normalizeTranscript('डिफॉल्ट').includes('default'));
      assert.ok(normalizeTranscript('defalt').includes('default'));
    });

    it('removes STT noise tokens: studio, रोचे, ok, so', () => {
      const noisy = 'studio rakho aaj shaam 7 baje aur sara roche';
      const cleaned = normalizeTranscript(noisy);
      assert.strictEqual(cleaned.includes('studio'), false);
      assert.strictEqual(cleaned.includes('रोचे'), false);
    });

    it('token-level fuzzy matching for key words with Levenshtein <= 1', () => {
      assert.strictEqual(levenshtein('remindr', 'reminder'), 1);
      assert.strictEqual(levenshtein('defalt', 'default'), 1);
      assert.strictEqual(levenshtein('priorty', 'priority'), 1);
      assert.strictEqual(levenshtein('checkpnt', 'checkpoint'), 2); // > 1, not matched

      assert.ok(normalizeTranscript('remindr nahi chahiye').includes('reminder'));
      assert.ok(normalizeTranscript('priorty high').includes('priority'));
    });
  });

  describe('2. Intent Detection on Every Message', () => {
    it('detects skip_all across all Hindi, Hinglish, and Roman variants', () => {
      const skipAllPhrases = [
        'baaki sab default',
        'baaki default',
        'baaki sab skip',
        'baaki kuch nahi',
        'bas itna hi',
        'aur kuch nahi',
        'by default',
        'default rakho',
        'default rehne do',
        'sab default hai',
        'rest default',
        'rest skip',
        "that's all",
        'bas',
        'बाकी सब डिफ़ॉल्ट',
        'बाकि सब default है',
        'और बाखी by default',
        'baaki by default',
      ];

      for (const phrase of skipAllPhrases) {
        const intent = detectUserIntent(phrase);
        assert.ok(intent, `Expected intent for phrase: "${phrase}"`);
        assert.strictEqual(intent.type, 'skip_all', `Phrase "${phrase}" should be skip_all`);
      }
    });

    it('detects skip_field with field words for reminder, repeat, description, checkpoints, attachments, priorityDays, priority', () => {
      const cases = [
        { text: 'reminder nahi chahiye', field: 'reminder' },
        { text: 'reminder koi bhi nahi', field: 'reminder' },
        { text: 'reminder unhe karna', field: 'reminder' },
        { text: 'no reminder', field: 'reminder' },
        { text: 'reminder mat lagao', field: 'reminder' },
        { text: 'repeat mat karo', field: 'repeatPattern' },
        { text: 'no repeat', field: 'repeatPattern' },
        { text: 'description skip', field: 'description' },
        { text: 'checkpoints nahi chahiye', field: 'checkpoints' },
        { text: 'attachments koi bhi nahi', field: 'attachments' },
        { text: 'priority days skip', field: 'priorityDays' },
        { text: 'priority normal rehne do', field: null }, // not a negative skip
      ];

      for (const { text, field } of cases) {
        const intent = detectUserIntent(text);
        if (field) {
          assert.ok(intent, `Expected intent for "${text}"`);
          assert.strictEqual(intent.type, 'skip_field');
          assert.strictEqual(intent.field, field);
        }
      }
    });

    it('detects create_now intent across variants', () => {
      const createNowPhrases = [
        'task create kar do',
        'task create karo',
        'task create kardo',
        'bana do',
        'banao',
        'create it',
        'submit',
        'ho gaya',
        'kar do',
        'kardo',
        'यह टास्क बना दो',
        'क्रिएट कर दो',
      ];

      for (const phrase of createNowPhrases) {
        const intent = detectUserIntent(phrase);
        assert.ok(intent, `Expected intent for "${phrase}"`);
        assert.strictEqual(intent.type, 'create_now');
      }
    });

    it('detects cancel intent across variants', () => {
      const cancelPhrases = [
        'cancel',
        'rehne do task',
        'chhod do task',
        'band karo',
        'रद्द करो',
      ];

      for (const phrase of cancelPhrases) {
        const intent = detectUserIntent(phrase);
        assert.ok(intent, `Expected intent for "${phrase}"`);
        assert.strictEqual(intent.type, 'cancel');
      }
    });

    it('detects confirm_yes vs confirm_no for ready step', () => {
      const yesPhrases = ['haan', 'ha', 'yes', 'theek hai', 'kar do', 'create karo', 'हाँ', 'हां', 'ठीक है'];
      for (const p of yesPhrases) {
        const intent = detectUserIntent(p);
        assert.ok(intent, `Expected intent for "${p}"`);
        assert.ok(intent.type === 'confirm_yes' || intent.type === 'create_now');
      }

      const noPhrases = ['nahi', 'no', 'ruko', 'badlo', 'रुको', 'नहीं'];
      for (const p of noPhrases) {
        const intent = detectUserIntent(p);
        assert.ok(intent, `Expected intent for "${p}"`);
        assert.strictEqual(intent.type, 'confirm_no');
      }
    });
  });

  describe('3. Exact Screenshot Transcript Sentences', () => {
    it('Sentence 1: extracts title, description, priority, 7 PM IST, reminder=false, intent=skip_all', () => {
      const sentence1 = 'मेरे task create करो, उसका नाम रखो, A Voice Agents, उसका description रखो, adding speech to text in pipeline, उसकी priority रखो high, studio रखो, आज शाम साथ वजे, और reminder कोई भी नी चाहिए, और बाखी by default अब तो सारा रोचे,';
      // Said at 17:45 IST on 2026-10-12
      const refTime = new Date('2026-10-12T17:45:00+05:30');

      const slots = parseHinglishSlots(sentence1, refTime);
      const intent = detectUserIntent(sentence1);

      assert.strictEqual(slots.title, 'A Voice Agents');
      assert.strictEqual(slots.description, 'Adding speech to text in pipeline');
      assert.strictEqual(slots.priority, 'high');
      assert.strictEqual(slots.dueDateTime, '2026-10-12T19:00:00+05:30'); // 7 PM IST
      assert.strictEqual(slots.reminder, false);
      assert.ok(intent, 'Expected intent');
      assert.strictEqual(intent.type, 'skip_all');
    });

    it('Sentence 2: extracts reminder=false and intent=skip_all', () => {
      const sentence2 = 'नहीं reminder उन्हें करना और बाकि सब default है';
      const slots = parseHinglishSlots(sentence2);
      const intent = detectUserIntent(sentence2);

      assert.strictEqual(slots.reminder, false);
      assert.ok(intent, 'Expected intent');
      assert.strictEqual(intent.type, 'skip_all');
    });

    it('When spoken time is already past (e.g. 2 PM when now is 5:45 PM), flags dueDateTimePast', () => {
      const pastSentence = 'task name Meeting, aaj dopahar 2 baje';
      const refTime = new Date('2026-10-12T17:45:00+05:30');
      const slots = parseHinglishSlots(pastSentence, refTime);

      assert.strictEqual(slots.title, 'Meeting');
      assert.strictEqual(slots.dueDateTimePast, true);
    });
  });

  describe('4. Zero LLM budget call assertion for Pure Intents', () => {
    it('pure intent "baaki sab default" consumes 0 LLM extraction calls and yields ready', async () => {
      let llmCallCount = 0;
      const mockExtractFn = async () => {
        llmCallCount += 1;
        return {};
      };

      const req = {
        user: { company: 'comp_1', companyCode: 'IT-01', role: 'employee' },
      };

      const draftWithRequired = {
        title: 'Pipeline Sync',
        dueDateTime: '2026-10-13T10:00:00+05:30',
        asked: ['title', 'dueDateTime', 'description'],
        skipped: [],
        askCounts: {},
      };

      const result = await parseTaskRequest({
        req,
        message: 'baaki sab default',
        draft: draftWithRequired,
      }, {
        extractFn: mockExtractFn,
        getScopeInfo: async () => ({ hasAccess: false }),
        now: new Date('2026-10-12T10:00:00+05:30'),
      });

      assert.strictEqual(llmCallCount, 0, 'Pure intent MUST not call LLM extractor');
      assert.strictEqual(result.status, 'ready');
      assert.strictEqual(result.intent?.type, 'skip_all');
      assert.strictEqual(result.draft.priority, 'medium'); // safe default
      assert.strictEqual(result.draft.reminder, false);
      assert.strictEqual(result.draft.priorityDays, '1');
    });

    it('pure intent "cancel" consumes 0 LLM extraction calls and returns cancelled', async () => {
      let llmCallCount = 0;
      const mockExtractFn = async () => {
        llmCallCount += 1;
        return {};
      };

      const req = {
        user: { company: 'comp_1', companyCode: 'IT-01', role: 'employee' },
      };

      const result = await parseTaskRequest({
        req,
        message: 'cancel',
        draft: { title: 'Some Task', asked: ['title'], skipped: [], askCounts: {} },
      }, {
        extractFn: mockExtractFn,
        getScopeInfo: async () => ({ hasAccess: false }),
      });

      assert.strictEqual(llmCallCount, 0, 'Cancel intent MUST not call LLM');
      assert.strictEqual(result.status, 'cancelled');
      assert.strictEqual(result.intent?.type, 'cancel');
    });
  });

  describe('5. skip_all while another question is pending & field overrides', () => {
    it('skip_all while Priority Days is asked immediately transitions to ready', async () => {
      const req = {
        user: { company: 'comp_1', companyCode: 'IT-01', role: 'employee' },
      };

      // Draft has title, due, description, priority, reminder already filled; priorityDays is being asked
      const draftAtPriorityDays = {
        title: 'A Voice Agents',
        dueDateTime: '2026-10-12T19:00:00+05:30',
        description: 'Adding STT',
        priority: 'high',
        reminder: false,
        reminderOption: null,
        priorityDays: null,
        asked: ['title', 'dueDateTime', 'description', 'priority', 'reminder', 'priorityDays'],
        skipped: [],
        askCounts: { priorityDays: 1 },
      };

      const result = await parseTaskRequest({
        req,
        message: 'बाकि सब default है',
        draft: draftAtPriorityDays,
      }, {
        extractFn: async () => ({}),
        getScopeInfo: async () => ({ hasAccess: false }),
        now: new Date('2026-10-12T17:45:00+05:30'),
      });

      assert.strictEqual(result.status, 'ready');
      assert.strictEqual(result.intent?.type, 'skip_all');
      assert.strictEqual(result.draft.priorityDays, '1'); // safe default
      assert.strictEqual(result.draft.title, 'A Voice Agents'); // preserved
      assert.strictEqual(result.draft.priority, 'high'); // preserved
    });

    it('on ready step, field keyword overrides update the field and unskip it', async () => {
      const req = {
        user: { company: 'comp_1', companyCode: 'IT-01', role: 'employee' },
      };

      const readyDraft = {
        title: 'Initial Task Name',
        dueDateTime: '2026-10-13T10:00:00+05:30',
        description: 'Initial description',
        priority: 'medium',
        status: 'pending',
        reminder: false,
        priorityDays: '1',
        repeatPattern: 'none',
        checkpoints: [],
        asked: ['title', 'dueDateTime', 'description', 'priority', 'status', 'reminder', 'priorityDays'],
        skipped: ['priority', 'priorityDays', 'repeatPattern', 'checkpoints', 'attachments'],
        askCounts: {},
      };

      // User says "priority low kar do" on ready step
      const result = await parseTaskRequest({
        req,
        message: 'priority low kar do',
        draft: readyDraft,
      }, {
        extractFn: async () => ({}),
        getScopeInfo: async () => ({ hasAccess: false }),
        now: new Date('2026-10-12T17:45:00+05:30'),
      });

      assert.strictEqual(result.status, 'ready');
      assert.strictEqual(result.draft.priority, 'low');
      assert.ok(!result.draft.skipped.includes('priority'), 'Updated field should be unskipped');
    });

    it('supports "title badlo X" and "title change to X"', async () => {
      const slots1 = parseHinglishSlots('title badlo Voice Assistant Pipeline');
      assert.strictEqual(slots1.title, 'Voice Assistant Pipeline');

      const slots2 = parseHinglishSlots('title change to Database Automation');
      assert.strictEqual(slots2.title, 'Database Automation');
    });
  });

  describe('6. Conversational Assignee and "baki sabbha" Skip-All Extraction', () => {
    it('exact user sentence extracts Simran as assignee, skips remaining fields on baki sabbha, and reaches ready for others', async () => {
      const req = {
        user: { _id: 'admin_1', company: 'comp_1', companyCode: 'IT-01', role: 'admin' },
      };

      const sentence = 'Simran core task assigned karo task ka naam CIIS network meeting description taking demo due date kal subah 11 baje, priority high, status in progress reminder every 10 minute, baki sabbha';

      const result = await parseTaskRequest({
        req,
        message: sentence,
      }, {
        extractFn: async () => ({}),
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
        isAssigneeInScope: async () => true,
        resolveAssignee: async ({ name }) => ({
          status: 'single',
          user: { _id: 'usr_simran_123', name: 'Simran Kaur', department: 'QA' },
        }),
        now: new Date('2026-10-26T10:00:00+05:30'),
      });

      assert.strictEqual(result.status, 'ready');
      assert.strictEqual(result.draft.intent, 'task_assigned_user');
      assert.strictEqual(result.draft.taskFor, 'others');
      assert.strictEqual(result.draft.assigneeName, 'Simran Kaur');
      assert.strictEqual(result.draft.assigneeId, 'usr_simran_123');
      assert.strictEqual(result.draft.title, 'CIIS network meeting');
      assert.strictEqual(result.draft.description, 'Taking demo');
      assert.strictEqual(result.draft.priority, 'high');
      assert.strictEqual(result.draft.status, 'in-progress');
      assert.strictEqual(result.draft.reminder, true);
      assert.strictEqual(result.draft.repeatIntervalMinutes, 10);
      assert.strictEqual(result.payload?.endpoint, '/task/create-for-others');
      assert.match(result.reply, /Simran Kaur ko task "CIIS network meeting" assign karne ke liye draft tayar hai/i);
    });
  });
});
