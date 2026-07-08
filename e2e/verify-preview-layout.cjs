/**
 * 截图验证：打印预览的手机端 + 桌面端排版
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const vp of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });

    await page.waitForFunction(() => {
      const btn = document.querySelector('button[class*="flex items-center gap-2"]');
      return btn && btn.textContent.trim().length > 0;
    }, { timeout: 15000 });

    // 导航到组卷记录
    const navTabs = await page.$$('nav.fixed.bottom-0 button');
    if (navTabs.length >= 3) await navTabs[2].click();
    await page.waitForTimeout(3000);

    // 点第一个"重打"
    const btns = await page.$$('button[title="重新打印"]');
    if (btns.length === 0) {
      console.log(`[${vp.name}] 无重打按钮，跳过`);
      await context.close();
      continue;
    }
    await btns[0].click();
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const title = document.querySelector('h2')?.textContent || '';
      const examTitle = document.body.innerText.match(/(\S+ - \S+)/)?.[1] || '';
      // 检查选项是否有重复字母 "A. A."
      const doubled = /([A-D])\.\s*\1\./.test(document.body.innerText);
      return { title, examTitle, doubledLetters: doubled };
    });
    console.log(`[${vp.name}] 预览标题:"${info.title}" 试卷:"${info.examTitle}" 选项重复字母:${info.doubledLetters}`);

    await page.screenshot({ path: `preview-${vp.name}.png`, fullPage: false });
    console.log(`[${vp.name}] 截图已保存 preview-${vp.name}.png`);
    await context.close();
  }

  await browser.close();
})();
