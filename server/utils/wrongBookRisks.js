import { checkQuestionCompleteness } from './questionCompleteness.js'

/**
 * 错题本入册风险 —— 后端唯一口径，GET 与 PUT 共用
 *
 * 用途：让复核页知道哪些题「会被错题本挡」，老师现场处理：
 *   · missing_figure  → 题干引图但无配图，补配图后 rejudge 自动入
 *   · missing_options → 选择题无选项，点「编辑」补选项后自动入
 *   · invalid_type    → 题型缺失/非法，点「编辑」选定题型后自动入
 *   · low_confidence  → conf<阈值，老师点 W 标错即可强入（skipConfidence）
 *
 * 2026-09-11 修复：此前按 questions.is_complete 落库列判「缺图」，而该列是
 * 建题时算一次就落库的反范式缓存，答案/题型/配图后续补齐时不回写 → 长期偏旧。
 * 结果大量「题干无图、答案齐全」的题被误标「⚠ 缺图」（实测全站 346 条
 * is_complete=false 中 267 条题干根本没有图引用）。
 * 现在统一走 checkQuestionCompleteness() 动态现算（与 addWrongQuestions 判定同源），
 * 并把四种缺项拆成独立标签，不再共用一个「缺图」筐。
 *
 * 与 addWrongQuestions 的过滤条件镜像；已入册的题返回空数组，
 * 避免 UI 显示「⚠ 低置信」但实际已经入错题本（老师强入过）的矛盾。
 *
 * @param {{is_correct, answer_source, answer, content, question_type, options,
 *          geometry_image_url, confidence}} question 必须传「已合并缓存字段」的题，
 *         否则题型/答案取不到会误判缺项
 * @param {boolean} inWrongBook
 * @param {number} threshold
 * @returns {('missing_figure'|'missing_options'|'invalid_type'|'low_confidence')[]}
 */
export const computeWrongBookRisks = (question, inWrongBook, threshold) => {
  if (!question || inWrongBook) return []
  const isWrongish = question.is_correct === false || question.answer_source === 'blank'
  if (!isWrongish) return []
  // 无参考答案时批改流程根本不会尝试入册，此时不展示风险标签（沿用既有语义）。
  // 注意：不要在去掉这个门禁前把 missing_answer 加进返回值，否则会一次性
  // 给大量「还没抽到答案」的题刷上标签，反而制造新的噪音。
  if (!question.answer || !String(question.answer).trim()) return []

  const risks = []
  // 动态口径现算：不读 is_complete 落库列
  const { codes } = checkQuestionCompleteness(question)
  for (const code of codes) {
    if (code === 'missing_answer') continue // 上一行门禁已提前返回，这里只做防御
    risks.push(code)
  }
  if (question.confidence != null && Number(question.confidence) < threshold) {
    risks.push('low_confidence')
  }
  return risks
}
