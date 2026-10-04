/**
 * shareCard.js — 家长分享卡生成路由
 *
 * POST /api/share-card
 * Body: { studentId, mode='week', offset=0, maskName=false }
 *   - maskName=false → 原图（全名），发给家长本人
 *   - maskName=true  → 转发版（姓名/头像打码烘焙进 PNG），默认对外转发用
 * Response: image/png (binary)
 *
 * 数据与周报完全同源（fetchStudentWeeklyReport），图片不落 OSS、不落库。
 */
import express from 'express'
import { fetchStudentWeeklyReport } from './weeklyReport.js'
import { generateShareCardPNG } from '../services/shareCardService.js'

const router = express.Router()

router.post('/', async (req, res) => {
  const t0 = Date.now()
  try {
    const { studentId, mode = 'week', offset = 0, maskName = false } = req.body || {}
    if (!studentId || typeof studentId !== 'string') {
      return res.status(400).json({ error: 'studentId 不能为空' })
    }

    let reportData
    try {
      reportData = await fetchStudentWeeklyReport(studentId, { mode, offset })
    } catch (e) {
      if (e.statusCode === 404) {
        return res.status(404).json({ error: '学生不存在' })
      }
      throw e
    }

    // ⛔ 取数失败时必须明确失败，绝不能继续渲染（2026-10-04 修）
    // fetchStudentWeeklyReport 的异常分支返回的是 `{ student, stats: null, error }`，
    // **不抛错**。若不拦，模板会把它画成一张「暂无数据」的正常卡片并返回 HTTP 200，
    // 于是：老师看到「生成成功」→ 转发给家长 → 家长看到「孩子这周什么都没做」。
    // 报错老师会重试，错误数据会被当真——后者严重得多。
    // 前端 GrowthCardButton 已有 `!resp.ok → 抛错 + 提示` 分支，这里返回 503 即可，
    // **前端无需改动**。周报接口（weeklyReport.js:297）存在同样问题，已一并记入 backlog。
    if (reportData && reportData.error) {
      console.error(`[shareCard] 取数失败，拒绝渲染 student=${studentId}: ${reportData.error}`)
      return res.status(503).json({
        error: '数据读取失败，这次没有生成卡片，请稍后重试',
        detail: reportData.error,
      })
    }

    const pngBuffer = await generateShareCardPNG(reportData, { maskName: !!maskName })

    const dt = Date.now() - t0
    console.log(`[shareCard] 生成完成 ${dt}ms, PNG ${pngBuffer.length} bytes, maskName=${!!maskName}`)

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Length', pngBuffer.length)
    res.setHeader('X-Card-Render-Time', `${dt}ms`)
    res.send(pngBuffer)
  } catch (err) {
    console.error('[shareCard] 生成失败:', err)
    res.status(500).json({ error: '分享卡生成失败', detail: err.message })
  }
})

export default router
