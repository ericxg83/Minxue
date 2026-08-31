import { Router } from 'express'
import { getDashboardClassWeakness, getRetryOverview } from '../services/weaknessService.js'
import { getAttentionStudents } from '../services/dashboardService.js'

const router = Router()

/**
 * GET /api/dashboard/weakness
 * Dashboard 专用：班级薄弱知识点 Top N（含跨年级标签）
 * Query: limit, subject
 */
router.get('/weakness', async (req, res) => {
  try {
    const { limit, subject } = req.query
    const rows = await getDashboardClassWeakness({
      limit: limit ? parseInt(limit, 10) : undefined,
      subject: subject || undefined,
    })
    res.json({ success: true, weakness: rows })
  } catch (error) {
    console.error('[dashboard/weakness] 获取班级薄弱知识点失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/dashboard/retry-overview
 * Dashboard 专用：本周重练效果 3 个数字（已掌握率 / 进行中 / 待重练学生）
 */
router.get('/retry-overview', async (req, res) => {
  try {
    const overview = await getRetryOverview()
    res.json({ success: true, overview })
  } catch (error) {
    console.error('[dashboard/retry-overview] 获取重练概览失败:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/dashboard/attention-students
 * Dashboard 专用：班级 actionable 学生 Top N（待关注升级版）
 * Query: limit
 */
router.get('/attention-students', async (req, res) => {
  try {
    const { limit } = req.query
    const rows = await getAttentionStudents(limit ? parseInt(limit, 10) : 5)
    res.json({ success: true, students: rows })
  } catch (error) {
    console.error('[dashboard/attention-students] 获取 actionable 学生失败:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router