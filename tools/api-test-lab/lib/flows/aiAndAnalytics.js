const { tokenFor } = require('../auth');
const { is, denied, has, idOf } = require('./helpers');

async function aiAndAnalyticsFlow(ctx) {
  const { T, state } = ctx;
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const std = { token: await tokenFor(ctx, 'std'), as: 'std' };
  const client = state.users.client ? { token: await tokenFor(ctx, 'client'), as: 'client' } : null;
  const stamp = Date.now() % 100000;

  // ---------- AI Assistant & Company AI Settings ----------
  T.setModule('AI: Assistant & Company AI settings');
  await T.call('Owner AI task-agent entitlement', 'GET', '/api/ai/task-agent/entitlement', { ...o, expect: '200' }, is(200));
  await T.call('Employee AI task-agent entitlement', 'GET', '/api/ai/task-agent/entitlement', { ...std, expect: '200' }, is(200));

  await T.call('AI task-agent parse (set_intent self_task)', 'POST', '/api/ai/task-agent/parse', {
    ...o,
    body: { action: { type: 'set_intent', intent: 'self_task' }, language: 'en' },
    expect: '200 or 403 (AI plan)',
  }, r => ([200, 403].includes(r.status) ? true : `got ${r.status}`));

  await T.call('AI daily summary', 'GET', '/api/ai/daily-summary', { ...o, expect: '200 or 403/503' },
    r => ([200, 403, 503].includes(r.status) ? true : `got ${r.status}`));
  await T.call('AI executive insights (owner)', 'GET', '/api/ai/executive-insights', { ...o, expect: '200 or 403/503' },
    r => ([200, 403, 503].includes(r.status) ? true : `got ${r.status}`));
  await T.call('Employee cannot read executive insights', 'GET', '/api/ai/executive-insights', { ...std, expect: '403' }, denied);

  await T.call('Employee my-access AI check', 'GET', `/api/company/${state.companyId}/ai-settings/my-access`, { ...std, expect: '200' }, is(200));
  await T.call('Owner AI settings access check', 'GET', `/api/company/${state.companyId}/ai-settings/access`, { ...o, expect: '200' }, is(200));
  await T.call('Owner company AI settings (scoped)', 'GET', `/api/company/${state.companyId}/ai-settings`, { ...o, expect: '200' }, is(200));
  await T.call('Owner company AI settings (current company route)', 'GET', '/api/company/ai-settings', { ...o, expect: '200' }, is(200));
  await T.call('Owner company AI employee quotas', 'GET', `/api/company/${state.companyId}/ai-settings/employees`, { ...o, expect: '200' }, is(200));
  await T.call('Owner company AI usage history', 'GET', `/api/company/${state.companyId}/ai-settings/history`, { ...o, expect: '200' }, is(200));
  await T.call('Employee cannot open company AI settings', 'GET', `/api/company/${state.companyId}/ai-settings`, { ...std, expect: '403' }, denied);
  await T.call('Non-platform-owner cannot open global AI settings', 'GET', '/api/ai-settings', { ...o, expect: '403' }, denied);

  // ---------- MCP API Keys ----------
  T.setModule('AI: MCP API keys');
  await T.call('List MCP keys', 'GET', '/api/mcp/keys', { ...o, expect: '200' }, is(200));
  const keyRes = await T.call('Create MCP API key', 'POST', '/api/mcp/keys', {
    ...o,
    body: { name: `ZZ Lab MCP ${stamp}` },
    expect: '201',
  }, is(200, 201));
  const keyId = idOf(keyRes.data, 'keyInfo.id', 'keyInfo._id', 'data._id');
  if (keyId) {
    await T.call('Delete MCP API key', 'DELETE', `/api/mcp/keys/${keyId}`, { ...o, expect: '200' }, is(200));
  }

  // ---------- Activity & Analytics ----------
  T.setModule('Analytics: Activity & Overviews');
  await T.call('Record web page view (owner)', 'POST', '/api/activity/views', {
    ...o,
    headers: { 'x-client-app': 'web' },
    body: { views: [{ path: '/ciisUser/dashboard-overview', durationMs: 2500 }] },
    expect: '200',
  }, is(200));
  await T.call('Record app page view (employee)', 'POST', '/api/activity/views', {
    ...std,
    headers: { 'x-client-app': 'app' },
    body: { views: [{ path: '/ciisUser/my-tasks', durationMs: 1800 }] },
    expect: '200',
  }, is(200));
  if (client) {
    await T.call('Record client portal view', 'POST', '/api/activity/views', {
      ...client,
      headers: { 'x-client-app': 'web' },
      body: { views: [{ path: '/ciisUser/client-dashboard', durationMs: 1500 }] },
      expect: '200',
    }, is(200));
  }

  await T.call('Activity analytics summary includes all sections', 'GET', '/api/activity/summary', {
    ...o,
    query: { days: 7 },
    expect: '200 with users, modules, departments, branches',
  }, r => {
    if (r.status !== 200) return `got ${r.status}`;
    const d = r.data || {};
    if (!Array.isArray(d.users) || !Array.isArray(d.pages) || !Array.isArray(d.days)) return 'missing users/pages/days';
    if (!Array.isArray(d.modules) || !Array.isArray(d.departments) || !Array.isArray(d.branches)) return 'missing modules/departments/branches analytics';
    return true;
  });
  await T.call('Activity feed (owner)', 'GET', '/api/activity/feed', { ...o, query: { days: 7, limit: 20 }, expect: '200' }, is(200));
  await T.call('Employee without permission cannot read activity summary', 'GET', '/api/activity/summary', { ...std, expect: '403' }, denied);

  await T.call('Dashboard overview configuration (GET)', 'GET', '/api/dashboard-overview/config', { ...o, expect: '200' }, is(200));
  await T.call('Dashboard overview configuration (PUT)', 'PUT', '/api/dashboard-overview/config', {
    ...o,
    body: { sections: {} },
    expect: '200',
  }, r => ([200, 400].includes(r.status) ? true : `got ${r.status}`));
  await T.call('Dashboard overview companies preview list', 'GET', '/api/dashboard-overview/companies', { ...o, expect: '200' }, is(200));

  await T.call('Leave analytics', 'GET', '/api/leaves/analytics', { ...o, expect: '200' }, is(200));
  await T.call('User task analytics (owner)', 'GET', `/api/tasks/admin/dashboard/user/${state.users.std.id}/analytics`, { ...o, expect: '200' }, is(200));

  // ---------- Export Reports ----------
  T.setModule('Analytics: Export reports');
  await T.call('Export attendance report (owner)', 'GET', '/api/export-reports/attendance', { ...o, query: { type: 'all', date: 'today', format: 'xlsx' }, expect: '200' }, is(200));
  await T.call('Export tasks report (owner)', 'GET', '/api/export-reports/tasks', { ...o, query: { type: 'all', format: 'xlsx' }, expect: '200' }, is(200));
  await T.call('Restricted employee blocked from all-attendance export', 'GET', '/api/export-reports/attendance', { ...std, query: { type: 'all', date: 'today', format: 'xlsx' }, expect: '403' }, denied);
}

module.exports = { aiAndAnalyticsFlow };
