const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { TASK_FIELDS } = require('../services/ai/taskFields');
const { parseTaskRequest } = require('../services/ai/taskAgentService');

describe('Task Templates speakText & speakTextHi contract', () => {
  test('Every fixed field in TASK_FIELDS has speakText and speakTextHi, neither is empty', () => {
    const fields = Object.keys(TASK_FIELDS);
    assert.ok(fields.length > 5, 'Should have multiple fields configured');

    for (const key of fields) {
      const f = TASK_FIELDS[key];
      if (f.question) {
        assert.ok(f.question.speakText, `Field ${key} question missing speakText`);
        assert.ok(typeof f.question.speakText === 'string' && f.question.speakText.trim().length > 0, `Field ${key} question.speakText must be non-empty string`);
        assert.ok(f.question.speakTextHi, `Field ${key} question missing speakTextHi`);
        assert.ok(typeof f.question.speakTextHi === 'string' && f.question.speakTextHi.trim().length > 0, `Field ${key} question.speakTextHi must be non-empty string`);
      }
      if (f.reAskQuestion) {
        assert.ok(f.reAskQuestion.speakText, `Field ${key} reAskQuestion missing speakText`);
        assert.ok(typeof f.reAskQuestion.speakText === 'string' && f.reAskQuestion.speakText.trim().length > 0, `Field ${key} reAskQuestion.speakText must be non-empty string`);
        assert.ok(f.reAskQuestion.speakTextHi, `Field ${key} reAskQuestion missing speakTextHi`);
        assert.ok(typeof f.reAskQuestion.speakTextHi === 'string' && f.reAskQuestion.speakTextHi.trim().length > 0, `Field ${key} reAskQuestion.speakTextHi must be non-empty string`);
      }
    }
  });

  test('English technical words in speakTextHi remain in Latin script', () => {
    // Technical words: Project, Task, Description, Priority, Email, Client, Due date
    for (const key of Object.keys(TASK_FIELDS)) {
      const q = TASK_FIELDS[key].question;
      if (!q) continue;
      const hi = q.speakTextHi;
      // Must not contain Devanagari versions of technical words when technical words are used
      assert.ok(!/\bटास्क\b/.test(hi), `Field ${key} speakTextHi should have Latin 'Task' not Devanagari`);
      assert.ok(!/\bप्रोजेक्ट\b/.test(hi), `Field ${key} speakTextHi should have Latin 'Project' not Devanagari`);
      assert.ok(!/\bडिस्क्रिप्शन\b/.test(hi) && !/\bविवरण\b/.test(hi), `Field ${key} speakTextHi should have Latin 'Description'`);
      assert.ok(!/\bप्रायोरिटी\b/.test(hi) && !/\bप्राथमिकता\b/.test(hi), `Field ${key} speakTextHi should have Latin 'Priority'`);
    }
  });

  test('parseTaskRequest returns both speakText and speakTextHi across flow turns', async () => {
    const compId = '698b1b812a6d09e3520f8426';
    const req = { user: { _id: '6a82d9521e4b12ff3b1e7363', companyRole: 'admin', company: compId } };
    const scope = {
      getScopeInfo: async () => ({ userCompany: compId, isPrivileged: true }),
      resolveAssignee: async () => ({ status: 'resolved', matches: [{ _id: '6a82d9521e4b12ff3b1e7364', name: 'Kanika' }] }),
      isAssigneeInScope: async () => true,
      extractFn: async () => ({ client: 'ZZ AI Client', company: 'ZZ Tech', city: 'Mohali', projectManager: ['Kanika'] }),
    };

    const res = await parseTaskRequest({ req, message: 'create a task', draft: null }, scope);
    assert.ok(res.speakText, 'Turn result must have speakText');
    assert.ok(res.speakTextHi, 'Turn result must have speakTextHi');
    assert.ok(typeof res.speakText === 'string' && res.speakText.trim().length > 0);
    assert.ok(typeof res.speakTextHi === 'string' && res.speakTextHi.trim().length > 0);
  });

  test('Client creation flow retains email and contact across multiple turns without asking again', async () => {
    const compId = '698b1b812a6d09e3520f8426';
    const req = { user: { _id: '6a82d9521e4b12ff3b1e7363', companyRole: 'admin', company: compId } };
    const scope = {
      getScopeInfo: async () => ({ userCompany: compId, isPrivileged: true }),
      resolveAssignee: async () => ({ status: 'resolved', matches: [{ _id: '6a82d9521e4b12ff3b1e7364', name: 'Kanika' }] }),
      isAssigneeInScope: async () => true,
    };

    // Step 1: Initial client intent
    let res = await parseTaskRequest({ req, message: 'naya client banao ZZ AI Client, company ZZ Tech, city Mohali, team Kanika', draft: null }, scope);
    assert.equal(res.draft?.client, 'ZZ AI Client');

    // Step 2: Contact group
    res = await parseTaskRequest({ req, action: { type: 'set_details_group', group: 'contact' }, draft: res.draft }, scope);

    // Step 3: Provide email
    res = await parseTaskRequest({ req, message: 'email-abc@gmail.com', draft: res.draft }, scope);
    assert.equal(res.draft?.email, 'email-abc@gmail.com', 'Draft must preserve email');

    // Step 4: Provide phone
    res = await parseTaskRequest({ req, message: 'number - 8569765489', draft: res.draft }, scope);
    assert.equal(res.draft?.email, 'email-abc@gmail.com', 'Draft must retain previously provided email');
    assert.equal(res.draft?.phone, '8569765489', 'Draft must retain newly provided phone');
    // Once both email and phone are provided, it must not ask for email or phone again!
    assert.notEqual(res.draft?.activeGroupField, 'email');
    assert.notEqual(res.draft?.activeGroupField, 'phone');
  });
});

