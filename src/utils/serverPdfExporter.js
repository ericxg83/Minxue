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
} from './pdfGenerator'
import { KATEX_CSS_WITH_FONTS } from './katexCssWithFonts'
import { getQuestionsByIds } from '../services/apiService'
// 排卷字段完整性判据（2026-10-15 事故防御）：缺排卷字段时强制拉全量补齐
import { isMissingRetryLayoutFields } from './retryPaperOrder'

/**
 * 字体已内联的 KaTeX CSS。
 *
 * 【历史事故记录】旧实现用 fetch(new URL('/node_modules/katex/dist/fonts/*.woff2', origin)) 内联字体：
 *   - dev 下 Vite dev server 能伺服 /node_modules → 字体正常；
 *   - 生产构建后站点根本没有 /node_modules 路径 → 全部 404 → 字体不内联 →
 *     后端 Chromium 渲染时 KaTeX 字体加载失败，数学符号出方块（\neq 斜线覆盖层字形）、
 *     字母回退系统斜体 —— 即线上再测卷「a=方块」乱码事故的根因。
 * 现改为构建期 Vite ?inline 静态内联（katexCssWithFonts.js），dev/build 行为一致。
 */
let _katexFontsCssCache = KATEX_CSS_WITH_FONTS

export async function getKatexCssWithInlineFonts() {
  return _katexFontsCssCache
}

/** 等 iframe 文档 ready（写完后 readyState 可能还是 loading）。 */
function waitDocReady(idoc) {
  if (idoc.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => {
    idoc.addEventListener('DOMContentLoaded', () => resolve(), { once: true })
    setTimeout(resolve, 1000)
  })
}

/**
 * 把 body HTML 画进某个文档，并跑完 KaTeX + 字体预加载 + 度量稳定。
 *
 * ⛔ 这是「页面预览」与「导出 PDF」**唯一**的排版入口：
 *    PDF 走 renderViaIframe → 序列化 outerHTML → 服务端 Chromium 出 PDF；
 *    预览走 paintPreviewIntoIframe → 文档留在 iframe 里给老师滚动看。
 *    两者用同一份 bodyHtml + 同一个 buildPaperCSS，所以「预览长什么样、印出来就什么样」。
 *
 * @param {Document} idoc 目标文档（iframe.contentDocument）
 * @param {object} o
 * @param {string} o.bodyHtml
 * @param {string} [o.extraCss] 追加样式（讲义/组卷的专属版式）
 * @param {string} [o.qrContent] 批改二维码（重练卷用）
 */
