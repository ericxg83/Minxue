import { Router } from 'express'
import { query, TABLES } from '../config/neon.js'
import { parsePeriod, getIsoWeek } from '../utils/period.js'
import { sqlCorrectExpr, sqlWrongExpr } from '../utils/questionResultCaliber.js'

const router = Router()

/**
 * GET /api/weekly-report/:studentId
 * 获取学生本周学习统计数据
 * Query params:
 *   - mode: 'week' | 'month' | 'all'，默认 week
 *   - offset: 偏移量，0=当前，1=上一个...
 *   - weeks: (兼容旧参数) 周数，默认 1（本周），2 表示近两周
 */
router.get('/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const { periodStart, periodEnd, mode, offset } = parsePeriod(req.query)
    const isWeekMode = mode === 'week'

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
    // 2026-09-14：正确/错误按 questionResultCaliber 归类（**人工复核结论优先**），
    // 与移动端组卷数字、结算掌握度同一口径；此前只数 is_correct，老师改判不算数。
    // 未作答等同不会（blank 且 is_correct=false）计入 wrong —— 与周报 wrong 原口径一致。
    const { rows: questionRows } = await query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct,
        COUNT(*) FILTER (WHERE ${sqlWrongExpr()})::int AS wrong
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

    // 5a. 本周新增错题总数（所有生命周期状态，不含 mastered 过滤）
    const { rows: wrongCountRows } = await query(
      `SELECT COUNT(*)::int AS count
      FROM ${TABLES.WRONG_QUESTIONS}
      WHERE student_id = $1
        AND added_at >= $2
        AND added_at < $3`,
      [studentId, periodStart, periodEnd]
    )

    // 5b. 获取可用于组卷的错题 question_id（仅含已完成题目，排除已掌握）
    //     选题口径（2026-09-13 队列分层定稿）：周报重练卷是「第二次验证」的承载，
    //     所以池子 = 本周期新增的 new/review_1 错题 + 全库到期的 review_1/review_2（基本掌握）。
    //     「到期」用 wq.updated_at 推导：重练结算会写 updated_at=NOW()，
    //     距上次练习 ≥7 天即视为该做周回顾了（MVP 不新增 review_due_at 字段）。
    //     排序：先到期的基本掌握题（二次验证优先，避免假掌握滞留），再按学习价值：
    //       1) 难度升序优先（简单→中等→难），让学生先练会简单题、再逐级突破难题；
    //          NULL 难度按中档(3)处理，保证无难度题也能稳定入序、不阻塞。
    //          当前系统仅录入数学，不做跨学科轮转；若将来多学科可在此改回 PARTITION BY 学科兜底。
    //       2) 同难度内错误次数（error_count）多的优先；
    //       3) 最后按最近错题。
    //     返回全量有序列表（ID 体积极小），由前端只取前 N 道生成再测卷。
    const { rows: wrongIdRows } = await query(
      `SELECT wq.question_id
      FROM ${TABLES.WRONG_QUESTIONS} wq
      JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND q.is_complete = TRUE
      WHERE wq.student_id = $1
        AND (
          (wq.added_at >= $2 AND wq.added_at < $3
            AND (wq.lifecycle_status IS NULL OR wq.lifecycle_status != 'mastered'))
          OR
          (wq.lifecycle_status IN ('review_1', 'review_2')
            AND wq.updated_at IS NOT NULL
            AND wq.updated_at <= NOW() - INTERVAL '7 days')
        )
      ORDER BY
        (wq.lifecycle_status IN ('review_1', 'review_2')) DESC,
        COALESCE(q.difficulty, 3) ASC,
        COALESCE(wq.error_count, 1) DESC,
        wq.added_at DESC`,
      [studentId, periodStart, periodEnd]
    )

    // 6. 本周知识点诊断（从 ai_tags 展开，兼容 text 和 jsonb），带学科
    const { rows: tagRows } = await query(
      `SELECT
        COALESCE(NULLIF(q.subject, ''), '其他') AS subject,
        jsonb_array_elements_text(CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END) AS tag,
        COUNT(*) FILTER (WHERE ${sqlWrongExpr('q.')})::int AS wrong_count,
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
      GROUP BY COALESCE(NULLIF(q.subject, ''), '其他'), tag
      ORDER BY COALESCE(NULLIF(q.subject, ''), '其他'), wrong_count DESC, total_count DESC`,
      [studentId, periodStart, periodEnd]
    )

    // 7. 每日正确率趋势（本周批改题目按日期分组）
    const { rows: trendRows } = await query(
      `SELECT
        to_char(created_at, 'MM-DD') AS day,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND is_complete = TRUE
      GROUP BY day
      ORDER BY day`,
      [studentId, periodStart, periodEnd]
    )

    // 8. 各学科整体正确率（本周批改题目按学科聚合）
    const { rows: subjectAccRows } = await query(
      `SELECT
        COALESCE(NULLIF(subject, ''), '其他') AS subject,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct
      FROM ${TABLES.QUESTIONS}
      WHERE student_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND is_complete = TRUE
      GROUP BY subject
      ORDER BY total DESC`,
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
      newWrongCount: wrongCountRows[0]?.count || 0,
      masteredCount,
      pendingCount,
      wrongQuestionIds: wrongIdRows.map(r => r.question_id)
    }

    const knowledgeDiagnosis = tagRows.map(r => ({
      subject: r.subject,
      tag: r.tag,
      wrongCount: r.wrong_count,
      totalCount: r.total_count,
      accuracy: r.total_count > 0
        ? Math.round(((r.total_count - r.wrong_count) / r.total_count) * 1000) / 10
        : 0
    }))

    // 各学科整体正确率映射
    const subjectAccuracyMap = {}
    for (const r of subjectAccRows) {
      subjectAccuracyMap[r.subject] = r.total > 0
        ? Math.round((r.correct / r.total) * 1000) / 10
        : 0
    }

    // 按学科分组诊断：每科取 TOP5 薄弱知识点，附占比与掌握标签
    const subjectDiagnosis = buildSubjectDiagnosis(knowledgeDiagnosis, subjectAccuracyMap)

    // 每日趋势（周模式补全 7 天，月/全部模式不生成趋势）
    const dailyTrend = isWeekMode ? buildDailyTrend(trendRows, periodStart) : []

    const weekNum = isWeekMode ? getIsoWeek(periodStart) : null

    const result = {
      success: true,
      student: studentRows[0],
      period: {
        start: periodStart.toISOString().split('T')[0],
        end: periodEnd.toISOString().split('T')[0],
        mode,
        offset,
        weekNum
      },
      stats,
      knowledgeDiagnosis,
      subjectDiagnosis,
      dailyTrend
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
    const { periodStart, periodEnd, mode } = parsePeriod(req.query)
    const isWeekMode = mode === 'week'

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
            COUNT(*) FILTER (WHERE ${sqlCorrectExpr()})::int AS correct,
            COUNT(*) FILTER (WHERE ${sqlWrongExpr()})::int AS wrong
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
        end: periodEnd.toISOString().split('T')[0],
        mode,
        weekNum: isWeekMode ? getIsoWeek(periodStart) : null
      },
      reports
    })
  } catch (error) {
    console.error('获取全学生周统计失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * 按学科分组诊断：每科取 TOP5 薄弱知识点
 * @param {Array} knowledgeDiagnosis - [{subject, tag, wrongCount, totalCount, accuracy}]
 * @param {Object} subjectAccuracyMap - { 学科: 整体正确率 }
 * @returns {Array} [{ subject, accuracy, topTags:[{tag,wrongCount,totalCount,ratio,masteryLabel}] }]
 */
function buildSubjectDiagnosis(knowledgeDiagnosis, subjectAccuracyMap) {
  const bySubject = {}
  for (const kp of knowledgeDiagnosis) {
    const subj = kp.subject || '其他'
    if (!bySubject[subj]) bySubject[subj] = []
    bySubject[subj].push(kp)
  }

  return Object.keys(bySubject).map(subject => {
    const tags = bySubject[subject]
    // 本科总错误次数（用于计算占比）
    const totalWrong = tags.reduce((sum, t) => sum + t.wrongCount, 0)
    const topTags = tags
      .slice()
      .sort((a, b) => b.wrongCount - a.wrongCount || b.totalCount - a.totalCount)
      .slice(0, 5)
      .map(t => ({
        tag: t.tag,
        wrongCount: t.wrongCount,
        totalCount: t.totalCount,
        accuracy: t.accuracy,
        ratio: totalWrong > 0 ? Math.round((t.wrongCount / totalWrong) * 100) : 0,
        masteryLabel: masteryLabelFor(t.accuracy)
      }))
    return {
      subject,
      accuracy: subjectAccuracyMap[subject] ?? null,
      topTags
    }
  }).sort((a, b) => {
    // 有整体正确率的学科在前，正确率低的（更需关注）在前
    const wrongA = a.topTags.reduce((s, t) => s + t.wrongCount, 0)
    const wrongB = b.topTags.reduce((s, t) => s + t.wrongCount, 0)
    return wrongB - wrongA
  })
}

/**
 * 掌握标签：按知识点正确率分档
 */
function masteryLabelFor(accuracy) {
  if (accuracy >= 80) return '需巩固'   // 掌握较好，巩固即可
  if (accuracy >= 50) return '需关注'   // 中等，需关注
  return '待加强'                        // 薄弱，重点加强
}

/**
 * 补全本周 7 天趋势，缺失日 accuracy=null
 * @param {Array} trendRows - [{day:'MM-DD', total, correct}]
 * @param {Date} periodStart - 周一
 * @returns {Array} [{ date:'MM-DD', accuracy:number|null, count:number }]
 */
function buildDailyTrend(trendRows, periodStart) {
  const map = {}
  for (const r of trendRows) {
    map[r.day] = {
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : null,
      count: r.total
    }
  }

  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(periodStart)
    d.setDate(periodStart.getDate() + i)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const key = `${mm}-${dd}`
    days.push({
      date: key,
      accuracy: map[key] ? map[key].accuracy : null,
      count: map[key] ? map[key].count : 0
    })
  }
  return days
}

export default router