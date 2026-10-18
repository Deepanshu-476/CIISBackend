require("dotenv").config();
const mongoose = require("mongoose");

// Meetings used to take companyCode from the client (web falls back to a hard-coded "CAREER" when it cannot
// find one). /api/meetings is now scoped to the caller's companyCode, so a meeting saved with the wrong code
// disappears from its company's lists. This reports meetings whose companyCode differs from their creator's
// (or, without a creator, their attendees') company and fixes them with --apply.
const APPLY = process.argv.includes("--apply");

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing in environment");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const meetings = db.collection("meetings");
  const users = db.collection("users");

  const codeCache = new Map();
  const userCode = async id => {
    if (!id) return null;
    const key = String(id);
    if (!codeCache.has(key)) {
      const user = await users.findOne({ _id: new mongoose.Types.ObjectId(key) }, { projection: { companyCode: 1 } }).catch(() => null);
      codeCache.set(key, user?.companyCode || null);
    }
    return codeCache.get(key);
  };

  let checked = 0;
  let wrong = 0;
  const examples = [];
  for await (const meeting of meetings.find({}, { projection: { companyCode: 1, createdBy: 1, attendees: 1, title: 1 } })) {
    checked += 1;
    let expected = await userCode(meeting.createdBy);
    if (!expected) {
      for (const attendee of meeting.attendees || []) {
        expected = await userCode(attendee);
        if (expected) break;
      }
    }
    if (!expected || expected === meeting.companyCode) continue;
    wrong += 1;
    if (examples.length < 10) examples.push(`${meeting._id} "${meeting.title}" ${meeting.companyCode} -> ${expected}`);
    if (APPLY) await meetings.updateOne({ _id: meeting._id }, { $set: { companyCode: expected } });
  }

  console.log(`Checked ${checked} meetings; ${wrong} have a companyCode different from their company.`);
  examples.forEach(line => console.log(`  ${line}`));
  if (wrong) console.log(APPLY ? "Fixed." : "Run again with --apply to fix them.");
};

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