async function paintDocument(idoc, { bodyHtml, extraCss = '', qrContent, settleMs = 400 }) {
  const inlinedCss = await getKatexCssWithInlineFonts()

  idoc.open()
  idoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${inlinedCss}\n${buildPaperCSS()}\n${extraCss}</style></head><body>${bodyHtml}</body></html>`)
  idoc.close()

  await waitDocReady(idoc)

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

  // 等 KaTeX 完成所有度量：2 帧 + 兜底等待
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  void idoc.body?.offsetWidth
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs))

  return idoc
}

/**
 * 页面内预览：把卷子画进调用方给的 iframe 并**保留**（供滚动/缩放），不序列化。
 *
 * settleMs 传小值：400ms 是给「服务端序列化快照」留的余量，页面预览是活文档、
 * 字体又是内联 data URL，等两帧就够。改题后要立刻看到结果，不能每次都等半秒。
 */
export async function paintPreviewIntoIframe(iframeEl, { bodyHtml, extraCss = '', settleMs = 160 }) {
  const idoc = iframeEl?.contentDocument || iframeEl?.contentWindow?.document
  if (!idoc) throw new Error('预览容器未就绪，请重试')
  return paintDocument(idoc, { bodyHtml, extraCss, settleMs })
}

/**
 * 通用「iframe 渲染管线」：把一段 body HTML 送进隐藏 iframe，
 * 跑 KaTeX auto-render + 二维码注入 + 字体预加载，再把渲染完的 DOM 序列化回来。
 *
 * 为什么必须共用一条管线：KaTeX 的字体预加载与「等度量稳定」这几步是本文件
 * 全部踩坑经验的落点（根号横线错位、分数线上标丢失、生产构建字体 404 出方块）。
 * 任何新出口（如试卷题库讲义）都必须走这里，不能各写一份。
 *
 * @param {object} o
 * @param {string} o.bodyHtml  <body> 内容
 * @param {string} [o.extraCss] 追加在 buildPaperCSS 之后的样式
 * @param {string} [o.qrContent]
 * @returns {Promise<string>} 完整 HTML 字符串
 */
async function renderViaIframe({ bodyHtml, extraCss = '', qrContent }) {
  // 创建 hidden iframe（不能用 display:none，否则 KaTeX 渲染不出来）
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:0;top:0;width:794px;z-index:2147483647;background:#fff;opacity:0;pointer-events:none;'
  document.body.appendChild(holder)

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:794px;height:1200px;border:0;background:#fff;display:block;'
  iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
  holder.appendChild(iframe)

  try {
    const idoc = await paintDocument(iframe.contentDocument, { bodyHtml, extraCss, qrContent })
    // 序列化 outerHTML
    return idoc.documentElement.outerHTML
  } finally {
    setTimeout(() => {
      try { document.body.removeChild(holder) } catch (e) { /* ignore */ }
    }, 100)
  }
}

/**
 * 渲染完整 HTML（含 KaTeX 字体 inline + KaTeX 公式 SVG 渲染 + 二维码注入）。
 * 暴露给周报生成器（weeklyReportGenerator）复用同一份渲染逻辑。
 * 与 PrintPreview 完全相同的渲染流程，保证 100% 视觉一致。
 *
 * @returns {Promise<string>} 完整 HTML 字符串
 */
export async function renderFullHTML({ title, studentName, questions, showAnswers, showAnalysis, qrContent, embedPaperCssInBody = false }) {
  // embedPaperCssInBody：把 buildPaperCSS 以 .minxue-exam 作用域形式内嵌进 body，
  // 用于周报合并场景——mergeReportHTML 只搬 body 子节点，head 里的 CSS 会被丢弃；
  // 内嵌 scoped 样式既保证再测卷排版与移动端「生成试卷」一致，又不会污染诊断报告的同名类。
  const paperBody = buildPaperBody({ title, studentName, questions, showAnswers, showAnalysis })
  const bodyHtml = embedPaperCssInBody
    ? `<div class="minxue-exam"><style>${buildPaperCSS('.minxue-exam')}</style>${paperBody}</div>`
    : paperBody
  return renderViaIframe({ bodyHtml, qrContent })
}

/**
 * 试卷题库「讲义」专用：自定义 body + 追加样式，走同一条 iframe 渲染管线。
 * 2026-10-10 新增。讲义版式见 src/utils/handoutPdf.js
 *（⛔ 它刻意不复用 buildPaperBody —— 那套会按题型重排重编号，会丢原卷题号）。
 */
export async function renderCustomBodyToHTML({ bodyHtml, extraCss = '' }) {
  return renderViaIframe({ bodyHtml, extraCss })
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
 * @param {boolean} [opt.showAnalysis=false] - 教师版：额外印解析与答案来源（不落库、不带二维码）
 * @param {string} [opt.qrContent]
 * @param {string} [opt.filename]        - 下载文件名（不含 .pdf）
 * @param {boolean} [opt.returnPdfBlob=false] - true 时返回 {pdfBlob}，不触发下载
 * @param {boolean} [opt.pageNumbers=false] - 每页页脚印「第 X 页 / 共 Y 页」（错题重练卷用）
 * @returns {Promise<{downloaded: true, pdfBytes: number, filename: string, pdfBlob?: Blob}>}
 */
export async function exportServerPDF({ studentId, studentName, questions, html, showAnswers = false, showAnalysis = false, qrContent, filename, returnPdfBlob = false, pageNumbers = false }) {
  let finalHtml = html

  // 模式 A：用 questions 构造 HTML（兼容老的错题卷主路径）
  if (!finalHtml) {
    if (!questions || questions.length === 0) {
      throw new Error('没有题目可生成 PDF（需传入 questions 或 html）')
    }

    // 拉取完整题目数据（缺 options 等字段时）
    // [2026-10-15 事故防御] 排卷四字段（task_id/page_number/question_number/sub_no）
    // 任一「不存在」也强制补全量：错题本白名单漏过 page_number → 打印连排分叉、
    // 编号与判题整体错位。batch 接口 SELECT q.* 字段齐全，null 合法值不触发。
    let qs = questions.slice()
    const ids = qs.map(q => q?.id).filter(Boolean)
    const needsFullData = qs.some(q => !Array.isArray(q.options) || isMissingRetryLayoutFields(q))
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
      showAnalysis,
      qrContent,
    })

    console.log(`[serverPdfExporter] HTML 渲染完成 ${Date.now() - t0}ms, ${(finalHtml.length / 1024).toFixed(1)}KB`)
  } else {
    console.log(`[serverPdfExporter] 使用调用方传入的 HTML（模式 B），${(finalHtml.length / 1024).toFixed(1)}KB`)
  }

  // 2. POST 给后端 Playwright（带超时：后端冷启动过慢时快速失败，交上层提示重试，
  //    而不是无限挂着让用户以为"卡住了"）
  const API_BASE = import.meta.env.VITE_API_URL || '/api'
  const PDF_RENDER_TIMEOUT_MS = 60000
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), PDF_RENDER_TIMEOUT_MS)
  let resp
  try {
    resp = await fetch(`${API_BASE}/exam-pdf`, {
      method: 'POST',
      signal: abort.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: finalHtml,
        filename: `${filename || '错题重练'}.pdf`,
        // 页码交给后端 Chromium 的 displayHeaderFooter 生成（前端估不准真实页数）
        pageNumbers: pageNumbers === true,
        pdfOptions: {
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
        },
      }),
    })
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('PDF 服务响应超时，请稍后重试')
    throw e
  } finally {
    clearTimeout(timer)
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    let detail = ''
    try {
      const payload = JSON.parse(errText)
      detail = payload.detail || payload.error || ''
    } catch {
      detail = errText.slice(0, 160)
    }
    throw new Error(`PDF 服务返回 ${resp.status}${detail ? `：${detail}` : ''}`)
  }

  // 3. 拿到 PDF blob
  const pdfBytes = new Uint8Array(await resp.arrayBuffer())
  const pdfHeader = new TextDecoder().decode(pdfBytes.subarray(0, 5))
  if (pdfHeader !== '%PDF-') {
    throw new Error(`Server response is not a valid PDF (Content-Type: ${resp.headers.get('content-type') || 'unknown'})`)
  }
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })

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
