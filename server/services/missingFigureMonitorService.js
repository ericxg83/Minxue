/**
 * 缺图监控 —— 每周统计 + 趋势查询
 *
 * 目的：数据驱动决策「要不要做工程优化」。当前缺图题靠老师 PC 端复核补图消化；
 * 若某周 wrong_book_blocked 激增（≥5），说明 AI 视觉模型退化或某题型集中爆发，
 * 此时再启动作图题分类 / prompt 调优才有 ROI 依据。
 *
 * 三个指标：
 *   · refs_fig_incomplete  题干含"如图"但 is_complete=false —— 视觉模型漏检候选
 *   · wrong_book_blocked   会被错题本挡的错题/空答 —— 真正影响学生体验的数
 *   · blocked_other        is_complete=true 但未入 —— 旧 task 软删 / 低 conf 等对照
 *
 * cron：每周日 23:17 跑一次（错开夜间任务），结果写日志。
 * API：/api/diagnostics/weekly-missing-figures?weeks=8 随时查趋势。
 */
import { query, TABLES } from '../config/neon.js'

const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 计算距今 weeks 周前的起点（按周一 00:00 UTC 对齐，避免跨周分桶抖动）
const weeksAgoStart = (weeks) => {
  const now = new Date()
  const start = new Date(now.getTime() - weeks * 7 * 24 * 3600 * 1000)
  // 回退到该周的周一 UTC 00:00
  const day = start.getUTCDay()
  const diff = (day === 0 ? -6 : 1) - day
  start.setUTCDate(start.getUTCDate() + diff)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

/**
 * 按周聚合的缺图统计。weeks=8 表示回看 8 周。
 * @param {number} weeks
 * @returns {Promise<Array<{week_start:string, total_questions:number, refs_fig_incomplete:number, wrong_book_blocked:number, blocked_other:number}>>}
 */
export const getWeeklyMissingFigureStats = async (weeks = 8) => {
  const startDate = weeksAgoStart(weeks)
  const { rows } = await query(
    `SELECT
      date_trunc('week', q.created_at)::date AS week_start,
      COUNT(*)::int AS total_questions,
      COUNT(*) FILTER (
        WHERE q.is_complete = FALSE
          AND (q.content LIKE '%如图%' OR q.content LIKE '%图示%' OR q.content LIKE '%附图%' OR q.content LIKE '%见图%')
      )::int AS refs_fig_incomplete,
      COUNT(*) FILTER (
        WHERE (q.is_correct = FALSE OR q.answer_source = 'blank')
          AND q.is_complete = FALSE
          AND q.answer IS NOT NULL AND q.answer != ''
          AND q.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM ${TABLES.WRONG_QUESTIONS} wq WHERE wq.question_id = q.id)
      )::int AS wrong_book_blocked,
      COUNT(*) FILTER (
        WHERE (q.is_correct = FALSE OR q.answer_source = 'blank')
          AND q.is_complete = TRUE
          AND q.answer IS NOT NULL AND q.answer != ''
          AND q.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM ${TABLES.WRONG_QUESTIONS} wq WHERE wq.question_id = q.id)
      )::int AS blocked_other
    FROM ${TABLES.QUESTIONS} q
    WHERE q.deleted_at IS NULL
      AND q.created_at >= $1::timestamptz
    GROUP BY date_trunc('week', q.created_at)
    ORDER BY week_start DESC`,
    [startDate]
  )
  return rows
}

let _running = false
const runWeeklyCheck = async ({ trigger = 'scheduled' } = {}) => {
  if (_running) return { skipped: true }
  _running = true
  try {
    const stats = await getWeeklyMissingFigureStats(8)
    if (stats.length === 0) {
      console.log(`[缺图监控] (${trigger}) 近 8 周无批改数据`)
      return { stats: [] }
    }
    console.log(`\n[缺图监控] (${trigger}) 近 8 周趋势 (按批改创建周)：`)
    console.log('  周一日期    总题数  题干引用图未补  错题本被挡(缺图)  其他未入')
    let currentWeekBlocked = 0
    for (const row of stats) {
      const date = new Date(row.week_start).toISOString().slice(0, 10)
      console.log(`  ${date}  ${String(row.total_questions).padStart(5)}  ${String(row.refs_fig_incomplete).padStart(12)}            ${String(row.wrong_book_blocked).padStart(10)}           ${String(row.blocked_other).padStart(7)}`)
      // 最新一周（stats[0]）就是本周（含进行中）
      if (row === stats[0]) currentWeekBlocked = row.wrong_book_blocked
    }
    if (currentWeekBlocked >= 5) {
      console.warn(`[缺图监控] ⚠️ 本周错题本被挡 ${currentWeekBlocked} 道 (阈值 5)，建议评估：作图题分类 / prompt 调优`)
    } else if (currentWeekBlocked > 0) {
      console.log(`[缺图监控] 本周 ${currentWeekBlocked} 道被挡，老师复核补图可消化，无需工程介入`)
    } else {
      console.log('[缺图监控] 本周 0 道被挡')
    }
    return { stats }
  } catch (e) {
    console.error(`[缺图监控] (${trigger}) 异常:`, e.message)
    throw e
  } finally {
    _running = false
  }
}

export { runWeeklyCheck as runWeeklyMissingFigureCheck }

/**
 * 计算距下一个「周日 23:17」(本地时区)的毫秒数。
 * 选周日 23:17：一周收尾,且错开夜间 01:23 的 MinxueNightParse 配额竞争。
 */
function msUntilNextSundayLate() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 17, 0, 0)
  let diffDay = (0 - now.getDay() + 7) % 7 // 0=周日
  if (diffDay === 0 && next <= now) diffDay = 7
  next.setDate(next.getDate() + diffDay)
  return next - now
}

export function scheduleWeeklyMissingFigureCheck() {
  const enabled = !/^(0|false|off)$/i.test(String(process.env.MISSING_FIGURE_MONITOR_ENABLED || ''))
  if (!enabled) {
    console.log('📊 缺图监控：已通过 MISSING_FIGURE_MONITOR_ENABLED 关闭')
    return
  }
  const arm = () => {
    const delay = msUntilNextSundayLate()
    const timer = setTimeout(async () => {
      try { await runWeeklyCheck({ trigger: 'scheduled' }) } catch (e) { /* 已在 runWeeklyCheck 内 log */ }
      arm()
    }, delay)
    timer.unref?.()
    const nextTime = new Date(Date.now() + delay)
    console.log(`📊 缺图监控：已排程下次 ${DAY_LABELS[nextTime.getDay()]} ${nextTime.toLocaleString('zh-CN', { hour12: false })}`)
  }
  arm()
}
