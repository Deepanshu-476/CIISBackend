const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const COMPANY_CODE = 'TECH334753';
const CLIENT_EMAIL = 'clienttest@gmail.com';
const CLIENT_PASSWORD = '0987654321';

async function runTests() {
  console.log('=================================================================');
  console.log('       CLIENT PORTAL FULL TESTING SUITE (TECH334753)');
  console.log('=================================================================\n');

  const results = [];
  const reportTest = (name, passed, details = '') => {
    results.push({ name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark} | ${name}`);
    if (details) console.log(`       Details: ${details}`);
  };

  // 1. Auth Test
  let token = null;
  let loggedInUser = null;
  let clientId = null;

  try {
    const loginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: CLIENT_EMAIL,
      password: CLIENT_PASSWORD,
      companyCode: COMPANY_CODE
    });

    if (loginRes.data?.success && loginRes.data?.token) {
      token = loginRes.data.token;
      loggedInUser = loginRes.data.user;
      const additionalDetails = typeof loggedInUser.additionalDetails === 'string'
        ? JSON.parse(loggedInUser.additionalDetails)
        : (loggedInUser.additionalDetails || {});
      clientId = additionalDetails.clientId || loggedInUser.clientId;
      reportTest('Authentication & Client Login', true, `Role: ${loggedInUser.companyRole}, UserID: ${loggedInUser._id}, ClientID: ${clientId}`);
    } else {
      reportTest('Authentication & Client Login', false, `Response: ${JSON.stringify(loginRes.data)}`);
      return;
    }
  } catch (err) {
    reportTest('Authentication & Client Login', false, err.response?.data?.message || err.message);
    return;
  }

  const clientAxios = axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}` }
  });

  // 2. Client Record Lookup
  let clientData = null;
  try {
    const clientsRes = await clientAxios.get('/api/clientsservice/', {
      params: { companyCode: COMPANY_CODE, limit: 1000 }
    });
    if (clientsRes.data?.success && Array.isArray(clientsRes.data?.data)) {
      const clients = clientsRes.data.data;
      clientData = clients.find(c => String(c._id) === String(clientId) || c.email === CLIENT_EMAIL);
      reportTest('Fetch Company Clients List (GET /api/clientsservice/)', true, `Found ${clients.length} clients in company. Selected: ${clientData?.client}`);
    } else {
      reportTest('Fetch Company Clients List (GET /api/clientsservice/)', false, `Invalid response`);
    }
  } catch (err) {
    reportTest('Fetch Company Clients List (GET /api/clientsservice/)', false, err.response?.data?.message || err.message);
  }

  const effectiveClientId = clientData?._id || clientId;

  // 3. Page 1: Client Dashboard
  console.log('\n--- PAGE 1: CLIENT DASHBOARD ---');
  try {
    const dashOverviewRes = await clientAxios.get('/api/clientsservice/dashboard-overview');
    if (dashOverviewRes.data?.success) {
      const d = dashOverviewRes.data.data;
      reportTest('Client Dashboard Overview (GET /api/clientsservice/dashboard-overview)', true,
        `Services: ${d.services?.length || 0}, Tasks: ${d.serviceTasks?.length || 0}, Tickets: ${d.supportTickets?.length || 0}, PMs: ${d.projectManagers?.length || 0}`);
    } else {
      reportTest('Client Dashboard Overview (GET /api/clientsservice/dashboard-overview)', false, dashOverviewRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Client Dashboard Overview (GET /api/clientsservice/dashboard-overview)', false, err.response?.data?.message || err.message);
  }

  try {
    const statsRes = await clientAxios.get(`/api/clientsservice/dashboard-stats/${effectiveClientId}`);
    if (statsRes.data?.success) {
      const s = statsRes.data.data;
      reportTest('Client Dashboard Stats (GET /api/clientsservice/dashboard-stats/:id)', true,
        `Total tasks: ${s.total}, Completed: ${s.completed}, In-Progress: ${s.inProgress}, Pending: ${s.pending}`);
    } else {
      reportTest('Client Dashboard Stats (GET /api/clientsservice/dashboard-stats/:id)', false, statsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Client Dashboard Stats (GET /api/clientsservice/dashboard-stats/:id)', false, err.response?.data?.message || err.message);
  }

  // 4. Page 2: Client Tasks & Updates
  console.log('\n--- PAGE 2: CLIENT TASKS & UPDATES ---');
  try {
    const tasksRes = await clientAxios.get('/api/tasks/client-tasks', {
      params: { clientId: effectiveClientId, service: 'Web Development' }
    });
    if (tasksRes.data?.success) {
      const tasks = tasksRes.data.data || [];
      reportTest('Fetch Service Tasks (GET /api/tasks/client-tasks - Web Development)', true, `Found ${tasks.length} tasks for Web Development`);
    } else {
      reportTest('Fetch Service Tasks (GET /api/tasks/client-tasks - Web Development)', false, tasksRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Service Tasks (GET /api/tasks/client-tasks - Web Development)', false, err.response?.data?.message || err.message);
  }

  try {
    const tasksResUI = await clientAxios.get('/api/tasks/client-tasks', {
      params: { clientId: effectiveClientId, service: 'UI/UX Design' }
    });
    if (tasksResUI.data?.success) {
      const tasks = tasksResUI.data.data || [];
      reportTest('Fetch Service Tasks (GET /api/tasks/client-tasks - UI/UX Design)', true, `Found ${tasks.length} tasks for UI/UX Design`);
    } else {
      reportTest('Fetch Service Tasks (GET /api/tasks/client-tasks - UI/UX Design)', false, tasksResUI.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Service Tasks (GET /api/tasks/client-tasks - UI/UX Design)', false, err.response?.data?.message || err.message);
  }

  // 5. Page 3: My Services
  console.log('\n--- PAGE 3: MY SERVICES ---');
  try {
    const servicesRes = await clientAxios.get('/api/clientsservice/services', {
      params: { companyCode: COMPANY_CODE }
    });
    if (servicesRes.data?.success) {
      const sList = servicesRes.data.data || [];
      reportTest('Company Services Catalog (GET /api/clientsservice/services)', true, `Returned ${sList.length} company services in catalog`);
    } else {
      reportTest('Company Services Catalog (GET /api/clientsservice/services)', false, servicesRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Company Services Catalog (GET /api/clientsservice/services)', false, err.response?.data?.message || err.message);
  }

  // 6. Page 4: Service Marketplace
  console.log('\n--- PAGE 4: SERVICE MARKETPLACE ---');
  try {
    const enquiriesRes = await clientAxios.get('/api/clientsservice/service-enquiries', {
      params: { companyCode: COMPANY_CODE }
    });
    if (enquiriesRes.data?.success) {
      reportTest('Fetch Service Enquiries (GET /api/clientsservice/service-enquiries)', true, `Found ${enquiriesRes.data.data?.length || 0} existing enquiries`);
    } else {
      reportTest('Fetch Service Enquiries (GET /api/clientsservice/service-enquiries)', false, enquiriesRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Service Enquiries (GET /api/clientsservice/service-enquiries)', false, err.response?.data?.message || err.message);
  }

  // Test submitting a new service enquiry from marketplace
  try {
    const postEnquiryRes = await clientAxios.post('/api/clientsservice/service-enquiries', {
      clientName: clientData?.client || 'Acme Test Client',
      companyName: clientData?.company || 'Acme Global Tech',
      clientId: effectiveClientId,
      companyCode: COMPANY_CODE,
      serviceName: 'Mobile App Development',
      contactPerson: 'Acme Test Client',
      contactPhone: '9876543210',
      contactEmail: CLIENT_EMAIL,
      budget: '₹50,000 - ₹1,00,000',
      preferredContact: 'WhatsApp',
      notes: 'Automated test enquiry for Mobile App Development service plan.'
    });
    if (postEnquiryRes.data?.success) {
      reportTest('Create Service Marketplace Enquiry (POST /api/clientsservice/service-enquiries)', true, `Enquiry created with ID: ${postEnquiryRes.data.data?._id}`);
    } else {
      reportTest('Create Service Marketplace Enquiry (POST /api/clientsservice/service-enquiries)', false, postEnquiryRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Create Service Marketplace Enquiry (POST /api/clientsservice/service-enquiries)', false, err.response?.data?.message || err.message);
  }

  // 7. Page 5: Support Tickets & Client Meetings
  console.log('\n--- PAGE 5: SUPPORT TICKETS & CLIENT MEETINGS ---');
  try {
    const meetingsRes = await clientAxios.get('/api/cmeeting/history', {
      params: { clientId: effectiveClientId, companyCode: COMPANY_CODE }
    });
    if (meetingsRes.data?.success) {
      reportTest('Fetch Client Meetings History (GET /api/cmeeting/history)', true, `Found ${meetingsRes.data.data?.length || 0} meetings`);
    } else {
      reportTest('Fetch Client Meetings History (GET /api/cmeeting/history)', false, meetingsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Client Meetings History (GET /api/cmeeting/history)', false, err.response?.data?.message || err.message);
  }

  try {
    const myTicketsRes = await clientAxios.get('/api/support/tickets/my');
    if (myTicketsRes.data?.success) {
      reportTest('Fetch My Support Tickets (GET /api/support/tickets/my)', true, `Found ${myTicketsRes.data.tickets?.length || 0} tickets`);
    } else {
      reportTest('Fetch My Support Tickets (GET /api/support/tickets/my)', false, myTicketsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch My Support Tickets (GET /api/support/tickets/my)', false, err.response?.data?.message || err.message);
  }

  // Create a new support ticket
  try {
    const createTicketRes = await clientAxios.post('/api/support/tickets', {
      subject: 'Portal Billing Query - Invoice clarification',
      description: 'Please clarify next billing date for growth starter plan.',
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

  // 8. Page 6: Documents
  console.log('\n--- PAGE 6: CLIENT DOCUMENTS ---');
  try {
    const docsRes = await clientAxios.get('/api/client-documents', {
      params: { clientId: effectiveClientId }
    });
    if (docsRes.data?.success) {
      reportTest('Fetch Active Documents (GET /api/client-documents)', true, `Found ${docsRes.data.documents?.length || 0} documents`);
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
      reportTest('Fetch Trashed Documents (GET /api/client-documents?trash=true)', true, `Found ${trashDocsRes.data.documents?.length || 0} trashed documents`);
    } else {
      reportTest('Fetch Trashed Documents (GET /api/client-documents?trash=true)', false, trashDocsRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Trashed Documents (GET /api/client-documents?trash=true)', false, err.response?.data?.message || err.message);
  }

  // 9. Page 7: Payments & Invoices
  console.log('\n--- PAGE 7: PAYMENTS & INVOICES ---');
  if (clientData) {
    const dueInvoices = clientData.dueInvoices || [];
    const paymentReceipts = clientData.paymentReceipts || [];
    const subscriptions = clientData.subscription || [];
    reportTest('Verify Client Invoices & Subscriptions', true,
      `Subscriptions: ${subscriptions.length}, Due Invoices: ${dueInvoices.length}, Payment Receipts: ${paymentReceipts.length}`);
  } else {
    reportTest('Verify Client Invoices & Subscriptions', false, 'Client data unavailable');
  }

  // 10. Page 8: Account Settings & User Profile
  console.log('\n--- PAGE 8: ACCOUNT SETTINGS & PROFILE ---');
  try {
    const profileRes = await clientAxios.get('/api/users/profile');
    if (profileRes.data?.success || profileRes.data?.user || profileRes.data?._id || profileRes.data?.email) {
      const u = profileRes.data.user || profileRes.data;
      reportTest('Fetch Client User Profile (GET /api/users/profile)', true, `Name: ${u.name}, Email: ${u.email}, Role: ${u.companyRole || u.role}`);
    } else {
      reportTest('Fetch Client User Profile (GET /api/users/profile)', false, profileRes.data?.message || 'Failed');
    }
  } catch (err) {
    reportTest('Fetch Client User Profile (GET /api/users/profile)', false, err.response?.data?.message || err.message);
  }

  console.log('\n=================================================================');
  const totalPassed = results.filter(r => r.passed).length;
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${totalPassed} | FAILED: ${results.length - totalPassed}`);
  console.log('=================================================================\n');
}

runTests().catch(console.error);
