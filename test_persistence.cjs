const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  await page.goto('http://localhost:3001/');
  
  // Wait for load
  await page.waitForTimeout(2000);
  
  // 1. Initial LocalStorage
  let ls = await page.evaluate(() => localStorage.getItem('mock-students'));
  let zs = await page.evaluate(() => localStorage.getItem('student-storage'));
  console.log('--- Initial ---');
  console.log('mock-students length:', ls ? JSON.parse(ls).length : 0);
  
  // 2. Navigate to Students page
  // The bottom nav usually has an item with text "学生" or similar. 
  // Let's look for the element containing "我的学生" text or just use page.evaluate to set the store state.
  await page.evaluate(() => {
    // Just force the navigation if we can't click
    window.__setPage = () => {
      document.querySelector('div:has-text("我的学生")') || document.querySelector('div:has-text("学生")');
    };
  });
  
  // Actually, we can click the button in the bottom tab bar. It's an antd-mobile TabBar item.
  await page.locator('.adm-tab-bar-item').nth(4).click(); // assuming Students is the 5th tab
  await page.waitForTimeout(1000);
  
  // 3. Click Add Student
  await page.click('text=添加学生');
  await page.waitForTimeout(500);
  await page.fill('input[placeholder="请输入学生姓名"]', 'Test Agent');
  await page.click('text=保存');
  await page.waitForTimeout(1000);
  
  // 4. LocalStorage after Add
  ls = await page.evaluate(() => localStorage.getItem('mock-students'));
  zs = await page.evaluate(() => localStorage.getItem('student-storage'));
  console.log('--- After Add ---');
  console.log('mock-students length:', ls ? JSON.parse(ls).length : 0);
  
  // 5. Refresh page
  await page.reload();
  await page.waitForTimeout(2000);
  
  // 6. LocalStorage after Refresh
  ls = await page.evaluate(() => localStorage.getItem('mock-students'));
  zs = await page.evaluate(() => localStorage.getItem('student-storage'));
  console.log('--- After Refresh ---');
  console.log('mock-students length:', ls ? JSON.parse(ls).length : 0);
  console.log('Zustand students length:', zs ? JSON.parse(zs).state.students.length : 0);
  
  await browser.close();
})();
