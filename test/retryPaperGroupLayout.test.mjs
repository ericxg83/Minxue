/**
 * retryPaperGroupLayout.test.mjs — 重练卷「题组排版」回归锁（2026-11-04）
 *
 * 负责人定稿：重练卷题组排版与讲义/讲解版统一 ——
 *   组头印「4. 公共题干」（题号写在题干前面，全卷只印一次），
 *   小问行只写「（1）」（**原卷 sub_no**），不再印「4(1).」拼接号。
 *
 * ⛔ 判题契约不动：buildRetryPaperOrder 的 label（'4(1)'）是判题对位键，
 *   OCR 读学生卷面后 normalizeRetryPaperLabel 把「（1）」归一化成 '4(1)' 对回去。
 *   本锁同时验证这条往返链路：卷面印「（1）」→ OCR sub_no → 命中 label '4(1)'。
 *
 * 同构面（改版式必须三处同步，缺一处预览/打印就不一致）：
 *   ① server/services/wrongRetryPdfService.js（PC 一键导出，本文件功能级验证）
 *   ② src/utils/pdfGenerator.js buildPaperBody（移动端/周报/print，源码级锁）
 *   ③ src/workbench/components/review/RetryPaperPreview.vue（卷面预览，源码级锁）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const { buildExamHTML } = await import('../server/services/wrongRetryPdfService.js')
const { buildRetryPaperOrder, alignRetryAnswers } = await import('../server/utils/retryPaperOrder.js')

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8')

const mkQ = (id, over = {}) => ({
  id,
  question_type: 'answer',
  question_number: null,
  sub_no: null,
  page_number: 1,
  task_id: 'task-1',
  parent_stem: null,
  content: '',
  options: [],
  difficulty: 3,
  ...over,
})

// ⚠️ fixture 文案用纯中文：服务端 renderMath 会把拉丁字母/数字包进 katex span，
// 字面断言会被拆碎；纯中文原样通过，断言才稳定。
const STEMS = '已知抛物线开口向上，且图象经过第一象限内一点。'

/** 三道选择题垫号（1/2/3）+ 题4 题组两个小问 + 题5 独立题 → 组头应为「4.」 */
const groupFixture = () => [
  mkQ('c1', { question_type: 'choice', question_number: 1, content: '选择一' }),
  mkQ('c2', { question_type: 'choice', question_number: 2, content: '选择二' }),
  mkQ('c3', { question_type: 'choice', question_number: 3, content: '选择三' }),
  mkQ('g1', { question_number: 4, sub_no: '1', parent_stem: STEMS, content: '求开口方向和对称轴。' }),
  mkQ('g2', { question_number: 4, sub_no: '2', parent_stem: STEMS, content: '求顶点坐标并说明理由。' }),
  mkQ('s5', { question_number: 5, content: '计算并写出完整过程。' }),
]

