/**
 * taskResultStats.js — 批改结果统计的**唯一口径**（2026-09-23 移动端误报「全对」事故沉淀）
 *
 * 事故：`/api/tasks/summary` 用 `result->>'wrong_count'`（下划线）取错题数，
 * 而 worker / recalculate-stats 写进 result 的是**驼峰** `wrongCount`。
 * 实测全库 164 条有 result 的任务：163 条有驼峰、0 条有下划线 ⇒ 接口恒返回 0
 * ⇒ 移动端「批改完成」通知永远走 `wrong === 0` 分支，一律宣「全部做对」，
 * 而同期真实错题数 1~8 道（15/15 条 done 任务都有错题）。
 *
 * 因此这里定两条铁律：
 *   ① **两种命名都认**：任何读 result 统计的地方都走 normalizeTaskStats，禁止裸取字段；
 *   ② **wrong=0 ≠ 全对**：错 / 空 / 待复核三桶互斥（同复核页「需处理」口径），
 *      空题与 AI 判不出的题不进 wrongCount，只看 wrong 会把它们静默算成「做对」；
 *      统计根本没落库（questionCount=0，如老重练答卷）时是 unknown，同样不许报全对。
 */
const toNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// result 里的统计键存在两套历史命名；summary 接口早期只认下划线，worker 只写驼峰。
const pick = (result, camel, snake) => {
  if (result?.[camel] !== undefined && result?.[camel] !== null) return toNum(result[camel])
  if (result?.[snake] !== undefined && result?.[snake] !== null) return toNum(result[snake])
  return 0
}

/**
 * 归一化一条任务的统计。入参可以是 task（读 task.result）或统计对象本身。
 */
export function normalizeTaskStats(source) {
  const result = source?.result && typeof source.result === 'object' ? source.result : (source || {})
  return {
    questionCount: pick(result, 'questionCount', 'question_count'),
    wrongCount: pick(result, 'wrongCount', 'wrong_count'),
    emptyCount: pick(result, 'emptyCount', 'empty_count'),
    pendingCount: pick(result, 'pendingCount', 'pending_count')
  }
}

/**
 * 结果成色：
 *   has-wrong    有错题
 *   needs-review 没错题但有空题 / 待复核 / 可能漏题 —— **不能说全对**
 *   all-correct  三桶全空且统计可信 —— 才允许说全对
 *   unknown      统计未落库（questionCount=0）—— 不许下任何结论
 */
export function resolveTaskResultTone(stats, { truncated = false } = {}) {
  const s = normalizeTaskStats(stats)
  if (s.questionCount <= 0) return 'unknown'
  if (s.wrongCount > 0) return 'has-wrong'
  if (s.emptyCount > 0 || s.pendingCount > 0 || truncated) return 'needs-review'
  return 'all-correct'
}

/**
 * 一行摘要（移动端作业列表用）。返回结构化片段，颜色由渲染层按 tone 决定，
 * 让「列表文案」和「通知文案」共用同一套判据，避免两处各写一遍再次漂移。
 */
export function describeTaskResult(stats, { truncated = false } = {}) {
  const s = normalizeTaskStats(stats)
  const tone = resolveTaskResultTone(s, { truncated })
  if (tone === 'all-correct') {
    return { tone, stats: s, parts: [{ key: 'total', label: `${s.questionCount} 道题全部正确`, tone: 'success' }] }
  }
  if (tone === 'unknown') {
    return { tone, stats: s, parts: [{ key: 'unknown', label: '批改完成', tone: 'neutral' }] }
  }
  const parts = []
  if (s.questionCount > 0) parts.push({ key: 'total', label: `共${s.questionCount}题`, tone: 'neutral' })
  if (s.wrongCount > 0) parts.push({ key: 'wrong', label: `错${s.wrongCount}`, tone: 'danger' })
  if (s.emptyCount > 0) parts.push({ key: 'empty', label: `空${s.emptyCount}`, tone: 'warning' })
  if (s.pendingCount > 0) parts.push({ key: 'pending', label: `待复核${s.pendingCount}`, tone: 'warning' })
  if (truncated) parts.push({ key: 'truncated', label: '可能有漏题', tone: 'warning' })
  return { tone, stats: s, parts }
}

/**
 * 移动端首页「上次作业」提醒卡文案。与通知同一判据：
 * 只有 all-correct 才说「表现不错」，有空题/待复核时改说「有题待确认」。
 */
export function buildLatestTaskReminder(task) {
  const s = normalizeTaskStats(task)
  const tone = resolveTaskResultTone(s)
  if (tone === 'has-wrong') {
    return { tone, title: `上次作业已批改 · ${s.wrongCount} 道错题`, detail: '去作业页查看被标出的题目和讲解' }
  }
  if (tone === 'needs-review') {
    const bits = []
    if (s.emptyCount > 0) bits.push(`${s.emptyCount} 道未作答`)
    if (s.pendingCount > 0) bits.push(`${s.pendingCount} 道待确认`)
    return { tone, title: '上次作业已批改 · 有题待确认', detail: `${bits.join('、')}，去作业页确认` }
  }
  if (tone === 'unknown') {
    return { tone, title: '上次作业已批改', detail: '去作业页查看批改结果' }
  }
  return { tone, title: '上次作业已批改，表现不错', detail: `${s.questionCount} 题全部正确，继续保持` }
}

/**
 * 移动端「批改完成」系统通知文案（notificationService 唯一来源）。
 * 只有 all-correct 才允许出现「全部做对」——这是本次事故的正面约束。
 */
export function buildGradingDoneNotification(task) {
  const name = task?.studentName || ''
  const subject = name ? `${name}的作业` : '作业'
  const s = normalizeTaskStats(task)
  const tone = resolveTaskResultTone(s)

  if (tone === 'has-wrong') {
    return { tone, title: `${subject}批改完成`, body: `本次作业有 ${s.wrongCount} 道错题，点此查看` }
  }
  if (tone === 'needs-review') {
    const bits = []
    if (s.emptyCount > 0) bits.push(`${s.emptyCount} 道未作答`)
    if (s.pendingCount > 0) bits.push(`${s.pendingCount} 道待确认`)
    const what = bits.length ? bits.join('、') : '部分题目需确认'
    return { tone, title: `${subject}批改完成`, body: `有 ${what}，点此查看` }
  }
  if (tone === 'unknown') {
    return { tone, title: `${subject}批改完成`, body: '点此查看批改结果' }
  }
  return { tone, title: `${subject}全部正确`, body: `本次 ${s.questionCount} 题全部做对，太棒了！` }
}
