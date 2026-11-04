/**
 * 试卷题库「讲解版」回归锁（2026-11-01）
 *
 * 对应负责人拍板（2026-11-01）：横版 4:3、一小问一页、页脚小字答案、重排文字为主+原题图开关。
 *
 * ── 锁的红线 ──
 *  ① **一小问一页是唯一拆页粒度**（负责人 2026-11-01 否掉了「导出时切换」：『不要都做，
 *     你还要导出时切换很麻烦。默认就是一小问一页！』）—— 每个篮子项（小问行）恰好一页，
 *     不得再引入粒度切换开关；
 *  ② 必须保留**原卷题号**（同讲义口径）—— 讲的是「第 19 题(2)」，不得重编号；
 *  ③ 页面必须是**横版 4:3**（280×210mm）—— PDF 页面尺寸 = iPad 笔记本页面尺寸，
 *     导出必须显式把尺寸传给后端（默认 A4 是错的）；
 *  ④ 打印版式保持纯净：灰底 / 纸张阴影 / 交互按钮不得进 lecturePdf（归预览舞台）；
 *  ⑤ 选项/答案必须行内渲染（renderContentInline），不得用 renderContent。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  buildLectureBody,
  buildLectureCSS,
  LECTURE_PAGE_MM,
  LECTURE_PAGE_PX,
} from '../src/utils/lecturePdf.js'
import { createBasketItem } from '../src/utils/paperBasket.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')
const stripComments = (s) => String(s)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const q = (over = {}) => ({
  id: over.id || 'id-' + Math.random().toString(36).slice(2, 8),
  resource_id: 'res-1',
  resource_name: '2026 黄浦一模',
  question_no: 19,
  sub_no: '',
  question_type: 'answer',
  content: '求该函数图象的对称轴',
  parent_stem: null,
  options: [],
  answer: null,
  answer_source: null,
  analysis: null,
  image_url: null,
  ...over,
})

const count = (hay, needle) => hay.split(needle).length - 1

// ─────────────────────────────────────────────────────────────
// ① 一小问一页（唯一模式）
// ─────────────────────────────────────────────────────────────

test('★ 每个篮子项（小问行）恰好一页：一小问一页是唯一模式，不得出现粒度切换', () => {
  const items = [
    createBasketItem(q({ id: 'a', question_no: 19, sub_no: '1', parent_stem: '公共题干' })),
    createBasketItem(q({ id: 'b', question_no: 19, sub_no: '2', parent_stem: '公共题干' })),
    createBasketItem(q({ id: 'c', question_no: 20 })),
    createBasketItem(q({ id: 'd', question_no: 21, question_type: 'choice' })),
  ]
  const body = buildLectureBody({ items })
  assert.equal(count(body, '<section class="lec-page"'), items.length, '每个小问行必须独占一页')
  for (const it of items) {
    assert.ok(body.includes(`data-qid="${it.id}"`), `页面必须带 data-qid=${it.id}（预览删题靠它）`)
  }
})

test('★ 无小问的题自然一题一页；空篮子给空态', () => {
  const body = buildLectureBody({ items: [createBasketItem(q({ id: 'x' }))] })
  assert.equal(count(body, '<section class="lec-page"'), 1)
  assert.equal(buildLectureBody({ items: [] }), buildLectureBody({}), '空篮子两路一致')
  assert.ok(/lec-empty/.test(buildLectureBody({ items: [] })), '空篮子必须有空态文案')
})

// ─────────────────────────────────────────────────────────────
// ①' 页面顺序必须 = 原卷题号自然序（2026-11-03 事故修复）
//    讲解版「一小问一页」，顺序不能依赖篮子勾选顺序（嘉定一模 25 题曾导出成
//    (2-2)→(2-1)→(1) 倒序）。必须按 (question_no, sub_no) 稳定排序。
// ─────────────────────────────────────────────────────────────

test('★ 讲解版页面顺序 = 原卷题号自然序，不依赖篮子勾选顺序', () => {
  const items = [
    createBasketItem(q({ id: 'c', question_no: 25, sub_no: '2-2', parent_stem: 'S' })),
    createBasketItem(q({ id: 'a', question_no: 25, sub_no: '1', parent_stem: 'S' })),
    createBasketItem(q({ id: 'b', question_no: 25, sub_no: '2-1', parent_stem: 'S' })),
  ]
  const body = buildLectureBody({ items, showImage: true })
  // 角标 = 原卷定位器，恒用原卷小问号（不随组内序号变）；题组化只改行内排版
  const i1 = body.indexOf('第 25 题(1)')
  const i21 = body.indexOf('第 25 题(2-1)')
  const i22 = body.indexOf('第 25 题(2-2)')
  assert.ok(i1 !== -1 && i21 !== -1 && i22 !== -1, '三页角标都要在')
  assert.ok(i1 < i21 && i21 < i22, '顺序必须 (1) → (2-1) → (2-2)，不得倒序/乱序')
})

test('★ 题号按数值排，不得按字典序（10 必须排在 2 之后）', () => {
  const items = [
    createBasketItem(q({ id: 'x', question_no: 10, sub_no: '1' })),
    createBasketItem(q({ id: 'y', question_no: 2, sub_no: '3' })),
  ]
  const body = buildLectureBody({ items })
  assert.ok(body.indexOf('第 10 题(1)') > body.indexOf('第 2 题(3)'), '数值序：2 在 10 之前')
})

// ─────────────────────────────────────────────────────────────
// ② 原卷题号（同讲义口径，绝不重编号）
// ─────────────────────────────────────────────────────────────

test('★ 角标与题号用原卷题号：卷名 + 「第 19 题(2)」，小问写 19(2)', () => {
  const body = buildLectureBody({
    items: [createBasketItem(q({ id: 'a', question_no: 19, sub_no: '2', parent_stem: '公共题干' }))],
  })
  assert.ok(body.includes('2026 黄浦一模'), '角标必须带原卷名')
  assert.ok(body.includes('第 19 题(2)'), '角标必须带原卷题号+小问号')
  assert.ok(body.includes('19(2)'), '题面行内必须有 19(2) 小问号')
})

test('★ 讲解版不得重编号（不得使用组卷的 sub_label 口径）', () => {
  const s = stripComments(read('src/utils/lecturePdf.js'))
  assert.ok(!/sub_label/.test(s), '讲解版必须用原卷题号，不得用组卷重编号')
  assert.ok(/it\.question_no|it\.sub_no|q\.question_no|q\.sub_no/.test(s), '必须取 question_no/sub_no')
})

// ─────────────────────────────────────────────────────────────
// ③ 题组排版（2026-11-04 负责人定稿：题号写在公共题干前面，小问只写（1）（2），
//    公共题干不再逐页重复 —— 推翻旧版「每页重复」的怪排版）
// ─────────────────────────────────────────────────────────────

test('★ 题组：首小问页「19. 公共题干」（题号在前），续页只写（2），题干只印一次', () => {
  const stem = '已知二次函数 y=ax²+2x+c 的图象经过点 (1, 4)'
  const body = buildLectureBody({
    items: [
      createBasketItem(q({ id: 'a', question_no: 19, sub_no: '1', parent_stem: stem })),
      createBasketItem(q({ id: 'b', question_no: 19, sub_no: '2', parent_stem: stem })),
    ],
  })
  assert.equal(count(body, '<section class="lec-page"'), 2, '一小问一页粒度不变：两问仍各占一页')
  assert.equal(count(body, 'lec-stem-text'), 1, '公共题干只印一次（不再逐页重复）')
  assert.ok(body.includes('<span class="lec-stem-no">19.</span>'), '题号必须写在公共题干前面')
  assert.ok(body.includes('<span class="lec-q-no">（1）</span>'), '首小问行内写（1）')
  assert.ok(body.includes('<span class="lec-q-no">（2）</span>'), '续页行内只写（2）')
  assert.ok(!body.includes('<span class="lec-q-no">19('), '行内题号不得再拼 19(1)/19(2)（角标原卷号不算）')
  const iStem = body.indexOf('lec-stem-no')
  const iQ1 = body.indexOf('（1）')
  const iQ2 = body.indexOf('（2）')
  assert.ok(iStem !== -1 && iStem < iQ1 && iQ1 < iQ2, '版式顺序：题号+公共题干 → （1） → （2）')
})

test('★ 独立行不误收组：单勾一道小问（无同号兄弟行）保持原版式 19(2)', () => {
  const body = buildLectureBody({
    items: [
      createBasketItem(q({ id: 'a', question_no: 19, sub_no: '2', parent_stem: '公共题干' })),
      createBasketItem(q({ id: 'b', question_no: 20 })),
    ],
  })
  assert.ok(body.includes('19(2)'), '单勾小问行内仍是 19(2)（无兄弟行不成组）')
  assert.ok(body.includes('20.'), '无小问独立题题号 20.')
  assert.equal(count(body, 'lec-stem-text'), 1, '独立页公共题干照常素排')
})

test('★ 跨卷同号不误并组：两份卷各有第 25 题，不得并成一个题组', () => {
  const stem = '公共题干'
  const body = buildLectureBody({
    items: [
      createBasketItem(q({ id: 'a', resource_id: 'res-A', question_no: 25, sub_no: '1', parent_stem: stem })),
      createBasketItem(q({ id: 'b', resource_id: 'res-B', question_no: 25, sub_no: '1', parent_stem: stem })),
    ],
  })
  assert.equal(count(body, '<span class="lec-q-no">25(1)</span>'), 2, '两卷的 25(1) 各自独立成页，行内题号不串组')
  assert.equal(count(body, 'lec-stem-text'), 2, '跨卷同号必须各自印自己的公共题干')
})

// ─────────────────────────────────────────────────────────────
// ④ 页脚：答案 + 来源留痕 + 解析要点
// ─────────────────────────────────────────────────────────────

test('★ 页脚小字印答案与来源留痕；缺答案显式印「未录入」', () => {
  const withAns = buildLectureBody({
    items: [createBasketItem(q({ id: 'a', answer: 'x=1', answer_source: 'official' }))],
  })
  assert.ok(withAns.includes('答案：'), '有答案必须印在页脚')
  assert.ok(withAns.includes('官方答案'), '来源必须留痕（官方/手填/AI）')

  const noAns = buildLectureBody({ items: [createBasketItem(q({ id: 'b' }))] })
  assert.ok(noAns.includes('未录入'), '缺答案必须显式说「未录入」，不能让老师以为漏印')
})

test('★ 解析印页脚且两行截断（防长解析撑爆书写区）', () => {
  const body = buildLectureBody({
    items: [createBasketItem(q({ id: 'a', analysis: '先求 a、c，再配方得顶点式……' }))],
  })
  assert.ok(body.includes('lec-analysis'), '有解析必须印')
  assert.ok(/-webkit-line-clamp:2/.test(buildLectureCSS()), 'CSS 必须两行截断')
})

// ─────────────────────────────────────────────────────────────
// ⑤ 题面与选项
// ─────────────────────────────────────────────────────────────

test('★ 选项必须行内渲染（renderContentInline），列数走 optionColumns 全站口径', () => {
  const s = stripComments(read('src/utils/lecturePdf.js'))
  assert.ok(/renderContentInline\(opt\)/.test(s), '选项必须走 renderContentInline')
  assert.ok(!/renderContent\(opt\)/.test(s), '不得用 renderContent 渲染选项（公式选项会散架）')
  assert.ok(/optionColumns\(/.test(s), '列数必须走 optionColumns（全站唯一口径）')

  const body = buildLectureBody({
    items: [createBasketItem(q({
      id: 'a', question_type: 'choice', question_no: 5,
      options: ['1', '2', '3', '4'], content: '下列哪个是',
    }))],
  })
  assert.ok(body.includes('A. '), '选项标号 A 起步')
  assert.ok(/repeat\(4,1fr\)/.test(body), '短选项 4 列排布')
})

test('★ 原题图开关：默认不印，showImage=true 且有 image_url 才印', () => {
  const item = q({ id: 'a', image_url: 'https://oss.example.com/q19.png' })
  assert.ok(!buildLectureBody({ items: [createBasketItem(item)] }).includes('lec-img'), '默认不印原题图')
  const withImg = buildLectureBody({ items: [createBasketItem(item)], showImage: true })
  assert.ok(withImg.includes('lec-img'), '开关打开必须印原题图')
  assert.ok(withImg.includes('https://oss.example.com/q19.png'), '图地址必须原样带上')
})

// ─────────────────────────────────────────────────────────────
// ⑤' 版式参照（2026-11-02 负责人样张：中西书局讲解稿）——无底纹 + 图在题干下
// ─────────────────────────────────────────────────────────────

test('★ 页面无任何底纹：角标素字、题干素排，不得出现背景色盒子', () => {
  const css = buildLectureCSS()
  assert.ok(!/\.lec-badge\{[^}]*background/.test(css), '角标不得带底色药丸')
  assert.ok(!/\.lec-stem\{[^}]*background/.test(css), '题干不得带灰底盒子')
  assert.ok(!/\.lec-stem\{[^}]*border/.test(css), '题干不得带边框')
  const body = buildLectureBody({
    items: [createBasketItem(q({ id: 'a', parent_stem: '公共题干' }))],
  })
  assert.ok(!body.includes('lec-stem-label'), '「公共题干」标签不得再渲染（参照版式是素排）')
})

test('★ 配图位置：图在题目内容之下（题干→小问→图），不得插在题干和小问之间', () => {
  const body = buildLectureBody({
    items: [createBasketItem(q({
      id: 'a', question_no: 25, sub_no: '1', parent_stem: '如图，在三角形ABC中',
      image_url: 'https://oss.example.com/q25.jpg', content: '当EF平行BC时求面积',
    }))],
    showImage: true,
  })
  const iStem = body.indexOf('lec-stem-text')
  const iQ = body.indexOf('lec-q-text')
  const iImg = body.indexOf('lec-img')
  assert.ok(iStem !== -1 && iImg !== -1 && iQ !== -1, '三要素都要在')
  assert.ok(iStem < iQ && iQ < iImg, '顺序必须是 题干 → 小问 → 图')
})

test('★ 配图矢量优先：有 vec_url（几何重绘 SVG）用之，否则回退原题裁片', () => {
  const item = q({
    id: 'a', image_url: 'https://oss.example.com/q25.jpg',
    vec_url: '/api/paper-bank/fig/abc.svg',
  })
  const withVec = buildLectureBody({ items: [createBasketItem(item)], showImage: true })
  assert.ok(withVec.includes('src="/api/paper-bank/fig/abc.svg"'), '有矢量图必须优先用')
  assert.ok(withVec.includes('data-fig-fallback="https://oss.example.com/q25.jpg"'), '必须带裁片回退地址')
  const noVec = buildLectureBody({
    items: [createBasketItem(q({ id: 'b', image_url: 'https://oss.example.com/q25.jpg' }))],
    showImage: true,
  })
  assert.ok(noVec.includes('src="https://oss.example.com/q25.jpg"'), '无矢量图回退裁片')
})

// ─────────────────────────────────────────────────────────────
// ⑥ 横版 4:3 页面（负责人拍板 ①）
// ─────────────────────────────────────────────────────────────

test('★ 页面必须是横版 4:3（280×210mm），CSS 与导出 pdfOptions 同尺寸', () => {
  assert.deepEqual(LECTURE_PAGE_MM, { width: '280mm', height: '210mm' })
  const ratio = LECTURE_PAGE_PX.w / LECTURE_PAGE_PX.h
  assert.ok(Math.abs(ratio - 4 / 3) < 0.01, `像素尺寸必须 4:3，实际 ${ratio.toFixed(3)}`)
  const css = buildLectureCSS()
  assert.ok(/\.lec-page\{width:280mm;height:210mm/.test(css), '页面 CSS 必须固定 280×210mm')
  assert.ok(/@page\{size:280mm 210mm/.test(css), '@page 必须同尺寸')

  const page = stripComments(read('src/workbench/views/PaperBankWorkbench.vue'))
  assert.ok(page.includes("width: LECTURE_PAGE_MM.width"), '导出必须把横版尺寸传给后端 pdfOptions')
  assert.ok(page.includes("height: LECTURE_PAGE_MM.height"), '导出必须把横版高度传给后端 pdfOptions')
})

test('★ 书写区必须 flex:1 撑满剩余页高（讲解版的价值就在留白）', () => {
  const css = buildLectureCSS()
  assert.ok(/\.lec-write\{flex:1/.test(css), '书写区必须 flex:1')
  const body = buildLectureBody({ items: [createBasketItem(q({ id: 'a' }))] })
  assert.ok(body.includes('<div class="lec-write"></div>'), '每页必须有书写区')
})

// ─────────────────────────────────────────────────────────────
// ⑦ 版式边界：纯净打印样式 + 不复用排卷
// ─────────────────────────────────────────────────────────────

test('★ 打印版式纯净：灰底/阴影/交互按钮不得进 lecturePdf（归预览舞台）', () => {
  const s = stripComments(read('src/utils/lecturePdf.js'))
  assert.ok(!s.includes('#e6e4de'), '灰底不能进打印版式')
  assert.ok(!/box-shadow/.test(s), '纸张阴影不能进打印版式')
  assert.ok(!/pb-del/.test(s), '删除按钮是预览侧交互，不能进打印版式')
})

test('★ 不得复用重练卷排卷/分块（判题编号同构，题库题没有学生/作答）', () => {
  const s = stripComments(read('src/utils/lecturePdf.js'))
  assert.ok(!/buildPaperBody/.test(s), '不得调用 buildPaperBody')
  assert.ok(!/buildRetryPaperOrder/.test(s), '不得调用 buildRetryPaperOrder')
  assert.ok(!/RETRY_PAPER_BLOCKS/.test(s), '不得引用 RETRY_PAPER_BLOCKS')
})

// ─────────────────────────────────────────────────────────────
// ⑧ 视图接线（预览 tab / 共用 buildPaperHtml / 单一导出）
// ─────────────────────────────────────────────────────────────

const PAGE = 'src/workbench/views/PaperBankWorkbench.vue'

test('★ 预览区必须有「讲解版」tab，且走同一套预览/下载管线', () => {
  const s = stripComments(read(PAGE))
  assert.ok(/key:\s*'lecture',\s*label:\s*'讲解版'/.test(s), '必须有讲解版 tab')
  assert.equal((s.match(/buildLectureBody\(/g) || []).length, 1, '讲解版 bodyHtml 只允许构造一次（buildPaperHtml 内）')
  assert.equal((s.match(/exportServerPDF\(/g) || []).length, 1, 'PDF 生成必须收敛到唯一的下载动作')
  assert.ok(/pdfOptions: isLecture/.test(s), '讲解版必须传专属 pdfOptions（横版尺寸）')
})

test('★ 预览缩放与页数要认讲解版的页宽/页数口径', () => {
  const s = stripComments(read(PAGE))
  assert.ok(/LECTURE_PAGE_PX\.w/.test(s), '适应宽度必须按讲解版页宽（≈1058px）算')
  assert.ok(/previewKind\.value === 'lecture'\s*\?\s*basket\.value\.length/.test(s),
    '讲解版页数必须精确等于篮子长度（每小问一页），不得按 A4 页高估')
})

// ── 配图版式（2026-11-03 负责人报障：配图「居中且太小」）──
// 真因不是 CSS 居中：裁片是整页宽横条、图形只占 12%~45%，缩到 55% 页宽后
// 图形仅约 15mm，且被左侧空白推到中部（看起来像居中）。修法两层：
//   ① 抠图横向裁紧（锁在 paperFigureAssign.test.mjs）；
//   ② 讲解版配图容器强制靠左 + 尺寸上限放开到 50% 页宽 / 64mm 高。
// 这里锁第 ② 层，避免有人「顺手」改回 auto 居中或把尺寸收小。

test('★ 讲解版配图必须靠左：容器 flex-start，不许 auto 居中', () => {
  const css = buildLectureCSS()
  const box = (css.match(/\.lec-img\{[^}]*\}/) || [''])[0]
  assert.ok(box, '必须有 .lec-img 规则')
  assert.ok(/display:flex/.test(box), '.lec-img 必须是 flex 容器（靠左判据的唯一实现）')
  assert.ok(/justify-content:flex-start/.test(box), '.lec-img 必须 justify-content:flex-start')
  assert.ok(!/margin[^;}]*auto/.test(box), '.lec-img 不许用 auto 外边距（会被误读成居中）')

  const img = (css.match(/\.lec-img img\{[^}]*\}/) || [''])[0]
  assert.ok(img, '必须有 .lec-img img 规则')
  assert.ok(/max-width:50%/.test(img), '配图最大宽必须 50% 页宽（2026-11-03 定稿）')
  assert.ok(/max-height:64mm/.test(img), '配图最大高必须 64mm（2026-11-03 定稿）')
  assert.ok(!/margin:0 auto/.test(img), '配图不得 margin:0 auto 居中')
})

test('★ 通用卷面配图 .q-image 也必须靠左（讲义/组卷/错题卷同口径）', () => {
  const src = stripComments(read('src/utils/pdfGenerator.js'))
  assert.ok(/\.q-image\{text-align:left/.test(src), '.q-image 必须 text-align:left')
  assert.ok(!/\.q-image\{text-align:center/.test(src), '.q-image 不得回退 text-align:center')
})
