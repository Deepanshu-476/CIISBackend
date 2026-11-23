const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { isOffDayFor, effectiveWorkingDays, offWeekdaysForWeek, weekOffEntitlement } = require('../HR-CDS/utils/weekOff.js');

async function run() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const users = mongoose.connection.collection('users');
  const departments = mongoose.connection.collection('departments');

  const vansh = await users.findOne({ email: 'ciisvanshgupta@gmail.com' });
  console.log('vansh dept:', vansh.department, vansh.departmentName);

  // Let's find department in departments collection
  const deptDoc = await departments.findOne({ name: vansh.departmentName }) 
    || await departments.findOne({ name: 'IT_TEAM' });
  console.log('deptDoc:', deptDoc ? { name: deptDoc.name, workingDays: deptDoc.workingDays } : 'Not found');

  const satDate = new Date('2026-11-21T05:00:00.000Z');
  const contextWithoutDept = { department: null, weekOffDays: vansh.weekOffDays || [], swaps: [] };
  const contextWithDept = { department: deptDoc, weekOffDays: vansh.weekOffDays || [], swaps: [] };

  console.log('Without dept: isOffDayFor Sat:', isOffDayFor(contextWithoutDept, satDate));
  console.log('With dept: isOffDayFor Sat:', isOffDayFor(contextWithDept, satDate));
  console.log('dept workingDays:', deptDoc?.workingDays);

  // Check what resolveUserDepartmentDoc did:
  const AttendanceController = require('../HR-CDS/controllers/AttendanceController.js');

  await mongoose.disconnect();
}

run().catch(console.error);
