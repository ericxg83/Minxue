/**
 * serverPdfExporter.js — 服务端 Playwright 渲染 PDF
 *
 * 【本轮替代 html2canvas + jsPDF 的新方案】
 *
 * 之前 generateExamPDF 走 html2canvas 光栅化路径，KaTeX 的负 margin 越界 SVG
 * 会被 bbox 截断，导致"根号对勾飘出""\frac 分子丢失"等系列视觉错位。
 *
 * 新方案：客户端用浏览器跑 KaTeX + 二维码渲染（与 PrintPreview 共用同一份
 * buildExamHTML/buildPaperBody），把**已经渲染好的完整 HTML** 序列化后 POST 给
 * 后端 /api/exam-pdf。后端用 Playwright 启动 Chromium，用 page.pdf() 输出
 * A4 PDF（矢量保留，KaTeX 数学符号 100% 还原）。
 *
 * 关键设计：
 *  1. 客户端把 KaTeX 字体 woff2 内联成 data: URL（~340KB），保证 Playwright
 *     上下文（base URL = about:blank）也能加载字体；
 *  2. 客户端在 hidden iframe 里跑 KaTeX auto-render + applyQRToContainer +
 *     preloadKatexFonts，等待 fonts.ready；
 *  3. 抓取 iframe document.documentElement.outerHTML 序列化进 POST body；
 *  4. 后端不需重跑 KaTeX，只用 Playwright 渲染已渲染好的 DOM。
 *
 * 优势：与 PrintPreview 100% 视觉一致（同一份 HTML，同一个 KaTeX DOM 序列化结果）。
 */
import {
  buildPaperBody,
  buildPaperCSS,
  renderMathInContainer,
  applyQRToContainer,
  preloadKatexFonts,
  KATEX_FONT_FAMILIES,
} from './pdfGenerator'
import katexCss from 'katex/dist/katex.min.css?inline'
import { getQuestionsByIds } from '../services/apiService'

// KaTeX 字体 base64 缓存（同一会话内复用，避免每次都 fetch 转 base64）
let _katexFontsCssCache = null

/**
 * 把 KaTeX CSS 里的相对字体路径（fonts/KaTeX_*.woff2）替换为 data: URL，
 * 使 HTML 在 Playwright about:blank 上下文下也能加载字体。
 *
 * 性能：20 个 woff2 × ~13KB 平均 = 254KB，base64 后 ~338KB，一次性 fetch + atob + btoa。
 */
export async function getKatexCssWithInlineFonts() {
  if (_katexFontsCssCache) return _katexFontsCssCache

  // 匹配 url(fonts/KaTeX_*.woff2)
  const fontRe = /url\(fonts\/(KaTeX_[A-Za-z0-9_-]+\.woff2)\)/g
  const matches = [...katexCss.matchAll(fontRe)]
  const fontNames = [...new Set(matches.map(m => m[1]))]
  console.log(`[serverPdfExporter] 内联 ${fontNames.length} 个 KaTeX 字体...`)

  // 并发 fetch 所有 woff2，转 base64
  const fontDataUrlMap = new Map()
  await Promise.all(fontNames.map(async (name) => {
    try {
      // 相对于当前页面 URL 解析
      const url = new URL(`/node_modules/katex/dist/fonts/${name}`, window.location.origin).toString()
      const resp = await fetch(url)
      if (!resp.ok) {
        console.warn(`[serverPdfExporter] 字体 fetch 失败 ${name}: ${resp.status}`)
        return
      }
      const buf = await resp.arrayBuffer()
      // ArrayBuffer → base64（分片避免 call stack 溢出）
      const bytes = new Uint8Array(buf)
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
      }
      const b64 = btoa(binary)
      fontDataUrlMap.set(name, `data:font/woff2;base64,${b64}`)
    } catch (e) {
      console.warn(`[serverPdfExporter] 字体 fetch 异常 ${name}:`, e.message)
    }
  }))

  // 替换 CSS 里的 url()
  let inlinedCss = katexCss
  for (const [name, dataUrl] of fontDataUrlMap.entries()) {
    const re = new RegExp(`url\\(fonts\\/${name.replace(/\./g, '\\.')}\\)`, 'g')
    inlinedCss = inlinedCss.replace(re, `url(${dataUrl})`)
  }

  _katexFontsCssCache = inlinedCss
  console.log(`[serverPdfExporter] 字体内联完成，CSS 总长 ${(inlinedCss.length / 1024).toFixed(1)}KB`)
  return _katexFontsCssCache
}

