const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const catalog = require('../utils/crmPermissionPages');

test('batch loads permissions once, preserves effective view and company-specific catalog filtering', async () => {
  const handlers = new Map();
  let reads = 0;
  let companyFilter;
  const chain = value => ({ select() { return this; }, lean: async () => value });
  const context = {
    module: { exports: {} }, process: { env: {} }, console,
    require(name) {
      if (name === 'express') return { Router: () => ({ use() {}, get: (path, handler) => handlers.set(path, handler), put() {} }) };
      if (name === '../utils/crmPermissionPages') return catalog;
      if (name === '../models/Company') return { findById: () => chain({ allowedPages: ['admin-crm-dashboard'] }) };
      if (name === '../models/PagePermission') return { find(filter) {
        reads++; companyFilter = filter.company;
        return chain([{ path: '/ciisUser/crm/admin/dashboard', editUsers: [{ user: 'editor' }], approvers: [{ user: 'approver' }], generateUsers: [{ user: 'generator' }], userAccessScopes: [{ user: 'scoped', accessType: 'view', branchIds: ['branch'] }] }]);
      } };
      if (name === '../utils/inMemoryCache') return { getCacheKey: () => '', getOrSetCached: (_key, load) => load() };
      return {};
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../routes/pagePermissions'), 'utf8'), context);
  let body;
  await handlers.get('/pages')({ user: { company: 'company-a' }, query: { includeAccess: 'true' } }, { json(value) { body = value; } });
  assert.equal(reads, 1);
  assert.equal(companyFilter, 'company-a');
  assert.equal(body.pages.length, 1);
  const page = body.accessPages.find(p => p.path === '/ciisUser/crm/admin/dashboard');
  assert.deepEqual(Array.from(page.viewUsers), ['editor', 'approver']);
  assert.deepEqual(Array.from(page.generateUsers), ['generator']);
  assert.equal(page.userAccessScopes[0].branchIds[0], 'branch');
  const payroll = body.accessPages.find(p => p.path === '/ciisUser/payroll-process');
  assert.ok(payroll);
  assert.equal(payroll.viewUsers.length, 0);
});
