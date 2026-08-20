/**
 * examPdfRenderer.js — 服务端 PDF 渲染
 *
 * 用 Chromium 的 page.pdf() 输出 A4 PDF（矢量保留 + 完美保真，KaTeX 数学符号 100% 还原），
 * 与 PrintPreview 视觉 100% 一致，跳过 html2canvas 光栅化（避免根号对勾飘出/分子丢失等错位）。
 *
 * 【执行器策略 · 生产优先用打包 Chromium】
 *  - 主执行器：puppeteer-core + @sparticuz/chromium
 *       @sparticuz/chromium 把 Chromium 二进制随 npm 打包进 node_modules，
 *       部署时 npm install 即自动获得，无需在 Render 手动安装浏览器 / 配置环境变量，
 *       也不存在构建(root,HOME=/root) 与运行(HOME=/opt/render) 缓存路径不一致的问题。
 *  - 降级：playwright（本地开发若已 `npx playwright install chromium` 也能跑）。
 */
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

let _browser = null

/** 主执行器：puppeteer-core + @sparticuz/chromium（Chromium 随 npm 打包） */
async function launchBundled() {
  const executablePath = await chromium.executablePath()
  return puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  })
}

/** 降级执行器：Playwright（本地开发已手动 `npx playwright install chromium`） */
async function launchPlaywright() {
  const { chromium: pw } = await import('playwright')
  return pw.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  })
}

/** 单次渲染：复用已启动的 browser 实例（避免每次启动 5-10 秒） */
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser
  for (const launcher of [launchBundled, launchPlaywright]) {
    try {
      _browser = await launcher()
      if (_browser && _browser.isConnected()) return _browser
      _browser = null
    } catch (err) {
      console.warn('[examPdfRenderer] 浏览器启动失败，尝试下一个执行器:', err?.message)
      _browser = null
    }
  }
  throw new Error('无法启动 Chromium（puppeteer-core 与 playwright 均失败）')
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
    // puppeteer 用 setViewport，playwright 用 setViewportSize —— 按执行器兼容调用
    if (typeof page.setViewport === 'function') await page.setViewport(viewport)
    else if (typeof page.setViewportSize === 'function') await page.setViewportSize(viewport)
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
