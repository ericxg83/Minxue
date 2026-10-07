import { query, TABLES } from '../config/neon.js'
import { getPrerequisitesForMany } from './kpRelationService.js'

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

  const out = rows.map(r => ({
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
    prerequisites: [],
  }))

  // 带上「前置考点」：错在这里，根子可能在更早的知识上。
  // ⛔ 只取 status='confirmed' 的关系（候选里有约 1/3 讲不通，见 kpRelationService 注释）。
  //    查不到就是空数组 —— 前端只在非空时显示，不留白块。
  if (out.length) {
    try {
      const preMap = await getPrerequisitesForMany(out.map(r => r.kpId))
      for (const r of out) r.prerequisites = preMap.get(r.kpId) || []
    } catch (e) {
      console.warn('  ⚠️ [weakness] 前置关系查询失败（不影响薄弱点本身）:', e.message)
    }
  }
  return out
}

/**
 * 定向重练卷组卷口径：按考点（**含子考点**）取该生「待重练」错题的 question_id。
 *
 * 为什么要有它（2026-10-07 负责人拍板）：
 *   卡片按钮写着「生成定向重练卷」，但前端原先只按 `wq.subject === point.subject`
 *   过滤 —— 组出来的是「该学科全部待重练错题」，跟按钮上那个考点没有关系。
 *   现在收敛为真·定向：只取该考点**及其子考点**下挂的题。
 *
 * ⛔ 口径（与重练卷红线一致）：
 *   - 只用学生**真实做错**的题（wrong_questions 行）；变式题 / AI 生成题一律不进；
 *   - question_id 为空的练习册自包含错题取不到（没有 question_knowledge 关联），
 *     与组卷出口 toExamQuestionIds 的排除口径一致；
 *   - 排除 lifecycle_status='mastered'（已完全掌握的不再重练）；
 *   - 子考点展开带 depth 上限，防止脏父子链导致查询不收敛。
 *   - 同一道题被记多条错题行时按 question_id 去重（否则卷面会出现重复题）。
 *
 * @param {string} studentId
 * @param {string[]} kpIds 考点 id（通常一个薄弱考点；前置考点也走同一口径）
 * @param {{limit?: number}} [opts]
 * @returns {Promise<string[]>} question_id 列表（按错题入册时间倒序）
 */
export async function getRetryQuestionIdsByKp(studentId, kpIds, opts = {}) {
  const ids = (kpIds || []).filter(Boolean)
  if (!studentId || ids.length === 0) return []
  const limit = Math.min(Math.max(Number(opts.limit) || 300, 1), 500)

  const { rows } = await query(
    `WITH RECURSIVE sub AS (
        SELECT id, 1 AS depth FROM ${TABLES.KNOWLEDGE_POINTS} WHERE id = ANY($2::uuid[])
        UNION ALL
        SELECT k.id, s.depth + 1
          FROM ${TABLES.KNOWLEDGE_POINTS} k
          JOIN sub s ON k.parent_id = s.id
         WHERE s.depth < 8
     )
     SELECT wq.question_id
       FROM ${TABLES.WRONG_QUESTIONS} wq
      WHERE wq.student_id = $1
        AND wq.question_id IS NOT NULL
        AND COALESCE(wq.lifecycle_status, 'new') <> 'mastered'
        AND EXISTS (
          SELECT 1 FROM ${TABLES.QUESTION_KNOWLEDGE} qk
           WHERE qk.question_id = wq.question_id
             AND qk.kp_id IN (SELECT id FROM sub)
        )
      ORDER BY wq.added_at DESC
      LIMIT $3`,
    [studentId, ids, limit]
  )
  return [...new Set(rows.map(r => r.question_id))]
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
      COUNT(DISTINCT s.grade) FILTER (WHERE s.grade IS NOT NULL AND s.grade <> '')::int AS grade_span,
      ROUND(AVG(km.wrong_questions))::int AS avg_wrong_count
    FROM ${TABLES.KNOWLEDGE_MASTERY} km
    JOIN ${TABLES.KNOWLEDGE_POINTS} kp ON kp.id = km.kp_id
    JOIN ${TABLES.STUDENTS} s ON s.id = km.student_id
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
    gradeSpan: r.grade_span,
    avgWrongCount: r.avg_wrong_count,
    isUrgent: r.avg_mastery < URGENT_THRESHOLD,
  }))
}

/**
 * Dashboard 专用：班级薄弱知识点 Top N，按「未掌握人数」优先排序。
 *
 * 与 getClassWeakness 的差别：
 *   - 排序：未掌握人数 DESC → 跨年级数 DESC → 平均掌握度 ASC
 *     （getClassWeakness 偏"最薄弱"，本函数偏"今天优先讲什么"）
 *   - limit：默认 5（Dashboard 摘要卡片用）
 *   - 必返回 gradeSpan（Dashboard 行内展示"跨 N 个年级"标签用）
 *
 * @param {Object} [opts]
 * @param {number} [opts.limit] 返回条数，默认 5
 * @param {string} [opts.subject] 学科过滤
 * @returns {Promise<Array<{kpId, name, level, subject, avgMastery, studentCount, gradeSpan, isUrgent}>>}
 */
