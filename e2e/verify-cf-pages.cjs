/**
 * 对线上 Cloudflare Pages 验证组卷选择 bug 修复 + 标题显示修复
 */
const { chromium } = require('playwright');
const dayjs = require('dayjs');
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

  // 找题数不同的（优先 9 道题）；如题数全部相同则选最后一条
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
  // 若所有题数相同，选最后一条（非第一条即可验证标题）
  if (targetIdx === -1) {
    targetIdx = examItems.length - 1;
    console.log(`   所有试卷题数相同(${firstCount})，选择最后一条验证标题显示`);
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
    // 找到试卷标题
    const titleEl = document.querySelector('[class*="font-bold mb-3"]');
    const titleText = titleEl?.textContent?.trim() || '';
    return {
      totalQuestions: totalMatch ? parseInt(totalMatch[1], 10) : null,
      hasQR: !!qrSvg,
      titleText,
    };
  });

  console.log(`   预览总题数: ${preview.totalQuestions}`);
  console.log(`   试卷标题: ${preview.titleText}`);
  console.log(`   有二维码: ${preview.hasQR}`);

  let passed = true;

  // 验证题数匹配（仅当题数不同时有意义）
  if (targetCount !== firstCount) {
    if (preview.totalQuestions === targetCount) {
      console.log(`\n✅ 题数匹配 (${targetCount}) — 修复已上线`);
    } else if (preview.totalQuestions === firstCount) {
      console.log(`\n❌ 显示的是第一条的 ${firstCount} 题，不是目标的 ${targetCount} 题`);
      passed = false;
    } else {
      console.log(`\n⚠️  预览 ${preview.totalQuestions} 题 ≠ 目标 ${targetCount} 题`);
      passed = false;
    }
  } else {
    console.log(`\nℹ️  题数相同 (${firstCount})，无法通过题数验证 — 标题验证为主`);
  }

  // 验证标题显示原始试卷名
  const todayStr = dayjs().format('MMDD');
  if (preview.titleText && target.name) {
    if (preview.titleText.includes(target.name.trim())) {
      console.log(`✅ 标题显示原始试卷名 "${target.name}"`);
    } else if (preview.titleText.includes(todayStr)) {
      console.log(`❌ 标题仍显示当天日期 "${todayStr}"，应为 "${target.name}"`);
      passed = false;
    } else {
      console.log(`ℹ️  标题: "${preview.titleText}"`);
    }
  }

  console.log(`\n${passed ? '✅ 全部验证通过' : '❌ 有验证失败'}`);

  await page.screenshot({ path: 'cf-pages-verification.png' });
  await browser.close();
})();