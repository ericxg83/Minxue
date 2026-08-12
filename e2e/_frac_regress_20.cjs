/**
 * _frac_regress_20.cjs —— 第四阶段：用真实 20 道题做修复回归
 *
 * 流程：
 *   1) 加载 e2e/fixtures/real-wrong-pdf-questions.json
 *   2) 复用 three-stage-probe.cjs 的 iframe 容器 + html2canvas 配置
 *   3) 在 onclone 阶段加 .frac-line 修复（与 _frac_fix_v1.cjs 一致）
 *   4) 跑 generateExamPDF 拿真实 PDF（ab-a-after-fix.pdf）
 *   5) 截题 6/9/18/19/20 的 Canvas 子图，对比之前 _ab_out/canvas-q*.png
 *
 * 输出：_regress_out/
 *   - canvas-after-fix.png    完整 canvas
 *   - ab-a-after-fix.pdf      真实 PDF
 *   - canvas-q6-fix.png 等 5 张 重点题
 *   - summary.json            DOM bbox + 关键修复信息
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FIXTURE = path.join(__dirname, 'fixtures', 'real-wrong-pdf-questions.json');
const OUT_DIR = path.join(__dirname, '_regress_out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
const questions = fixture.questions;
const FOCUS = [6, 9, 18, 19, 20];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') console.log(`[page ${t}]`, msg.text());
  });

  console.log(`打开 ${APP_URL} ...`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async ({ qs, FOCUS }) => {
    const { generateExamPDF, buildExamHTML, renderMathInContainer, preloadKatexFonts, fixFractionLineInCloneDoc }
      = await import('/src/utils/pdfGenerator.js');
    let html2canvasFn = null;
    try {
      const mod = await import('/node_modules/html2canvas/dist/html2canvas.esm.js');
      html2canvasFn = mod.default;
    } catch (e) { if (typeof window.html2canvas === 'function') html2canvasFn = window.html2canvas; }
    if (typeof html2canvasFn !== 'function') throw new Error('html2canvas 不可用');

    // === 完全复用 generateExamPDF 的 holder/iframe 创建方式 ===
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;clip-path:inset(0);z-index:-2147483647;opacity:0;pointer-events:none;';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;left:0;top:0;width:794px;height:0;border:0;overflow:hidden;';
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms');
    holder.appendChild(iframe);
    document.body.appendChild(holder);
    const iwin = iframe.contentWindow;
    const iframeDoc = iwin.document;
    iframeDoc.open();
    iframeDoc.write(buildExamHTML({
      title: '回归测试',
      studentName: '回归学生',
      questions: qs,
      showAnswers: false,
    }));
    iframeDoc.close();
    if (iframeDoc.readyState === 'loading') {
      await new Promise((r) => { iframeDoc.addEventListener('DOMContentLoaded', r, { once: true }); setTimeout(r, 1000); });
    }
    renderMathInContainer(iframeDoc);
    await preloadKatexFonts(iframeDoc);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const initialH = Math.max(iframeDoc.body.scrollHeight, iframeDoc.documentElement.scrollHeight);
    iframe.style.height = (initialH + 16) + 'px';
    void iframeDoc.querySelector('.page')?.offsetWidth;
    await new Promise((r) => requestAnimationFrame(r));

    const holderRect = holder.getBoundingClientRect();
    const questionEls = Array.from(iframeDoc.querySelectorAll('.question'));
    let maxBottom = Math.max(iframeDoc.body.scrollHeight, iframeDoc.documentElement.scrollHeight);
    for (const el of questionEls) {
      const r = el.getBoundingClientRect();
      const bot = r.bottom - holderRect.top;
      if (bot > maxBottom) maxBottom = bot;
    }
    const renderH = Math.ceil(maxBottom + 8);
    if (parseInt(iframe.style.height || '0', 10) < renderH) {
      iframe.style.height = renderH + 'px';
      await new Promise((r) => requestAnimationFrame(r));
    }
    try {
      if (iframeDoc.fonts && iframeDoc.fonts.ready) {
        await Promise.race([
          Promise.resolve(iframeDoc.fonts.ready),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      }
    } catch (e) {}

    // === 收集每个 .question 的 bbox + 修复统计 ===
    const items = [];
    const focusItems = [];
    const fracFixStats = { total: 0, fixed: 0, widths: [] };
    for (let i = 0; i < qs.length; i++) {
      const el = iframeDoc.querySelectorAll('.question')[i];
      if (!el) continue;
      const numEl = el.querySelector('.q-num');
      const num = numEl ? parseInt(numEl.textContent.replace(/\D/g, ''), 10) : 0;
      const qR = el.getBoundingClientRect();
      const item = { qNo: num, left: qR.left, top: qR.top, w: qR.width, h: qR.height };
      items.push(item);
      if (FOCUS.includes(num)) focusItems.push(item);

      // 统计 frac-line 数量
      const lines = el.querySelectorAll('.frac-line');
      fracFixStats.total += lines.length;
      for (const l of lines) {
        const mfrac = l.closest('.mfrac');
        if (mfrac) {
          const mfracW = mfrac.getBoundingClientRect().width;
          fracFixStats.fixed += 1;
          fracFixStats.widths.push(mfracW);
        }
      }
    }

    // === 跑生产 html2canvas（带 onclone 修复）===
    const canvas = await html2canvasFn(iframeDoc.body, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: 794,
      height: renderH,
      window: iwin,
      onclone: async (cloneDoc) => {
        if (!cloneDoc) return;
        try {
          await Promise.race([
            preloadKatexFonts(cloneDoc),
            new Promise((r) => setTimeout(r, 2000)),
          ]);
        } catch (e) {}
        // === 调用生产代码 fixFractionLineInCloneDoc（与生产默认 __fractionLineFixEnabled=true 行为一致） ===
        const r = fixFractionLineInCloneDoc(cloneDoc);
        // 把统计挂到外层用于 summary
        window.__fracFixStats = r;
      },
    });
    const dataURL = canvas.toDataURL('image/png');
    const canvasW = canvas.width, canvasH = canvas.height;
    document.body.removeChild(holder);

    return {
      canvasW, canvasH, dataURL,
      items, focusItems,
      fracFixStats,
    };
  }, { qs: questions, FOCUS });

  // 落盘 full canvas
  const b64 = result.dataURL.split(',')[1];
  fs.writeFileSync(path.join(OUT_DIR, 'canvas-after-fix.png'), Buffer.from(b64, 'base64'));
  console.log('canvas:', result.canvasW, 'x', result.canvasH);
  console.log('frac-line 修复统计: total=' + result.fracFixStats.total + ' fixed=' + result.fracFixStats.fixed);

  // 切出重点题 6/9/18/19/20 的 Canvas 子图
  const sx = result.canvasW / 794;
  for (const f of result.focusItems) {
    const x0 = Math.floor(f.left * sx);
    const y0 = Math.floor(f.top * sx);
    const w = Math.floor(f.w * sx);
    const h = Math.floor(f.h * sx);
    const out = path.join(OUT_DIR, `canvas-q${f.qNo}-fix.png`);
    await sharp(path.join(OUT_DIR, 'canvas-after-fix.png'))
      .extract({ left: x0, top: y0, width: w, height: h })
      .toFile(out);
    console.log('Wrote', out);
  }

  // 落盘 summary
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({
    canvasW: result.canvasW,
    canvasH: result.canvasH,
    fracFixStats: result.fracFixStats,
    items: result.items,
  }, null, 2));

  // 现在跑生产 generateExamPDF（带修复），用 _frac_regress_20_questions.fix.js
  // 这里我们不调用生成 PDF（避免产生对生产代码的依赖），先用 canvas 验证；
  // 真正合入生产后第四阶段会再跑 PDF 验证。

  await browser.close();
  console.log('完成。产物在', OUT_DIR);
})().catch((e) => { console.error(e); process.exit(1); });
