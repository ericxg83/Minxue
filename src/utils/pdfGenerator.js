import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import qrcode from 'qrcode-generator'
import renderMathInElement from 'katex/dist/contrib/auto-render.mjs'
import katexCss from 'katex/dist/katex.min.css?inline'
import { isSvgCode } from './geometryDisplay'
import { renderContent } from './mathText'

const A4_W = 210
const A4_H = 297
const CONTENT_W = 170

// KaTeX 全部字体族。html2canvas 光栅化前必须显式预加载，否则会回退到
// 系统字体、度量错误，导致根号横线、分数线、上下标错位。
export const KATEX_FONT_FAMILIES = [
  'KaTeX_AMS',
  'KaTeX_Caligraphic',
  'KaTeX_Fraktur',
  'KaTeX_Main',
  'KaTeX_Math',
  'KaTeX_SansSerif',
  'KaTeX_Script',
  'KaTeX_Size1',
  'KaTeX_Size2',
  'KaTeX_Size3',
  'KaTeX_Size4',
  'KaTeX_Typewriter',
]

/** 显式加载 KaTeX 全部数学字体，确保捕获时字形与度量就绪 */
export async function preloadKatexFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return
  try {
    await Promise.all(KATEX_FONT_FAMILIES.map(fam =>
      document.fonts.load(`14px "${fam}"`).then(() => {}).catch(() => {})
    ))
  } catch (e) {
    console.warn('[pdfGenerator] KaTeX 字体预加载失败:', e)
  }
}

/**
 * 取题目配图（题干插图）：仅返回可被 <img> 渲染的 URL 或 data URL。
 * 注意：questions.image_url 是整页试卷扫描图（配合 block_coordinates 用于 PC 端
 * 在原图上定位），不能作为 PDF 里的题目配图。无配图的题目返回 null（不显示图片）。
 */
function getQuestionIllustration(q) {
  if (!q) return null
  if (isSvgCode(q.clean_geometry_svg)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.clean_geometry_svg)}`
  }
  if (q.tikz_svg_url) return q.tikz_svg_url
  if (q.clean_geometry_image_url && /^https?:\/\//.test(q.clean_geometry_image_url)) {
    return q.clean_geometry_image_url
  }
  if (isSvgCode(q.clean_geometry_image_url)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.clean_geometry_image_url)}`
  }
  if (q.geometry_image_url) return q.geometry_image_url
  return null
}

const isRemoteUrl = (u) => !!u && !u.startsWith('data:')

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function hasLetterPrefix(opt) {
  if (!opt) return false
  return /^[A-Da-d][.、)）]\s*/.test(String(opt).trim())
}

function generateQRDataUrl(text, size = 140) {
  try {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    const cellSize = size / qr.getModuleCount()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#000000'

    for (let row = 0; row < qr.getModuleCount(); row++) {
      for (let col = 0; col < qr.getModuleCount(); col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(
            Math.floor(col * cellSize),
            Math.floor(row * cellSize),
            Math.ceil(cellSize),
            Math.ceil(cellSize)
          )
        }
      }
    }

    return canvas.toDataURL('image/png')
  } catch (e) {
    console.warn('QR code generation failed:', e)
    return null
  }
}

/**
 * 用 KaTeX auto-render 解析容器内的 $...$ / $$...$$ 定界符，渲染标准 LaTeX。
 * 与预览（PrintPreview）共用同一个渲染入口，保证 PDF 与预览公式完全一致。
 */
export function renderMathInContainer(container) {
  try {
    renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
      strict: false,
      maxSize: 10,
      maxExpand: 20,
      errorCallback: (err) => {
        console.warn('KaTeX auto-render error:', err)
      },
    })
  } catch (e) {
    console.warn('KaTeX auto-render failed:', e)
  }
}

/** 把二维码注入模板头部（与预览共用），避免每页叠加二维码造成的错位 */
export function applyQRToContainer(container, qrContent) {
  if (!qrContent) return
  const qrImg = container.querySelector('#qr-img')
  const qrContainer = container.querySelector('#qr-container')
  if (qrImg && qrContainer) {
    const qrDataUrl = generateQRDataUrl(qrContent, 260)
    if (qrDataUrl) {
      qrImg.src = qrDataUrl
      qrContainer.style.display = 'block'
    }
  }
}

