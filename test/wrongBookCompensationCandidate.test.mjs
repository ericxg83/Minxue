/**
 * 回归测试：compensateWrongBook 的候选判据（2026-09-23 P0）
 *
 * 锁定的事故：`hasUsableAnswer` 被直接用于候选过滤，把未作答(blank)题整体挡掉。
 * blank 题按设计没有参考答案，而「未作答等同不会」是本仓既定口径
 * （addWrongQuestions 显式把 blank 排除在置信度闸外）⇒ 该闸只误伤 blank。
 *
 * 实测证据（2026-09-23）：blank+判错+未入册 2/2 被挡；
 *                      非 blank 判错未入册 100/100 都有答案。
 *
 * 不许放宽的部分：
 *   · 非 blank 题仍然必须答案可用（保留"答案异步补齐"的原有修复意图）
 *   · 终态复核结论（correct/exclude/wrong_no_book）仍然不得再被自动补入
 *   · 置信度闸 / 完整性闸不在此处，仍在 addWrongQuestions 内生效（另有测试）
 */
import assert from 'node:assert/strict'
import test from 'node:test'

const { __candidateRules } = await import('../server/services/wrongBookCompensation.js')
const {
  isJudgedWrong,
  hasUsableAnswer,
  meetsAnswerRequirement,
  hasTerminalReview,
  PLACEHOLDER_ANSWERS
} = __candidateRules

// 复刻 compensateWrongBook 里 candidates 的那一行过滤
const passesCandidates = (q) =>
  isJudgedWrong(q) && meetsAnswerRequirement(q) && !hasTerminalReview(q)

const blankQ = (extra = {}) => ({
  id: 'b1', answer: null, answer_source: 'blank', is_correct: false,
  review_status: null, ...extra
})
const wrongQ = (extra = {}) => ({
  id: 'w1', answer: 'x=3', answer_source: 'recognized', is_correct: false,
  review_status: null, ...extra
})

test('blank 未作答题：即便没有参考答案，也必须能进候选（P0 修复点）', () => {
  const q = blankQ()
  assert.equal(isJudgedWrong(q), true, 'blank 属判错口径')
  assert.equal(hasUsableAnswer(q), false, 'blank 结构上没有参考答案')
  assert.equal(meetsAnswerRequirement(q), true, '★ blank 必须豁免答案闸')
  assert.equal(passesCandidates(q), true, '★ blank 必须能进候选')
})

test('blank 题：answer 为空字符串 / 占位文本 都不影响豁免', () => {
  for (const a of ['', '   ', null, undefined, ...PLACEHOLDER_ANSWERS]) {
    const q = blankQ({ answer: a })
    assert.equal(passesCandidates(q), true, `blank answer=${JSON.stringify(a)} 应放行`)
  }
})

test('非 blank 判错题：必须有可用参考答案（保留原「答案异步补齐」修复意图）', () => {
  assert.equal(passesCandidates(wrongQ({ answer: 'x=3' })), true, '有答案 → 放行')
  assert.equal(passesCandidates(wrongQ({ answer: null })), false, '无答案 → 仍挡（等补齐后对账）')
  assert.equal(passesCandidates(wrongQ({ answer: '' })), false, '空串 → 仍挡')
  assert.equal(passesCandidates(wrongQ({ answer: '   ' })), false, '纯空白 → 仍挡')
  for (const a of PLACEHOLDER_ANSWERS) {
    assert.equal(passesCandidates(wrongQ({ answer: a })), false, `占位答案 ${a} → 仍挡`)
  }
})

test('终态复核结论：任何情况下都不得被自动补入', () => {
  for (const st of ['correct', 'exclude', 'wrong_no_book']) {
    assert.equal(passesCandidates(blankQ({ review_status: st })), false, `blank + ${st} 应挡`)
    assert.equal(passesCandidates(wrongQ({ review_status: st })), false, `wrong + ${st} 应挡`)
  }
  // wrong 不是终态：老师标了"判错"仍可入册
  assert.equal(passesCandidates(wrongQ({ review_status: 'wrong' })), true)
  assert.equal(hasTerminalReview({ review_status: 'wrong' }), false)
})

test('未判错（判对 / 未判定）题不得进候选', () => {
  assert.equal(passesCandidates({ ...wrongQ(), is_correct: true }), false, '判对 → 不入册')
  assert.equal(passesCandidates({ ...wrongQ(), is_correct: null }), false, '未判定 → 不入册')
})

test('非 blank 且 is_correct=false 但 answer_source 是 worksheet/recognized 等：按非 blank 处理', () => {
  for (const src of ['recognized', 'worksheet', 'teacher_input']) {
    assert.equal(meetsAnswerRequirement({ answer_source: src, answer: 'A' }), true)
    assert.equal(meetsAnswerRequirement({ answer_source: src, answer: null }), false)
  }
})
