import { Router } from 'express'
import {
  createResource,
  getAllResources,
  getResourceById,
  updateResource,
  deleteResource,
  getResourceAnswers,
  replaceResourceAnswers,
  updateResourceAnswerStatus,
} from '../services/neonService.js'
import { findDirtyAnswers } from '../services/judgeService.js'

const router = Router()

/**
 * ⛔ PUT /:id 的可写字段白名单（2026-10-04 加固）。
 *
 * 为什么必须有：`updateResource(id, updates)` 会把传入对象的 **key 直接当列名**拼进 SQL
 * （`for (const [key, value] of Object.entries(updates)) setClauses.push(`${col} = $n`)`），
 * 而这条路由原先把 `req.body` **原样**转发 —— 于是：
 *   ① 前端一个笔误（或恶意键名）就能改到 `id` / `created_at` / `answer_count` 这类不该动的列；
 *   ② 键名里带 `,` 或 `= (SELECT …)` 可以拼出额外 SQL（值是参数化的，但列名不是）。
 * 只放行「业务上确实可改」的字段；未知字段**忽略但打日志**，避免哪天漏了字段变成静默丢数据。
 */
const RESOURCE_WRITABLE = new Set([
  'name', 'type', 'resourceType', 'subject', 'grade', 'status', 'examDate',
  'answerStatus', 'parseStatus', 'parseCount', 'parseWarning', 'parseError',
  'pdfUrl', 'questionPdfUrl', 'metadata',
])

export function pickWritableResourceFields(body) {
  const out = {}
  const dropped = []
  for (const [k, v] of Object.entries(body || {})) {
    if (RESOURCE_WRITABLE.has(k)) out[k] = v
    else dropped.push(k)
  }
  if (dropped.length > 0) {
    console.warn(`  ⚠️ [Resources] PUT 忽略了非白名单字段: ${dropped.join(', ')}`)
  }
  return out
}

// 资源列表
// v4 增 status 过滤：移动端 ExamChoiceModal 只看 published 资源
router.get('/', async (req, res) => {
  try {
    const { type, subject, status } = req.query
    const resources = await getAllResources({ type, subject, status })
    res.json({ success: true, resources })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 创建资源
router.post('/', async (req, res) => {
  try {
    const { name, type, subject, grade, examDate } = req.body
    if (!name || !type) return res.status(400).json({ error: '缺少必填参数：name, type' })
    const resource = await createResource({ name, type, subject, grade, examDate })
    res.json({ success: true, resource })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 资源详情
router.get('/:id', async (req, res) => {
  try {
    const resource = await getResourceById(req.params.id)
    if (!resource) return res.status(404).json({ error: '资源不存在' })
    res.json({ success: true, resource })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 更新资源
router.put('/:id', async (req, res) => {
  try {
    // "确认发布"按钮走的是这条 PUT，会把 answerStatus 直接写进 resources 表。
    // 若不在此设闸，它就成了绕过 PATCH /answers/status 闸门给脏答案库盖章的后门。
    const promoting = req.body?.answerStatus === 'teacher_verified' || req.body?.answerStatus === 'official_verified'
    if (promoting) {
      const existing = await getResourceAnswers(req.params.id)
      const dirty = findDirtyAnswers(existing)
      if (dirty.length > 0) {
        return res.status(400).json({
          error: '部分答案疑似批语、被截断或为空，请先核对后再提升为可信答案源',
          suspect: dirty,
        })
      }
    }

    const patch = pickWritableResourceFields(req.body)
    const resource = await updateResource(req.params.id, patch)
    if (!resource) return res.status(404).json({ error: '资源不存在' })
    res.json({ success: true, resource })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 删除资源
router.delete('/:id', async (req, res) => {
  try {
    await deleteResource(req.params.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 答案管理 ──

// 获取资源的所有答案
router.get('/:id/answers', async (req, res) => {
  try {
    const answers = await getResourceAnswers(req.params.id)
    res.json({ success: true, answers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 批量替换答案（事务性）
router.put('/:id/answers', async (req, res) => {
  try {
    const { answers } = req.body
    if (!answers) return res.status(400).json({ error: '缺少 answers' })
    const saved = await replaceResourceAnswers(req.params.id, answers)
    res.json({ success: true, answers: saved })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 更新答案状态（ai_draft → teacher_verified）
router.patch('/:id/answers/status', async (req, res) => {
  try {
    const { answerStatus } = req.body
    if (!answerStatus) return res.status(400).json({ error: '缺少 answerStatus' })

    // 提升为可信答案源 = 授权它去判全班同类题，脏答案会放大成成片误判。
    // 与 /api/tasks/:id/save-as-answer-key 共用同一道闸门，避免绕道这个接口盖章。
    if (answerStatus === 'teacher_verified' || answerStatus === 'official_verified') {
      const existing = await getResourceAnswers(req.params.id)
      const dirty = findDirtyAnswers(existing)
      if (dirty.length > 0) {
        return res.status(400).json({
          error: '部分答案疑似批语、被截断或为空，请先核对后再提升为可信答案源',
          suspect: dirty,
        })
      }
    }

    const answers = await updateResourceAnswerStatus(req.params.id, answerStatus)
    res.json({ success: true, answers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router