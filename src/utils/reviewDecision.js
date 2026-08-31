/**
 * 人工复核判定的唯一真相来源（移动端 React + PC 端 Vue 共用）
 *
 * 判定语义曾在两端各自实现，阈值不同（移动端 0.9 / PC 端 0.5），
 * 导致同一道题在手机上显示「待人工复核」而在 PC 上显示「AI正确」。
 * 状态判定与阈值必须只有一份实现。
 */

export const REVIEW_STATUS = Object.freeze({
  CORRECT: 'correct',
  WRONG: 'wrong',
  EXCLUDE: 'exclude',
  WRONG_NO_BOOK: 'wrong_no_book'
})

// 低于此置信度的 AI 判定需要人工确认
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.5

export const WRONG_BOOK_SKIP_REASONS = Object.freeze([
  { value: 'image_polluted', label: '图片污染或无法辨认' },
  { value: 'recognition_error', label: 'OCR 或题目识别错误' },
  { value: 'duplicate', label: '重复题' },
  { value: 'low_training_value', label: '暂无训练价值' },
  { value: 'other', label: '其他原因' }
])

export const isWrongResult = question =>
  question?.review_status === REVIEW_STATUS.WRONG ||
  question?.review_status === REVIEW_STATUS.WRONG_NO_BOOK ||
  (question?.review_status == null && question?.is_correct === false)

export const needsWrongBookDecision = (question, isInBook) =>
  isWrongResult(question) &&
  question?.review_status !== REVIEW_STATUS.WRONG_NO_BOOK &&
  !isInBook

export const effectiveIsCorrect = question => {
  if (question?.review_status === REVIEW_STATUS.CORRECT) return true
  if (
    question?.review_status === REVIEW_STATUS.WRONG ||
    question?.review_status === REVIEW_STATUS.WRONG_NO_BOOK
  ) return false
  if (question?.review_status === REVIEW_STATUS.EXCLUDE) return null
  return question?.is_correct ?? null
}

// 错题记录的生命周期终态。与 PC 端 lifecycleStore 的同名取值保持一致——
// 人工复核「其实做对了」必须是标记已掌握、保留错误次数与练习次数，
// 而不是把记录删掉：删掉等于这题从没错过，学习轨迹消失且再也不会进重练池。
export const WRONG_BOOK_LIFECYCLE = Object.freeze({
  MASTERED: 'mastered',
  EXCLUDED: 'excluded'
})

/**
 * 题目的复核状态（5 态，两端同源）
 * @returns {'correct'|'wrong'|'pending'|'exception'|'processing'}
 */
export const getReviewState = (question, threshold = DEFAULT_CONFIDENCE_THRESHOLD) => {
  if (!question) return 'processing'

  // 人工已复核 → 以人工结论为最高优先级
  if (question.review_status === REVIEW_STATUS.CORRECT) return 'correct'
  if (
    question.review_status === REVIEW_STATUS.WRONG ||
    question.review_status === REVIEW_STATUS.WRONG_NO_BOOK
  ) return 'wrong'

  // exception 桶：AI 没有给出正误结论。两种来源——学生未作答（answer_source='blank'）
  // 与"答案已识别但 AI 判不出"。文案必须按 answer_source 区分，见 getReviewStateLabel。
  if (question.answer_source === 'blank') return 'exception'

  // 处理中：AI 尚未出任何判定
  if (question.is_correct == null && question.confidence == null) return 'processing'

  // AI 异常：已经判过（有置信度）但给不出正误结论
  if (question.is_correct == null) return 'exception'

  // AI 错误：判定学生答案错误
  if (question.is_correct === false) return 'wrong'

  // AI 正确 + 已确认（人工复核 或 置信度达标）
  const manual = !!question.review_status
  const confirmed = manual || (question.confidence != null && question.confidence >= threshold)
  if (question.is_correct === true && confirmed) return 'correct'

  // 其余 → 待复核（置信度不足 / AI 不确定）
  return 'pending'
}

export const isExcluded = question => question?.review_status === REVIEW_STATUS.EXCLUDE

// 5 态的展示文案唯一真相来源（移动端 React + PC 端 Vue 共用）。
// exception 只是"AI 没给出正误结论"，不代表 OCR 失败——旧文案「未识别答案」会让老师
// 在学生答案明明已识别出来时误判为识别故障，因此聚合桶统一叫「AI未判定」。
export const REVIEW_STATE_LABELS = Object.freeze({
  correct: 'AI正确',
  wrong: 'AI错误',
  pending: '待复核',
  exception: 'AI未判定',
  processing: '处理中'
})

/**
 * 单题的展示文案。exception 按 answer_source 细分：
 *   · blank      → 未作答（学生没写，OCR 没有可判内容）
 *   · 其他       → AI未判定（答案已识别，AI 拒绝给结论，需老师定）
 */
export const getReviewStateLabel = (question, threshold = DEFAULT_CONFIDENCE_THRESHOLD) => {
  const state = getReviewState(question, threshold)
  if (state === 'exception' && question?.answer_source === 'blank') return '未作答'
  return REVIEW_STATE_LABELS[state] || REVIEW_STATE_LABELS.pending
}

/**
 * 「AI未判定」的原因说明，供老师知道为什么这题要自己定。
 *
 * 原因由后端判题管线写入 questions.answer_exception_reason（复用既有列），
 * 是纯观测标注：展示层只读它，绝不用它推断正误 —— 正误只看 is_correct。
 * 只在 exception 状态且学生确实作答了的题上显示；未作答本身已经说明了一切。
 */
export const getUnjudgedReasonText = (question, threshold = DEFAULT_CONFIDENCE_THRESHOLD) => {
  if (getReviewState(question, threshold) !== 'exception') return ''
  if (question?.answer_source === 'blank') return ''
  const reason = question?.answer_exception_reason
  return typeof reason === 'string' ? reason.trim() : ''
}

/**
 * 「AI 答案存疑」提示 —— 与 exception 不同：AI 已给出正误，但参考本身
 * 可能不可靠（图题视觉推理不擅长等）。
 *
 * 后端判题管线把 reason 写入 questions.ai_answer_risk_reason（独立列）。
 * 即使在 wrong 状态也展示给老师，避免老师把"AI 错误"信以为真。
 * 纯观测标注，不参与任何判定。
 */
export const getAiAnswerRiskText = (question) => {
  const reason = question?.ai_answer_risk_reason
  return typeof reason === 'string' ? reason.trim() : ''
}
