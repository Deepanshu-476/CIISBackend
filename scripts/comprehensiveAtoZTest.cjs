require('dotenv').config({ quiet: true });
const http = require('http');

function apiCall(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = http.request('http://localhost:3000' + path, {
      method,
      headers,
      timeout: 10000
    }, res => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resBody) });
        } catch {
          resolve({ status: res.statusCode, raw: resBody });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 408, error: 'Request timeout' });
    });
    req.on('error', (err) => {
      resolve({ status: 500, error: err.message });
    });

    if (data) req.write(data);
    req.end();
  });
}

const results = {
  passed: [],
  failed: []
};

function record(name, category, res, expectedStatus = 200, notes = '') {
  const isOk = Array.isArray(expectedStatus)
    ? expectedStatus.includes(res.status)
    : res.status === expectedStatus;

  const entry = {
    name,
    category,
    status: res.status,
    notes,
    error: !isOk ? (res.data?.message || res.data?.error || res.error || (typeof res.raw === 'string' ? res.raw.slice(0, 150) : null)) : null
  };

  if (isOk) {
    results.passed.push(entry);
    console.log(`✅ [${category}] ${name} (Status: ${res.status})`);
  } else {
    results.failed.push(entry);
    console.log(`❌ [${category}] ${name} (Status: ${res.status}) - ${entry.error || 'Unexpected error'}`);
  }
}

