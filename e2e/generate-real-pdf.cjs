/**
 * 生成真实 PDF 并保存，供人工核对排版
 */
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });

  await page.waitForFunction(() => {
    const btn = document.querySelector('button[class*="flex items-center gap-2"]');
    return btn && btn.textContent.trim().length > 0;
  }, { timeout: 15000 });

  const navTabs = await page.$$('nav.fixed.bottom-0 button');
  if (navTabs.length >= 3) await navTabs[2].click();
  await page.waitForTimeout(3000);

  const btns = await page.$$('button[title="重新打印"]');
  await btns[0].click();
  await page.waitForTimeout(3000);

  // 点击"下载PDF"
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  const pdfBtn = await page.$('text=下载PDF');
  await pdfBtn.click();
  const download = await downloadPromise;
  const savePath = 'D:\\Minxue_App_V3\\preview-output.pdf';
  await download.saveAs(savePath);
  console.log('PDF 已保存:', savePath);
  const stats = fs.statSync(savePath);
  console.log('PDF 大小:', Math.round(stats.size / 1024), 'KB');

  await browser.close();
})();
