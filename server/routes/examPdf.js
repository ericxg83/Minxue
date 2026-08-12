/**
 * examPdf.js — 试卷 PDF 渲染路由
 *
 * 接收前端 buildExamHTML 生成的完整 HTML（含 katex CSS + buildPaperCSS + buildPaperBody），
 * 用 Playwright 渲染为 A4 PDF 直接返回（application/pdf）。
 *
 * 复用前端所有渲染逻辑（KaTeX auto-render、二维码、A4 排版、智能分页），
 * 避免后端重复实现模板。
 */
import express from 'express'
import { renderExamPDF, closeBrowser } from '../services/examPdfRenderer.js'

const router = express.Router()

/**
 * POST /api/exam-pdf
 * Body: { html: string, filename?: string, pdfOptions?: Object }
 * Response: application/pdf (binary)
 */
router.post('/', async (req, res) => {
  const t0 = Date.now()
  try {
    const { html, filename = 'exam.pdf', pdfOptions } = req.body || {}
    if (!html || typeof html !== 'string') {
      return res.status(400).json({ error: 'html 不能为空（须为 buildExamHTML 生成的完整 HTML）' })
    }
    if (html.length < 100) {
      return res.status(400).json({ error: 'html 长度过短（< 100 字符），可能不包含 buildPaperBody' })
    }
    if (html.length > 2 * 1024 * 1024) {
      // 放宽到 2MB：周报合并 HTML（诊断报告 + 50+ 道错题 + KaTeX 字体 base64 inline）可能接近 1MB
      return res.status(413).json({ error: 'html 长度超过 2MB，请减少题目数量或拆分周报' })
    }

    console.log(`[examPdf] 收到渲染请求 html=${html.length} 字符`)

    const pdfBuffer = await renderExamPDF({ html, filename, pdfOptions })

    const dt = Date.now() - t0
    console.log(`[examPdf] 渲染完成 ${dt}ms, PDF ${pdfBuffer.length} bytes`)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
    res.setHeader('Content-Length', pdfBuffer.length)
    res.setHeader('X-Pdf-Render-Time', `${dt}ms`)
    res.send(pdfBuffer)
  } catch (err) {
    console.error('[examPdf] 渲染失败:', err)
    res.status(500).json({ error: 'PDF 渲染失败', detail: err.message })
  }
})

/**
 * GET /api/exam-pdf/health — 健康检查
 */
router.get('/health', async (req, res) => {
  try {
    const { renderExamPDF } = await import('../services/examPdfRenderer.js')
    // 最小化测试：渲染一个 1x1 像素的 HTML
    const testHtml = '<!DOCTYPE html><html><head></head><body style="margin:0;padding:0;">OK</body></html>'
    const t0 = Date.now()
    const pdf = await renderExamPDF({ html: testHtml, filename: 'health.pdf', viewport: { width: 200, height: 200 } })
    const dt = Date.now() - t0
    res.json({
      ok: true,
      playwrightReady: true,
      renderTime: `${dt}ms`,
      pdfSize: pdf.length,
    })
  } catch (err) {
    res.status(500).json({
      ok: false,
      playwrightReady: false,
      error: err.message,
    })
  }
})

// 进程退出时清理
process.on('SIGTERM', () => closeBrowser())
process.on('SIGINT', () => closeBrowser())

export default router
