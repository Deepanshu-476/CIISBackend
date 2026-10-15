const axios = require('axios');

const BASE_URL = 'https://backendcds.ciisnetwork.in';
const COMPANY_CODE = 'TECH334753';

const EMPLOYEE = {
  email: 'vanshtest@gmail.com',
  password: '0987654321',
  companyCode: COMPANY_CODE,
};

const ADMIN = {
  email: 'vansh24810@gmail.com',
  password: '0987654321',
  companyCode: COMPANY_CODE,
};

async function main() {
  console.log('=== STEP 1: Log in as Employee ===');
  const empLoginRes = await axios.post(`${BASE_URL}/api/auth/login`, EMPLOYEE);
  const empToken = empLoginRes.data.token;
  const empUser = empLoginRes.data.user || empLoginRes.data.data;
  console.log(`✅ Employee logged in: ${empUser.name} (${empUser.email}), ID: ${empUser._id || empUser.id}`);

  const empAxios = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${empToken}` },
  });

  console.log('\n=== STEP 2: Check Applicable Leave Policies & Types ===');
  let leaveType = 'Casual Leave';
  try {
    const policyRes = await empAxios.get('/api/leave-policies/applicable');
    console.log('Applicable Policies response:', JSON.stringify(policyRes.data, null, 2));
    if (policyRes.data?.policies?.length > 0) {
      leaveType = policyRes.data.policies[0].leaveType;
    }
  } catch (err) {
    console.log('Policy check fallback:', err.response?.data || err.message);
    try {
      const typesRes = await empAxios.get('/api/leave-types');
      console.log('Leave Types response:', JSON.stringify(typesRes.data, null, 2));
      const types = typesRes.data?.leaveTypes || typesRes.data?.data || typesRes.data;
      if (Array.isArray(types) && types.length > 0) {
        leaveType = types[0].name || types[0];
      }
    } catch (e2) {
      console.log('Leave types fallback error:', e2.response?.data || e2.message);
    }
  }
  console.log(`Using Leave Type: "${leaveType}"`);

  console.log('\n=== STEP 3: Check Existing Leaves for Conflicts ===');
  let existingLeaves = [];
  try {
    const leavesRes = await empAxios.get('/api/leaves/status');
    existingLeaves = leavesRes.data.leaves || [];
    console.log(`Found ${existingLeaves.length} existing leaves for this user.`);
  } catch (err) {
    console.log('Could not fetch existing leaves:', err.response?.data || err.message);
  }

  // Choose a date far in the future or next month to prevent date overlap
  // Let's find dates that don't overlap with any existing leave
  let startOffset = 45; // 45 days in future
  let startDateStr = '';
  let endDateStr = '';

  for (let attempt = 0; attempt < 20; attempt++) {
    const s = new Date(Date.now() + (startOffset + attempt * 5) * 86400000);
    const e = new Date(Date.now() + (startOffset + attempt * 5 + 1) * 86400000);
    const sStr = s.toISOString().split('T')[0];
    const eStr = e.toISOString().split('T')[0];

    const hasConflict = existingLeaves.some(l => {
      if (!['Pending', 'Approved'].includes(l.status)) return false;
      const ls = new Date(l.startDate);
      const le = new Date(l.endDate);
      return ls <= e && le >= s;
    });

    if (!hasConflict) {
      startDateStr = sStr;
      endDateStr = eStr;
      break;
    }
  }

  console.log(`Dates selected for new leave: ${startDateStr} to ${endDateStr}`);

  console.log('\n=== STEP 4: Apply Leave ===');
  const applyPayload = {
    type: leaveType,
    startDate: startDateStr,
    endDate: endDateStr,
    reason: 'Medical checkup and personal appointment scheduled in advance.',
    days: 2
  };

  const applyRes = await empAxios.post('/api/leaves/apply', applyPayload);
  console.log('Apply Leave Response:', JSON.stringify(applyRes.data, null, 2));
  const leaveId = applyRes.data?.leave?._id || applyRes.data?._id || applyRes.data?.data?._id;
  if (!leaveId) {
    throw new Error('Leave application succeeded but no leave ID returned!');
  }
  console.log(`✅ Leave successfully applied! Leave ID: ${leaveId}`);

  console.log('\n=== STEP 5: Log in as Admin/Owner ===');
  const adminLoginRes = await axios.post(`${BASE_URL}/api/auth/login`, ADMIN);
  const adminToken = adminLoginRes.data.token;
  const adminUser = adminLoginRes.data.user || adminLoginRes.data.data;
  console.log(`✅ Admin logged in: ${adminUser.name} (${adminUser.email}), Role: ${adminUser.companyRole}`);

  const adminAxios = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  console.log('\n=== STEP 6: Check Approval Options & Approve Leave ===');
  let payType = 'Paid';
  try {
    const optRes = await adminAxios.get(`/api/leaves/approval-options/${leaveId}`);
    console.log('Approval options response:', JSON.stringify(optRes.data, null, 2));
    const opts = optRes.data?.options || optRes.data?.approvalOptions || [];
    if (opts.length > 0 && opts[0].payType) {
      payType = opts[0].payType === 'Admin Choice' ? 'Paid' : opts[0].payType;
    }
  } catch (err) {
    console.log('Approval options query:', err.response?.data?.message || err.message);
  }

  const approvePayload = {
    status: 'Approved',
    remarks: 'Approved by Admin for test verification.',
    leaveType: leaveType,
    payType: payType
  };

  const approveRes = await adminAxios.patch(`/api/leaves/status/${leaveId}`, approvePayload);
  console.log('Approve Leave Response:', JSON.stringify(approveRes.data, null, 2));
  console.log(`✅ Leave status updated to APPROVED for Leave ID: ${leaveId}!`);

  console.log('\n=== STEP 7: Verify Status from Employee Perspective ===');
  const verifyRes = await empAxios.get('/api/leaves/status');
  const userLeaves = verifyRes.data.leaves || [];
  const targetLeave = userLeaves.find(l => (l._id || l.id) === leaveId);
  console.log('Target Leave Final Status:', {
    id: targetLeave?._id,
    type: targetLeave?.type,
    status: targetLeave?.status,
    startDate: targetLeave?.startDate,
    endDate: targetLeave?.endDate,
    approvedBy: targetLeave?.approvedBy,
    remarks: targetLeave?.remarks
  });

  console.log('\n================ SUMMARY ================');
  console.log('Employee Whose Leave Was Approved:');
  console.log('  Name:        ', empUser.name);
  console.log('  Email:       ', EMPLOYEE.email);
  console.log('  Password:    ', EMPLOYEE.password);
  console.log('  Company Code:', EMPLOYEE.companyCode);
  console.log('  Role:        ', empUser.companyRole || 'employee');
  console.log('  Leave ID:    ', leaveId);
  console.log('  Leave Status:', targetLeave?.status || 'Approved');
  console.log('=========================================');
}

main().catch(err => {
  console.error('❌ Script failed:', err.response?.data || err.message);
  process.exit(1);
});
