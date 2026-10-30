require('dotenv').config();
const mongoose = require('mongoose');

// Task lists show a task on the day its status last changed (statusChangedAt),
// otherwise on its due date. Status endpoints record statusChangedAt from now on;
// this fills it once for older project and client tasks from their activity logs,
// so list requests never have to scan logs. Writes go straight to the collections:
// no chat events, no version bumps. Only tasks without statusChangedAt are touched.
const STATUS_LOG_TYPES = ['status_change', 'status_changed'];
const CLIENT_STATUS_ACTIONS = ['status_updated', 'completed', 'reopened'];
const BATCH = 500;

const latest = dates => dates.filter(Boolean).map(value => new Date(value))
  .filter(date => !Number.isNaN(date.getTime()))
  .sort((a, b) => b - a)[0] || null;

async function flush(collection, ops, apply) {
  if (apply && ops.length) await collection.bulkWrite(ops, { ordered: false });
  ops.length = 0;
}

async function backfillProjects(db, apply) {
  const projects = db.collection('projects');
  const ops = [];
  let tasks = 0, updated = 0;
  const cursor = projects.find(
    { 'tasks.0': { $exists: true } },
    { projection: { 'tasks._id': 1, 'tasks.statusChangedAt': 1, 'tasks.activityLogs.type': 1, 'tasks.activityLogs.newValue': 1, 'tasks.activityLogs.performedAt': 1 } }
  );
  for await (const project of cursor) {
    for (const task of project.tasks || []) {
      tasks++;
      if (task.statusChangedAt) continue;
      // Automatic overdue marking is not a user change.
      const at = latest((task.activityLogs || [])
        .filter(log => log && STATUS_LOG_TYPES.includes(log.type) && String(log.newValue || '').toLowerCase() !== 'overdue')
        .map(log => log.performedAt));
      if (!at) continue;
      updated++;
      ops.push({ updateOne: {
        filter: { _id: project._id },
        update: { $set: { 'tasks.$[task].statusChangedAt': at } },
        arrayFilters: [{ 'task._id': task._id, 'task.statusChangedAt': { $in: [null] } }],
      } });
      if (ops.length >= BATCH) await flush(projects, ops, apply);
    }
  }
  await flush(projects, ops, apply);
  return { tasks, updated };
}

async function backfillClientTasks(db, apply) {
  const clientTasks = db.collection('clienttasks');
  const ops = [];
  let tasks = 0, updated = 0;
  const cursor = clientTasks.find(
    { statusChangedAt: { $in: [null] } },
    { projection: { 'activityLogs.action': 1, 'activityLogs.newValues': 1, 'activityLogs.createdAt': 1, completedAt: 1, inProgressSince: 1 } }
  );
  for await (const task of cursor) {
    tasks++;
    const at = latest([
      ...(task.activityLogs || [])
        .filter(log => log && CLIENT_STATUS_ACTIONS.includes(log.action) && String(log.newValues?.status || '').toLowerCase() !== 'overdue')
        .map(log => log.createdAt),
      task.completedAt,
      task.inProgressSince,
    ]);
    if (!at) continue;
    updated++;
    ops.push({ updateOne: { filter: { _id: task._id, statusChangedAt: { $in: [null] } }, update: { $set: { statusChangedAt: at } } } });
    if (ops.length >= BATCH) await flush(clientTasks, ops, apply);
  }
  await flush(clientTasks, ops, apply);
  return { tasks, updated };
}

async function main() {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const project = await backfillProjects(db, apply);
  const client = await backfillClientTasks(db, apply);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', projectTasks: project, clientTasks: client }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
