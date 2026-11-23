const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const weekOffRequests = mongoose.connection.collection('weekoffrequests');
  const attendances = mongoose.connection.collection('attendances');

  // 1. Delete test swap requests
  const delRes = await weekOffRequests.deleteMany({
    _id: {
      $in: [
        new mongoose.Types.ObjectId('6afa9f8d140839b0c76e6fa9'),
        new mongoose.Types.ObjectId('6b001e17ebb2f8136682ba70')
      ]
    }
  });
  console.log('Deleted test swap requests count:', delRes.deletedCount);

  // 2. Delete Pawan's Saturday 21 Nov present record
  const delPawanSat = await attendances.deleteOne({
    _id: new mongoose.Types.ObjectId('6b03bcca82377f5262c85ece')
  });
  console.log('Deleted Pawan Sat present record count:', delPawanSat.deletedCount);

  // 3. Test getAttendanceList for Vansh
  const AttendanceController = require('../HR-CDS/controllers/AttendanceController.js');
  const User = mongoose.model('User');
  const vansh = await User.findOne({ email: 'ciisvanshgupta@gmail.com' });
  const pawan = await User.findOne({ email: 'officialmailcds@gmail.com' });

  const getList = async (user) => {
    let result = null;
    await AttendanceController.getAttendanceList({
      user,
      params: {},
      query: { month: '10', year: '2026' }
    }, {
      status: () => ({ json: (data) => { result = data; } })
    });
    return result?.data?.filter(d => d.dateKey >= '2026-11-16' && d.dateKey <= '2026-11-23');
  };

  console.log('\n--- NEW VANSH ATTENDANCE (16-23 Nov) ---');
  const vanshList = await getList(vansh);
  vanshList.forEach(item => {
    console.log(`${item.dateKey} (${new Date(item.date).toLocaleDateString('en-US', { weekday: 'short' })}): status=${item.status}, isWeeklyOff=${item.isWeeklyOff}, notes=${item.notes}`);
  });

  console.log('\n--- NEW PAWAN ATTENDANCE (16-23 Nov) ---');
  const pawanList = await getList(pawan);
  pawanList.forEach(item => {
    console.log(`${item.dateKey} (${new Date(item.date).toLocaleDateString('en-US', { weekday: 'short' })}): status=${item.status}, isWeeklyOff=${item.isWeeklyOff}, notes=${item.notes}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