/**
 * 智能分页：按元素边界切分，不拆分题目和小节标题。
 * @param {number} scrollHeight - 内容总高度（CSS px）
 * @param {number} cssPageH - 每页高度（CSS px）
 * @param {Array<{top:number,bottom:number}>} elementBounds - 所有需要保持完整的元素边界
 * @returns {Array<{start:number,end:number}>} 每页的起止位置
 */
function getPageSlices(scrollHeight, cssPageH, elementBounds) {
  const slices = []
  let y = 0

  while (y < scrollHeight) {
    const pageBottom = y + cssPageH

    // 找到在这一页范围内、底部不超界的最后一个元素
    let lastFitBottom = null
    // 找到在这一页范围内、底部超出页边界的第一个元素（整题移至下一页）
    let firstOverfitTop = null
    // 从 y 起剩余的所有元素是否都能放进当前页
    let allRemainingFit = true

    for (const b of elementBounds) {
      if (b.top >= y && b.top < pageBottom) {
        if (b.bottom <= pageBottom) {
          lastFitBottom = b.bottom
        } else if (firstOverfitTop === null) {
          firstOverfitTop = b.top
        }
      }
      // 还有元素在当前页之后（顶部 >= 当前页底部）→ 剩余未耗尽
      if (b.top >= pageBottom && b.top < scrollHeight) {
        allRemainingFit = false
      }
    }

    // 有元素底部超出当前页 → 剩余内容未耗尽，不能直接吞掉
    if (firstOverfitTop !== null) allRemainingFit = false

    let sliceEnd
    if (allRemainingFit) {
      // 剩余所有元素都能放入当前页 → 直接覆盖到内容末尾，避免产生空白残页
      sliceEnd = scrollHeight
    } else if (lastFitBottom !== null) {
      sliceEnd = lastFitBottom
    } else if (firstOverfitTop !== null) {
      sliceEnd = firstOverfitTop
    } else {
      sliceEnd = pageBottom
    }

    // 防止死循环：保证至少前进 1px
    if (sliceEnd <= y) sliceEnd = Math.min(y + cssPageH, scrollHeight)

    // 防止越界：slice 不能超过内容总高度，否则 drawImage 取到 canvas 外像素会渲染成黑页
    sliceEnd = Math.min(sliceEnd, scrollHeight)

    slices.push({ start: y, end: sliceEnd })
    y = sliceEnd

    // 内容已耗尽则停止（防止生成空白残页）
    if (y >= scrollHeight) break
  }

  return slices
}

/** PDF 与预览共用的试卷样式（模板 CSS） */
export function buildPaperCSS() {
  return `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC','SimSun',sans-serif;color:#1a1a1a}
.page{width:794px;padding:24px 36px;position:relative}
.head-area{min-height:100px;padding-right:170px}
.title{font-size:20px;font-weight:bold;margin-bottom:4px;letter-spacing:1px}
.sub-title{font-size:13px;color:#555;margin-bottom:8px}
.info{display:flex;gap:40px;font-size:14px;margin-bottom:4px}
.info span{display:inline-block}
.info .blank{display:inline-block;width:100px;border-bottom:1px solid #333;margin-left:4px}
.divider{border-top:2px solid #333;margin:4px 0 8px}
.total-info{font-size:13px;color:#666;margin-bottom:8px}
.section-header{font-size:15px;font-weight:bold;margin:8px 0 6px;padding:4px 0 4px 10px;border-left:4px solid #4F46E5;background:#F5F6FF}
.question{margin-bottom:6px;page-break-inside:avoid}
.q-choice{margin-bottom:6px}
.q-fill{margin-bottom:10px}
.q-answer{margin-bottom:14px}
.q-head{display:flex;gap:6px;font-size:13px;line-height:1.7;margin-bottom:2px}
.q-num{font-weight:bold;white-space:nowrap;min-width:26px}
.q-text{flex:1;word-break:break-word}
.q-image{text-align:center;margin:4px 0 4px 32px}
.q-image img{max-width:100%;max-height:180px;object-fit:contain;border-radius:4px}
.opts{display:grid;gap:4px 14px;padding-left:32px;margin-bottom:2px}
.opts-1{grid-template-columns:1fr}
.opts-2{grid-template-columns:1fr 1fr}
.opts-4{grid-template-columns:repeat(4,1fr)}
.opt{font-size:12px;line-height:1.5;word-break:break-word}
.fill-line{width:200px;border-bottom:1.5px solid #333;margin:5px 0 2px 32px;height:26px}
.ans-area{margin:4px 0 2px 32px}
.ans-line{border-bottom:1px solid #d0d0d0;height:28px;margin-bottom:3px}
.answer-key{font-size:12px;color:#4F46E5;margin-top:3px;padding-left:32px}
.footer{text-align:center;font-size:11px;color:#999;margin-top:16px;padding-top:6px;border-top:1px solid #ddd}
.qr-container{position:absolute;top:20px;right:32px;text-align:center;background:#fff;padding:4px}
.qr-canvas{width:130px;height:130px;display:block}
.qr-text{font-size:10px;color:#333;margin-top:3px;font-weight:bold;letter-spacing:1px}`
}

