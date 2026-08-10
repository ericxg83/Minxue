import { Router } from 'express'
import { query, TABLES } from '../config/neon.js'
import { getQuestionKnowledge, loadKnowledgePoints } from '../services/knowledgeService.js'
import { generateVariantsForQuestion, getVariantsForQuestion, getVariantsGrouped, STRATEGY_LABELS } from '../services/variantService.js'

const router = Router()

/**
 * GET /api/variants/:questionId
 * 获取某题的所有变式题（按策略分组）
 */
router.get('/:questionId', async (req, res) => {
  try {
    const { questionId } = req.params
    const grouped = await getVariantsGrouped(questionId)
    res.json({ success: true, variants: grouped })
  } catch (error) {
    console.error('获取变式题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/variants/:questionId/list
 * 获取某题的所有变式题（扁平列表）
 */
router.get('/:questionId/list', async (req, res) => {
  try {
    const { questionId } = req.params
    const list = await getVariantsForQuestion(questionId)
    res.json({ success: true, variants: list })
  } catch (error) {
    console.error('获取变式题列表失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/variants/:questionId/generate
 * 为某题生成变式题（AI 在线生成）
 * Body: { kpName?: string }
 */
router.post('/:questionId/generate', async (req, res) => {
  try {
    const { questionId } = req.params
    const { kpName } = req.body

    // 读取原题
    const { rows } = await query(
      `SELECT id, content, options, answer, subject, ai_tags
       FROM ${TABLES.QUESTIONS} WHERE id = $1`,
      [questionId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: '题目不存在' })
    }

    const question = rows[0]
    const resolvedKpName = kpName || (Array.isArray(question.ai_tags) ? question.ai_tags[0] : null)

    const saved = await generateVariantsForQuestion(question, resolvedKpName)

    res.json({
      success: true,
      generated: saved.length,
      variants: saved,
    })
  } catch (error) {
    console.error('生成变式题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/variants/:questionId/generate-all
 * 为某题生成所有 4 种策略的变式题（如果已有则跳过）
 */
router.post('/:questionId/generate-all', async (req, res) => {
  try {
    const { questionId } = req.params

    // 检查已有变式题
    const existing = await getVariantsForQuestion(questionId)
    const existingStrategies = new Set(existing.map(v => v.strategy))
    const allStrategies = ['change_number', 'change_condition', 'inverse', 'context_shift']
    const missing = allStrategies.filter(s => !existingStrategies.has(s))

    if (missing.length === 0) {
      return res.json({ success: true, generated: 0, message: '所有策略的变式题已存在' })
    }

    // 读取原题
    const { rows } = await query(
      `SELECT id, content, options, answer, subject, ai_tags
       FROM ${TABLES.QUESTIONS} WHERE id = $1`,
      [questionId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: '题目不存在' })
    }

    const question = rows[0]
    const kpName = Array.isArray(question.ai_tags) ? question.ai_tags[0] : null
    const saved = await generateVariantsForQuestion(question, kpName)

    res.json({
      success: true,
      generated: saved.length,
      missingStrategies: missing,
      variants: saved,
    })
  } catch (error) {
    console.error('生成变式题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/variants/:variantId
 * 删除某道变式题
 */
router.delete('/:variantId', async (req, res) => {
  try {
    const { variantId } = req.params
    await query(`DELETE FROM ${TABLES.VARIANT_QUESTIONS} WHERE id = $1`, [variantId])
    res.json({ success: true })
  } catch (error) {
    console.error('删除变式题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
export { STRATEGY_LABELS }