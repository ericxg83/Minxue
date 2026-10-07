import { Router } from 'express'
import { getStudentWeakness, getClassWeakness, getRecommendedTopics, getRetryQuestionIdsByKp } from '../services/weaknessService.js'

const router = Router()

// kpIds 是 uuid 数组；非法值直接过滤掉，不让 PG 抛 'invalid input syntax for type uuid'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/weakness/student/:studentId/retry-questions?kpIds=<uuid>,<uuid>
 *
 * 定向重练卷的组卷口径：按考点（**含子考点**）取该生「待重练」错题 id。
 * 薄弱点卡片用它组卷；前置考点「可选加入」也用它（同一口径，不另写一份）。
 *
 * ⚠️ 路径必须比 `/student/:studentId` 更具体，且挂在它之前 —— 否则会被后者吃掉。
 */
router.get('/student/:studentId/retry-questions', async (req, res) => {
  try {
    const { studentId } = req.params
    const kpIds = String(req.query?.kpIds || '').split(',').map(s => s.trim()).filter(s => UUID_RE.test(s))
    if (!UUID_RE.test(String(studentId))) {
      return res.status(400).json({ error: '学生 id 不是合法 uuid' })
    }
    const questionIds = await getRetryQuestionIdsByKp(studentId, kpIds)
    res.json({ success: true, questionIds, total: questionIds.length })
  } catch (error) {
    console.error('获取定向重练题失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/weakness/student/:studentId
 * 获取单个学生的薄弱知识点
 * Query: limit, threshold, subject
 */
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params
    const { limit, threshold, subject } = req.query
    const rows = await getStudentWeakness(studentId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      threshold: threshold ? parseInt(threshold, 10) : undefined,
    })
    // 可选学科过滤
    const filtered = subject ? rows.filter(r => r.subject === subject) : rows
    res.json({ success: true, weakness: filtered })
  } catch (error) {
    console.error('获取学生薄弱点失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/weakness/class
 * 获取全班/全年级薄弱知识点
 * Query: limit, subject
 */
router.get('/class', async (req, res) => {
  try {
    const { limit, subject } = req.query
    const rows = await getClassWeakness({
      limit: limit ? parseInt(limit, 10) : undefined,
      subject: subject || undefined,
    })
    res.json({ success: true, weakness: rows })
  } catch (error) {
    console.error('获取全班薄弱点失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/weakness/recommend
 * 获取「本周最该讲的知识点」推荐列表
 * Query: limit, subject
 */
router.get('/recommend', async (req, res) => {
  try {
    const { limit, subject } = req.query
    const topics = await getRecommendedTopics({
      limit: limit ? parseInt(limit, 10) : undefined,
      subject: subject || undefined,
    })
    res.json({ success: true, topics })
  } catch (error) {
    console.error('获取推荐知识点失败:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router