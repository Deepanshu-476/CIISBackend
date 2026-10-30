require("dotenv").config();
const mongoose = require("mongoose");

// One-off repair for tasks whose statusByUser has more than one entry for the same user.
// Before the Task.checkAndMarkOverdue fix, the overdue cron (which populates assignedUsers) pushed a
// second "overdue" entry per user and left the old entry first, so lookups returned the stale status.
// Keeps the most recently updated entry per user. Dry run by default; pass --apply to write.
const APPLY = process.argv.includes("--apply");

const entryTime = entry => new Date(entry?.updatedAt || 0).getTime() || 0;

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing in environment");
  await mongoose.connect(process.env.MONGO_URI);
  const tasks = mongoose.connection.db.collection("tasks");

  const cursor = tasks.aggregate([
    { $match: { "statusByUser.1": { $exists: true } } },
    { $project: { statusByUser: 1, updatedAt: 1, userCount: { $size: { $setUnion: [{ $map: { input: "$statusByUser", as: "s", in: "$$s.user" } }, []] } }, entryCount: { $size: "$statusByUser" } } },
    { $match: { $expr: { $lt: ["$userCount", "$entryCount"] } } },
  ], { allowDiskUse: true });

  let affected = 0;
  let removed = 0;
  for await (const task of cursor) {
    const latest = new Map();
    task.statusByUser.forEach((entry, index) => {
      const key = String(entry.user);
      const current = latest.get(key);
      if (!current || entryTime(entry) >= entryTime(current.entry)) latest.set(key, { entry, index });
    });
    const kept = [...latest.values()].sort((a, b) => a.index - b.index).map(item => item.entry);
    affected += 1;
    removed += task.statusByUser.length - kept.length;
    if (APPLY) {
      await tasks.updateOne({ _id: task._id, updatedAt: task.updatedAt }, { $set: { statusByUser: kept } });
    }
  }

  console.log(`${APPLY ? "Fixed" : "Would fix"} ${affected} tasks, removing ${removed} duplicate statusByUser entries.`);
  if (!APPLY && affected) console.log("Run again with --apply to write the changes.");
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
