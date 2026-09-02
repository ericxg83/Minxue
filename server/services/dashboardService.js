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