async function run() {
  console.log('====================================================');
  console.log('🚀 COMPREHENSIVE A-Z SYSTEM AUDIT FOR TECH334753');
  console.log('====================================================\n');

  // 1. Authentication
  console.log('--- 1. Testing Authentication ---');
  const empLogin = await apiCall('POST', '/api/auth/login', {
    email: 'vanshtest@gmail.com',
    password: '0987654321',
    companyCode: 'TECH334753'
  });
  record('Employee Login (vanshtest@gmail.com)', 'Auth', empLogin, 200);
  const empToken = empLogin.data?.token;
  const empId = empLogin.data?.user?._id;
  const companyId = empLogin.data?.user?.company;

  const adminLogin = await apiCall('POST', '/api/auth/login', {
    email: 'vansh24810@gmail.com',
    password: '0987654321',
    companyCode: 'TECH334753'
  });
  record('Admin Login (vansh24810@gmail.com)', 'Auth', adminLogin, 200);
  const adminToken = adminLogin.data?.token;
  const adminId = adminLogin.data?.user?._id;

  const badLogin = await apiCall('POST', '/api/auth/login', {
    email: 'vanshtest@gmail.com',
    password: 'wrongpassword',
    companyCode: 'TECH334753'
  });
  record('Rejected Invalid Password Check', 'Auth', badLogin, 401);

  // 2. Profile
  console.log('\n--- 2. Testing User Profile & Personal Settings ---');
  if (empToken && empId) {
    const empProfile = await apiCall('GET', `/api/users/profile/${empId}`, null, empToken);
    record('Employee Profile Fetch', 'Profile', empProfile, 200);

    const updateProfile = await apiCall('PUT', `/api/users/profile/${empId}`, {
      address: 'Test Address Phase 1',
      city: 'Panchkula',
      state: 'Haryana'
    }, empToken);
    record('Employee Profile Self-Update', 'Profile', updateProfile, [200, 204]);

    const getMe = await apiCall('GET', '/api/users/me', null, empToken);
    record('Employee Self Identity (/api/users/me)', 'Profile', getMe, 200);
  }

  // 3. Attendance & Overtime
  console.log('\n--- 3. Testing Attendance & Overtime ---');
  if (empToken) {
    const attStatus = await apiCall('GET', '/api/attendance/status', null, empToken);
    record('Attendance Today Status', 'Attendance', attStatus, 200);

    const attList = await apiCall('GET', '/api/attendance/list', null, empToken);
    record('Attendance Personal History List', 'Attendance', attList, 200);

    const clockIn = await apiCall('POST', '/api/attendance/in', {}, empToken);
    record('Attendance Clock-In Action', 'Attendance', clockIn, [200, 400]);

    const clockOut = await apiCall('POST', '/api/attendance/out', {}, empToken);
    record('Attendance Clock-Out Action', 'Attendance', clockOut, [200, 400]);

    const otApply = await apiCall('POST', '/api/overtime/request', {
      date: new Date().toISOString().split('T')[0],
      startTime: '19:30',
      endTime: '21:30',
      reason: 'Testing project deployment overtime'
    }, empToken);
    record('Apply Overtime Request (/api/overtime/request)', 'Attendance', otApply, [200, 201, 400]);

    const otMy = await apiCall('GET', '/api/overtime/my-requests', null, empToken);
    record('Fetch My Overtime Requests', 'Attendance', otMy, 200);
  }

  if (adminToken) {
    const allAttendance = await apiCall('GET', '/api/attendance/all', null, adminToken);
    record('Admin: Fetch All Users Attendance', 'Attendance-Admin', allAttendance, 200);

    const attStats = await apiCall('GET', '/api/attendance/stats', null, adminToken);
    record('Admin: Attendance Stats', 'Attendance-Admin', attStats, 200);
  }

  // 4. Leave Management
  console.log('\n--- 4. Testing Leave Management ---');
  if (empToken) {
    const leaveTypes = await apiCall('GET', '/api/leave-types', null, empToken);
    record('Fetch Available Leave Types', 'Leaves', leaveTypes, 200);

    const leavePolicies = await apiCall('GET', '/api/leave-policies', null, empToken);
    record('Fetch Company Leave Policies', 'Leaves', leavePolicies, 200);

    const myLeaves = await apiCall('GET', '/api/leaves/my', null, empToken);
    record('Fetch My Leaves (/api/leaves/my)', 'Leaves', myLeaves, 200);

    const leaveStats = await apiCall('GET', '/api/leaves/stats', null, empToken);
    record('Fetch Personal Leave Stats', 'Leaves', leaveStats, 200);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);

    const applyLeave = await apiCall('POST', '/api/leaves/apply', {
      type: 'Casual',
      reason: 'Urgent family function attendance required in home town',
      startDate: tomorrow.toISOString(),
      endDate: dayAfter.toISOString()
    }, empToken);
    record('Apply Leave Submission', 'Leaves', applyLeave, [200, 201]);
  }

  if (adminToken) {
    const allLeaves = await apiCall('GET', '/api/leaves/all', null, adminToken);
    record('Admin: Fetch All Company Leaves', 'Leaves-Admin', allLeaves, 200);
  }

  // 5. Tasks
  console.log('\n--- 5. Testing Task Management ---');
  let createdTaskId = null;
  if (empToken) {
    const selfTasks = await apiCall('GET', '/api/tasks/self', null, empToken);
    record('Employee: Fetch Self Tasks', 'Tasks', selfTasks, 200);

    const createSelfTask = await apiCall('POST', '/api/tasks/self/create', {
      title: 'Automated Test Task',
      description: 'Verifying employee self task creation functionality',
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      priority: 'high'
    }, empToken);
    record('Employee: Create Self Task (/api/tasks/self/create)', 'Tasks', createSelfTask, [200, 201]);
    createdTaskId = createSelfTask.data?.task?._id || createSelfTask.data?._id;

    if (createdTaskId) {
      const updateStatus = await apiCall('PATCH', `/api/tasks/self/${createdTaskId}/status`, {
        status: 'In Progress'
      }, empToken);
      record('Employee: Update Task Status', 'Tasks', updateStatus, [200, 204]);
    }

    const assignedToMe = await apiCall('GET', '/api/task/assigned-to-me', null, empToken);
    record('Employee: Fetch Assigned Tasks (/api/task/assigned-to-me)', 'Tasks', assignedToMe, 200);
  }

  if (adminToken) {
    const allTasks = await apiCall('GET', '/api/tasks/all', null, adminToken);
    record('Admin: Fetch All Company Tasks', 'Tasks-Admin', allTasks, 200);
  }

  // 6. Projects
  console.log('\n--- 6. Testing Projects ---');
  if (empToken) {
    const empProjects = await apiCall('GET', '/api/projects', null, empToken);
    record('Employee: Fetch Projects', 'Projects', empProjects, 200);
  }
  if (adminToken && empId) {
    const createProject = await apiCall('POST', '/api/projects', {
      projectName: 'TechSoft Core Platform',
      description: 'Development and testing of core modules in TECH334753',
      users: JSON.stringify([String(empId)]),
      startDate: new Date().toISOString()
    }, adminToken);
    record('Admin: Create Project with Members', 'Projects-Admin', createProject, [200, 201]);
  }

  // 7. Assets Management
  console.log('\n--- 7. Testing Assets Management ---');
  if (empToken) {
    const availableAssets = await apiCall('GET', '/api/asset-requests/available', null, empToken);
    record('Employee: Fetch Available Assets', 'Assets', availableAssets, 200);

    const requestAsset = await apiCall('POST', '/api/asset-requests/request', {
      assetType: 'laptop',
      reason: 'Development workstation requirement for testing'
    }, empToken);
    record('Employee: Request New Asset (/api/asset-requests/request)', 'Assets', requestAsset, [200, 201, 400]);

    const myAssetRequests = await apiCall('GET', '/api/asset-requests/my-requests', null, empToken);
    record('Employee: Fetch My Asset Requests', 'Assets', myAssetRequests, 200);
  }

  if (adminToken) {
    const companyAssets = await apiCall('GET', '/api/company-assets', null, adminToken);
    record('Admin: Fetch Company Assets Inventory', 'Assets-Admin', companyAssets, 200);
  }

  // 8. Meetings
  console.log('\n--- 8. Testing Meetings ---');
  if (empToken && empId) {
    const userMeetings = await apiCall('GET', `/api/meetings/user/${empId}`, null, empToken);
    record('Employee: Fetch My Meetings (/api/meetings/user/:userId)', 'Meetings', userMeetings, 200);
  }
  if (adminToken) {
    const allMeetings = await apiCall('GET', '/api/meetings', null, adminToken);
    record('Admin: Fetch All Meetings', 'Meetings-Admin', allMeetings, 200);
  }

  // 9. Alerts & Notifications
  console.log('\n--- 9. Testing Alerts & Notifications ---');
  if (empToken) {
    const alerts = await apiCall('GET', '/api/alerts', null, empToken);
    record('Fetch Company Alerts', 'Alerts', alerts, 200);

    const notifications = await apiCall('GET', '/api/notifications', null, empToken);
    record('Fetch User Notifications', 'Notifications', notifications, 200);
  }

  // 10. Chat System
  console.log('\n--- 10. Testing Chat System ---');
  if (empToken) {
    const chatUsers = await apiCall('GET', '/api/chat/users', null, empToken);
    record('Fetch Chat Available Users/Contacts', 'Chat', chatUsers, 200);

    const chatConversations = await apiCall('GET', '/api/chat/conversations', null, empToken);
    record('Fetch Active Conversations', 'Chat', chatConversations, 200);
  }

  // 11. Admin Masters
  console.log('\n--- 11. Testing Admin Company Masters & Settings ---');
  if (adminToken && companyId) {
    const depts = await apiCall('GET', '/api/departments', null, adminToken);
    record('Admin: Fetch Departments List', 'Masters', depts, 200);

    const jobRoles = await apiCall('GET', '/api/job-roles', null, adminToken);
    record('Admin: Fetch Job Roles List', 'Masters', jobRoles, 200);

    const branches = await apiCall('GET', `/api/branches/company/${companyId}`, null, adminToken);
    record('Admin: Fetch Branches List (/api/branches/company/:companyId)', 'Masters', branches, 200);

    const holidays = await apiCall('GET', '/api/holidays', null, adminToken);
    record('Admin: Fetch Holidays List', 'Masters', holidays, 200);

    const usersAll = await apiCall('GET', '/api/users/all', null, adminToken);
    record('Admin: Fetch Employee Directory (/api/users/all)', 'Masters', usersAll, 200);

    const regRequests = await apiCall('GET', '/api/users/register-requests', null, adminToken);
    record('Admin: Fetch Registration Requests (/api/users/register-requests)', 'Masters', regRequests, 200);

    const sidebar = await apiCall('GET', '/api/sidebar', null, adminToken);
    record('Admin: Fetch Sidebar Configuration', 'Masters', sidebar, 200);

    const pagePerms = await apiCall('GET', '/api/page-permissions/pages', null, adminToken);
    record('Admin: Fetch Page Permissions Master (/api/page-permissions/pages)', 'Masters', pagePerms, 200);
  }

  // 12. Payroll Masters
  console.log('\n--- 12. Testing Payroll & Compensation Masters ---');
  if (adminToken) {
    const salaryComps = await apiCall('GET', '/api/salary-components', null, adminToken);
    record('Admin: Fetch Salary Components', 'Payroll', salaryComps, 200);

    const salaryStructures = await apiCall('GET', '/api/salary-structures', null, adminToken);
    record('Admin: Fetch Salary Structures', 'Payroll', salaryStructures, 200);

    const empSalaries = await apiCall('GET', '/api/employee-salaries', null, adminToken);
    record('Admin: Fetch Employee Salary Assignments', 'Payroll', empSalaries, 200);
  }

  // ----------------------------------------------------
  // FINAL SUMMARY
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log('📊 FINAL TEST RESULTS SUMMARY:');
  console.log(`✅ Total Passed: ${results.passed.length}`);
  console.log(`❌ Total Failed: ${results.failed.length}`);
  console.log('====================================================');

  if (results.failed.length > 0) {
    console.log('\n❌ DETAILED FAILURE LIST:');
    results.failed.forEach((f, idx) => {
      console.log(`${idx + 1}. [${f.category}] ${f.name} -> HTTP ${f.status}: ${f.error}`);
    });
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Fatal crash:', err);
  process.exit(1);
});
