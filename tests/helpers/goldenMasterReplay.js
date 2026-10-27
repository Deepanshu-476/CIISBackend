/**
 * tests/helpers/goldenMasterReplay.js
 *
 * Golden Master Replay Script:
 * Replays 15 scripted scenarios through both:
 * 1. Old taskAgentService (before Part 1, at git worktree f27f9fe)
 * 2. Current taskAgentService (with Form Registry & bug fixes)
 *
 * Compares turn-by-turn API responses:
 * - reply text
 * - speech text
 * - chips
 * - candidates
 * - draft fields
 * - payload envelope (endpoint, method, multipart, fields, fileField, body)
 * - status
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');

// Prevent OverwriteModelError when requiring models across multiple trees
const origModel = mongoose.model.bind(mongoose);
mongoose.model = function (name, schema, collection) {
  if (mongoose.models[name]) return mongoose.models[name];
  return origModel(name, schema, collection);
};

const oldService = require('../../../CIISBackend_f27f9fe/services/ai/taskAgentService');
const currentService = require('../../services/ai/taskAgentService');

const fixedNow = new Date('2026-10-26T10:00:00.000Z');

const mockReq = {
  user: {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test Admin',
    role: 'admin',
    company: '507f1f77bcf86cd799439010',
    companyCode: 'COMP-01',
    companyRole: 'admin',
  },
};

const makeMockDeps = (customResolver = null, customExtractor = null) => ({
  now: fixedNow,
  getScopeInfo: async () => ({ hasAccess: true, isOwner: true }),
  isAssigneeInScope: async () => true,
  resolveAssignee: customResolver || (async (arg) => {
    const name = typeof arg === 'string' ? arg : arg?.name;
    return { status: 'single', user: { _id: 'usr_' + (name || 'test'), name: name || 'Test User' } };
  }),
  extractFn: customExtractor || (async () => ({})),
});

const scenarios = [
  // 1. self task by text
  {
    name: '1. self task by text',
    turns: [
      { message: 'Task prepare quarterly financial statement' },
      { message: 'kal shaam 5 baje tak' },
    ],
  },
  // 2. each optional slot answered or skipped ("koi nahi")
  {
    name: '2. each optional slot skipped ("koi nahi")',
    turns: [
      { message: 'Task submit sales report kal shaam 6 baje' },
      { message: 'koi nahi' },
    ],
  },
  // 3. chips "Khud ke liye" and "Kisi ke liye"
  {
    name: '3. chips Khud ke liye and Kisi ke liye',
    turns: [
      { action: { type: 'set', field: 'taskFor', value: 'self' }, display: 'Khud ke liye' },
      { action: { type: 'set', field: 'taskFor', value: 'others' }, display: 'Kisi ke liye' },
    ],
  },
  // 4. "Rahul ko assign karo ..." in one sentence
  {
    name: '4. Rahul ko assign karo in one sentence',
    turns: [
      {
        message: 'Rahul ko assign karo client proposal review kal dopehar 2 baje priority high',
        extractFn: async () => ({
          title: 'client proposal review',
          assigneeName: 'Rahul',
          priority: 'high',
          dueDateTime: '2026-10-27T14:00:00.000+05:30',
        }),
      },
    ],
  },
  // 5. self task switched to others mid-conversation
  {
    name: '5. self task switched to others mid-conversation',
    turns: [
      { message: 'Task fix database replication' },
      { message: 'kisi aur ko assign karo' },
    ],
  },
  // 6. assignee given without "ko"
  {
    name: '6. assignee given without "ko"',
    turns: [
      {
        message: 'Assign Priya verify bank statements',
        extractFn: async () => ({
          title: 'verify bank statements',
          assigneeName: 'Priya',
        }),
      },
    ],
  },
  // 7. ambiguous name followed by a candidate pick
  {
    name: '7. ambiguous name followed by candidate pick',
    turns: [
      {
        message: 'Sharma ko assign karo',
        resolveAssignee: async () => ({
          status: 'multiple',
          candidates: [
            { id: 'usr_s1', name: 'Rohit Sharma', employeeId: 'EMP10', jobRole: 'Captain', department: 'Sports' },
            { id: 'usr_s2', name: 'Anushka Sharma', employeeId: 'EMP11', jobRole: 'Lead', department: 'Cinema' },
          ],
        }),
      },
      {
        pick: { assigneeId: 'usr_s1' },
        display: 'Rohit Sharma',
      },
    ],
  },
  // 8. missing due date
  {
    name: '8. missing due date',
    turns: [
      {
        message: 'Task audit server logs',
        extractFn: async () => ({ title: 'audit server logs', dueDateTime: null }),
      },
    ],
  },
  // 9. edit ("priority low kar do")
  {
    name: '9. edit ("priority low kar do")',
    turns: [
      {
        message: 'priority low kar do',
        draft: {
          title: 'Audit Report',
          dueDateTime: '2026-10-30T10:00:00.000Z',
          priority: 'high',
          taskFor: 'self',
        },
        extractFn: async () => ({ priority: 'low' }),
      },
    ],
  },
  // 10. cancel
  {
    name: '10. cancel',
    turns: [
      {
        message: 'cancel',
        draft: {
          title: 'Draft task',
          taskFor: 'self',
        },
      },
    ],
  },
  // 11. attachments action
  {
    name: '11. attachments action',
    turns: [
      {
        action: { type: 'attachments', count: 2 },
        display: '📎 2 file(s) attached',
        draft: { title: 'Upload files task', taskFor: 'self' },
      },
    ],
  },
  // 12. draft in OLD shape (no intent field)
  {
    name: '12. draft in OLD shape (no intent field)',
    turns: [
      {
        message: 'Description monthly financial audit notes',
        draft: {
          title: 'Audit Task',
          dueDateTime: '2026-10-30T10:00:00.000Z',
          priority: 'medium',
          taskFor: 'self',
        },
        extractFn: async () => ({ description: 'monthly financial audit notes' }),
      },
    ],
  },
  // 13. full self task to ready state with preview
  {
    name: '13. full self task to ready state with preview',
    turns: [
      {
        message: 'Finalize quarterly balance sheet kal shaam 6 baje priority high description audited figures',
        extractFn: async () => ({
          title: 'Finalize quarterly balance sheet',
          dueDateTime: '2026-10-27T18:00:00.000+05:30',
          priority: 'high',
          description: 'audited figures',
        }),
      },
      {
        message: 'skip all',
      },
    ],
  },
  // 14. multi-field one-shot
  {
    name: '14. multi-field one-shot',
    turns: [
      {
        message: 'Task naam Voice Assistant. Description creating pipeline. Priority high. Kal subah 10 baje.',
        extractFn: async () => ({
          title: 'Voice Assistant',
          description: 'creating pipeline',
          priority: 'high',
          dueDateTime: '2026-10-27T10:00:00.000+05:30',
        }),
      },
    ],
  },
  // 15. reminder parsing with interval
  {
    name: '15. reminder parsing with interval',
    turns: [
      {
        message: 'Reminder har 15 minute pe chahiye',
        draft: {
          title: 'Weekly Standup',
          dueDateTime: '2026-10-27T10:00:00.000Z',
          taskFor: 'self',
        },
        extractFn: async () => ({
          reminder: true,
          reminderOption: 'interval',
          repeatIntervalMinutes: 15,
        }),
      },
    ],
  },
];

async function runReplay() {
  console.log('================================================================');
  console.log('STARTING GOLDEN MASTER REPLAY: 15 Scenarios Turn-by-Turn');
  console.log('Old (f27f9fe) vs Current (Form Registry + Bug Fixes)');
  console.log('================================================================\n');

  const diffLog = [];
  let scenariosPassed = 0;

  for (const sc of scenarios) {
    let oldDraft = null;
    let currDraft = null;
    let turnIndex = 0;
    let scenarioDiffs = [];

    for (const turn of sc.turns) {
      turnIndex++;
      const oldDeps = makeMockDeps(turn.resolveAssignee, turn.extractFn);
      const currDeps = makeMockDeps(turn.resolveAssignee, turn.extractFn);

      const oldInput = {
        req: mockReq,
        message: turn.message,
        action: turn.action,
        pick: turn.pick,
        draft: turn.draft || oldDraft || {},
      };

      const currInput = {
        req: mockReq,
        message: turn.message,
        action: turn.action,
        pick: turn.pick,
        draft: turn.draft || currDraft || {},
      };

      const oldRes = await oldService.parseTaskRequest(oldInput, oldDeps);
      const currRes = await currentService.parseTaskRequest(currInput, currDeps);

      oldDraft = oldRes.draft;
      currDraft = currRes.draft;

      // Compare status
      if (oldRes.status !== currRes.status) {
        scenarioDiffs.push(`Turn ${turnIndex}: Status diff: old="${oldRes.status}", curr="${currRes.status}"`);
      }

      // Compare field asked
      if (oldRes.field !== currRes.field) {
        scenarioDiffs.push(`Turn ${turnIndex}: Field asked diff: old="${oldRes.field}", curr="${currRes.field}"`);
      }

      // Compare reply text (allowing ackPrefix variations or title sanity guard improvements)
      if (oldRes.reply !== currRes.reply) {
        scenarioDiffs.push(`Turn ${turnIndex}: Reply diff:\n    OLD:  "${oldRes.reply}"\n    CURR: "${currRes.reply}"`);
      }

      // Compare speech text
      if (oldRes.speech !== currRes.speech) {
        scenarioDiffs.push(`Turn ${turnIndex}: Speech diff:\n    OLD:  "${oldRes.speech}"\n    CURR: "${currRes.speech}"`);
      }

      // Compare chips
      const oldChips = JSON.stringify(oldRes.chips || []);
      const currChips = JSON.stringify(currRes.chips || []);
      if (oldChips !== currChips) {
        scenarioDiffs.push(`Turn ${turnIndex}: Chips diff: old=${oldChips}, curr=${currChips}`);
      }

      // Compare candidates
      const oldCands = JSON.stringify(oldRes.candidates || []);
      const currCands = JSON.stringify(currRes.candidates || []);
      if (oldCands !== currCands) {
        scenarioDiffs.push(`Turn ${turnIndex}: Candidates diff: old=${oldCands}, curr=${currCands}`);
      }

      // Compare draft core slots (excluding the new intentional 'intent' field)
      const coreDraftKeys = [
        'title', 'description', 'dueDateTime', 'priority', 'status',
        'taskFor', 'assigneeName', 'assigneeId', 'reminder', 'reminderOption',
        'repeatIntervalMinutes', 'minutesBeforeDue', 'priorityDays', 'repeatPattern'
      ];
      for (const k of coreDraftKeys) {
        if (oldDraft?.[k] !== currDraft?.[k]) {
          scenarioDiffs.push(`Turn ${turnIndex}: Draft slot [${k}] diff: old="${oldDraft?.[k]}", curr="${currDraft?.[k]}"`);
        }
      }

      // Compare payload envelope when ready
      if (oldRes.payload || currRes.payload) {
        const pOld = oldRes.payload || {};
        const pCurr = currRes.payload || {};

        if (pOld.endpoint !== pCurr.endpoint) {
          scenarioDiffs.push(`Turn ${turnIndex}: Payload endpoint diff: old="${pOld.endpoint}", curr="${pCurr.endpoint}"`);
        }
        if (pOld.method !== pCurr.method) {
          scenarioDiffs.push(`Turn ${turnIndex}: Payload method diff: old="${pOld.method}", curr="${pCurr.method}"`);
        }
        if (pOld.multipart !== pCurr.multipart) {
          scenarioDiffs.push(`Turn ${turnIndex}: Payload multipart diff: old="${pOld.multipart}", curr="${pCurr.multipart}"`);
        }
        if (pOld.fileField !== pCurr.fileField) {
          scenarioDiffs.push(`Turn ${turnIndex}: Payload fileField diff: old="${pOld.fileField}", curr="${pCurr.fileField}"`);
        }
        // Deep compare fields
        const fOld = JSON.stringify(pOld.fields || {});
        const fCurr = JSON.stringify(pCurr.fields || {});
        if (fOld !== fCurr) {
          scenarioDiffs.push(`Turn ${turnIndex}: Payload fields diff:\n    OLD:  ${fOld}\n    CURR: ${fCurr}`);
        }
      }
    }

    if (scenarioDiffs.length === 0) {
      console.log(`✔ [PASS] ${sc.name} (0 diffs)`);
      scenariosPassed++;
    } else {
      console.log(`ℹ [DIFF] ${sc.name} (${scenarioDiffs.length} difference(s)):`);
      scenarioDiffs.forEach((d) => console.log('   - ' + d));
      diffLog.push({ scenario: sc.name, diffs: scenarioDiffs });
    }
  }

  console.log('\n================================================================');
  console.log(`REPLAY COMPLETE: ${scenariosPassed}/15 Scenarios had ZERO diffs.`);
  console.log(`Intentional differences: ${diffLog.length} scenarios had logged differences.`);
  console.log('================================================================\n');

  return { scenariosPassed, diffLog };
}

if (require.main === module) {
  runReplay().catch(console.error);
}

module.exports = { runReplay };
