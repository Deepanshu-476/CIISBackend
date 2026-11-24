const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const AttendanceController = require('../HR-CDS/controllers/AttendanceController.js');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');
  const vansh = await users.findOne({ email: 'ciisvanshgupta@gmail.com' });

  const req = {
    user: vansh,
    query: {
      month: '11',
      year: '2026'
    }
  };

  let output = null;
  const res = {
    status: (code) => ({
      json: (data) => {
        output = data;
      }
    })
  };

  await AttendanceController.getAttendanceList(req, res);

  if (output && output.data) {
    console.log('List returned for Vansh (last 10 days):');
    output.data.filter(d => d.dateKey >= '2026-11-14').forEach(d => {
      console.log(`${d.dateKey} (${new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}): status=${d.status}, isWeeklyOff=${d.isWeeklyOff}, notes=${d.notes}`);
    });
  } else {
    console.log('Output error:', output);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
