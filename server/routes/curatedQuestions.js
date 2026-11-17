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
  setCuratedChapters,
} from '../services/curatedQuestionService.js'
import { tagQuestionChapters } from '../services/chapterTaggingService.js'

const router = Router()

// 列表：GET /api/curated-questions?sourceType=&tags=易错,高难&keyword=&sort=
router.get('/', async (req, res) => {
  try {
    const { sourceType, tags, chapters, keyword, sort } = req.query || {}
    const splitList = (v) => typeof v === 'string' && v.trim()
      ? v.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : []
    const data = await listCuratedQuestions({
      sourceType, tags: splitList(tags), chapterIds: splitList(chapters), keyword, sort,
    })
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

// AI 批量挂教材章节：POST /auto-chapter  {grade?:'初三'|'初二', ids?:string[]}
// 不传 ids = 给所有还没章节的甄选题挂。逐条调用，单条失败留空不影响整批。
router.post('/auto-chapter', async (req, res) => {
  try {
    const grade = String(req.body?.grade || '初三')
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : null
    const force = req.body?.force === true   // 重新挂已有章节的题（改了判据后重跑）
    const data = await listCuratedQuestions({})
    const targets = data.items.filter(it =>
      (force || !it.chapterIds?.length) && (!ids || ids.includes(it.id))
    )
    const updates = []
    const failures = []
    // 串行调用，避免瞬时并发打爆供应商额度（与 OCR 同口径）
    for (const it of targets) {
      const r = await tagQuestionChapters(it, grade)
      if (r.error) failures.push({ id: it.id, error: r.error })
      else if (r.chapterIds.length) updates.push({ id: it.id, chapterIds: r.chapterIds })
    }
    const result = await setCuratedChapters(updates)
    res.json({ success: true, scanned: targets.length, ...result, failures })
  } catch (e) {
    res.status(500).json({ error: 'AI 挂章节失败', message: e.message })
  }
})

// 改标签/备注/章节：PUT /:id  {tags?, note?, chapterIds?}
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
