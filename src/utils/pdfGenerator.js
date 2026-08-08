import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import qrcode from 'qrcode-generator'
import { isSvgCode } from './geometryDisplay'

const A4_W = 210
const A4_H = 297
const CONTENT_W = 170

// LaTeX 命令检测：包含这些反斜杠命令说明是 LaTeX 数学内容
const LATEX_RE = /\\(?:frac|dfrac|tfrac|cfrac|div|times|sqrt|cdot|pm|mp|leq|geq|neq|text|mathrm|left|right|over|begin|end|[a-zA-Z]+)\b/

// 斜杠分数匹配：a/b、3/5、1/(2-√3)、(√3+√2)/(√3-√2)、(9/2)
// 分子/分母支持：括号表达式 | 数字 | 字母 | √前缀项（<>排除，避免误匹配已生成的 HTML 标签）
const SLASH_FRAC_RE = /(\([^()]+\)|[0-9]+(?:\.[0-9]+)?|[a-zA-Z][0-9]*|√[^()\/<>\s]*)\s*\/\s*(\([^()]+\)|[0-9]+(?:\.[0-9]+)?|[a-zA-Z][0-9]*|√[^()\/<>\s]*)/g

/**
 * 渲染内容：检测 LaTeX 命令并转为 HTML，否则纯文本转义。
 * - \frac{a}{b} → 上下堆叠分数（含分数线）
 * - a/b、3/5、1/(2-√3) → 上下堆叠分数（普通斜杠格式，兼容非 LaTeX 数据）
 * - \div → ÷，\times → ×，\cdot → ·
 * - \sqrt{x} → √x
 */
function renderContent(text) {
  if (!text) return ''
  const hasLatex = LATEX_RE.test(text)
  let html = escapeHtml(text)

  if (hasLatex) {
    // 去掉数学定界符
    html = html.replace(/\$\$?/g, '')
    html = html.replace(/\\\(/g, '').replace(/\\\)/g, '')
    html = html.replace(/\\\[/g, '').replace(/\\\]/g, '')

    // 去掉 \left \right（自动缩放括号，HTML 无需）
    html = html.replace(/\\left/g, '').replace(/\\right/g, '')

    // \{ → {，\} → }
    html = html.replace(/\\\{/g, '{').replace(/\\\}/g, '}')

    // 统一分数命令
    html = html.replace(/\\(?:dfrac|tfrac|cfrac)/g, '\\frac')

    // 替换运算符符号
    html = html.replace(/\\div/g, '÷')
    html = html.replace(/\\times/g, '×')
    html = html.replace(/\\cdot/g, '·')
    html = html.replace(/\\pm/g, '±')
    html = html.replace(/\\mp/g, '∓')
    html = html.replace(/\\leq/g, '≤')
    html = html.replace(/\\geq/g, '≥')
    html = html.replace(/\\neq/g, '≠')

    // \text{...} \mathrm{...} → 纯文本
    html = html.replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1')

    // \frac{...}{...} → 上下堆叠分数（多轮处理嵌套）
    let prev
    do {
      prev = html
      html = html.replace(
        /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
        '<span class="frac"><span class="frac-num">$1</span><span class="frac-den">$2</span></span>'
      )
    } while (html !== prev)

    // \sqrt{...} → 根号
    let prevSqrt
    do {
      prevSqrt = html
      html = html.replace(
        /\\sqrt\{([^{}]+)\}/g,
        '<span class="sqrt-wrap">√<span class="sqrt-body">$1</span></span>'
      )
    } while (html !== prevSqrt)
  }

  // 普通斜杠分数 a/b → 上下堆叠（兼容非 LaTeX 数据：3/5、1/(2-√3)、(√3+√2)/(√3-√2)）
  html = convertSlashFractions(html)

  // 清理：去掉包裹已转换分数的多余括号 (2/3) → 2/3
  html = html.replace(
    /\(<span class="frac"><span class="frac-num">[\s\S]*?<\/span><span class="frac-den">[\s\S]*?<\/span><\/span>\)/g,
    (m) => m.slice(1, -1)
  )

  return html
}

/**
 * 将普通斜杠分数转为上下堆叠。多轮处理，避免嵌套残留。
 */
function convertSlashFractions(html) {
  let prev
  let guard = 0
  do {
    prev = html
    html = html.replace(SLASH_FRAC_RE, (m, num, den) => {
      const clean = (s) => (s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s)
      return `<span class="frac"><span class="frac-num">${clean(num)}</span><span class="frac-den">${clean(den)}</span></span>`
    })
    guard++
    if (guard > 20) break
  } while (html !== prev)
  return html
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

    for (const b of elementBounds) {
      if (b.top >= y && b.top < pageBottom) {
        if (b.bottom <= pageBottom) {
          lastFitBottom = b.bottom
        } else if (firstOverfitTop === null) {
          firstOverfitTop = b.top
        }
      }
    }

    let sliceEnd
    if (lastFitBottom !== null) {
      sliceEnd = lastFitBottom
    } else if (firstOverfitTop !== null) {
      sliceEnd = firstOverfitTop
    } else {
      sliceEnd = pageBottom
    }

    // 防止死循环：保证至少前进 1px
    if (sliceEnd <= y) sliceEnd = Math.min(y + cssPageH, scrollHeight)

    slices.push({ start: y, end: sliceEnd })
    y = sliceEnd
  }

  return slices
}

