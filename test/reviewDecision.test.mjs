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

// 2026-09-02 用户报 #18/#25/#26 等多道填空题学生答案与参考答案字面一致却显示红 X。
// 根因：review_status='wrong'（老师之前复核过）会盖过 is_correct=true，原文案统一显示
// 「AI 错误」让老师误以为是判题逻辑 bug。要把 wrong state 拆出三种文案，让老师分清
// 「已复核（错误）」/「已复核·AI 翻案」/「AI 错误」。
test('wrong 状态文案细分：老师复核 vs AI 自动判错', () => {
  // 老师复核过标错 + AI 也判错 → 「已复核」（一致）
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG, is_correct: false, confidence: 0.95
  }), '已复核')
  // 老师复核过标错 + AI 现在判对 → 「已复核·AI 翻案」（冲突，老师应重新审视）
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG, is_correct: true, confidence: 0.95
  }), '已复核·AI 翻案')
  // 老师标记「不入错题本」 + AI 也判错 → 「已复核」
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG_NO_BOOK, is_correct: false, confidence: 0.95
  }), '已复核')
  // 老师标记「不入错题本」 + AI 现在判对 → 「已复核·AI 翻案」
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG_NO_BOOK, is_correct: true, confidence: 0.95
  }), '已复核·AI 翻案')
  // AI 自动判错 + 老师没复核 → 「AI 错误」（保留原语义）
  assert.equal(getReviewStateLabel({
    review_status: null, is_correct: false, confidence: 0.95
  }), 'AI错误')
  // AI 自动判错 + 老师标 correct → 走 correct 分支（wrong state 不命中）
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.CORRECT, is_correct: false, confidence: 0.95
  }), 'AI正确')
})
