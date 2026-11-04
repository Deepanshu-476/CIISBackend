const { tokenFor, login } = require('../auth');
const { istKey, istAt, addDaysKey } = require('../time');
const { LAB_EMAIL_DOMAIN } = require('../data');
const { is, denied, rejected, has, idOf, findId, oid, messageOf, rowsOf } = require('./helpers');

const inDays = (n, time = '18:00') => istAt(addDaysKey(istKey(), n), time).toISOString();

async function tasksFlow(ctx) {
  const { T, state } = ctx;
  T.setModule('Tasks: Assigned & Self');
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const e1 = { token: await tokenFor(ctx, 'ontime'), as: 'ontime' };
  const e2 = { token: await tokenFor(ctx, 'late'), as: 'late' };
  const outsider = { token: await tokenFor(ctx, 'half'), as: 'half' };
  const title = `ZZ Lab Task ${Date.now() % 100000}`;

  await T.call('Task without due date is refused', 'POST', '/api/tasks/assigned/create', {
    ...o, body: { title: 'ZZ no due', assignedUsers: JSON.stringify([state.users.ontime.id]) }, expect: '400',
  }, is(400));
  await T.call('Task for others without any user is refused', 'POST', '/api/tasks/assigned/create', {
    ...o, body: { title: 'ZZ no users', dueDateTime: inDays(2), assignedUsers: '[]' }, expect: '400',
  }, rejected);
  const created = await T.call('Admin assigns a task to 2 employees', 'POST', '/api/tasks/assigned/create', {
    ...o, expect: '201',
    body: { title, description: 'ZZ Lab dummy task', priority: 'high', dueDateTime: inDays(2), assignedUsers: JSON.stringify([state.users.ontime.id, state.users.late.id]) },
  }, is(200, 201));
  const taskId = idOf(created.data, 'task._id', 'data._id', 'data.task._id') || await findId('tasks', { title });

  if (!taskId) {
    T.skip('Assigned task checks', 'Task id not found');
  } else {
    await T.call('Employee 1 sees it in "assigned to me"', 'GET', '/api/tasks/assigned/to-me', { ...e1, expect: 'has task' },
      r => (r.status === 200 && has(r.data, taskId) ? true : `got ${r.status}; task missing`));
    await T.call('Employee 2 sees it in "assigned to me"', 'GET', '/api/tasks/assigned/to-me', { ...e2, expect: 'has task' },
      r => (r.status === 200 && has(r.data, taskId) ? true : `got ${r.status}; task missing`));
    await T.call('Unassigned employee does not see it', 'GET', '/api/tasks/assigned/to-me', { ...outsider, expect: 'no task' },
      r => (r.status === 200 && !has(r.data, taskId) ? true : `got ${r.status}; task visible to an outsider`));
    await T.call('Admin sees it in "assigned by me"', 'GET', '/api/tasks/assigned/by-me', { ...o, expect: 'has task' },
      r => (r.status === 200 && has(r.data, taskId) ? true : `got ${r.status}; task missing`));
    await T.call('Add checkpoint while pending', 'POST', `/api/tasks/assigned/${taskId}/checkpoints`, { ...o, body: { text: 'ZZ checkpoint', title: 'ZZ checkpoint' }, expect: '201' }, is(200, 201));
    await T.call('Employee 1 → in-progress', 'PATCH', `/api/tasks/assigned/${taskId}/status`, { ...e1, body: { status: 'in-progress' }, expect: '200' }, is(200));
    await T.call('Employee 1 adds a remark', 'POST', `/api/tasks/assigned/${taskId}/remarks`, { ...e1, body: { text: 'ZZ Lab remark from employee' }, expect: '201' }, is(200, 201));
    await T.call('Remark is listed', 'GET', `/api/tasks/assigned/${taskId}/remarks`, { ...o, expect: 'has remark' },
      r => (r.status === 200 && has(r.data, 'ZZ Lab remark from employee') ? true : `got ${r.status}; remark missing`));
    await T.call('Employee 1 → completed', 'PATCH', `/api/tasks/assigned/${taskId}/status`, { ...e1, body: { status: 'completed' }, expect: '200' }, is(200));
    await T.call('Completed task cannot go back to pending', 'PATCH', `/api/tasks/assigned/${taskId}/status`, { ...e1, body: { status: 'pending' }, expect: '400' },
      r => (r.status === 400 ? true : `got ${r.status}: completed task moved back to pending (old /task API allows only "reopen")`));
    await T.call('Task activity log', 'GET', `/api/tasks/assigned/${taskId}/activity-logs`, { ...o, expect: '200' }, is(200));
    await T.call('Unassigned employee cannot change status', 'PATCH', `/api/tasks/assigned/${taskId}/status`, { ...outsider, body: { status: 'cancelled' }, expect: '403' },
      r => (denied(r) === true ? true : `got ${r.status}: an employee who is not assigned changed the task for everyone`));
    // notifications are sent in the background; give them a moment
    let note = null;
    for (let i = 0; i < 4 && !note; i++) {
      await new Promise(done => setTimeout(done, 750));
      const n = await ctx.api('GET', '/api/notifications', { token: e1.token });
      if (has(n.data, title)) note = n;
    }
    await T.call('Assigned employee got a "task assigned" notification', 'GET', '/api/notifications', { ...e1, expect: 'has task title' },
      r => (r.status === 200 && has(r.data, title) ? true : `got ${r.status}; no notification for the assignee`));
  }

  // The older create API used by the admin pages and the mobile app
  const title2 = `ZZ Lab Task B ${Date.now() % 100000}`;
  await T.call('/task/create-for-others: missing due date refused', 'POST', '/task/create-for-others', {
    ...o, body: { title: 'ZZ no due B', assignedUsers: JSON.stringify([state.users.ontime.id]) }, expect: '400',
  }, is(400));
  const c2 = await T.call('/task/create-for-others: admin assigns a task', 'POST', '/task/create-for-others', {
    ...o, body: { title: title2, description: 'ZZ', priority: 'medium', dueDateTime: inDays(3), assignedUsers: JSON.stringify([state.users.ontime.id]) }, expect: '201',
  }, is(200, 201));
  const task2 = idOf(c2.data, 'task._id', 'data._id') || await findId('tasks', { title: title2 });
  if (task2) {
    await T.call('Employee sees it in /task/assigned-to-me', 'GET', '/task/assigned-to-me', { ...e1, expect: 'has task' },
      r => (r.status === 200 && has(r.data, task2) ? true : `got ${r.status}; task missing`));
    await T.call('Unassigned employee cannot change it (old API)', 'PATCH', `/task/${task2}/status`, { ...outsider, body: { status: 'completed' }, expect: '403' }, denied);
    await T.call('Assignee updates it (old API)', 'PATCH', `/task/${task2}/status`, { ...e1, body: { status: 'in-progress' }, expect: '200' }, is(200));
    let found = false;
    for (let i = 0; i < 4 && !found; i++) {
      await new Promise(done => setTimeout(done, 750));
      const n = await ctx.api('GET', '/api/notifications', { token: e1.token });
      found = has(n.data, title2);
    }
    T.assert('Assignee got a notification for the old-API task', found, { expect: 'notification with task title', actual: found ? 'found' : 'not found' });
  }

  // Self task: create → list → complete → delete
  const selfTitle = `ZZ Self Task ${Date.now() % 100000}`;
  const self = await T.call('Employee creates a self task', 'POST', '/api/tasks/self/create', { ...e1, body: { title: selfTitle, description: 'ZZ self', dueDateTime: inDays(1) }, expect: '201' }, is(200, 201));
  const selfId = idOf(self.data, 'task._id', 'data._id', 'data.task._id') || await findId('tasks', { title: selfTitle });
  if (selfId) {
    await T.call('Self task is listed', 'GET', '/api/tasks/self', { ...e1, expect: 'has task' },
      r => (r.status === 200 && has(r.data, selfId) ? true : `got ${r.status}; task missing`));
    await T.call('Other employee cannot edit it', 'PUT', `/api/tasks/self/${selfId}`, { ...outsider, body: { title: 'hacked' }, expect: '403' }, denied);
    await T.call('Self task → completed', 'PATCH', `/api/tasks/self/${selfId}/status`, { ...e1, body: { status: 'completed' }, expect: '200' }, is(200));
    await T.call('Delete self task', 'DELETE', `/api/tasks/self/${selfId}`, { ...e1, expect: '200' }, is(200, 204));
    await T.call('Deleted task is gone', 'GET', '/api/tasks/self', { ...e1, expect: 'no task' },
      r => (r.status === 200 && !has(r.data, selfId) ? true : `got ${r.status}; deleted task still listed`));
  }
  await T.call('All my tasks', 'GET', '/api/tasks/all', { ...e1, expect: '200' }, is(200));
  await T.call('All my task stats', 'GET', '/api/tasks/all/stats', { ...e1, expect: '200' }, is(200));
  await T.call('Company task overview (admin)', 'GET', '/api/tasks/all/company-overview', { ...o, expect: '200' }, is(200));
  await T.call('Assignable users', 'GET', '/task/assignable-users', { ...o, expect: '200' }, is(200));
}

