const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.NODE_ENV = 'test';

const { Types } = require('mongoose');
const Task = require('../HR-CDS/models/Task');
const ClientTask = require('../HR-CDS/models/ClientTask');
const Group = require('../HR-CDS/models/Group');
const { Project } = require('../HR-CDS/models/Project');
const assigned = require('../HR-CDS/controllers/assignedTaskController');
const personal = require('../HR-CDS/controllers/selfTaskController');
const client = require('../HR-CDS/controllers/ClientTask');
const project = require('../HR-CDS/controllers/projectController');
const { preserveCheckpointProgress } = require('../HR-CDS/utils/taskCheckpoints');

const userId = new Types.ObjectId();
const checkpointId = new Types.ObjectId();
const taskId = new Types.ObjectId();

const invoke = async (handler, completed = true) => {
  const req = {
    params: { taskId, projectId: new Types.ObjectId(), checkpointId },
    user: { _id: userId, id: userId.toString() },
    body: { completed },
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  return res;
};

test('all four checkpoint routes reject inactive task statuses before saving', async t => {
  t.mock.method(Group, 'find', () => ({select: () => ({lean: async () => []})}));
  const task = {
    createdBy: userId,
    assignedUsers: [userId],
    assignedGroups: [],
    assignedTo: userId,
    assigneeId: userId,
    taskFor: 'self',
    statusByUser: [],
    checkpoints: { id: () => assert.fail('Locked checkpoints must never be touched') },
  };
  t.mock.method(Task, 'findById', async () => task);
  t.mock.method(ClientTask, 'findById', async () => task);
  t.mock.method(Project, 'findById', async () => ({tasks: {id: () => task}}));

  for (const status of ['pending', 'on hold', 'overdue', 'completed', 'reopen', 'cancelled']) {
    task.status = task.overallStatus = status;
    for (const handler of [assigned.updateCheckpoint, personal.updateCheckpoint, client.updateTaskCheckpoint, project.updateTaskCheckpoint]) {
      const response = await invoke(handler, status !== 'completed');
      assert.equal(response.statusCode, 409);
      assert.match(response.body.error || response.body.message, /In Progress/);
    }
  }

  task.overallStatus = 'in-progress';
  task.statusByUser = [{ user: userId, status: 'pending' }];
  assert.equal((await invoke(assigned.updateCheckpoint)).statusCode, 409);
});

test('a project task allows updates in progress and locks again after its last checkpoint', async t => {
  const checkpoint = { title: 'Review', completed: false };
  const checkpoints = Object.assign([checkpoint], { id: () => checkpoint });
  const task = {
    _id: taskId,
    assignedTo: userId,
    checkpoints,
    activityLogs: [],
    status: 'in progress',
    updatedAt: new Date('2026-11-18T08:00:00Z'),
  };
  const priorUpdatedAt = task.updatedAt;
  const parent = {tasks: {id: () => task}, save: async () => {}};
  const save = t.mock.method(parent, 'save');
  t.mock.method(Project, 'findById', async () => parent);

  assert.equal((await invoke(project.updateTaskCheckpoint)).statusCode, 200);
  assert.equal(task.status, 'completed');
  assert.equal(checkpoint.completed, true);
  assert.deepEqual(parent.$where.tasks.$elemMatch, { _id: taskId, status: 'in progress', updatedAt: priorUpdatedAt });
  assert.equal((await invoke(project.updateTaskCheckpoint, false)).statusCode, 409);
  assert.equal(save.mock.callCount(), 1);
});

test('editing checklist structure preserves saved progress and adds new steps unchecked', () => {
  const completedAt = new Date();
  const saved = [{_id: checkpointId, title: 'Review', completed: true, completedAt, completedBy: userId}];
  const edited = [{_id: checkpointId, title: 'Review draft', completed: false}, {title: 'Upload', completed: true}];
  assert.deepEqual(preserveCheckpointProgress(saved, edited), [
    {...saved[0], title: 'Review draft'},
    {title: 'Upload', completed: false, completedAt: null, completedBy: null},
  ]);
});
