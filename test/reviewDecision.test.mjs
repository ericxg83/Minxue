import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REVIEW_STATUS,
  effectiveIsCorrect,
  isWrongResult,
  needsWrongBookDecision
} from '../src/workbench/utils/reviewDecision.js'

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