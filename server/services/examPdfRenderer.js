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
import { withCjkFontFontFace } from './renderFontFace.js'

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
 * 页脚模板里的文本转义。
 * 模板是**拼进 HTML 的字符串**，学生名若含 `& < > "` 会把模板结构撕坏
 * （轻则丢字，重则页脚整块不渲染）。
 */
const escapeFooterHtml = (text) => String(text == null ? '' : text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const FOOTER_FONT = "font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC','SimSun','MinxueCJK',sans-serif;"

/** 页脚左侧标签的姓名上限：再长也不会挤掉右侧页码 */
const FOOTER_LABEL_MAX = 40

/**
 * 页脚左侧标签：`学生：张三`（重练卷每页都能认出是谁的卷子）。
 *
 * 背景（2026-11-04 负责人）：重练卷只有第一页有二维码和姓名抬头，
 * 多页卷子拆开/多人卷子一起打印时分不清哪张属于谁 —— 每页页脚必须带学生名。
 *
 * ⚠️ 只认学生名，**不拿卷名兜底**：卷名在讲义/试卷库/周报等出口是文件名或自定义标题，
 * 顺手印上会把「九上期中-20261104」这类机器名糊到页脚上；没有学生名就只印页码（历史形态）。
 *
 * @param {Object} args
 * @param {string} [args.studentName] 学生名
 * @returns {string} `学生：张三` 或空串
 */
export function buildPaperFooterLabel({ studentName } = {}) {
  const name = String(studentName == null ? '' : studentName).replace(/\s+/g, ' ').trim()
  if (!name) return ''
  // 「学生：」占 3 字，姓名部分吃掉剩余额度 —— 整个标签不超过上限
  return `学生：${name.slice(0, FOOTER_LABEL_MAX - 3)}`
}

/**
 * 页脚模板：左侧 `学生：张三`（可选）+ 右侧 `第 X 页 / 共 Y 页`（错题重练卷专用）。
 *
 * ⛔ Chromium 的 header/footer 模板是**独立文档片段**，有三条硬约束，缺一条页码就不出现：
 *   1. 样式只能内联 —— 页面里的 <style> / 类名（如 buildPaperCSS 的 .footer）在模板里不生效；
 *   2. 模板默认字号 ≈ 0，必须显式写 `font-size`，否则打出来是一片空白；
 *   3. 模板内没有可用字体（Chromium 模板上下文与页面隔离），必须自带 font-family 兜底，
 *      否则中文「第 / 页 / 共 / 学生」在无 CJK 字形的容器里会变方框。
 *
 * `pageNumber` / `totalPages` 是 Chromium 按**真实分页结果**回填的占位类名，
 * 所以「共 Y 页」不需要前端预估页数 —— 也就不会出现估错页码。
 *
 * 页脚画在底部 margin 区域里（不占内容区），因此开启页码**不会让卷子重新分页**。
 *
 * ⚠️ 必须保留 `width:100%`：Chromium 页脚模板的容器是**收缩包裹**的（inline-block 语义），
 * 不写 100% 的话 `display:flex` 没有剩余空间可分配，右侧页码会紧贴学生名后面（实测复现）。
 * 加上 100% 后，容器宽度 = 纸宽 − 左右 margin，两端对齐落在离纸边 12mm 处，左右对称、不出血。
 *
 * @param {string} [label] 左侧标签（`学生：张三`），空串 = 保持历史「居中只印页码」
 */
export function buildPageNumberFooterTemplate(label = '') {
  const text = String(label == null ? '' : label).replace(/\s+/g, ' ').trim()
  if (!text) {
    return '<div style="width:100%;margin:0 12mm;'
      + FOOTER_FONT
      + 'font-size:10px;color:#666;text-align:center;">'
      + '第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页'
      + '</div>'
  }
  return '<div style="width:100%;margin:0 12mm;'
    + FOOTER_FONT
    + 'font-size:10px;color:#666;display:flex;justify-content:space-between;align-items:center;">'
    + `<span style="font-size:12px;font-weight:bold;color:#1a1a1a;white-space:nowrap;">${escapeFooterHtml(text)}</span>`
    + '<span style="white-space:nowrap;">第 <span class="pageNumber"></span> 页 / 共 '
    + '<span class="totalPages"></span> 页</span>'
    + '</div>'
}

/**
 * 把「要不要页码」翻译成 page.pdf() 选项（纯函数，便于直接断言，不用起 Chromium）。
 *
 * - 关闭且调用方没自带 footer 模板 → **原样返回**：周报、试卷库讲义、健康检查等
 *   其它出口行为逐字不变（这是行为保持的红线）。
 * - 开启 → 补 displayHeaderFooter + 空 headerTemplate + 页码页脚。
 *   ⛔ 空 headerTemplate 必须给：Chromium 在 displayHeaderFooter=true 且未提供 header 时，
 *   会打印它自带的「日期 + 标题 + URL」页眉 —— 那是没人要的脏数据。
 * - 调用方自带 footerTemplate 时不覆盖（尊重自定义页脚）。
 *
 * `footerLabel` 只在**已经要出页脚**时才有意义（pageNumbers / displayHeaderFooter /
 * 自带 footerTemplate 三者之一）。仅传标签、不开页码 ⇒ 原样返回，
 * 讲义（pageNumbers=false）不会被顺手印上学生名。
 *
 * @param {Object} [pdfOptions] page.pdf() 选项
 * @param {boolean} [pageNumbers=false]
 * @param {string} [footerLabel=''] 页脚左侧标签（如 `学生：张三`）
 */
export function withPageNumberOptions(pdfOptions = {}, pageNumbers = false, footerLabel = '') {
  const wantsFooter = pageNumbers === true
    || pdfOptions.displayHeaderFooter === true
    || Boolean(pdfOptions.footerTemplate)
  if (!wantsFooter) return pdfOptions
  return {
    ...pdfOptions,
    displayHeaderFooter: true,
    headerTemplate: pdfOptions.headerTemplate || '<div></div>',
    footerTemplate: pdfOptions.footerTemplate || buildPageNumberFooterTemplate(footerLabel),
  }
}

/**
 * 渲染 PDF（核心接口）
 * @param {Object} opt
 * @param {string} opt.html - 完整 HTML 字符串（含 katex CSS）
 * @param {string} [opt.filename='exam.pdf']
 * @param {Object} [opt.pdfOptions] - page.pdf() 额外选项
 * @param {Object} [opt.viewport] - {width, height} 默认 794x1123 (A4 @ 96dpi)
 * @param {boolean} [opt.pageNumbers=false] - 每页页脚印「第 X 页 / 共 Y 页」（错题重练卷用）
 * @param {string} [opt.footerLabel=''] - 页脚左侧标签（学生名等），仅在出页脚时生效
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function renderExamPDF({ html, filename = 'exam.pdf', pdfOptions = {}, viewport = { width: 794, height: 1123 }, pageNumbers = false, footerLabel = '' }) {
  if (!html) throw new Error('renderExamPDF: html 不能为空')
  // 中文字体兜底（服务端 Chromium 没有中文字形，见 renderFontFace.js）
  const pageHtml = withCjkFontFontFace(html)

  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    // puppeteer 用 setViewport，playwright 用 setViewportSize —— 按执行器兼容调用
    if (typeof page.setViewport === 'function') await page.setViewport(viewport)
    else if (typeof page.setViewportSize === 'function') await page.setViewportSize(viewport)
    await page.setContent(pageHtml, { waitUntil: 'load' })

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
    // 页码（错题重练卷）：走 Chromium 原生页脚，只占用底部 margin 的空白，
    // 不改变内容区高度 ⇒ 卷子的分页位置与加页码前逐字相同。
    // ⛔ puppeteer parsePDFOptions 里 format 优先级高于 width/height（有 format 时
    //   width/height 被完全忽略）——调用方显式传了自定义页面尺寸（如讲解版 280×210mm
    //   横版 4:3）就必须去掉 format，否则尺寸不生效、纸型回落 A4。
    const merged = { ...defaultPdfOptions, ...pdfOptions }
    if (pdfOptions?.width || pdfOptions?.height) delete merged.format
    const mergedPdfOptions = withPageNumberOptions(merged, pageNumbers, footerLabel)
    const pdfBuffer = await page.pdf(mergedPdfOptions)
    return pdfBuffer
  } finally {
    await page.close()
  }
}

/**
 * 渲染 PNG 截图（固定尺寸竖版卡片用，如家长分享卡）
 * 与 renderExamPDF 共用常驻 browser；高清输出靠 deviceScaleFactor（默认 2x）。
 * @param {Object} opt
 * @param {string} opt.html - 完整 HTML 字符串（卡片本身自带背景与固定尺寸）
 * @param {number} [opt.width=750] - 视口宽（CSS 像素）
 * @param {number} [opt.height=1334] - 视口高（CSS 像素）
 * @param {number} [opt.scale=2] - deviceScaleFactor（输出物理像素 = CSS × scale）
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function renderHtmlPNG({ html, width = 750, height = 1334, scale = 2 }) {
  if (!html) throw new Error('renderHtmlPNG: html 不能为空')
  // 中文字体兜底（家长分享卡整张卡中文渲染成方框，见 renderFontFace.js）
  const pageHtml = withCjkFontFontFace(html)

  const browser = await getBrowser()
  let page = null
  let context = null
  try {
    const firstPage = await browser.newPage()
    if (typeof firstPage.setViewport === 'function') {
      // puppeteer：viewport 自带 deviceScaleFactor
      page = firstPage
      await page.setViewport({ width, height, deviceScaleFactor: scale })
    } else {
      // playwright：deviceScaleFactor 只能在 context 层设置
      await firstPage.close()
      context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale })
      page = await context.newPage()
    }
    await page.setContent(pageHtml, { waitUntil: 'load' })

    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 120))
    })

    // 视口截图 = 恰好一张卡片（物理尺寸 width*scale × height*scale）
    const shot = await page.screenshot({ type: 'png' })
    return Buffer.from(shot)
  } finally {
    if (page) await page.close().catch(() => {})
    if (context) await context.close().catch(() => {})
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
