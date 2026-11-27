const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.NODE_ENV = 'test';

const { Types } = require('mongoose');
const Task = require('../HR-CDS/models/Task');
const Group = require('../HR-CDS/models/Group');
const ClientTask = require('../HR-CDS/models/ClientTask');
const { Project } = require('../HR-CDS/models/Project');
const PagePermission = require('../models/PagePermission');
const Company = require('../models/Company');
const ActivityLog = require('../HR-CDS/models/ActivityLog');
const taskController = require('../HR-CDS/controllers/taskController');
const personal = require('../HR-CDS/controllers/selfTaskController');
const assigned = require('../HR-CDS/controllers/assignedTaskController');
const project = require('../HR-CDS/controllers/projectController');
const client = require('../HR-CDS/controllers/ClientTask');
const { authorizeCompanyTaskWrite, isCompanyTaskWrite } = require('../HR-CDS/utils/companyTaskStatus');

const id = () => new Types.ObjectId();
const userId = id();
const company = id();
const taskId = id();
const user = { _id: userId, id: String(userId), company, companyCode: 'TEST' };
const makeRequest = () => ({
  user,
  get: () => undefined,
  params: { taskId, projectId: id() },
  headers: { 'x-company-all-task-edit': 'true' },
  body: { status: 'completed', allowCompanyAllTaskEdit: true },
});
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const mockCompanyPlan = t => t.mock.method(Company, 'findById', () => ({
  select: () => ({ lean: async () => ({ allowedPages: ['company-all-task'] }) }),
}));

test('normal status and edit endpoints cannot move an overdue task using a body or header flag', async t => {
  mockCompanyPlan(t);
  t.mock.method(Group, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(PagePermission, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(PagePermission, 'find', () => ({ lean: async () => [] }));
  const task = {
    _id: taskId, companyCode: 'TEST', taskFor: 'self', createdBy: userId,
    assignedUsers: [userId], assignedGroups: [], statusByUser: [], status: 'overdue',
    overallStatus: 'overdue', assigneeId: userId, assignedTo: userId,
    save: () => assert.fail('Overdue status must stay unchanged'),
  };
  t.mock.method(Task, 'findById', async () => task);
  t.mock.method(ClientTask, 'findById', async () => task);
  t.mock.method(Project, 'findOne', async () => ({ company, tasks: [task] }));
  t.mock.method(Project, 'findById', async () => ({ company, createdBy: userId, tasks: { id: () => task } }));

  for (const handler of [
    personal.updateStatus, personal.updateTask, assigned.updateStatus,
    taskController.updateStatus, taskController.quickStatusUpdate, taskController.updateTask,
    taskController.updateCreatorStatus, project.updateTaskStatus, project.updateTask,
    client.updateAssignedTaskStatus, client.updateTask, client.toggleTaskCompletion,
  ]) {
    const res = response();
    await handler(makeRequest(), res);
    assert.equal(res.statusCode, 409, handler.name);
    assert.match(res.body.error || res.body.message, /Company All Task/);
  }
});

test('company route requires edit access and applies a same-company status change', async t => {
  mockCompanyPlan(t);
  const req = makeRequest();
  const denied = response();
  const permission = t.mock.method(PagePermission, 'find', () => ({ lean: async () => [{ viewUsers: [{ user: userId }] }] }));
  await authorizeCompanyTaskWrite(req, denied, () => assert.fail('View access does not allow edits'));
  assert.equal(denied.statusCode, 403);
  assert.equal(isCompanyTaskWrite(req, { company }), false);

  permission.mock.mockImplementation(() => ({ lean: async () => [{ editUsers: [{ user: userId }] }] }));
  const task = {
    _id: taskId, companyCode: 'TEST', taskFor: 'self', createdBy: userId,
    statusByUser: [], statusHistory: [], overallStatus: 'overdue',
    save: async () => {},
  };
  t.mock.method(Task, 'findById', async () => task);
  t.mock.method(ActivityLog, 'create', async () => ({}));
  req.body.status = 'pending';
  const res = response();
  await authorizeCompanyTaskWrite(req, res, () => personal.updateStatus(req, res));
  assert.equal(res.statusCode, 200);
  assert.equal(task.overallStatus, 'pending');
  assert.equal(task.statusByUser[0].status, 'pending');

  task.companyCode = 'OTHER';
  const crossCompany = response();
  await personal.updateStatus(req, crossCompany);
  assert.equal(crossCompany.statusCode, 403);
});
