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
});
