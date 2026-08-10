import { query, TABLES } from '../config/neon.js'

// ============================================================
// 薄弱点推荐服务（weaknessService）
//
// 职责：
//   1. 按学生维度：找出该学生掌握度最低的知识点列表
//   2. 跨学生维度：找出全班/全年级最普遍薄弱的知识点
//   3. 推荐「本周最该讲」的知识点（按掌握度排序 + 涉及人数）
// ============================================================

const WEAK_THRESHOLD = 60  // 掌握度 < 60 视为薄弱
const URGENT_THRESHOLD = 30 // 掌握度 < 30 视为紧急

/**
 * 获取单个学生的薄弱知识点。
 * @param {string} studentId
 * @param {Object} [opts]
 * @param {number} [opts.limit] 返回条数，默认 10
 * @param {number} [opts.threshold] 掌握度阈值，默认 60
 * @returns {Promise<Array<{kpId, name, level, subject, mastery, totalQuestions, wrongQuestions, lastPracticedAt}>>}
 */
export async function getStudentWeakness(studentId, opts = {}) {
  const { limit = 10, threshold = WEAK_THRESHOLD } = opts
  if (!studentId) return []

  const { rows } = await query(
    `SELECT
      km.kp_id, kp.name, kp.level, kp.subject,
      km.mastery, km.total_questions, km.wrong_questions,
      km.consecutive_correct, km.last_practiced_at, km.updated_at
    FROM ${TABLES.KNOWLEDGE_MASTERY} km
    JOIN ${TABLES.KNOWLEDGE_POINTS} kp ON kp.id = km.kp_id
    WHERE km.student_id = $1
      AND km.mastery < $2
      AND km.total_questions > 0
    ORDER BY km.mastery ASC, km.total_questions DESC
    LIMIT $3`,
    [studentId, threshold, limit]
  )

  return rows.map(r => ({
    kpId: r.kp_id,
    name: r.name,
    level: r.level,
    subject: r.subject,
    mastery: Math.round(r.mastery),
    totalQuestions: r.total_questions,
    wrongQuestions: r.wrong_questions,
    consecutiveCorrect: r.consecutive_correct,
    lastPracticedAt: r.last_practiced_at,
    isUrgent: r.mastery < URGENT_THRESHOLD,
  }))
}

/**
 * 获取跨学生维度的薄弱知识点（全班/全年级）。
 * 按掌握度均值升序排列，同时返回涉及学生数。
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit] 返回条数，默认 15
 * @param {number} [opts.threshold] 平均掌握度阈值，默认 60
 * @param {string} [opts.subject] 学科过滤
 * @returns {Promise<Array<{kpId, name, level, subject, avgMastery, studentCount, avgWrongCount}>>}
 */
export async function getClassWeakness(opts = {}) {
  const { limit = 15, threshold = WEAK_THRESHOLD, subject = null } = opts

  const params = [threshold]
  let subjectClause = ''
  if (subject) {
    params.push(subject)
    subjectClause = ` AND kp.subject = $${params.length}`
  }
  params.push(limit)

  const { rows } = await query(
    `SELECT
      km.kp_id, kp.name, kp.level, kp.subject,
      ROUND(AVG(km.mastery))::int AS avg_mastery,
      COUNT(DISTINCT km.student_id)::int AS student_count,
      ROUND(AVG(km.wrong_questions))::int AS avg_wrong_count
    FROM ${TABLES.KNOWLEDGE_MASTERY} km
    JOIN ${TABLES.KNOWLEDGE_POINTS} kp ON kp.id = km.kp_id
    WHERE km.mastery < $1
      AND km.total_questions > 0
      ${subjectClause}
    GROUP BY km.kp_id, kp.name, kp.level, kp.subject
    ORDER BY avg_mastery ASC, student_count DESC
    LIMIT $${params.length}`,
    params
  )

  return rows.map(r => ({
    kpId: r.kp_id,
    name: r.name,
    level: r.level,
    subject: r.subject,
    avgMastery: r.avg_mastery,
    studentCount: r.student_count,
    avgWrongCount: r.avg_wrong_count,
    isUrgent: r.avg_mastery < URGENT_THRESHOLD,
  }))
}

/**
 * 生成「本周最该讲的知识点」推荐列表。
 * 结合全班薄弱数据和单个学生维度，按优先级排序。
 *
 * 优先级规则：
 *   1. 紧急（avgMastery < 30）→ 优先
 *   2. 涉及学生多的 → 优先
 *   3. 平均掌握度低的 → 优先
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit]
 * @param {string} [opts.subject]
 * @returns {Promise<Array<{name, subject, avgMastery, studentCount, priority, reason}>>}
 */
export async function getRecommendedTopics(opts = {}) {
  const { limit = 10, subject = null } = opts

  const weakness = await getClassWeakness({ limit: 50, subject })

  // 优先级打分
  const scored = weakness.map(w => {
    let priority = 0
    // 紧急程度：avgMastery < 30 加 50 分
    if (w.avgMastery < URGENT_THRESHOLD) priority += 50
    // 平均掌握度越低分越高（0-40 分）
    priority += Math.max(0, 40 - w.avgMastery)
    // 涉及学生多加分（0-30 分）
    priority += Math.min(30, (w.studentCount || 0) * 3)
    // 级别加权：level 0-1 的基本知识点更基础，加 10 分
    if (w.level <= 1) priority += 10

    return {
      ...w,
      priority,
      reason: buildReason(w),
    }
  })

  // 按优先级降序
  scored.sort((a, b) => b.priority - a.priority)

  return scored.slice(0, limit)
}

function buildReason(w) {
  const parts = []
  if (w.avgMastery < URGENT_THRESHOLD) {
    parts.push('紧急薄弱')
  }
  if (w.studentCount >= 5) {
    parts.push(`${w.studentCount} 人共性问题`)
  } else if (w.studentCount >= 2) {
    parts.push(`${w.studentCount} 人薄弱`)
  }
  if (w.avgWrongCount >= 5) {
    parts.push(`平均错 ${w.avgWrongCount} 题`)
  }
  return parts.length > 0 ? parts.join('，') : '需巩固'
}

export { WEAK_THRESHOLD, URGENT_THRESHOLD }