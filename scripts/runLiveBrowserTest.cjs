const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'))
  ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const ARTIFACTS_DIR = 'C:\\Users\\VANSH GUPTA\\.gemini\\antigravity-ide\\brain\\920e0aa3-74cd-4677-936b-238bc9be0f33';
const LIVE_URL = 'https://ciisnetwork.com';

const CLIENT_CREDS = {
  email: 'clienttest@gmail.com',
  password: '0987654321',
  companyCode: 'TECH334753',
};

const EMPLOYEE_CREDS = {
  email: 'vanshtest@gmail.com',
  password: '0987654321',
  companyCode: 'TECH334753',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBrowserTests() {
  console.log('===============================================================');
  console.log('🚀 STARTING LIVE INTERACTIVE BROWSER TESTING (ciisnetwork.com)');
  console.log('Using Browser Executable:', CHROME_PATH);
  console.log('===============================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: { width: 1366, height: 768 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  });

  const page = await browser.newPage();

  // Listen to console errors and network failures
  const pageErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      pageErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  page.on('requestfailed', request => {
    pageErrors.push(`[Network Failed] ${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
  });

  try {
    // -------------------------------------------------------------
    // TEST 1: CLIENT LOGIN & DASHBOARD
    // -------------------------------------------------------------
    console.log('>>> 1. Navigating to Login Page for Company TECH334753...');
    await page.goto(`${LIVE_URL}/company/TECH334753/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    console.log('>>> 2. Typing Client Credentials...');
    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });
    await page.type('input[name="email"], input[type="email"]', CLIENT_CREDS.email);
    await page.type('input[name="password"], input[type="password"]', CLIENT_CREDS.password);

    console.log('>>> 3. Clicking Login Button...');
    const submitBtn = await page.$('button[type="submit"], .btn-primary, button.login-btn');
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await sleep(5000);
    console.log('>>> 4. Current URL after Login:', page.url());
    const loginScreenshot = path.join(ARTIFACTS_DIR, 'live_client_login.png');
    await page.screenshot({ path: loginScreenshot });
    console.log('📸 Saved Screenshot: live_client_login.png');

    // -------------------------------------------------------------
    // TEST 2: CLIENT TASKS PAGE & ADMIN 403 BUTTON
    // -------------------------------------------------------------
    console.log('\n>>> 5. Navigating to /client/tasks-updates...');
    await page.goto(`${LIVE_URL}/client/tasks-updates`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const tasksScreenshot = path.join(ARTIFACTS_DIR, 'live_client_tasks.png');
    await page.screenshot({ path: tasksScreenshot });
    console.log('📸 Saved Screenshot: live_client_tasks.png');

    console.log('>>> 6. Looking for Task Management / Admin Task Create buttons...');
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
    });
    console.log('Visible buttons on Tasks page:', buttons.filter(Boolean));

    const clickedAdminBtn = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => b.innerText.includes('Task Management') || b.innerText.includes('Admin Task Create')
      );
      if (btn) {
        btn.click();
        return btn.innerText;
      }
      return null;
    });

    if (clickedAdminBtn) {
      console.log(`>>> Clicked button: "${clickedAdminBtn}"`);
      await sleep(3000);
      console.log('URL after clicking Admin button:', page.url());

      const is403 = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        return bodyText.includes('403') || bodyText.includes('Not Enabled in Company Plan') || bodyText.includes('Feature Not Enabled');
      });

      console.log('🚨 403 Forbidden Error screen displayed?:', is403);
      const errScreenshot = path.join(ARTIFACTS_DIR, 'live_client_403_error.png');
      await page.screenshot({ path: errScreenshot });
      console.log('📸 Saved Screenshot: live_client_403_error.png');
    } else {
      console.log('⚠️ Admin button not found directly in DOM');
    }

    // -------------------------------------------------------------
    // TEST 3: CLIENT SUPPORT TICKETS PAGE & CREATE TICKET CRASH
    // -------------------------------------------------------------
    console.log('\n>>> 7. Navigating to /client/support-tickets...');
    await page.goto(`${LIVE_URL}/client/support-tickets`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const supportScreenshot = path.join(ARTIFACTS_DIR, 'live_client_support.png');
    await page.screenshot({ path: supportScreenshot });
    console.log('📸 Saved Screenshot: live_client_support.png');

    console.log('>>> 8. Clicking "Raise Ticket" / "New Ticket" button...');
    const openedModal = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => b.innerText.toLowerCase().includes('raise') || b.innerText.toLowerCase().includes('ticket') || b.innerText.toLowerCase().includes('create')
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    if (openedModal) {
      await sleep(2000);
      console.log('>>> Modal opened. Filling subject and message...');
      const inputs = await page.$$('input[type="text"], textarea');
      if (inputs.length >= 2) {
        await inputs[0].type('Live QA Automated Test Ticket');
        await inputs[1].type('Testing support ticket creation live from browser script');
        
        console.log('>>> Submitting Ticket...');
        const submitTicketBtn = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(
            b => b.innerText.toLowerCase().includes('submit') || b.innerText.toLowerCase().includes('send')
          );
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });

        await sleep(4000);
        const ticketResultScreenshot = path.join(ARTIFACTS_DIR, 'live_ticket_submit_result.png');
        await page.screenshot({ path: ticketResultScreenshot });
        console.log('📸 Saved Screenshot: live_ticket_submit_result.png');

        const pageText = await page.evaluate(() => document.body.innerText);
        console.log('Has Error on Ticket Submit?:', pageText.includes('500') || pageText.includes('Failed') || pageText.includes('error'));
      }
    }

    // -------------------------------------------------------------
    // TEST 4: EMPLOYEE LOGIN & ASSETS / ATTENDANCE
    // -------------------------------------------------------------
    console.log('\n>>> 9. Logging out and testing Employee Account (vanshtest@gmail.com)...');
    await page.goto(`${LIVE_URL}/company/TECH334753/login`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });
    await page.type('input[name="email"], input[type="email"]', EMPLOYEE_CREDS.email);
    await page.type('input[name="password"], input[type="password"]', EMPLOYEE_CREDS.password);

    const empSubmitBtn = await page.$('button[type="submit"], .btn-primary, button.login-btn');
    if (empSubmitBtn) await empSubmitBtn.click();
    else await page.keyboard.press('Enter');

    await sleep(5000);
    console.log('>>> Employee landing URL:', page.url());
    const empLoginScreenshot = path.join(ARTIFACTS_DIR, 'live_employee_dashboard.png');
    await page.screenshot({ path: empLoginScreenshot });
    console.log('📸 Saved Screenshot: live_employee_dashboard.png');

    console.log('\n>>> 10. Navigating to /ciisUser/my-assets...');
    await page.goto(`${LIVE_URL}/ciisUser/my-assets`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const assetsText = await page.evaluate(() => document.body.innerText);
    console.log('My Assets 403 / Access Denied?:', assetsText.includes('Access denied') || assetsText.includes('permission') || assetsText.includes('403'));
    const empAssetsScreenshot = path.join(ARTIFACTS_DIR, 'live_employee_assets.png');
    await page.screenshot({ path: empAssetsScreenshot });
    console.log('📸 Saved Screenshot: live_employee_assets.png');

    console.log('\n>>> 11. Navigating to /ciisUser/profile...');
    await page.goto(`${LIVE_URL}/ciisUser/profile`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const profileText = await page.evaluate(() => document.body.innerText);
    console.log('Profile 500 / Failed to fetch user?:', profileText.includes('Failed to fetch') || profileText.includes('500') || profileText.includes('Error'));
    const empProfileScreenshot = path.join(ARTIFACTS_DIR, 'live_employee_profile.png');
    await page.screenshot({ path: empProfileScreenshot });
    console.log('📸 Saved Screenshot: live_employee_profile.png');

    console.log('\n===============================================================');
    console.log('✅ LIVE BROWSER TESTING COMPLETE!');
    console.log('Captured Screenshots:', [
      'live_client_login.png',
      'live_client_tasks.png',
      'live_client_403_error.png',
      'live_client_support.png',
      'live_ticket_submit_result.png',
      'live_employee_dashboard.png',
      'live_employee_assets.png',
      'live_employee_profile.png'
    ]);
    console.log('===============================================================');

  } catch (err) {
    console.error('Browser testing error:', err.message);
  } finally {
    await browser.close();
  }
}

runBrowserTests();
