/**
 * run-a-real.cjs —— A 路径：用真实 20 道错题数据，走 exportWrongBookPDF 真实入口。
 *
 * 与 ab-real-vs-fixture.cjs（B 路径：直接 import generateExamPDF）的区别：
 *   A 走 wrongBookPdfExporter.exportWrongBookPDF，它会先调 getQuestionsByIds 拉全数据、
 *   抓取 captureBeforeGenerateExamPDF 诊断、再调 generateExamPDF。
 *   B 跳过这些 wrapper，直接调 generateExamPDF。
 *
 * 目标：验证 A/B 是否都错，根因在生成器还是 wrapper 之前的某个 transform。
 *
 * 用法：先起 vite dev server。node e2e/run-a-real.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FIXTURE = path.join(__dirname, 'fixtures', 'real-wrong-pdf-questions.json');
const OUT_DIR = path.join(__dirname, '_ab_out');
fs.mkdirSync(OUT_DIR, { recursive: true });

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
const questions = fixture.questions.map((q) => ({
  id: q.id,
  question_type: q.question_type,
  content: q.content,
  options: q.options,
  answer: q.answer,
  subject: q.subject,
  difficulty: q.difficulty,
  question_number: q.question_number,
}));
console.log(`fixture: ${fixture.examName} | ${fixture.studentName} | ${questions.length}题`);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log(`打开 ${APP_URL} ...`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 40000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async (qsPassed) => {
    const { exportWrongBookPDF } = await import('/src/utils/wrongBookPdfExporter.js');

    const title = 'A/B-真实数据回放';
    const studentName = '蔡怡希';
    const showAnswers = false;
    const qrContent = null;

    let pdf = null, pdfSize = 0, err = null;
    try {
      const out = await exportWrongBookPDF({
        studentId: 'e60bb513-ec67-4a01-9942-14b65a5ec69f',
        studentName,
        questions: qsPassed,
        title,
        filename: 'ab-a',
        showAnswers,
        qrContent,
      });
      if (out && out.pdfBlob) {
        const b = new Uint8Array(await out.pdfBlob.arrayBuffer());
        pdf = Array.from(b); pdfSize = b.length;
      } else {
        err = 'exportWrongBookPDF 返回 null';
      }
    } catch (e) { err = String(e); }

    return { pdf, pdfSize, err };
  }, questions);

  if (result.pdf) {
    fs.writeFileSync(path.join(OUT_DIR, 'ab-a.pdf'), Buffer.from(result.pdf));
    console.log('✅ A PDF 已保存:', path.join(OUT_DIR, 'ab-a.pdf'), result.pdfSize, 'bytes');
  } else {
    console.warn('⚠️ A PDF 生成失败:', result.err);
  }

  // 对比 A/B PDF 字节大小与 SHA
  const abPath = path.join(OUT_DIR, 'ab-b.pdf');
  if (fs.existsSync(abPath)) {
    const aBuf = Buffer.from(result.pdf || []);
    const bBuf = fs.readFileSync(abPath);
    console.log('\n========== A vs B PDF 对比 ==========');
    console.log('A size:', aBuf.length, 'bytes');
    console.log('B size:', bBuf.length, 'bytes');
    const crypto = require('crypto');
    console.log('A sha256:', crypto.createHash('sha256').update(aBuf).digest('hex').slice(0, 16));
    console.log('B sha256:', crypto.createHash('sha256').update(bBuf).digest('hex').slice(0, 16));
    if (aBuf.length === bBuf.length) console.log('→ 字节数完全相同，可能是同一份 PDF（一致）');
    else console.log('→ 字节数不同，A 路径有 transform');
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
