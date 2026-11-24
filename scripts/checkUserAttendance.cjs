const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const EMAIL = 'officialmailcds@gmail.com';

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');
  const attendances = mongoose.connection.collection('attendances');

  const user = await users.findOne({ email: { $regex: `^${EMAIL}$`, $options: 'i' } });
  if (!user) throw new Error(`User not found: ${EMAIL}`);

  console.log('User found:', {
    id: user._id,
    name: user.name,
    email: user.email,
    shiftId: user.shiftId,
    shiftName: user.shiftName,
    companyCode: user.companyCode
  });

  // Query records from 16 Nov 2026 onwards
  // 16 Nov 2026 00:00 IST is 2026-11-15T18:30:00.000Z
  const startDate = new Date('2026-11-15T18:30:00.000Z');
  const records = await attendances.find({
    user: user._id,
    date: { $gte: startDate }
  }).sort({ date: 1 }).toArray();

  console.log(`Found ${records.length} records since 16 Nov:`);
  records.forEach(r => {
    console.log({
      id: r._id,
      date: r.date,
      inTime: r.inTime,
      outTime: r.outTime,
      status: r.status,
      notes: r.notes,
      totalTime: r.totalTime,
      isClockedIn: r.isClockedIn
    });
  });

  // Also check some past PRESENT records of this user to see their normal timings / location / shift
  const pastPresent = await attendances.find({
    user: user._id,
    status: 'PRESENT'
  }).sort({ date: -1 }).limit(3).toArray();

  console.log('\nPast PRESENT samples:');
  pastPresent.forEach(p => {
    console.log({
      date: p.date,
      inTime: p.inTime,
      outTime: p.outTime,
      inLocation: p.inLocation,
      shiftName: p.shiftName,
      shiftTime: p.shiftTime,
      grossTime: p.grossTime,
      totalTime: p.totalTime
    });
  });

  await mongoose.disconnect();
}

run().catch(console.error);

