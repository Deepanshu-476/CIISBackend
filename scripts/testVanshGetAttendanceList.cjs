const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const AttendanceController = require('../HR-CDS/controllers/AttendanceController.js');
  const User = mongoose.model('User');

  const vansh = await User.findOne({ email: 'ciisvanshgupta@gmail.com' });

  const req = {
    user: vansh,
    params: {},
    query: {
      month: '10', // 0-indexed: 10 is November!
      year: '2026'
    }
  };

  let resData = null;
  const res = {
    status: (code) => ({
      json: (data) => {
        resData = data;
      }
    })
  };

  await AttendanceController.getAttendanceList(req, res);

  if (resData && resData.data) {
    console.log('--- VANSH ATTENDANCE LIST (16 Nov to 23 Nov) ---');
    const filtered = resData.data.filter(d => d.dateKey >= '2026-11-14' && d.dateKey <= '2026-11-23');
    filtered.forEach(item => {
      console.log(`${item.dateKey} (${new Date(item.date).toLocaleDateString('en-US', { weekday: 'short' })}): status=${item.status}, isWeeklyOff=${item.isWeeklyOff}, notes=${item.notes}`);
    });
  } else {
    console.log('Error/No data:', resData);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
