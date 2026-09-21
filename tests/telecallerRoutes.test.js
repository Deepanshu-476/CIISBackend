const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

async function fixture(t) {
  const company = '507f1f77bcf86cd799439010', user = '507f1f77bcf86cd799439011';
  const state = { allowedPages: ['admin-telecaller-call-workspace'], exists: true, hits: 0 };
  const respond = (req, res) => { state.hits++; res.json({ company: req.telecallerCompany }); };
  const overrides = {
    '../models/Company': { findById(id) {
      assert.equal(id, company);
      return { select: () => ({ lean: async () => state.exists ? { allowedPages: state.allowedPages } : null }) };
    } },
    '../middleware/authMiddleware': { protect(req, res, next) {
      if (!req.headers.authorization) return res.status(401).end();
      req.user = { _id: user, company }; next();
    } },
    '../controllers/telecallerController': { list: respond, getOne: respond, save: respond },
  };
  const filename = require.resolve('../routes/telecallerRoutes');
  const localRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: name => overrides[name] || localRequire(name) }, { filename });
  const app = express(); app.use(express.json()); app.use('/telecaller', module.exports);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = (path = '', outcome, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}/telecaller${path}`, {
    method: outcome ? 'POST' : 'GET',
    headers: { ...(authenticated ? { authorization: 'fixture' } : {}), 'content-type': 'application/json' },
    ...(outcome ? { body: JSON.stringify({ outcome }) } : {}),
  });
  return { state, request };
}

test('all telecaller endpoints require authentication and an enabled company page', async t => {
  const { state, request } = await fixture(t);
  for (const [path, outcome] of [[''], ['/lead'], ['/lead/calls', 'Interested']]) {
    assert.equal((await request(path, outcome, false)).status, 401);
    for (const allowed of [[], ['admin-crm-all-leads'], ['admin-telecaller-invented']]) {
      state.allowedPages = allowed;
      assert.equal((await request(path, outcome)).status, 403);
    }
    state.exists = false; state.allowedPages = ['admin-telecaller-call-workspace'];
    assert.equal((await request(path, outcome)).status, 403);
    state.exists = true;
  }
  assert.equal(state.hits, 0);
});

test('company page aliases grant dataset access; call outcomes require workspace while notes allow detail', async t => {
  const { state, request } = await fixture(t);
  for (const key of ['admin-telecaller-call-workspace', '/ciisUser/telecaller/call-workspace', 'telecaller/call-workspace']) {
    state.allowedPages = [key];
    assert.equal((await request()).status, 200);
    assert.equal((await request('/lead')).status, 200);
    assert.equal((await request('/lead/calls', 'Interested')).status, 200);
    assert.equal((await request('/lead/calls', 'Note Added')).status, 200);
  }
  state.allowedPages = ['admin-telecaller-call-dashboard'];
  assert.equal((await request()).status, 200);
  assert.equal((await request('/lead/calls', 'Interested')).status, 403);
  assert.equal((await request('/lead/calls', 'Note Added')).status, 403);
  state.allowedPages = ['admin-telecaller-lead-detail'];
  assert.equal((await request('/lead')).status, 200);
  assert.equal((await request('/lead/calls', 'Note Added')).status, 200);
  assert.equal((await request('/lead/calls', 'Converted')).status, 403);
});
