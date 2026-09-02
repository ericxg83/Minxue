/**
 * wrongQuestionsExport.js — 错题篮导出"重练卷 PDF"路由
 *
 * POST /api/wrong-questions/export-retry-pdf
 *   Body: { studentId: string, wrongQuestionIds: string[] }
 *   Response: application/pdf + X-Exam-Id + X-Qr-Content 头
 *
 * 与移动端 PrintPreview 完全同一路径：
 *   1. 后端校验错题属于该学生 + 都是未掌握
 *   2. INSERT generated_exams（status='draft'）
 *   3. 二维码 URL = ${publicBaseUrl}/retry-task/${examId}
 *   4. 服务端拼 HTML（katex.renderToString + qrcode-generator）+ renderExamPDF
 *   5. 学生扫码 → /api/retry-tasks/:id → 上传答卷 → finalizeGeneratedExamResults → 自动 mastered
 */
import express from 'express'
import { exportWrongRetryPdf } from '../services/wrongRetryPdfService.js'

const router = express.Router()

/**
 * POST /api/wrong-questions/export-retry-pdf
 * 路径写完整避免 app.use('/api/wrong-questions') prefix 与 index.js 内 inline 路由冲突。
 */
router.post('/api/wrong-questions/export-retry-pdf', async (req, res) => {
  const t0 = Date.now()
  try {
    const { studentId, wrongQuestionIds } = req.body || {}
    // 从请求头反推 baseUrl，便于本地调试（前端也允许显式传 publicBaseUrl）
    const publicBaseUrl = req.body?.publicBaseUrl
      || (req.headers.origin && /^https?:\/\//.test(req.headers.origin) ? req.headers.origin : null)

    if (!studentId) {
      return res.status(400).json({ error: '缺少 studentId' })
    }
    if (!Array.isArray(wrongQuestionIds) || wrongQuestionIds.length === 0) {
      return res.status(400).json({ error: '缺少 wrongQuestionIds 数组' })
    }

    const result = await exportWrongRetryPdf({
      studentId,
      wrongQuestionIds,
      publicBaseUrl,
    })

    const dt = Date.now() - t0
    console.log(
      `[wrongExport] 学生 ${result.studentName} 导出重练卷 ${result.count} 题 ` +
      `examId=${result.examId} ${result.pdfBuffer.length} bytes ${dt}ms`
    )

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"`)
    res.setHeader('Content-Length', result.pdfBuffer.length)
    res.setHeader('X-Exam-Id', result.examId)
    res.setHeader('X-Qr-Content', result.qrContent)
    res.setHeader('X-Pdf-Render-Time', `${dt}ms`)
    res.setHeader('X-Student-Name', encodeURIComponent(result.studentName))
    res.send(result.pdfBuffer)
  } catch (err) {
    console.error('[wrongExport] 导出失败:', err)
    res.status(500).json({ error: '导出失败', detail: err.message })
  }
})

export default router