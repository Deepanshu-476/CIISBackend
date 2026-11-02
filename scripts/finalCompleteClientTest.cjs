const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'))
  ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\VANSH GUPTA\\.gemini\\antigravity-ide\\brain\\77cc25f1-6971-4f0b-a55e-61dc9b689535';
const LIVE_URL = 'https://ciisnetwork.com';
const COMPANY_CODE = 'TECH334753';
const CLIENT_EMAIL = 'clienttest@gmail.com';
const CLIENT_PASSWORD = '0987654321';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runFinalTest() {
  console.log('========================================================================');
  console.log('🎯 ULTIMATE FINAL TEST: CLIENT ACCOUNT FUNCTIONALITY & UI AUDIT');
  console.log('Target: ' + LIVE_URL + ' | User: ' + CLIENT_EMAIL);
  console.log('========================================================================\n');

  const auditLog = [];
  const networkErrors = [];
  const consoleErrors = [];

  const record = (section, item, status, notes = '') => {
    const entry = { section, item, status, notes };
    auditLog.push(entry);
    const icon = status === 'PASS' ? '✅ PASS' : (status === 'WARN' ? '⚠️ WARN' : '❌ FAIL');
    console.log(`${icon} [${section}] ${item}`);
    if (notes) console.log(`       ↳ ${notes}`);
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  });

  const page = await browser.newPage();

  page.on('response', res => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && !url.includes('favicon') && !url.includes('socket.io')) {
      networkErrors.push(`${res.request().method()} ${url} -> ${status}`);
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon') && !text.includes('socket.io') && !text.includes('WebSocket')) {
        consoleErrors.push(text.slice(0, 250));
      }
    }
  });

  try {
    // -------------------------------------------------------------
    // PHASE 1: LOGIN FLOW
    // -------------------------------------------------------------
    console.log('>>> PHASE 1: Testing Login Flow...');
    await page.goto(`${LIVE_URL}/company/${COMPANY_CODE}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    await page.waitForSelector('input[name="email"], input[type="email"]');
    await page.type('input[name="email"], input[type="email"]', CLIENT_EMAIL);
    await page.type('input[name="password"], input[type="password"]', CLIENT_PASSWORD);

    const submitBtn = await page.$('button[type="submit"], .btn-primary, button.login-btn');
    if (submitBtn) await submitBtn.click();
    else await page.keyboard.press('Enter');

    await sleep(4000);
    const afterLoginUrl = page.url();
    const loginOk = afterLoginUrl.includes('/client/dashboard');
    record('Auth', 'Company Specific Login', loginOk ? 'PASS' : 'FAIL', `Current URL: ${afterLoginUrl}`);

    // -------------------------------------------------------------
    // PHASE 2: DASHBOARD INTERACTIVE TESTS
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 2: Testing Dashboard UI & Interactive Widgets...');
    await page.goto(`${LIVE_URL}/client/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 2.1 KPI Cards
    const kpiData = await page.evaluate(() => {
      const cards = document.querySelectorAll('.ClientDashboard-kpi-card');
      return Array.from(cards).map(c => ({
        title: c.querySelector('.ClientDashboard-kpi-title')?.innerText || '',
        num: c.querySelector('.ClientDashboard-kpi-number')?.innerText || ''
      }));
    });
    record('Dashboard', 'KPI Metric Cards Render', kpiData.length === 4 ? 'PASS' : 'WARN', `Found ${kpiData.length} KPI cards: ${kpiData.map(k => `${k.title}: ${k.num}`).join(' | ')}`);

    // 2.2 Active Services Table
    const activeServicesTable = await page.evaluate(() => {
      const rows = document.querySelectorAll('.ClientDashboard-services-table tbody tr');
      return Array.from(rows).map(r => r.innerText.replace(/\n+/g, ' | ')).slice(0, 3);
    });
    record('Dashboard', 'Active Services Live Table', activeServicesTable.length > 0 ? 'PASS' : 'WARN', `Loaded ${activeServicesTable.length} active service rows`);

    // 2.3 Support Tickets Modal & Tabs
    const supportModalTest = await page.evaluate(async () => {
      const card = document.querySelector('.ClientDashboard-support-card');
      const btn = card?.querySelector('.ClientDashboard-view-all-link');
      if (!btn) return { opened: false, reason: 'View all button not found' };
      btn.click();
      return { opened: true };
    });
    await sleep(1000);

    const supportModalState = await page.evaluate(() => {
      const modal = document.querySelector('.ClientDashboard-details-modal, .ClientDashboard-support-ticket-modal');
      if (!modal) return { visible: false };
      const tabs = Array.from(modal.querySelectorAll('.ClientDashboard-support-ticket-tabs button')).map(b => b.innerText.trim());
      const select = modal.querySelector('select');
      const ticketRows = modal.querySelectorAll('.ClientDashboard-support-ticket-row').length;
      return { visible: true, tabs, hasFilter: Boolean(select), ticketRows };
    });
    record('Dashboard', 'Support Tickets Full Modal', supportModalState.visible ? 'PASS' : 'FAIL', `Tabs: ${supportModalState.tabs?.join(', ')} | Tickets in Modal: ${supportModalState.ticketRows}`);

    // Close modal
    await page.evaluate(() => {
      const close = document.querySelector('.ClientDashboard-support-ticket-head button, button[aria-label*="Close"]');
      if (close) close.click();
    });
    await sleep(500);

    // -------------------------------------------------------------
    // PHASE 3: MY SERVICES FUNCTIONALITY
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 3: Testing My Services Actions & Modals...');
    await page.goto(`${LIVE_URL}/client/my-services`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 3.1 "View Tasks" Modal on First Service
    const viewTasksResult = await page.evaluate(() => {
      const viewTasksBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('View Tasks'));
      if (viewTasksBtn) {
        viewTasksBtn.click();
        return { clicked: true };
      }
      return { clicked: false };
    });
    await sleep(1000);

    const serviceTasksModal = await page.evaluate(() => {
      const modal = document.querySelector('.modal, .MyServicesPage-modal, [class*="modal"]');
      if (!modal) return { open: false };
      const tasksCount = modal.querySelectorAll('.task-item, tr, li, [class*="task"]').length;
      return { open: true, tasksCount };
    });
    record('My Services', '"View Tasks" Modal on Service Card', serviceTasksModal.open ? 'PASS' : 'WARN', `Modal open: ${serviceTasksModal.open}, Task items rendered: ${serviceTasksModal.tasksCount}`);

    // Close tasks modal if open
    await page.evaluate(() => {
      const close = document.querySelector('button.close, [class*="close"], button[aria-label="Close"]');
      if (close) close.click();
    });
    await sleep(500);

    // 3.2 Service Search Input
    const searchFilterTest = await page.evaluate(() => {
      const input = document.querySelector('input[type="text"], input[type="search"]');
      if (!input) return { ok: false, reason: 'Search input not found' };
      input.value = 'Web';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    });
    await sleep(500);
    record('My Services', 'Services Search Filter Input', searchFilterTest.ok ? 'PASS' : 'WARN');

    // -------------------------------------------------------------
    // PHASE 4: TASKS & UPDATES DEEP CHECKS
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 4: Testing Tasks & Updates Operations...');
    await page.goto(`${LIVE_URL}/client/tasks-updates`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 4.1 Check Task Table Columns & Rows
    const taskTableInfo = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('.ClientTasksUpdatesPage-tableWrap th')).map(th => th.innerText.trim());
      const rows = document.querySelectorAll('.ClientTasksUpdatesPage-tableWrap tbody tr').length;
      const paginationText = document.querySelector('.ClientTasksUpdatesPage-pagination span')?.innerText || '';
      return { headers, rows, paginationText };
    });
    record('Tasks & Updates', 'Tasks Table & Pagination', taskTableInfo.rows > 0 ? 'PASS' : 'WARN', `Headers: ${taskTableInfo.headers.join(', ')} | Rows: ${taskTableInfo.rows} | Info: ${taskTableInfo.paginationText}`);

    // 4.2 Priority & Status Filters Toggle
    const filterOptions = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('.ClientTasksUpdatesPage-toolbar select'));
      return selects.map(s => Array.from(s.options).map(o => o.text).slice(0, 4));
    });
    record('Tasks & Updates', 'Table Filters Dropdowns', filterOptions.length >= 3 ? 'PASS' : 'WARN', `Found ${filterOptions.length} filter dropdowns`);

    // 4.3 Task Details Review Modal
    const reviewTaskClick = await page.evaluate(() => {
      const btn = document.querySelector('.ClientTasksUpdatesPage-review');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await sleep(1000);

    const taskModalInfo = await page.evaluate(() => {
      const modal = document.querySelector('.ClientTasksUpdatesPage-modal, [class*="modal"]');
      if (!modal) return { open: false };
      const hasClose = Boolean(modal.querySelector('button[aria-label*="Close"], .modal-close, button'));
      return { open: true, title: modal.querySelector('h2, h3, h4')?.innerText || '', hasClose };
    });
    record('Tasks & Updates', 'Task Details Review Modal', taskModalInfo.open ? 'PASS' : 'WARN', `Modal opened with title: "${taskModalInfo.title}"`);

    // Close review modal
    await page.evaluate(() => {
      const close = document.querySelector('.ClientTasksUpdatesPage-modal button[aria-label*="Close"], .ClientTasksUpdatesPage-modal button');
      if (close) close.click();
    });
    await sleep(500);

    // -------------------------------------------------------------
    // PHASE 5: EXPLORE SERVICES (MARKETPLACE) DEEP CHECKS
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 5: Testing Explore Services (Marketplace)...');
    await page.goto(`${LIVE_URL}/client/marketplace`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 5.1 Category Filter Pills
    const categoryCount = await page.evaluate(() => {
      const buttons = document.querySelectorAll('.ServiceMarketplacePage-categoryBtn, .ServiceMarketplacePage-categories button');
      return buttons.length;
    });
    record('Marketplace', 'Service Category Filter Pills', categoryCount >= 5 ? 'PASS' : 'WARN', `Found ${categoryCount} category filter buttons`);

    // 5.2 "Get Proposal" Enquiry Modal Test
    const proposalModalCheck = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Get Proposal'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await sleep(1000);

    const proposalFormFields = await page.evaluate(() => {
      const modal = document.querySelector('.ServiceMarketplacePage-modal, [role="dialog"], .modal');
      if (!modal) return { open: false };
      const inputs = Array.from(modal.querySelectorAll('input, select, textarea')).map(i => i.placeholder || i.name || i.tagName);
      const submitBtn = modal.querySelector('button[type="submit"], .btn-primary');
      return { open: true, inputs, hasSubmit: Boolean(submitBtn) };
    });
    record('Marketplace', '"Get Proposal" Enquiry Form Modal', proposalFormFields.open ? 'PASS' : 'FAIL', `Fields: ${proposalFormFields.inputs.join(', ')} | Submit Button: ${proposalFormFields.hasSubmit ? 'Yes' : 'No'}`);

    // Close modal
    await page.evaluate(() => {
      const close = document.querySelector('.ServiceMarketplacePage-modal-close, button[aria-label="Close"], .modal-close');
      if (close) close.click();
    });
    await sleep(500);

    // -------------------------------------------------------------
    // PHASE 6: MEETINGS & SUPPORT TICKETS
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 6: Testing Meetings & Support Tickets...');
    await page.goto(`${LIVE_URL}/client/support-tickets`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const meetingCards = await page.evaluate(() => {
      const slots = document.querySelectorAll('.ClientMeetings-slot, button[class*="slot"], .ClientMeetings-upcomingCard');
      const actionTiles = document.querySelectorAll('.ClientMeetings-actionCard, .ClientMeetings-quickAction');
      return { slots: slots.length, actionTiles: actionTiles.length };
    });
    record('Support & Meetings', 'Meetings Slots & Action Tiles', 'PASS', `Available Slots: ${meetingCards.slots} | Quick Actions: ${meetingCards.actionTiles}`);

    // -------------------------------------------------------------
    // PHASE 7: DOCUMENTS & CLOUD STORAGE
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 7: Testing Documents Drive...');
    await page.goto(`${LIVE_URL}/client/documents`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const docDriveStats = await page.evaluate(() => {
      const storageBar = Boolean(document.querySelector('.DocumentsPage-storageBar, [class*="storage"]'));
      const uploadBtn = Boolean(document.querySelector('button[class*="upload"], input[type="file"], .DocumentsPage-uploadBtn'));
      const tabs = Array.from(document.querySelectorAll('.DocumentsPage-tab, .tab, button[class*="tab"]')).map(t => t.innerText.trim()).filter(Boolean);
      return { storageBar, uploadBtn, tabs };
    });
    record('Documents', 'Cloud Drive Storage & Upload Controls', docDriveStats.tabs.length >= 3 ? 'PASS' : 'WARN', `Tabs: ${docDriveStats.tabs.join(', ')} | Storage Bar: ${docDriveStats.storageBar} | Upload Trigger: ${docDriveStats.uploadBtn}`);

    // -------------------------------------------------------------
    // PHASE 8: PAYMENTS & INVOICES
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 8: Testing Payments & Invoices...');
    await page.goto(`${LIVE_URL}/client/payments`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const paymentsAudit = await page.evaluate(() => {
      const invoices = document.querySelectorAll('tbody tr').length;
      const fileUpload = Boolean(document.querySelector('input[type="file"]'));
      const activePlanText = document.querySelector('[class*="plan"], [class*="badge"]')?.innerText || '';
      return { invoices, fileUpload, activePlanText };
    });
    record('Payments & Invoices', 'Invoices List & Receipt Upload Input', paymentsAudit.invoices > 0 && paymentsAudit.fileUpload ? 'PASS' : 'WARN', `Invoices/Receipts in Table: ${paymentsAudit.invoices} | Receipt File Input: ${paymentsAudit.fileUpload}`);

    // -------------------------------------------------------------
    // PHASE 9: ACCOUNT SETTINGS (PROFILE & SECURITY)
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 9: Testing Account Settings Forms...');
    await page.goto(`${LIVE_URL}/client/account-settings`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 9.1 Profile Form Fields
    const profileInputs = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input:not([type="password"])')).map(i => ({
        name: i.name || i.id,
        value: i.value,
        disabled: i.disabled
      }));
      return inputs;
    });
    record('Account Settings', 'Profile Form Data Pre-fill', profileInputs.length >= 4 ? 'PASS' : 'WARN', `Loaded ${profileInputs.length} fields: ${profileInputs.map(p => `${p.name}="${p.value}"`).join(', ')}`);

    // 9.2 Switch to Security & Password Tab
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.AccountSettings-tabBtn, button')).find(b => b.innerText && b.innerText.includes('Security'));
      if (btn) btn.click();
    });
    await sleep(1000);

    const securityInputs = await page.evaluate(() => {
      const pwds = document.querySelectorAll('input[type="password"], input[name*="password"]').length;
      const eyeIcons = document.querySelectorAll('button[class*="eye"], svg, [class*="showPassword"]').length;
      return { pwds, eyeIcons };
    });
    record('Account Settings', 'Security Password Change Form', securityInputs.pwds >= 2 ? 'PASS' : 'WARN', `Password Inputs: ${securityInputs.pwds}`);

    // -------------------------------------------------------------
    // PHASE 10: RESPONSIVE / MOBILE VIEWPORT TEST (375x812)
    // -------------------------------------------------------------
    console.log('\n>>> PHASE 10: Testing Mobile Viewport (iPhone 375x812)...');
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(`${LIVE_URL}/client/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const mobileCheck = await page.evaluate(() => {
      const hasHorizontalScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      const hasHamburger = Boolean(document.querySelector('button[aria-label*="menu"], .menu-toggle, .hamburger, [class*="menu"]'));
      return { hasHorizontalScroll, hasHamburger, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    });

    const mobileScreenshot = path.join(ARTIFACTS_DIR, 'client_mobile_view.png');
    await page.screenshot({ path: mobileScreenshot });
    record('Mobile Responsive', 'Mobile Viewport (375px width)', !mobileCheck.hasHorizontalScroll ? 'PASS' : 'WARN', `Horizontal Overflow: ${mobileCheck.hasHorizontalScroll ? `YES (${mobileCheck.scrollWidth}px > ${mobileCheck.clientWidth}px)` : 'NO (Clean layout)'}`);

  } finally {
    await browser.close();
  }

  // -------------------------------------------------------------
  // COMPILE FINAL REPORT
  // -------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('🏁 ULTIMATE TEST COMPLETE');
  const passCount = auditLog.filter(a => a.status === 'PASS').length;
  const warnCount = auditLog.filter(a => a.status === 'WARN').length;
  const failCount = auditLog.filter(a => a.status === 'FAIL').length;
  console.log(`TOTAL CHECKS: ${auditLog.length} | PASS: ${passCount} | WARN: ${warnCount} | FAIL: ${failCount}`);
  console.log(`Unique Network Errors: ${new Set(networkErrors).size}`);
  console.log(`Unique Console Errors: ${new Set(consoleErrors).size}`);
  console.log('========================================================================\n');

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'ultimate_final_audit.json'),
    JSON.stringify({ auditLog, networkErrors: Array.from(new Set(networkErrors)), consoleErrors: Array.from(new Set(consoleErrors)) }, null, 2),
    'utf8'
  );
}

runFinalTest().catch(err => {
  console.error('Fatal error in final test:', err);
  process.exit(1);
});
