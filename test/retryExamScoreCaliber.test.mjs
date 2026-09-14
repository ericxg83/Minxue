// 回归测试：重练卷「结果数字」的归类口径必须与前端复核口径同源
//
// 背景（2026-09-14 全库对账）：
//   `/generated-exams/student/:id` 的 correct_count / wrong_count 原先只看 questions.is_correct，
//   无视老师的人工复核结论 review_status ⇒ 老师改判不体现在家长看到的分数上。
//   7 份已批改的卷实测 6 份两套口径不一致（余晨瑞 10对/3错 vs 12对/5错）。
//
// 本测试锁死两份实现不漂移（**无例外**）：
//   1. 服务端统计口径：server/utils/questionResultCaliber.js classifyQuestionResult
//   2. 前端唯一真相：src/utils/reviewDecision.js effectiveIsCorrect（PC 复核页 / 结算同源）
//
// 30 种组合（is_correct × answer_source × review_status）逐项必须相等。特别地：
//   学生未作答（answer_source='blank'）算**错**，不算"未判定" —— 「未作答等同不会」
//   是本项目既定统计口径（weeklyReport 的 wrong 计数直接含 blank）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyQuestionResult, summarizeQuestionResults } from '../server/utils/questionResultCaliber.js'
import { effectiveIsCorrect } from '../src/utils/reviewDecision.js'

const bucketOfFrontend = (q) => {
  const v = effectiveIsCorrect(q)
  return v === true ? 'correct' : v === false ? 'wrong' : 'unjudged'
}

test('全组合：服务端归类与前端 effectiveIsCorrect 完全一致（无例外）', () => {
  const answerSources = ['recognized', 'blank']
  const isCorrects = [true, false, null]
  const reviewStatuses = [null, 'correct', 'wrong', 'wrong_no_book', 'exclude']
  let checked = 0
  for (const answer_source of answerSources) {
    for (const is_correct of isCorrects) {
      for (const review_status of reviewStatuses) {
        const q = { is_correct, answer_source, review_status }
        assert.equal(
          classifyQuestionResult(q),
          bucketOfFrontend(q),
          `口径漂移 ${JSON.stringify(q)}：服务端=${classifyQuestionResult(q)} 前端=${bucketOfFrontend(q)}`
        )
        checked++
      }
    }
  }
  assert.equal(checked, 30)
})

test('人工复核结论优先于 AI 判定（本次修复的核心）', () => {
  // 老师翻案：AI 判对，老师判错 → 必须算错（原先服务端仍算"对"）
  assert.equal(classifyQuestionResult({ is_correct: true, answer_source: 'recognized', review_status: 'wrong' }), 'wrong')
  // 老师翻案：AI 判错，老师判对 → 必须算对
  assert.equal(classifyQuestionResult({ is_correct: false, answer_source: 'recognized', review_status: 'correct' }), 'correct')
  // 老师给出结论但 AI 没判出（is_correct=null）→ 按老师结论算
  assert.equal(classifyQuestionResult({ is_correct: null, answer_source: 'recognized', review_status: 'correct' }), 'correct')
  assert.equal(classifyQuestionResult({ is_correct: null, answer_source: 'recognized', review_status: 'wrong' }), 'wrong')
  // 排除题：既不进对也不进错
  assert.equal(classifyQuestionResult({ is_correct: false, answer_source: 'recognized', review_status: 'exclude' }), 'unjudged')
})

test('无复核结论时按 AI 判定归类，未作答同样算错', () => {
  assert.equal(classifyQuestionResult({ is_correct: true, answer_source: 'recognized', review_status: null }), 'correct')
  assert.equal(classifyQuestionResult({ is_correct: false, answer_source: 'recognized', review_status: null }), 'wrong')
  assert.equal(classifyQuestionResult({ is_correct: null, answer_source: 'recognized', review_status: null }), 'unjudged')
  // 未作答等同不会：blank + is_correct=false 算错（与周报/结算同口径）
  assert.equal(classifyQuestionResult({ is_correct: false, answer_source: 'blank', review_status: null }), 'wrong')
  // 题目行取不到（question_ids 里有悬空 id）也要兜住，不能算进任何一边
  assert.equal(classifyQuestionResult(undefined), 'unjudged')
  assert.equal(classifyQuestionResult(null), 'unjudged')
})

test('汇总：未判定包含排除题，total 守恒', () => {
  const rows = [
    { is_correct: true, answer_source: 'recognized', review_status: null },        // correct
    { is_correct: true, answer_source: 'recognized', review_status: 'wrong' },     // wrong（老师翻案）
    { is_correct: false, answer_source: 'blank', review_status: null },            // wrong（未作答等同不会）
    { is_correct: null, answer_source: 'recognized', review_status: null },        // unjudged
    { is_correct: false, answer_source: 'recognized', review_status: 'exclude' },  // unjudged + excluded
  ]
  const s = summarizeQuestionResults(rows)
  assert.deepEqual(s, { total: 5, correct: 1, wrong: 2, unjudged: 2, excluded: 1 })
  assert.equal(s.correct + s.wrong + s.unjudged, s.total)
})

test('空输入不炸', () => {
  assert.deepEqual(summarizeQuestionResults(null), { total: 0, correct: 0, wrong: 0, unjudged: 0, excluded: 0 })
  assert.deepEqual(summarizeQuestionResults([]), { total: 0, correct: 0, wrong: 0, unjudged: 0, excluded: 0 })
})

// ── 源码级断言：SQL 聚合不允许退回「只看 is_correct」的旧口径 ──
// weeklyReport.js 的 correct/wrong 是 SQL COUNT 聚合，没法走 JS 归类函数，
// 因此统一 import 共享 SQL 表达式（与 classifyQuestionResult 同文件同源）。
// 2026-09-14 之前的写法 `COUNT(*) FILTER (WHERE is_correct = true)` 会让周报
// 同样无视老师改判 —— 与本次修复的初衷相悖，这里锁死防止回退。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

test('周报 SQL 必须使用共享口径表达式，禁止裸 is_correct 统计', () => {
  const src = read('server/routes/weeklyReport.js')
  assert.ok(src.includes("sqlCorrectExpr"), 'weeklyReport 应 import/使用 sqlCorrectExpr')
  assert.ok(src.includes("sqlWrongExpr"), 'weeklyReport 应 import/使用 sqlWrongExpr')
  assert.ok(!src.includes('FILTER (WHERE is_correct'), '周报禁止裸 is_correct 统计（会无视人工复核）')
  assert.ok(!src.includes("answer_source = 'blank'"), '周报禁止把 blank 硬编码进 wrong（口径在 caliber 模块里）')
})

test('服务端统计路由必须走 questionResultCaliber 汇总', () => {
  const index = read('server/index.js')
  assert.ok(index.includes('summarizeQuestionResults'), 'generated-exams/student 统计应走共享汇总')
  assert.ok(
    !index.includes('else if (info.is_correct === true) correct_count++'),
    '统计循环不得保留旧口径（只数 is_correct、无视 review_status）'
  )
})
