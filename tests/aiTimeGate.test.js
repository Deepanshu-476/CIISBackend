const test = require('node:test');
const assert = require('node:assert/strict');
const aiTimeGate = require('../middleware/aiTimeGate');

process.env.AI_TIME_GATE_ENABLED = 'true';
delete process.env.AI_TIME_GATE_START;
delete process.env.AI_TIME_GATE_END;

function run(role, nowIstMinutes) {
    const req = { user: { companyRole: role }, _deps: { nowIstMinutes } };
    const out = { status: null, body: null, nexted: false };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    aiTimeGate(req, res, () => { out.nexted = true; });
    return out;
}

test('employee blocked before 5 PM', () => assert.equal(run('employee', 16 * 60 + 59).status, 403));
test('employee allowed at 5:00 PM', () => assert.equal(run('employee', 17 * 60).nexted, true));
test('employee allowed at 6:59 PM', () => assert.equal(run('employee', 18 * 60 + 59).nexted, true));
test('employee blocked at 7:00 PM', () => assert.equal(run('employee', 19 * 60).body.code, 'AI_TIME_GATED'));
test('Owner allowed at 3 AM', () => assert.equal(run('Owner', 3 * 60).nexted, true));
test('Admin allowed at noon', () => assert.equal(run('Admin', 12 * 60).nexted, true));