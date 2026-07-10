import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import qrcode from 'qrcode-generator'

const A4_W = 210
const A4_H = 297
const CONTENT_W = 170

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// 判断选项是否已自带字母前缀（如 "A. xxx" / "A、xxx"），避免出现 "A. A. xxx"
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
      html += `<div class="question">`
      html += `<div class="q-head"><span class="q-num">${num}.</span><span class="q-text">${escapeHtml(q.content)}</span></div>`
      if (q.image_url) {
        html += `<div class="q-image"><img src="${q.image_url}" alt="配图" /></div>`
      }
      if (q.options && q.options.length > 0) {
        // 根据选项最大长度决定列数：短则 4 列，中等 2 列，长则 1 列（每项独占一行）
        const maxLen = Math.max(...q.options.map(o => String(o || '').length))
        const cols = maxLen <= 8 ? 4 : maxLen <= 20 ? 2 : 1
        html += `<div class="opts opts-${cols}">`
        q.options.forEach((opt, i) => {
          // 选项已带字母前缀则直接用，否则补 "A. "
          const label = hasLetterPrefix(opt) ? '' : `${String.fromCharCode(65 + i)}. `
          html += `<span class="opt">${label}${escapeHtml(opt)}</span>`
        })
        html += `</div>`
      }
      if (q.question_type === 'fill') {
        html += `<div class="fill-line"></div>`
      }
      if (q.question_type === 'answer') {
        html += `<div class="ans-area">`
        for (let r = 0; r < 5; r++) html += `<div class="ans-line"></div>`
        html += `</div>`
      }
      if (showAnswers && q.answer) {
        html += `<div class="answer-key">参考答案：${escapeHtml(q.answer)}</div>`
      }
      html += `</div>`
    })
    return html
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC','SimSun',sans-serif;color:#1a1a1a}
    .page{width:794px;padding:30px 40px;position:relative}
    /* 顶部预留二维码位置：标题区右侧留出 160px 空间，避免文字与二维码重叠 */
    .head-area{min-height:150px;padding-right:170px}
    .title{font-size:22px;font-weight:bold;margin-bottom:6px;letter-spacing:1px}
    .sub-title{font-size:13px;color:#555;margin-bottom:12px}
    .info{display:flex;gap:40px;font-size:14px;margin-bottom:4px}
    .info span{display:inline-block}
    .info .blank{display:inline-block;width:100px;border-bottom:1px solid #333;margin-left:4px}
    .divider{border-top:2px solid #333;margin:6px 0 10px}
    .total-info{font-size:13px;color:#666;margin-bottom:10px}
    .section-header{font-size:16px;font-weight:bold;margin:14px 0 10px;padding:6px 0 6px 12px;border-left:4px solid #2563EB;background:#f8faff}
    .question{margin-bottom:16px;page-break-inside:avoid}
    .q-head{display:flex;gap:8px;font-size:14px;line-height:1.8;margin-bottom:8px}
    .q-num{font-weight:bold;white-space:nowrap;min-width:28px}
    .q-text{flex:1;word-break:break-word}
    .q-image{text-align:center;margin:8px 0 8px 36px}
    .q-image img{max-width:100%;max-height:250px;object-fit:contain;border-radius:4px}
    .opts{display:grid;gap:8px 16px;padding-left:36px;margin-bottom:4px}
    .opts-1{grid-template-columns:1fr}
    .opts-2{grid-template-columns:1fr 1fr}
    .opts-4{grid-template-columns:repeat(4,1fr)}
    .opt{font-size:13px;line-height:1.6;word-break:break-word}
    .fill-line{width:220px;border-bottom:1.5px solid #333;margin:8px 0 6px 36px;height:24px}
    .ans-area{margin:6px 0 6px 36px}
    .ans-line{border-bottom:1px solid #d0d0d0;height:32px;margin-bottom:4px}
    .answer-key{font-size:12px;color:#2563EB;margin-top:4px;padding-left:36px}
    .footer{text-align:center;font-size:11px;color:#999;margin-top:20px;padding-top:8px;border-top:1px solid #ddd}
    .qr-container{position:absolute;top:24px;right:36px;text-align:center;background:#fff;padding:4px;}
    .qr-canvas{width:150px;height:150px;display:block;}
    .qr-text{font-size:11px;color:#333;margin-top:4px;font-weight:bold;letter-spacing:1px;}
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

  // Convert cross-origin OSS images to base64 data URLs via backend proxy
  // The backend /api/proxy-image fetches images from OSS (no CORS needed server-side)
  const imageMap = new Map()
  const imageUrls = [...new Set(questions.map(q => q.image_url).filter(Boolean))]
  
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
    } catch {}
    
    console.warn('Failed to preload image:', url)
  }))

  // Replace image URLs with data URLs in questions
  const pdfQuestions = questions.map(q => ({
    ...q,
    image_url: q.image_url ? (imageMap.get(q.image_url) || q.image_url) : null
  }))

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
    const cssPageH = (cssW / A4_W) * A4_H          // 1123 CSS pixels
    const actualPageH = cssPageH * scale            // 2246 actual canvas pixels
    const totalPages = Math.ceil(canvas.height / actualPageH)

    const doc = new jsPDF('p', 'mm', 'a4')

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage()
      const srcY = p * actualPageH
      const sliceH = Math.min(actualPageH, canvas.height - srcY)

      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = sliceH
      const ctx = pageCanvas.getContext('2d')
      ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH)

      const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
      // 正确的 mm 高度计算：在 CSS 像素空间下计算
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
