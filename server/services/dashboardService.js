import { query, TABLES } from '../config/neon.js'

/**
 * Dashboard 专用：班级 actionable 学生 Top 5（待关注学生升级版）。
 *
 * 返回原始计数（weak_count / repeat_count / total_error_count / recent_wrong_count），
 * 由前端按 actionable 优先级分类（补漏 / 预警 / 清理 / 反复错）。
 *
 * 排序：
 *   1. 补漏候选（weak_count >= 3）优先
 *   2. 清理候选（repeat_count >= 1）
 *   3. 反复错（total_error_count >= 2 或 recent_wrong_count >= 3）
 *
 * @returns {Promise<Array<{id, name, grade, weakCount, repeatCount, totalErrorCount, recentWrongCount}>>}
 */
export async function getAttentionStudents(limit = 5) {
  const { rows } = await query(
    `SELECT
      s.id, s.name, s.grade,
      COALESCE(km.weak_count, 0)::int AS weak_count,
      COALESCE(wq.repeat_count, 0)::int AS repeat_count,
      COALESCE((SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = s.id), 0) AS total_error_count,
      COALESCE((SELECT COUNT(*)::int FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = s.id AND last_wrong_at >= NOW() - INTERVAL '7 days'), 0) AS recent_wrong_count
    FROM ${TABLES.STUDENTS} s
    LEFT JOIN (
      SELECT student_id, COUNT(*) AS weak_count
      FROM ${TABLES.KNOWLEDGE_MASTERY}
      WHERE mastery < 60 AND total_questions >= 2
      GROUP BY student_id
    ) km ON km.student_id = s.id
    LEFT JOIN (
      SELECT student_id, COUNT(*) AS repeat_count
      FROM ${TABLES.WRONG_QUESTIONS}
      WHERE error_count >= 3
      GROUP BY student_id
    ) wq ON wq.student_id = s.id
    WHERE s.enrollment_status IS NULL OR s.enrollment_status != 'paused'
    ORDER BY
      CASE WHEN COALESCE(km.weak_count, 0) >= 3 THEN 0 ELSE 1 END,
      COALESCE(km.weak_count, 0) DESC,
      COALESCE(wq.repeat_count, 0) DESC,
      COALESCE((SELECT SUM(error_count)::int FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = s.id), 0) DESC
    LIMIT $1`,
    [limit]
  )

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    grade: r.grade,
    weakCount: r.weak_count,
    repeatCount: r.repeat_count,
    totalErrorCount: r.total_error_count,
    recentWrongCount: r.recent_wrong_count
  }))
}

/**
 * Dashboard 专用：近 N 日「作业量 + 新增错题」双序列（首页趋势图数据源）。
 *
 * 只读聚合，不触碰批改/错题写流程。按教师本地时区（Asia/Shanghai）切分自然日，
 * 与 summary 的 today_new_wrong 口径一致（added_at 落当日）。
 * 缺日补 0，保证前端 X 轴固定 N 个刻度。
 *
 * @param {number} [days=7] 统计天数（含今日）
 * @returns {Promise<Array<{date: string, tasksDone: number, newWrong: number}>>}
 */
export async function getDailyTrend(days = 7) {
  const span = Math.min(Math.max(parseInt(days, 10) || 7, 1), 30)
  // 下界放宽 1 天，吸收本地时区与 UTC 的偏移，确保窗口覆盖最早一个自然日
  const lower = span + 1

  const [{ rows: taskRows }, { rows: wrongRows }] = await Promise.all([
    query(
      `SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
              COUNT(*)::int AS n
       FROM ${TABLES.TASKS}
       WHERE deleted_at IS NULL
         AND status IN ('done', 'reviewed')
         AND created_at >= NOW() - make_interval(days => $1::int)
       GROUP BY day`,
      [lower]
    ),
    query(
      `SELECT (added_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
              COUNT(*)::int AS n
       FROM ${TABLES.WRONG_QUESTIONS}
       WHERE added_at >= NOW() - make_interval(days => $1::int)
       GROUP BY day`,
      [lower]
    )
  ])

  const taskMap = new Map(taskRows.map(r => [String(r.day), r.n]))
  const wrongMap = new Map(wrongRows.map(r => [String(r.day), r.n]))

  // 用与后端一致的 Asia/Shanghai 日历生成固定长度序列，避免服务器/浏览器时区漂移
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })
  const series = []
  for (let i = span - 1; i >= 0; i--) {
    const d = fmt.format(new Date(Date.now() - i * 24 * 60 * 60 * 1000))
    series.push({ date: d, tasksDone: taskMap.get(d) || 0, newWrong: wrongMap.get(d) || 0 })
  }
  return series
}