/** 试卷主体 HTML（.page 内容），PDF 与预览共用 */
export function buildPaperBody({ title, studentName, questions, showAnswers }) {
  const choiceQs = questions.filter(q => q.question_type === 'choice')
  const fillQs = questions.filter(q => q.question_type === 'fill')
  const answerQs = questions.filter(q => q.question_type === 'answer')
  let num = 0

  function renderSection(qs, label) {
    if (qs.length === 0) return ''
    let html = `<div class="section-header">${label}</div>`
    qs.forEach(q => {
      num++
      const typeClass = q.question_type === 'choice' ? 'q-choice' : q.question_type === 'fill' ? 'q-fill' : 'q-answer'
      html += `<div class="question ${typeClass}">`
      html += `<div class="q-head"><span class="q-num">${num}.</span><span class="q-text">${renderContent(q.content)}</span></div>`
      const illustration = q._illustration_resolved ?? getQuestionIllustration(q)
      if (illustration) {
        html += `<div class="q-image"><img src="${illustration}" alt="配图" /></div>`
      }
      if (q.options && q.options.length > 0) {
        const maxLen = Math.max(...q.options.map(o => String(o || '').length))
        const cols = maxLen <= 8 ? 4 : maxLen <= 20 ? 2 : 1
        html += `<div class="opts opts-${cols}">`
        q.options.forEach((opt, i) => {
          const label = hasLetterPrefix(opt) ? '' : `${String.fromCharCode(65 + i)}. `
          html += `<span class="opt">${label}${renderContent(opt)}</span>`
        })
        html += `</div>`
      }
      if (q.question_type === 'fill') {
        html += `<div class="fill-line"></div>`
      }
      if (q.question_type === 'answer') {
        html += `<div class="ans-area">`
        // 解答题给足答题空间：行高随文字行数自适应
        const lineCount = q._answerLines || 3
        for (let r = 0; r < lineCount; r++) html += `<div class="ans-line"></div>`
        html += `</div>`
      }
      if (showAnswers && q.answer) {
        html += `<div class="answer-key">参考答案：${renderContent(q.answer)}</div>`
      }
      html += `</div>`
    })
    return html
  }

  return `<div class="page">
    <div id="qr-container" class="qr-container" style="display:none;">
      <img id="qr-img" class="qr-canvas" />
      <div class="qr-text">扫码批改</div>
    </div>
    <div class="head-area">
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub-title">${escapeHtml(studentName)}</div>
      <div class="info">
        <span>姓名：<span class="blank"></span></span>
        <span>班级：<span class="blank"></span></span>
        <span>得分：<span class="blank"></span></span>
      </div>
      <div class="divider"></div>
      <div class="total-info">共 ${questions.length} 题</div>
    </div>
    ${renderSection(choiceQs, '一、选择题')}
    ${renderSection(fillQs, '二、填空题')}
    ${renderSection(answerQs, '三、解答题')}
  </div>
  <div class="footer">敏学错题本 · 智能学习助手</div>`
}

/** 生成完整 HTML 文档（PDF 光栅化用）
 * 关键：必须在 <style> 中内联 KaTeX CSS，否则 html2canvas 把元素复制到
 * clone 文档时，主文档的全局 katex.min.css 不会被复制过去，导致
 * 根号横线、分数线、上下标全部"散架"——预览页正常但 PDF 错乱的根因。
 */
