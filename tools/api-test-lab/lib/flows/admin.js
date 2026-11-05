const { tokenFor } = require('../auth');
const { istKey, addDaysKey } = require('../time');
const { LAB_EMAIL_DOMAIN, LAB_PASSWORD } = require('../data');
const { is, denied, has, idOf, findId, messageOf } = require('./helpers');

async function adminFlow(ctx) {
  const { T, state } = ctx;
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const std = { token: await tokenFor(ctx, 'std'), as: 'std' };
  const e1 = { token: await tokenFor(ctx, 'ontime'), as: 'ontime' };
  const lower = state.companyCode.toLowerCase();
  const stamp = Date.now() % 100000;

  // ---------- Employee management ----------
  T.setModule('Admin: Employee management');
  await T.call('Owner: all users list shows employees of every department', 'GET', '/api/users/all', { ...o, expect: 'has std' },
    r => (r.status === 200 && has(r.data, state.users.std.email) ? true : `got ${r.status}; owner sees only own-department users (role "owner" is missing from the allowed roles)`));
  await T.call('Open one employee', 'GET', `/api/users/${state.users.std.id}`, { ...o, expect: '200' }, is(200));
  await T.call('Admin updates employee phone', 'PUT', `/api/users/admin-update/${state.users.std.id}`, { ...o, body: { phone: `8${String(Date.now()).slice(-9)}` }, expect: '200' }, is(200));
  await T.call('Employee cannot edit another employee', 'PUT', `/api/users/admin-update/${state.users.ontime.id}`, { ...std, body: { phone: '8000000000' }, expect: '403' }, denied);
  await T.call('Search users', 'GET', '/api/users/search', { ...o, query: { q: 'ZZ' }, expect: '200' }, is(200));
  await T.call('Register requests page', 'GET', '/api/users/register-requests', { ...o, expect: '200' }, is(200));
  // a throwaway employee to test delete
  const tmpEmail = `tmp${stamp}.${lower}@${LAB_EMAIL_DOMAIN}`;
  const reg = await T.call('Add a temporary employee', 'POST', '/api/auth/register', {
    ...o, expect: '201',
    body: { name: 'ZZ Temp Emp', email: tmpEmail, password: LAB_PASSWORD, department: state.depts.main, jobRole: state.jobRoles.main, shiftId: state.shiftIds.STD, company: state.companyId, companyCode: state.companyCode, companyRole: 'employee' },
  }, is(200, 201));
  const tmpId = idOf(reg.data, 'user.id', 'user._id') || await findId('users', { email: tmpEmail });
  if (tmpId && reg.status !== 429) {
    await T.call('Employee cannot delete an employee', 'DELETE', `/api/users/${tmpId}`, { ...std, expect: '403' }, denied);
    await T.call('Admin deletes the temporary employee', 'DELETE', `/api/users/${tmpId}`, { ...o, expect: '200' }, is(200));
    await T.call('Deleted employee is gone', 'GET', `/api/users/${tmpId}`, { ...o, expect: '404' }, r => ([404, 400].includes(r.status) ? true : `got ${r.status}`));
  }
  await T.call('Owner cannot delete self', 'DELETE', `/api/users/${state.users.owner.id}`, { ...o, expect: '4xx' }, r => (r.status >= 400 && r.status < 500 ? true : `got ${r.status}: owner deleted own account`));

  // ---------- Branches ----------
  T.setModule('Admin: Branches');
  const br = await T.call('Create branch', 'POST', '/api/branches', {
    ...o, body: { name: `ZZ Branch ${stamp}`, branchCode: `ZB${stamp}`, companyId: state.companyId, address: 'ZZ address', phone: '9000000000' }, expect: '201',
  }, is(200, 201));
  const branchId = idOf(br.data, 'data._id', 'branch._id', 'data.branch._id') || await findId('branches', { branchCode: `ZB${stamp}` });
  await T.call('Branch without name refused', 'POST', '/api/branches', { ...o, body: { companyId: state.companyId }, expect: '400' }, is(400));
  await T.call('Employee cannot create a branch', 'POST', '/api/branches', { ...std, body: { name: 'ZZ hack branch', branchCode: `ZH${stamp}`, companyId: state.companyId }, expect: '403' }, denied);
  await T.call('Company branch list', 'GET', `/api/branches/company/${state.companyId}`, { ...o, expect: 'has branch' },
    r => (r.status === 200 && (!branchId || has(r.data, branchId)) ? true : `got ${r.status}; branch missing`));
  if (branchId) {
    await T.call('Update branch', 'PUT', `/api/branches/${branchId}`, { ...o, body: { name: `ZZ Branch ${stamp} B` }, expect: '200' }, is(200));
    await T.call('Delete branch', 'DELETE', `/api/branches/${branchId}`, { ...o, expect: '200' }, is(200, 204));
  }

  // ---------- Groups ----------
  T.setModule('Admin: Groups');
  const g = await T.call('Create group with 2 members', 'POST', '/api/groups', {
    ...o, body: { name: `ZZ Group ${stamp}`, description: 'ZZ', members: [state.users.ontime.id, state.users.std.id] }, expect: '201',
  }, is(200, 201));
  const groupId = idOf(g.data, 'group._id', 'data._id', 'data.group._id') || await findId('groups', { name: `ZZ Group ${stamp}` });
  if (groupId) {
    await T.call('Member sees the group', 'GET', '/api/groups', { ...e1, expect: 'has group' }, r => (r.status === 200 && has(r.data, groupId) ? true : `got ${r.status}; group missing`));
    await T.call('Add a member', 'POST', `/api/groups/${groupId}/members`, { ...o, body: { members: [state.users.late.id], userIds: [state.users.late.id] }, expect: '200' }, is(200, 201));
    await T.call('Remove a member', 'DELETE', `/api/groups/${groupId}/members/${state.users.late.id}`, { ...o, expect: '200' }, is(200));
    await T.call('Non-member cannot delete the group', 'DELETE', `/api/groups/${groupId}`, { token: await tokenFor(ctx, 'half'), as: 'half', expect: '403/404' },
      r => ([401, 403, 404].includes(r.status) ? true : `got ${r.status}: a non-member deleted the group`));
    await T.call('Delete group', 'DELETE', `/api/groups/${groupId}`, { ...o, expect: '200' }, is(200, 204));
  }

  // ---------- Meetings ----------
  T.setModule('Admin: Meetings');
  const meetDate = addDaysKey(istKey(), 2);
  await T.call('Meeting without time refused', 'POST', '/api/meetings/create', { ...o, body: { title: 'ZZ', date: meetDate, attendees: [] }, expect: '400' }, is(400));
  const m = await T.call('Create meeting with std', 'POST', '/api/meetings/create', {
    ...o, body: { title: `ZZ Meeting ${stamp}`, description: 'ZZ', date: meetDate, time: '11:00', attendees: [state.users.std.id], link: 'https://meet.example.com/zz' }, expect: '201',
  }, is(200, 201));
  const meetingId = idOf(m.data, 'meeting._id', 'data._id', 'meetings.0._id', 'data.0._id') || await findId('meetings', { title: `ZZ Meeting ${stamp}` });
  await T.call('Attendee sees the meeting', 'GET', `/api/meetings/user/${state.users.std.id}`, { ...std, expect: 'has meeting' },
    r => (r.status === 200 && has(r.data, `ZZ Meeting ${stamp}`) ? true : `got ${r.status}; meeting missing`));
  await T.call('Another employee cannot read std meetings', 'GET', `/api/meetings/user/${state.users.std.id}`, { ...e1, expect: '403 / empty' },
    r => ([401, 403].includes(r.status) || (r.status === 200 && !has(r.data, `ZZ Meeting ${stamp}`)) ? true : `got ${r.status}: another employee's meetings are visible`));
  if (meetingId) {
    await T.call('Attendee marks it viewed', 'POST', '/api/meetings/mark-viewed', { ...std, body: { meetingId, userId: state.users.std.id }, expect: '200' }, is(200, 201));
    await T.call('View status', 'GET', `/api/meetings/view-status/${meetingId}`, { ...o, expect: '200' }, is(200));
    await T.call('Attendee cannot delete the meeting', 'DELETE', `/api/meetings/${meetingId}`, { ...std, expect: '403' }, denied);
    await T.call('Delete meeting', 'DELETE', `/api/meetings/${meetingId}`, { ...o, expect: '200 (404 if the attendee already deleted it)' }, is(200, 204, 404));
  }

  if (state.client?.id) {
    const cm = await T.call('Create client meeting', 'POST', '/api/cmeeting/create', {
      ...o, body: { title: `ZZ Client Meet ${stamp}`, clientId: state.client.id, meetingDate: meetDate, meetingTime: '15:00', meetingType: 'Online', priority: 'Normal', attendees: [state.users.ontime.id], duration: '30' }, expect: '201',
    }, is(200, 201));
    const cmId = idOf(cm.data, 'meeting._id', 'data._id', 'data.0._id', 'meetings.0._id') || await findId('clientmeetings', { title: `ZZ Client Meet ${stamp}` });
    await T.call('Client meetings list has it', 'GET', '/api/cmeeting', { ...o, expect: 'has meeting' }, r => (r.status === 200 && has(r.data, `ZZ Client Meet ${stamp}`) ? true : `got ${r.status}`));
    await T.call('Client meeting stats', 'GET', '/api/cmeeting/stats', { ...o, expect: '200' }, is(200));
    if (cmId) {
      await T.call('Mark client meeting Completed', 'PATCH', `/api/cmeeting/${cmId}/status`, { ...o, body: { status: 'Completed' }, expect: '200' }, is(200));
      await T.call('Delete client meeting', 'DELETE', `/api/cmeeting/${cmId}`, { ...o, expect: '200' }, is(200, 204));
    }
  }

  // ---------- Alerts ----------
  T.setModule('Admin: Alerts / announcements');
  const al = await T.call('Send alert to std', 'POST', '/api/alerts', {
    ...o, body: { title: `ZZ Alert ${stamp}`, type: 'info', message: 'ZZ Lab alert', assignedUsers: [state.users.std.id] }, expect: '201',
  }, is(200, 201));
  const alertId = idOf(al.data, 'alert._id', 'data._id', 'data.alert._id') || await findId('alerts', { title: `ZZ Alert ${stamp}` });
  await T.call('std sees the alert', 'GET', '/api/alerts', { ...std, expect: 'has alert' }, r => (r.status === 200 && has(r.data, `ZZ Alert ${stamp}`) ? true : `got ${r.status}; alert missing`));
  await T.call('Unread alert count', 'GET', '/api/alerts/unread/count', { ...std, expect: '200' }, is(200));
  if (alertId) {
    await T.call('std marks alert read', 'PATCH', `/api/alerts/${alertId}/read`, { ...std, expect: '200' }, is(200));
    await T.call('std cannot delete company alert', 'DELETE', `/api/alerts/${alertId}`, { ...std, expect: '403' }, denied);
    await T.call('Delete alert', 'DELETE', `/api/alerts/${alertId}`, { ...o, expect: '200 (404 if the employee already deleted it)' }, is(200, 204, 404));
  }
  await T.call('Alert without message refused', 'POST', '/api/alerts', { ...o, body: { title: 'ZZ' }, expect: '400' }, is(400));

  // ---------- Support ----------
  T.setModule('Admin: Support tickets');
  await T.call('Ticket without subject refused', 'POST', '/api/support/tickets', { ...std, body: { description: 'x' }, expect: '400' }, is(400));
  const tk = await T.call('Employee raises a ticket', 'POST', '/api/support/tickets', {
    ...std, body: { subject: `ZZ Ticket ${stamp}`, description: 'ZZ Lab laptop issue', category: 'IT Helpdesk', priority: 'High' }, expect: '201',
  }, is(200, 201));
  const ticketId = idOf(tk.data, 'ticket._id', 'data._id', 'data.ticket._id') || await findId('supporttickets', { subject: `ZZ Ticket ${stamp}` });
  await T.call('My tickets has it', 'GET', '/api/support/tickets/my', { ...std, expect: 'has ticket' }, r => (r.status === 200 && has(r.data, `ZZ Ticket ${stamp}`) ? true : `got ${r.status}`));
  await T.call('Admin ticket list has it', 'GET', '/api/support/admin/tickets', { ...o, expect: 'has ticket' }, r => (r.status === 200 && has(r.data, `ZZ Ticket ${stamp}`) ? true : `got ${r.status}; ${messageOf(r)}`));
  await T.call('Employee cannot open admin tickets', 'GET', '/api/support/admin/tickets', { ...e1, expect: '403' }, denied);
  if (ticketId) {
    await T.call('Employee adds a message', 'POST', `/api/support/tickets/${ticketId}/messages`, { ...std, body: { message: 'ZZ more info', text: 'ZZ more info' }, expect: '201' }, is(200, 201));
    await T.call('Another employee cannot write on it', 'POST', `/api/support/tickets/${ticketId}/messages`, { ...e1, body: { message: 'ZZ hack', text: 'ZZ hack' }, expect: '403/404' },
      r => ([403, 404].includes(r.status) ? true : `got ${r.status}: another employee wrote on the ticket`));
    await T.call('Admin resolves ticket', 'PATCH', `/api/support/admin/tickets/${ticketId}`, { ...o, body: { status: 'Resolved' }, expect: '200' }, is(200));
  }
  await T.call('Support admin dashboard', 'GET', '/api/support/admin/dashboard', { ...o, expect: '200' }, is(200));

  // ---------- Dashboards ----------
  T.setModule('Admin: Dashboards');
  await T.call('Admin dashboard overview', 'GET', '/api/dashboard-overview/data', { ...o, expect: '200' }, is(200));
  await T.call('Employee dashboard', 'GET', '/api/dashboard/overview', { ...std, expect: '200' }, is(200));
  await T.call('Badges', 'GET', '/api/badges', { ...std, expect: '200' }, is(200));
  await T.call('Asset requests (admin)', 'GET', '/api/asset-requests/all', { ...o, expect: '200' }, is(200));
  await T.call('My asset requests', 'GET', '/api/asset-requests/my-requests', { ...std, expect: '200' }, is(200));
}

module.exports = { adminFlow };
