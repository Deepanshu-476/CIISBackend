require('dotenv').config({ quiet: true });
const http = require('http');

function apiCall(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json'
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = http.request('http://localhost:3000' + path, {
      method,
      headers
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

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runAudit() {
  console.log('=== STARTING COMPLETE EMPLOYEE API AUDIT ===\n');

  // 1. Login
  const loginRes = await apiCall('POST', '/api/auth/login', {
    email: 'vanshtest@gmail.com',
    password: '0987654321',
    companyCode: 'TECH334753'
  });

  console.log('1. /api/auth/login -> Status:', loginRes.status, loginRes.data?.success ? '✅ SUCCESS' : '❌ FAILED');
  const token = loginRes.data?.token;
  if (!token) {
    console.error('Failed to get login token!');
    process.exit(1);
  }

  // Endpoints to test
  const endpoints = [
    { method: 'GET', path: '/api/users/profile', label: 'User Profile' },
    { method: 'GET', path: '/api/sidebar', label: 'Sidebar Configuration' },
    { method: 'GET', path: '/api/page-permissions/my-permissions', label: 'My Page Permissions' },
    { method: 'GET', path: '/api/page-permissions/catalog', label: 'Page Permission Catalog' },
    { method: 'GET', path: '/api/attendance/my-attendance', label: 'My Attendance' },
    { method: 'GET', path: '/api/attendance/today', label: 'Today Attendance Status' },
    { method: 'GET', path: '/api/leaves/my-leaves', label: 'My Leaves' },
    { method: 'GET', path: '/api/leave-policies/current', label: 'Current Leave Policy' },
    { method: 'GET', path: '/api/tasks/self', label: 'My Tasks' },
    { method: 'GET', path: '/api/company-assets/my-assets', label: 'My Assigned Assets' },
    { method: 'GET', path: '/api/alerts', label: 'Company Alerts' },
    { method: 'GET', path: '/api/notifications', label: 'User Notifications' },
    { method: 'GET', path: '/api/dashboard/stats', label: 'Dashboard Stats' },
    { method: 'GET', path: '/api/dashboard/overview', label: 'Dashboard Overview' }
  ];

  for (const ep of endpoints) {
    try {
      const res = await apiCall(ep.method, ep.path, null, token);
      const isOk = res.status >= 200 && res.status < 300;
      console.log(`${isOk ? '✅' : '❌'} ${ep.method} ${ep.path} (${ep.label}) -> Status: ${res.status}`);
      if (!isOk) {
        console.log('   Error Details:', JSON.stringify(res.data || res.raw).substring(0, 200));
      }
    } catch (err) {
      console.log(`❌ ${ep.method} ${ep.path} (${ep.label}) -> Request Crashed:`, err.message);
    }
  }

  process.exit(0);
}

runAudit().catch(console.error);
