const axios = require('axios');

const LIVE_BASE_URL = 'https://backendcds.ciisnetwork.in';
const COMPANY_CODE = 'TECH334753';
const CLIENT_EMAIL = 'clienttest@gmail.com';
const CLIENT_PASSWORD = '0987654321';
const ADMIN_EMAIL = 'vansh24810@gmail.com';
const ADMIN_PASSWORD = '0987654321';

async function runLiveTesting() {
  console.log('=================================================================');
  console.log('       LIVE CLIENT PORTAL TESTING SUITE (TECH334753)');
  console.log('       Target URL: ' + LIVE_BASE_URL);
  console.log('=================================================================\n');

  const results = [];
  const reportTest = (name, passed, details = '') => {
    results.push({ name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark} | ${name}`);
    if (details) console.log(`       Details: ${details}`);
  };

  // 1. Live Auth Test (Client)
  let clientToken = null;
  let loggedInUser = null;
  let clientId = null;

  try {
    const loginRes = await axios.post(`${LIVE_BASE_URL}/api/auth/login`, {
      email: CLIENT_EMAIL,
      password: CLIENT_PASSWORD,
      companyCode: COMPANY_CODE
    });

    if (loginRes.data?.success && loginRes.data?.token) {
      clientToken = loginRes.data.token;
      loggedInUser = loginRes.data.user;
      const additionalDetails = typeof loggedInUser.additionalDetails === 'string'
        ? JSON.parse(loggedInUser.additionalDetails)
        : (loggedInUser.additionalDetails || {});
      clientId = additionalDetails.clientId || loggedInUser.clientId;
      reportTest('Live Client Authentication & Login', true, `Role: ${loggedInUser.companyRole}, UserID: ${loggedInUser._id}, ClientID: ${clientId}`);
    } else {
      reportTest('Live Client Authentication & Login', false, `Response: ${JSON.stringify(loginRes.data)}`);
      return;
    }
  } catch (err) {
    reportTest('Live Client Authentication & Login', false, err.response?.data?.message || err.message);
    return;
  }

  // 2. Live Auth Test (Admin/Owner)
  let adminToken = null;
  try {
    const adminLoginRes = await axios.post(`${LIVE_BASE_URL}/api/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      companyCode: COMPANY_CODE
    });
    if (adminLoginRes.data?.success && adminLoginRes.data?.token) {
      adminToken = adminLoginRes.data.token;
      reportTest('Live Admin Authentication', true, `Role: ${adminLoginRes.data.user?.companyRole}, Email: ${ADMIN_EMAIL}`);
    } else {
      reportTest('Live Admin Authentication', false, 'Failed to get admin token');
    }
  } catch (err) {
    reportTest('Live Admin Authentication', false, err.response?.data?.message || err.message);
  }

  const clientAxios = axios.create({
    baseURL: LIVE_BASE_URL,
    headers: { Authorization: `Bearer ${clientToken}` }
  });

  const adminAxios = axios.create({
    baseURL: LIVE_BASE_URL,
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  // 3. Client Record Lookup
  let clientData = null;
  try {
    const clientsRes = await clientAxios.get('/api/clientsservice/', {
      params: { companyCode: COMPANY_CODE, limit: 1000 }
    });
    if (clientsRes.data?.success && Array.isArray(clientsRes.data?.data)) {
      const clients = clientsRes.data.data;
      clientData = clients.find(c => String(c._id) === String(clientId) || c.email === CLIENT_EMAIL);
      reportTest('Live Company Clients List (GET /api/clientsservice/)', true, `Total Clients: ${clients.length}, Selected: "${clientData?.client}" (ID: ${clientData?._id})`);
    } else {
      reportTest('Live Company Clients List (GET /api/clientsservice/)', false, 'Invalid response');
    }
  } catch (err) {
    reportTest('Live Company Clients List (GET /api/clientsservice/)', false, err.response?.data?.message || err.message);
  }

  const effectiveClientId = clientData?._id || clientId;

  // 4. Page 1: Dashboard Overview & Stats
  console.log('\n--- MODULE 1: CLIENT DASHBOARD ---');
  try {
    const dashOverviewRes = await clientAxios.get('/api/clientsservice/dashboard-overview');
    if (dashOverviewRes.data?.success) {
      const d = dashOverviewRes.data.data;
      reportTest('Dashboard Overview (GET /api/clientsservice/dashboard-overview)', true,
        `Services: ${d.services?.length || 0}, Tasks: ${d.serviceTasks?.length || 0}, Tickets: ${d.supportTickets?.length || 0}, PMs: ${d.projectManagers?.length || 0}`);
    } else {
      reportTest('Dashboard Overview (GET /api/clientsservice/dashboard-overview)', false, dashOverviewRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Dashboard Overview (GET /api/clientsservice/dashboard-overview)', false, err.response?.data?.message || err.message);
  }

  try {
    const statsRes = await clientAxios.get(`/api/clientsservice/dashboard-stats/${effectiveClientId}`);
    if (statsRes.data?.success) {
      const s = statsRes.data.stats || statsRes.data.data || {};
      reportTest('Dashboard Stats (GET /api/clientsservice/dashboard-stats/:id)', true,
        `Total tasks: ${s.total ?? 0}, Completed: ${s.completed ?? 0}, In-Progress: ${s['in-progress'] ?? s.inProgress ?? 0}, Pending: ${s.pending ?? 0}`);
    } else {
      reportTest('Dashboard Stats (GET /api/clientsservice/dashboard-stats/:id)', false, statsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Dashboard Stats (GET /api/clientsservice/dashboard-stats/:id)', false, err.response?.data?.message || err.message);
  }

  // 5. Page 2: Client Tasks & Updates
  console.log('\n--- MODULE 2: CLIENT TASKS & UPDATES ---');
  try {
    const tasksRes = await clientAxios.get(`/api/tasks/client-tasks/client/${effectiveClientId}/service/${encodeURIComponent('Web Development')}`);
    if (tasksRes.data?.success) {
      const tasks = tasksRes.data.data || [];
      reportTest('Service Tasks - Web Development (GET)', true, `Found ${tasks.length} active tasks`);
    } else {
      reportTest('Service Tasks - Web Development (GET)', false, tasksRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Service Tasks - Web Development (GET)', false, err.response?.data?.message || err.message);
  }

  try {
    const tasksResUI = await clientAxios.get(`/api/tasks/client-tasks/client/${effectiveClientId}/service/${encodeURIComponent('UI/UX Design')}`);
    if (tasksResUI.data?.success) {
      const tasks = tasksResUI.data.data || [];
      reportTest('Service Tasks - UI/UX Design (GET)', true, `Found ${tasks.length} active tasks`);
    } else {
      reportTest('Service Tasks - UI/UX Design (GET)', false, tasksResUI.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Service Tasks - UI/UX Design (GET)', false, err.response?.data?.message || err.message);
  }

  // 6. Page 3: My Services
  console.log('\n--- MODULE 3: MY SERVICES ---');
  try {
    const servicesRes = await clientAxios.get('/api/clientsservice/services', {
      params: { companyCode: COMPANY_CODE }
    });
    if (servicesRes.data?.success) {
      const sList = servicesRes.data.data || [];
      reportTest('Company Services Catalog (GET /api/clientsservice/services)', true, `Available services in catalog: ${sList.length}`);
    } else {
      reportTest('Company Services Catalog (GET /api/clientsservice/services)', false, servicesRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Company Services Catalog (GET /api/clientsservice/services)', false, err.response?.data?.message || err.message);
  }

  // 7. Page 4: Service Marketplace & Enquiry
  console.log('\n--- MODULE 4: SERVICE MARKETPLACE ---');
  try {
    const enquiriesRes = await clientAxios.get('/api/clientsservice/service-enquiries', {
      params: { companyCode: COMPANY_CODE }
    });
    if (enquiriesRes.data?.success) {
      reportTest('Fetch Service Enquiries (GET)', true, `Existing enquiries found: ${enquiriesRes.data.data?.length || 0}`);
    } else {
      reportTest('Fetch Service Enquiries (GET)', false, enquiriesRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Service Enquiries (GET)', false, err.response?.data?.message || err.message);
  }

  try {
    const postEnquiryRes = await clientAxios.post('/api/clientsservice/service-enquiries', {
      clientName: clientData?.client || 'Acme Test Client',
      companyName: clientData?.company || 'Acme Global Tech',
      clientId: effectiveClientId,
      companyCode: COMPANY_CODE,
      serviceName: 'Cloud Architecture & DevOps',
      contactPerson: 'Acme Test Client',
      contactPhone: '9876543210',
      contactEmail: CLIENT_EMAIL,
      budget: '₹50,000 - ₹1,00,000',
      preferredContact: 'WhatsApp',
      notes: 'Live verification enquiry for Cloud Architecture service plan.'
    });
    if (postEnquiryRes.data?.success) {
      reportTest('Create Service Marketplace Enquiry (POST)', true, `Enquiry created with ID: ${postEnquiryRes.data.data?._id}`);
    } else {
      reportTest('Create Service Marketplace Enquiry (POST)', false, postEnquiryRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Create Service Marketplace Enquiry (POST)', false, err.response?.data?.message || err.message);
  }

  // 8. Page 5: Support Tickets & Meetings
  console.log('\n--- MODULE 5: MEETINGS & SUPPORT TICKETS ---');
  try {
    const meetingsRes = await clientAxios.get('/api/cmeeting/history', {
      params: { clientId: effectiveClientId, companyCode: COMPANY_CODE }
    });
    if (meetingsRes.data?.success) {
      reportTest('Fetch Client Meetings History (GET /api/cmeeting/history)', true, `Meetings count: ${meetingsRes.data.data?.length || 0}`);
    } else {
      reportTest('Fetch Client Meetings History (GET /api/cmeeting/history)', false, meetingsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Client Meetings History (GET /api/cmeeting/history)', false, err.response?.data?.message || err.message);
  }

  try {
    const myTicketsRes = await clientAxios.get('/api/support/tickets/my');
    if (myTicketsRes.data?.success) {
      reportTest('Fetch My Support Tickets (GET /api/support/tickets/my)', true, `Tickets found: ${myTicketsRes.data.tickets?.length || 0}`);
    } else {
      reportTest('Fetch My Support Tickets (GET /api/support/tickets/my)', false, myTicketsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch My Support Tickets (GET /api/support/tickets/my)', false, err.response?.data?.message || err.message);
  }

  try {
    const createTicketRes = await clientAxios.post('/api/support/tickets', {
      subject: 'Live Verification Ticket - Portal check',
      description: 'Checking support ticket creation on live URL.',
      category: 'General',
      priority: 'Medium',
      source: 'portal'
    });
    if (createTicketRes.data?.success) {
      reportTest('Create Support Ticket (POST /api/support/tickets)', true, `Ticket Number: ${createTicketRes.data.ticket?.ticketNumber}`);
    } else {
      reportTest('Create Support Ticket (POST /api/support/tickets)', false, createTicketRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Create Support Ticket (POST /api/support/tickets)', false, err.response?.data?.message || err.message);
  }

  // 9. Page 6: Documents
  console.log('\n--- MODULE 6: CLIENT DOCUMENTS ---');
  try {
    const docsRes = await clientAxios.get('/api/client-documents', {
      params: { clientId: effectiveClientId }
    });
    if (docsRes.data?.success) {
      reportTest('Fetch Active Documents (GET /api/client-documents)', true, `Documents: ${docsRes.data.documents?.length || 0}`);
    } else {
      reportTest('Fetch Active Documents (GET /api/client-documents)', false, docsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Active Documents (GET /api/client-documents)', false, err.response?.data?.message || err.message);
  }

  try {
    const trashDocsRes = await clientAxios.get('/api/client-documents', {
      params: { clientId: effectiveClientId, trash: true }
    });
    if (trashDocsRes.data?.success) {
      reportTest('Fetch Trashed Documents (GET /api/client-documents?trash=true)', true, `Trashed documents: ${trashDocsRes.data.documents?.length || 0}`);
    } else {
      reportTest('Fetch Trashed Documents (GET /api/client-documents?trash=true)', false, trashDocsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Trashed Documents (GET /api/client-documents?trash=true)', false, err.response?.data?.message || err.message);
  }

  // 10. Page 7: Payments & Invoices
  console.log('\n--- MODULE 7: PAYMENTS & INVOICES ---');
  if (clientData) {
    const dueInvoices = clientData.dueInvoices || [];
    const paymentReceipts = clientData.paymentReceipts || [];
    const subscriptions = clientData.subscription || [];
    reportTest('Verify Client Invoices & Subscriptions', true,
      `Subscriptions: ${subscriptions.length}, Due Invoices: ${dueInvoices.length}, Payment Receipts: ${paymentReceipts.length}`);
  } else {
    reportTest('Verify Client Invoices & Subscriptions', false, 'Client record not available');
  }

  // 11. Page 8: Profile & Account Settings
  console.log('\n--- MODULE 8: ACCOUNT SETTINGS & PROFILE ---');
  try {
    const profileRes = await clientAxios.get('/api/users/profile');
    if (profileRes.data?.success || profileRes.data?.user || profileRes.data?._id || profileRes.data?.email) {
      const u = profileRes.data.user || profileRes.data;
      reportTest('Fetch Client User Profile (GET /api/users/profile)', true, `Name: ${u.name}, Email: ${u.email}, Role: ${u.companyRole || u.role}`);
    } else {
      reportTest('Fetch Client User Profile (GET /api/users/profile)', false, profileRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Client User Profile (GET /api/users/profile)', false, err.response?.data?.message || err.response?.data?.error || err.message);
  }

  // 12. Full Task CRUD Lifecycle on Live
  console.log('\n--- MODULE 9: TASK CRUD LIFECYCLE ON LIVE ---');
  let liveTaskId = null;
  const targetService = clientData?.services?.[0] || 'Web Development';

  // Task Create on Live
  try {
    const callerAxios = adminToken ? adminAxios : clientAxios;
    const createRes = await callerAxios.post(`/api/tasks/client/${effectiveClientId}/service/${encodeURIComponent(targetService)}`, {
      name: 'Live Automated Task Test',
      description: 'Testing live task lifecycle from script',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      priority: 'Medium',
      assignee: 'Test Admin'
    });
    if (createRes.data?.success && createRes.data?.data?._id) {
      liveTaskId = createRes.data.data._id;
      reportTest('Create Task on Live (POST)', true, `Created Task ID: ${liveTaskId}`);
    } else {
      reportTest('Create Task on Live (POST)', false, createRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Create Task on Live (POST)', false, err.response?.data?.message || err.message);
  }

  // Task Edit on Live
  if (liveTaskId) {
    try {
      const updateRes = await (adminToken ? adminAxios : clientAxios).put(`/api/tasks/${liveTaskId}`, {
        name: 'Live Automated Task Test - EDITED',
        priority: 'High'
      });
      if (updateRes.data?.success) {
        reportTest('Edit Task on Live (PUT)', true, `Updated title: "${updateRes.data.data?.name}"`);
      } else {
        reportTest('Edit Task on Live (PUT)', false, updateRes.data?.message || 'Failed');
      }
    } catch (err) {
      reportTest('Edit Task on Live (PUT)', false, err.response?.data?.message || err.message);
    }

    // Task Toggle on Live
    try {
      const toggleRes = await (adminToken ? adminAxios : clientAxios).patch(`/api/tasks/${liveTaskId}/toggle`, {
        clientId: effectiveClientId
      });
      if (toggleRes.data?.success) {
        reportTest('Toggle Task Status on Live (PATCH)', true, `Completed: ${toggleRes.data.data?.completed}`);
      } else {
        reportTest('Toggle Task Status on Live (PATCH)', false, toggleRes.data?.message || 'Failed');
      }
    } catch (err) {
      reportTest('Toggle Task Status on Live (PATCH)', false, err.response?.data?.message || err.message);
    }

    // Add Remark on Live
    try {
      const remarkRes = await clientAxios.post(`/api/tasks/${liveTaskId}/client-remarks`, {
        text: 'Live remark added by client on live server.'
      });
      if (remarkRes.data?.success) {
        reportTest('Add Client Remark on Live (POST)', true, `Remark ID: ${remarkRes.data.data?._id}`);
      } else {
        reportTest('Add Client Remark on Live (POST)', false, remarkRes.data?.message || 'Failed');
      }
    } catch (err) {
      reportTest('Add Client Remark on Live (POST)', false, err.response?.data?.message || err.message);
    }

    // Delete Task on Live
    try {
      const deleteRes = await (adminToken ? adminAxios : clientAxios).delete(`/api/tasks/${liveTaskId}`);
      if (deleteRes.data?.success) {
        reportTest('Delete Task on Live (DELETE)', true, `Task ${liveTaskId} deleted cleanly on live`);
      } else {
        reportTest('Delete Task on Live (DELETE)', false, deleteRes.data?.message || 'Failed');
      }
    } catch (err) {
      reportTest('Delete Task on Live (DELETE)', false, err.response?.data?.message || err.message);
    }
  }

  console.log('\n=================================================================');
  const totalPassed = results.filter(r => r.passed).length;
  console.log(`TOTAL LIVE TESTS: ${results.length} | PASSED: ${totalPassed} | FAILED: ${results.length - totalPassed}`);
  console.log('=================================================================\n');
}

runLiveTesting().catch(console.error);
