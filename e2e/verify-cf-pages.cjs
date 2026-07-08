/**
 * 对线上 Cloudflare Pages 验证组卷选择 bug
 */
const { chromium } = require('playwright');
const APP_URL = 'https://minxue.pages.dev';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  console.log('🧪 测试 Cloudflare Pages: ' + APP_URL);
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // 等待学生加载
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[class*="flex items-center gap-2"]');
    return btn && btn.textContent.trim().length > 0;
  }, { timeout: 15000 });

  const studentName = await page.evaluate(() => {
    const btn = document.querySelector('button[class*="flex items-center gap-2"]');
    return btn?.textContent?.trim() || 'unknown';
  });
  console.log(`   当前学生: ${studentName}`);

  // 导航到组卷记录
  const navTabs = await page.$$('nav.fixed.bottom-0 button');
  if (navTabs.length >= 3) await navTabs[2].click();
  else { console.error('找不到导航'); await browser.close(); return; }

  await page.waitForTimeout(3000);

  // 获取所有试卷
  const examItems = await page.evaluate(() => {
    const items = document.querySelectorAll('h3.truncate');
    const result = [];
    items.forEach((h3, i) => {
      const parent = h3.closest('[class*="card"]') || h3.parentElement;
      const pTexts = parent ? Array.from(parent.querySelectorAll('p')).map(p => p.textContent) : [];
      result.push({ index: i, name: h3.textContent?.trim() || '', details: pTexts });
    });
    return result;
  });

  console.log(`   共 ${examItems.length} 条试卷记录:`);
  examItems.forEach((item, i) => {
    console.log(`   [${i}] ${item.name} | ${item.details.join(' | ')}`);
  });

  if (examItems.length < 2) {
    console.error('至少需要 2 条记录');
    await browser.close();
    return;
  }

  // 找题数不同的（优先 9 道题）
  const firstCount = parseInt(examItems[0].details.join('').match(/(\d+)\s*道题/)?.[1] || '0', 10);
  let targetIdx = -1;
  for (let i = examItems.length - 1; i >= 0; i--) {
    const m = examItems[i].details.join('').match(/(\d+)\s*道题/);
    const c = m ? parseInt(m[1], 10) : 0;
    if ((c === 9 || c === 3 || c === 5) && c !== firstCount) { targetIdx = i; break; }
  }
  if (targetIdx === -1) {
    for (let i = examItems.length - 1; i >= 0; i--) {
      const m = examItems[i].details.join('').match(/(\d+)\s*道题/);
      const c = m ? parseInt(m[1], 10) : 0;
      if (c !== firstCount && c > 0) { targetIdx = i; break; }
    }
  }

  const target = examItems[targetIdx];
  const targetCount = parseInt(target.details.join('').match(/(\d+)\s*道题/)?.[1] || '0', 10);
  console.log(`\n5. 点击第 ${targetIdx + 1} 条: "${target.name}" (${targetCount} 道题)`);

  const btns = await page.$$('button[title="重新打印"]');
  await btns[targetIdx].click();
  await page.waitForTimeout(3000);

  const preview = await page.evaluate(() => {
    const allText = document.body.innerText;
    const totalMatch = allText.match(/总题数[：:]\s*(\d+)/);
    const qrSvg = document.querySelector('svg');
    return { totalQuestions: totalMatch ? parseInt(totalMatch[1], 10) : null, hasQR: !!qrSvg };
  });

  console.log(`   预览总题数: ${preview.totalQuestions}`);
  console.log(`   有二维码: ${preview.hasQR}`);

  if (preview.totalQuestions === targetCount) {
    console.log(`\n✅ 题数匹配 (${targetCount}) — 修复已上线`);
  } else if (preview.totalQuestions === firstCount) {
    console.log(`\n❌ 显示的是第一条的 ${firstCount} 题，不是目标的 ${targetCount} 题 — 老代码`);
    console.log(`   Cloudflare Pages 还没有部署修复。需要手动触发重新部署。`);
  } else {
    console.log(`\n⚠️  预览 ${preview.totalQuestions} 题 ≠ 目标 ${targetCount} 题`);
  }

  await page.screenshot({ path: 'cf-pages-bug-verification.png' });
  await browser.close();
})();