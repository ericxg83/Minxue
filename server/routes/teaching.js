import { Router } from 'express'
import { query, TABLES } from '../config/neon.js'
import { parsePeriod } from '../utils/period.js'
import {
  aggregateKnowledgeSuggestions,
  fillTeachingAdvice
} from '../services/teachingSuggestionsService.js'

const router = Router()

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
 * GET /api/teaching/student-suggestions
 * 单生视图学习建议清单（学习诊断页「本周备课建议（按 KP）」卡）
 * Query: studentId, mode=week, offset, periodStart?, periodEnd?
 *
 * ⚠️ r137（负责人裁决）：年级视图的 /grades、/grade-suggestions、/diagnosis、
 * /diagnosis/:tag 与 /wrong-paper 属「班级备课」伪需求，已随工作台视图一并下线；
 * 本端点是**单生**口径，不在下线范围内，勿误删。
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