export function buildExamHTML({ title, studentName, questions, showAnswers }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${katexCss}\n${buildPaperCSS()}</style></head><body>${buildPaperBody({ title, studentName, questions, showAnswers })}</body></html>`
}

export async function generateExamPDF({ title, studentName, questions, filename, showAnswers = false, qrContent }) {
  if (!questions || questions.length === 0) {
    throw new Error('没有题目可生成PDF')
  }

  // Convert cross-origin OSS illustration images to base64 data URLs via backend proxy
  const imageMap = new Map()
  const imageUrls = [...new Set(questions.map(getQuestionIllustration).filter(isRemoteUrl))]

  console.log(`开始加载 ${imageUrls.length} 张图片...`)

  await Promise.all(imageUrls.map(async (url) => {
    try {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
      const resp = await fetch(proxyUrl)
      if (resp.ok) {
        const blob = await resp.blob()
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        imageMap.set(url, dataUrl)
        return
      }
    } catch (err) {
      console.warn('Failed to preload image:', url, err.message)
    }

    console.warn('Failed to preload image:', url)
  }))

  console.log(`图片加载完成: ${imageMap.size}/${imageUrls.length}`)

  // Replace remote illustration URLs with data URLs in questions
  const pdfQuestions = questions.map(q => {
    const illustration = getQuestionIllustration(q)
    return {
      ...q,
      _illustration_resolved: illustration && isRemoteUrl(illustration)
        ? (imageMap.get(illustration) || illustration)
        : illustration
    }
  })

  const container = document.createElement('div')
  // 直接构建 DOM，而非用 innerHTML 设置完整 HTML 文档字符串。
  // buildExamHTML 返回的 <!DOCTYPE> / <html> / <head> / <body> 在 div 内会被浏览器
  // 异常解析（style 标签可能不生效、meta 标签可能占位），导致渲染不一致。
  const styleEl = document.createElement('style')
  styleEl.textContent = katexCss + '\n' + buildPaperCSS()
  container.appendChild(styleEl)
  const bodyWrapper = document.createElement('div')
  bodyWrapper.innerHTML = buildPaperBody({ title, studentName, questions: pdfQuestions, showAnswers })
  container.appendChild(bodyWrapper)
  container.style.position = 'absolute'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.width = '794px'
  document.body.appendChild(container)

  try {
    // 调用 applyQRToContainer 让头部 #qr-container 显示并填充二维码。
    // 与预览共用同一入口，保证 PDF 第 1 页头部右上角二维码与预览完全一致。
    //
    // ⚠️ 不再用 jsPDF addImage 在每页叠加二维码——jsPDF 2.5.1 的 addImage Y 坐标用
    // PDF 标准 bottom-left origin（Y 向上），而我们代码假设是 top-left origin（Y 向下），
    // 导致 Y=A4_H-qrSize-6=263mm 被解释为"距底部 263mm"，实际显示在距顶部 6mm 处（页面顶部），
    // 遮挡了第 2/3 页顶部的题目内容——这是"格式错乱"的根因。
    // 改为头部 #qr-container 中渲染二维码（仅第 1 页有），第 2/3 页不叠加，避免遮挡题目。
    applyQRToContainer(container, qrContent)

    // 用 KaTeX auto-render 解析 $...$ / $$...$$ 定界符，渲染标准 LaTeX（与预览共用）
    renderMathInContainer(container)

    // 显式预加载 KaTeX 全部数学字体，确保 html2canvas 捕获时字形与度量正确，
    // 避免根号横线、分数线、上下标错位
    await preloadKatexFonts()
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready } catch (e) { /* ignore */ }
    }

    // ⚠️ 不要直接用 container.scrollHeight 作为渲染高度。
    // 实测在 KaTeX 渲染后某些题目会被换行/撑高，但 container.scrollHeight 在某些边缘
    // 情况下测得的值小于真实内容底部（例如 .question 的 page-break-inside:avoid 让
    // 元素在打印布局下被推到下一页，但浏览器在屏幕布局下又没有完整包含它），
    // 导致 html2canvas 渲染高度不够 → 后端题目被截掉，且 getPageSlices 的 sliceEnd
    // 也会被截短 → 最后一页大量空白、前面页内容错位。
    //
    // 修复：用所有题目元素 rect.bottom 的最大值（相对 container 顶部）作为内容真实高度，
    // 取 container.scrollHeight 与之的较大值，确保 html2canvas 完整渲染所有题目。
    const containerRect0 = container.getBoundingClientRect()
    const _questionEls0 = Array.from(container.querySelectorAll('.question'))
    const _sectionEls0 = Array.from(container.querySelectorAll('.section-header'))
    const _footerEl0 = container.querySelector('.footer')
    let maxBottom = container.scrollHeight
    for (const el of [..._questionEls0, ..._sectionEls0]) {
      const r = el.getBoundingClientRect()
      const bottomRel = r.bottom - containerRect0.top
      if (bottomRel > maxBottom) maxBottom = bottomRel
    }
    if (_footerEl0) {
      const r = _footerEl0.getBoundingClientRect()
      const bottomRel = r.bottom - containerRect0.top
      if (bottomRel > maxBottom) maxBottom = bottomRel
    }
    const renderH = Math.ceil(maxBottom + 8) // +8px 兜底，避免下边框被裁

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: 794,
      height: renderH,
      // 在克隆文档中也触发 KaTeX 字体加载，确保测量布局用的字体度量一致
      onclone: (cloneDoc) => {
        try {
          if (cloneDoc && cloneDoc.fonts && cloneDoc.fonts.load) {
            KATEX_FONT_FAMILIES.forEach(fam =>
              cloneDoc.fonts.load(`14px "${fam}"`).catch(() => {})
            )
          }
        } catch (e) { /* ignore */ }
      },
    })

    // html2canvas scale 参数导致的像素倍率
    const scale = 2
    const cssW = 794
    const cssPageH = (cssW / A4_W) * A4_H          // ~1123 CSS pixels

    // 收集所有需要保持完整的元素边界（题目 + 小节标题），用于智能分页
    // ⚠️ 必须用 getBoundingClientRect 相对 container，而非 offsetTop。
    // offsetTop 相对于 offsetParent（.page 有 position:relative → offsetParent = .page），
    // 不是 container，导致分页裁剪 Y 坐标偏移——这是"预览正常、PDF 错位"的根因。
    const containerRect = container.getBoundingClientRect()
    const questionEls = Array.from(container.querySelectorAll('.question'))
    const sectionEls = Array.from(container.querySelectorAll('.section-header'))
    const elementBounds = [...sectionEls, ...questionEls].map(el => {
      const rect = el.getBoundingClientRect()
      return {
        top: rect.top - containerRect.top,
        bottom: rect.bottom - containerRect.top
      }
    }).sort((a, b) => a.top - b.top)

    // 扫描 canvas 底部，找出实际有内容的最后一行（防止 html2canvas 返回的 canvas 末尾
    // 全是白像素导致最后一页变成大片空白）。从底部往上扫，找到第一个非白行。
    const ctx0 = canvas.getContext('2d')
    const pxData = ctx0.getImageData(0, 0, canvas.width, canvas.height).data
    let contentBottomPx = canvas.height
    for (let py = canvas.height - 1; py >= 0; py--) {
      let rowHasContent = false
      // 每 4 像素采样一次，加速扫描
      for (let px = 0; px < canvas.width; px += 4) {
        const idx = (py * canvas.width + px) * 4
        const r = pxData[idx], g = pxData[idx + 1], b = pxData[idx + 2]
        if (r < 250 || g < 250 || b < 250) {
          rowHasContent = true
          break
        }
      }
      if (rowHasContent) {
        contentBottomPx = py + 1
        break
      }
    }
    // 实际内容高度（CSS px），用作 getPageSlices 的 scrollHeight
    const contentH = Math.min(canvas.height / scale, contentBottomPx / scale)

    const slices = getPageSlices(contentH, cssPageH, elementBounds)

    const doc = new jsPDF('p', 'mm', 'a4')

    for (let p = 0; p < slices.length; p++) {
      if (p > 0) doc.addPage()
      const { start, end } = slices[p]
      const srcY = start * scale
      const sliceH = (end - start) * scale

      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = sliceH
      const ctx = pageCanvas.getContext('2d')
      // 先铺白底，防止 drawImage 源区域越界(取到 canvas 外透明像素)时渲染成黑页
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
      // 裁剪源区域到 canvas 实际高度内，避免取到越界像素
      const srcH = Math.min(sliceH, Math.max(0, canvas.height - srcY))
      if (srcH > 0) {
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH)
      }

      const pageImg = pageCanvas.toDataURL('image/jpeg', 0.95)
      const sliceH_css = sliceH / scale
      const mmH = (sliceH_css / cssW) * A4_W
      doc.addImage(pageImg, 'JPEG', 0, 0, A4_W, mmH)
    }

    // 生成 blob URL 和 blob，由调用方决定如何处理（预览/下载/打印）
    const pdfBlob = doc.output('blob')
    const blobUrl = URL.createObjectURL(pdfBlob)

    return { blobUrl, pdfBlob }
  } finally {
    document.body.removeChild(container)
  }
}
