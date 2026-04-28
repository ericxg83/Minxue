const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

  await page.goto('http://localhost:3000/');
  await page.waitForTimeout(2000);
  
  // Clean start just in case
  await page.evaluate(() => {
    localStorage.removeItem('mock-students');
    localStorage.removeItem('student-storage');
  });
  await page.reload();
  await page.waitForTimeout(2000);
  
  console.log('--- Initial ---');
  let ls = await page.evaluate(() => localStorage.getItem('mock-students'));
  console.log('mock-students length:', ls ? JSON.parse(ls).length : 0);
  
  // Set page to students directly bypassing UI
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('ui-storage') || '{}');
    state.state = state.state || {};
    state.state.currentPage = 'students';
    localStorage.setItem('ui-storage', JSON.stringify(state));
  });
  await page.reload();
  await page.waitForTimeout(2000);

  // Click Add
  await page.click('text=添加学生');
  await page.waitForTimeout(500);
  await page.fill('input[placeholder="请输入学生姓名"]', 'Test Agent');
  await page.click('text=保存');
  await page.waitForTimeout(1000);
  
  console.log('--- After Add ---');
  ls = await page.evaluate(() => localStorage.getItem('mock-students'));
  console.log('mock-students length:', ls ? JSON.parse(ls).length : 0);
  console.log('mock-students content:', ls);
  
  let zs = await page.evaluate(() => localStorage.getItem('student-storage'));
  console.log('Zustand students length:', zs ? JSON.parse(zs).state.students.length : 0);
  
  await page.reload();
  await page.waitForTimeout(2000);
  
  console.log('--- After Refresh ---');
  ls = await page.evaluate(() => localStorage.getItem('mock-students'));
  console.log('mock-students length:', ls ? JSON.parse(ls).length : 0);
  
  zs = await page.evaluate(() => localStorage.getItem('student-storage'));
  console.log('Zustand students length:', zs ? JSON.parse(zs).state.students.length : 0);
  
  await browser.close();
})();
