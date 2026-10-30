require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// An earlier overdue job re-marked tasks that were already overdue on every run,
// so some tasks have thousands of identical statusHistory / statusByUser entries
// (one had 4,066). Every task list and stats request reads those arrays.
// This removes only repeats that changed nothing: an automatic overdue entry
// directly after an overdue entry (for statusByUser: for the same user).
// The first overdue entry, and every real change, is kept.
//   node scripts/dedupeOverdueStatusEntries.js            (dry run)
//   node scripts/dedupeOverdueStatusEntries.js --apply    (writes a JSON backup first)
const AUTO_REMARK = /automatically marked overdue|automatic overdue|marked as overdue/i;
const isOverdue = entry => String(entry?.status || '').toLowerCase() === 'overdue';
const isAutoRepeat = (previous, entry) => isOverdue(previous) && isOverdue(entry) && AUTO_REMARK.test(String(entry?.remarks || ''));

const dedupeHistory = list => list.filter((entry, index) => index === 0 || !isAutoRepeat(list[index - 1], entry));

const dedupeByUser = list => {
  const lastByUser = new Map();
  return list.filter(entry => {
    const key = String(entry?.user || '');
    const previous = lastByUser.get(key);
    lastByUser.set(key, entry);
    return !(previous && isAutoRepeat(previous, entry));
  });
};

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  const tasks = mongoose.connection.db.collection('tasks');
  const cursor = tasks.find(
    { $or: [{ 'statusHistory.20': { $exists: true } }, { 'statusByUser.20': { $exists: true } }] },
    { projection: { statusHistory: 1, statusByUser: 1, companyCode: 1, title: 1 } }
  );
  const summary = { mode: apply ? 'apply' : 'dry-run', tasks: 0, historyRemoved: 0, statusByUserRemoved: 0 };
  const changes = [];
  for await (const task of cursor) {
    const history = Array.isArray(task.statusHistory) ? task.statusHistory : [];
    const byUser = Array.isArray(task.statusByUser) ? task.statusByUser : [];
    const nextHistory = dedupeHistory(history);
    const nextByUser = dedupeByUser(byUser);
    if (nextHistory.length === history.length && nextByUser.length === byUser.length) continue;
    summary.tasks++;
    summary.historyRemoved += history.length - nextHistory.length;
    summary.statusByUserRemoved += byUser.length - nextByUser.length;
    if (apply) changes.push({ task, nextHistory, nextByUser });
  }
  if (apply && changes.length) {
    summary.backup = path.join(__dirname, `overdueStatus-backup-${Date.now()}.json`);
    fs.writeFileSync(summary.backup, JSON.stringify(changes.map(change => change.task)));
    summary.written = 0;
    for (const { task, nextHistory, nextByUser } of changes) {
      // Only write if the arrays are unchanged since they were read.
      const result = await tasks.updateOne(
        { _id: task._id, statusHistory: task.statusHistory, statusByUser: task.statusByUser },
        { $set: { statusHistory: nextHistory, statusByUser: nextByUser } }
      );
      summary.written += result.modifiedCount;
    }
  }
  console.log(JSON.stringify(summary));
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { dedupeHistory, dedupeByUser };
