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
// 2026-09-13（commit 14d9160）：未作答升级为独立终态 blank（answer_source='blank'），
// 不再归入 exception 桶、不需要老师逐题确认；「AI 判不出」仍留在 exception。
test('未作答是独立 blank 终态，与 AI 判不出（exception）分开', () => {
  const blank = { answer_source: 'blank', is_correct: null, confidence: 0 }
  const undecided = { answer_source: 'recognized', is_correct: null, confidence: 0.95 }
  assert.equal(getReviewState(blank), 'blank')
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
// 「已复核（错误）」/「已复核-AI翻案」/「AI 错误」。
test('wrong 状态文案细分：老师复核 vs AI 自动判错', () => {
  // 老师复核过标错 + AI 也判错 → 「已复核」（一致）
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG, is_correct: false, confidence: 0.95
  }), '已复核')
  // 老师复核过标错 + AI 现在判对 → 「已复核-AI翻案」（冲突，老师应重新审视）
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG, is_correct: true, confidence: 0.95
  }), '已复核-AI翻案')
  // 老师标记「不入错题本」 + AI 也判错 → 「已复核」
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG_NO_BOOK, is_correct: false, confidence: 0.95
  }), '已复核')
  // 老师标记「不入错题本」 + AI 现在判对 → 「已复核-AI翻案」
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.WRONG_NO_BOOK, is_correct: true, confidence: 0.95
  }), '已复核-AI翻案')
  // AI 自动判错 + 老师没复核 → 「AI 错误」（保留原语义）
  assert.equal(getReviewStateLabel({
    review_status: null, is_correct: false, confidence: 0.95
  }), 'AI判错')
})

// 2026-09-15 用户报障：批改页显示「学生 ±4 / 参考答案 ±2」但标签写「AI正确」。
// 根因：那条题 is_correct=false（AI 判错）+ review_status='correct'（老师改判做对了），
// 而 getReviewStateLabel 的 correct 分支没有像 wrong 那样细分，直接落回
// REVIEW_STATE_LABELS.correct =「AI正确」——把**人工复核的结论署了 AI 的名**，
// 老师自然会问「答案都不一样，AI 凭什么判对」。全库同类 81 条。
// 修法与 wrong 侧对称：人工推翻 AI 时写明是谁判的。
test('correct 状态文案细分：AI 判对 vs 人工改判为对（2026-09-15）', () => {
  // AI 判对 + 老师确认 → 「AI判对」（真·AI 判对，保留原语义）
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.CORRECT, is_correct: true, confidence: 0.95
  }), 'AI判对')
  // AI 判错 + 老师改判为对 → 「已复核-人工判对」（本次报障场景）
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.CORRECT, is_correct: false, confidence: 0.95
  }), '已复核-人工判对')
  // AI 没给结论（未判定）+ 老师判对 → 同样不能署 AI 的名
  assert.equal(getReviewStateLabel({
    review_status: REVIEW_STATUS.CORRECT, is_correct: null, confidence: 0.95
  }), '已复核-人工判对')
  // 只是 AI 判对、老师没碰过 → 仍是「AI判对」
  assert.equal(getReviewStateLabel({
    review_status: null, is_correct: true, confidence: 0.95
  }), 'AI判对')
})

// 复现 2026-09-15 用户截图的完整题目对象（题干：已知√(a-1)+√(b-5)=0，求 (a-b)² 的平方根；
// 正解 ±4，AI 生成的参考答案错成 ±2，学生答 ±4 被 AI 判错、老师复核改判为对）。
test('报障复现：学生 ±4 被错判，老师改判后显示「已复核-人工判对」而非 AI判对', () => {
  const question = {
    is_correct: false,
    review_status: REVIEW_STATUS.CORRECT,
    confidence: 0.95,
    student_answer: '±4',
    answer: '±2',
    answer_source: 'recognized'
  }
  assert.equal(getReviewStateLabel(question), '已复核-人工判对')
  // 判定结果本身不变：人工结论仍优先
  assert.equal(effectiveIsCorrect(question), true)
})
