const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const EMAIL = 'ciisvanshgupta@gmail.com';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function indiaDayStart(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');
  const attendances = mongoose.connection.collection('attendances');
  const user = await users.findOne({ email: { $regex: `^${EMAIL}$`, $options: 'i' } });
  if (!user) throw new Error(`User not found: ${EMAIL}`);

  const dayStart = indiaDayStart();
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const inTime = new Date(dayStart.getTime() + (9 * 60 + 8) * 60 * 1000);
  const existing = await attendances.findOne({ user: user._id, date: { $gte: dayStart, $lte: dayEnd } });
  if (existing) {
    console.log(JSON.stringify({ result: 'already_exists', id: String(existing._id), status: existing.status, inTime: existing.inTime }, null, 2));
    return;
  }

  const document = {
    user: user._id,
    date: dayStart,
    inTime,
    outTime: null,
    clockOutMode: null,
    status: 'PRESENT',
    lateBy: '00:00:00',
    earlyLeave: '00:00:00',
    overTime: '00:00:00',
    totalTime: '00:00:00',
    isClockedIn: true,
    companyCode: user.companyCode,
    shiftId: user.shiftId || '6a61dfda599036beec8c3b29',
    shiftName: 'General Shift',
    shiftType: 'general',
    shiftStart: '09:00',
    shiftEnd: '19:00',
    shiftTime: '09:00 AM - 07:00 PM',
    earlyClockInStart: '08:30',
    lateGraceLimit: '09:10',
    halfDayLateLimit: '11:00',
    shortLeaveEarlyLimit: '18:30',
    halfDayEarlyLimit: '15:00',
    shiftWindow: { start: new Date(dayStart.getTime() + 9 * 60 * 60 * 1000), end: new Date(dayStart.getTime() + 19 * 60 * 60 * 1000) },
    notes: 'Manual attendance entry: clocked in at 09:08 AM IST.',
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const result = await attendances.insertOne(document);
  const saved = await attendances.findOne({ _id: result.insertedId });
  console.log(JSON.stringify({ result: 'created', id: String(saved._id), date: saved.date, inTime: saved.inTime, status: saved.status, isClockedIn: saved.isClockedIn }, null, 2));
}

run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
