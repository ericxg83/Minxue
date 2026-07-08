/**
 * 验证"历史组卷选择任意一条打开都是第一条"的 Bug 修复
 *
 * 流程：
 * 1. 打开 App，等待自动选择学生
 * 2. 导航到"组卷记录"页
 * 3. 获取所有试卷条目（名称 + 题数）
 * 4. 选择第一条以外的某条试卷，点击"重打"
 * 5. 验证 PrintPreview 显示的题数与被点击的试卷一致（而非第一条）
 */

const { chromium } = require('playwright');

const APP_URL = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 size
  });
  const page = await context.newPage();

  // Listen for console errors
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  console.log('1. 打开 App...');
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // 等待学生自动加载完成（header 里出现学生姓名）
  console.log('2. 等待学生加载...');
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[class*="flex items-center gap-2"]');
    return btn && btn.textContent.trim().length > 0;
  }, { timeout: 15000 });

  // 获取当前学生姓名
  const studentName = await page.evaluate(() => {
    const btn = document.querySelector('button[class*="flex items-center gap-2"]');
    return btn?.textContent?.trim() || 'unknown';
  });
  console.log(`   当前学生: ${studentName}`);

  // 导航到"组卷记录"（底部导航第三个 tab）
  console.log('3. 导航到组卷记录...');
  const navTabs = await page.$$('nav.fixed.bottom-0 button');
  // Tab 3: 组卷记录
  if (navTabs.length >= 3) {
    await navTabs[2].click();
  } else {
    console.error('找不到底部导航按钮');
    await browser.close();
    return;
  }

  // 等待试卷列表加载
  console.log('4. 等待试卷列表...');
  await page.waitForTimeout(3000);

  // 获取所有试卷条目
  const examItems = await page.evaluate(() => {
    // 找到所有试卷卡片（motion.div with key=exam.id）
    const items = document.querySelectorAll('h3.truncate');
    const result = [];
    items.forEach((h3, i) => {
      const parent = h3.closest('[class*="card"]') || h3.parentElement;
      const pTexts = parent ? Array.from(parent.querySelectorAll('p')).map(p => p.textContent) : [];
      result.push({
        index: i,
        name: h3.textContent?.trim() || '',
        details: pTexts,
      });
    });
    return result;
  });

  console.log(`   共 ${examItems.length} 条试卷记录:`);
  examItems.forEach((item, i) => {
    console.log(`   [${i}] ${item.name} | ${item.details.join(' | ')}`);
  });

  if (examItems.length < 2) {
    console.error('至少需要 2 条试卷记录才能验证修复');
    await browser.close();
    return;
  }

  // 选择题数明显不同的试卷（如 9 道题或 3 道题的，而非第一条 15 道题的）
  // 查找题数 ≠ 第一条试卷题数的条目
  const firstExamDetails = examItems[0].details.join(' ');
  const firstCountMatch = firstExamDetails.match(/(\d+)\s*道题/);
  const firstCount = firstCountMatch ? parseInt(firstCountMatch[1], 10) : 15;

  // 优先找 9 道题的（用户报告的数学-0702）
  let targetIdx = -1;
  let targetCount = null;
  for (let i = examItems.length - 1; i >= 0; i--) {
    const detail = examItems[i].details.join(' ');
    const m = detail.match(/(\d+)\s*道题/);
    const count = m ? parseInt(m[1], 10) : 0;
    if (count === 9) { targetIdx = i; targetCount = count; break; }
  }
  // fallback: 找题数 ≠ 第一条
  if (targetIdx === -1) {
    for (let i = examItems.length - 1; i >= 0; i--) {
      const detail = examItems[i].details.join(' ');
      const m = detail.match(/(\d+)\s*道题/);
      const count = m ? parseInt(m[1], 10) : 0;
      if (count !== firstCount && count > 0) {
        targetIdx = i;
        targetCount = count;
        break;
      }
    }
  }

  if (targetIdx === -1) {
    console.error('所有试卷题数相同，无法验证修复效果');
    await browser.close();
    return;
  }

  const targetExam = examItems[targetIdx];
  const targetDetailText = targetExam.details.join(' ');

  console.log(`\n5. 点击第 ${targetIdx + 1} 条记录: "${targetExam.name}" (共 ${targetCount} 道题)`);

  // 查找对应位置的"重打"按钮
  const allReprintButtons = await page.$$('button[title="重新打印"]');
  if (allReprintButtons.length <= targetIdx) {
    console.error(`找不到第 ${targetIdx + 1} 条试卷的"重打"按钮`);
    await browser.close();
    return;
  }

  // 点击目标的"重打"
  await allReprintButtons[targetIdx].click();
  console.log('   已点击"重打"...');

  // 等待 PrintPreview 出现
  await page.waitForTimeout(2000);

  // 验证预览标题
  const previewInfo = await page.evaluate(() => {
    // 找到 Page Title - "打印预览"
    const header = document.querySelector('h2');
    const headerText = header?.textContent?.trim() || '';

    // 找到试卷标题（通常是 "学生姓名 - 科目-日期"）
    const titleEl = document.querySelector('[class*="font-bold mb-3"]');
    const titleText = titleEl?.textContent?.trim() || '';

    // 找到总题数
    const allText = document.body.innerText;
    const totalMatch = allText.match(/总题数[：:]\s*(\d+)/);
    const totalQuestions = totalMatch ? parseInt(totalMatch[1], 10) : null;

    // 找到 QR code SVG
    const qrSvg = document.querySelector('svg');
    const hasQR = !!qrSvg;

    return { headerText, titleText, totalQuestions, hasQR };
  });

  console.log(`   预览标题: ${previewInfo.headerText}`);
  console.log(`   试卷标题: ${previewInfo.titleText}`);
  console.log(`   总题数: ${previewInfo.totalQuestions}`);
  console.log(`   有二维码: ${previewInfo.hasQR}`);

  // ===== 验证 =====
  let passed = true;
  const failures = [];

  // 验证 1: 总题数应该匹配目标试卷，而非第一条
  if (previewInfo.totalQuestions !== null && targetCount !== null) {
    if (previewInfo.totalQuestions === targetCount) {
      console.log(`\n✅ PASS: 总题数 (${previewInfo.totalQuestions}) 匹配目标试卷 "共 ${targetCount} 道题"`);
    } else {
      passed = false;
      failures.push(`总题数不匹配: 预览=${previewInfo.totalQuestions}, 目标=${targetCount}`);
      console.log(`\n❌ FAIL: 总题数 (${previewInfo.totalQuestions}) 不匹配目标 (${targetCount})`);
    }

    // 额外验证：不是第一条的题数（如果是同一个数则不是bug）
    if (firstCount !== null && firstCount === targetCount && firstCount === previewInfo.totalQuestions) {
      console.log(`   ⚠️ 注意: 第一条和目标条题数相同 (${firstCount})，无法通过题数区分，需检查试卷名称`);
    } else if (firstCount !== null && previewInfo.totalQuestions === firstCount) {
      passed = false;
      failures.push(`展示的是第一条试卷的数据 (${firstCount} 题) 而非目标 (${targetCount} 题)`);
      console.log(`❌ FAIL: 展示的是第一条试卷的题数 (${firstCount})，而非目标的 (${targetCount})`);
    }
  }

  // 验证 2: 标题包含目标试卷名称（非必要但辅助）
  if (previewInfo.titleText && targetExam.name) {
    const targetNamePart = targetExam.name.replace(/^[^-]*-/, '').trim(); // e.g., "数学-0702" → "0702"
    if (previewInfo.titleText.includes(targetNamePart)) {
      console.log(`✅ PASS: 标题包含目标试卷标识 "${targetNamePart}"`);
    } else if (previewInfo.titleText.includes(examItems[0].name.split('-')[1]?.trim() || '')) {
      console.log(`⚠️  标题可能仍指向第一条试卷`);
    } else {
      console.log(`ℹ️  标题: "${previewInfo.titleText}" (无法直接判定)`);
    }
  }

  // 验证 3: 存在二维码
  if (previewInfo.hasQR) {
    console.log(`✅ PASS: 预览页存在二维码`);
  } else {
    passed = false;
    failures.push('预览页缺少二维码');
    console.log(`❌ FAIL: 预览页缺少二维码`);
  }

  // ===== 结果汇总 =====
  console.log(`\n${'='.repeat(50)}`);
  if (passed && failures.length === 0) {
    console.log('✅ 所有验证通过！修复有效。');
  } else {
    console.log(`❌ ${failures.length} 项失败:`);
    failures.forEach(f => console.log(`   - ${f}`));
  }

  // 截图保存
  await page.screenshot({ path: 'reprint-fix-verification.png', fullPage: false });
  console.log('\n截图已保存: reprint-fix-verification.png');

  await browser.close();
  console.log('测试完成。');
})();