/**
 * retryCoverageNotice.test.mjs — 重练批改页「答卷覆盖度提示」回归测试
 *
 * 锁定 2026-09-15 的事故（错题再测-0911 陈昊煜：16 题卷面只识别到 11 题）：
 *   学生只拍了第 1 页答卷 → 第 2 页的 12~16 题在图上没有任何痕迹 →
 *   落成「AI 未判定」（exception，需要老师逐题处理）。但界面上没有任何线索
 *   说明"为什么这几题没判定"：左栏页标已在 bc94558 关闭（paper 模式不渲染），
 *   中央页指示器又只在 pages>1 时出现，缺页 = 信息黑洞。
 *
 * 本测试锁两件事：
 *   ① 覆盖度的**判据**必须是 matchedBy==='none'（对齐失败），
 *      **不是**「该题在 retryAlign 里有没有记录」—— 记录是每道卷面题都有的，
 *      未对位的那几条同样在数组里（第一版实现就是踩了这个坑，实测 16/16 全"有记录"）。
 *   ② 提示只陈述事实，绝不写判定（不得把缺痕迹的题改判成 blank / 改 review_status）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildRetryPaperOrder, alignRetryAnswers } from '../server/utils/retryPaperOrder.js'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const mkQ = (id, questionType = 'fill', extra = {}) => ({
  id,
  question_type: questionType,
  question_number: null,
  sub_no: null,
  page_number: 1,
  task_id: 'task-1',
  ...extra,
})

// ── ① 判据语义：未对位的题「仍在数组里」，靠 matchedBy='none' 识别 ──

test('对位：卷面有、图上没痕迹的题必须留在结果里并标 matchedBy=none（不是消失）', () => {
  // 16 题卷面（全填空，编号即 1..16）
  const qs = Array.from({ length: 16 }, (_, i) => mkQ(`q${i + 1}`))
  const order = buildRetryPaperOrder(qs)
  assert.deepEqual(order.map((it) => it.label), Array.from({ length: 16 }, (_, i) => String(i + 1)))

  // 学生只上传了第 1 页 → OCR 只有第 1~11 题
  const ocr = Array.from({ length: 11 }, (_, i) => ({
    question_number: i + 1,
    student_answer: 'x',
  }))
  const pairs = alignRetryAnswers(order, ocr)

  // 关键：条数 = 卷面题数，未对位的题不会从数组里消失
  assert.equal(pairs.length, 16, '每道卷面题都必须有一条对位记录（含未对位的）')

  const matched = pairs.filter((p) => p.matchedBy !== 'none')
  const unmatched = pairs.filter((p) => p.matchedBy === 'none')
  assert.equal(matched.length, 11)
  assert.equal(unmatched.length, 5)
  // 缺的正好是第 2 页的 12~16 题
  assert.deepEqual(unmatched.map((p) => p.item.label), ['12', '13', '14', '15', '16'])
  // 未对位的记录没有答案、没有坐标（前端据此判定 matchedBy 缺失时的兜底）
  assert.ok(unmatched.every((p) => p.ocr === null))
})

test('对位：全覆盖时不得产生任何 matchedBy=none（避免误报缺页）', () => {
  const qs = Array.from({ length: 8 }, (_, i) => mkQ(`q${i + 1}`))
  const order = buildRetryPaperOrder(qs)
  const ocr = Array.from({ length: 8 }, (_, i) => ({ question_number: i + 1, student_answer: 'x' }))
  const pairs = alignRetryAnswers(order, ocr)
  assert.equal(pairs.filter((p) => p.matchedBy === 'none').length, 0)
})

// ── ② 源码级断言：判据 + 只提示不判定 + UI 接线 ──

test('reviewStore.retryCoverage 的判据必须是 matchedBy==="none"，不得用「有没有记录」', () => {
  const store = read('src/workbench/stores/reviewStore.js')
  assert.ok(store.includes('const retryCoverage = computed('), '必须存在 retryCoverage')
  assert.ok(store.includes('retryCoverage,'), '必须导出 retryCoverage')
  // 权威判据：对齐失败
  assert.ok(
    store.includes("if (r.matchedBy) return r.matchedBy === 'none'"),
    '判据必须读 matchedBy==="none"（alignRetryAnswers ③ 的语义）'
  )
  // 命中才计入：未对位的记录不得被当成"有痕迹"
  assert.ok(
    store.includes('if (!isUnmatchedOnPaper(r)) matchedIds.add(r.questionId)'),
    '只有非未对位记录才能计入 matchedIds —— 否则未对位题会被当成已覆盖'
  )
  // 整卷无对位明细时不可判 → 不提示（旧数据 / 未走对位管线）
  assert.ok(store.includes('if (!anyAlign) return null'), '无对位明细时必须放弃提示，不能报满屏缺题')
})

test('覆盖度提示只读不写：不得改判定 / 改 review_status / 落库', () => {
  const store = read('src/workbench/stores/reviewStore.js')
  const start = store.indexOf('const retryCoverage = computed(')
  const end = store.indexOf('// 所有题目（用于显示完整题号导航 1~N）')
  assert.ok(start > 0 && end > start, 'retryCoverage 代码块定位失败')
  const block = store.slice(start, end)
  for (const forbidden of ['is_correct', 'review_status', 'updateQuestionReviewStatus', 'blank']) {
    assert.ok(!block.includes(forbidden), `覆盖度提示块不得出现 ${forbidden}（只提示、不判定）`)
  }
})

test('批改页必须渲染覆盖度提示，且文案同时给出「空着没做」与「漏拍补传」两种处置', () => {
  const vue = read('src/workbench/components/review/ReviewWorkspace.vue')
  assert.ok(vue.includes('v-if="store.retryCoverage"'), '横幅必须由 retryCoverage 驱动（为空时不渲染）')
  assert.ok(vue.includes('没有任何作答痕迹'), '必须说明这几题在图上没有痕迹')
  assert.ok(vue.includes('按「未作答」处理'), '必须给出"学生本来就没做"的处置')
  assert.ok(vue.includes('补传'), '必须给出"漏拍一页"的处置')
})
