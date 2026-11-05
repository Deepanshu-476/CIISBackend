const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { Project } = require('../HR-CDS/models/Project');

const oid = () => new mongoose.Types.ObjectId();

test('adding a task or remark reads only the affected task and still records its chat event', async t => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  t.after(async () => {
    mongoose.set('debug', false);
    await mongoose.disconnect();
    await mongo.stop();
  });

  const owner = oid();
  const tasks = Array.from({ length: 300 }, (_, index) => ({
    _id: oid(), title: `Existing ${index}`, status: 'pending', createdBy: owner,
    activityLogs: [{ type: 'creation', description: 'created', performedBy: owner }],
    remarks: [{ text: `remark ${index}`, createdBy: owner }],
  }));
  const projectId = oid();
  await Project.collection.insertOne({
    _id: projectId, projectName: 'ZZTEST Big Project', createdBy: owner, users: [owner], tasks,
    chatOutbox: [], chatSyncPending: false, __v: 0,
  });
  const outbox = async () => (await Project.collection.findOne({ _id: projectId })).chatOutbox;

  // Count how many tasks each read of the project brings back.
  const loaded = [];
  const originalFindOne = Project.collection.findOne.bind(Project.collection);
  Project.collection.findOne = async (...args) => {
    const doc = await originalFindOne(...args);
    loaded.push(doc?.tasks?.length ?? 0);
    return doc;
  };
  t.after(() => { Project.collection.findOne = originalFindOne; });

  const newTask = { _id: oid(), title: 'Brand new task', status: 'pending', createdBy: owner, activityLogs: [{ type: 'creation', performedBy: owner }] };
  await Project.updateOne({ _id: projectId, 'tasks._id': { $ne: newTask._id } }, { $push: { tasks: newTask }, $set: { updatedAt: new Date() } });
  assert.deepEqual(loaded, [0], 'a new task reads no existing tasks');
  Project.collection.findOne = originalFindOne;
  let events = await outbox();
  assert.deepEqual(events.map(event => event.type), ['task_created']);
  assert.equal(String(events[0].task), String(newTask._id));

  loaded.length = 0;
  Project.collection.findOne = async (...args) => {
    const doc = await originalFindOne(...args);
    loaded.push(doc?.tasks?.length ?? 0);
    return doc;
  };
  const target = tasks[150];
  await Project.updateOne(
    { _id: projectId, 'tasks._id': target._id },
    { $push: { 'tasks.$.remarks': { _id: oid(), text: 'New remark', createdBy: owner } } }
  );
  assert.deepEqual(loaded, [1], 'a remark reads only its task');
  Project.collection.findOne = originalFindOne;
  events = await outbox();
  assert.deepEqual(events.map(event => event.type), ['task_created', 'task_remark_added']);
  assert.equal(String(events[1].task), String(target._id));

  const stored = await Project.collection.findOne({ _id: projectId });
  assert.equal(stored.tasks.length, 301);
  assert.equal(stored.tasks.find(task => String(task._id) === String(target._id)).remarks.length, 2);
});
