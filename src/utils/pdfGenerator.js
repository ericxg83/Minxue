import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

const A4_W = 210
const A4_H = 297
const CONTENT_W = 170 // A4_W - 2*20 margin

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
      if (q.options && q.options.length > 0) {
        html += `<div class="opts">`
        q.options.forEach((opt, i) => {
          html += `<span class="opt">${String.fromCharCode(65 + i)}. ${escapeHtml(opt)}</span>`
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
    .page{width:794px;padding:30px 40px}
    .title{text-align:center;font-size:22px;font-weight:bold;margin-bottom:6px;letter-spacing:1px}
    .sub-title{text-align:center;font-size:13px;color:#555;margin-bottom:12px}
    .info{display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px}
    .info span{display:inline-block}
    .info .blank{display:inline-block;width:100px;border-bottom:1px solid #333;margin-left:4px}
    .divider{border-top:2px solid #333;margin:6px 0 10px}
    .total-info{font-size:13px;color:#666;margin-bottom:10px;text-align:right}
    .section-header{font-size:16px;font-weight:bold;margin:14px 0 10px;padding:6px 0 6px 12px;border-left:4px solid #2563EB;background:#f8faff}
    .question{margin-bottom:14px;page-break-inside:avoid}
    .q-head{display:flex;gap:8px;font-size:14px;line-height:1.7;margin-bottom:6px}
    .q-num{font-weight:bold;white-space:nowrap;min-width:28px}
    .q-text{flex:1}
    .opts{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px 12px;padding-left:36px;margin-bottom:4px}
    .opt{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .fill-line{width:160px;border-bottom:1.5px solid #333;margin:6px 0 6px 36px;height:22px}
    .ans-area{margin:6px 0 6px 36px}
    .ans-line{border-bottom:1px solid #d0d0d0;height:30px;margin-bottom:3px}
    .answer-key{font-size:12px;color:#2563EB;margin-top:3px;padding-left:36px}
    .footer{text-align:center;font-size:11px;color:#999;margin-top:20px;padding-top:8px;border-top:1px solid #ddd}
  </style></head><body>
  <div class="page">
    <div class="title">${escapeHtml(title)}</div>
    <div class="sub-title">${escapeHtml(studentName)}</div>
    <div class="info">
      <span>姓名：<span class="blank"></span></span>
      <span>班级：<span class="blank"></span></span>
      <span>得分：<span class="blank"></span></span>
    </div>
    <div class="divider"></div>
    <div class="total-info">共 ${questions.length} 题</div>
    ${renderSection(choiceQs, '一、选择题')}
    ${renderSection(fillQs, '二、填空题')}
    ${renderSection(answerQs, '三、解答题')}
  </div>
  </body></html>`
}

export async function generateExamPDF({ title, studentName, questions, filename, showAnswers = false }) {
  if (!questions || questions.length === 0) {
    throw new Error('没有题目可生成PDF')
  }

  const html = buildExamHTML({ title, studentName, questions, showAnswers })
  const container = document.createElement('div')
  container.innerHTML = html
  container.style.position = 'absolute'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.width = '794px'
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      width: 794,
      height: container.scrollHeight,
    })

    const imgData = canvas.toDataURL('image/jpeg', 0.92)
    const pageH = (794 / A4_W) * A4_H // px height of one A4 page at 794px width
    const totalPages = Math.ceil(canvas.height / pageH)

    const doc = new jsPDF('p', 'mm', 'a4')

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage()
      const srcY = p * pageH
      const sliceH = Math.min(pageH, canvas.height - srcY)

      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = sliceH
      const ctx = pageCanvas.getContext('2d')
      ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH)

      const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
      const mmH = (sliceH / canvas.width) * A4_W
      doc.addImage(pageImg, 'JPEG', 0, 0, A4_W, mmH)
    }

    doc.save(`${filename}.pdf`)
  } finally {
    document.body.removeChild(container)
  }
}
