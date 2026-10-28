/**
 * tests/formRegistry.test.js
 *
 * Contract and unit tests for the CIIS AI Form Registry (Part 1B).
 *
 * Requirements verified:
 * 1. Contract tests: Assert payload builder outputs exact endpoint, method, multipart,
 *    and field names/types/shape matching existing forms (AdminTaskCreate.jsx and selfTaskController.js).
 * 2. Intent migration: Never invent dates/values; carry over only common fields; drop non-applicable;
 *    return carried and dropped lists; never silently turn task into project.
 * 3. Intent detection: Deterministic keyword/regex matching for self, assigned, project, and group.
 * 4. LLM Schema slot isolation: self_task schema omits assigneeName; task_assigned_user schema includes it.
 * 5. Role/scope early convenience check.
 */

process.env.NODE_ENV = 'test';
require('dotenv').config();
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  FORM_REGISTRY,
  detectIntent,
  migrateDraftBetweenIntents,
  getIntentSlots,
  checkIntentAccess,
  formatHumanIstDate,
  formatAssigneeLabel,
  getCleanCheckpoints,
  buildReminderPayload,
  getReminderPreviewText,
  STATUS_LABELS,
} = require('../services/ai/formRegistry');

const {
  selfTaskDraftSchema,
  taskDraftSchema,
  getSchemaForIntent,
} = require('../services/ai/aiSchemas');

