const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Stub User.findById so database connection is not required
const User = require('../models/User');
User.findById = (id) => ({
  select: () => Promise.resolve({
    _id: id,
    companyCode: 'COMP01',
    jobRole: null
  })
});

const attendanceController = require('../HR-CDS/controllers/attendanceController');

test('parseIndiaDateOnly round-trips IST dates without losing a day to UTC conversion', () => {
  const dateKey = '2026-10-30';
  const parsedDate = attendanceController.parseIndiaDateOnly(dateKey);
  
  // Format back to IST date parts
  const istDateString = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsedDate);

  assert.equal(istDateString, '2026-10-30');
});

test('normalizeAttendanceStatusForSave produces canonical uppercase status strings', () => {
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('halfday'), 'HALF DAY');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('HALF DAY'), 'HALF DAY');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('uninformedleave'), 'UNINFORMED LEAVE');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('UNINFORMED LEAVE'), 'UNINFORMED LEAVE');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('present'), 'PRESENT');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('late'), 'LATE');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('absent'), 'ABSENT');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('holiday'), 'HOLIDAY');
  assert.equal(attendanceController.normalizeAttendanceStatusForSave('weekend'), 'WEEKEND');
});

test('previewAttendance calculates metrics for late check-in on default 09:00 shift', async () => {
  let responseStatus = 200;
  let responseBody = null;
  const res = {
    status: (code) => {
      responseStatus = code;
      return res;
    },
    json: (body) => {
      responseBody = body;
      return res;
    }
  };

  const previewReq = {
    body: {
      userId: new mongoose.Types.ObjectId().toString(),
      date: '2026-10-30',
      inTime: '2026-10-30T04:00:00.000Z', // 09:30 IST (late for 09:00 shift with 09:10 grace)
      outTime: '2026-10-30T13:30:00.000Z', // 19:00 IST
    },
    user: { _id: '000000000000000000000001', companyCode: 'COMP01' }
  };

  await attendanceController.previewAttendance(previewReq, res);
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.success, true);
  assert.equal(responseBody.data.suggestedStatus, 'LATE');
  assert.equal(responseBody.data.lateBy, '00:30:00');
  assert.equal(responseBody.data.earlyLeave, '00:00:00');
});

test('previewAttendance zeroes durations and preserves absent-type statuses', async () => {
  const req = {
    body: {
      userId: new mongoose.Types.ObjectId().toString(),
      date: '2026-10-30',
      status: 'uninformedleave'
    },
    user: { _id: '000000000000000000000001', companyCode: 'COMP01' }
  };

  let responseStatus = 200;
  let responseBody = null;
  const res = {
    status: (code) => {
      responseStatus = code;
      return res;
    },
    json: (body) => {
      responseBody = body;
      return res;
    }
  };

  await attendanceController.previewAttendance(req, res);
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.data.suggestedStatus, 'UNINFORMED LEAVE');
  assert.equal(responseBody.data.lateBy, '00:00:00');
  assert.equal(responseBody.data.earlyLeave, '00:00:00');
  assert.equal(responseBody.data.overTime, '00:00:00');
  assert.equal(responseBody.data.workingHours, '00:00:00');
});

test('updateAttendanceRecord returns 409 conflict when moving date to an existing attendance day', async () => {
  const Attendance = require('../HR-CDS/models/Attendance');
  const recordId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  // Stub Attendance.findById and Attendance.findOne
  const originalFindById = Attendance.findById;
  const originalFindOne = Attendance.findOne;

  try {
    Attendance.findById = () => ({
      _id: recordId,
      user: userId,
      companyCode: 'COMP01',
      date: new Date('2026-10-29T18:30:00.000Z'),
      status: 'PRESENT',
      save: async () => {}
    });

    // An existing record already exists on the target date
    Attendance.findOne = () => Promise.resolve({
      _id: new mongoose.Types.ObjectId(),
      user: userId,
      date: new Date('2026-10-28T18:30:00.000Z'),
      status: 'PRESENT'
    });

    let statusCode = 200;
    let jsonResult = null;
    const res = {
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonResult = data; return res; }
    };

    const req = {
      params: { id: recordId.toString() },
      body: { date: '2026-10-29' },
      user: { _id: 'admin-id', role: 'ADMIN', companyCode: 'COMP01' }
    };

    await attendanceController.updateAttendanceRecord(req, res);
    assert.equal(statusCode, 409);
    assert.ok(jsonResult.message.includes('already exists'));
  } finally {
    Attendance.findById = originalFindById;
    Attendance.findOne = originalFindOne;
  }
});
