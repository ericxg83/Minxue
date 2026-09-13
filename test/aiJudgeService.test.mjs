/**
 * 回归测试：判题终裁 aiJudgeService（grok-4.5 L3 仲裁）
 *
 * 锁定两块纯逻辑，防止将来改坏安全边界：
 *   1. parseJudgeVerdict —— AI 返回的裁决解析：非法值/无 JSON/围栏一律按 uncertain 处理
 *      （uncertain = 维持 is_correct=null 转人工，绝不猜）。
 *   2. selectJudgeCandidates —— 只送「学生作答 + 参考答案可验证 + 客观题」；
 *      解答题、未作答、无参考、开放题（"证明略"）永不送裁。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseJudgeVerdict, selectJudgeCandidates } from '../server/services/aiJudgeService.js'

// ── parseJudgeVerdict ──────────────────────────────────────────────

test('parseJudgeVerdict: 标准三态裁决', () => {
  assert.deepEqual(parseJudgeVerdict('{"verdict":"correct","reason":"等价未化简"}'),
    { verdict: 'correct', reason: '等价未化简' })
  assert.deepEqual(parseJudgeVerdict('{"verdict":"wrong","reason":"丢负号"}'),
    { verdict: 'wrong', reason: '丢负号' })
  assert.deepEqual(parseJudgeVerdict('{"verdict":"uncertain","reason":"题目截断"}'),
    { verdict: 'uncertain', reason: '题目截断' })
})

test('parseJudgeVerdict: 带代码围栏和前后杂讯也能解析', () => {
  const noisy = '好的，判定如下：\n```json\n{"verdict":"correct","reason":"0.5=1/2"}\n```\n以上。'
  assert.equal(parseJudgeVerdict(noisy).verdict, 'correct')
})

test('parseJudgeVerdict: 非法裁决值按 uncertain 处理（绝不猜）', () => {
  assert.equal(parseJudgeVerdict('{"verdict":"maybe","reason":"嗯"}').verdict, 'uncertain')
  assert.equal(parseJudgeVerdict('{"verdict":"","reason":""}').verdict, 'uncertain')
})

test('parseJudgeVerdict: 无 JSON / 空返回 / 解析失败一律 uncertain', () => {
  assert.equal(parseJudgeVerdict('我觉得是对的').verdict, 'uncertain')
  assert.equal(parseJudgeVerdict('').verdict, 'uncertain')
  assert.equal(parseJudgeVerdict(null).verdict, 'uncertain')
  assert.equal(parseJudgeVerdict('{"verdict":"correct" broken').verdict, 'uncertain')
})

test('parseJudgeVerdict: reason 超长截断到 50 字', () => {
  const r = parseJudgeVerdict('{"verdict":"wrong","reason":"' + 'x'.repeat(200) + '"}')
  assert.equal(r.reason.length, 50)
})

// ── selectJudgeCandidates ──────────────────────────────────────────

const mk = (over = {}) => ({
  id: 'q-1',
  is_correct: null,
  answer_source: 'recognized',
  student_answer: '2√3',
  answer: '-2√3',
  question_type: 'fill',
  ...over,
})

test('selectJudgeCandidates: 规则判不出 + 作答 + 有参考的客观题入选', () => {
  const picked = selectJudgeCandidates([mk()])
  assert.equal(picked.length, 1)
})

test('selectJudgeCandidates: 已判出正误的不送裁', () => {
  assert.equal(selectJudgeCandidates([mk({ is_correct: true })]).length, 0)
  assert.equal(selectJudgeCandidates([mk({ is_correct: false })]).length, 0)
})

test('selectJudgeCandidates: 未作答（blank / 空 / 未作答文案）不送裁', () => {
  assert.equal(selectJudgeCandidates([mk({ answer_source: 'blank' })]).length, 0)
  assert.equal(selectJudgeCandidates([mk({ student_answer: '' })]).length, 0)
  assert.equal(selectJudgeCandidates([mk({ student_answer: '未作答' })]).length, 0)
})

test('selectJudgeCandidates: 无参考答案 / 开放题参考（证明略）不送裁', () => {
  assert.equal(selectJudgeCandidates([mk({ answer: '' })]).length, 0)
  assert.equal(selectJudgeCandidates([mk({ answer: '证明略' })]).length, 0)
  assert.equal(selectJudgeCandidates([mk({ answer: '答案不唯一' })]).length, 0)
})

test('selectJudgeCandidates: 主观题（解答）永不送裁，客观三题型可送', () => {
  assert.equal(selectJudgeCandidates([mk({ question_type: 'answer' })]).length, 0)
  assert.equal(selectJudgeCandidates([mk({ question_type: 'solve' })]).length, 0)
  assert.equal(selectJudgeCandidates([mk({ question_type: 'choice' })]).length, 1)
  assert.equal(selectJudgeCandidates([mk({ question_type: 'judge' })]).length, 1)
  assert.equal(selectJudgeCandidates([mk({ question_type: 'FILL' })]).length, 1) // 大小写宽容
})

test('selectJudgeCandidates: 已终裁过（_ai_judged）不重复送裁', () => {
  assert.equal(selectJudgeCandidates([mk({ _ai_judged: true })]).length, 0)
})

test('selectJudgeCandidates: 空列表 / null 元素安全', () => {
  assert.equal(selectJudgeCandidates([]).length, 0)
  assert.equal(selectJudgeCandidates([null, undefined]).length, 0)
})
