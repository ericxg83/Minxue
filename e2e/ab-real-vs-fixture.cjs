/**
 * ab-real-vs-fixture.cjs —— A/B 诊断运行器。
 *
 * A（真实业务流程）与 B（直接读 JSON fixture）都调用同一个 generateExamPDF()。
 * 这里先跑 B：用 e2e/fixtures/real-wrong-pdf-questions.json 里的真实题目数据，
 * 通过真实 generateExamPDF() 生成 PDF，并在其相同内部管线（buildExamHTML →
 * renderMathInContainer → KaTeX → iframe）抓取：
 *   - renderContent() 输入/输出
 *   - 进入 KaTeX 前的 iframe HTML（buildExamHTML 输出）
 *   - KaTeX 渲染后 iframe 的 HTML
 *   - 每个数学元素的 KaTeX 结构（分数 .frac-line / 根号 .sqrt）及几何尺寸（判读错位）
 *   - html2canvas 参数（来自 pdfGenerator 内部，硬编码）
 *   - 最终 PDF（保存为文件，供人工与 A 的真实 PDF 对比）
 *
 * 前置：已启动 vite dev server（http://localhost:3000）。
 * 用法：node e2e/ab-real-vs-fixture.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FIXTURE = path.join(__dirname, 'fixtures', 'real-wrong-pdf-questions.json');
const OUT_DIR = path.join(__dirname, '_ab_out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
if (!fixture || !Array.isArray(fixture.questions) || fixture.questions.length === 0) {
  console.error('fixture 无题目数据');
  process.exit(1);
}
const questions = fixture.questions;
console.log(`fixture: ${fixture.examName} | ${fixture.studentName || ''} | ${questions.length}题`);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log(`打开 ${APP_URL} ...`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async (questionsPassed) => {
    const { buildExamHTML, renderMathInContainer, preloadKatexFonts, generateExamPDF } = await import('/src/utils/pdfGenerator.js');
    const { renderContent } = await import('/src/utils/mathText.js');

    const title = 'A/B-真实数据回放';
    const studentName = '蔡怡希';
    const showAnswers = false;
    const qrContent = null;

    // --- B: renderContent 输入/输出 ---
    const rc = questionsPassed.map((q, i) => ({
      i: i + 1,
      id: q.id,
      question_type: q.question_type,
      subject: q.subject,
      content_in: q.content ?? '',
      content_out: renderContent(q.content),
      options: (Array.isArray(q.options) ? q.options : []).map(o => renderContent(o)),
      answer_in: q.answer ?? '',
      answer_out: renderContent(q.answer),
    }));

    // --- B: 进入 KaTeX 前的 iframe HTML ---
    const preKatexHTML = buildExamHTML({ title, studentName, questions: questionsPassed, showAnswers });

    // --- B: 用与 generateExamPDF 相同的方式拉起 iframe + KaTeX，抓取渲染后 HTML 与几何 ---
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
    iframeDoc.write(buildExamHTML({ title, studentName, questions: questionsPassed, showAnswers }));
    iframeDoc.close();
    if (iframeDoc.readyState === 'loading') await new Promise(r => iframeDoc.addEventListener('DOMContentLoaded', r, { once: true }));
    renderMathInContainer(iframeDoc);
    await preloadKatexFonts(iframeDoc);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const h = Math.max(iframeDoc.body.scrollHeight, iframeDoc.documentElement.scrollHeight);
    iframe.style.height = (h + 16) + 'px';
    void iframeDoc.querySelector('.page')?.offsetWidth;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const katexBodyHTML = iframeDoc.body.innerHTML;

    const rectOf = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const measure = [];
    const qs = Array.from(iframeDoc.querySelectorAll('.question'));
    qs.forEach((qq, qi) => {
      const qtext = qq.querySelector('.q-text');
      const qtextRect = qtext ? rectOf(qtext) : null;
      const katexEls = qq.querySelectorAll('.q-text .katex');
      katexEls.forEach((k, ki) => {
        const cs = iwin.getComputedStyle(k);
        const fracLine = k.querySelector('.frac-line');
        const sqrtSign = k.querySelector('.sqrt-sign');
        const sqrtRoot = k.querySelector('.sqrt');
        measure.push({
          qi, ki,
          hasFracLine: !!fracLine,
          fracRect: fracLine ? rectOf(fracLine) : null,
          hasSqrtSign: !!sqrtSign,
          sqrtRect: sqrtSign ? rectOf(sqrtSign) : null,
          sqrtRootRect: sqrtRoot ? rectOf(sqrtRoot) : null,
          katexRect: rectOf(k),
          qtextRect,
          lineHeight: cs.lineHeight,
          verticalAlign: cs.verticalAlign,
          fontSize: cs.fontSize,
          html: k.outerHTML.slice(0, 1200),
        });
      });
    });

    document.body.removeChild(holder);

    // --- B: 调用真实 generateExamPDF，得到最终 PDF ---
    let pdf = null, pdfSize = 0;
    try {
      const out = await generateExamPDF({ title, studentName, questions: questionsPassed, filename: 'ab-b', showAnswers, qrContent });
      if (out && out.pdfBlob) {
        const b = new Uint8Array(await out.pdfBlob.arrayBuffer());
        pdf = Array.from(b); pdfSize = b.length;
      }
    } catch (e) {
      measure.push({ err: 'generateExamPDF: ' + String(e) });
    }

    const html2canvasParams = { scale: 2, useCORS: true, backgroundColor: '#ffffff', width: 794, window: 'iframe.contentWindow', onclone: 'preloadKatexFonts(cloneDoc)' };

    return { rc, preKatexHTML, katexBodyHTML, measure, html2canvasParams, pdf, pdfSize };
  }, questions);

  // 保存产物
  fs.writeFileSync(path.join(OUT_DIR, 'rc.json'), JSON.stringify(result.rc, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'pre-katex.html'), result.preKatexHTML);
  fs.writeFileSync(path.join(OUT_DIR, 'katex-body.html'), result.katexBodyHTML);
  fs.writeFileSync(path.join(OUT_DIR, 'measures.json'), JSON.stringify(result.measure, null, 2), 'utf-8');
  if (result.pdf) {
    fs.writeFileSync(path.join(OUT_DIR, 'ab-b.pdf'), Buffer.from(result.pdf));
    console.log('✅ PDF 已保存:', path.join(OUT_DIR, 'ab-b.pdf'), result.pdfSize, 'bytes');
  } else {
    console.warn('⚠️ PDF 生成失败/为空');
  }

  // renderContent 输入/输出对照
  console.log('\n========== B: renderContent 输入 -> 输出（真实题目数据） ==========');
  result.rc.forEach((r) => {
    console.log(`[#${r.i}] ${String(r.id).slice(0,8)} type=${r.question_type}`);
    console.log(`    in : ${JSON.stringify(r.content_in)}`);
    console.log(`    out: ${r.content_out}`);
    if (r.options && r.options.length) console.log(`    opt: ${r.options.map(x=>x).join('  |  ')}`);
    if (r.answer_in) console.log(`    ans: ${JSON.stringify(r.answer_in)} -> ${r.answer_out}`);
  });

  // 几何测量摘要
  console.log('\n========== B: KaTeX 几何测量（分数/根号结构） ==========');
  let fracCount = 0, sqrtCount = 0;
  result.measure.forEach((m) => { if (m.hasFracLine) fracCount++; if (m.hasSqrtSign) sqrtCount++; });
  console.log(`共测量 ${result.measure.length} 个 katex 元素：含 .frac-line ${fracCount} 个，含 .sqrt-sign ${sqrtCount} 个`);
  result.measure.slice(0, 60).forEach((m) => {
    const qtextTop = m.qtextRect ? m.qtextRect.top : 0;
    const kShift = m.katexRect ? (m.katexRect.top - qtextTop).toFixed(1) : '?';
    console.log(`[q${m.qi}.k${m.ki}] frac=${m.hasFracLine ? 'Y' : 'n'} sqrt=${m.hasSqrtSign ? 'Y' : 'n'} kShift=${kShift} fracW=${m.fracRect ? m.fracRect.width.toFixed(0) : '-'} sqrtW=${m.sqrtRect ? m.sqrtRect.width.toFixed(0) : '-'}`);
  });

  console.log('\nhtml2canvas 参数:', JSON.stringify(result.html2canvasParams));
  console.log('\n产物目录:', OUT_DIR);
  console.log('\n下一步：将本 PDF 与 A(真实业务流程)的 PDF 对比，判定 A/B 是否都错。');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });