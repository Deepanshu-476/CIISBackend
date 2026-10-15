const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const COMPANY_CODE = 'TECH334753';

async function runTaskCrudTests() {
  console.log('=================================================================');
  console.log('       CLIENT TASK CRUD TESTING SUITE (TECH334753)');
  console.log('=================================================================\n');

  const results = [];
  const report = (name, passed, details = '') => {
    results.push({ name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark} | ${name}`);
    if (details) console.log(`       Details: ${details}`);
  };

  // 1. Auth Login (Admin & Client)
  let adminToken = null;
  let clientToken = null;
  let clientId = null;

  try {
    const adminLoginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'vansh24810@gmail.com',
      password: '0987654321',
      companyCode: COMPANY_CODE
    });
    if (adminLoginRes.data?.success && adminLoginRes.data?.token) {
      adminToken = adminLoginRes.data.token;
      report('Admin Authentication (Owner)', true, `Token received for ${adminLoginRes.data.user?.email}`);
    } else {
      report('Admin Authentication (Owner)', false, 'No token in response');
      return;
    }
  } catch (err) {
    report('Admin Authentication (Owner)', false, err.response?.data?.message || err.message);
    return;
  }

  try {
    const clientLoginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'clienttest@gmail.com',
      password: '0987654321',
      companyCode: COMPANY_CODE
    });
    if (clientLoginRes.data?.success && clientLoginRes.data?.token) {
      clientToken = clientLoginRes.data.token;
      report('Client Authentication', true, `Token received for ${clientLoginRes.data.user?.email}`);
    } else {
      report('Client Authentication', false, 'No token in response');
      return;
    }
  } catch (err) {
    report('Client Authentication', false, err.response?.data?.message || err.message);
    return;
  }

  const adminAxios = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  const clientAxios = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${clientToken}` }
  });

  // 2. Fetch Client Info
  let clientRecord = null;
  try {
    const clientsRes = await adminAxios.get('/api/clientsservice/', {
      params: { companyCode: COMPANY_CODE }
    });
    const clients = clientsRes.data?.data || [];
    clientRecord = clients.find(c => c.email === 'clienttest@gmail.com') || clients[0];
    if (clientRecord) {
      clientId = clientRecord._id;
      report('Client Record Lookup', true, `Client: ${clientRecord.client}, ID: ${clientId}, Services: ${clientRecord.services?.join(', ')}`);
    } else {
      report('Client Record Lookup', false, 'Client not found in company');
      return;
    }
  } catch (err) {
    report('Client Record Lookup', false, err.response?.data?.message || err.message);
    return;
  }

  const testService = clientRecord.services?.[0] || 'Web Development';
  let createdTaskId = null;

  // 3. CREATE TASK (POST /api/tasks/client/:clientId/service/:service)
  console.log('\n--- 1. TASK CREATION TEST ---');
  try {
    const createRes = await adminAxios.post(`/api/tasks/client/${clientId}/service/${encodeURIComponent(testService)}`, {
      name: 'Automated CRUD Test Task',
      description: 'Verifying full Create, Edit, Toggle, Remarks and Delete lifecycle',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      priority: 'High',
      assignee: 'Test Admin',
      checkpoints: [
        { text: 'Initial Setup Verification', completed: false },
        { text: 'Final Validation', completed: false }
      ]
    });

    if (createRes.data?.success && createRes.data?.data?._id) {
      createdTaskId = createRes.data.data._id;
      report('Create Client Task (POST)', true, `Created Task ID: ${createdTaskId}, Name: "${createRes.data.data.name}"`);
    } else {
      report('Create Client Task (POST)', false, createRes.data?.message || 'Creation failed');
      return;
    }
  } catch (err) {
    report('Create Client Task (POST)', false, err.response?.data?.message || err.message);
    return;
  }

  // 4. READ TASK (GET /api/tasks/client/:clientId/service/:service)
  console.log('\n--- 2. TASK READ / LIST TEST ---');
  try {
    const listRes = await clientAxios.get(`/api/tasks/client/${clientId}/service/${encodeURIComponent(testService)}`);
    const tasks = listRes.data?.data || [];
    const foundTask = tasks.find(t => String(t._id) === String(createdTaskId));
    if (foundTask) {
      report('Read Created Task in List (GET)', true, `Found task in service list. Total tasks: ${tasks.length}`);
    } else {
      report('Read Created Task in List (GET)', false, `Task ${createdTaskId} not found in service task list`);
    }
  } catch (err) {
    report('Read Created Task in List (GET)', false, err.response?.data?.message || err.message);
  }

  // 5. UPDATE / EDIT TASK (PUT /api/tasks/:taskId)
  console.log('\n--- 3. TASK UPDATE / EDIT TEST ---');
  try {
    const updateRes = await adminAxios.put(`/api/tasks/${createdTaskId}`, {
      name: 'Automated CRUD Test Task - UPDATED TITLE',
      description: 'Updated task description successfully via PUT API',
      priority: 'Urgent'
    });

    if (updateRes.data?.success) {
      const updatedData = updateRes.data.data;
      report('Update / Edit Client Task (PUT)', true, `Updated Name: "${updatedData?.name}", Priority: ${updatedData?.priority}`);
    } else {
      report('Update / Edit Client Task (PUT)', false, updateRes.data?.message || 'Update failed');
    }
  } catch (err) {
    report('Update / Edit Client Task (PUT)', false, err.response?.data?.message || err.message);
  }

  // 6. TOGGLE TASK COMPLETION (PATCH /api/tasks/:taskId/toggle)
  console.log('\n--- 4. TASK TOGGLE STATUS TEST ---');
  try {
    const toggleRes = await adminAxios.patch(`/api/tasks/${createdTaskId}/toggle`, {
      clientId
    });

    if (toggleRes.data?.success) {
      report('Toggle Task Completion Status (PATCH)', true, `Status changed. Completed: ${toggleRes.data.data?.completed}`);
    } else {
      report('Toggle Task Completion Status (PATCH)', false, toggleRes.data?.message || 'Toggle failed');
    }
  } catch (err) {
    report('Toggle Task Completion Status (PATCH)', false, err.response?.data?.message || err.message);
  }

  // 7. CLIENT REMARKS (POST /api/tasks/:taskId/client-remarks)
  console.log('\n--- 5. CLIENT REMARK TEST ---');
  let remarkId = null;
  try {
    const remarkRes = await clientAxios.post(`/api/tasks/${createdTaskId}/client-remarks`, {
      text: 'Client verified this task via portal comment.'
    });

    if (remarkRes.data?.success) {
      remarkId = remarkRes.data.data?._id;
      report('Add Client Remark (POST)', true, `Remark added. ID: ${remarkId}, Text: "${remarkRes.data.data?.text}"`);
    } else {
      report('Add Client Remark (POST)', false, remarkRes.data?.message || 'Remark failed');
    }
  } catch (err) {
    report('Add Client Remark (POST)', false, err.response?.data?.message || err.message);
  }

  // 8. FETCH CLIENT REMARKS (GET /api/tasks/:taskId/client-remarks)
  try {
    const getRemarksRes = await clientAxios.get(`/api/tasks/${createdTaskId}/client-remarks`);
    if (getRemarksRes.data?.success) {
      const count = getRemarksRes.data.data?.length || 0;
      report('Fetch Client Remarks (GET)', true, `Successfully fetched ${count} remarks`);
    } else {
      report('Fetch Client Remarks (GET)', false, getRemarksRes.data?.message || 'Failed');
    }
  } catch (err) {
    report('Fetch Client Remarks (GET)', false, err.response?.data?.message || err.message);
  }

  // 9. DELETE TASK (DELETE /api/tasks/:taskId)
  console.log('\n--- 6. TASK DELETION TEST ---');
  try {
    const deleteRes = await adminAxios.delete(`/api/tasks/${createdTaskId}`);
    if (deleteRes.data?.success) {
      report('Delete Client Task (DELETE)', true, `Task ${createdTaskId} successfully deleted`);
    } else {
      report('Delete Client Task (DELETE)', false, deleteRes.data?.message || 'Deletion failed');
    }
  } catch (err) {
    report('Delete Client Task (DELETE)', false, err.response?.data?.message || err.message);
  }

  // 10. VERIFY DELETION (GET /api/tasks/client/:clientId/service/:service)
  console.log('\n--- 7. VERIFY DELETION ---');
  try {
    const verifyListRes = await clientAxios.get(`/api/tasks/client/${clientId}/service/${encodeURIComponent(testService)}`);
    const tasks = verifyListRes.data?.data || [];
    const foundTask = tasks.find(t => String(t._id) === String(createdTaskId));
    if (!foundTask) {
      report('Verify Task Is Removed from Database', true, `Task ${createdTaskId} verified permanently deleted`);
    } else {
      report('Verify Task Is Removed from Database', false, 'Task still exists after deletion');
    }
  } catch (err) {
    report('Verify Task Is Removed from Database', false, err.response?.data?.message || err.message);
  }

  console.log('\n=================================================================');
  const totalPassed = results.filter(r => r.passed).length;
  console.log(`TOTAL TASK CRUD TESTS: ${results.length} | PASSED: ${totalPassed} | FAILED: ${results.length - totalPassed}`);
  console.log('=================================================================\n');
}

runTaskCrudTests().catch(console.error);
