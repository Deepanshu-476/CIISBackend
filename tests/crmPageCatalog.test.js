const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = require('../utils/crmPermissionPages');

function loadRoute(allowedPages) {
  const handlers = new Map();
  const router = { use() {}, get(path, handler) { handlers.set(path, handler); }, post() {}, put() {}, delete() {} };
  const source = fs.readFileSync(require.resolve('../routes/pagePermissions'), 'utf8');
  const chain = value => ({ select() { return this; }, lean: async () => value });
  vm.runInNewContext(source, {
    module: { exports: {} }, process: { env: {} }, console,
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../utils/crmPermissionPages') return catalog;
      if (name === '../models/Company') return { findById: () => chain({ allowedPages }) };
      if (name === '../models/PagePermission') return { find: () => chain(catalog.map(p => ({ ...p, viewUsers: [{ user: 'aman' }] }))) };
      if (name === '../utils/inMemoryCache') return { getCacheKey: () => '', getOrSetCached: (_key, load) => load() };
      return {};
    },
  });
  return handlers.get('/pages');
}

test('page-list API exposes active CRM pages and excludes removed Marketing and Team & Access pages', async () => {
  let body;
  await loadRoute(catalog.map(p => p.pageKey))({ user: { company: 'company' } }, { json(value) { body = value; } });
  assert.equal(body.success, true);
  assert.equal(body.pages.length, 29);
  assert.equal(new Set(body.pages.map(p => p.path)).size, 29);
  assert.equal(body.pages.some(p => p.path.includes('/crm/marketing/')), false);
  assert.equal(body.pages.filter(p => p.path.includes('/crm/reports/')).length, 8);
  for (const removed of ['admin-crm-team-overview', 'admin-crm-users', 'admin-crm-add-user', 'admin-crm-user-types']) {
    assert.equal(body.pages.some(p => p.pageKey === removed), false, removed);
  }
  for (const slug of ['call-overview', 'assigned-calls', 'todays-calls', 'pending-calls', 'scheduled-calls', 'completed-calls', 'converted-calls', 'transferred-calls', 'call-history']) {
    const page = body.pages.find(p => p.pageKey === `admin-crm-${slug}`);
    assert.equal(page?.viewCount, 1, slug);
  }
});

test('page-list API still excludes pages disabled for the company', async () => {
  let body;
  await loadRoute(['admin-crm-dashboard'])({ user: { company: 'company' } }, { json(value) { body = value; } });
  assert.equal(body.pages.length, 1);
  assert.equal(body.pages[0].pageKey, 'admin-crm-dashboard');
});
