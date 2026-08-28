/**
 * 批改结果分桶统计 —— 后端唯一口径
 *
 * 列表页摘要（错N/空N/待复核N）与复核页「需处理」计数必须同源，否则会出现
 * 列表写"7道题全部正确"、点进去却有 4 道待人工的情况：非空但 is_correct 为 null
 * 的题（答案库无匹配 / AI 给不出结论 / 置信度不足）既不进 wrongCount 也不进
 * emptyCount，于是被"无错无空 ⇒ 全对"的文案吞掉。
 *
 * 分桶顺序与阈值严格镜像前端 src/utils/reviewDecision.js 的 getReviewState，
 * 两端口径只允许有一份定义。
 */

// 与前端 DEFAULT_CONFIDENCE_THRESHOLD 保持一致
export const REVIEW_CONFIDENCE_THRESHOLD = 0.5

/**
 * 单题分桶。四桶互斥且穷尽，excluded 不计入总数。
 * @param {{is_correct?: boolean|null, answer_source?: string|null, review_status?: string|null, confidence?: number|string|null}} q
 * @returns {'excluded'|'correct'|'wrong'|'empty'|'pending'}
 */
export const classifyReviewBucket = (q, threshold = REVIEW_CONFIDENCE_THRESHOLD) => {
  if (!q) return 'pending'

  // 人工结论优先级最高
  if (q.review_status === 'exclude') return 'excluded'
  if (q.review_status === 'correct') return 'correct'
  if (q.review_status === 'wrong' || q.review_status === 'wrong_no_book') return 'wrong'

  // 未作答先于 is_correct 判定：一道 blank 题被 AI 判 false 时只能算"空"，
  // 否则同一行会同时命中 wrong 与 empty（旧 recalculate-stats 的双重计数）。
  if (q.answer_source === 'blank') return 'empty'

  // AI 给不出正误结论 → 待人工
  if (q.is_correct == null) return 'pending'

  if (q.is_correct === false) return 'wrong'

  const conf = q.confidence == null ? null : Number(q.confidence)
  if (conf != null && Number.isFinite(conf) && conf >= threshold) return 'correct'

  // 判"对"但置信度不足 → 仍需人工确认
  return 'pending'
}

/**
 * @param {Array} rows 题目行，需含 is_correct / answer_source / review_status / confidence
 * @returns {{questionCount:number, wrongCount:number, emptyCount:number, pendingCount:number, correctCount:number}}
 */
export const computeTaskStats = (rows, threshold = REVIEW_CONFIDENCE_THRESHOLD) => {
  const stats = { questionCount: 0, wrongCount: 0, emptyCount: 0, pendingCount: 0, correctCount: 0 }
  for (const q of Array.isArray(rows) ? rows : []) {
    const bucket = classifyReviewBucket(q, threshold)
    if (bucket === 'excluded') continue
    stats.questionCount++
    if (bucket === 'wrong') stats.wrongCount++
    else if (bucket === 'empty') stats.emptyCount++
    else if (bucket === 'pending') stats.pendingCount++
    else stats.correctCount++
  }
  return stats
}
