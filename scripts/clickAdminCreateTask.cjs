const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    headless: 'new',
    defaultViewport: { width: 1366, height: 768 }
  });
  const page = await browser.newPage();
  
  // Login
  await page.goto('https://ciisnetwork.com/company/TECH334753/login', { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'clienttest@gmail.com');
  await page.type('input[type="password"]', '0987654321');
  const btn = await page.$('button[type="submit"]');
  if (btn) await btn.click();
  else await page.keyboard.press('Enter');
  
  await new Promise(r => setTimeout(r, 4000));
  
  // Go to tasks
  await page.goto('https://ciisnetwork.com/client/tasks-updates', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  
  // Click 'Admin Create Task'
  const clicked = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(el => el.innerText.includes('Admin Create Task'));
    if (b) { b.click(); return true; }
    return false;
  });
  console.log('Clicked Admin Create Task button:', clicked);
  
  await new Promise(r => setTimeout(r, 3000));
  console.log('Current URL after click:', page.url());
  
  const shotPath = 'C:\\Users\\VANSH GUPTA\\.gemini\\antigravity-ide\\brain\\920e0aa3-74cd-4677-936b-238bc9be0f33\\live_admin_create_task_403.png';
  await page.screenshot({ path: shotPath });
  console.log('Screenshot saved to:', shotPath);
  
  await browser.close();
})();
