/**
 * curatedQuestions.js — 好题甄选路由（/api/curated-questions）
 *
 * 老师把错题 / 试卷题收起来、打标签、集中筛选后导出 PDF。
 * ⛔ 只读写 curated_questions（引用+标签），不碰题目内容表。
 */
import { Router } from 'express'
import {
  addCuratedQuestion,
  removeCuratedQuestion,
  updateCuratedQuestion,
  listCuratedQuestions,
  getCuratedStatus,
} from '../services/curatedQuestionService.js'

const router = Router()

// 列表：GET /api/curated-questions?sourceType=&tags=易错,高难&keyword=&sort=
router.get('/', async (req, res) => {
  try {
    const { sourceType, tags, keyword, sort } = req.query || {}
    const tagArr = typeof tags === 'string' && tags.trim()
      ? tags.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : []
    const data = await listCuratedQuestions({ sourceType, tags: tagArr, keyword, sort })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: '获取好题甄选列表失败', message: e.message })
  }
})

// 批量查收藏状态（给五处星标按钮）：POST /status/query  {sourceType, sourceIds}
router.post('/status/query', async (req, res) => {
  try {
    const { sourceType, sourceIds } = req.body || {}
    if (!sourceType) return res.status(400).json({ error: '缺少来源类型' })
    const map = await getCuratedStatus(sourceType, sourceIds || [])
    res.json(map)
  } catch (e) {
    res.status(500).json({ error: '查询收藏状态失败', message: e.message })
  }
})

// 收藏：POST /  {sourceType, sourceId, tags?}
router.post('/', async (req, res) => {
  try {
    const { sourceType, sourceId, tags } = req.body || {}
    const data = await addCuratedQuestion({ sourceType, sourceId, tags })
    res.json({ success: true, ...data })
  } catch (e) {
    res.status(400).json({ error: '收藏失败', message: e.message })
  }
})

// 取消收藏：DELETE /  {sourceType, sourceId}
router.delete('/', async (req, res) => {
  try {
    const { sourceType, sourceId } = req.body || {}
    const data = await removeCuratedQuestion({ sourceType, sourceId })
    res.json({ success: true, ...data })
  } catch (e) {
    res.status(400).json({ error: '取消收藏失败', message: e.message })
  }
})

// 改标签/备注：PUT /:id  {tags?, note?}
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params
    const data = await updateCuratedQuestion(id, req.body || {})
    if (!data) return res.status(404).json({ error: '收藏记录不存在' })
    res.json({ success: true, ...data })
  } catch (e) {
    res.status(500).json({ error: '更新标签失败', message: e.message })
  }
})

export default router
