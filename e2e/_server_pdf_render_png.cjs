/**
 * _server_pdf_render_png.cjs — 用 Playwright 把 PDF 嵌入 HTML 后截图
 */
const { chromium } = require('d:/Minxue_App_V3/server/node_modules/playwright')
const path = require('path')
const fs = require('fs')

const PDF_PATH = path.join(__dirname, '_server_pdf_out', 'wrongbook-server.pdf')
const OUT_DIR = path.join(__dirname, '_server_pdf_out')
fs.mkdirSync(OUT_DIR, { recursive: true })

;(async () => {
  const pdfData = fs.readFileSync(PDF_PATH)
  const dataUrl = `data:application/pdf;base64,${pdfData.toString('base64')}`

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })

    for (let i = 1; i <= 6; i++) {
      // HTML 嵌入 PDF.js viewer（CDN 加载），指定页码
      const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<script src="https://mozilla.github.io/pdf.js/build/pdf.mjs" type="module"></script>
<style>body{margin:0;padding:0;background:#888}canvas{display:block;margin:10px auto;box-shadow:0 2px 8px #000}</style>
</head><body>
<canvas id="cv"></canvas>
<script type="module">
import * as pdfjsLib from "https://mozilla.github.io/pdf.js/build/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://mozilla.github.io/pdf.js/build/pdf.worker.mjs";
const dataUrl = "${dataUrl}";
const data = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
const doc = await pdfjsLib.getDocument({ data }).promise;
const p = await doc.getPage(${i});
const vp = p.getViewport({ scale: 1.5 });
const cv = document.getElementById('cv');
cv.width = vp.width; cv.height = vp.height;
await p.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
window.__pdfReady = true;
</script>
</body></html>`
      await page.setContent(html, { waitUntil: 'load' })
      // 等 PDF 渲染
      try {
        await page.waitForFunction(() => window.__pdfReady === true, { timeout: 30000 })
      } catch (e) {
        console.warn(`[render] page ${i} render timeout: ${e.message}`)
      }
      await page.waitForTimeout(500)
      const out = path.join(OUT_DIR, `pdf-page${i}.png`)
      await page.screenshot({ path: out, fullPage: true })
      const sz = fs.statSync(out).size
      console.log(`[render] page ${i} -> ${out} (${(sz / 1024).toFixed(1)}KB)`)
    }
  } finally {
    await browser.close()
  }
})().catch((err) => {
  console.error('[render] 失败:', err.message)
  process.exit(1)
})
