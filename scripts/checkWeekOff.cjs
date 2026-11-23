const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');
  const attendances = mongoose.connection.collection('attendances');

  const pawan = await users.findOne({ email: 'officialmailcds@gmail.com' });

  // Let's check company attendance settings / week off policy
  const companies = mongoose.connection.collection('companies');
  const company = await companies.findOne({ _id: pawan.company });
  console.log('Company weekOff settings:', company?.attendanceSettings?.weekOff || company?.attendanceSettings);

  // Check branch
  const branches = mongoose.connection.collection('branches');
  const branch = await branches.findOne({ _id: pawan.branch });
  console.log('Branch weekOff settings:', branch?.attendanceSettings?.weekOff || branch?.attendanceSettings);

  // Let's check other users' attendance on 21 Nov 2026 (Saturday)
  const satRecords = await attendances.find({
    date: new Date('2026-11-20T18:30:00.000Z') // 21 Nov IST
  }).toArray();
  console.log('21 Nov (Saturday) records count:', satRecords.length);
  const satStatuses = {};
  satRecords.forEach(r => {
    satStatuses[r.status] = (satStatuses[r.status] || 0) + 1;
  });
  console.log('21 Nov statuses:', satStatuses);

  // Let's check 22 Nov 2026 (Sunday)
  const sunRecords = await attendances.find({
    date: new Date('2026-11-21T18:30:00.000Z') // 22 Nov IST
  }).toArray();
  console.log('22 Nov (Sunday) records count:', sunRecords.length);
  const sunStatuses = {};
  sunRecords.forEach(r => {
    sunStatuses[r.status] = (sunStatuses[r.status] || 0) + 1;
  });
  console.log('22 Nov statuses:', sunStatuses);

  await mongoose.disconnect();
}

run().catch(console.error);

