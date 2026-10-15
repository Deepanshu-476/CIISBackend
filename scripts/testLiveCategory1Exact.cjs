/**
 * Automated Live Testing Suite for Category 1 Employee Pages (Company: TECH334753)
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

const results = [];

function report(page, testName, passed, details) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${status}] [${page}] ${testName}`);
  if (details) console.log(`       Details: ${details}`);
  results.push({ page, testName, passed, details });
}

async function run() {
  console.log('========================================================');
  console.log('Testing ALL Category 1 Employee Pages on LIVE SERVER:');
  console.log('URL: ' + LIVE_BASE_URL);
  console.log('User: ' + EMPLOYEE_CREDS.email + ' (TECH334753)');
  console.log('========================================================\n');

  // 0. Login
  let token = '';
  let user = null;
  try {
    const res = await axios.post(`${LIVE_BASE_URL}/api/auth/login`, EMPLOYEE_CREDS);
    token = res.data.token;
    user = res.data.user || res.data.data;
    report('Auth', 'Login as Employee', true, `User: ${user?.name} (ID: ${user?._id || user?.id})`);
  } catch (err) {
    report('Auth', 'Login as Employee', false, err.response?.data?.message || err.message);
    process.exit(1);
  }

  const userId = user?._id || user?.id;
  const companyId = user?.company?._id || user?.company || user?.companyId;

  const client = axios.create({
    baseURL: LIVE_BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });

  // ==========================================================
  // 1. Dashboard (/ciisUser/user-dashboard)
  // ==========================================================
  console.log('\n--- 1. Dashboard ---');
  const dashProd = await client.get('/api/dashboard/productivity', { params: { companyId } });
  report('Dashboard', 'Productivity (GET /api/dashboard/productivity)', dashProd.status === 200, `Status ${dashProd.status}: ${dashProd.data?.message || (dashProd.status === 200 ? 'OK' : JSON.stringify(dashProd.data))}`);

  const dashSummary = await client.get('/api/dashboard/employee-summary');
  report('Dashboard', 'Employee Summary (GET /api/dashboard/employee-summary)', dashSummary.status === 200, `Status ${dashSummary.status}: ${dashSummary.data?.message || (dashSummary.status === 200 ? 'OK' : JSON.stringify(dashSummary.data))}`);

  const taskStats = await client.get(`/api/task/user/${userId}/stats`, { params: { period: 'today', scope: 'assigned' } });
  report('Dashboard', 'Task Stats (GET /api/task/user/:id/stats)', taskStats.status === 200, `Status ${taskStats.status}`);

  // ==========================================================
  // 2. Attendance (/ciisUser/attendance)
  // ==========================================================
  console.log('\n--- 2. Attendance ---');
  const attList = await client.get('/api/attendance/list');
  report('Attendance', 'Attendance List (GET /api/attendance/list)', attList.status === 200, `Status ${attList.status}`);

  const attStatus = await client.get('/api/attendance/status');
  report('Attendance', 'Attendance Status (GET /api/attendance/status)', attStatus.status === 200, `Status ${attStatus.status}`);

  const holidays = await client.get('/api/holidays');
  report('Attendance', 'Holidays List (GET /api/holidays)', holidays.status === 200, `Status ${holidays.status}`);

  const clockIn = await client.post('/api/attendance/in', { location: 'QA Live Script', workMode: 'office' });
  report('Attendance', 'Clock In (POST /api/attendance/in)', clockIn.status === 200 || clockIn.status === 201 || clockIn.data?.message?.includes('already'), `Status ${clockIn.status}: ${clockIn.data?.message || 'OK'}`);

  // ==========================================================
  // 3. My Leaves (/ciisUser/my-leaves)
  // ==========================================================
  console.log('\n--- 3. My Leaves ---');
  const leaveTypes = await client.get('/api/leave-types');
  report('My Leaves', 'Leave Types (GET /api/leave-types)', leaveTypes.status === 200 && Array.isArray(leaveTypes.data) && leaveTypes.data.length > 0, `Types found: ${Array.isArray(leaveTypes.data) ? leaveTypes.data.length : (leaveTypes.data?.data?.length || 0)}`);

  const leavePolicies = await client.get('/api/leave-policies/applicable');
  report('My Leaves', 'Applicable Policy (GET /api/leave-policies/applicable)', leavePolicies.status === 200, `Status ${leavePolicies.status}`);

  const leaveStatus = await client.get('/api/leaves/status');
  report('My Leaves', 'Leave Balance & Status (GET /api/leaves/status)', leaveStatus.status === 200, `Status ${leaveStatus.status}`);

  const applyLeave = await client.post('/api/leaves/apply', {
    leaveType: 'Casual',
    startDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    endDate: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
    reason: 'Test Leave from QA script',
    days: 2
  });
  report('My Leaves', 'Apply Leave (POST /api/leaves/apply)', applyLeave.status === 200 || applyLeave.status === 201, `Status ${applyLeave.status}: ${applyLeave.data?.message || JSON.stringify(applyLeave.data)}`);

  // ==========================================================
  // 4. My Assets (/ciisUser/my-assets)
  // ==========================================================
  console.log('\n--- 4. My Assets ---');
  const myAssetReqs = await client.get('/api/asset-requests/my-requests');
  report('My Assets', 'My Asset Requests (GET /api/asset-requests/my-requests)', myAssetReqs.status === 200, `Status ${myAssetReqs.status}`);

  const compAssets = await client.get('/api/company-assets');
  report('My Assets', 'Company Assets (GET /api/company-assets)', compAssets.status === 200, `Status ${compAssets.status}: ${compAssets.data?.message || 'OK'}`);

  const availAssets = await client.get('/api/asset-requests/available');
  report('My Assets', 'Available Assets (GET /api/asset-requests/available)', availAssets.status === 200, `Status ${availAssets.status}`);

  // ==========================================================
  // 5. My Projects (/ciisUser/project)
  // ==========================================================
  console.log('\n--- 5. My Projects ---');
  const projects = await client.get('/api/projects');
  report('My Projects', 'Assigned Projects (GET /api/projects)', projects.status === 200, `Status ${projects.status}: Found ${projects.data?.projects?.length || projects.data?.length || 0} projects`);

  // ==========================================================
  // 6. My Tasks (/ciisUser/company-all-task)
  // ==========================================================
  console.log('\n--- 6. My Tasks ---');
  const myTasks = await client.get(`/api/task/user/${userId}/all-tasks`, { params: { page: 1, limit: 50, scope: 'assigned' } });
  report('My Tasks', 'All Tasks (GET /api/task/user/:id/all-tasks)', myTasks.status === 200, `Status ${myTasks.status}: Found ${myTasks.data?.tasks?.length || myTasks.data?.length || 0} tasks`);

  // ==========================================================
  // 7. Employee Meetings (/ciisUser/employee-meeting)
  // ==========================================================
  console.log('\n--- 7. Employee Meetings ---');
  const meetings = await client.get(`/api/meetings/user/${userId}`);
  report('Meetings', 'User Meetings (GET /api/meetings/user/:id)', meetings.status === 200, `Status ${meetings.status}: Found ${meetings.data?.meetings?.length || meetings.data?.data?.length || 0} meetings`);

  // ==========================================================
  // 8. Alerts (/ciisUser/alert)
  // ==========================================================
  console.log('\n--- 8. Alerts ---');
  const alerts = await client.get('/api/alerts');
  report('Alerts', 'My Alerts (GET /api/alerts)', alerts.status === 200, `Status ${alerts.status}: Found ${alerts.data?.alerts?.length || alerts.data?.length || 0} alerts`);

  // ==========================================================
  // 9. Department Support Desk (/ciisUser/support-desk)
  // ==========================================================
  console.log('\n--- 9. Support Desk ---');
  const deptTickets = await client.get('/api/support/tickets/department');
  report('Support Desk', 'Department Tickets (GET /api/support/tickets/department)', deptTickets.status === 200, `Status ${deptTickets.status}: ${deptTickets.data?.message || 'OK'}`);

  // ==========================================================
  // 10. Profile & Password (/ciisUser/profile & /ciisUser/change-password)
  // ==========================================================
  console.log('\n--- 10. Profile & Password ---');
  const profile = await client.get('/api/users/profile');
  report('Profile', 'Fetch Profile (GET /api/users/profile)', profile.status === 200, `Status ${profile.status}: ${profile.data?.error || profile.data?.message || 'OK'}`);

  console.log('\n========================================================');
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  console.log(`TEST RESULTS SUMMARY: ${passedCount} PASSED / ${failedCount} FAILED`);
  console.log('========================================================\n');
}

run().catch(err => {
  console.error('Fatal crash:', err);
});
