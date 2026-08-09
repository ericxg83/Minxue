import { Router } from 'express'
import { query, TABLES } from '../config/neon.js'
import { getQuestionKnowledge } from '../services/knowledgeService.js'
import { generateKnowledgeExplanation, buildHandout, buildKnowledgeSection, listHandoutTemplates } from '../services/handoutService.js'
import { buildHandoutDocx } from '../services/handoutDocxService.js'
import { parsePeriod } from '../utils/period.js'

const router = Router()

/**
 * GET /api/handout/templates
 * 列出可用讲义模板，前端下拉用
 * Query: ?subject=英语
 */
router.get('/templates', (req, res) => {
  try {
    const subject = req.query.subject || null
    const list = listHandoutTemplates(subject)
    res.json({ success: true, templates: list })
  } catch (error) {
    console.error('列出讲义模板失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/handout/build
 * 组装讲义数据（供 Web 预览页和 Word 导出共用）
 * Body: { title, subject, periodText, knowledgeSections: [{kpName, subject, sampleQuestions, explanation}], template? }
 */
router.post('/build', async (req, res) => {
  try {
    const { title, subject, periodText, knowledgeSections, template } = req.body
    if (!title || !Array.isArray(knowledgeSections) || knowledgeSections.length === 0) {
      return res.status(400).json({ error: '缺少必要参数：title, knowledgeSections' })
    }

    const handout = await buildHandout({ title, subject, periodText, knowledgeSections, template })
    res.json({ success: true, handout })
  } catch (error) {
    console.error('组装讲义失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/handout/explain
 * 生成单个知识点的 AI 讲解
 * Body: { kpName, subject }
 */
router.post('/explain', async (req, res) => {
  try {
    const { kpName, subject } = req.body
    if (!kpName) return res.status(400).json({ error: '缺少 kpName' })
    const text = await generateKnowledgeExplanation(kpName, subject || '数学')
    res.json({ success: true, explanation: text })
  } catch (error) {
    console.error('生成知识点讲解失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/handout/from-diagnosis
 * 从教学诊断数据生成讲义预览
 * Body: { mode, offset, subject, periodText, maxItems, template? }
 */
router.post('/from-diagnosis', async (req, res) => {
  try {
    const { mode = 'week', offset = 0, subject = '', periodText = '', maxItems = 12, template = null } = req.body
    const p = parsePeriod({ mode, offset })

    // 获取诊断数据
    const params = []
    const conditions = [
      `wq.added_at >= $${params.length + 1} AND wq.added_at < $${params.length + 2}`,
      `q.is_complete = TRUE`,
      `tag != '未分类'`,
    ]
    params.push(p.periodStart, p.periodEnd)
    let subjectClause = ''
    if (subject) {
      subjectClause = ` AND q.subject = $${params.length + 1}`
      params.push(subject)
    }

    const { rows: diagnosis } = await query(
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
      GROUP BY subject, tag
      ORDER BY blank_count DESC, wrong_count DESC, student_count DESC
      LIMIT ${Math.min(maxItems, 20)}`,
      params
    )

    if (diagnosis.length === 0) {
      return res.json({ success: true, handout: null, message: '该时段暂无共性错题数据' })
    }

    // 为每个知识点取样本错题和变式题
    const knowledgeSections = []
    for (const d of diagnosis) {
      const tagParams = [d.tag, p.periodStart, p.periodEnd]
      const { rows: samples } = await query(
        `SELECT
          wq.id, wq.question_id,
          q.content, q.options, q.answer AS correct_answer,
          wq.student_answer, wq.is_blank, wq.error_type, wq.error_reason,
          COALESCE(s.name, '未知学生') AS student_name
        FROM ${TABLES.WRONG_QUESTIONS} wq
        JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
            ) t WHERE t = $1
          )
        LEFT JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
        WHERE wq.added_at >= $2 AND wq.added_at < $3
        ORDER BY (wq.error_type IS NULL) ASC, (wq.is_blank IS TRUE) ASC, wq.updated_at DESC
        LIMIT 3`,
        tagParams
      )

      knowledgeSections.push({
        kpName: d.tag,
        subject: d.subject,
        sampleQuestions: samples.map(q => ({
          questionId: q.question_id,
          content: q.content,
          options: q.options,
          studentAnswer: q.student_answer,
          correctAnswer: q.correct_answer,
          isBlank: q.is_blank === true,
          errorType: q.error_type,
          errorReason: q.error_reason,
          studentName: q.student_name,
        })),
      })
    }

    const title = periodText
      ? `${periodText}教学讲义`
      : `教学讲义（${p.periodStart.toISOString().slice(0, 10)} ~ ${p.periodEnd.toISOString().slice(0, 10)}）`

    const handout = await buildHandout({
      title,
      subject: subject || '全部',
      periodText: periodText || `${p.periodStart.toISOString().slice(0, 10)} ~ ${p.periodEnd.toISOString().slice(0, 10)}`,
      knowledgeSections,
      template,
    })

    res.json({ success: true, handout })
  } catch (error) {
    console.error('从诊断生成讲义失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/handout/export-word
 * 把讲义结构（Web 预览那份 JSON）打包成 docx 二进制直接下载。
 * Body: { handout, filename? }
 */
router.post('/export-word', async (req, res) => {
  try {
    const { handout, filename } = req.body || {}
    if (!handout || !Array.isArray(handout.pages) || handout.pages.length === 0) {
      return res.status(400).json({ error: '缺少讲义数据（handout.pages）' })
    }
    const buffer = await buildHandoutDocx(handout)
    const safeName = String(filename || handout.title || '教学讲义')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 80)
    const finalName = safeName.endsWith('.docx') ? safeName : `${safeName}.docx`

    // 直接以二进制流方式返回，前端用 Blob 触发下载；避免落盘。
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(finalName)}"`)
    res.setHeader('Content-Length', buffer.length)
    res.send(buffer)
  } catch (error) {
    console.error('讲义导出 Word 失败:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router