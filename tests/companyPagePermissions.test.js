const assert = require('node:assert/strict');
const test = require('node:test');
const Company = require('../models/Company');
const Plan = require('../models/Plan');
const PagePermission = require('../models/PagePermission');
const notificationService = require('../HR-CDS/utils/systemNotificationService');
notificationService.notifyDirectUsers = async () => ({});
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

test('company access override and plan-included operational pages appear in Page Management catalog', async t => {
  invalidateCache('pagePermissions');
  const adminActorId = '507f1f77bcf86cd799439099';
  t.mock.method(Company, 'findById', () => query({
    selectedPlan: '507f1f77bcf86cd799439016',
    accessUpdatedBy: adminActorId,
    allowedPages: ['emp-details', 'client-plans', 'create-alert', 'adminproject', 'company-all-task']
  }));
  t.mock.method(Plan, 'findById', () => query({ allowedPages: ['emp-details'] }));
  t.mock.method(PagePermission, 'find', () => query([]));

  const req = { user: editor, query: { includeAccess: 'true' } };
  const { status, body } = await http('/pages', 'get', req);
  assert.equal(status, 200);
  const keys = body.pages.map(record => record.pageKey);
  assert.deepEqual(keys, ['emp-details', 'company-all-task', 'company-all-task-tasks', 'client-plans', 'adminproject', 'create-alert']);
  assert.equal(body.managedPages.find(record => record.pageKey === 'client-plans').requiresExplicitGrant, true);
  assert.equal(body.managedPages.find(record => record.pageKey === 'create-alert').requiresExplicitGrant, false);
});

test('assigning edit/approve/delete permission automatically grants viewUsers and view scope', async t => {
  invalidateCache('pagePermissions');
  const User = require('../models/User');
  const Client = require('../HR-CDS/models/Client');
  const branchId = '507f1f77bcf86cd799439051';
  const ownerUser = { company: companyId, _id: staffId, companyRole: 'Owner' };

  t.mock.method(Company, 'findById', () => query({
    allowedPages: ['emp-details']
  }));
  t.mock.method(Client, 'find', () => ({ distinct: async () => [] }));
  t.mock.method(User, 'find', () => ({ select: async () => [{ _id: viewerId }] }));

  let savedUpdate = null;
  t.mock.method(PagePermission, 'findOneAndUpdate', (_filter, update) => {
    savedUpdate = update;
    const populated = {
      ...update,
      populate() { return this; },
      then(resolve) { return resolve(update); }
    };
    return populated;
  });

  const req = {
    user: ownerUser,
    params: { pageKey: 'emp-details' },
    body: {
      viewUserIds: [],
      editUserIds: [viewerId],
      deleteUserIds: [],
      approverIds: [],
      userAccessScopes: [{ user: viewerId, accessType: 'edit', branchIds: [branchId], departmentIds: [] }]
    }
  };
  const { status, body } = await http('/:pageKey', 'put', req);
  assert.equal(status, 200);
  assert.deepEqual(savedUpdate.viewUsers.map(entry => String(entry.user)), [viewerId]);
  assert.ok(savedUpdate.userAccessScopes.some(scope => scope.accessType === 'view' && String(scope.user) === viewerId && scope.branchIds.includes(branchId)));
  assert.deepEqual(body.page.viewUsers, [viewerId]);
  assert.deepEqual(body.page.editUsers, [viewerId]);
});

test('the 11 designated pages grant automatic full permissions to assigned users without breaking plan or strict pages', async t => {
  invalidateCache('pagePermissions');
  const SidebarConfig = require('../models/SidebarConfig');
  const { invalidateSidebarCache } = require('../routes/sidebarConfigs');
  invalidateSidebarCache();

  const fullKeys = [
    'register-request',
    'company-all-task-tasks',
    'user-dashboard',
    'attendance',
    'my-leaves',
    'my-assets',
    'profile',
    'change-password',
    'create-user',
    'alert',
    'chat',
  ];

  t.mock.method(Company, 'findById', () => query({
    accessUpdatedBy: staffId,
    allowedPages: [
      'register-request', 'company-all-task', 'user-dashboard', 'attendance',
      'my-leaves', 'my-assets', 'profile', 'change-password', 'create-user',
      'alert', 'chat', 'emp-details'
    ]
  }));
  t.mock.method(Plan, 'findById', () => query({ allowedPages: ['user-dashboard'] }));
  t.mock.method(PagePermission, 'find', filter => {
    const paths = filter?.path?.$in;
    if (!paths || paths.includes('/ciisUser/company-all-task/tasks')) {
      return query([{ path: '/ciisUser/company-all-task/tasks', pageKey: 'company-all-task-tasks', viewUsers: [{ user: viewerId }] }]);
    }
    return query([]);
  });
  t.mock.method(PagePermission, 'findOne', () => query(null));
  t.mock.method(SidebarConfig, 'findOne', () => query({
    menuItems: [
      { id: 'register-request', path: '/ciisUser/register-request' },
      { id: 'create-user', path: '/ciisUser/create-user' }
    ]
  }));

  const staffUser = { company: companyId, _id: viewerId, companyRole: 'employee', department: secondCompanyId, jobRole: 'Staff' };
  const req = { user: staffUser, query: { includeAccess: 'true' } };
  const { status, body } = await http('/pages', 'get', req);
  assert.equal(status, 200);
  for (const key of fullKeys) {
    const managed = body.managedPages.find(record => record.pageKey === key);
    assert.ok(managed, `missing managed page ${key}`);
    assert.equal(managed.entitled, true);
    assert.equal(managed.requiresExplicitGrant, false);
    assert.equal(managed.autoFullAccess, true);
    assert.equal(managed.hasAutoFullAccess, true);
  }

  assert.equal(await hasPageAccess(staffUser, { paths: ['/ciisUser/company-all-task/tasks'], action: 'edit' }), true);
  assert.equal(await hasPageAccess(staffUser, { paths: ['/ciisUser/company-all-task/tasks'], action: 'delete' }), true);
  assert.equal(await hasPageAccess(staffUser, { paths: ['/ciisUser/create-user'], action: 'edit' }), true);
  assert.equal(await hasPageAccess(staffUser, { paths: ['/ciisUser/attendance'], action: 'delete' }), true);
  assert.equal(await hasPageAccess(staffUser, { paths: ['/ciisUser/emp-details'], action: 'view' }), false);
  assert.equal(await hasPageAccess(staffUser, { paths: ['/ciisUser/holiday'], action: 'view' }), false);
});
