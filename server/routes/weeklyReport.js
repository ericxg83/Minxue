import { Router } from 'express'
import { query, TABLES } from '../config/neon.js'

const router = Router()

/**
 * GET /api/weekly-report/:studentId
 * 获取学生本周学习统计数据
 * Query params:
 *   - weeks: 周数，默认 1（本周），2 表示近两周
 */
router.get('/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const weeks = parseInt(req.query.weeks) || 1
    const periodStart = getWeekStart(weeks)
    const periodEnd = getWeekEnd(1)

    // 1. 获取学生信息
    const { rows: studentRows } = await query(
      `SELECT id, name, grade FROM ${TABLES.STUDENTS} WHERE id = $1`,
      [studentId]
    )
    if (studentRows.length === 0) {
      return res.status(404).json({ error: '学生不存在' })
    }

    // 2. 本周作业任务统计
    const { rows: taskRows } = await query(
      `SELECT
        COUNT(*)::int AS total_tasks,
        COUNT(*) FILTER (WHERE status = 'done')::int AS completed_tasks
      FROM ${TABLES.TASKS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND deleted_at IS NULL`,
      [studentId, periodStart, periodEnd]
    )

    // 3. 本周批改题量 & 正确率
    const { rows: questionRows } = await query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_correct = true)::int AS correct,
        COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND is_complete = TRUE`,
      [studentId, periodStart, periodEnd]
    )

    // 4. 本周新增错题 & 掌握状态
    const { rows: wrongStatusRows } = await query(
      `SELECT lifecycle_status, COUNT(*)::int AS count
      FROM ${TABLES.WRONG_QUESTIONS}
      WHERE student_id = $1
        AND added_at >= $2
        AND added_at < $3
      GROUP BY lifecycle_status`,
      [studentId, periodStart, periodEnd]
    )

    // 5. 获取本周新增错题的 question_id 列表（用于组卷）
    const { rows: wrongIdRows } = await query(
      `SELECT wq.question_id
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND q.is_complete = TRUE
      WHERE wq.student_id = $1
        AND wq.added_at >= $2
        AND wq.added_at < $3
        AND (wq.lifecycle_status IS NULL OR wq.lifecycle_status != 'mastered')
      ORDER BY wq.added_at DESC`,
      [studentId, periodStart, periodEnd]
    )

    // 6. 本周知识点诊断（从 ai_tags 展开，兼容 text 和 jsonb）
    const { rows: tagRows } = await query(
      `SELECT
        jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END) AS tag,
        COUNT(*) FILTER (WHERE q.is_correct = false)::int AS wrong_count,
        COUNT(*)::int AS total_count
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
      WHERE wq.student_id = $1
        AND wq.added_at >= $2
        AND wq.added_at < $3
        AND q.is_complete = TRUE
        AND q.ai_tags IS NOT NULL
        AND q.ai_tags != ''
        AND q.ai_tags != '[]'
      GROUP BY tag
      ORDER BY wrong_count DESC, total_count DESC`,
      [studentId, periodStart, periodEnd]
    )

    // 组合掌握状态统计
    let masteredCount = 0
    let pendingCount = 0
    for (const row of wrongStatusRows) {
      if (row.lifecycle_status === 'mastered') {
        masteredCount += row.count
      } else {
        pendingCount += row.count
      }
    }

    const stats = {
      totalTasks: taskRows[0]?.total_tasks || 0,
      completedTasks: taskRows[0]?.completed_tasks || 0,
      totalQuestions: questionRows[0]?.total || 0,
      correctCount: questionRows[0]?.correct || 0,
      wrongCount: questionRows[0]?.wrong || 0,
      accuracy: questionRows[0]?.total > 0
        ? Math.round((questionRows[0].correct / questionRows[0].total) * 1000) / 10
        : 0,
      newWrongCount: wrongIdRows.length,
      masteredCount,
      pendingCount,
      wrongQuestionIds: wrongIdRows.map(r => r.question_id)
    }

    const knowledgeDiagnosis = tagRows.map(r => ({
      tag: r.tag,
      wrongCount: r.wrong_count,
      totalCount: r.total_count,
      accuracy: r.total_count > 0
        ? Math.round(((r.total_count - r.wrong_count) / r.total_count) * 1000) / 10
        : 0
    }))

    const result = {
      success: true,
      student: studentRows[0],
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0]
      },
      stats,
      knowledgeDiagnosis
    }

    res.json(result)
  } catch (error) {
    console.error('获取周学习报告失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/weekly-report
 * 获取所有学生的本周统计数据（用于一键生成）
 */
router.get('/', async (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 1
    const periodStart = getWeekStart(weeks)
    const periodEnd = getWeekEnd(1)

    // 获取所有学生
    const { rows: studentRows } = await query(
      `SELECT id, name, grade FROM ${TABLES.STUDENTS} ORDER BY name`
    )

    const reports = await Promise.all(studentRows.map(async (student) => {
      try {
        // 本周作业任务统计
        const { rows: taskRows } = await query(
          `SELECT
            COUNT(*)::int AS total_tasks,
            COUNT(*) FILTER (WHERE status = 'done')::int AS completed_tasks
          FROM ${TABLES.TASKS}
          WHERE student_id = $1
            AND created_at >= $2
            AND created_at < $3
            AND deleted_at IS NULL`,
          [student.id, periodStart, periodEnd]
        )

        // 本周批改题量 & 正确率
        const { rows: questionRows } = await query(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_correct = true)::int AS correct,
            COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong
          FROM ${TABLES.QUESTIONS}
          WHERE student_id = $1
            AND created_at >= $2
            AND created_at < $3
            AND is_complete = TRUE`,
          [student.id, periodStart, periodEnd]
        )

        // 本周新增错题
        const { rows: wrongRows } = await query(
          `SELECT COUNT(*)::int AS count
          FROM ${TABLES.WRONG_QUESTIONS}
          WHERE student_id = $1
            AND added_at >= $2
            AND added_at < $3`,
          [student.id, periodStart, periodEnd]
        )

        // 本周掌握状态
        const { rows: statusRows } = await query(
          `SELECT lifecycle_status, COUNT(*)::int AS count
          FROM ${TABLES.WRONG_QUESTIONS}
          WHERE student_id = $1
            AND added_at >= $2
            AND added_at < $3
          GROUP BY lifecycle_status`,
          [student.id, periodStart, periodEnd]
        )

        let masteredCount = 0
        let pendingCount = 0
        for (const row of statusRows) {
          if (row.lifecycle_status === 'mastered') masteredCount += row.count
          else pendingCount += row.count
        }

        return {
          student: { id: student.id, name: student.name, grade: student.grade },
          stats: {
            totalTasks: taskRows[0]?.total_tasks || 0,
            completedTasks: taskRows[0]?.completed_tasks || 0,
            totalQuestions: questionRows[0]?.total || 0,
            correctCount: questionRows[0]?.correct || 0,
            accuracy: questionRows[0]?.total > 0
              ? Math.round((questionRows[0].correct / questionRows[0].total) * 1000) / 10
              : 0,
            newWrongCount: wrongRows[0]?.count || 0,
            masteredCount,
            pendingCount
          }
        }
      } catch (e) {
        return {
          student: { id: student.id, name: student.name },
          stats: null,
          error: e.message
        }
      }
    }))

    res.json({
      success: true,
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0]
      },
      reports
    })
  } catch (error) {
    console.error('获取全学生周统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 计算周起始日（周一 00:00:00）
 */
function getWeekStart(weeksAgo = 0) {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0=Sun, 1=Mon...
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // 距周一的天数
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff - (weeksAgo - 1) * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
}

/**
 * 计算周结束日（周日 23:59:59）
 */
function getWeekEnd(weeksAgo = 0) {
  const start = getWeekStart(weeksAgo)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return end
}

export default router