async function projectsFlow(ctx) {
  const { T, state } = ctx;
  T.setModule('Projects & Project tasks');
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const e1 = { token: await tokenFor(ctx, 'ontime'), as: 'ontime' };
  const outsider = { token: await tokenFor(ctx, 'half'), as: 'half' };
  const name = `ZZ Lab Project ${Date.now() % 100000}`;

  await T.call('Project without members is refused', 'POST', '/api/projects', { ...o, body: { projectName: 'ZZ empty', description: 'x', users: '[]' }, expect: '400' }, is(400));
  const p = await T.call('Admin creates a project with 2 members', 'POST', '/api/projects', {
    ...o, expect: '201',
    body: { projectName: name, description: 'ZZ Lab project', priority: 'medium', startDate: istKey(), endDate: addDaysKey(istKey(), 30), users: JSON.stringify([state.users.ontime.id, state.users.std.id]) },
  }, is(200, 201));
  const projectId = idOf(p.data, 'project._id', 'data._id', 'data.project._id', '_id') || await findId('projects', { projectName: name });
  if (!projectId) return T.skip('Project checks', 'Project id not found');
  state.lastProjectId = projectId;
  ctx.save();

  await T.call('Member sees the project', 'GET', '/api/projects', { ...e1, expect: 'has project' },
    r => (r.status === 200 && has(r.data, projectId) ? true : `got ${r.status}; project missing`));
  await T.call('Non-member cannot open the project', 'GET', `/api/projects/${projectId}`, { ...outsider, expect: '403/404' },
    r => ([403, 404].includes(r.status) ? true : `got ${r.status}: non-member can open the project`));
  const taskTitle = `ZZ Project Task ${Date.now() % 100000}`;
  const t = await T.call('Add a task in the project', 'POST', `/api/projects/${projectId}/tasks`, {
    ...o, body: { title: taskTitle, description: 'ZZ', assignedTo: state.users.ontime.id, dueDate: inDays(3), priority: 'high' }, expect: '201',
  }, is(200, 201));
  let ptId = idOf(t.data, 'task._id', 'data.task._id', 'data._id');
  if (!ptId) {
    const proj = await ctx.db.collection('projects').findOne({ _id: oid(projectId) });
    const found = (proj?.tasks || []).find(x => x.title === taskTitle);
    ptId = found ? String(found._id) : undefined;
  }
  if (ptId) {
    await T.call('Assignee sees it in project tasks assigned to me', 'GET', '/api/tasks/project/assigned-to-me', { ...e1, expect: 'has task' },
      r => (r.status === 200 && has(r.data, taskTitle) ? true : `got ${r.status}; task missing`));
    await T.call('Assignee → in-progress', 'PATCH', `/api/tasks/project/${projectId}/tasks/${ptId}/status`, { ...e1, body: { status: 'in-progress' }, expect: '200' }, is(200));
    await T.call('Assignee adds a remark', 'POST', `/api/tasks/project/${projectId}/tasks/${ptId}/remarks`, { ...e1, body: { text: 'ZZ project remark' }, expect: '201' }, is(200, 201));
    await T.call('Remarks listed', 'GET', `/api/tasks/project/${projectId}/tasks/${ptId}/remarks`, { ...o, expect: 'has remark' },
      r => (r.status === 200 && has(r.data, 'ZZ project remark') ? true : `got ${r.status}; remark missing`));
    await T.call('Task activity', 'GET', `/api/tasks/project/${projectId}/tasks/${ptId}/activity`, { ...o, expect: '200' }, is(200));
    await T.call('Non-member cannot change the task', 'PATCH', `/api/tasks/project/${projectId}/tasks/${ptId}/status`, { ...outsider, body: { status: 'completed' }, expect: '403' }, denied);
  } else {
    T.skip('Project task checks', 'Project task id not found');
  }
  await T.call('Project members list', 'GET', `/api/projects/${projectId}/users`, { ...o, expect: '200' }, is(200));
  await T.call('Update project', 'PUT', `/api/projects/${projectId}`, { ...o, body: { projectName: name, description: 'ZZ updated', users: JSON.stringify([state.users.ontime.id, state.users.std.id]) }, expect: '200' }, is(200));
}

