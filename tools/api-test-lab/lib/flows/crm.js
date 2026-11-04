const { tokenFor } = require('../auth');
const { istKey, istAt, addDaysKey } = require('../time');
const { is, denied, rejected, has, idOf, findId } = require('./helpers');

const CRM_PAGES = require('../../../../utils/crmPermissionPages');
const TELECALLER_SLUGS = ['dashboard', 'call-dashboard', 'assigned-calls', 'todays-calls', 'pending-calls', 'scheduled-calls', 'completed-calls', 'call-history', 'follow-ups', 'converted-leads', 'call-workspace', 'lead-detail'];
const REPORT_TYPES = ['overview', 'leads', 'calls', 'visits', 'follow-ups', 'team-performance', 'conversion-funnel', 'user-activity'];
const ADMIN_CALL_PAGES = ['dashboard', 'calls/overview', 'calls/assigned', 'calls/today', 'calls/history', 'calls/pending', 'calls/scheduled', 'calls/completed', 'calls/converted', 'calls/transferred', 'calls/follow-ups'];

const phone = () => `9${String(Date.now()).slice(-6)}${Math.floor(100 + Math.random() * 900)}`;

async function crmFlow(ctx) {
  const { T, state } = ctx;
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const tc = { token: await tokenFor(ctx, 'late'), as: 'late (telecaller)' };
  const std = { token: await tokenFor(ctx, 'std'), as: 'std' };
  const ownerId = state.users.owner.id;
  const tcId = state.users.late.id;

  // ---------- Page access ----------
  T.setModule('CRM: Page access');
  await T.call('Before access: owner blocked from All Leads', 'GET', '/api/crm/leads', { ...o, expect: '403' }, denied);
  let granted = 0;
  for (const p of CRM_PAGES) {
    const r = await ctx.api('PUT', `/api/page-permissions/${p.pageKey}`, { token: o.token, body: { viewUserIds: [ownerId], editUserIds: [ownerId], deleteUserIds: [ownerId] } });
    if (r.status === 200) granted += 1;
  }
  T.assert(`Owner given view/edit/delete on all ${CRM_PAGES.length} CRM admin pages`, granted === CRM_PAGES.length, { expect: `${CRM_PAGES.length} saved`, actual: `${granted} saved` });
  let tGranted = 0;
  for (const slug of TELECALLER_SLUGS) {
    const r = await ctx.api('PUT', `/api/page-permissions/admin-telecaller-${slug}`, { token: o.token, body: { viewUserIds: [tcId], editUserIds: [tcId] } });
    if (r.status === 200) tGranted += 1;
  }
  T.assert(`Telecaller (late) given access to ${TELECALLER_SLUGS.length} telecaller pages`, tGranted === TELECALLER_SLUGS.length, { expect: `${TELECALLER_SLUGS.length} saved`, actual: `${tGranted} saved` });
  await T.call('Page list shows CRM pages', 'GET', '/api/page-permissions/pages', { ...o, expect: 'has admin-crm-all-leads' },
    r => (r.status === 200 && has(r.data, 'admin-crm-all-leads') ? true : `got ${r.status}; CRM pages missing`));
  await T.call('Employee without CRM access is blocked', 'GET', '/api/crm/leads', { ...std, expect: '403' }, denied);
  if (state.users.client?.token) {
    await T.call('Client is blocked from CRM', 'GET', '/api/crm/leads', { token: state.users.client.token, as: 'client', expect: '403' }, denied);
  }

  // ---------- Masters ----------
  T.setModule('CRM: Lead types & sources');
  const typeName = `ZZ Type ${Date.now() % 100000}`;
  const t = await T.call('Create lead type', 'POST', '/api/crm/lead-types', { ...o, body: { name: typeName }, expect: '201' }, is(200, 201));
  const typeId = idOf(t.data, 'item._id', 'data._id', 'leadType._id', '_id') || await findId('leadtypes', { name: typeName });
  await T.call('Duplicate lead type refused', 'POST', '/api/crm/lead-types', { ...o, body: { name: typeName }, expect: '409' }, rejected);
  await T.call('Empty lead type refused', 'POST', '/api/crm/lead-types', { ...o, body: { name: '' }, expect: '400' }, is(400));
  await T.call('Employee cannot add lead type', 'POST', '/api/crm/lead-types', { ...std, body: { name: 'ZZ hack type' }, expect: '403' }, denied);
  if (typeId) await T.call('Rename lead type', 'PUT', `/api/crm/lead-types/${typeId}`, { ...o, body: { name: `${typeName} A`, status: 'Active' }, expect: '200' }, is(200));
  const tmpType = await T.call('Create a lead type to delete', 'POST', '/api/crm/lead-types', { ...o, body: { name: `${typeName} tmp` }, expect: '201' }, is(200, 201));
  const tmpTypeId = idOf(tmpType.data, 'item._id', 'data._id', '_id');
  if (tmpTypeId) await T.call('Delete lead type', 'DELETE', `/api/crm/lead-types/${tmpTypeId}`, { ...o, expect: '200' }, is(200, 204));
  await T.call('Lead type list', 'GET', '/api/crm/lead-types', { ...o, expect: 'has type' }, r => (r.status === 200 && has(r.data, typeName) ? true : `got ${r.status}`));

  const srcName = `ZZ Source ${Date.now() % 100000}`;
  const s = await T.call('Create lead source', 'POST', '/api/crm/lead-sources', { ...o, body: { name: srcName }, expect: '201' }, is(200, 201));
  const srcId = idOf(s.data, 'item._id', 'data._id', 'leadSource._id', '_id') || await findId('leadsources', { name: srcName });
  await T.call('Duplicate lead source refused', 'POST', '/api/crm/lead-sources', { ...o, body: { name: srcName }, expect: '409' }, rejected);
  await T.call('Lead source list', 'GET', '/api/crm/lead-sources', { ...o, expect: 'has source' }, r => (r.status === 200 && has(r.data, srcName) ? true : `got ${r.status}`));
  await T.call('Add-lead form options have type + source', 'GET', '/api/crm/leads/options', { ...o, expect: 'has both' },
    r => (r.status === 200 && has(r.data, srcName) && has(r.data, typeName) ? true : `got ${r.status}; options missing`));
  if (!typeId || !srcId) return T.skip('CRM leads', 'Lead type or source id not found');

  // ---------- Leads ----------
  T.setModule('CRM: Leads');
  const base = { email: `lead${Date.now() % 100000}@zzlab-test.example.com`, gender: 'Female', leadDate: istKey(), leadType: typeId, leadSource: srcId, remarks: 'ZZ Lab lead' };
  await T.call('Lead with bad phone refused', 'POST', '/api/crm/leads', { ...o, body: { ...base, fullName: 'ZZ Bad', phone: '123' }, expect: '400' }, is(400));
  await T.call('Lead without name refused', 'POST', '/api/crm/leads', { ...o, body: { ...base, fullName: '', phone: phone() }, expect: '400' }, is(400));
  await T.call('Lead with invalid date refused', 'POST', '/api/crm/leads', { ...o, body: { ...base, fullName: 'ZZ Bad Date', phone: phone(), leadDate: '2026-02-30' }, expect: '400' }, is(400));
  const leads = [];
  for (let i = 1; i <= 4; i++) {
    const r = await T.call(`Add lead ${i}`, 'POST', '/api/crm/leads', {
      ...o, body: { ...base, fullName: `ZZ Lead ${i} ${Date.now() % 10000}`, phone: phone(), email: `lead${i}.${Date.now() % 100000}@zzlab-test.example.com` }, expect: '201 status new',
    }, r2 => ([200, 201].includes(r2.status) && (r2.data?.item?.status || 'new') === 'new' ? true : `got ${r2.status}`));
    const id = idOf(r.data, 'item._id', 'data._id', '_id');
    if (id) leads.push(id);
  }
  await T.call('All leads list has them', 'GET', '/api/crm/leads', { ...o, expect: 'has 4 leads' },
    r => (r.status === 200 && leads.every(id => has(r.data, id)) ? true : `got ${r.status}; some leads missing`));
  await T.call('Lead overview', 'GET', '/api/crm/leads/overview', { ...o, expect: '200' }, is(200));
  await T.call('Team list for assignment', 'GET', '/api/crm/leads/team', { ...o, expect: 'has telecaller' },
    r => (r.status === 200 && has(r.data, tcId) ? true : `got ${r.status}; telecaller not in team list`));
  await T.call('Field config', 'GET', '/api/crm/leads/field-config', { ...o, expect: '200' }, is(200));
  await T.call('Campaigns', 'GET', '/api/crm/leads/campaigns', { ...o, expect: '200' }, is(200));
  if (leads.length < 4) return T.skip('CRM assignment & calls', 'Not all leads were created');

  await T.call('Move lead 4 to "contacted"', 'PATCH', `/api/crm/leads/${leads[3]}/status`, { ...o, body: { status: 'contacted' }, expect: '200' }, is(200));
  await T.call('Invalid stage refused', 'PATCH', `/api/crm/leads/${leads[3]}/status`, { ...o, body: { status: 'xyz' }, expect: '400' }, is(400));

  // ---------- Assignment ----------
  T.setModule('CRM: Assignment');
  await T.call('Assign lead 1 to telecaller', 'PUT', `/api/crm/leads/${leads[0]}/assign`, { ...o, body: { userId: tcId }, expect: '200' }, is(200));
  await T.call('Assign same lead to same user again refused', 'PUT', `/api/crm/leads/${leads[0]}/assign`, { ...o, body: { userId: tcId }, expect: '400' }, is(400));
  await T.call('Reassign without reason refused', 'PUT', `/api/crm/leads/${leads[0]}/assign`, { ...o, body: { userId: state.users.std.id }, expect: '400' }, is(400));
  await T.call('Bulk assign leads 2–3 to telecaller', 'POST', '/api/crm/assignments/bulk', {
    ...o, body: { leadIds: [leads[1], leads[2]], method: 'specific', agentId: tcId }, expect: '200',
  }, is(200));
  await T.call('Bulk assign with bad method refused', 'POST', '/api/crm/assignments/bulk', { ...o, body: { leadIds: [leads[3]], method: 'magic' }, expect: '400' }, is(400));
  await T.call('Assignment history has the bulk move', 'GET', '/api/crm/assignments/history', { ...o, expect: 'has lead' },
    r => (r.status === 200 && has(r.data, leads[1]) ? true : `got ${r.status}; history missing`));
  await T.call('Assignment overview', 'GET', '/api/crm/assignments/overview', { ...o, expect: '200' }, is(200));
  await T.call('Workload shows telecaller', 'GET', '/api/crm/assignments/workload', { ...o, expect: 'has telecaller' },
    r => (r.status === 200 && has(r.data, tcId) ? true : `got ${r.status}; telecaller missing`));

  // ---------- Telecaller ----------
  T.setModule('CRM: Telecaller calls');
  await T.call('Telecaller sees assigned leads', 'GET', '/api/crm/telecaller', { ...tc, expect: 'has lead 1' },
    r => (r.status === 200 && has(r.data, leads[0]) ? true : `got ${r.status}; lead missing`));
  await T.call('Telecaller does not see unassigned lead 4', 'GET', '/api/crm/telecaller', { ...tc, expect: 'no lead 4' },
    r => (r.status === 200 && !has(r.data, leads[3]) ? true : `got ${r.status}; unassigned lead visible`));
  await T.call('Employee without telecaller access blocked', 'GET', '/api/crm/telecaller', { ...std, expect: '403' }, denied);
  await T.call('Open lead 1', 'GET', `/api/crm/telecaller/${leads[0]}`, { ...tc, expect: '200' }, is(200));
  const callId = () => `zzcall${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const tomorrow = istAt(addDaysKey(istKey(), 1), '11:00').toISOString();
  await T.call('Callback without date refused', 'POST', `/api/crm/telecaller/${leads[0]}/calls`, { ...tc, body: { id: callId(), outcome: 'Need Callback', notes: 'x' }, expect: '400' }, is(400));
  await T.call('Invalid outcome refused', 'POST', `/api/crm/telecaller/${leads[0]}/calls`, { ...tc, body: { id: callId(), outcome: 'Dancing' }, expect: '400' }, is(400));
  await T.call('Log call: Need Callback tomorrow', 'POST', `/api/crm/telecaller/${leads[0]}/calls`, {
    ...tc, body: { id: callId(), outcome: 'Need Callback', callType: 'Outgoing', notes: 'ZZ call back', followUp: tomorrow, duration: 45 }, expect: '200',
  }, is(200, 201));
  await T.call('Lead 1 is now in follow-up stage', 'GET', `/api/crm/telecaller/${leads[0]}`, { ...tc, expect: 'follow-up' },
    r => (r.status === 200 && has(r.data, '"status":"follow-up"') ? true : `got ${r.status}; status not follow-up`));
  await T.call('Log call: Converted', 'POST', `/api/crm/telecaller/${leads[0]}/calls`, { ...tc, body: { id: callId(), outcome: 'Converted', notes: 'ZZ won' }, expect: '200' }, is(200, 201));
  await T.call('Converted lead cannot get another call', 'POST', `/api/crm/telecaller/${leads[0]}/calls`, { ...tc, body: { id: callId(), outcome: 'Busy' }, expect: '409' }, is(409));
  await T.call('Telecaller cannot log a call on someone else\'s lead', 'POST', `/api/crm/telecaller/${leads[3]}/calls`, { ...tc, body: { id: callId(), outcome: 'Busy' }, expect: '404/403' }, rejected);
  await T.call('Telecaller call logs', 'GET', '/api/crm/telecaller/call-logs', { ...tc, expect: '200' }, is(200));
  await T.call('Phone lookup', 'GET', '/api/crm/telecaller/lookup', { ...tc, query: { phone: '9999999999' }, expect: '200' }, is(200));
  await T.call('My follow-ups', 'GET', '/api/followups', { ...tc, expect: '200' }, is(200));
  await T.call('Today follow-ups', 'GET', '/api/followups/today', { ...tc, expect: '200' }, is(200));
  await T.call('My calls', 'GET', '/api/calls', { ...tc, expect: '200' }, is(200));

  // ---------- Admin call pages & reports ----------
  T.setModule('CRM: Admin call pages & reports');
  for (const p of ADMIN_CALL_PAGES) {
    await T.call(`Admin: ${p}`, 'GET', `/api/crm/admin/${p}`, { ...o, expect: '200' }, is(200));
  }
  await T.call('Admin converted calls include lead 1', 'GET', '/api/crm/admin/calls/converted', { ...o, expect: 'has lead 1' },
    r => (r.status === 200 && has(r.data, leads[0]) ? true : `got ${r.status}; converted lead missing`));
  for (const type of REPORT_TYPES) {
    await T.call(`Report: ${type}`, 'GET', `/api/crm/reports/${type}`, { ...o, expect: '200' }, is(200));
  }
  await T.call('Unknown report → 404', 'GET', '/api/crm/reports/nope', { ...o, expect: '404' }, is(404));
  await T.call('Employee cannot open CRM reports', 'GET', '/api/crm/reports/overview', { ...std, expect: '403' }, denied);
}

module.exports = { crmFlow };
