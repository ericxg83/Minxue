/**
 * 「批改完自动复核」闸 —— 口径回归锁（2026-09-24）
 *
 * 锁两条负责人拍板的口径，任一条被改动这里必须先红：
 *   1. 【保守】任何未入册错题都拦卷（不做分层、不自动写 wrong_no_book）
 *   2. 低置信但 AI 已给出正误 ⇒ 算「已判出」，不拦卷（不等同于未判出）
 *
 * 只测纯函数 resolveAutoReviewDecision，不连库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveAutoReviewDecision, AUTO_REVIEW_FLAG } from '../server/services/autoReviewService.js'

const decide = (questions, wrongIds = []) =>
  resolveAutoReviewDecision({ questions, wrongQuestionIds: new Set(wrongIds) })

test('标记字段名固定为 autoReviewed（tasks.result JSONB，不建列）', () => {
  assert.equal(AUTO_REVIEW_FLAG, 'autoReviewed')
})

test('全卷已判出且错题已入册 ⇒ 可自动复核', () => {
  const questions = [
    { id: 'q1', is_correct: true, review_status: null, answer_source: 'recognized' },
    { id: 'q2', is_correct: false, review_status: null, answer_source: 'recognized' }
  ]
  const r = decide(questions, ['q2'])
  assert.equal(r.canAuto, true)
  assert.deepEqual(r.reasons, [])
})

test('未作答 blank 算终态，不拦卷', () => {
  const r = decide([{ id: 'q1', is_correct: null, answer_source: 'blank', review_status: null }])
  assert.equal(r.canAuto, true)
})

test('AI 未判出（有置信度却给不出正误）⇒ 留人工', () => {
  const questions = [
    { id: 'q1', is_correct: true, review_status: null, answer_source: 'recognized' },
    { id: 'q2', is_correct: null, review_status: null, confidence: 0.9, answer_source: 'recognized' }
  ]
  const r = decide(questions)
  assert.equal(r.canAuto, false)
  assert.equal(r.unjudgedCount, 1)
  assert.ok(r.reasons.some(t => t.includes('未判出')))
})

test('【保守口径】AI 判错但未入册 ⇒ 拦卷（不替老师决定不入错题本）', () => {
  const questions = [{ id: 'q1', is_correct: false, review_status: null, answer_source: 'recognized' }]
  const r = decide(questions, [])
  assert.equal(r.canAuto, false)
  assert.equal(r.unresolvedWrongCount, 1)
  assert.ok(r.reasons.some(t => t.includes('拍板')), `reasons=${r.reasons.join(';')}`)
})

test('低置信但 AI 已判错 ⇒ 算已判出；只要已入册就不拦', () => {
  const questions = [{ id: 'q1', is_correct: false, review_status: null, confidence: 0.2, answer_source: 'recognized' }]
  const r = decide(questions, ['q1'])
  assert.equal(r.canAuto, true, '已判出 + 已入册 ⇒ 不该被置信度拦住')
})

test('老师标 wrong_no_book 的题不算待拍板', () => {
  const questions = [{ id: 'q1', is_correct: false, review_status: 'wrong_no_book', answer_source: 'recognized' }]
  assert.equal(decide(questions).canAuto, true)
})

test('空卷不自动复核（避免误关）', () => {
  const r = decide([])
  assert.equal(r.canAuto, false)
  assert.ok(r.reasons.some(t => t.includes('题目列表为空')))
})

test('wrongQuestionIds 传数组也能正常工作（脚本侧便利）', () => {
  const questions = [{ id: 'q1', is_correct: false, review_status: null, answer_source: 'recognized' }]
  assert.equal(resolveAutoReviewDecision({ questions, wrongQuestionIds: ['q1'] }).canAuto, true)
})
