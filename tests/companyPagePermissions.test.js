const assert = require('node:assert/strict');
const test = require('node:test');
const Company = require('../models/Company');
const Plan = require('../models/Plan');
const PagePermission = require('../models/PagePermission');
const permissionRoutes = require('../routes/pagePermissions');
const { hasPageAccess } = require('../middleware/pageAccess');
const { isPageEntitled } = require('../utils/companyPageEntitlements');
const { invalidateCache } = require('../utils/inMemoryCache');

const query = data => ({ select() { return this; }, lean: async () => data });
const companyId = '507f1f77bcf86cd799439011';
const secondCompanyId = '507f1f77bcf86cd799439012';
const staffId = '507f1f77bcf86cd799439013';
const viewerId = '507f1f77bcf86cd799439014';
const editor = { company: companyId, _id: staffId, companyRole: 'admin' };
const page = { path: '/ciisUser/emp-details', pageKey: 'emp-details', editUsers: [{ user: staffId }], viewUsers: [{ user: viewerId }] };

const http = async (path, method, req) => {
  const route = permissionRoutes.stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
  assert.ok(route);
  let status = 200;
  let body;
  const res = { status(code) { status = code; return this; }, json(value) { body = value; return this; } };
  await route.route.stack.at(-1).handle(req, res);
  return { status, body };
};

const fixtures = t => {
  invalidateCache('pagePermissions');
  t.mock.method(Company, 'findById', id => query(String(id) === companyId
    ? { selectedPlan: '507f1f77bcf86cd799439016', allowedPages: ['employee-details', 'emp-leaves', 'department'] }
    : { allowedPages: ['department'] }));
  t.mock.method(Plan, 'findById', () => query({ allowedPages: ['/Ciis-network/emp-details', 'emp-leaves', 'holiday'] }));
  t.mock.method(PagePermission, 'find', filter => query(String(filter.company) === companyId &&
    (!filter.path || filter.path.$in.includes(page.path)) ? [page] : []));
};

test('catalog and write endpoint honor both plan and company access', async t => {
  fixtures(t);
  const req = { user: editor, query: { includeAccess: 'true' } };
  const { status, body } = await http('/pages', 'get', req);
  assert.equal(status, 200);
  assert.deepEqual(body.pages.map(record => record.pageKey), ['emp-details', 'emp-leaves']);
  assert.deepEqual(body.accessPages.map(record => record.pageKey), ['emp-details', 'emp-leaves']);
  const detail = body.accessPages[0];
  assert.deepEqual(detail.explicitViewUsers, [viewerId]);
  assert.deepEqual(detail.viewUsers, [viewerId, staffId]);
  assert.equal(body.managedPages.find(record => record.pageKey === 'holiday').entitled, false);
  const registerPage = body.managedPages.find(record => record.pageKey === 'register-request');
  assert.equal(registerPage.entitled, false);
  assert.equal(registerPage.canManageRegistrationRequests, true);
  const staffCatalog = await http('/pages', 'get', { ...req, user: { ...editor, companyRole: 'employee' } });
  assert.equal(staffCatalog.body.managedPages.find(record => record.pageKey === 'register-request').canManageRegistrationRequests, undefined);
  assert.equal((await http('/by-path', 'get', { ...req, query: { path: '/ciisUser/holiday' } })).body.page.entitled, false);
  assert.equal((await http('/:pageKey', 'put', { ...req, params: { pageKey: 'department' }, body: {} })).status, 403);
});

test('staff grants apply to the granted action and tenant only', async t => {
  fixtures(t);
  const paths = [page.path];
  assert.equal(await hasPageAccess(editor, { paths, action: 'edit' }), true);
  assert.equal(await hasPageAccess(editor, { paths, action: 'view' }), true);
  assert.equal(await hasPageAccess(editor, { paths, action: 'delete' }), false);
  assert.equal(await hasPageAccess(editor, { paths, action: 'approve' }), false);
  assert.equal(await hasPageAccess({ ...editor, _id: viewerId }, { paths, action: 'edit' }), false);
  assert.equal(await hasPageAccess({ ...editor, company: secondCompanyId }, { paths, action: 'edit' }), false);
  assert.equal(await hasPageAccess({ ...editor, companyRole: 'owner' }, { paths: ['/ciisUser/holiday'], action: 'edit' }), false);
  PagePermission.find.mock.mockImplementation(() => query([{ ...page, editUsers: [] }]));
  assert.equal(await hasPageAccess(editor, { paths, action: 'view' }), false);
  assert.equal(await hasPageAccess(editor, { paths, action: 'edit' }), false);
});

test('individual CRM plan keys match their canonical API paths', () => {
  const access = { plan: new Set(['admin-crm-lead-overview']), company: new Set(['crm']) };
  assert.equal(isPageEntitled(access, { path: '/ciisUser/crm/admin/lead-overview' }), true);
  assert.equal(isPageEntitled(access, { path: '/ciisUser/crm/admin/all-leads' }), false);
});
