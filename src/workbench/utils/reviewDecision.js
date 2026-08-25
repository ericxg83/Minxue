export const REVIEW_STATUS = Object.freeze({
  CORRECT: 'correct',
  WRONG: 'wrong',
  EXCLUDE: 'exclude',
  WRONG_NO_BOOK: 'wrong_no_book'
})

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
