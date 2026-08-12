/**
 * capture-real-questions.cjs —— 从【真实业务流程】抓取导致 PDF 公式错位的原始题目数据。
 *
 * 流程（与用户在电脑浏览器复现的完全一致）：
 *   错题本 → 全选 → 生成试卷 → 打印预览 → 下载PDF
 *   （下载同时会触发 exportWrongBookPDF → generateExamPDF）
 *
 * 我们已在真实调用点 wrongBookPdfExporter.js 调用 generateExamPDF() 之前加了纯诊断日志，
 * 并写入 window.__PDF_DIAG_LAST__。本脚本在点击“下载PDF”后读取该变量，落盘到：
 *   e2e/fixtures/real-wrong-pdf-questions.json
 *
 * 运行前提：前后端 dev server 已启动（默认 http://localhost:3000），且当前学生有真实错题。
 * 用法：node e2e/capture-real-questions.cjs
 * 环境变量：APP_URL（默认 http://localhost:3000）、OUT（默认 ../e2e/fixtures/real-wrong-pdf-questions.json）
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const OUT = process.env.OUT || path.join(__dirname, 'fixtures', 'real-wrong-pdf-questions.json');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const diagLines = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[PDF-DIAG]')) diagLines.push(t);
  });

  console.log(`1. 打开 ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 40000 });

  // 等待学生自动加载
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[class*="flex items-center gap-2"]');
    return btn && btn.textContent.trim().length > 0;
  }, { timeout: 20000 });
  const studentName = await page.evaluate(() => {
    const btn = document.querySelector('button[class*="flex items-center gap-2"]');
    return btn?.textContent?.trim() || 'unknown';
  });
  console.log(`   当前学生: ${studentName}`);

  // 2. 进入错题本 tab
  console.log('2. 进入错题本...');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('nav button'));
    const wb = tabs.find((b) => b.textContent.includes('错题本'));
    if (wb) wb.click();
  });
  await sleep(2500);

  // 3. 等待错题列表出现，全选
  console.log('3. 等待错题列表并全选...');
  await page.waitForSelector('text=全选', { timeout: 15000 }).catch(() => console.log('   ⚠️ 未找到“全选”，可能无错题'));
  const selectAllBtn = page.locator('text=全选').first();
  try {
    await selectAllBtn.click({ timeout: 5000 });
    console.log('   已点击全选');
  } catch (e) {
    console.log('   ⚠️ 全选按钮不可点，尝试逐题勾选 checkbox');
    const checks = page.locator('button.flex-shrink-0.mt-0.5');
    const n = await checks.count();
    for (let i = 0; i < n; i++) { try { await checks.nth(i).click(); } catch (e) {} }
    console.log(`   已勾选 ${n} 个 checkbox`);
  }
  await sleep(800);

  // 读取已选数量
  const selectedCount = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'));
    const idx = spans.findIndex((s) => s.textContent === '已选');
    if (idx >= 0 && spans[idx + 1]) return parseInt(spans[idx + 1].textContent, 10) || 0;
    return 0;
  });
  console.log(`   已选题数 = ${selectedCount}`);
  if (selectedCount === 0) {
    console.error('❌ 错题本中没有可选题，无法复现真实流程。请确认当前学生存在错题，或改用“组卷历史→重新打印”并调整脚本。');
    await browser.close();
    process.exit(1);
  }

  // 4. 点击“生成试卷”
  console.log('4. 点击生成试卷...');
  await page.locator('text=生成试卷').first().click({ timeout: 5000 });
  await sleep(2500);

  // 等待打印预览
  const hasPreview = await page.evaluate(() => !!Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.includes('打印预览')));
  if (!hasPreview) console.warn('   ⚠️ 未检测到“打印预览”页头，继续尝试点击下载PDF');
  console.log(`   打印预览: ${hasPreview}`);

  // 5. 点击下载PDF（真实生成）
  console.log('5. 点击下载PDF（触发真实 exportWrongBookPDF → generateExamPDF）...');
  const dl = page.locator('text=下载PDF').first();
  try {
    // 用 click 触发生成（不等待下载事件，避免 saveAs 依赖）
    await dl.click({ timeout: 5000 });
  } catch (e) {
    console.warn('   下载PDF 按钮未找到/不可点, e=', e.message);
  }
  // 等待生成（含 getQuestionsByIds 拉全数据 + 生成 PDF）
  await sleep(6000);

  // 6. 读取诊断数据
  console.log('6. 读取 window.__PDF_DIAG_LAST__ ...');
  let payload = await page.evaluate(() => window.__PDF_DIAG_LAST__ || null);
  if (!payload) {
    console.log('   ⚠️ window.__PDF_DIAG_LAST__ 为空，回退解析 Console 中的 [PDF-DIAG] JSON...');
    const jsonLine = diagLines.find((l) => l.startsWith('[PDF-DIAG] JSON:'));
    if (jsonLine) {
      const raw = jsonLine.replace('[PDF-DIAG] JSON:', '');
      try { payload = JSON.parse(raw); } catch (e) { console.error('   解析 Console JSON 失败:', e.message); }
    }
  }

  if (!payload || !payload.questions || payload.questions.length === 0) {
    console.error('❌ 未捕获到题目数据。请确认：1) src 已修改且 dev server 热更新；2) 真实导入路径走到了 exportWrongBookPDF。');
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(`✅ 已保存 ${payload.questions.length} 道题到 ${OUT}`);
  }

  // 顺带输出每题 renderContent 摘要，便于快速查看
  if (payload && payload.questions) {
    payload.questions.forEach((q, i) => {
      console.log(`\n[#${i + 1}] id=${q.id} type=${q.question_type}`);
      console.log(`    content input : ${JSON.stringify(q.content.input)}`);
      console.log(`    content output: ${q.content.renderContent_output}`);
      (q.options || []).forEach((o, j) => {
        console.log(`    opt[${j}] input=${JSON.stringify(o.input)} output=${o.renderContent_output}`);
      });
      if (q.answer && q.answer.input) console.log(`    answer: ${JSON.stringify(q.answer.input)} -> ${q.answer.renderContent_output}`);
    });
  }

  console.log('\n完成。下一步可做 A/B：');
  console.log('  A) 真实业务流程调用 generateExamPDF()');
  console.log('  B) 直接读取 e2e/fixtures/real-wrong-pdf-questions.json，调用同一个 generateExamPDF()');
  console.log('  比较 renderContent 输入/输出、iframe HTML、KaTeX HTML、CSS、html2canvas 参数、最终 canvas / PDF。');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
