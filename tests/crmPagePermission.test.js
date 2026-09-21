const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const mongoose = require('mongoose');

const company = '507f1f77bcf86cd799439010';
const user = '507f1f77bcf86cd799439011';

const load = pages => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../middleware/crmPagePermission'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === 'mongoose') return mongoose;
      if (name === '../models/PagePermission') return { find: filter => ({
        lean: async () => {
          assert.equal(String(filter.company), company);
          return pages.filter(page => filter.path.$in.includes(page.path));
        }
      }) };
      return {};
    }
  });
  return module.exports.requireCrmPagePermission;
};

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('CRM API permission is fail-closed and grants only explicitly assigned users', async () => {
  const page = { path: '/ciisUser/crm/admin/all-leads', viewUsers: [{ user }], editUsers: [] };
  const requirePermission = load([page]);
  const req = { user: { _id: user, company } }; const res = response(); let allowed = false;
  await requirePermission(page.path)(req, res, () => { allowed = true; });
  assert.equal(allowed, true); assert.equal(req.crmCompany, company);

  allowed = false;
  await requirePermission('/ciisUser/crm/admin/add-lead')(req, res, () => { allowed = true; });
  assert.equal(allowed, false); assert.equal(res.code, 403);

  allowed = false; res.code = 200;
  await requirePermission(page.path, 'edit')(req, res, () => { allowed = true; });
  assert.equal(allowed, false); assert.equal(res.code, 403);
});

test('edit assignment also provides view access', async () => {
  const page = { path: '/ciisUser/crm/admin/assignments', viewUsers: [], editUsers: [{ user }] };
  const req = { user: { _id: user, company } }; const res = response(); let allowed = false;
  await load([page])(page.path)(req, res, () => { allowed = true; });
  assert.equal(allowed, true);
});
