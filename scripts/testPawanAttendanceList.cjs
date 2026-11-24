const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');
  const pawan = await users.findOne({ email: 'officialmailcds@gmail.com' });

  // Let's call the attendance list handler or inspect the controller logic
  const AttendanceController = require('../HR-CDS/controllers/AttendanceController.js');

  const req = {
    user: {
      _id: pawan._id,
      email: pawan.email,
      role: 'user',
      companyCode: 'CAREER',
      company: pawan.company,
      branch: pawan.branch
    },
    query: {
      userId: pawan._id.toString(),
      month: '11',
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
    const novList = resData.data.filter(d => d.dateKey >= '2026-11-16');
    console.log('Pawan November list from 16 Nov:');
    novList.forEach(item => {
      console.log(`${item.dateKey}: status=${item.status}, inTime=${item.inTime}, outTime=${item.outTime}, totalTime=${item.totalTime}, notes=${item.notes}`);
    });
  } else {
    console.log('Error/No data:', resData);
  }

  await mongoose.disconnect();
}

run().catch(console.error);

