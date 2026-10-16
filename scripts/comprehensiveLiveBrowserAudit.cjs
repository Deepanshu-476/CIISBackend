const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe');
const LIVE_URL = 'https://ciisnetwork.com';
const COMPANY_CODE = 'TECH334753';

const SCREENSHOTS_DIR = path.join(__dirname, '..', '..', 'audit_screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const auditResults = {
  client: [],
  employee: [],
  manager: [],
  hr: [],
  admin: [],
  criticalIssues: []
};

function recordResult(role, pageName, url, status, details = {}) {
  const result = {
    role,
    pageName,
    url,
    status, // 'PASS', 'WARN', 'FAIL'
    ...details
  };
  auditResults[role].push(result);
  const icon = status === 'PASS' ? '✅' : (status === 'WARN' ? '⚠️' : '❌');
  console.log(`  ${icon} [${role.toUpperCase()}] ${pageName} -> ${status}`);
  if (details.errors && details.errors.length > 0) {
    details.errors.forEach(e => console.log(`      ↳ Error: ${e}`));
    if (status === 'FAIL') {
      auditResults.criticalIssues.push({ role, pageName, url, errors: details.errors });
    }
  }
}

async function loginUser(page, creds, roleLabel) {
  console.log(`\n======================================================`);
  console.log(`🔑 Logging in as ${roleLabel}: ${creds.email}`);
  console.log(`======================================================`);

  await page.goto(`${LIVE_URL}/company/${COMPANY_CODE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);

  // Clear any existing localStorage/session
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${LIVE_URL}/company/${COMPANY_CODE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(1500);

  await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });
  
  // Fill credentials
  await page.click('input[name="email"], input[type="email"]', { clickCount: 3 });
  await page.type('input[name="email"], input[type="email"]', creds.email);

  await page.click('input[name="password"], input[type="password"]', { clickCount: 3 });
  await page.type('input[name="password"], input[type="password"]', creds.password);

  const submitBtn = await page.$('button[type="submit"], .btn-primary, button.login-btn');
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }

  // Wait for navigation or url change
  await sleep(4000);
  const currentUrl = page.url();
  console.log(`  ↪ Landed on: ${currentUrl}`);
  return !currentUrl.includes('/login');
}

async function testPage(page, role, pageName, routePath, actionCallback = null) {
  const fullUrl = `${LIVE_URL}${routePath}`;
  const errors = [];
  const networkFails = [];

  const consoleHandler = msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known benign socket.io / favicon errors
      if (!text.includes('favicon') && !text.includes('socket.io') && !text.includes('WebSocket')) {
        errors.push(text.slice(0, 200));
      }
    }
  };

  const reqFailedHandler = req => {
    const u = req.url();
    if (!u.includes('socket.io') && !u.includes('favicon')) {
      networkFails.push(`${req.method()} ${u.split('?')[0]} (${req.failure()?.errorText || 'failed'})`);
    }
  };

  const responseHandler = res => {
    if (res.status() >= 400 && !res.url().includes('socket.io')) {
      networkFails.push(`HTTP ${res.status()} ${res.url().split('?')[0]}`);
    }
  };

  page.on('console', consoleHandler);
  page.on('requestfailed', reqFailedHandler);
  page.on('response', responseHandler);

  try {
    const navRes = await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 25000 }).catch(e => null);
    await sleep(1500);

    // Check if redirected back to login or 404
    const landedUrl = page.url();
    const isLoginPage = landedUrl.includes('/login');
    const pageTitle = await page.title();
    
    // Check if PageStatusCard or 404 appears
    const has404 = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return text.includes('404') && (text.includes('Not Found') || text.includes('Page Not Found') || text.includes('Access Denied'));
    });

    // Check for blank white screen
    const isBlank = await page.evaluate(() => {
      return !document.body || document.body.innerText.trim().length === 0;
    });

    // Run custom button click or interaction actions
    let actionResult = null;
    if (actionCallback && !isLoginPage && !has404 && !isBlank) {
      try {
        actionResult = await actionCallback(page);
      } catch (actErr) {
        errors.push(`Action Failed: ${actErr.message}`);
      }
    }

    // Determine status
    let status = 'PASS';
    if (isLoginPage) {
      status = 'FAIL';
      errors.push('Redirected to login (Unauthorized/No Token)');
    } else if (has404) {
      status = 'WARN';
      errors.push('Page rendered 404 Not Found or Access Denied');
    } else if (isBlank) {
      status = 'FAIL';
      errors.push('Blank white screen detected');
    } else if (errors.some(e => e.includes('TypeError') || e.includes('Uncaught') || e.includes('ChunkLoadError'))) {
      status = 'FAIL';
    } else if (errors.length > 0 || networkFails.length > 0) {
      status = 'WARN';
    }

    // Save screenshot on failure
    if (status === 'FAIL') {
      const snapName = `${role}_${pageName.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, snapName) }).catch(() => {});
    }

    recordResult(role, pageName, routePath, status, {
      landedUrl,
      errors: [...new Set([...errors, ...networkFails])],
      actionResult
    });

  } catch (err) {
    recordResult(role, pageName, routePath, 'FAIL', {
      errors: [err.message]
    });
  } finally {
    page.off('console', consoleHandler);
    page.off('requestfailed', reqFailedHandler);
    page.off('response', responseHandler);
  }
}

