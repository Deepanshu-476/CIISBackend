const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mongoose = require('mongoose');
const company = '507f1f77bcf86cd799439010', user = '507f1f77bcf86cd799439011', leadId = '507f1f77bcf86cd799439012';
function fixture() {
  let lead = { _id: leadId, company, assignedTo: user, status: 'new', __v: 0, callHistory: [] };
  const query = value => ({ populate() { return this; }, sort() { return this; }, lean: async () => structuredClone(value) });
  const matches = filter => filter._id === lead._id && filter.company === lead.company && filter.assignedTo === lead.assignedTo;
  const Lead = {
    find: filter => query(filter.company === lead.company && filter.assignedTo === lead.assignedTo ? [lead] : []),
    findOne: filter => query(matches(filter) ? lead : null),
    findOneAndUpdate(filter, mutation) {
      if (!matches(filter) || filter.__v !== lead.__v || filter.status !== lead.status || lead.callHistory.some(call => call.id === filter['callHistory.id'].$ne)) return query(null);
      lead.callHistory.push(mutation.$push.callHistory);
      Object.assign(lead, mutation.$set || {});
      lead.__v += mutation.$inc.__v;
      return query(lead);
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/telecallerController'), 'utf8'), { module, exports: module.exports, require: name => name === 'mongoose' ? mongoose : Lead, Date });
  const req = { telecallerCompany: company, user: { _id: user, name: 'Agent' }, params: { id: leadId }, body: { id: 'call-test-0001', outcome: 'Interested', notes: 'Discussed course' } };
  async function invoke(action = 'save', request = req) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
    await module.exports[action](request, res, error => { throw error; });
    return res;
  }
  return { req, invoke, getLead: () => lead };
}
test('assigned leads and saves are isolated by company and authenticated assignee', async () => {
  const f = fixture();
  assert.equal((await f.invoke('list')).data.items.length, 1);
  for (const request of [{ ...f.req, telecallerCompany: user }, { ...f.req, user: { _id: company } }]) {
    assert.equal((await f.invoke('list', request)).data.items.length, 0);
    assert.equal((await f.invoke('save', request)).statusCode, 404);
  }
  assert.equal(f.getLead().callHistory.length, 0);
});
test('outcomes persist lead status, server identity/time, and retries cannot duplicate history', async () => {
  const f = fixture();
  f.req.body.createdByName = 'Spoofed'; f.req.body.date = '2000-01-01';
  const saved = await f.invoke();
  assert.equal(saved.data.item.status, 'interested');
  assert.equal(f.getLead().callHistory[0].createdByName, 'Agent');
  assert.ok(f.getLead().callHistory[0].date > new Date('2025-01-01'));
  await f.invoke(); assert.equal(f.getLead().callHistory.length, 1);
});
test('callbacks require future time, notes preserve follow-up, and closing clears it', async () => {
  const f = fixture(); f.req.body.outcome = 'Need Callback';
  assert.equal((await f.invoke()).statusCode, 400);
  f.req.body.followUp = '2000-01-01'; assert.equal((await f.invoke()).statusCode, 400);
  f.req.body.followUp = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await f.invoke()).statusCode, 200);
  assert.equal(f.getLead().status, 'follow-up');
  const scheduled = f.getLead().nextFollowUp.getTime();
  f.req.body = { id: 'note-test-0001', outcome: 'Note Added', notes: 'Brochure sent' };
  await f.invoke(); assert.equal(f.getLead().nextFollowUp.getTime(), scheduled);
  assert.equal(f.getLead().status, 'follow-up');
  f.req.body = { id: 'call-test-0002', outcome: 'Call Closed' };
  await f.invoke(); assert.equal(f.getLead().status, 'closed'); assert.equal(f.getLead().nextFollowUp, null);
  await f.invoke(); assert.equal(f.getLead().callHistory.length, 3);
  f.req.body = { id: 'call-test-0003', outcome: 'Connected' };
  assert.equal((await f.invoke()).statusCode, 409);
});
test('conversion and not-interested transitions are supported; malformed inputs are rejected', async () => {
  const f = fixture(); f.req.body.outcome = 'Not Interested';
  await f.invoke(); assert.equal(f.getLead().status, 'not interested');
  f.req.body = { id: 'call-test-0002', outcome: 'Converted', followUp: 'invalid' };
  await f.invoke(); assert.equal(f.getLead().status, 'converted'); assert.equal(f.getLead().nextFollowUp, null);
  const g = fixture();
  for (const body of [{ id: 'x', outcome: 'Connected' }, { id: 'call-test-0001', outcome: 'Fake' }, { id: 'call-test-0001', outcome: 'Connected', notes: {} }]) {
    g.req.body = body; assert.equal((await g.invoke()).statusCode, 400);
  }
});

test('simultaneous saves cannot silently overwrite each other', async () => {
  const f = fixture();
  const responses = await Promise.all([
    f.invoke('save', { ...f.req, body: { id: 'parallel-call-01', outcome: 'Connected' } }),
    f.invoke('save', { ...f.req, body: { id: 'parallel-call-02', outcome: 'Connected' } }),
  ]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(f.getLead().callHistory.length, 1);
});