async function pagePermissionFlow(ctx) {
  const { T, state } = ctx;
  T.setModule('Page management (permissions)');
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const e1 = { token: await tokenFor(ctx, 'ontime'), as: 'ontime' };
  const uid = state.users.ontime.id;

  await T.call('Owner: list of manageable pages', 'GET', '/api/page-permissions/pages', { ...o, expect: 'has emp-attendance' },
    r => (r.status === 200 && has(r.data, 'emp-attendance') ? true : `got ${r.status}`));
  await T.call('Before access: employee cannot open all attendance', 'GET', '/api/attendance/all', { ...e1, expect: '403' }, denied);
  await T.call('Employee cannot change page permissions', 'PUT', '/api/page-permissions/emp-attendance', { ...e1, body: { viewUserIds: [uid] }, expect: '403' }, denied);
  await T.call('Owner gives VIEW on Emp - Attendance', 'PUT', '/api/page-permissions/emp-attendance', { ...o, body: { viewUserIds: [uid] }, expect: '200' }, is(200));
  await T.call('Permission saved for the page', 'GET', '/api/page-permissions/by-path', { ...e1, query: { path: '/ciisUser/emp-attendance' }, expect: 'has user' },
    r => (r.status === 200 && has(r.data, uid) ? true : `got ${r.status}; user not in page`));
  await T.call('With VIEW: employee can open all attendance', 'GET', '/api/attendance/all', { ...e1, expect: '200' }, is(200));
  await T.call('With VIEW only: still cannot delete attendance', 'DELETE', '/api/attendance/000000000000000000000000', { ...e1, expect: '403' }, denied);
  await T.call('Owner removes the access', 'PUT', '/api/page-permissions/emp-attendance', { ...o, body: { viewUserIds: [] }, expect: '200' }, is(200));
  await T.call('After removal: employee blocked again', 'GET', '/api/attendance/all', { ...e1, expect: '403' }, denied);

  // Leave approver page
  await T.call('Owner makes employee an approver on Emp - Leaves', 'PUT', '/api/page-permissions/emp-leaves', { ...o, body: { approverIds: [uid], viewUserIds: [uid] }, expect: '200' }, is(200));
  await T.call('Leave approver can see all leaves', 'GET', '/api/leaves/all', { ...e1, expect: '200' }, is(200));
  await T.call('Owner removes leave approver', 'PUT', '/api/page-permissions/emp-leaves', { ...o, body: { approverIds: [], viewUserIds: [] }, expect: '200' }, is(200));

  if (state.client?.userId) {
    await T.call('Client login cannot be given page access', 'PUT', '/api/page-permissions/emp-attendance', { ...o, body: { viewUserIds: [state.client.userId] }, expect: '200, client ignored' },
      r => (r.status === 200 && !has(r.data, state.client.userId) ? true : `got ${r.status}; client user was added to an employee page`));
    await T.call('Reset Emp - Attendance access', 'PUT', '/api/page-permissions/emp-attendance', { ...o, body: { viewUserIds: [] }, expect: '200' }, is(200));
  }

  await T.call('Sidebar config (owner)', 'GET', '/api/sidebar/config', { ...o, query: { companyId: state.companyId, departmentId: state.ownerDeptId, role: 'owner' }, expect: '200' }, is(200));
  await T.call('Sidebar config (employee)', 'GET', '/api/sidebar/config', { ...e1, query: { companyId: state.companyId, departmentId: state.depts.main, role: state.jobRoles.main }, expect: '200' }, is(200));
  await T.call('Employee cannot read another company sidebar', 'GET', '/api/sidebar/config', { ...e1, query: { companyId: '000000000000000000000001', role: 'owner' }, expect: '403' }, denied);
  await T.call('My sidebar (employee)', 'GET', '/api/sidebar/user-config', { ...e1, query: { companyId: state.companyId, departmentId: state.depts.main, role: state.jobRoles.main }, expect: '200' }, is(200));
  await T.call('Page data visibility context', 'GET', '/api/page-permissions/data-visibility/context', { ...o, expect: '200' }, is(200));
}