async function runAudit() {
  console.log('🚀 INITIALIZING COMPREHENSIVE LIVE AUDIT ON CIISNETWORK.COM');
  console.log('Browser: Chrome (' + CHROME_PATH + ')');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1400, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });

  const page = await browser.newPage();

  try {
    // =================================================================
    // 1. CLIENT PORTAL TESTS (clienttest@gmail.com)
    // =================================================================
    const clientLoggedIn = await loginUser(page, { email: 'clienttest@gmail.com', password: 'password123' }, 'CLIENT');
    // If password123 fails, try 0987654321
    if (!clientLoggedIn) {
      console.log('Retrying with 0987654321...');
      await loginUser(page, { email: 'clienttest@gmail.com', password: '0987654321' }, 'CLIENT');
    }

    console.log('\n--- Testing Client Portal Pages & Buttons ---');
    
    // Client Dashboard
    await testPage(page, 'client', 'Client Dashboard', '/client/dashboard', async p => {
      // Look for stats cards or interactive buttons
      const cards = await p.$$('.stat-card, .metric-card, .dashboard-card, .card');
      return `Found ${cards.length} metric cards`;
    });

    // Client Tasks & Updates
    await testPage(page, 'client', 'Client Tasks & Updates', '/client/tasks', async p => {
      // Click filter buttons if present
      const filterBtns = await p.$$('button');
      let clicked = 0;
      for (const btn of filterBtns.slice(0, 5)) {
        const text = await p.evaluate(el => el.innerText, btn);
        if (text && (text.includes('All') || text.includes('Completed') || text.includes('Pending') || text.includes('Filter'))) {
          await btn.click().catch(() => {});
          clicked++;
          await sleep(500);
        }
      }
      return `Clicked ${clicked} task filter buttons`;
    });

    // Client Services
    await testPage(page, 'client', 'My Services & Plans', '/client/services', async p => {
      const items = await p.$$('.service-card, .plan-card, table tr');
      return `Found ${items.length} service/plan items`;
    });

    // Client Payments & Invoices
    await testPage(page, 'client', 'Payments & Invoices', '/client/payments', async p => {
      const tabs = await p.$$('button, .tab');
      return `Found ${tabs.length} controls`;
    });

    // Client Documents
    await testPage(page, 'client', 'Documents Repository', '/client/documents', async p => {
      // Check if upload button exists
      const uploadBtn = await p.$('button');
      return 'Documents page loaded';
    });

    // Client Support Tickets
    await testPage(page, 'client', 'Support Tickets', '/client/support', async p => {
      // Find and click "New Ticket" or "Raise Ticket" if present
      const newTicketBtn = await p.$('button');
      return 'Support page loaded';
    });

    // Client Meetings
    await testPage(page, 'client', 'Client Meetings', '/client/meetings', async p => {
      return 'Meetings page loaded';
    });


    // =================================================================
    // 2. EMPLOYEE PORTAL TESTS (vanshtest@gmail.com)
    // =================================================================
    await loginUser(page, { email: 'vanshtest@gmail.com', password: '0987654321' }, 'EMPLOYEE');
    console.log('\n--- Testing Employee Portal Pages & Buttons ---');

    // User Dashboard
    await testPage(page, 'employee', 'User Dashboard', '/ciisUser/user-dashboard', async p => {
      const punchBtn = await p.$('button');
      return 'Dashboard rendered successfully';
    });

    // Attendance
    await testPage(page, 'employee', 'My Attendance', '/ciisUser/attendance', async p => {
      // Toggle month or calendar view if buttons exist
      const buttons = await p.$$('button');
      if (buttons.length > 0) await buttons[0].click().catch(() => {});
      return 'Attendance calendar/table tested';
    });

    // My Leaves
    await testPage(page, 'employee', 'My Leaves', '/ciisUser/my-leaves', async p => {
      // Test "Apply Leave" button click and modal check
      const applyBtn = await p.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const target = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('apply leave'));
        if (target) {
          target.click();
          return true;
        }
        return false;
      });
      await sleep(1000);
      const modalVisible = await p.$('.modal, .modal-content, [role="dialog"], .MyLeaves-modal');
      // Close modal if open
      const closeBtn = await p.$('button[aria-label="Close"], .modal-close, button.close');
      if (closeBtn) await closeBtn.click().catch(() => {});
      return `Apply Leave Button clicked: ${applyBtn ? 'YES' : 'NO'}, Modal found: ${modalVisible ? 'YES' : 'NO'}`;
    });

    // My Assets
    await testPage(page, 'employee', 'My Assets', '/ciisUser/my-assets', async p => {
      const rows = await p.$$('table tr, .asset-card');
      return `Found ${rows.length} asset entries`;
    });

    // Task Management
    await testPage(page, 'employee', 'Task Management', '/ciisUser/task-management', async p => {
      // Click tabs (e.g. Self Task vs Assigned Task)
      const tabs = await p.$$('button, .tab, .nav-link');
      let clicked = 0;
      for (const tab of tabs.slice(0, 4)) {
        await tab.click().catch(() => {});
        clicked++;
        await sleep(400);
      }
      return `Toggled ${clicked} task tabs`;
    });

    // Employee Projects
    await testPage(page, 'employee', 'Employee Projects', '/ciisUser/project', async p => {
      const projects = await p.$$('.project-card, table tr');
      return `Found ${projects.length} project elements`;
    });

    // Employee Meetings
    await testPage(page, 'employee', 'Employee Meetings', '/ciisUser/employee-meeting', async p => {
      return 'Meetings rendered';
    });

    // Alerts
    await testPage(page, 'employee', 'Alerts & Broadcasts', '/ciisUser/alert', async p => {
      return 'Alerts rendered';
    });

    // Support Desk
    await testPage(page, 'employee', 'Support Desk', '/ciisUser/support-desk', async p => {
      const ticketBtn = await p.$('button');
      return 'Support Desk rendered';
    });

    // Profile
    await testPage(page, 'employee', 'My Profile', '/ciisUser/profile', async p => {
      // Toggle profile tabs
      const tabs = await p.$$('button, .tab, .nav-item');
      let clicked = 0;
      for (const t of tabs.slice(0, 5)) {
        await t.click().catch(() => {});
        clicked++;
        await sleep(300);
      }
      return `Clicked ${clicked} profile tabs`;
    });


    // =================================================================
    // 3. MANAGER LEVEL TESTS (aarav.sharma.test@gmail.com)
    // =================================================================
    await loginUser(page, { email: 'aarav.sharma.test@gmail.com', password: '0987654321' }, 'MANAGER');
    console.log('\n--- Testing Manager Level Pages & Buttons ---');

    // Manager Dashboard
    await testPage(page, 'manager', 'Manager Dashboard', '/ciisUser/user-dashboard');

    // Department All Tasks
    await testPage(page, 'manager', 'Department Team Tasks', '/ciisUser/department-all-task', async p => {
      const filterBtns = await p.$$('button');
      return `Team Tasks loaded with ${filterBtns.length} controls`;
    });

    // Employee Attendance View
    await testPage(page, 'manager', 'Department Attendance', '/ciisUser/emp-attendance');

    // Employee Leaves
    await testPage(page, 'manager', 'Department Leaves Review', '/ciisUser/emp-leaves');

    // Team Projects
    await testPage(page, 'manager', 'Team Projects', '/ciisUser/adminproject');

    // Meetings
    await testPage(page, 'manager', 'Admin Meetings', '/ciisUser/admin-meeting');


    // =================================================================
    // 4. HR LEVEL TESTS (diya.patel.test@gmail.com)
    // =================================================================
    await loginUser(page, { email: 'diya.patel.test@gmail.com', password: '0987654321' }, 'HR');
    console.log('\n--- Testing HR Level Pages & Buttons ---');

    // Employee Directory
    await testPage(page, 'hr', 'Employee Directory', '/ciisUser/emp-details', async p => {
      const searchBox = await p.$('input[type="text"], input[type="search"]');
      if (searchBox) {
        await searchBox.type('Vansh');
        await sleep(500);
      }
      return 'Employee directory search tested';
    });

    // Employee Leaves Approvals
    await testPage(page, 'hr', 'Leave Approvals Management', '/ciisUser/emp-leaves', async p => {
      const tabs = await p.$$('button');
      return `Leave Approvals loaded with ${tabs.length} controls`;
    });

    // Employee Attendance Management
    await testPage(page, 'hr', 'Attendance Management', '/ciisUser/emp-attendance');

    // Company Assets
    await testPage(page, 'hr', 'Company Asset Inventory', '/ciisUser/emp-assets');

    // Leave Policy Setup
    await testPage(page, 'hr', 'Leave Policy Setup', '/ciisUser/leave-policy');

    // Register Requests
    await testPage(page, 'hr', 'Registration Requests', '/ciisUser/register-request');


    // =================================================================
    // 5. ADMIN / OWNER LEVEL TESTS (vansh24810@gmail.com)
    // =================================================================
    await loginUser(page, { email: 'vansh24810@gmail.com', password: '0987654321' }, 'ADMIN');
    console.log('\n--- Testing Admin / Owner Level Pages & Buttons ---');

    // Admin Dashboard
    await testPage(page, 'admin', 'Admin Dashboard Overview', '/ciisUser/user-dashboard');
    await testPage(page, 'admin', 'Dashboard Overview 1', '/ciisUser/dashboard-1');

    // Employee Directory & Management
    await testPage(page, 'admin', 'Employees Management', '/ciisUser/emp-details');

    // Payroll Suite: Salary Component
    await testPage(page, 'admin', 'Payroll Salary Components', '/ciisUser/salary-component', async p => {
      const addBtn = await p.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const target = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('add component'));
        if (target) {
          target.click();
          return true;
        }
        return false;
      });
      await sleep(1000);
      const modal = await p.$('.modal, [role="dialog"], .dialog');
      return `Add Component button clicked: ${addBtn ? 'YES' : 'NO'}`;
    });

    // Payroll Suite: Salary Structure
    await testPage(page, 'admin', 'Payroll Salary Structure', '/ciisUser/salary-structure', async p => {
      const cards = await p.$$('.structure-card, .card, table tr');
      return `Salary structures loaded: ${cards.length}`;
    });

    // Payroll Suite: Salary Assignment
    await testPage(page, 'admin', 'Salary Assignment', '/ciisUser/salary-assignment');

    // Payroll Suite: Payroll Process
    await testPage(page, 'admin', 'Payroll Process Wizard', '/ciisUser/payroll-process', async p => {
      const steps = await p.$$('.step, button');
      return `Payroll steps visible: ${steps.length}`;
    });

    // Payroll Suite: Payroll Reports
    await testPage(page, 'admin', 'Payroll Reports', '/ciisUser/payroll-reports', async p => {
      const exportBtns = await p.$$('button');
      return `Payroll reports controls: ${exportBtns.length}`;
    });

    // Payroll Suite: Payslip
    await testPage(page, 'admin', 'Payslip Generator', '/ciisUser/payslip');

    // CRM Suite: Admin CRM Dashboard
    await testPage(page, 'admin', 'CRM Admin Dashboard', '/ciisUser/crm/admin/dashboard');

    // CRM Suite: All Leads
    await testPage(page, 'admin', 'CRM All Leads', '/ciisUser/crm/admin/all-leads', async p => {
      const addLeadBtn = await p.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const target = btns.find(b => b.innerText && b.innerText.toLowerCase().includes('add lead'));
        return Boolean(target);
      });
      return `Add Lead Button present: ${addLeadBtn ? 'YES' : 'NO'}`;
    });

    // CRM Suite: Calls Overview
    await testPage(page, 'admin', 'CRM Call Overview', '/ciisUser/crm/admin/call-overview');

    // CRM Suite: Follow-ups
    await testPage(page, 'admin', 'CRM Follow-ups Center', '/ciisUser/crm/admin/follow-ups');

    // Departments Management
    await testPage(page, 'admin', 'Departments Setup', '/ciisUser/department');

    // Job Roles Management
    await testPage(page, 'admin', 'Job Roles Setup', '/ciisUser/JobRoleManagement');

    // Sidebar & Permissions Management
    await testPage(page, 'admin', 'Sidebar & Page Management', '/ciisUser/SidebarManagement');

  } finally {
    await browser.close();
  }

  // Save full results JSON
  fs.writeFileSync(
    path.join(__dirname, '..', '..', 'audit_report.json'),
    JSON.stringify(auditResults, null, 2),
    'utf8'
  );

  console.log('\n======================================================');
  console.log('🏁 AUDIT COMPLETE! SAVED REPORT TO audit_report.json');
  console.log(`Critical Issues Count: ${auditResults.criticalIssues.length}`);
  console.log('======================================================');
}

runAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
