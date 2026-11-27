const { tokenFor } = require('../auth');
const { is, denied, has, idOf } = require('./helpers');

async function extrasFlow(ctx) {
  const { T, state } = ctx;
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const std = { token: await tokenFor(ctx, 'std'), as: 'std' };
  const e1 = { token: await tokenFor(ctx, 'ontime'), as: 'ontime' };
  const client = state.users.client ? { token: await tokenFor(ctx, 'client'), as: 'client' } : null;
  const stamp = Date.now() % 100000;

  // ---------- Attendance Breaks & Week-Off ----------
  T.setModule('Attendance: Breaks & Week-Off');
  await T.call('Employee breaks today', 'GET', '/api/breaks/today', { ...std, expect: '200' }, is(200));
  await T.call('Admin break settings', 'GET', '/api/breaks/settings', { ...o, expect: '200' }, is(200));
  await T.call('Admin live breaks', 'GET', '/api/breaks/live', { ...o, expect: '200' }, is(200));
  await T.call('Admin break report', 'GET', '/api/breaks/report', { ...o, expect: '200' }, is(200));
  await T.call('Employee cannot open break settings', 'GET', '/api/breaks/settings', { ...std, expect: '403' }, denied);

  await T.call('Employee week-off schedule', 'GET', '/api/week-off/my-schedule', { ...std, expect: '200' }, is(200));
  await T.call('Employee week-off requests', 'GET', '/api/week-off/my-requests', { ...std, expect: '200' }, is(200));
  await T.call('Admin week-off requests', 'GET', '/api/week-off/admin-requests', { ...o, expect: '200' }, is(200));
  await T.call('Admin week-off employees', 'GET', '/api/week-off/employees', { ...o, expect: '200' }, is(200));
  await T.call('Employee cannot open week-off admin', 'GET', '/api/week-off/admin-requests', { ...std, expect: '403' }, denied);

  // ---------- Client Plans, Documents & Promos ----------
  T.setModule('Clients: Plans, Documents & Promos');
  await T.call('List client plans', 'GET', '/api/client-plans', { ...o, expect: '200' }, is(200));
  const planRes = await T.call('Create client plan', 'POST', '/api/client-plans', {
    ...o,
    body: {
      name: `ZZ Plan ${stamp}`,
      description: 'ZZ Lab test plan',
      services: [{ name: 'SEO', quantity: 1 }],
      price: 5000,
    },
    expect: '201',
  }, is(200, 201));
  const planId = idOf(planRes.data, 'plan._id', 'data._id');
  if (planId) {
    await T.call('Update client plan', 'PUT', `/api/client-plans/${planId}`, {
      ...o,
      body: {
        name: `ZZ Plan ${stamp} B`,
        description: 'ZZ Lab test plan updated',
        services: [{ name: 'SEO', quantity: 2 }],
        price: 6000,
      },
      expect: '200',
    }, is(200));
  }
  await T.call('Employee cannot create client plan', 'POST', '/api/client-plans', {
    ...std,
    body: { name: `ZZ Bad Plan ${stamp}`, services: [{ name: 'SEO', quantity: 1 }] },
    expect: '403',
  }, denied);

  await T.call('List client documents (owner)', 'GET', '/api/client-documents', { ...o, expect: '200' }, is(200));
  if (client) {
    await T.call('List client documents (client)', 'GET', '/api/client-documents', { ...client, expect: '200' }, is(200));
  }

  await T.call('Promos public list', 'GET', '/api/promos/public', { token: '', as: 'none', expect: '200' }, is(200));
  await T.call('Promos feed', 'GET', '/api/promos/feed', { ...std, expect: '200' }, is(200));
  await T.call('Promos access check', 'GET', '/api/promos/access', { ...o, expect: '200' }, is(200));

  // ---------- Marketing Ads & Platform Config ----------
  T.setModule('CRM: Marketing Ads & Platform');
  await T.call('Marketing ads accounts', 'GET', '/api/crm/marketing-ads/accounts', { ...o, expect: '200' }, is(200));
  await T.call('Marketing ads assignment options', 'GET', '/api/crm/marketing-ads/assignment-options', { ...o, expect: '200' }, is(200));
  await T.call('Marketing ads logs', 'GET', '/api/crm/marketing-ads/logs', { ...o, expect: '200' }, is(200));
  await T.call('Employee cannot open marketing ads accounts', 'GET', '/api/crm/marketing-ads/accounts', { ...std, expect: '403' }, denied);
  await T.call('Non-platform-owner cannot open marketing ads settings', 'GET', '/api/marketing-ads-settings', { ...o, expect: '403' }, denied);

  // ---------- Chat & Platform Utilities ----------
  T.setModule('Chat & Platform APIs');
  await T.call('Chat company users', 'GET', '/api/chat/users', { ...std, expect: '200' }, is(200));
  await T.call('Chat conversations list', 'GET', '/api/chat/conversations', { ...std, expect: '200' }, is(200));
  await T.call('Chat groups list', 'GET', '/api/chat/groups', { ...std, expect: '200' }, is(200));
  await T.call('Chat call logs', 'GET', '/api/chat/calls', { ...std, expect: '200' }, is(200));
  await T.call('Chat statuses', 'GET', '/api/chat/statuses', { ...std, expect: '200' }, is(200));

  const convRes = await T.call('Start 1:1 chat conversation', 'POST', '/api/chat/conversation', {
    ...std,
    body: { recipientId: state.users.ontime.id, participantId: state.users.ontime.id },
    expect: '200/201',
  }, is(200, 201));
  const convId = idOf(convRes.data, 'conversation._id', 'data._id', '_id');
  if (convId) {
    await T.call('Get conversation messages', 'GET', `/api/chat/messages/${convId}`, { ...e1, expect: '200' }, is(200));
  }

  await T.call('App version endpoint', 'GET', '/api/app-version', { token: '', as: 'none', expect: '200' }, is(200));
  await T.call('Plans list', 'GET', '/api/plans', { ...o, expect: '200' }, is(200));
  await T.call('Sidebar user config', 'GET', '/api/sidebar/user-config', { ...std, expect: '200' }, is(200));
  await T.call('Email settings (owner)', 'GET', '/api/email-settings', { ...o, expect: '200' }, is(200));
  await T.call('Email settings blocked for employee', 'GET', '/api/email-settings', { ...std, expect: '403' }, denied);
  await T.call('Non-superadmin cannot list demo requests', 'GET', '/api/demo-requests', { ...o, expect: '403' }, denied);
}

module.exports = { extrasFlow };
