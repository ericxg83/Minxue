import { Router } from 'express'
import { query, TABLES } from '../config/neon.js'
import { parsePeriod } from '../utils/period.js'
import {
  aggregateKnowledgeSuggestions,
  fillTeachingAdvice,
  listGrades,
  listStudentIdsByGrade
} from '../services/teachingSuggestionsService.js'

const router = Router()

// 错题时间过滤条件 + 参数构造
const periodClause = (params, p) => {
  params.push(p.periodStart, p.periodEnd)
  return `wq.added_at >= $${params.length - 1} AND wq.added_at < $${params.length}`
}

/**
 * GET /api/teaching/diagnosis
 * 跨学生共性错题聚合（空题置顶排序）。
 * Query: mode=week|month|all, offset, subject（可选）
 * 返回：按知识点聚合，含 做错数 / 空题数 / 涉及学生数
 */
router.get('/diagnosis', async (req, res) => {
  try {
    const p = parsePeriod(req.query)
    const { subject } = req.query

    const params = []
    const conditions = [periodClause(params, p), `q.is_complete = TRUE`, `tag != '未分类'`]
    let subjectClause = ''
    if (subject) {
      params.push(subject)
      subjectClause = ` AND q.subject = $${params.length}`
    }

    const { rows } = await query(
      `SELECT
        COALESCE(NULLIF(q.subject, ''), '其他') AS subject,
        tag,
        COUNT(*) FILTER (WHERE wq.is_blank = TRUE)::int AS blank_count,
        COUNT(*) FILTER (WHERE wq.is_blank IS NOT TRUE)::int AS wrong_count,
        COUNT(DISTINCT wq.student_id)::int AS student_count
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
      ) AS tag
      WHERE ${conditions.join(' AND ')}${subjectClause}
      GROUP BY COALESCE(NULLIF(q.subject, ''), '其他'), tag
      ORDER BY blank_count DESC, wrong_count DESC, student_count DESC`,
      params
    )

    const diagnosis = rows.map(r => ({
      subject: r.subject,
      tag: r.tag,
      blankCount: r.blank_count,
      wrongCount: r.wrong_count,
      studentCount: r.student_count,
      // 空题占比作为「最该讲」信号
      blankRatio: (r.blank_count + r.wrong_count) > 0
        ? Math.round((r.blank_count / (r.blank_count + r.wrong_count)) * 100)
        : 0
    }))

    res.json({
      success: true,
      period: {
        start: p.periodStart.toISOString().split('T')[0],
        end: p.periodEnd.toISOString().split('T')[0],
        mode: p.mode,
        offset: p.offset
      },
      diagnosis
    })
  } catch (error) {
    console.error('获取共性诊断失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/teaching/diagnosis/:tag
 * 单个知识点的下钻：涉及学生 + 错因分布（只统计做错，空题不分析错因）
 */
router.get('/diagnosis/:tag', async (req, res) => {
  try {
    const { tag } = req.params
    const p = parsePeriod(req.query)

    const params = [tag, p.periodStart, p.periodEnd]
    const tagMatch = `EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
      ) t WHERE t = $1
    )`

    // 1. 涉及学生（空题/做错分开计数）
    const { rows: studentRows } = await query(
      `SELECT
        s.id, s.name, s.grade,
        COUNT(*) FILTER (WHERE wq.is_blank = TRUE)::int AS blank_count,
        COUNT(*) FILTER (WHERE wq.is_blank IS NOT TRUE)::int AS wrong_count
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND ${tagMatch}
      LEFT JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
      WHERE wq.added_at >= $2 AND wq.added_at < $3
      GROUP BY s.id, s.name, s.grade
      ORDER BY blank_count DESC, wrong_count DESC, s.name`,
      params
    )

    // 2. 错因分布（仅做错题）
    const { rows: errorRows } = await query(
      `SELECT
        COALESCE(wq.error_type, '未标注') AS error_type,
        COUNT(*)::int AS count
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND ${tagMatch}
      WHERE wq.added_at >= $2 AND wq.added_at < $3
        AND (wq.is_blank IS NOT TRUE)
      GROUP BY COALESCE(wq.error_type, '未标注')
      ORDER BY count DESC`,
      params
    )

    const totalErrors = errorRows.reduce((s, r) => s + r.count, 0)
    const errorDist = errorRows.map(r => ({
      errorType: r.error_type,
      count: r.count,
      ratio: totalErrors > 0 ? Math.round((r.count / totalErrors) * 100) : 0
    }))

    // 3. 代表性错题（供讲义当例题；优先「已有错因的做错」，其次做错，再到空题）
    const { rows: sampleRows } = await query(
      `SELECT
        wq.id, wq.question_id,
        q.content, q.answer AS correct_answer,
        wq.student_answer, wq.is_blank, wq.error_type, wq.error_reason,
        COALESCE(s.name, '未知学生') AS student_name
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND ${tagMatch}
      LEFT JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
      WHERE wq.added_at >= $2 AND wq.added_at < $3
      ORDER BY (wq.error_type IS NULL) ASC, (wq.is_blank IS TRUE) ASC, wq.updated_at DESC
      LIMIT 5`,
      params
    )

    res.json({
      success: true,
      tag,
      students: studentRows.map(s => ({
        id: s.id,
        name: s.name || '未知学生',
        grade: s.grade,
        blankCount: s.blank_count,
        wrongCount: s.wrong_count
      })),
      errorDist,
      totalWrong: totalErrors,
      sampleQuestions: sampleRows.map(q => ({
        id: q.id,
        questionId: q.question_id,
        content: q.content || '(题干缺失)',
        correctAnswer: q.correct_answer,
        studentAnswer: q.student_answer,
        isBlank: q.is_blank === true,
        errorType: q.error_type,
        errorReason: q.error_reason,
        studentName: q.student_name
      }))
    })
  } catch (error) {
    console.error('获取知识点下钻失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/teaching/error-types
 * 错误原因库（下拉数据源）
 */
router.get('/error-types', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT name, category, sort_order FROM ${TABLES.ERROR_TYPES} ORDER BY sort_order`
    )
    res.json({ success: true, errorTypes: rows })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/teaching/grades
 * 晚托班所有年级列表（年级选择器下拉数据源）
 */
router.get('/grades', async (req, res) => {
  try {
    const grades = await listGrades()
    res.json({ success: true, grades })
  } catch (error) {
    console.error('获取年级列表失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/teaching/grade-suggestions
 * 年级视图备课建议清单
 * Query: grade=四年级, mode=week, offset, subject=数学, periodStart?, periodEnd?
 */
router.get('/grade-suggestions', async (req, res) => {
  try {
    const { grade, subject = '数学' } = req.query
    if (!grade) {
      return res.status(400).json({ success: false, error: 'grade 必填' })
    }

    let periodStart, periodEnd, mode, offset
    if (req.query.periodStart && req.query.periodEnd) {
      periodStart = new Date(req.query.periodStart)
      periodEnd = new Date(req.query.periodEnd)
      mode = req.query.mode || 'custom'
      offset = parseInt(req.query.offset || 0)
    } else {
      const p = parsePeriod(req.query)
      periodStart = p.periodStart
      periodEnd = p.periodEnd
      mode = p.mode
      offset = p.offset
    }

    const studentIds = await listStudentIdsByGrade(grade)
    if (studentIds.length === 0) {
      return res.json({
        success: true,
        grade,
        period: { start: periodStart.toISOString().split('T')[0], end: periodEnd.toISOString().split('T')[0], mode, offset },
        studentCount: 0,
        suggestions: [],
        message: '该年级暂无学生'
      })
    }

    const raw = await aggregateKnowledgeSuggestions({ studentIds, periodStart, periodEnd, subject })
    const suggestions = await fillTeachingAdvice(raw, 'grade')

    res.json({
      success: true,
      grade,
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0],
        mode,
        offset
      },
      studentCount: studentIds.length,
      suggestions
    })
  } catch (error) {
    console.error('获取年级备课建议失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * GET /api/teaching/student-suggestions
 * 单生视图备课建议清单
 * Query: studentId, mode=week, offset, periodStart?, periodEnd?
 */
router.get('/student-suggestions', async (req, res) => {
  try {
    const { studentId } = req.query
    if (!studentId) {
      return res.status(400).json({ success: false, error: 'studentId 必填' })
    }

    let periodStart, periodEnd, mode, offset
    if (req.query.periodStart && req.query.periodEnd) {
      periodStart = new Date(req.query.periodStart)
      periodEnd = new Date(req.query.periodEnd)
      mode = req.query.mode || 'custom'
      offset = parseInt(req.query.offset || 0)
    } else {
      const p = parsePeriod(req.query)
      periodStart = p.periodStart
      periodEnd = p.periodEnd
      mode = p.mode
      offset = p.offset
    }

    const raw = await aggregateKnowledgeSuggestions({
      studentIds: [studentId],
      periodStart,
      periodEnd
    })
    const suggestions = await fillTeachingAdvice(raw, 'single')

    res.json({
      success: true,
      studentId,
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0],
        mode,
        offset
      },
      suggestions
    })
  } catch (error) {
    console.error('获取单生备课建议失败:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

export default router