describe('AI Form Registry Suite (Part 1B)', () => {
  // ==========================================================================
  // 1. CONTRACT TESTS
  // ==========================================================================

  describe('Contract Tests: Payload Builders', () => {
    /**
     * CONTRACT TEST 1: self_task
     *
     * In selfTaskController.js lines 149-210, the backend expects:
     * - title: String (required)
     * - description: String (optional)
     * - dueDateTime: ISO/date string
     * - priorityDays: String ('1')
     * - priority: 'low' | 'medium' | 'high'
     * - status: 'pending' | 'in-progress' | ...
     * - checkpoints: JSON-encoded array of { title, completed }
     * - reminderSettings: JSON-encoded object with { enabled, options, reminderTime, customTime, repeatIntervalMinutes, minutesBeforeDue }
     * - repeatPattern: 'none' | 'daily'
     * - repeatDays: JSON-encoded array
     * - recurrenceEndDate: String | null
     * And automatically assigns the task to [req.user._id] without requiring assignedUsers in body.
     */
    it('self_task.buildPayload matches selfTaskController contract', () => {
      const sampleDraft = {
        title: 'Submit GST Filing',
        description: 'Quarterly GST filing for Q3',
        dueDateTime: '2026-10-30T18:00:00.000Z',
        priority: 'high',
        status: 'pending',
        priorityDays: '2',
        repeatPattern: 'daily',
        repeatDays: ['Monday', 'Tuesday'],
        recurrenceEndDate: '2026-12-31T23:59:59.000Z',
        checkpoints: [
          { title: 'Gather invoices', completed: false },
          'Reconcile with portal',
        ],
        reminder: true,
        reminderOption: 'interval',
        repeatIntervalMinutes: 30,
        minutesBeforeDue: 60,
      };

      const payload = FORM_REGISTRY.self_task.buildPayload(sampleDraft);

      // Verify envelope
      assert.equal(payload.endpoint, '/tasks/self/create');
      assert.equal(payload.method, 'POST');
      assert.equal(payload.multipart, true);
      assert.equal(payload.fileField, 'files');

      // Verify field presence and string types
      const f = payload.fields;
      assert.equal(typeof f.title, 'string');
      assert.equal(f.title, 'Submit GST Filing');

      assert.equal(typeof f.description, 'string');
      assert.equal(f.description, 'Quarterly GST filing for Q3');

      assert.equal(typeof f.dueDateTime, 'string');
      assert.equal(f.dueDateTime, '2026-10-30T18:00:00.000Z');

      assert.equal(typeof f.priority, 'string');
      assert.equal(f.priority, 'high');

      assert.equal(typeof f.status, 'string');
      assert.equal(f.status, 'pending');

      assert.equal(typeof f.priorityDays, 'string');
      assert.equal(f.priorityDays, '2');

      assert.equal(typeof f.repeatPattern, 'string');
      assert.equal(f.repeatPattern, 'daily');

      assert.equal(typeof f.recurrenceEndDate, 'string');
      assert.equal(f.recurrenceEndDate, '2026-12-31T23:59:59.000Z');

      // Verify JSON-serialized fields
      const parsedRepeatDays = JSON.parse(f.repeatDays);
      assert.ok(Array.isArray(parsedRepeatDays));
      assert.deepEqual(parsedRepeatDays, ['Monday', 'Tuesday']);

      const parsedCheckpoints = JSON.parse(f.checkpoints);
      assert.ok(Array.isArray(parsedCheckpoints));
      assert.equal(parsedCheckpoints.length, 2);
      assert.deepEqual(parsedCheckpoints[0], { title: 'Gather invoices', completed: false });
      assert.deepEqual(parsedCheckpoints[1], { title: 'Reconcile with portal', completed: false });

      const parsedReminder = JSON.parse(f.reminderSettings);
      assert.equal(typeof parsedReminder, 'object');
      assert.equal(parsedReminder.enabled, true);
      assert.ok(parsedReminder.options.includes('interval'));
      assert.equal(parsedReminder.repeatIntervalMinutes, 30);
      assert.equal(parsedReminder.minutesBeforeDue, 60);

      // Verify self_task does NOT send assignedUsers or assignedGroups
      assert.equal(f.assignedUsers, undefined);
      assert.equal(f.assignedGroups, undefined);
    });

    /**
     * CONTRACT TEST 2: task_assigned_user
     *
     * Quoting AdminTaskCreate.jsx lines 1332-1340:
     * -------------------------------------------------------------
     * formData.append('title', newTask.title);
     * formData.append('description', newTask.description);
     * formData.append('dueDateTime', parsedDueDateTime.toISOString());
     * formData.append('priorityDays', newTask.priorityDays || '1');
     * formData.append('priority', newTask.priority);
     * formData.append('assignedUsers', JSON.stringify(newTask.assignedUsers));
     * formData.append('assignedGroups', JSON.stringify(newTask.assignedGroups));
     * formData.append('checkpoints', JSON.stringify(getCleanCheckpoints(newTask.checkpoints)));
     * formData.append('reminderSettings', JSON.stringify(normalizeReminderSettings(newTask.reminderSettings)));
     * -------------------------------------------------------------
     */
    it('task_assigned_user.buildPayload matches AdminTaskCreate.jsx form contract', () => {
      const sampleDraft = {
        assigneeId: '654321098765432109876543',
        assigneeName: 'Rahul Sharma',
        assigneeLabel: 'Rahul Sharma (EMP-102)',
        title: 'Review Audit Logs',
        description: 'Verify quarterly access logs',
        dueDateTime: '2026-10-31T17:00:00.000Z',
        priority: 'medium',
        status: 'pending',
        priorityDays: '1',
        checkpoints: [{ title: 'Check server logs', completed: false }],
        reminder: true,
        reminderOption: 'oneHourBefore',
      };

      const payload = FORM_REGISTRY.task_assigned_user.buildPayload(sampleDraft);

      // Verify envelope
      assert.equal(payload.endpoint, '/task/create-for-others');
      assert.equal(payload.method, 'POST');
      assert.equal(payload.multipart, true);
      assert.equal(payload.fileField, 'files');

      // Verify field presence and string types
      const f = payload.fields;
      assert.equal(typeof f.title, 'string');
      assert.equal(f.title, 'Review Audit Logs');

      assert.equal(typeof f.description, 'string');
      assert.equal(f.description, 'Verify quarterly access logs');

      assert.equal(typeof f.dueDateTime, 'string');
      assert.equal(f.dueDateTime, '2026-10-31T17:00:00.000Z');

      assert.equal(typeof f.priority, 'string');
      assert.equal(f.priority, 'medium');

      assert.equal(typeof f.priorityDays, 'string');
      assert.equal(f.priorityDays, '1');

      // Verify assignedUsers matches AdminTaskCreate.jsx: JSON.stringify(newTask.assignedUsers)
      const parsedAssignedUsers = JSON.parse(f.assignedUsers);
      assert.ok(Array.isArray(parsedAssignedUsers));
      assert.deepEqual(parsedAssignedUsers, ['654321098765432109876543']);

      // Verify assignedGroups matches AdminTaskCreate.jsx: JSON.stringify(newTask.assignedGroups)
      const parsedAssignedGroups = JSON.parse(f.assignedGroups);
      assert.ok(Array.isArray(parsedAssignedGroups));
      assert.deepEqual(parsedAssignedGroups, []);

      // Verify checkpoints matches AdminTaskCreate.jsx: JSON.stringify(getCleanCheckpoints(newTask.checkpoints))
      const parsedCheckpoints = JSON.parse(f.checkpoints);
      assert.ok(Array.isArray(parsedCheckpoints));
      assert.deepEqual(parsedCheckpoints, [{ title: 'Check server logs', completed: false }]);

      // Verify reminderSettings matches AdminTaskCreate.jsx: JSON.stringify(normalizeReminderSettings(...))
      const parsedReminder = JSON.parse(f.reminderSettings);
      assert.equal(typeof parsedReminder, 'object');
      assert.equal(parsedReminder.enabled, true);
      assert.ok(parsedReminder.options.includes('oneHourBefore'));
    });
  });

  // ==========================================================================
  // 2. INTENT DETECTION TESTS (Deterministic First)
  // ==========================================================================

  describe('Intent Detection (Deterministic First)', () => {
    it('detects self_task for Hindi/Hinglish self keywords', () => {
      const inputs = [
        'mere liye ek task banao',
        'khud ke liye reminder set karo',
        'apne liye meeting fix karo',
        'create a personal task for me',
        'my task for tomorrow',
      ];
      for (const text of inputs) {
        const result = detectIntent({ message: text });
        assert.equal(result.intent, 'self_task', `Failed for text: "${text}"`);
        assert.equal(result.isSupported, true);
        assert.equal(result.isExplicit, true);
      }
    });

    it('detects task_assigned_user for assignment keywords', () => {
      const inputs = [
        'Rahul ko assign karo',
        'assign to Amit',
        'give task to Neha',
        'kisi aur ke liye task',
        'others task create karo',
      ];
      for (const text of inputs) {
        const result = detectIntent({ message: text });
        assert.equal(result.intent, 'task_assigned_user', `Failed for text: "${text}"`);
        assert.equal(result.isSupported, true);
        assert.equal(result.isExplicit, true);
      }
    });

    it('detects task_project as extension point (unsupported in Part 1)', () => {
      const inputs = [
        'project task banao',
        'project mein task add karo',
        'naya project create karo',
      ];
      for (const text of inputs) {
        const result = detectIntent({ message: text });
        assert.equal(result.intent, 'task_project');
        assert.equal(result.isSupported, false);
        assert.equal(result.reason, 'project_intent_detected');
      }
    });

    it('detects task_assigned_group as extension point (unsupported in Part 1)', () => {
      const inputs = [
        'group ko assign karo',
        'team ko assign karo',
        'group task create karo',
      ];
      for (const text of inputs) {
        const result = detectIntent({ message: text });
        assert.equal(result.intent, 'task_assigned_group');
        assert.equal(result.isSupported, false);
        assert.equal(result.reason, 'group_intent_detected');
      }
    });

    it('maintains intent from existing draft state when message has no keywords', () => {
      const draftOthers = { intent: 'task_assigned_user', assigneeId: '123' };
      const res1 = detectIntent({ message: 'shaam 5 baje tak', draft: draftOthers });
      assert.equal(res1.intent, 'task_assigned_user');
      assert.equal(res1.isExplicit, false);

      const draftSelf = { intent: 'self_task' };
      const res2 = detectIntent({ message: 'shaam 5 baje tak', draft: draftSelf });
      assert.equal(res2.intent, 'self_task');
      assert.equal(res2.isExplicit, false);
    });

    it('falls back to self_task by default when ambiguous', () => {
      const result = detectIntent({ message: 'urgent task submit report' });
      assert.equal(result.intent, 'self_task');
      assert.equal(result.isSupported, true);
      assert.equal(result.isExplicit, false);
    });
  });

  // ==========================================================================
  // 3. INTENT MIGRATION TESTS
  // ==========================================================================

  describe('Intent Migration (Zero Hallucination)', () => {
    it('migrating within same intent is a no-op that preserves all fields', () => {
      const draft = {
        title: 'Draft A',
        description: 'Desc A',
        dueDateTime: '2026-11-01T10:00:00.000Z',
        priority: 'high',
      };
      const res = migrateDraftBetweenIntents('self_task', 'self_task', draft);
      assert.equal(res.targetIntent, 'self_task');
      assert.equal(res.dropped.length, 0);
      assert.equal(res.newDraft.title, 'Draft A');
      assert.equal(res.newDraft.dueDateTime, '2026-11-01T10:00:00.000Z');
    });

    it('migrating self_task -> task_assigned_user preserves common fields and drops recurrence', () => {
      const selfDraft = {
        title: 'Weekly Sync',
        description: 'Discuss KPI metrics',
        dueDateTime: '2026-11-05T15:00:00.000Z',
        priority: 'medium',
        status: 'pending',
        checkpoints: [{ title: 'Slide deck', completed: false }],
        reminder: true,
        reminderOption: 'hourly',
        repeatPattern: 'daily',
        repeatDays: ['Monday'],
        recurrenceEndDate: '2026-12-01T00:00:00.000Z',
      };

      const res = migrateDraftBetweenIntents('self_task', 'task_assigned_user', selfDraft);

      // Verify carried fields
      assert.equal(res.newDraft.title, 'Weekly Sync');
      assert.equal(res.newDraft.description, 'Discuss KPI metrics');
      assert.equal(res.newDraft.dueDateTime, '2026-11-05T15:00:00.000Z');
      assert.equal(res.newDraft.priority, 'medium');
      assert.equal(res.newDraft.status, 'pending');
      assert.deepEqual(res.newDraft.checkpoints, [{ title: 'Slide deck', completed: false }]);
      assert.equal(res.newDraft.reminder, true);
      assert.equal(res.newDraft.reminderOption, 'hourly');

      // Verify repeatPattern was dropped because assigned tasks do not support recurrence
      assert.ok(res.dropped.includes('repeatPattern'), 'repeatPattern must be in dropped list');
      assert.equal(res.newDraft.repeatPattern, null);

      // Verify carried list
      assert.ok(res.carried.includes('title'));
      assert.ok(res.carried.includes('dueDateTime'));
      assert.ok(res.carried.includes('priority'));
      assert.ok(res.carried.includes('checkpoints'));
      assert.ok(res.carried.includes('reminder'));

      // Verify taskFor updated
      assert.equal(res.newDraft.taskFor, 'others');
      assert.equal(res.newDraft.wantsOthers, true);
    });

    it('migrating task_assigned_user -> self_task preserves common fields and drops assignee', () => {
      const assignedDraft = {
        title: 'Client Demo',
        description: 'Present prototype to client',
        dueDateTime: '2026-11-10T11:00:00.000Z',
        priority: 'high',
        status: 'pending',
        assigneeId: 'user_12345',
        assigneeName: 'Priya Verma',
        assigneeLabel: 'Priya Verma (EMP-055)',
      };

      const res = migrateDraftBetweenIntents('task_assigned_user', 'self_task', assignedDraft);

      // Verify carried fields
      assert.equal(res.newDraft.title, 'Client Demo');
      assert.equal(res.newDraft.dueDateTime, '2026-11-10T11:00:00.000Z');
      assert.equal(res.newDraft.priority, 'high');

      // Verify assignee dropped
      assert.ok(res.dropped.includes('assignee'), 'assignee must be in dropped list');
      assert.equal(res.newDraft.assigneeId, null);
      assert.equal(res.newDraft.assigneeName, null);
      assert.equal(res.newDraft.assigneeLabel, null);

      // Verify taskFor updated
      assert.equal(res.newDraft.taskFor, 'self');
      assert.equal(res.newDraft.wantsOthers, false);
    });

    it('NEVER defaults due date to today if not provided', () => {
      const draft = { title: 'No due date draft' };
      const res = migrateDraftBetweenIntents('self_task', 'task_assigned_user', draft);
      assert.equal(res.newDraft.dueDateTime, null);
      assert.ok(!res.carried.includes('dueDateTime'));
    });
  });

  // ==========================================================================
  // 4. LLM SCHEMA SLOT ISOLATION
  // ==========================================================================

  describe('LLM Schema Slot Isolation', () => {
    it('selfTaskDraftSchema omits assigneeName slot', () => {
      const selfKeys = Object.keys(selfTaskDraftSchema.shape);
      assert.ok(!selfKeys.includes('assigneeName'), 'selfTaskDraftSchema must NOT have assigneeName');
      assert.ok(selfKeys.includes('title'));
      assert.ok(selfKeys.includes('dueDateTime'));
      assert.ok(selfKeys.includes('priority'));
    });

    it('taskDraftSchema includes assigneeName slot', () => {
      const assignedKeys = Object.keys(taskDraftSchema.shape);
      assert.ok(assignedKeys.includes('assigneeName'), 'taskDraftSchema must have assigneeName');
    });

    it('getSchemaForIntent returns appropriate schema per intent', () => {
      const selfSchema = getSchemaForIntent('self_task');
      assert.equal(selfSchema, selfTaskDraftSchema);

      const assignedSchema = getSchemaForIntent('task_assigned_user');
      assert.equal(assignedSchema, taskDraftSchema);
    });
  });

  // ==========================================================================
  // 5. ROLE AND SCOPE CONVENIENCE CHECKS
  // ==========================================================================

  describe('Role and Scope Convenience Check', () => {
    it('self_task is accessible by all users regardless of scope', () => {
      const allowed = checkIntentAccess('self_task', { scope: { hasAccess: false, isOwner: false } });
      assert.equal(allowed, true);
    });

    it('task_assigned_user requires scope.hasAccess or scope.isOwner', () => {
      const denied = checkIntentAccess('task_assigned_user', { scope: { hasAccess: false, isOwner: false } });
      assert.equal(denied, false);

      const allowedAccess = checkIntentAccess('task_assigned_user', { scope: { hasAccess: true, isOwner: false } });
      assert.equal(allowedAccess, true);

      const allowedOwner = checkIntentAccess('task_assigned_user', { scope: { hasAccess: false, isOwner: true } });
      assert.equal(allowedOwner, true);
    });
  });

  // ==========================================================================
  // 6. HELPER EQUALITY AND ROBUSTNESS
  // ==========================================================================

  describe('Registry Helper Functions', () => {
    it('formatHumanIstDate formats IST accurately', () => {
      // 2026-10-12T10:00:00Z -> IST is +5:30 -> 15:30 -> 3:30 PM
      const formatted = formatHumanIstDate('2026-10-12T10:00:00.000Z');
      assert.equal(formatted, '12 Oct 2026, 3:30 PM');
    });

    it('getCleanCheckpoints parses both strings and objects', () => {
      const raw = ['Step 1', { title: 'Step 2', completed: true }, { title: '' }, null];
      const cleaned = getCleanCheckpoints(raw);
      assert.deepEqual(cleaned, [
        { title: 'Step 1', completed: false },
        { title: 'Step 2', completed: true },
      ]);
    });

    it('buildReminderPayload produces expected options and fields', () => {
      const payload = buildReminderPayload({
        enabled: true,
        reminderOption: 'hourly',
      });
      assert.equal(payload.enabled, true);
      assert.deepEqual(payload.options, ['hourly']);
    });
  });

  // ==========================================================================
  // 7. EXPRESS ROUTE REGISTRATION CONTRACT (Issue 1)
  // ==========================================================================

  describe('7. Express Route Registration Contract', () => {
    it('every endpoint string in FORM_REGISTRY resolves to an Express route in the app (never 404)', async (t) => {
      const express = require('express');
      const fs = require('fs');
      const path = require('path');

      // Read real server.js to parse production route mounts
      const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
      const mountMatches = [...serverCode.matchAll(/app\.use\(["']([^"']+)["'],\s*require\(["']([^"']+)["']\)\);/g)];
      const mountTable = new Map();
      for (const m of mountMatches) {
        mountTable.set(m[1], m[2]);
      }

      // Verify that server.js explicitly mounts the task routes required by the registry
      assert.ok(mountTable.has('/api/tasks/self'), 'server.js must mount /api/tasks/self');
      assert.ok(mountTable.has('/api/task') || mountTable.has('/api/tasks'), 'server.js must mount /api/task or /api/tasks');

      const app = express();
      // Mount task routes dynamically using the exact paths declared in server.js
      for (const [routePath, relativeRequire] of mountTable.entries()) {
        if (routePath.includes('task')) {
          const resolvedPath = path.resolve(__dirname, '..', relativeRequire);
          app.use(routePath, require(resolvedPath));
        }
      }

      // Real 404 catch-all fallback handler matching server.js line 1284
      app.use((req, res) => {
        res.status(404).json({
          message: 'Route not found',
          requested: `${req.method} ${req.originalUrl}`,
        });
      });

      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      server.unref();
      t.after(() => new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(() => resolve());
      }));

      const port = server.address().port;

      for (const [key, config] of Object.entries(FORM_REGISTRY)) {
        const endpoint = config.endpoint;
        assert.ok(endpoint, `Intent ${key} must declare an endpoint`);

        // 1. Verify with /api prefix (standard axiosInstance baseURL path: baseURL + endpoint)
        const resWithApi = await fetch(`http://127.0.0.1:${port}/api${endpoint}`, {
          method: config.method || 'POST',
        });
        assert.notEqual(resWithApi.status, 404, `Route /api${endpoint} returned 404 Route Not Found!`);

        // 2. Verify without /api prefix (non-/api alias path)
        const resWithoutApi = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
          method: config.method || 'POST',
        });
        assert.notEqual(resWithoutApi.status, 404, `Route ${endpoint} returned 404 Route Not Found!`);
      }

      // 3. Negative check: unmounted routes MUST hit the 404 handler and fail
      const resUnmounted = await fetch(`http://127.0.0.1:${port}/api/tasks/unmounted_nonexistent_route`, {
        method: 'POST',
      });
      assert.equal(resUnmounted.status, 404);
      const errBody = await resUnmounted.json();
      assert.equal(errBody.message, 'Route not found');
    });
  });

  // ==========================================================================
  // 8. TITLE SANITY GUARD & ASSIGNEE DISAMBIGUATION (Issue 2)
  // ==========================================================================

  describe('8. Title Sanity Guard & Assignee Disambiguation', () => {
    const { isInvalidOrCommandTitle } = require('../services/ai/hinglishParser');
    const { parseTaskRequest } = require('../services/ai/taskAgentService');

    it('rejects command sentences, whole user sentence, and person "ko" addressed titles', () => {
      // Rejects command sentences addressed to a person and bare commands
      assert.equal(isInvalidOrCommandTitle('Task assign karo kumar ko', 'Task assign karo kumar ko', 'kumar'), true);
      assert.equal(isInvalidOrCommandTitle('kumar ko task do', 'kumar ko task do', 'kumar'), true);
      assert.equal(isInvalidOrCommandTitle('ek task banao', 'ek task banao'), true);
      assert.equal(isInvalidOrCommandTitle('assign karo rahul ko', 'assign karo rahul ko', 'rahul'), true);
      assert.equal(isInvalidOrCommandTitle('banao task deepak ko', 'banao task deepak ko', 'deepak'), true);
      assert.equal(isInvalidOrCommandTitle('kumar ko kar do', 'kumar ko kar do', 'kumar'), true);
      assert.equal(isInvalidOrCommandTitle('टास्क असाइन करो कुमार को', 'टास्क असाइन करो कुमार को', 'कुमार'), true);
      assert.equal(isInvalidOrCommandTitle('कुमार को टास्क बना दो', 'कुमार को टास्क बना दो', 'कुमार'), true);

      // MUST KEEP: Legitimate titles containing verbs like create, assign, task, karo
      assert.equal(isInvalidOrCommandTitle('Create invoice template', 'Create invoice template'), false);
      assert.equal(isInvalidOrCommandTitle('Assign permissions module', 'Assign permissions module'), false);
      assert.equal(isInvalidOrCommandTitle('Create GST report', 'Create GST report'), false);
      assert.equal(isInvalidOrCommandTitle('Monthly GST Filing Report', 'Task assign karo kumar ko', 'kumar'), false);
      assert.equal(isInvalidOrCommandTitle('Fix login bug on iOS', 'Fix login bug on iOS', ''), false);
      assert.equal(isInvalidOrCommandTitle('Design Landing Page Hero', 'Design Landing Page Hero', ''), false);
    });

    it('extracts and keeps titles from conversational commands with prefixes or object-first Hinglish', () => {
      const { parseHinglishSlots } = require('../services/ai/hinglishParser');

      // 1. Task banao: Client proposal review -> title: "Client proposal review"
      const res1 = parseHinglishSlots('Task banao: Client proposal review');
      assert.equal(res1.title, 'Client proposal review');

      // 2. Urgent task banao: Client proposal review -> title: "Client proposal review"
      const res2 = parseHinglishSlots('Urgent task banao: Client proposal review');
      assert.equal(res2.title, 'Client proposal review');
      assert.equal(res2.priority, 'high');

      // 3. Database indexing ka task banao, checkpoints: slow queries dhundhna aur index lagana, priority High -> title: "Database indexing"
      const res3 = parseHinglishSlots('Database indexing ka task banao, checkpoints: slow queries dhundhna aur index lagana, priority High');
      assert.equal(res3.title, 'Database indexing');
      assert.equal(res3.priority, 'high');
      assert.ok(Array.isArray(res3.checkpoints));
    });

    const mockAdminReq = {
      user: {
        _id: '507f1f77bcf86cd799439011',
        name: 'Test Admin',
        role: 'admin',
        company: '507f1f77bcf86cd799439010',
      },
    };
    const mockAdminDeps = {
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      isAssigneeInScope: async () => true,
      resolveAssignee: async (arg) => {
        const name = typeof arg === 'string' ? arg : arg?.name;
        return { status: 'single', user: { _id: 'u_' + (name || 'user'), name: name || 'User' } };
      },
    };

    it('command sentence "Task assign karo kumar ko" rejects command title, retains assignee, and prompts "Task ka naam kya hoga?"', async () => {
      const result = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Task assign karo kumar ko',
      }, {
        ...mockAdminDeps,
        extractFn: async () => ({
          title: 'Task assign karo kumar ko.',
          assigneeName: 'kumar',
        }),
      });

      assert.equal(result.success, true);
      assert.equal(result.status, 'needs_input');
      assert.equal(result.field, 'title');
      assert.equal(result.draft.title, null, 'Command title must be nullified');
      assert.equal(result.draft.assigneeName, 'kumar', 'Assignee kumar must be preserved');
      assert.ok(
        result.reply.includes('Task ka naam kya hoga?'),
        `Expected reply to ask "Task ka naam kya hoga?", got: "${result.reply}"`
      );
    });

    it('ambiguous assignee with multiple matches returns needs_disambiguation with candidate chips', async () => {
      const mockResolver = async () => ({
        status: 'multiple',
        candidates: [
          { id: 'usr_001', name: 'Kumar Sanu', employeeId: 'EMP001', jobRole: 'Singer', department: 'Media' },
          { id: 'usr_002', name: 'Kumar Gaurav', employeeId: 'EMP002', jobRole: 'Actor', department: 'Drama' },
        ],
      });

      const result = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Kumar ko assign karo',
      }, {
        ...mockAdminDeps,
        resolveAssignee: mockResolver,
        extractFn: async () => ({
          assigneeName: 'Kumar',
        }),
      });

      assert.equal(result.success, true);
      assert.equal(result.status, 'needs_disambiguation');
      assert.equal(result.field, 'assignee');
      assert.equal(result.candidates.length, 2);
      assert.equal(result.candidates[0].name, 'Kumar Sanu');
      assert.equal(result.candidates[1].name, 'Kumar Gaurav');
      assert.ok(result.reply.includes('multiple users mile hain'));
    });

    it('Title Guard: fillers ("hlo", "hello", "hi", "hey", "ya", "yes", "ok", "ko", "haan", "nahi") are rejected as titles and agent asks for title again', async () => {
      const fillers = ['hlo', 'hello', 'hi', 'hey', 'ya', 'yes', 'ok', 'ko', 'haan', 'nahi'];
      for (const filler of fillers) {
        assert.equal(isInvalidOrCommandTitle(filler), true, `Filler "${filler}" must be rejected as invalid title`);

        const result = await parseTaskRequest({
          req: mockAdminReq,
          message: filler,
        }, {
          ...mockAdminDeps,
          extractFn: async () => ({ title: filler }),
        });

        assert.equal(result.success, true);
        assert.equal(result.status, 'needs_input');
        assert.equal(result.field, 'title', `Expected to ask title again when filler "${filler}" is provided`);
        assert.equal(result.draft.title, null, `Title must be null for filler "${filler}"`);
        assert.ok(
          result.reply.includes('Task ka naam kya rakhna hai?') || result.reply.includes('Task ka naam kya hoga?'),
          `Expected reply to ask for task title, got "${result.reply}"`
        );
      }
    });

    it('"Call Priya about invoice kal 5 baje" stays a self task and asks ONE chip question "Priya ko assign karna hai?" [Haan, assign karo] [Nahi, title mein hi hai]', async () => {
      // Turn 1: user initiates with action title targeting Priya
      const turn1 = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Call Priya about invoice kal 5 baje',
      }, {
        ...mockAdminDeps,
        extractFn: async () => ({}),
      });

      assert.equal(turn1.success, true);
      assert.equal(turn1.status, 'needs_input');
      assert.equal(turn1.field, 'assigneeConfirmation');
      assert.equal(turn1.draft.taskFor, 'self', 'Must stay a self task initially');
      assert.equal(turn1.draft.intent, 'self_task', 'Intent must stay self_task initially');
      assert.ok(turn1.reply.includes('Priya ko assign karna hai?'), `Expected "Priya ko assign karna hai?", got: "${turn1.reply}"`);
      assert.equal(turn1.speakText, 'Priya ko assign karna hai?');
      assert.equal(turn1.chips.length, 2);
      assert.equal(turn1.chips[0].label, 'Haan, assign karo');
      assert.equal(turn1.chips[1].label, 'Nahi, title mein hi hai');

      // Turn 2a: user chooses "Nahi, title mein hi hai" -> stays self_task and proceeds to description
      const turn2No = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn1.draft,
        action: turn1.chips[1].action, // { type: 'keep_title_person', name: 'Priya' }
      }, {
        ...mockAdminDeps,
        extractFn: async () => ({}),
      });

      assert.equal(turn2No.success, true);
      assert.equal(turn2No.status, 'needs_input');
      assert.equal(turn2No.field, 'description', 'Must proceed to description question after person confirmation dismissal');
      assert.equal(turn2No.draft.taskFor, 'self');
      assert.equal(turn2No.draft.intent, 'self_task');
      assert.equal(turn2No.draft.title, 'Call Priya about invoice');

      // Turn 2b: user chooses "Haan, assign karo" -> converts to task_assigned_user
      const turn2Yes = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn1.draft,
        action: turn1.chips[0].action, // { type: 'set', field: 'assignee', value: 'Priya' }
      }, {
        ...mockAdminDeps,
        extractFn: async () => ({}),
      });

      assert.equal(turn2Yes.success, true);
      assert.equal(turn2Yes.draft.taskFor, 'others');
      assert.equal(turn2Yes.draft.intent, 'task_assigned_user');
      assert.equal(turn2Yes.draft.assigneeName, 'Priya');
    });
  });

  // ==========================================================================
  // 9. BACKWARD COMPATIBILITY & ZERO PERSON LOSS (Part 1 Follow-up)
  // ==========================================================================

  describe('9. Backward Compatibility & Assignee Preservation', () => {
    const { parseTaskRequest } = require('../services/ai/taskAgentService');
    const mockAdminReq = {
      user: {
        _id: '507f1f77bcf86cd799439011',
        name: 'Test Admin',
        role: 'admin',
        company: '507f1f77bcf86cd799439010',
      },
    };
    const mockAdminDeps = {
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      isAssigneeInScope: async () => true,
      resolveAssignee: async (arg) => {
        const name = typeof arg === 'string' ? arg : arg?.name;
        return { status: 'single', user: { _id: 'u_' + (name || 'user'), name: name || 'User' } };
      },
    };

    it('draft in OLD shape (without intent field) works seamlessly and infers intent', async () => {
      const oldDraftWithoutIntent = {
        title: 'Review PRs',
        taskFor: 'self',
        priority: 'high',
        dueDateTime: '2026-10-30T10:00:00.000Z',
      };

      const result = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Priority low kar do',
        draft: oldDraftWithoutIntent,
      }, {
        ...mockAdminDeps,
        extractFn: async () => ({ priority: 'low' }),
      });

      assert.equal(result.success, true);
      assert.equal(result.draft.intent, 'self_task');
      assert.equal(result.draft.priority, 'low');
      assert.equal(result.draft.title, 'Review PRs');
    });

    it('proves no person mentioned can be lost: mentions in self task promote intent to task_assigned_user', async () => {
      const selfDraft = {
        intent: 'self_task',
        title: 'Prepare demo',
        taskFor: 'self',
      };

      const result = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rahul ko assign karo',
        draft: selfDraft,
      }, {
        ...mockAdminDeps,
        extractFn: async () => ({
          assigneeName: 'Rahul',
        }),
      });

      assert.equal(result.success, true);
      assert.equal(result.draft.intent, 'task_assigned_user');
      assert.equal(result.draft.assigneeName, 'Rahul');
      assert.equal(result.draft.taskFor, 'others');
      assert.equal(result.draft.title, 'Prepare demo', 'Existing fields must carry over');
    });
  });

  // ==========================================================================
  // 10. MULTIPART ATTACHMENT CONTRACT & END-TO-END MULTER TEST
  // ==========================================================================

  describe('10. Multipart Attachment Contract & End-to-End Multer Test', () => {
    it('FORM_REGISTRY produces exact endpoints and multer fileField "files" matching AdminTaskCreate and controllers', () => {
      // 1. self_task contract
      const selfPayload = FORM_REGISTRY.self_task.buildPayload({ title: 'Self Task with doc' });
      assert.equal(selfPayload.endpoint, '/tasks/self/create');
      assert.equal(selfPayload.fileField, 'files', 'self_task must declare fileField "files" per multer config');
      assert.equal(selfPayload.multipart, true);

      // 2. task_assigned_user contract
      const assignedPayload = FORM_REGISTRY.task_assigned_user.buildPayload({
        title: 'Assigned Task with doc',
        assigneeId: '507f1f77bcf86cd799439012',
      });
      assert.equal(assignedPayload.endpoint, '/task/create-for-others');
      assert.equal(assignedPayload.fileField, 'files', 'task_assigned_user must declare fileField "files" per AdminTaskCreate.jsx line 1352');
      assert.equal(assignedPayload.multipart, true);
    });

    it('proves end-to-end that multer parses file attachments under field "files" for both self and assigned routes', async (t) => {
      const express = require('express');
      const multer = require('../utils/multer');

      // Shared multer upload middleware matching selfTaskRoute.js and taskRoute.js
      const uploadFields = multer.fields([
        { name: 'files', maxCount: 10 },
        { name: 'voiceNote', maxCount: 1 },
      ]);

      const safeUploadFields = (req, res, next) => {
        uploadFields(req, res, (err) => {
          if (err) {
            return res.status(400).json({ success: false, error: err.message || 'File upload error' });
          }
          next();
        });
      };

      const capturedUploads = [];

      const app = express();
      // Emulate auth middleware
      app.use((req, res, next) => {
        req.user = { _id: '507f1f77bcf86cd799439011', role: 'admin' };
        next();
      });

      // Self task test endpoint
      app.post('/api/tasks/self/create', safeUploadFields, (req, res) => {
        const uploaded = (req.files?.files || []).map((f) => ({
          filename: f.filename || f.originalname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        }));
        capturedUploads.push({ route: 'self', files: uploaded, title: req.body.title });
        res.status(201).json({ success: true, count: uploaded.length, files: uploaded });
      });

      // Assigned task test endpoint
      app.post('/api/task/create-for-others', safeUploadFields, (req, res) => {
        const uploaded = (req.files?.files || []).map((f) => ({
          filename: f.filename || f.originalname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        }));
        capturedUploads.push({ route: 'assigned', files: uploaded, title: req.body.title });
        res.status(201).json({ success: true, count: uploaded.length, files: uploaded });
      });

      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      server.unref();
      t.after(() => new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
        server.close(() => resolve());
      }));

      const port = server.address().port;

      // 1. End-to-end self task with attachment under field 'files'
      const fdSelf = new FormData();
      fdSelf.append('title', 'Self Task with Report');
      const fileBlob1 = new Blob(['%PDF-1.4 simulated pdf invoice content'], { type: 'application/pdf' });
      fdSelf.append('files', fileBlob1, 'invoice.pdf');

      const resSelf = await fetch(`http://127.0.0.1:${port}/api/tasks/self/create`, {
        method: 'POST',
        body: fdSelf,
      });
      assert.equal(resSelf.status, 201);
      const dataSelf = await resSelf.json();
      assert.equal(dataSelf.success, true);
      assert.equal(dataSelf.count, 1);
      assert.equal(dataSelf.files[0].originalname, 'invoice.pdf');
      assert.equal(dataSelf.files[0].mimetype, 'application/pdf');

      // 2. End-to-end assigned task with attachment under field 'files'
      const fdAssigned = new FormData();
      fdAssigned.append('title', 'Assigned Task with Architecture Diagram');
      const fileBlob2 = new Blob(['simulated png image content'], { type: 'image/png' });
      fdAssigned.append('files', fileBlob2, 'architecture.png');

      const resAssigned = await fetch(`http://127.0.0.1:${port}/api/task/create-for-others`, {
        method: 'POST',
        body: fdAssigned,
      });
      assert.equal(resAssigned.status, 201);
      const dataAssigned = await resAssigned.json();
      assert.equal(dataAssigned.success, true);
      assert.equal(dataAssigned.count, 1);
      assert.equal(dataAssigned.files[0].originalname, 'architecture.png');
      assert.equal(dataAssigned.files[0].mimetype, 'image/png');

      // 3. Negative check: if wrong field name 'attachments' is used, multer strictly rejects it with HTTP 400
      const fdWrong = new FormData();
      fdWrong.append('title', 'Wrong Field Task');
      fdWrong.append('attachments', fileBlob1, 'wrong.pdf');
      const resWrong = await fetch(`http://127.0.0.1:${port}/api/tasks/self/create`, {
        method: 'POST',
        body: fdWrong,
      });
      assert.equal(resWrong.status, 400, 'Multer must reject fields other than "files" with 400');
      const dataWrong = await resWrong.json();
      assert.equal(dataWrong.success, false);
      assert.ok(dataWrong.error.includes('Unexpected field'), 'Expected Multer error to report "Unexpected field"');
    });
  });

  // ==========================================================================
  // PART 3A: MULTI-ASSIGNEE TASK SUITE
  // ==========================================================================
  describe('Part 3A: Multi-Assignee Task Suite', () => {
    const { parseTaskRequest } = require('../services/ai/taskAgentService');
    const adminUser = {
      _id: '507f1f77bcf86cd799439011',
      name: 'Test Admin',
      role: 'admin',
      company: '507f1f77bcf86cd799439010',
    };
    const mockAdminReq = { user: adminUser };

    const usersDb = {
      rohit: { _id: '507f191e810c19729de860ea', name: 'Rohit Sharma', department: 'DevOps' },
      rahul: { _id: '507f191e810c19729de860eb', name: 'Rahul Verma', department: 'Backend' },
      simran: { _id: '507f191e810c19729de860ec', name: 'Simran Kaur', department: 'QA' },
      kumarGaurav: { _id: '507f191e810c19729de860ed', name: 'Kumar Gaurav', department: 'Frontend' },
      kumarSanu: { _id: '507f191e810c19729de860ee', name: 'Kumar Sanu', department: 'Design' },
      outOfScopeUser: { _id: '507f191e810c19729de860ef', name: 'Neeraj OutOfScope', department: 'Finance' },
    };

    const multiAssigneeDeps = {
      getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
      isAssigneeInScope: async (req, scope, targetUserId) => {
        return String(targetUserId) !== String(usersDb.outOfScopeUser._id);
      },
      resolveAssignee: async ({ name }) => {
        const clean = String(name || '').toLowerCase().trim();
        if (clean.includes('kumar')) {
          return {
            status: 'multiple',
            candidates: [usersDb.kumarGaurav, usersDb.kumarSanu],
          };
        }
        if (clean.includes('rohit')) return { status: 'single', user: usersDb.rohit };
        if (clean.includes('rahul')) return { status: 'single', user: usersDb.rahul };
        if (clean.includes('simran')) return { status: 'single', user: usersDb.simran };
        if (clean.includes('neeraj')) return { status: 'single', user: usersDb.outOfScopeUser };
        return { status: 'none', candidates: [] };
      },
      extractFn: async () => ({}),
    };

    it('1. all-resolved: "Rohit aur Rahul ko task do" resolves both assignees and formats speakText', async () => {
      const res = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rohit aur Rahul ko task do, title API deployment, kal 5 baje, baaki default',
      }, multiAssigneeDeps);

      assert.equal(res.success, true);
      assert.equal(res.draft.intent, 'task_assigned_user');
      assert.equal(res.draft.taskFor, 'others');
      assert.equal(res.draft.assignees.length, 2);
      assert.equal(res.draft.assignees[0].name, 'Rohit Sharma');
      assert.equal(res.draft.assignees[1].name, 'Rahul Verma');
      assert.deepEqual(res.draft.assignedUsers, [String(usersDb.rohit._id), String(usersDb.rahul._id)]);

      // Spoken text says the names
      assert.ok(
        res.speakText.includes('Rohit Sharma aur Rahul Verma') || res.speakText.includes('Rohit aur Rahul'),
        `Expected speakText to mention assignees, got: "${res.speakText}"`
      );
    });

    it('2. one ambiguous: "Rohit aur Kumar ko task do" pauses on Kumar and returns needs_disambiguation', async () => {
      const res = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rohit aur Kumar ko task do',
      }, multiAssigneeDeps);

      assert.equal(res.success, true);
      assert.equal(res.status, 'needs_disambiguation');
      assert.equal(res.field, 'assignee');
      assert.ok(res.reply.includes('Kumar') && res.reply.includes('multiple users mile hain'));
      assert.equal(res.candidates.length, 2);
      assert.equal(res.candidates[0].name, 'Kumar Gaurav');
      assert.equal(res.candidates[1].name, 'Kumar Sanu');

      // User disambiguates Kumar by picking Kumar Sanu
      const resTurn2 = await parseTaskRequest({
        req: mockAdminReq,
        draft: res.draft,
        action: {
          type: 'set',
          field: 'assignee',
          value: 'Kumar Sanu',
          assigneeId: String(usersDb.kumarSanu._id),
        },
      }, multiAssigneeDeps);

      assert.equal(resTurn2.success, true);
      assert.equal(resTurn2.draft.assignees.length, 2);
      assert.equal(resTurn2.draft.assignees[0].name, 'Rohit Sharma');
      assert.equal(resTurn2.draft.assignees[1].name, 'Kumar Sanu');
      assert.deepEqual(resTurn2.draft.assignedUsers, [String(usersDb.rohit._id), String(usersDb.kumarSanu._id)]);
    });

    it('3. one unknown / misheard: "Rohit aur UnknownPerson ko task do" preserves Rohit and warns for unknown', async () => {
      const res = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rohit aur UnknownPerson ko task do',
      }, multiAssigneeDeps);

      assert.equal(res.success, true);
      assert.ok(res.notices.some(n => n.includes('UnknownPerson') && n.includes('koi employee nahi mila')));
      assert.equal(res.draft.assignees.length, 1);
      assert.equal(res.draft.assignees[0].name, 'Rohit Sharma');
      assert.deepEqual(res.draft.assignedUsers, [String(usersDb.rohit._id)]);
    });

    it('4. duplicates: "Rohit aur Rohit ko task do" deduplicates by ID to 1 user', async () => {
      const res = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rohit aur Rohit ko task do',
      }, multiAssigneeDeps);

      assert.equal(res.success, true);
      assert.equal(res.draft.assignees.length, 1);
      assert.equal(res.draft.assignees[0].name, 'Rohit Sharma');
      assert.deepEqual(res.draft.assignedUsers, [String(usersDb.rohit._id)]);
    });

    it('5. scope rules: out of scope user is never added, and employee without others permission cannot assign', async () => {
      // 5a. Out of scope user
      const resOutOfScope = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rohit aur Neeraj ko task do',
      }, multiAssigneeDeps);

      assert.equal(resOutOfScope.success, true);
      assert.ok(resOutOfScope.notices.some(n => n.includes('Neeraj') && n.includes('scope se bahar')));
      assert.equal(resOutOfScope.draft.assignees.length, 1);
      assert.equal(resOutOfScope.draft.assignees[0].name, 'Rohit Sharma');

      // 5b. Employee cannot assign to others
      const empReq = {
        user: {
          _id: '507f1f77bcf86cd799439099',
          name: 'Regular Employee',
          role: 'user',
          company: '507f1f77bcf86cd799439010',
        },
      };
      const empDeps = {
        ...multiAssigneeDeps,
        getScopeInfo: async () => ({ hasAccess: false, isOwner: false, isAdmin: false }),
      };

      const resEmp = await parseTaskRequest({
        req: empReq,
        message: 'Rohit aur Rahul ko task do',
      }, empDeps);

      assert.equal(resEmp.success, true);
      assert.equal(resEmp.draft.taskFor, 'self');
    });

    it('6. remove / add during edit: "Rahul ko hata do" and "Simran ko bhi add karo"', async () => {
      // Start with Rohit and Rahul
      const turn1 = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rohit aur Rahul ko task do, title Database Audit, kal 4 baje',
      }, multiAssigneeDeps);

      assert.equal(turn1.draft.assignees.length, 2);

      // Edit 1: "Rahul ko hata do"
      const turn2 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn1.draft,
        message: 'Rahul ko hata do',
      }, multiAssigneeDeps);

      assert.equal(turn2.draft.assignees.length, 1);
      assert.equal(turn2.draft.assignees[0].name, 'Rohit Sharma');
      assert.deepEqual(turn2.draft.assignedUsers, [String(usersDb.rohit._id)]);
      assert.ok(turn2.notices.some(n => n.includes('Rahul') && n.includes('hata diya')));

      // Edit 2: "Simran ko bhi add karo"
      const turn3 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn2.draft,
        message: 'Simran ko bhi add karo',
      }, multiAssigneeDeps);

      assert.equal(turn3.draft.assignees.length, 2);
      assert.equal(turn3.draft.assignees[0].name, 'Rohit Sharma');
      assert.equal(turn3.draft.assignees[1].name, 'Simran Kaur');
      assert.deepEqual(turn3.draft.assignedUsers, [String(usersDb.rohit._id), String(usersDb.simran._id)]);
    });

    it('7. payload contract vs AdminTaskCreate: assignedUsers serialized as JSON string of user IDs', () => {
      const sampleDraft = {
        intent: 'task_assigned_user',
        title: 'Security Compliance Audit',
        description: 'Verify SOC2 checklist',
        dueDateTime: '2026-10-31T18:00:00.000Z',
        priority: 'high',
        status: 'pending',
        priorityDays: '1',
        assignees: [usersDb.rohit, usersDb.rahul],
        assignedUsers: [String(usersDb.rohit._id), String(usersDb.rahul._id)],
        checkpoints: [{ title: 'Check firewall rules', completed: false }],
        reminder: true,
        reminderOption: 'oneHourBefore',
      };

      const payload = FORM_REGISTRY.task_assigned_user.buildPayload(sampleDraft);
      assert.equal(payload.endpoint, '/task/create-for-others');
      assert.equal(payload.method, 'POST');
      assert.equal(payload.multipart, true);

      // Byte-for-byte contract parity with AdminTaskCreate.jsx: formData.append('assignedUsers', JSON.stringify(newTask.assignedUsers))
      assert.equal(typeof payload.fields.assignedUsers, 'string');
      const parsedIds = JSON.parse(payload.fields.assignedUsers);
      assert.deepEqual(parsedIds, [String(usersDb.rohit._id), String(usersDb.rahul._id)]);
      assert.equal(payload.fields.title, 'Security Compliance Audit');
      assert.equal(payload.fields.priority, 'high');

      // Preview card contains assignees array with departments
      const preview = FORM_REGISTRY.task_assigned_user.buildPreview(sampleDraft);
      assert.equal(preview.assignees.length, 2);
      assert.equal(preview.assignees[0].name, 'Rohit Sharma');
      assert.equal(preview.assignees[0].department, 'DevOps');
      assert.equal(preview.assignees[1].name, 'Rahul Verma');
      assert.equal(preview.assignees[1].department, 'Backend');
    });

    it('8. single-name backward compatibility: "Rahul ko assign karo client proposal review" behaves identically', async () => {
      const res = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rahul ko assign karo client proposal review',
      }, multiAssigneeDeps);

      assert.equal(res.success, true);
      assert.equal(res.draft.intent, 'task_assigned_user');
      assert.equal(res.draft.assigneeName, 'Rahul Verma');
      assert.equal(res.draft.assigneeId, String(usersDb.rahul._id));
      assert.equal(res.draft.assignees.length, 1);
      assert.deepEqual(res.draft.assignedUsers, [String(usersDb.rahul._id)]);
    });

    const demo1Users = {
      aarav: {
        _id: '507f191e810c19729de860f1',
        name: 'Aarav Sharma',
        role: 'user',
        jobRole: 'Developer',
        company: '507f1f77bcf86cd799439010',
      },
      divya: {
        _id: '507f191e810c19729de860f2',
        name: 'Divya Patel',
        role: 'user',
        jobRole: 'QA Engineer',
        company: '507f1f77bcf86cd799439010',
      },
    };

    const demo1ProjectWithBoth = {
      _id: '607f191e810c19729de860a1',
      projectName: 'Demo 1',
      company: '507f1f77bcf86cd799439010',
      users: [demo1Users.aarav, demo1Users.divya],
    };

    const demo1ProjectWithAaravOnly = {
      _id: '607f191e810c19729de860a1',
      projectName: 'Demo 1',
      company: '507f1f77bcf86cd799439010',
      users: [demo1Users.aarav], // Divya is NOT a member
    };

    it('9. Replay Test A (both members): exact utterance resolves Divya and Aarav, default chip preserves both', async () => {
      const depsWithDemo1 = {
        ...multiAssigneeDeps,
        accessibleProjects: [demo1ProjectWithBoth],
      };

      const manualUtterance = 'Demo 1 project mein, Divya and Arav ko task assign karo, task ka naam Doing API testing, due date kal 5 baje';

      // Turn 1: Utterance
      const turn1 = await parseTaskRequest({
        req: mockAdminReq,
        message: manualUtterance,
      }, depsWithDemo1);

      assert.equal(turn1.success, true);
      assert.equal(turn1.draft.intent, 'task_project');
      assert.equal(turn1.draft.projectName, 'Demo 1');
      assert.equal(turn1.draft.title, 'Doing API testing');
      // Divya was resolved immediately, Arav triggered fuzzy suggestion for Aarav Sharma
      assert.equal(turn1.draft.assignees.length, 1);
      assert.equal(turn1.draft.assignees[0].name, 'Divya Patel');
      assert.equal(turn1.status, 'needs_input');
      assert.ok(turn1.reply.includes('Aarav Sharma'));
      assert.equal(turn1.preview, null, 'Preview card must not be shown while a name is still open');

      // Turn 2: Pick "Haan, Aarav Sharma"
      const turn2 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn1.draft,
        action: {
          type: 'set',
          field: 'assignee',
          value: 'Aarav Sharma',
          assigneeId: String(demo1Users.aarav._id),
        },
      }, depsWithDemo1);

      assert.equal(turn2.success, true);
      assert.equal(turn2.draft.assignees.length, 2);
      assert.equal(turn2.draft.assignees[0].name, 'Divya Patel');
      assert.equal(turn2.draft.assignees[1].name, 'Aarav Sharma');
      assert.deepEqual(turn2.draft.assignedUsers, [String(demo1Users.divya._id), String(demo1Users.aarav._id)]);

      // Turn 3: Tap "Baaki sab default" (skip_all)
      const turn3 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn2.draft,
        action: { type: 'skip_all' },
      }, depsWithDemo1);

      assert.equal(turn3.success, true);
      assert.equal(turn3.status, 'ready');
      // Must NOT say assignee change kar diya hai
      assert.ok(
        !turn3.reply.includes('assignee change kar diya hai'),
        `Expected reply to NOT contain assignee change notice, got: "${turn3.reply}"`
      );
      // Assignees remain set
      assert.equal(turn3.draft.assignees.length, 2);
      assert.deepEqual(turn3.draft.assignedUsers, [String(demo1Users.divya._id), String(demo1Users.aarav._id)]);

      // Preview card contains both assignees
      assert.ok(turn3.preview);
      assert.equal(turn3.preview.assignees.length, 2);
      assert.ok(turn3.preview.assignee.label.includes('Divya') && turn3.preview.assignee.label.includes('Aarav'));

      // speakText names both assignees
      assert.ok(
        turn3.speakText.includes('Divya') && turn3.speakText.includes('Aarav'),
        `Expected speakText to name both assignees, got: "${turn3.speakText}"`
      );

      // Payload contract: assignedUsers is an Array of user IDs (repeated FormData entries)
      assert.ok(Array.isArray(turn3.payload.fields.assignedUsers));
      assert.deepEqual(turn3.payload.fields.assignedUsers, [String(demo1Users.divya._id), String(demo1Users.aarav._id)]);
    });

    it('10. Replay Test B (Divya non-member): manual utterance warns Divya not member, chhod do, resolves Aarav, default chip preserves Aarav', async () => {
      const depsAaravOnly = {
        ...multiAssigneeDeps,
        accessibleProjects: [demo1ProjectWithAaravOnly],
      };

      const manualUtterance = 'Demo 1 project mein, Divya and Arav ko task assign karo, task ka naam Doing API testing, due date kal 5 baje';

      // Turn 1: Utterance
      const turn1 = await parseTaskRequest({
        req: mockAdminReq,
        message: manualUtterance,
      }, depsAaravOnly);

      assert.equal(turn1.success, true);
      assert.equal(turn1.status, 'needs_input');
      // Warns Divya is not a member of Demo 1
      assert.ok(
        turn1.reply.includes('Divya is project ke member nahi hain') || turn1.reply.includes('member nahi hain'),
        `Expected reply to state Divya is not member, got: "${turn1.reply}"`
      );
      // Has chip "Divya ko chhod do"
      assert.ok(
        turn1.chips.some(c => c.label.includes('Divya ko chhod do')),
        'Expected chip "Divya ko chhod do"'
      );
      assert.equal(turn1.preview, null, 'Preview card must not be shown while a name is still open');

      // Turn 2: User says "Divya ko chhod do"
      const turn2 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn1.draft,
        message: 'Divya ko chhod do',
      }, depsAaravOnly);

      assert.equal(turn2.success, true);
      assert.equal(turn2.status, 'needs_input');
      // Moves to next pending name "Arav" and suggests "Aarav Sharma"
      assert.ok(
        turn2.reply.includes('Aarav Sharma'),
        `Expected reply to suggest Aarav Sharma, got: "${turn2.reply}"`
      );
      assert.ok(
        turn2.chips.some(c => c.label.includes('Haan, Aarav Sharma')),
        'Expected chip "Haan, Aarav Sharma"'
      );
      assert.equal(turn2.preview, null, 'Preview card must not be shown while a name is still open');

      // Turn 3: User picks "Haan, Aarav Sharma"
      const turn3 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn2.draft,
        action: {
          type: 'set',
          field: 'assignee',
          value: 'Aarav Sharma',
          assigneeId: String(demo1Users.aarav._id),
        },
      }, depsAaravOnly);

      assert.equal(turn3.success, true);
      assert.equal(turn3.draft.assigneeId, String(demo1Users.aarav._id));
      assert.equal(turn3.draft.assignees.length, 1);
      assert.equal(turn3.draft.assignees[0].name, 'Aarav Sharma');

      // Turn 4: User taps "Baaki sab default" (skip_all)
      const turn4 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn3.draft,
        action: { type: 'skip_all' },
      }, depsAaravOnly);

      assert.equal(turn4.success, true);
      assert.equal(turn4.status, 'ready');
      // Bug (b) verification: Agent MUST NOT say "Ji aapka assignee change kar diya hai"
      assert.ok(
        !turn4.reply.includes('assignee change kar diya hai'),
        `Expected reply to NOT contain assignee change notice, got: "${turn4.reply}"`
      );
      // Resolved assignee is NOT lost
      assert.equal(turn4.draft.assigneeId, String(demo1Users.aarav._id));
      assert.equal(turn4.draft.assignees.length, 1);

      // Preview card shows Aarav Sharma (NOT "Bina assignee ke")
      assert.ok(turn4.preview);
      assert.ok(turn4.preview.assignee);
      assert.ok(
        turn4.preview.assignee.label.includes('Aarav Sharma'),
        `Expected preview assignee label to have Aarav Sharma, got: "${turn4.preview.assignee.label}"`
      );
      assert.notEqual(turn4.preview.assignee.label, 'Bina assignee ke');

      // speakText names Aarav Sharma
      assert.ok(
        turn4.speakText.includes('Aarav Sharma') || turn4.speakText.includes('Aarav'),
        `Expected speakText to name Aarav Sharma, got: "${turn4.speakText}"`
      );

      // Payload: assignedUsers is array with [aaravId]
      assert.ok(Array.isArray(turn4.payload.fields.assignedUsers));
      assert.deepEqual(turn4.payload.fields.assignedUsers, [String(demo1Users.aarav._id)]);
    });

    it('11. Replay Test C: "Baaki sab default" keeps assignee in task_assigned_user flow', async () => {
      // Turn 1: User says: "Rahul ko task assign karo, task ka naam review client report, due date kal 5 baje"
      const turn1 = await parseTaskRequest({
        req: mockAdminReq,
        message: 'Rahul ko task assign karo, task ka naam review client report, due date kal 5 baje',
      }, multiAssigneeDeps);

      assert.equal(turn1.success, true);
      assert.equal(turn1.draft.assigneeId, String(usersDb.rahul._id));
      assert.equal(turn1.draft.assignees.length, 1);

      // Turn 2: User taps "Baaki sab default" (skip_all)
      const turn2 = await parseTaskRequest({
        req: mockAdminReq,
        draft: turn1.draft,
        action: { type: 'skip_all' },
      }, multiAssigneeDeps);

      assert.equal(turn2.success, true);
      assert.equal(turn2.status, 'ready');
      assert.ok(
        !turn2.reply.includes('assignee change kar diya hai'),
        `Expected reply to NOT contain assignee change notice, got: "${turn2.reply}"`
      );
      assert.equal(turn2.draft.assigneeId, String(usersDb.rahul._id));
      assert.ok(turn2.preview.assignee.label.includes('Rahul Verma'));
      // Payload contract: JSON string of user IDs for task_assigned_user
      assert.equal(typeof turn2.payload.fields.assignedUsers, 'string');
      assert.deepEqual(JSON.parse(turn2.payload.fields.assignedUsers), [String(usersDb.rahul._id)]);
    });

    it('12. Contract Tests: POST /projects/:id/tasks (repeated) vs POST /task/create-for-others (single JSON string)', () => {
      // 1. task_project payload: assignedUsers is Array
      const projectDraft = {
        intent: 'task_project',
        projectId: '607f191e810c19729de860a1',
        projectName: 'Demo 1',
        title: 'Doing API testing',
        dueDate: '2026-10-28T17:00:00+05:30',
        assignedUsers: [String(demo1Users.divya._id), String(demo1Users.aarav._id)],
        assignees: [demo1Users.divya, demo1Users.aarav],
      };
      const projectPayload = FORM_REGISTRY.task_project.buildPayload(projectDraft);
      assert.equal(projectPayload.endpoint, '/projects/607f191e810c19729de860a1/tasks');
      assert.ok(Array.isArray(projectPayload.fields.assignedUsers));
      assert.deepEqual(projectPayload.fields.assignedUsers, [String(demo1Users.divya._id), String(demo1Users.aarav._id)]);

      // Simulate FormData appending as in ProjectDetailsPage.jsx lines 724-727
      const projectFormDataEntries = [];
      Object.entries(projectPayload.fields).forEach(([k, v]) => {
        if (k === 'assignedUsers') {
          v.forEach(id => projectFormDataEntries.push(['assignedUsers', String(id)]));
        } else {
          projectFormDataEntries.push([k, v]);
        }
      });
      const repeatedEntries = projectFormDataEntries.filter(([k]) => k === 'assignedUsers');
      assert.equal(repeatedEntries.length, 2);
      assert.deepEqual(repeatedEntries, [
        ['assignedUsers', String(demo1Users.divya._id)],
        ['assignedUsers', String(demo1Users.aarav._id)],
      ]);

      // 2. task_assigned_user payload: assignedUsers is single JSON string
      const assignedDraft = {
        intent: 'task_assigned_user',
        title: 'Security Audit',
        dueDateTime: '2026-10-28T17:00:00+05:30',
        assignedUsers: [String(usersDb.rohit._id), String(usersDb.rahul._id)],
        assignees: [usersDb.rohit, usersDb.rahul],
      };
      const assignedPayload = FORM_REGISTRY.task_assigned_user.buildPayload(assignedDraft);
      assert.equal(assignedPayload.endpoint, '/task/create-for-others');
      assert.equal(typeof assignedPayload.fields.assignedUsers, 'string');
      assert.deepEqual(JSON.parse(assignedPayload.fields.assignedUsers), [String(usersDb.rohit._id), String(usersDb.rahul._id)]);

      // Simulate FormData appending as in AdminTaskCreate.jsx line 1337
      const assignedFormDataEntries = [];
      Object.entries(assignedPayload.fields).forEach(([k, v]) => {
        assignedFormDataEntries.push([k, v]);
      });
      const singleEntries = assignedFormDataEntries.filter(([k]) => k === 'assignedUsers');
      assert.equal(singleEntries.length, 1);
      assert.equal(singleEntries[0][1], JSON.stringify([String(usersDb.rohit._id), String(usersDb.rahul._id)]));
    });

    // ========================================================================
    // ROUND 3 TESTS: SEPARATORS, PARTIAL MATCH PREVENTION & FULL REPLAY
    // ========================================================================
    describe('Round 3: Separators & Safety Check Suite', () => {
      const demo1UsersR3 = {
        vansh: { _id: '607f191e810c19729de860c1', name: 'Vansh Test', department: 'QA', role: 'Member' },
        aarav: { _id: '607f191e810c19729de860c2', name: 'Aarav Sharma', department: 'Dev', role: 'Member' },
      };

      const demo1ProjectR3 = {
        _id: '607f191e810c19729de860c0',
        projectName: 'Demo 1',
        users: [demo1UsersR3.vansh, demo1UsersR3.aarav],
      };

      const makeR3Deps = () => ({
        getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
        isAssigneeInScope: async () => true,
        getAccessibleProjects: async () => [demo1ProjectR3],
        resolveAssignee: async ({ name }) => {
          const clean = String(name || '').toLowerCase().trim();
          if (clean.includes('vansh') || clean.includes('वंश')) return { status: 'single', user: demo1UsersR3.vansh };
          if (clean.includes('arav') || clean.includes('aarav') || clean.includes('आरव')) return { status: 'single', user: demo1UsersR3.aarav };
          return { status: 'none', candidates: [] };
        },
        extractFn: async () => ({}),
      });

      // 1. Separators tests in task_assigned_user (others)
      const separatorUtterances = [
        'vansh or arav',
        'vansh aur arav',
        'Vansh, Arav',
        'vansh and arav',
        'वंश और आरव',
        'vansh + arav',
      ];

      for (const sepUtterance of separatorUtterances) {
        it(`1. Separator support (task for others): "${sepUtterance}" resolves both assignees`, async () => {
          const res = await parseTaskRequest({
            req: mockAdminReq,
            message: `${sepUtterance} ko task assign karo, title Testing separators, kal 5 baje, baaki default`,
          }, makeR3Deps());

          assert.equal(res.success, true);
          assert.equal(res.draft.taskFor, 'others');
          assert.equal(res.draft.assignees.length, 2, `Expected 2 assignees for "${sepUtterance}", got ${res.draft.assignees?.length}`);
          const names = res.draft.assignees.map(a => a.name);
          assert.ok(names.includes('Vansh Test'), `Missing Vansh Test for "${sepUtterance}"`);
          assert.ok(names.includes('Aarav Sharma'), `Missing Aarav Sharma for "${sepUtterance}"`);
          assert.deepEqual(res.draft.assignedUsers, [String(demo1UsersR3.vansh._id), String(demo1UsersR3.aarav._id)]);
        });

        it(`1. Separator support (project task): "Demo 1 mein ${sepUtterance} ko task do" extracts both names`, async () => {
          const res = await parseTaskRequest({
            req: mockAdminReq,
            message: `Demo 1 project mein, ${sepUtterance} ko task assign karo`,
          }, makeR3Deps());

          assert.equal(res.success, true);
          assert.equal(res.draft.intent, 'task_project');
          // If arav required fuzzy disambiguation, vansh is resolved and arav is in disambiguation or pending
          const resolvedOrPending = [
            ...(res.draft.assignees || []).map(a => a.name),
            ...(res.draft.pendingAssigneeNames || [])
          ];
          assert.ok(resolvedOrPending.length >= 2, `Expected at least 2 names resolved or pending for "${sepUtterance}"`);
        });
      }

      // 2. Never accept a partial match for the whole string & safety check before ready
      it('2. Partial match prevention: "vansh or arav" does NOT auto-resolve to Vansh only', async () => {
        const res = await parseTaskRequest({
          req: mockAdminReq,
          message: 'Demo 1 project mai vansh or arav ko task assign karo',
        }, makeR3Deps());

        assert.equal(res.success, true);
        assert.equal(res.draft.intent, 'task_project');
        // Vansh Test was resolved
        assert.ok(res.draft.assignees.some(a => a.name === 'Vansh Test'));
        // "arav" was NOT dropped! It is either in pending or currently asked
        assert.equal(res.status, 'needs_input');
        assert.equal(res.field, 'assignee');
        assert.ok(
          res.reply.includes('Aarav Sharma') || (res.chips && res.chips.some(c => c.label.includes('Aarav Sharma'))),
          `Expected "Did you mean Aarav Sharma" question/chips, got reply: "${res.reply}"`
        );
      });

      // 3. Replay the exact transcript from user manual test with fake users
      it('3. Replay exact transcript: Demo 1 with Vansh Test and Aarav Sharma, chips Skip, Kal subah 10 AM, High, In Progress, Baaki sab default', async () => {
        const trace = [];

        // Turn 1: User says: "Demo 1 project mai vansh or arav ko task assign karo"
        const turn1 = await parseTaskRequest({
          req: mockAdminReq,
          message: 'Demo 1 project mai vansh or arav ko task assign karo',
        }, makeR3Deps());

        trace.push({
          turn: 1,
          input: 'Demo 1 project mai vansh or arav ko task assign karo',
          status: turn1.status,
          field: turn1.field,
          assignees: (turn1.draft.assignees || []).map(a => a.name),
          pending: turn1.draft.pendingAssigneeNames || [],
          reply: turn1.reply,
        });

        assert.equal(turn1.status, 'needs_input');
        assert.equal(turn1.field, 'assignee');
        assert.ok(turn1.draft.assignees.some(a => a.name === 'Vansh Test'));
        const haanAaravChip = turn1.chips.find(c => c.label.includes('Aarav Sharma'));
        assert.ok(haanAaravChip, 'Must show "Haan, Aarav Sharma" chip');

        // Turn 2: User taps chip "Haan, Aarav Sharma"
        const turn2 = await parseTaskRequest({
          req: mockAdminReq,
          draft: turn1.draft,
          action: haanAaravChip.action,
        }, makeR3Deps());

        trace.push({
          turn: 2,
          input: haanAaravChip.label,
          status: turn2.status,
          field: turn2.field,
          assignees: (turn2.draft.assignees || []).map(a => a.name),
          pending: turn2.draft.pendingAssigneeNames || [],
          reply: turn2.reply,
        });

        assert.equal(turn2.draft.assignees.length, 2);
        assert.deepEqual(
          turn2.draft.assignees.map(a => a.name),
          ['Vansh Test', 'Aarav Sharma']
        );
        assert.deepEqual(
          turn2.draft.assignedUsers,
          [String(demo1UsersR3.vansh._id), String(demo1UsersR3.aarav._id)]
        );

        // Turn 3: Title asked -> User taps chip "Skip"
        const turn3 = await parseTaskRequest({
          req: mockAdminReq,
          draft: turn2.draft,
          message: 'Skip',
        }, makeR3Deps());

        trace.push({
          turn: 3,
          input: 'Skip',
          status: turn3.status,
          field: turn3.field,
          assignees: (turn3.draft.assignees || []).map(a => a.name),
          reply: turn3.reply,
        });

        // Turn 4: Due date -> User taps chip "Kal subah 10 AM" (or sends it)
        const turn4 = await parseTaskRequest({
          req: mockAdminReq,
          draft: turn3.draft,
          message: 'Kal subah 10 AM',
        }, makeR3Deps());

        trace.push({
          turn: 4,
          input: 'Kal subah 10 AM',
          status: turn4.status,
          field: turn4.field,
          assignees: (turn4.draft.assignees || []).map(a => a.name),
          reply: turn4.reply,
        });

        // Turn 5: Priority -> User taps chip "High"
        const turn5 = await parseTaskRequest({
          req: mockAdminReq,
          draft: turn4.draft,
          action: { type: 'set', field: 'priority', value: 'High' },
        }, makeR3Deps());

        trace.push({
          turn: 5,
          input: 'High',
          status: turn5.status,
          field: turn5.field,
          assignees: (turn5.draft.assignees || []).map(a => a.name),
          reply: turn5.reply,
        });

        // Turn 6: Status -> User taps chip "In Progress"
        const turn6 = await parseTaskRequest({
          req: mockAdminReq,
          draft: turn5.draft,
          action: { type: 'set', field: 'status', value: 'in progress' },
        }, makeR3Deps());

        trace.push({
          turn: 6,
          input: 'In Progress',
          status: turn6.status,
          field: turn6.field,
          assignees: (turn6.draft.assignees || []).map(a => a.name),
          reply: turn6.reply,
        });

        // Turn 7: User taps chip "Baaki sab default"
        const turn7 = await parseTaskRequest({
          req: mockAdminReq,
          draft: turn6.draft,
          message: 'Baaki sab default',
        }, makeR3Deps());

        trace.push({
          turn: 7,
          input: 'Baaki sab default',
          status: turn7.status,
          field: turn7.field,
          assignees: (turn7.draft.assignees || []).map(a => a.name),
          reply: turn7.reply,
          payload: turn7.payload,
          preview: turn7.preview,
        });

        // Log turn-by-turn trace for report
        console.log('\n--- Round 3 Turn-by-Turn Replay Trace ---');
        trace.forEach(t => {
          console.log(`[Turn ${t.turn}] input="${t.input}" -> status=${t.status} field=${t.field} assignees=[${t.assignees.join(', ')}]`);
        });

        // Verify final state
        assert.equal(turn7.status, 'ready');
        assert.equal(turn7.draft.assignees.length, 2);
        assert.deepEqual(
          turn7.draft.assignees.map(a => a.name),
          ['Vansh Test', 'Aarav Sharma']
        );
        assert.deepEqual(
          turn7.draft.assignedUsers,
          [String(demo1UsersR3.vansh._id), String(demo1UsersR3.aarav._id)]
        );

        // Verify preview card shows both assignees
        assert.ok(turn7.preview);
        assert.equal(turn7.preview.assignees.length, 2);
        assert.equal(turn7.preview.assignees[0].name, 'Vansh Test');
        assert.equal(turn7.preview.assignees[1].name, 'Aarav Sharma');

        // Verify payload contract: Repeated assignedUsers FormData entries (ProjectDetailsPage contract)
        assert.equal(turn7.payload.endpoint, `/projects/${demo1ProjectR3._id}/tasks`);
        assert.equal(turn7.payload.method, 'POST');
        assert.equal(turn7.payload.multipart, true);
        assert.ok(Array.isArray(turn7.payload.fields.assignedUsers));
        assert.deepEqual(
          turn7.payload.fields.assignedUsers,
          [String(demo1UsersR3.vansh._id), String(demo1UsersR3.aarav._id)]
        );

        // Simulate FormData append as in ProjectDetailsPage line 724-727
        const formData = [];
        Object.entries(turn7.payload.fields).forEach(([k, v]) => {
          if (k === 'assignedUsers') {
            v.forEach(id => formData.push(['assignedUsers', String(id)]));
          } else {
            formData.push([k, v]);
          }
        });
        const repeatedEntries = formData.filter(([k]) => k === 'assignedUsers');
        assert.equal(repeatedEntries.length, 2);
        assert.deepEqual(repeatedEntries, [
          ['assignedUsers', String(demo1UsersR3.vansh._id)],
          ['assignedUsers', String(demo1UsersR3.aarav._id)],
        ]);
        console.log('Final Payload assignedUsers repeated FormData entries:', repeatedEntries);
      });
    });
  });

  // ==========================================================================
  // 17. ROUND 3 FOLLOW-UP SUITE
  // ==========================================================================

  describe('17. Round 3 Follow-up Suite: Title Mandatory, Timezone Offset, and Action Title Detection', () => {
    const { parseHinglishSlots, detectPersonInActionTitle, extractAssigneeMention } = require('../services/ai/hinglishParser');
    const { parseTaskRequest } = require('../services/ai/taskAgentService');

    it('17.1 Title is strictly required: "Skip", "koi nahi" re-ask title and agent NEVER invents a title for task_project', async () => {
      const mockProj = {
        _id: '60d5ec49f1b2c8b1f8e4e1a1',
        projectName: 'Demo 1',
        name: 'Demo 1',
        users: [{ _id: '60d5ec49f1b2c8b1f8e4e1a2', name: 'Vansh Test' }],
      };

      const draftAskingTitle = {
        intent: 'task_project',
        projectId: String(mockProj._id),
        projectName: 'Demo 1',
        project: 'Demo 1',
        title: null,
        description: 'Test description',
        assigneeId: String(mockProj.users[0]._id),
        assigneeName: 'Vansh Test',
        assignedUsers: [String(mockProj.users[0]._id)],
        dueDateTime: '2026-10-29T10:00:00+05:30',
        priority: 'high',
        status: 'pending',
        asked: ['project', 'assignee', 'title'],
        skipped: [],
      };

      // Turn: User says "Skip" to title question
      const resSkip = await parseTaskRequest({
        req: { user: { _id: 'admin1', name: 'Admin', role: 'admin' } },
        message: 'Skip',
        draft: draftAskingTitle,
        language: 'hinglish',
      }, {
        accessibleProjects: [mockProj],
        ProjectModel: { find: () => ({ select: () => ({ populate: () => Promise.resolve([mockProj]) }) }) },
        extractFn: async () => ({}),
      });

      assert.equal(resSkip.status, 'needs_input');
      assert.equal(resSkip.field, 'title');
      assert.match(resSkip.reply, /Task ka naam zaroori hai/i);
      assert.equal(resSkip.draft.title, null);
      assert.ok(!resSkip.draft.skipped.includes('title'));
      assert.equal(resSkip.payload, null);

      // Turn: User says "koi nahi" to title question
      const resKoiNahi = await parseTaskRequest({
        req: { user: { _id: 'admin1', name: 'Admin', role: 'admin' } },
        message: 'koi nahi',
        draft: draftAskingTitle,
        language: 'hinglish',
      }, {
        accessibleProjects: [mockProj],
        ProjectModel: { find: () => ({ select: () => ({ populate: () => Promise.resolve([mockProj]) }) }) },
        extractFn: async () => ({}),
      });

      assert.equal(resKoiNahi.status, 'needs_input');
      assert.equal(resKoiNahi.field, 'title');
      assert.match(resKoiNahi.reply, /Task ka naam zaroori hai/i);
      assert.equal(resKoiNahi.draft.title, null);
      assert.ok(!resKoiNahi.draft.skipped.includes('title'));
      assert.equal(resKoiNahi.payload, null);
    });

    it('17.2 Title is strictly required: "Skip", "koi nahi" re-ask title and agent NEVER invents a title for task_assigned_user', async () => {
      const draftAskingTitleOthers = {
        intent: 'task_assigned_user',
        title: null,
        description: '',
        assigneeId: '60d5ec49f1b2c8b1f8e4e1a2',
        assigneeName: 'Priya Sharma',
        dueDateTime: '2026-10-29T10:00:00+05:30',
        priority: 'high',
        status: 'pending',
        asked: ['assignee', 'title'],
        skipped: [],
      };

      const resSkipOthers = await parseTaskRequest({
        req: { user: { _id: 'admin1', name: 'Admin', role: 'admin' } },
        message: 'Skip',
        draft: draftAskingTitleOthers,
        language: 'hinglish',
      }, {
        extractFn: async () => ({}),
      });

      assert.equal(resSkipOthers.status, 'needs_input');
      assert.equal(resSkipOthers.field, 'title');
      assert.match(resSkipOthers.reply, /Task ka naam zaroori hai/i);
      assert.equal(resSkipOthers.draft.title, null);
      assert.ok(!resSkipOthers.draft.skipped.includes('title'));
      assert.equal(resSkipOthers.payload, null);
    });

    it('17.3 Timezone extraction & payload parity in IST (+05:30)', () => {
      const fixedNow = new Date('2026-10-28T09:33:32+05:30');

      // 1. "kal subah 10 baje" extractor output
      const extMorning = parseHinglishSlots('kal subah 10 baje', fixedNow);
      assert.equal(extMorning.dueDateTime, '2026-10-29T10:00:00+05:30');

      // 2. "kal shaam 6 baje" extractor output
      const extEvening = parseHinglishSlots('kal shaam 6 baje', fixedNow);
      assert.equal(extEvening.dueDateTime, '2026-10-29T18:00:00+05:30');

      // 3. Exact payload value sent in payload.fields.dueDate
      const draftProjMorning = {
        intent: 'task_project',
        projectId: '60d5ec49f1b2c8b1f8e4e1a1',
        title: 'Project Audit',
        dueDateTime: extMorning.dueDateTime,
        priority: 'high',
        status: 'pending',
        assignedUsers: ['60d5ec49f1b2c8b1f8e4e1a2'],
      };
      const payloadMorning = FORM_REGISTRY.task_project.buildPayload(draftProjMorning);
      assert.equal(payloadMorning.fields.dueDate, '2026-10-29T10:00:00+05:30');

      const draftProjEvening = {
        intent: 'task_project',
        projectId: '60d5ec49f1b2c8b1f8e4e1a1',
        title: 'Project Audit',
        dueDateTime: extEvening.dueDateTime,
        priority: 'high',
        status: 'pending',
        assignedUsers: ['60d5ec49f1b2c8b1f8e4e1a2'],
      };
      const payloadEvening = FORM_REGISTRY.task_project.buildPayload(draftProjEvening);
      assert.equal(payloadEvening.fields.dueDate, '2026-10-29T18:00:00+05:30');
    });

    it('17.4 Action title person detection: Follow up with Rahul, Send report Priya, verify bank statements Priya (ask), and Priya ko assign karo (assigns)', async () => {
      const userA = { _id: 'u1', name: 'Admin User', role: 'admin' };

      // Case A: "Follow up with Rahul" -> asks chip question
      assert.equal(detectPersonInActionTitle('Follow up with Rahul'), 'Rahul');
      const resA = await parseTaskRequest({
        req: { user: userA },
        message: 'Follow up with Rahul',
        draft: null,
        language: 'hinglish',
      }, { extractFn: async () => ({}) });
      assert.equal(resA.draft.intent, 'self_task');
      assert.equal(resA.field, 'assigneeConfirmation');
      assert.match(resA.reply, /Rahul ko assign karna hai\?/i);
      assert.ok(resA.chips.some(c => c.label.includes('assign karo')));

      // Case B: "Send report Priya" -> asks chip question
      assert.equal(detectPersonInActionTitle('Send report Priya'), 'Priya');
      const resB = await parseTaskRequest({
        req: { user: userA },
        message: 'Send report Priya',
        draft: null,
        language: 'hinglish',
      }, { extractFn: async () => ({}) });
      assert.equal(resB.draft.intent, 'self_task');
      assert.equal(resB.field, 'assigneeConfirmation');
      assert.match(resB.reply, /Priya ko assign karna hai\?/i);
      assert.ok(resB.chips.some(c => c.label.includes('assign karo')));

      // Case C: "verify bank statements Priya" -> asks chip question
      assert.equal(detectPersonInActionTitle('verify bank statements Priya'), 'Priya');
      const resC = await parseTaskRequest({
        req: { user: userA },
        message: 'verify bank statements Priya',
        draft: null,
        language: 'hinglish',
      }, { extractFn: async () => ({}) });
      assert.equal(resC.draft.intent, 'self_task');
      assert.equal(resC.field, 'assigneeConfirmation');
      assert.match(resC.reply, /Priya ko assign karna hai\?/i);
      assert.ok(resC.chips.some(c => c.label.includes('assign karo')));

      // Case D: "Priya ko assign karo bank statements verify" -> assigns Priya directly
      assert.equal(detectPersonInActionTitle('Priya ko assign karo bank statements verify'), null);
      assert.equal(extractAssigneeMention('Priya ko assign karo bank statements verify'), 'Priya');
      const resD = await parseTaskRequest({
        req: { user: userA },
        message: 'Priya ko assign karo bank statements verify',
        draft: null,
        language: 'hinglish',
      }, { extractFn: async () => ({}) });
      assert.equal(resD.draft.intent, 'task_assigned_user');
      assert.equal(resD.draft.assigneeName, 'Priya');
    });
  });
});


