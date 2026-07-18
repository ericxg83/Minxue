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

const router = Router()

// 资源列表
router.get('/', async (req, res) => {
  try {
    const { type, subject } = req.query
    const resources = await getAllResources({ type, subject })
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
    const resource = await updateResource(req.params.id, req.body)
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
    const answers = await updateResourceAnswerStatus(req.params.id, answerStatus)
    res.json({ success: true, answers })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router