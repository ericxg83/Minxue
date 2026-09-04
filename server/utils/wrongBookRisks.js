/**
 * 错题本入册风险 —— 后端唯一口径，GET 与 PUT 共用
 *
 * 用途：让复核页知道哪些题「会被错题本挡」，老师现场处理：
 *   · missing_figure  → is_complete=false，补配图后 rejudge 自动入
 *   · low_confidence  → conf<阈值，老师点 W 标错即可强入（skipConfidence）
 *
 * 与 addWrongQuestions 的过滤条件镜像；已入册的题返回空数组，
 * 避免 UI 显示「⚠ 低置信」但实际已经入错题本（老师强入过）的矛盾。
 *
 * @param {{is_correct, answer_source, answer, is_complete, confidence}} question
 * @param {boolean} inWrongBook
 * @param {number} threshold
 * @returns {('missing_figure'|'low_confidence')[]}
 */
export const computeWrongBookRisks = (question, inWrongBook, threshold) => {
  if (!question || inWrongBook) return []
  const isWrongish = question.is_correct === false || question.answer_source === 'blank'
  if (!isWrongish) return []
  if (!question.answer || !String(question.answer).trim()) return []

  const risks = []
  if (!question.is_complete) risks.push('missing_figure')
  if (question.confidence != null && Number(question.confidence) < threshold) {
    risks.push('low_confidence')
  }
  return risks
}