/**
 * 渲染完整 HTML（含 KaTeX 字体 inline + KaTeX 公式 SVG 渲染 + 二维码注入）。
 * 暴露给周报生成器（weeklyReportGenerator）复用同一份渲染逻辑。
 * 与 PrintPreview 完全相同的渲染流程，保证 100% 视觉一致。
 *
 * @returns {Promise<string>} 完整 HTML 字符串
 */
export async function renderFullHTML({ title, studentName, questions, showAnswers, qrContent, embedPaperCssInBody = false }) {
  const inlinedCss = await getKatexCssWithInlineFonts()

  // 创建 hidden iframe（不能用 display:none，否则 KaTeX 渲染不出来）
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:0;top:0;width:794px;z-index:2147483647;background:#fff;opacity:0;pointer-events:none;'
  document.body.appendChild(holder)

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:794px;height:1200px;border:0;background:#fff;display:block;'
  iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
  holder.appendChild(iframe)

  try {
    const iwin = iframe.contentWindow
    const idoc = iwin.document

    // 写入完整 HTML（CSS 已内联字体）
    // embedPaperCssInBody：把 buildPaperCSS 以 .minxue-exam 作用域形式内嵌进 body，
    // 用于周报合并场景——mergeReportHTML 只搬 body 子节点，head 里的 CSS 会被丢弃；
    // 内嵌 scoped 样式既保证再测卷排版与移动端「生成试卷」一致，又不会污染诊断报告的同名类。
    idoc.open()
    const paperBody = buildPaperBody({ title, studentName, questions, showAnswers })
    const scopedBody = embedPaperCssInBody
      ? `<div class="minxue-exam"><style>${buildPaperCSS('.minxue-exam')}</style>${paperBody}</div>`
      : paperBody
    idoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${inlinedCss}\n${buildPaperCSS()}</style></head><body>${scopedBody}</body></html>`)
    idoc.close()

    // 等 DOM ready
    if (idoc.readyState === 'loading') {
      await new Promise((resolve) => {
        const onReady = () => resolve()
        idoc.addEventListener('DOMContentLoaded', onReady, { once: true })
        setTimeout(resolve, 1000)
      })
    }

    // 注入二维码
    if (qrContent) {
      try { applyQRToContainer(idoc, qrContent) } catch (e) {
        console.warn('[serverPdfExporter] QR 注入失败:', e)
      }
    }

    // KaTeX auto-render 解析 $...$ / $$...$$
    try {
      renderMathInContainer(idoc)
    } catch (e) {
      console.warn('[serverPdfExporter] KaTeX 渲染失败:', e)
    }

    // 预加载 KaTeX 字体（等 fonts.ready）
    try {
      await preloadKatexFonts(idoc)
    } catch (e) {
      console.warn('[serverPdfExporter] 字体预加载失败:', e)
    }

    // 等 KaTeX 完成所有度量：2 帧 + 兜底 400ms
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    void idoc.body?.offsetWidth
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise((r) => setTimeout(r, 400))

    // 序列化 outerHTML
    return idoc.documentElement.outerHTML
  } finally {
    setTimeout(() => {
      try { document.body.removeChild(holder) } catch (e) { /* ignore */ }
    }, 100)
  }
}

/**
 * 触发服务端 PDF 渲染（新主路径）。
 *
 * 支持两种调用模式：
 *  模式 A：传入 `questions` 数组（错题卷主流程）
 *    - 自动用 getQuestionsByIds 拉取缺字段的题目
 *    - 用 renderFullHTML 在客户端跑 KaTeX + 二维码生成完整 HTML
 *    - POST 给后端 /api/exam-pdf 渲染
 *
 *  模式 B：传入 `html`（周报合并 HTML 等已构造好的完整页面）
 *    - 跳过 renderFullHTML，直接把传入的 html POST 给后端
 *    - 用于周报等「诊断报告 + 错题再测卷」合并场景
 *
 * `returnPdfBlob`：true 时不触发浏览器下载，把 PDF Blob 返回给调用方（用于周报合并下载）
 *
 * @param {Object} opt
 * @param {string} [opt.studentId]
 * @param {string} [opt.studentName]
 * @param {Array}  [opt.questions]       - 已选题目 JSON（模式 A）
 * @param {string} [opt.html]            - 完整 HTML 字符串（模式 B，优先级最高）
 * @param {boolean} [opt.showAnswers=false]
 * @param {string} [opt.qrContent]
 * @param {string} [opt.filename]        - 下载文件名（不含 .pdf）
 * @param {boolean} [opt.returnPdfBlob=false] - true 时返回 {pdfBlob}，不触发下载
 * @returns {Promise<{downloaded: true, pdfBytes: number, filename: string, pdfBlob?: Blob}>}
 */
export async function exportServerPDF({ studentId, studentName, questions, html, showAnswers = false, qrContent, filename, returnPdfBlob = false }) {
  let finalHtml = html

  // 模式 A：用 questions 构造 HTML（兼容老的错题卷主路径）
  if (!finalHtml) {
    if (!questions || questions.length === 0) {
      throw new Error('没有题目可生成 PDF（需传入 questions 或 html）')
    }

    // 拉取完整题目数据（缺 options 等字段时）
    let qs = questions.slice()
    const ids = qs.map(q => q?.id).filter(Boolean)
    const needsFullData = qs.some(q => !Array.isArray(q.options))
    if (ids.length > 0 && needsFullData) {
      try {
        const fullQs = await getQuestionsByIds(ids, studentId)
        if (fullQs && fullQs.length > 0) {
          const map = {}
          fullQs.forEach(q => { map[q.id] = q })
          qs = qs.map(q => map[q.id] || q)
        }
      } catch (e) {
        console.warn('[serverPdfExporter] 拉取完整题目失败，使用本地数据:', e.message)
      }
    }

    const t0 = Date.now()
    console.log(`[serverPdfExporter] 开始渲染 HTML（${qs.length} 题，模式 A）...`)

    // 1. 客户端跑 KaTeX + QR，得到完整 HTML
    finalHtml = await renderFullHTML({
      title: filename || '错题重练',
      studentName: studentName || '',
      questions: qs,
      showAnswers,
      qrContent,
    })

    console.log(`[serverPdfExporter] HTML 渲染完成 ${Date.now() - t0}ms, ${(finalHtml.length / 1024).toFixed(1)}KB`)
  } else {
    console.log(`[serverPdfExporter] 使用调用方传入的 HTML（模式 B），${(finalHtml.length / 1024).toFixed(1)}KB`)
  }

  // 2. POST 给后端 Playwright
  const API_BASE = import.meta.env.VITE_API_URL || '/api'
  const resp = await fetch(`${API_BASE}/exam-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: finalHtml,
      filename: `${filename || '错题重练'}.pdf`,
      pdfOptions: {
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      },
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`服务端 PDF 渲染失败 (${resp.status}): ${errText.slice(0, 200)}`)
  }

  // 3. 拿到 PDF blob
  const blob = await resp.blob()

  // 4. returnPdfBlob: true → 直接返回 blob（用于周报合并下载）
  if (returnPdfBlob) {
    console.log(`[serverPdfExporter] PDF 已生成（returnPdfBlob 模式），${(blob.size / 1024).toFixed(1)}KB`)
    return { downloaded: true, pdfBytes: blob.size, filename, pdfBlob: blob }
  }

  // 5. 默认：触发浏览器下载
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename || '错题重练'}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const tDownload = Date.now()
  console.log(`[serverPdfExporter] PDF 下载完成 ${Date.now() - tDownload}ms, ${(blob.size / 1024).toFixed(1)}KB`)

  return { downloaded: true, pdfBytes: blob.size, filename }
}
