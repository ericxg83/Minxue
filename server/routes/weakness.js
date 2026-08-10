import { Router } from 'express'
import { getStudentWeakness, getClassWeakness, getRecommendedTopics } from '../services/weaknessService.js'

const router = Router()

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