function buildExamHTML({ title, studentName, questions, showAnswers }) {
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

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
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
    .section-header{font-size:15px;font-weight:bold;margin:8px 0 6px;padding:4px 0 4px 10px;border-left:4px solid #2563EB;background:#f8faff}
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
    .answer-key{font-size:12px;color:#2563EB;margin-top:3px;padding-left:32px}
    .footer{text-align:center;font-size:11px;color:#999;margin-top:16px;padding-top:6px;border-top:1px solid #ddd}
    .qr-container{position:absolute;top:20px;right:32px;text-align:center;background:#fff;padding:4px}
    .qr-canvas{width:130px;height:130px;display:block}
    .qr-text{font-size:10px;color:#333;margin-top:3px;font-weight:bold;letter-spacing:1px}
    /* LaTeX 分数渲染 */
    .frac{display:inline-block;vertical-align:middle;text-align:center;margin:0 2px}
    .frac-num{display:block;border-bottom:1.5px solid #1a1a1a;padding:0 4px;line-height:1.2}
    .frac-den{display:block;padding:0 4px;line-height:1.2}
    /* LaTeX 根号渲染 */
    .sqrt-wrap{display:inline-block;position:relative}
    .sqrt-body{border-top:1.5px solid #1a1a1a;padding:1px 3px}
  </style></head><body>
  <div class="page">
    <div id="qr-container" class="qr-container" style="display:none;">
      <canvas id="qr-canvas" class="qr-canvas" width="440" height="440"></canvas>
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
  </body></html>`
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

  const html = buildExamHTML({ title, studentName, questions: pdfQuestions, showAnswers })
  const container = document.createElement('div')
  container.innerHTML = html
  container.style.position = 'absolute'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.width = '794px'
  document.body.appendChild(container)

  try {
    if (qrContent) {
      const qrCanvas = container.querySelector('#qr-canvas')
      const qrContainer = container.querySelector('#qr-container')
      if (qrCanvas && qrContainer) {
        const qr = qrcode(0, 'M')
        qr.addData(qrContent)
        qr.make()

        const size = 440
        qrCanvas.width = size
        qrCanvas.height = size
        const ctx = qrCanvas.getContext('2d')

        // 四周留 4 模块静区（QR 规范要求），提高打印后识别率
        const quietModules = 4
        const cellSize = size / (qr.getModuleCount() + quietModules * 2)
        const offset = cellSize * quietModules
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, size, size)
        ctx.fillStyle = '#000000'

        for (let row = 0; row < qr.getModuleCount(); row++) {
          for (let col = 0; col < qr.getModuleCount(); col++) {
            if (qr.isDark(row, col)) {
              ctx.fillRect(
                Math.floor(offset + col * cellSize),
                Math.floor(offset + row * cellSize),
                Math.ceil(cellSize),
                Math.ceil(cellSize)
              )
            }
          }
        }

        qrContainer.style.display = 'block'
      }
    }

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      width: 794,
      height: container.scrollHeight,
    })

    // html2canvas scale 参数导致的像素倍率
    const scale = 2
    const cssW = 794
    const cssPageH = (cssW / A4_W) * A4_H          // ~1123 CSS pixels

    // 收集所有需要保持完整的元素边界（题目 + 小节标题），用于智能分页
    const questionEls = Array.from(container.querySelectorAll('.question'))
    const sectionEls = Array.from(container.querySelectorAll('.section-header'))
    const elementBounds = [...sectionEls, ...questionEls].map(el => ({
      top: el.offsetTop,
      bottom: el.offsetTop + el.offsetHeight
    })).sort((a, b) => a.top - b.top)

    const slices = getPageSlices(container.scrollHeight, cssPageH, elementBounds)

    const doc = new jsPDF('p', 'mm', 'a4')

    // 生成二维码图片 data URL（每页都需要）
    let qrImgData = null
    if (qrContent) {
      const qr = qrcode(0, 'M')
      qr.addData(qrContent)
      qr.make()

      const size = 120
      const qrCanvas = document.createElement('canvas')
      qrCanvas.width = size
      qrCanvas.height = size
      const ctx = qrCanvas.getContext('2d')

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
      qrImgData = qrCanvas.toDataURL('image/png')
    }

    for (let p = 0; p < slices.length; p++) {
      if (p > 0) doc.addPage()
      const { start, end } = slices[p]
      const srcY = start * scale
      const sliceH = (end - start) * scale

      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = sliceH
      const ctx = pageCanvas.getContext('2d')
      ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH)

      const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
      const sliceH_css = sliceH / scale
      const mmH = (sliceH_css / cssW) * A4_W
      doc.addImage(pageImg, 'JPEG', 0, 0, A4_W, mmH)

      // 在每页右上角添加二维码（小尺寸）
      if (qrImgData) {
        const qrSize = 35
        doc.addImage(qrImgData, 'PNG', A4_W - qrSize - 8, 8, qrSize, qrSize)
      }
    }

    // 生成 blob URL 和 blob，由调用方决定如何处理（预览/下载/打印）
    const pdfBlob = doc.output('blob')
    const blobUrl = URL.createObjectURL(pdfBlob)

    return { blobUrl, pdfBlob }
  } finally {
    document.body.removeChild(container)
  }
}