export async function getDashboardClassWeakness(opts = {}) {
  const { limit = 5, subject = null } = opts

  // $1 固定为 WEAK_THRESHOLD；subject / limit 用递增位置避免占位符冲突
  let nextIdx = 1
  let subjectClause = ''
  const params = []
  if (subject) {
    nextIdx++
    params.push(subject)
    subjectClause = ` AND kp.subject = $${nextIdx}`
  }
  nextIdx++
  params.push(limit)

  const { rows } = await query(
    `SELECT
      km.kp_id, kp.name, kp.level, kp.subject,
      ROUND(AVG(km.mastery))::int AS avg_mastery,
      COUNT(DISTINCT km.student_id)::int AS student_count,
      COUNT(DISTINCT s.grade) FILTER (WHERE s.grade IS NOT NULL AND s.grade <> '')::int AS grade_span
    FROM ${TABLES.KNOWLEDGE_MASTERY} km
    JOIN ${TABLES.KNOWLEDGE_POINTS} kp ON kp.id = km.kp_id
    JOIN ${TABLES.STUDENTS} s ON s.id = km.student_id
    WHERE km.mastery < $1
      AND km.total_questions >= 2
      ${subjectClause}
    GROUP BY km.kp_id, kp.name, kp.level, kp.subject
    ORDER BY student_count DESC, grade_span DESC, avg_mastery ASC
    LIMIT $${nextIdx}`,
    [WEAK_THRESHOLD, ...params]
  )

  return rows.map(r => ({
    kpId: r.kp_id,
    name: r.name,
    level: r.level,
    subject: r.subject,
    avgMastery: r.avg_mastery,
    studentCount: r.student_count,
    gradeSpan: r.grade_span,
    isUrgent: r.avg_mastery < URGENT_THRESHOLD,
  }))
}

/**
 * Dashboard 专用：本周重练效果 4 个数字（完全掌握率 / 基本掌握率 / 进行中 / 待重练学生）。
 *
 * 口径（2026-09-13 队列分层定稿，两级掌握拆分）：
 *   - 完全掌握率 %：lifecycle_status = 'mastered'（累计答对 2 次，含周回顾验证）的比例
 *   - 基本掌握率 %：lifecycle_status = 'review_1'（累计答对 1 次，待周回顾二次验证）的比例
 *     （review_2 为历史残留枚举，按 review_1 语义计入基本掌握）
 *   - 进行中 N：已批改待教师处理的重练卷数（generated_exams 关联的 task 仍在批改/批改完未读）
 *   - 待重练学生 M：lifecycle_status IN ('new', 'review_1') 的去重学生数
 *
 * @returns {Promise<{fullyMasteredRate: number, basicMasteredRate: number, masteryRate: number, inProgress: number, awaitingRetryStudents: number, total: number, fullyMastered: number, basicMastered: number, undigested: number}>}
 */
export async function getRetryOverview() {
  const [{ rows: masteryRows }, { rows: inProgressRows }, { rows: awaitingRows }] = await Promise.all([
    query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE lifecycle_status = 'mastered')::int AS fully_mastered,
        COUNT(*) FILTER (WHERE lifecycle_status IN ('review_1', 'review_2'))::int AS basic_mastered
       FROM ${TABLES.WRONG_QUESTIONS}`
    ),
    query(
      `SELECT COUNT(*)::int AS n
       FROM ${TABLES.GENERATED_EXAMS} ge
       JOIN ${TABLES.TASKS} t ON t.generated_exam_id = ge.id
       WHERE t.deleted_at IS NULL
         AND ge.status = 'graded'`
    ),
    query(
      `SELECT COUNT(DISTINCT student_id)::int AS n
       FROM ${TABLES.WRONG_QUESTIONS}
       WHERE lifecycle_status IN ('new', 'review_1')`
    )
  ])

  const total = masteryRows[0]?.total ?? 0
  const fullyMastered = masteryRows[0]?.fully_mastered ?? 0
  const basicMastered = masteryRows[0]?.basic_mastered ?? 0
  const pct = (n) => (total > 0 ? Math.round((n * 100) / total) : 0)

  return {
    fullyMasteredRate: pct(fullyMastered),
    basicMasteredRate: pct(basicMastered),
    // masteryRate 保留为兼容字段：旧语义把 review_2 算进「已掌握」，虚高；
    // 现收敛为「完全掌握率」，前端已切换到新字段，留作过渡避免消费方 undefined。
    masteryRate: pct(fullyMastered),
    inProgress: inProgressRows[0]?.n ?? 0,
    awaitingRetryStudents: awaitingRows[0]?.n ?? 0,
    // 首页消化进度环需要绝对数（仅追加，不改变已有字段语义）
    total,
    fullyMastered,
    basicMastered,
    undigested: Math.max(total - fullyMastered - basicMastered, 0)
  }
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