async function clientFlow(ctx) {
  const { T, state, save } = ctx;
  T.setModule('Clients & Client login');
  const o = { token: await tokenFor(ctx, 'owner'), as: 'owner' };
  const e1 = { token: await tokenFor(ctx, 'ontime'), as: 'ontime' };
  const lower = state.companyCode.toLowerCase();

  await T.call('Client without required fields is refused', 'POST', '/api/clientsservice', { ...o, body: { client: 'x' }, expect: '400' }, is(400));

  if (!state.servicesReady) {
    for (const servicename of ['SEO', 'Website']) {
      await T.call(`Admin adds service "${servicename}"`, 'POST', '/api/clientsservice/services', { ...o, body: { servicename, companyCode: state.companyCode }, expect: '201' }, is(200, 201, 409));
    }
    state.servicesReady = true;
    save();
  }
  await T.call('Service list has SEO', 'GET', '/api/clientsservice/services', { ...o, expect: 'has SEO' },
    r => (r.status === 200 && has(r.data, 'SEO') ? true : `got ${r.status}; SEO missing`));
  await T.call('Employee cannot add a service', 'POST', '/api/clientsservice/services', { ...e1, body: { servicename: `ZZ Hack Service ${Date.now() % 100000}`, companyCode: state.companyCode }, expect: '403' }, denied);

  if (!state.client) {
    const email = `client${Date.now() % 100000}.${lower}@${LAB_EMAIL_DOMAIN}`;
    const r = await T.call('Admin adds a client (creates client login)', 'POST', '/api/clientsservice', {
      ...o, expect: '201 + password',
      body: {
        client: 'ZZ Lab Client', company: 'ZZ Lab Client Pvt Ltd', city: 'Delhi', companyCode: state.companyCode,
        projectManager: ['ZZ Lab Owner'], services: ['SEO', 'Website'], email, phone: `7${Date.now().toString().slice(-9)}`, status: 'Active',
      },
    }, r2 => ([200, 201].includes(r2.status) ? true : `got ${r2.status}: ${messageOf(r2)}`));
    const data = r.data?.data || r.data || {};
    const clientId = idOf(r.data, 'data.client._id', 'client._id', 'data._id', '_id') || await findId('clients', { companyCode: state.companyCode, email });
    const password = data.user?.autoPassword || data.autoPassword || r.data?.autoPassword;
    const userRow = await ctx.db.collection('users').findOne({ email, companyCode: state.companyCode });
    if (clientId && password && userRow) {
      state.client = { id: clientId, userId: String(userRow._id), email, password };
      state.users.client = { id: String(userRow._id), email, password, name: 'ZZ Lab Client', companyRole: 'client' };
      save();
    } else {
      T.assert('Client login details returned', false, { detail: `clientId=${clientId} password=${password ? 'yes' : 'no'} user=${userRow ? 'yes' : 'no'}` });
      return;
    }
  }
  const cid = state.client.id;

  await login(ctx, 'client', { name: 'Client logs in with the auto password' });
  const c = { token: state.users.client.token, as: 'client' };
  await T.call('Client profile is a client account', 'GET', '/api/users/me', { ...c, expect: 'companyRole client' },
    r => (r.status === 200 && /client/i.test(JSON.stringify(r.data?.user?.companyRole || r.data?.data?.companyRole || r.data)) ? true : `got ${r.status}`));

  await T.call('Admin: client list has the client', 'GET', '/api/clientsservice', { ...o, expect: 'has client' },
    r => (r.status === 200 && has(r.data, cid) ? true : `got ${r.status}; client missing`));
  await T.call('Admin: open client', 'GET', `/api/clientsservice/${cid}`, { ...o, expect: '200' }, is(200));
  await T.call('Admin: client progress update', 'PATCH', `/api/clientsservice/${cid}/progress`, { ...o, body: { completed: 2, total: 5 }, expect: '200' }, is(200));
  await T.call('Admin: client dashboard overview', 'GET', '/api/clientsservice/dashboard-overview', { ...o, expect: '200' }, is(200));
  await T.call('Admin: client stats', 'GET', '/api/clientsservice/stats', { ...o, expect: '200' }, is(200));

  const taskName = `ZZ Client Task ${Date.now() % 100000}`;
  await T.call('Task for unknown service is refused', 'POST', `/api/tasks/client-tasks/client/${cid}/service/NoSuchService`, { ...o, body: { name: 'x', dueDateTime: inDays(2) }, expect: '400' }, is(400));
  const ct = await T.call('Admin adds a client task (SEO) for employee 1', 'POST', `/api/tasks/client-tasks/client/${cid}/service/SEO`, {
    ...o, body: { name: taskName, description: 'ZZ', dueDateTime: inDays(4), assigneeId: state.users.ontime.id, assignee: state.users.ontime.name, priority: 'high' }, expect: '201',
  }, is(200, 201));
  const ctId = idOf(ct.data, 'data._id', 'task._id', 'data.task._id', '_id') || await findId('clienttasks', { name: taskName });
  if (ctId) {
    await T.call('Client sees own task', 'GET', `/api/tasks/client-tasks/client/${cid}`, { ...c, expect: 'has task' },
      r => (r.status === 200 && has(r.data, taskName) ? true : `got ${r.status}; task missing`));
    await T.call('Client adds a remark', 'POST', `/api/tasks/client-tasks/${ctId}/client-remarks`, { ...c, body: { text: 'ZZ remark from client' }, expect: '201' }, is(200, 201));
    await T.call('Remark visible to admin', 'GET', `/api/tasks/client-tasks/${ctId}/client-remarks`, { ...o, expect: 'has remark' },
      r => (r.status === 200 && has(r.data, 'ZZ remark from client') ? true : `got ${r.status}; remark missing`));
    await T.call('Assignee sees it in client tasks assigned to me', 'GET', '/api/tasks/client-tasks/assigned-to-me', { ...e1, expect: 'has task' },
      r => (r.status === 200 && has(r.data, taskName) ? true : `got ${r.status}; task missing`));
    await T.call('Assignee → in-progress', 'PATCH', `/api/tasks/client-tasks/assigned/${ctId}/status`, { ...e1, body: { status: 'in-progress' }, expect: '200' }, is(200));
    await T.call('Client task activity log', 'GET', `/api/tasks/client-tasks/${ctId}/client-activity-logs`, { ...o, expect: '200' }, is(200));
  }

  // Second client: its data must stay hidden from the first client's login
  const otherName = `ZZ Other Client ${Date.now() % 100000}`;
  const other = await T.call('Admin adds a second client', 'POST', '/api/clientsservice', {
    ...o, expect: '201',
    body: { client: otherName, company: `${otherName} Ltd`, city: 'Mumbai', companyCode: state.companyCode, projectManager: ['ZZ Lab Owner'], services: ['SEO'], email: `other${Date.now() % 100000}.${lower}@${LAB_EMAIL_DOMAIN}` },
  }, is(200, 201));
  const otherId = idOf(other.data, 'data.client._id', 'client._id', 'data._id', '_id') || await findId('clients', { client: otherName });
  if (otherId) {
    const secret = `ZZ Secret Task ${Date.now() % 100000}`;
    await T.call('Task for the second client', 'POST', `/api/tasks/client-tasks/client/${otherId}/service/SEO`, { ...o, body: { name: secret, dueDateTime: inDays(4) }, expect: '201' }, is(200, 201));
    await T.call('Client 1 cannot read client 2 tasks', 'GET', `/api/tasks/client-tasks/client/${otherId}`, { ...c, expect: '403 / no data' },
      r => ([401, 403, 404].includes(r.status) || (r.status === 200 && !has(r.data, secret)) ? true : `got ${r.status} and the other client's task is visible`));
    await T.call('Client 1 cannot open client 2', 'GET', `/api/clientsservice/${otherId}`, { ...c, expect: '403/404' },
      r => ([401, 403, 404].includes(r.status) ? true : `got ${r.status}: other client's record is visible`));
    await T.call('Admin deletes the second client', 'DELETE', `/api/clientsservice/${otherId}`, { ...o, expect: '200' }, is(200, 204));
  }

  T.setModule('Client login: blocked areas');
  await T.call('Client cannot see all attendance', 'GET', '/api/attendance/all', { ...c, expect: '403' }, denied);
  await T.call('Client cannot see employee list', 'GET', '/api/users/all', { ...c, expect: '403 / no employees' },
    r => ([401, 403].includes(r.status) || (r.status === 200 && !has(r.data, state.users.std.email)) ? true : `got ${r.status} and employee emails are visible to a client`));
  await T.call('Client cannot see all leaves', 'GET', '/api/leaves/all', { ...c, expect: '403 / empty' },
    r => ([401, 403].includes(r.status) || (r.status === 200 && rowsOf(r.data).length === 0) ? true : `got ${r.status} with ${rowsOf(r.data).length} leaves`));
  await T.call('Client cannot create a project', 'POST', '/api/projects', { ...c, body: { projectName: 'ZZ hack', description: 'x', users: JSON.stringify([state.users.std.id]) }, expect: '403' }, denied);
  await T.call('Client cannot add a department', 'POST', '/api/departments', { ...c, body: { name: `ZZ Hack Dept ${Date.now() % 100000}`, workingDays: 5 }, expect: '403' }, denied);
}

module.exports = { tasksFlow, projectsFlow, pagePermissionFlow, clientFlow };
