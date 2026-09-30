require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  const db = mongoose.connection.db;
  const company = await db.collection('companies').findOne({ companyCode: 'TECHSOFT', companyName: 'techsoftsolutions' });
  if (!company) throw new Error('Techsoft company missing');
  const users = await db.collection('users').find({ company: company._id }).sort({ employeeId: 1 }).toArray();
  if (users.length !== 68) throw new Error(`Expected 68 users, found ${users.length}`);
  const owner = users.find(u => u.email === 'vansh24810@gmail.com' && u.companyRole === 'Owner');
  if (!owner) throw new Error('Expected owner login missing');

  const allEmails = await db.collection('users').distinct('email');
  const reserved = new Set(allEmails.map(e => String(e).toLowerCase()));
  for (const u of users) reserved.delete(String(u.email).toLowerCase());
  reserved.add(owner.email.toLowerCase());
  const changes = [];
  for (const user of users) {
    if (String(user._id) === String(owner._id)) continue;
    const firstName = String(user.name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!firstName) throw new Error(`No usable first name for ${user.employeeId}`);
    let suffix = 1;
    let next = `test${firstName}@gmail.com`;
    while (reserved.has(next)) next = `test${firstName}${++suffix}@gmail.com`;
    reserved.add(next);
    changes.push({ id: user._id, oldEmail: user.email, email: next, name: user.name });
  }
  console.log(JSON.stringify({ count: changes.length, examples: changes.slice(0, 5).map(c => ({ name: c.name, email: c.email })) }));
  if (!process.argv.includes('--apply')) return;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const result = await db.collection('users').bulkWrite(changes.map(c => ({
        updateOne: { filter: { _id: c.id, company: company._id, email: c.oldEmail }, update: { $set: { email: c.email, updatedAt: new Date() } } }
      })), { session });
      if (result.matchedCount !== changes.length) throw new Error('User records changed during update');
    });
  } finally { await session.endSession(); }
  const saved = await db.collection('users').find({ company: company._id }, { projection: { _id: 1, email: 1 } }).toArray();
  for (const c of changes) if (saved.find(u => String(u._id) === String(c.id))?.email !== c.email) throw new Error('Verification failed');
  const reportPath = path.resolve(__dirname, '../../audit-tools/techsoftsolutions-setup.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const row of report.users) {
    const match = changes.find(c => c.oldEmail === row.email);
    if (match) row.email = match.email;
  }
  report.userEmailsUpdatedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ updated: changes.length, verified: true, ownerEmail: owner.email }));
}
main().catch(e => { console.error(e.name, e.message.replace(/mongodb\S*/g, '[redacted]')); process.exitCode = 1; }).finally(() => mongoose.disconnect());
