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

  // AI 异常：未识别答案 / OCR 失败
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