test('★ 题组排版：组头「4. 公共题干」题号在题干前、只印一次，小问行写（1）（2）', () => {
  const qs = groupFixture()
  const html = buildExamHTML({ title: '锁', studentName: '锁', questions: qs, qrSvg: '' })

  // 判题键不回归：排卷 label 仍是 '4(1)'/'4(2)'
  const labels = buildRetryPaperOrder(qs).map((it) => it.label)
  assert.deepEqual(labels, ['1', '2', '3', '4(1)', '4(2)', '5'])

  // 组头：题号 + 公共题干同行（题号在前），全卷只出现一次
  assert.equal((html.match(/<span class="q-num">4\.<\/span>/g) || []).length, 1, '组头大题号 4. 只印一次')
  assert.ok(html.includes('<span class="q-num">4.</span><span class="q-text">' + STEMS),
    '题号必须写在公共题干前面（同一行内相邻）')
  assert.equal((html.match(new RegExp(STEMS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1,
    '公共题干全卷只印一次')

  // 小问行：原卷小问号，不再拼 4(1)/4(2)
  assert.ok(html.includes('<span class="q-num">（1）</span>'), '首小问行印（1）')
  assert.ok(html.includes('<span class="q-num">（2）</span>'), '续小问行印（2）')
  assert.ok(!html.includes('4(1)') && !html.includes('4(2)'), '卷面不得再印 4(1)/4(2) 拼接号')

  // 独立题保持原版式
  assert.ok(html.includes('<span class="q-num">5.</span>'), '无小问独立题仍印 5.')
})

test('★ 判题往返：卷面「（1）」经 OCR sub_no 归一化后命中不变的判题键 4(1)', () => {
  const qs = groupFixture()
  const order = buildRetryPaperOrder(qs)
  // 模拟 OCR 读新排版卷面：大题行读出 4，小问行括号（含全角）读出小问号
  const ocr = [
    { question_number: 1, sub_no: null },
    { question_number: 2, sub_no: null },
    { question_number: 3, sub_no: null },
    { question_number: 4, sub_no: '（1）' },
    { question_number: 4, sub_no: '（2）' },
    { question_number: 5, sub_no: null },
  ]
  const pairs = alignRetryAnswers(order, ocr)
  assert.equal(pairs[3].matchedBy, 'number', '（1）必须按题号命中')
  assert.equal(pairs[3].item.question.id, 'g1')
  assert.equal(pairs[4].item.question.id, 'g2')
  assert.equal(pairs.every((p) => p.matchedBy === 'number'), true, '新排版下全部按题号精确对位，不落到位置兜底')
})

test('★ 无公共题干的小问行保持原版式 2(1).（不成题组组头）', () => {
  const qs = [
    mkQ('c1', { question_type: 'choice', question_number: 1, content: '选择' }),
    mkQ('g1', { question_number: 2, sub_no: '1', content: '(1) 求 a 的值。' }),
    mkQ('g2', { question_number: 2, sub_no: '2', content: '(2) 求 b 的值。' }),
  ]
  const html = buildExamHTML({ title: '锁', studentName: '锁', questions: qs, qrSvg: '' })
  assert.ok(html.includes('<span class="q-num">2(1).</span>'), '无公共题干的小问保持 2(1). 编号')
  assert.ok(html.includes('<span class="q-num">2(2).</span>'), '同上，2(2).')
  assert.ok(!html.includes('<span class="q-num">（'), '不出现题组小问行形态')
})

test('★ 英语语篇独立题（parent_stem 是整篇原文）保持 q-stem 独立块原版式', () => {
  const qs = [
    mkQ('p1', { question_type: 'choice', question_number: 3, parent_stem: '文章原文若干行，讲述完整的语境与情节。', content: '选出正确的一项。', options: ['甲', '乙', '丙', '丁'] }),
  ]
  const html = buildExamHTML({ title: '锁', studentName: '锁', questions: qs, qrSvg: '' })
  assert.ok(html.includes('<div class="q-stem">文章原文'), '语篇原文仍走独立 q-stem 块')
  assert.ok(html.includes('<span class="q-num">1.</span>'), '题号行保持原样')
  assert.ok(!html.includes('<span class="q-num">（'), '不进入题组排版')
})

// ── 三处渲染同构 + 判题键源码不回归（源码级锁）──

test('★ 三处渲染同步改版：pdfGenerator / RetryPaperPreview / worker OCR 提示词', () => {
  const gen = read('src/utils/pdfGenerator.js')
  assert.ok(gen.includes('isGroupedSub'), '前端 buildPaperBody 应有题组分支')
  assert.ok(gen.includes('（${subNo}）'), '前端小问行应印原卷 sub_no')

  const preview = read('src/workbench/components/review/RetryPaperPreview.vue')
  assert.ok(preview.includes('row.isGroupedSub'), '预览组件应有题组分支')
  assert.ok(preview.includes('{{ row.groupNum }}.'), '预览组头应印大题号+点')

  const worker = read('server/worker.js')
  assert.ok(worker.includes('分行形（本系统重练卷现行排版）'),
    'OCR 提示词必须教模型认新排版（大题行 21. + 小问行（1））')
})

test('★ 判题键源码不回归：两份 retryPaperOrder 的 label 生成式逐字不变', () => {
  const labelLine = "label: subNo ? `${num}(${subNo})` : String(num),"
  assert.ok(read('src/utils/retryPaperOrder.js').includes(labelLine), '前端排卷 label 不许动')
  assert.ok(read('server/utils/retryPaperOrder.js').includes(labelLine), '服务端排卷 label 不许动')
})
