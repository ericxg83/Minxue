import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REVIEW_STATUS,
  effectiveIsCorrect,
  isWrongResult,
  needsWrongBookDecision,
  getReviewState,
  getReviewStateLabel,
  getUnjudgedReasonText
} from '../src/utils/reviewDecision.js'

test('AI 判错且未入册时需要教师决定', () => {
  const question = { is_correct: false, review_status: null }
  assert.equal(isWrongResult(question), true)
  assert.equal(needsWrongBookDecision(question, false), true)
  assert.equal(needsWrongBookDecision(question, true), false)
})

test('本次不入册保留错误事实并解除门禁', () => {
  const question = { is_correct: false, review_status: REVIEW_STATUS.WRONG_NO_BOOK }
  assert.equal(effectiveIsCorrect(question), false)
  assert.equal(needsWrongBookDecision(question, false), false)
})

test('排除题不进入最终正误统计', () => {
  const question = { is_correct: false, review_status: REVIEW_STATUS.EXCLUDE }
  assert.equal(effectiveIsCorrect(question), null)
  assert.equal(isWrongResult(question), false)
})

test('人工复核结果优先于 AI 结果', () => {
  assert.equal(effectiveIsCorrect({ is_correct: false, review_status: REVIEW_STATUS.CORRECT }), true)
  assert.equal(effectiveIsCorrect({ is_correct: true, review_status: REVIEW_STATUS.WRONG }), false)
})
// exception 桶必须区分"学生没写"与"AI 判不出"：后者答案已识别，
// 旧文案「未识别答案」会让老师误以为 OCR 故障。
test('未作答与 AI 判不出同属 exception 但文案不同', () => {
  const blank = { answer_source: 'blank', is_correct: null, confidence: 0 }
  const undecided = { answer_source: 'recognized', is_correct: null, confidence: 0.95 }
  assert.equal(getReviewState(blank), 'exception')
  assert.equal(getReviewState(undecided), 'exception')
  assert.equal(getReviewStateLabel(blank), '未作答')
  assert.equal(getReviewStateLabel(undecided), 'AI未判定')
})

test('尚未判定的题仍是处理中，不能算 AI 未判定', () => {
  const processing = { answer_source: 'recognized', is_correct: null, confidence: null }
  assert.equal(getReviewState(processing), 'processing')
  assert.equal(getReviewStateLabel(processing), '处理中')
})

// 「AI未判定」要告诉老师原因，否则老师只能把整卷重看一遍。
// 原因由后端写入 answer_exception_reason，展示层只读不推断。
test('AI未判定的题展示后端写入的原因', () => {
  const question = {
    is_correct: null,
    confidence: 0.95,
    answer_source: 'recognized',
    answer_exception_reason: '参考答案无法自动核对（含略/见解析/答案不唯一）'
  }
  assert.equal(getReviewStateLabel(question), 'AI未判定')
  assert.equal(getUnjudgedReasonText(question), '参考答案无法自动核对（含略/见解析/答案不唯一）')
})

test('未作答与已判定的题不显示原因', () => {
  // 未作答本身已经说明了一切，再叠原因会让老师以为系统故障
  assert.equal(getUnjudgedReasonText({
    is_correct: null, answer_source: 'blank', answer_exception_reason: '缺少参考答案，无法自动判定'
  }), '')
  // 判错的题不是"未判定"，不该显示未判定原因
  assert.equal(getUnjudgedReasonText({
    is_correct: false, confidence: 0.95, answer_source: 'recognized', answer_exception_reason: '缺少参考答案，无法自动判定'
  }), '')
  // 没有原因时返回空串而不是 undefined
  assert.equal(getUnjudgedReasonText({ is_correct: null, confidence: 0.9, answer_source: 'recognized' }), '')
})
