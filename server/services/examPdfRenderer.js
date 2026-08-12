/**
 * examPdfRenderer.js — 服务端 Playwright 渲染 PDF
 *
 * 【本轮改造根因】
 * 客户端 html2canvas 是光栅化（PNG/JPEG），KaTeX 用 vlist + 负 margin 渲染的
 * 根号（特别是嵌套 \sqrt 内的 radical-sign SVG）实际绘制范围会越出
 * .katex 根 span 的 getBoundingClientRect bbox。html2canvas 按 bbox
 * 截图时，对勾/分式线/嵌套元素被丢失或错位，导致 PDF 中"根号对勾飘出"
 * "\frac 分子丢失""嵌套 vlist 错位"等系列问题。
 *
 * Playwright + Chromium 用 page.pdf() 直接走 Chromium 自带 PDF 引擎，
 * 矢量保留 + 完美保真（与 PrintPreview 100% 一致），跳过光栅化：
 *  - 根号对勾位置正确
 *  - \frac 分子+分式线完整
 *  - 嵌套 vlist、上下标、多层 \sqrt 全部正常
 *
 * 【接口设计】
 * 前端用 buildExamHTML 构造完整 HTML（含 katexCss + buildPaperCSS + buildPaperBody），
 * POST 给后端。后端只负责 Playwright 渲染，不重新生成 HTML（避免重复实现模板）。
 *
 * 【部署要求】
 * 1) server 安装 playwright + puppeteer-core（带 chromium binary 体积大）
 * 2) 部署环境需要 chromium binary：
 *    - 本地：`npx playwright install chromium`（已完成，~150MB）
 *    - Render：需要 Dockerfile 用 `mcr.microsoft.com/playwright` 镜像
 *    - Vercel/Fly.io：serverless + @sparticuz/chromium
 */
import { chromium } from 'playwright'

/**
 * 单次渲染：复用 Playwright browser 实例（避免每次启动 5-10 秒）
 */
let _browser = null
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',  // 减小 /dev/shm 占用，serverless 友好
    ],
  })
  return _browser
}

/**
 * 渲染 PDF（核心接口）
 * @param {Object} opt
 * @param {string} opt.html - 完整 HTML 字符串（含 katex CSS）
 * @param {string} [opt.filename='exam.pdf']
 * @param {Object} [opt.pdfOptions] - page.pdf() 额外选项
 * @param {Object} [opt.viewport] - {width, height} 默认 794x1123 (A4 @ 96dpi)
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function renderExamPDF({ html, filename = 'exam.pdf', pdfOptions = {}, viewport = { width: 794, height: 1123 } }) {
  if (!html) throw new Error('renderExamPDF: html 不能为空')

  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setViewportSize(viewport)
    await page.setContent(html, { waitUntil: 'load' })

    // 等 KaTeX 完成所有度量：fonts.ready + 一帧 + 200ms 兜底
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready
      }
      // 等 KaTeX 二次布局
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      // 兜底 200ms（处理 .katex 内部 vlist 重排）
      await new Promise((r) => setTimeout(r, 200))
    })

    // Chromium 内置 PDF 引擎：矢量保留
    const defaultPdfOptions = {
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      preferCSSPageSize: false,
    }
    const pdfBuffer = await page.pdf({ ...defaultPdfOptions, ...pdfOptions })
    return pdfBuffer
  } finally {
    await page.close()
  }
}

/**
 * 关闭 browser（用于 graceful shutdown）
 */
export async function closeBrowser() {
  if (_browser && _browser.isConnected()) {
    await _browser.close()
    _browser = null
  }
}

// 进程退出时清理
process.on('SIGTERM', () => { closeBrowser() })
process.on('SIGINT', () => { closeBrowser() })
