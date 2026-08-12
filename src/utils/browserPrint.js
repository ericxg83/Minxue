/**
 * browserPrint.js — 浏览器原生打印导出 PDF
 *
 * 复用 PrintPreview 的渲染方法（隐藏 iframe + KaTeX auto-render + 二维码），
 * 直接调 iframe.contentWindow.print() 触发浏览器原生打印对话框。
 * 用户在对话框选"另存为 PDF"即可获得 100% 矢量、高保真的 PDF。
 *
 * 【本轮替换 html2canvas + jsPDF 链路的根因】
 * html2canvas 是光栅化（PNG/JPEG），KaTeX 用 vlist + 负 margin 渲染的
 * 根号（特别是嵌套 \sqrt 内的 radical-sign SVG）实际绘制范围会越出
 * .katex 根 span 的 getBoundingClientRect bbox。html2canvas 按 bbox
 * 截图时，对勾/分式线/嵌套元素被丢失或错位，导致 PDF 中"根号对勾飘出"
 * "\frac 分子丢失""嵌套 vlist 错位"等系列问题。
 *
 * 浏览器原生打印走矢量路径（Chrome 用 PDF 引擎、Edge/IE 用 XPS 引擎、
 * Safari 用 macOS 打印系统），完全跳过光栅化，KaTeX 渲染的 SVG 100%
 * 原样保留：
 *  - 根号对勾位置正确（在根号主体右上方）
 *  - \frac 分子+分式线完整（border-bottom 不会被截断）
 *  - 嵌套 vlist、上下标、多层 \sqrt 全部正常
 *
 * 缺点：用户需在浏览器打印对话框多一次点击"另存为 PDF"。
 * 这是浏览器标准流程，所有现代浏览器都支持。
 */
import {
  buildExamHTML,
  renderMathInContainer,
  applyQRToContainer,
  preloadKatexFonts,
} from './pdfGenerator'

/**
 * 底层：注入 HTML 到隐藏 iframe，渲染 KaTeX，调 print()
 * @param {Object} opt
 * @param {string} opt.html - 完整 HTML 字符串
 * @param {Object} [opt.container] - 容器（如果 html 是 <body> 内部而非完整 HTML）
 * @param {boolean} [opt.renderMath=true] - 是否在 iframe 内调用 renderMathInContainer 渲染 KaTeX
 * @param {string} [opt.qrContent] - 二维码内容（如果需要）
 */
async function _triggerIframePrint({ html, container, renderMath = true, qrContent }) {
  // 创建隐藏 iframe：不能 display: none（否则 print() 在某些浏览器中不弹对话框）
  // 用 left: 0, top: 0 + 巨大 zIndex，让用户看不见但 print() 能处理
  const holder = document.createElement('div')
  holder.id = 'minxue-print-holder'
  holder.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:794px',
    'z-index:2147483647',
    'background:#fff',
  ].join(';')
  document.body.appendChild(holder)

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:794px;height:1123px;border:0;background:#fff;display:block;'
  holder.appendChild(iframe)

  try {
    const iwin = iframe.contentWindow
    const idoc = iwin.document

    if (container) {
      // 模式 1：传入一个 DOM 元素（已经构建好的 body 内容），把它写到 iframe body
      idoc.open()
      idoc.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>')
      idoc.close()
      idoc.body.appendChild(container.cloneNode(true))
    } else {
      // 模式 2：传入完整 HTML 字符串
      idoc.open()
      idoc.write(html)
      idoc.close()
    }

    // 等 DOM ready
    if (idoc.readyState === 'loading') {
      await new Promise((resolve) => {
        const onReady = () => resolve()
        idoc.addEventListener('DOMContentLoaded', onReady, { once: true })
        setTimeout(resolve, 1000)
      })
    }

    // 注入二维码（如果需要且文档支持）
    if (qrContent) {
      try { applyQRToContainer(idoc, qrContent) } catch (e) {}
    }

    // KaTeX auto-render 解析 $...$ / $$...$$
    if (renderMath) {
      try { renderMathInContainer(idoc) } catch (e) {
        console.warn('[browserPrint] KaTeX 渲染失败:', e)
      }
    }

    // 预加载 KaTeX 字体
    if (renderMath) {
      try { await preloadKatexFonts(idoc) } catch (e) {}
    }

    // 等 KaTeX 完成所有度量：2 帧 + 兜底 400ms
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    void idoc.body?.offsetWidth
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise((r) => setTimeout(r, 400))

    // 触发打印对话框
    iwin.focus()
    iwin.print()

    return {
      printed: true,
      message: '已打开浏览器打印对话框，请在"目标"中选择"另存为 PDF"',
    }
  } finally {
    // 打印对话框关闭后清理（给浏览器 2 秒回收资源）
    setTimeout(() => {
      try {
        document.body.removeChild(holder)
      } catch (e) {
        // holder 已被移除，忽略
      }
    }, 2000)
  }
}

/**
 * 触发浏览器原生打印（标准试卷流程：buildExamHTML + KaTeX + 二维码 + print）
 * @param {Object} opt
 * @param {string} opt.title
 * @param {string} opt.studentName
 * @param {Array}  opt.questions
 * @param {boolean} [opt.showAnswers=false]
 * @param {string} [opt.qrContent]
 * @returns {Promise<{printed: true, message: string}>}
 */
export async function triggerBrowserPrint({ title, studentName, questions, showAnswers = false, qrContent }) {
  if (!questions || questions.length === 0) {
    throw new Error('没有题目可打印')
  }
  const html = buildExamHTML({ title, studentName, questions, showAnswers })
  return _triggerIframePrint({ html, renderMath: true, qrContent })
}

/**
 * 触发浏览器原生打印（自定义 HTML 模式：用于 PaperBank 等自定义布局）
 * @param {Object} opt
 * @param {string} opt.html - 完整 HTML 字符串（含 <style> 和 KaTeX CSS）
 * @param {boolean} [opt.renderMath=true] - 是否在 iframe 内调 renderMathInContainer
 * @returns {Promise<{printed: true, message: string}>}
 */
export async function triggerCustomHTMLPrint({ html, renderMath = true }) {
  return _triggerIframePrint({ html, renderMath })
}
