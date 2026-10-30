/**
 * Automated Live Testing Suite for Employee Section (Company: TECH334753)
 * Target Server: https://backendcds.ciisnetwork.in
 */

const axios = require('axios');

const LIVE_BASE_URL = 'https://backendcds.ciisnetwork.in';
const COMPANY_CODE = 'TECH334753';

const EMPLOYEE_CREDS = {
  email: 'vanshtest@gmail.com',
  password: '0987654321',
  companyCode: COMPANY_CODE,
};

const ADMIN_CREDS = {
  email: 'vansh24810@gmail.com',
  password: '0987654321',
  companyCode: COMPANY_CODE,
};

const results = [];

function report(testName, passed, details) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${status}] ${testName}`);
  if (details) console.log(`       Details: ${details}`);
  results.push({ testName, passed, details });
}

async function run() {
  console.log('========================================================');
  console.log('Testing Employee Section on LIVE URL: ' + LIVE_BASE_URL);
  console.log('Company: TECH334753 | Employee: ' + EMPLOYEE_CREDS.email);
  console.log('========================================================\n');

  let empToken = '';
  let empUser = null;
  let adminToken = '';
  let adminUser = null;

  // 1. Employee Login
  try {
    const res = await axios.post(`${LIVE_BASE_URL}/api/auth/login`, EMPLOYEE_CREDS);
    empToken = res.data.token;
    empUser = res.data.user || res.data.data;
    report('1. Employee Login (POST /api/auth/login)', true, `Logged in as: ${empUser?.name} (${empUser?.companyRole})`);
  } catch (err) {
    report('1. Employee Login (POST /api/auth/login)', false, err.response?.data?.message || err.message);
  }

  // 2. Admin Login
  try {
    const res = await axios.post(`${LIVE_BASE_URL}/api/auth/login`, ADMIN_CREDS);
    adminToken = res.data.token;
    adminUser = res.data.user || res.data.data;
    report('2. Admin Login (POST /api/auth/login)', true, `Logged in as: ${adminUser?.name} (${adminUser?.companyRole})`);
  } catch (err) {
    report('2. Admin Login (POST /api/auth/login)', false, err.response?.data?.message || err.message);
  }

  const empAxios = axios.create({
    baseURL: LIVE_BASE_URL,
    headers: { Authorization: `Bearer ${empToken}` },
    validateStatus: () => true,
  });

  const adminAxios = axios.create({
    baseURL: LIVE_BASE_URL,
    headers: { Authorization: `Bearer ${adminToken}` },
    validateStatus: () => true,
  });

  // 3. Employee Profile
  const profileRes = await empAxios.get('/api/users/profile');
  if (profileRes.status === 200) {
    report('3. Employee Profile (GET /api/users/profile)', true, `Name: ${profileRes.data.name || profileRes.data.user?.name}`);
  } else {
    report('3. Employee Profile (GET /api/users/profile)', false, `Status ${profileRes.status}: ${JSON.stringify(profileRes.data)}`);
  }

  // 4. Employee Attendance - Today Status
  const attTodayRes = await empAxios.get('/api/attendance/today');
  if (attTodayRes.status === 200) {
    report('4. Attendance Today Status (GET /api/attendance/today)', true, `Status: ${attTodayRes.data.status || 'OK'}`);
  } else {
    report('4. Attendance Today Status (GET /api/attendance/today)', false, `Status ${attTodayRes.status}: ${JSON.stringify(attTodayRes.data)}`);
  }

  // 5. Employee Attendance - Check-in
  const checkInRes = await empAxios.post('/api/attendance/check-in', {
    location: 'Office - Live Test',
  });
  if (checkInRes.status === 200 || checkInRes.status === 201) {
    report('5. Attendance Check-in (POST /api/attendance/check-in)', true, 'Checked in successfully');
  } else if (checkInRes.data?.message?.includes('already') || checkInRes.status === 400) {
    report('5. Attendance Check-in (POST /api/attendance/check-in)', true, `Note: ${checkInRes.data?.message}`);
  } else {
    report('5. Attendance Check-in (POST /api/attendance/check-in)', false, `Status ${checkInRes.status}: ${JSON.stringify(checkInRes.data)}`);
  }

  // 6. Employee Attendance History
  const attUserRes = await empAxios.get(`/api/attendance/user/${empUser?._id || empUser?.id}`);
  if (attUserRes.status === 200) {
    report('6. Employee Attendance History (GET /api/attendance/user/:id)', true, `Records: ${Array.isArray(attUserRes.data) ? attUserRes.data.length : attUserRes.data.attendance?.length || 0}`);
  } else {
    report('6. Employee Attendance History (GET /api/attendance/user/:id)', false, `Status ${attUserRes.status}: ${JSON.stringify(attUserRes.data)}`);
  }

  // 7. Admin View All Attendance
  const attAllRes = await adminAxios.get('/api/attendance/all');
  if (attAllRes.status === 200) {
    report('7. Admin View All Attendance (GET /api/attendance/all)', true, `Records found`);
  } else {
    report('7. Admin View All Attendance (GET /api/attendance/all)', false, `Status ${attAllRes.status}: ${JSON.stringify(attAllRes.data)}`);
  }

  // 8. Leave Types
  const leaveTypesRes = await empAxios.get('/api/leave-types');
  if (leaveTypesRes.status === 200) {
    report('8. Leave Types List (GET /api/leave-types)', true, `Types found: ${leaveTypesRes.data?.length || leaveTypesRes.data.data?.length || 0}`);
  } else {
    report('8. Leave Types List (GET /api/leave-types)', false, `Status ${leaveTypesRes.status}: ${JSON.stringify(leaveTypesRes.data)}`);
  }

  // 9. My Leaves
  const myLeavesRes = await empAxios.get('/api/leaves/my-leaves');
  if (myLeavesRes.status === 200) {
    report('9. Employee My Leaves (GET /api/leaves/my-leaves)', true, `Leaves: ${myLeavesRes.data?.length || myLeavesRes.data.leaves?.length || 0}`);
  } else {
    const altLeavesRes = await empAxios.get('/api/leaves');
    if (altLeavesRes.status === 200) {
      report('9. Employee My Leaves (GET /api/leaves)', true, `Leaves: ${altLeavesRes.data?.length || altLeavesRes.data.leaves?.length || 0}`);
    } else {
      report('9. Employee My Leaves (GET /api/leaves/my-leaves)', false, `Status ${myLeavesRes.status}: ${JSON.stringify(myLeavesRes.data)}`);
    }
  }

  // 10. Apply Leave
  const applyLeaveRes = await empAxios.post('/api/leaves', {
    leaveType: 'Casual',
    startDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    endDate: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
    reason: 'Test Casual Leave from QA script',
    days: 2,
  });
  if (applyLeaveRes.status === 200 || applyLeaveRes.status === 201) {
    report('10. Apply Leave (POST /api/leaves)', true, `Leave applied: ID ${applyLeaveRes.data?.leave?._id || applyLeaveRes.data?._id || 'OK'}`);
  } else {
    report('10. Apply Leave (POST /api/leaves)', false, `Status ${applyLeaveRes.status}: ${JSON.stringify(applyLeaveRes.data)}`);
  }

  // 11. Admin All Leaves
  const adminLeavesRes = await adminAxios.get('/api/leaves/all');
  if (adminLeavesRes.status === 200) {
    report('11. Admin View All Leaves (GET /api/leaves/all)', true, `Found leaves`);
  } else {
    report('11. Admin View All Leaves (GET /api/leaves/all)', false, `Status ${adminLeavesRes.status}: ${JSON.stringify(adminLeavesRes.data)}`);
  }

  // 12. Employee Assets Requests
  const assetReqRes = await empAxios.get('/api/asset-requests');
  if (assetReqRes.status === 200) {
    report('12. Employee Asset Requests (GET /api/asset-requests)', true, `Requests: ${assetReqRes.data?.length || assetReqRes.data.requests?.length || 0}`);
  } else {
    report('12. Employee Asset Requests (GET /api/asset-requests)', false, `Status ${assetReqRes.status}: ${JSON.stringify(assetReqRes.data)}`);
  }

  // 13. Company Assets List
  const compAssetsRes = await empAxios.get('/api/company-assets');
  if (compAssetsRes.status === 200) {
    report('13. Company Assets List (GET /api/company-assets)', true, `Assets: ${compAssetsRes.data?.length || compAssetsRes.data.assets?.length || 0}`);
  } else {
    report('13. Company Assets List (GET /api/company-assets)', false, `Status ${compAssetsRes.status}: ${JSON.stringify(compAssetsRes.data)}`);
  }

  // 14. Company Users / Employee Directory
  const compUsersRes = await empAxios.get('/api/users/company-users');
  if (compUsersRes.status === 200) {
    const list = compUsersRes.data.users || compUsersRes.data || [];
    report('14. Company Users Directory (GET /api/users/company-users)', true, `Found ${list.length} users`);
  } else {
    report('14. Company Users Directory (GET /api/users/company-users)', false, `Status ${compUsersRes.status}: ${JSON.stringify(compUsersRes.data)}`);
  }

  // 15. Department Users
  const deptUsersRes = await empAxios.get('/api/users/department-users');
  if (deptUsersRes.status === 200) {
    const list = deptUsersRes.data.users || deptUsersRes.data || [];
    report('15. Department Users Directory (GET /api/users/department-users)', true, `Found ${list.length} department users`);
  } else {
    report('15. Department Users Directory (GET /api/users/department-users)', false, `Status ${deptUsersRes.status}: ${JSON.stringify(deptUsersRes.data)}`);
  }

  // 16. Departments List
  const deptsRes = await empAxios.get('/api/departments');
  if (deptsRes.status === 200) {
    const list = deptsRes.data.departments || deptsRes.data || [];
    report('16. Departments List (GET /api/departments)', true, `Found ${list.length} departments`);
  } else {
    report('16. Departments List (GET /api/departments)', false, `Status ${deptsRes.status}: ${JSON.stringify(deptsRes.data)}`);
  }

  // 17. Employee Documents
  const empDocRes = await empAxios.get(`/api/users/${empUser?._id || empUser?.id}/documents`);
  if (empDocRes.status === 200) {
    report('17. Employee Documents (GET /api/users/:id/documents)', true, `Documents: ${empDocRes.data?.documents?.length || empDocRes.data?.length || 0}`);
  } else {
    report('17. Employee Documents (GET /api/users/:id/documents)', false, `Status ${empDocRes.status}: ${JSON.stringify(empDocRes.data)}`);
  }

  // 18. Employee Salary / Payslips
  const salaryRes = await empAxios.get('/api/employee-salaries');
  if (salaryRes.status === 200) {
    report('18. Employee Salaries (GET /api/employee-salaries)', true, `Records found`);
  } else {
    report('18. Employee Salaries (GET /api/employee-salaries)', false, `Status ${salaryRes.status}: ${JSON.stringify(salaryRes.data)}`);
  }

  console.log('\n========================================================');
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  console.log(`SUMMARY: ${passedCount} PASSED / ${failedCount} FAILED`);
  console.log('========================================================');
}

run().catch(err => {
  console.error('Test execution crashed:', err);
});
