/**
 * run-c-probe.cjs —— 探针 C：精确测量 .katex 根 span bbox vs 内部 .mord.sqrt 实际渲染 bbox
 *                  验证"KaTeX 根号对勾越出 .katex 根 span 范围"是否真的是 html2canvas 截取失败的根因
 * 流程：在浏览器内加载真实 20 道错题，运行 generateExamPDF 中同样的 buildExamHTML/renderMathInContainer，
 *       对每个 .katex 测 (root bbox, inner vlist bbox, svg bbox, svgTop 越界量) 四组。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FIXTURE = path.join(__dirname, 'fixtures', 'real-wrong-pdf-questions.json');
const OUT_DIR = path.join(__dirname, '_ab_out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
const questions = fixture.questions;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async (qs) => {
    const { buildExamHTML, renderMathInContainer, preloadKatexFonts } = await import('/src/utils/pdfGenerator.js');
    const title = 'C 探针';
    const studentName = '蔡怡希';

    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;clip-path:inset(0);z-index:-2147483647;opacity:0;pointer-events:none;';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:absolute;left:0;top:0;width:794px;height:0;border:0;overflow:hidden;';
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    holder.appendChild(iframe);
    document.body.appendChild(holder);
    const iwin = iframe.contentWindow;
    const idoc = iwin.document;
    idoc.open();
    idoc.write(buildExamHTML({ title, studentName, questions: qs, showAnswers: false }));
    idoc.close();
    if (idoc.readyState === 'loading') await new Promise(r => idoc.addEventListener('DOMContentLoaded', r, { once: true }));
    renderMathInContainer(idoc);
    await preloadKatexFonts(idoc);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const h = Math.max(idoc.body.scrollHeight, idoc.documentElement.scrollHeight);
    iframe.style.height = (h + 16) + 'px';
    void idoc.querySelector('.page')?.offsetWidth;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };

    const records = [];
    const qEls = Array.from(idoc.querySelectorAll('.question'));
    qEls.forEach((qEl, qi) => {
      const qtext = qEl.querySelector('.q-text');
      const qtextRect = qtext ? rectOf(qtext) : null;
      const katexes = qEl.querySelectorAll('.q-text .katex');
      katexes.forEach((k, ki) => {
        const rootRect = rectOf(k);
        const html = k.querySelector('.katex-html');
        const htmlRect = html ? rectOf(html) : null;
        const base = k.querySelector('.katex-html .base');
        const baseRect = base ? rectOf(base) : null;
        const vlists = Array.from(k.querySelectorAll('.vlist'));
        const vlistInfo = vlists.map((v) => {
          const r = rectOf(v);
          return { top: r.top, bottom: r.bottom, left: r.left, height: r.height };
        });
        const svgs = Array.from(k.querySelectorAll('svg'));
        const svgInfo = svgs.map((s) => {
          const r = rectOf(s);
          return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
        });
        const mords = Array.from(k.querySelectorAll('.mord'));
        const sqrtMord = mords.find((m) => m.classList.contains('sqrt'));
        const sqrtRect = sqrtMord ? rectOf(sqrtMord) : null;
        const overflowTop = vlists.length ? (Math.min(...vlists.map((v) => rectOf(v).top)) - rootRect.top) : 0;
        const overflowBottom = vlists.length ? (rootRect.bottom - Math.max(...vlists.map((v) => rectOf(v).bottom))) : 0;
        records.push({
          qi, ki, qtextRect, rootRect, htmlRect, baseRect, vlistInfo, svgInfo,
          sqrtRect, overflowTop, overflowBottom, hasSvg: svgs.length > 0,
        });
      });
    });

    document.body.removeChild(holder);
    return records;
  }, questions);

  // 落盘 + 摘要
  fs.writeFileSync(path.join(OUT_DIR, 'c-probe.json'), JSON.stringify(result, null, 2));
  const overflows = result.filter((r) => Math.abs(r.overflowTop) > 0.5 || Math.abs(r.overflowBottom) > 0.5);
  console.log(`测 ${result.length} 个 katex，overflowTop/Bottom > 0.5px 的: ${overflows.length}`);
  result.slice(0, 50).forEach((r) => {
    const overflowTxt = (r.overflowTop < -0.5 ? `↑${r.overflowTop.toFixed(1)}越上` : '') + (r.overflowBottom < -0.5 ? ` ↓${r.overflowBottom.toFixed(1)}越下` : '') || '无越界';
    const svgTxt = r.svgInfo.length ? `svg×${r.svgInfo.length} top${r.svgInfo[0].top.toFixed(1)} h${r.svgInfo[0].height.toFixed(0)}` : 'no-svg';
    console.log(`q${r.qi}.k${r.ki}  katex=${r.rootRect.width.toFixed(0)}×${r.rootRect.height.toFixed(0)}  vlist×${r.vlistInfo.length}  ${overflowTxt}  ${svgTxt}`);
  });
  console.log('\n异常样本:');
  overflows.slice(0, 8).forEach((r) => {
    console.log(`q${r.qi}.k${r.ki}: katex top=${r.rootRect.top.toFixed(1)} bot=${r.rootRect.bottom.toFixed(1)} h=${r.rootRect.height.toFixed(1)}`);
    r.vlistInfo.forEach((v, i) => console.log(`   vlist[${i}] top=${v.top.toFixed(1)} bot=${v.bottom.toFixed(1)} h=${v.height.toFixed(1)}`));
    r.svgInfo.forEach((s, i) => console.log(`   svg[${i}] top=${s.top.toFixed(1)} h=${s.height.toFixed(1)}`));
  });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
