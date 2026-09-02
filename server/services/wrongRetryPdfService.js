/**
 * wrongRetryPdfService.js — 错题篮导出"重练卷 PDF"
 *
 * PC 工作台错题中心：老师勾选未掌握错题 → 一键导出 PDF，
 * PDF 内含 retry-task 二维码 → 学生扫码做题 → 老师批改 → 自动标记掌握。
 *
 * 复用与一致性：
 *   - generated_exams 表（同移动端 PrintPreview 路径）
 *   - examPdfRenderer 服务端 Chromium→PDF
 *   - finalizeGeneratedExamResults 状态机（重练答对 → lifecycle_status='mastered'）
 *
 * 数据来源：wrong_questions JOIN questions JOIN students（只读）
 * 状态写入：仅创建 generated_exams 一行（status='draft'），不写错题本。
 */
import katex from 'katex'
import qrcode from 'qrcode-generator'
import { query, TABLES } from '../config/neon.js'
import { renderExamPDF } from './examPdfRenderer.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// KaTeX 在某些 Vite 把 .css 当 ?inline 处理时会变字符串数组，防御一下
let KATEX_CSS = ''
try {
  const css = require('katex/dist/katex.min.css')
  KATEX_CSS = typeof css === 'string' ? css : (css.default || '')
} catch (e) {
  console.warn('[wrongRetryPdf] KaTeX CSS 加载失败，PDF 可能丢公式样式:', e.message)
}

const escapeHtml = (text) => {
  if (text == null) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 服务端 KaTeX 渲染：把 $$...$$（块级）和 $...$（行内）转成 HTML。
 * 服务端不依赖 KaTeX auto-render 浏览器脚本，避免渲染时序问题。
 */
const renderMath = (text) => {
  if (!text) return ''
  // 先块级 $$..$$（贪婪匹配含换行的公式）
  let out = text.replace(/\$\$([^$]+?)\$\$/g, (_, latex) => {
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        output: 'html',
      })
    } catch (e) {
      return `<code class="katex-fallback">${escapeHtml(latex)}</code>`
    }
  })
  // 再行内 $...$（不含换行、不含 $）
  out = out.replace(/\$([^$\n]+?)\$/g, (_, latex) => {
    try {
      return katex.renderToString(latex, {
        displayMode: false,
        throwOnError: false,
        output: 'html',
      })
    } catch (e) {
      return `<code class="katex-fallback">${escapeHtml(latex)}</code>`
    }
  })
  return out
}

/** 取题目配图：与前端 buildPaperBody.getQuestionIllustration 同口径 */
const getQuestionIllustration = (q) => {
  if (!q) return null
  if (q.clean_geometry_svg && /<svg/i.test(String(q.clean_geometry_svg))) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.clean_geometry_svg)}`
  }
  if (q.tikz_svg_url) return q.tikz_svg_url
  if (q.clean_geometry_image_url && /^https?:\/\//.test(String(q.clean_geometry_image_url))) {
    return q.clean_geometry_image_url
  }
  if (q.clean_geometry_image_url && /<svg/i.test(String(q.clean_geometry_image_url))) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.clean_geometry_image_url)}`
  }
  if (q.geometry_image_url) return q.geometry_image_url
  return null
}

/** options 归一化：数组 / JSON字符串 / null 都安全 */
const normalizeOpts = (raw) => {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** 用 qrcode-generator 生成 SVG 二维码（无需 canvas） */
const makeQrSvg = (text, cellSize = 4, margin = 2) => {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize, margin, scalable: true })
}

/** 简化版试卷样式（与前端 buildPaperCSS 核心字段对齐；不依赖 React/前端组件） */
const buildPaperCSS = () => `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC','SimSun',sans-serif; color:#1a1a1a; padding:24px 36px; }
.page { width:794px; }
.head-area { min-height:80px; padding-right:170px; }
.title { font-size:20px; font-weight:bold; margin-bottom:4px; letter-spacing:1px; }
.sub-title { font-size:13px; color:#555; margin-bottom:8px; }
.info { display:flex; gap:40px; font-size:14px; margin-bottom:4px; }
.info span { display:inline-block; }
.blank { display:inline-block; width:100px; border-bottom:1px solid #333; margin-left:4px; }
.divider { border-top:2px solid #333; margin:4px 0 8px; }
.total-info { font-size:13px; color:#666; margin-bottom:8px; }
.question { margin-bottom:12px; page-break-inside:avoid; }
.q-head { display:flex; gap:6px; font-size:13px; line-height:1.7; margin-bottom:2px; }
.q-num { font-weight:bold; white-space:nowrap; min-width:26px; }
.q-text { flex:1; word-break:break-word; }
.q-image { text-align:center; margin:6px 0 6px 32px; }
.q-image img { max-width:100%; max-height:180px; object-fit:contain; border-radius:4px; }
.opts { display:grid; gap:4px 14px; padding-left:32px; margin-bottom:2px; }
.opts-1 { grid-template-columns:1fr; }
.opts-2 { grid-template-columns:1fr 1fr; }
.opts-4 { grid-template-columns:repeat(4, 1fr); }
.opt { font-size:12px; line-height:1.5; word-break:break-word; }
.fill-line { width:200px; border-bottom:1.5px solid #333; margin:5px 0 2px 32px; height:26px; }
.ans-area { margin:4px 0 2px 32px; }
.ans-line { border-bottom:1px solid #d0d0d0; height:28px; margin-bottom:3px; }
.footer { text-align:center; font-size:11px; color:#999; margin-top:16px; padding-top:6px; border-top:1px solid #ddd; }
.qr-container { position:absolute; top:20px; right:32px; text-align:center; background:#fff; padding:4px; }
.qr-canvas { width:130px; height:130px; display:block; }
.qr-text { font-size:10px; color:#333; margin-top:3px; font-weight:bold; letter-spacing:1px; }
${KATEX_CSS}
`

const buildPaperBody = ({ title, studentName, questions, qrSvg }) => {
  // 按题型分块（与前端 buildPaperBody 保持同结构）
  const blocks = [
    { key: 'choice', label: '一、选择题', items: [] },
    { key: 'fill', label: '二、填空题', items: [] },
    { key: 'answer', label: '三、解答题', items: [] },
  ]
  const map = { choice: blocks[0].items, fill: blocks[1].items, answer: blocks[2].items }
  questions.forEach((q) => {
    const t = q.question_type === 'choice' ? 'choice'
      : q.question_type === 'fill' ? 'fill'
      : q.question_type === 'answer' ? 'answer'
      : 'answer'
    map[t].push(q)
  })

  let num = 0
  let html = `<div class="page">
    ${qrSvg ? `<div class="qr-container">${qrSvg}<div class="qr-text">扫码做题</div></div>` : ''}
    <div class="head-area">
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub-title">${escapeHtml(studentName || '')}</div>
      <div class="info">
        <span>姓名：<span class="blank"></span></span>
        <span>班级：<span class="blank"></span></span>
        <span>得分：<span class="blank"></span></span>
      </div>
      <div class="divider"></div>
      <div class="total-info">共 ${questions.length} 题</div>
    </div>
  `
  blocks.forEach((blk) => {
    if (blk.items.length === 0) return
    html += `<div class="section-header" style="font-size:15px;font-weight:bold;margin:8px 0 6px;padding:4px 0 4px 10px;border-left:4px solid #4F46E5;background:#F5F6FF;">${blk.label}</div>`
    blk.items.forEach((q) => {
      num++
      const typeClass = q.question_type === 'choice' ? 'q-choice'
        : q.question_type === 'fill' ? 'q-fill' : 'q-answer'
      html += `<div class="question ${typeClass}">`
      html += `<div class="q-head"><span class="q-num">${num}.</span><span class="q-text">${renderMath(q.content)}</span></div>`
      const illu = getQuestionIllustration(q)
      if (illu) {
        html += `<div class="q-image"><img src="${escapeHtml(illu)}" alt="配图" /></div>`
      }
      const opts = normalizeOpts(q.options)
      if (opts.length > 0) {
        const maxLen = Math.max(...opts.map((o) => String(o || '').length))
        const cols = maxLen <= 8 ? 4 : maxLen <= 20 ? 2 : 1
        html += `<div class="opts opts-${cols}">`
        opts.forEach((opt, i) => {
          html += `<span class="opt">${String.fromCharCode(65 + i)}. ${renderMath(opt)}</span>`
        })
        html += `</div>`
      }
      if (q.question_type === 'fill') {
        html += `<div class="fill-line"></div>`
      }
      if (q.question_type === 'answer') {
        html += `<div class="ans-area">`
        for (let r = 0; r < 4; r++) html += `<div class="ans-line"></div>`
        html += `</div>`
      }
      html += `</div>`
    })
  })
  html += `</div>
  <div class="footer">敏学错题本 · 智能学习助手</div>`
  return html
}

const buildExamHTML = ({ title, studentName, questions, qrSvg }) => {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${buildPaperCSS()}</style></head><body>${buildPaperBody({ title, studentName, questions, qrSvg })}</body></html>`
}

/**
 * 导出重练卷 PDF
 *
 * @param {Object} args
 * @param {string} args.studentId 学生 ID
 * @param {string[]} args.wrongQuestionIds 错题行 ID 列表（wrong_questions.id）
 * @param {string} [args.publicBaseUrl] 二维码基址（默认 process.env.PUBLIC_BASE_URL，否则 https://minxue.pages.dev）
 * @returns {Promise<{pdfBuffer: Buffer, examId: string, qrContent: string, studentName: string, count: number}>}
 */
export async function exportWrongRetryPdf({ studentId, wrongQuestionIds, publicBaseUrl }) {
  if (!UUID_RE.test(studentId)) {
    throw new Error('无效的 studentId')
  }
  if (!Array.isArray(wrongQuestionIds) || wrongQuestionIds.length === 0) {
    throw new Error('wrongQuestionIds 不能为空')
  }
  // 全部要 UUID
  const invalid = wrongQuestionIds.find((id) => !UUID_RE.test(String(id)))
  if (invalid) throw new Error(`无效的错题ID: ${invalid}`)

  // 1. 校验 + 拉数据：错题必须属于该学生，且 lifecycle_status != 'mastered'
  const { rows: wqRows } = await query(
    `SELECT wq.id, wq.question_id, wq.status,
            COALESCE(wq.lifecycle_status, 'new') AS lifecycle_status,
            s.name AS student_name,
            q.content, q.options, q.answer, q.analysis,
            q.question_type, q.subject,
            q.image_url, q.geometry_image_url,
            q.clean_geometry_svg, q.tikz_svg_url, q.clean_geometry_image_url
     FROM ${TABLES.WRONG_QUESTIONS} wq
     JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
     LEFT JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
     WHERE wq.student_id = $1 AND wq.id = ANY($2::uuid[])`,
    [studentId, wrongQuestionIds]
  )

  if (wqRows.length !== wrongQuestionIds.length) {
    const foundIds = new Set(wqRows.map((r) => r.id))
    const missing = wrongQuestionIds.filter((id) => !foundIds.has(id))
    throw new Error(`错题不属于该学生或不存在: ${missing.join(', ')}`)
  }

  const active = wqRows.filter((r) => r.lifecycle_status !== 'mastered')
  if (active.length === 0) {
    throw new Error('所选错题均已掌握，无需重练')
  }

  const studentName = active[0].student_name
  const questionIds = active.map((r) => r.question_id).filter(Boolean)
  if (questionIds.length === 0) {
    throw new Error('所选错题缺少关联 question_id，无法导出')
  }

  // 2. 创建 generated_exam（status 默认 'draft'；retry_task_id 暂不关联，等学生扫码上传答卷后 link）
  const examName = `${studentName}错题重练-${new Date().toISOString().slice(0, 10)}`
  const { rows: examRows } = await query(
    `INSERT INTO ${TABLES.GENERATED_EXAMS} (student_id, name, question_ids)
     VALUES ($1, $2, $3) RETURNING id`,
    [studentId, examName, JSON.stringify(questionIds)]
  )
  const examId = examRows[0].id

  // 3. 二维码 URL：与移动端 PrintPreview.getRetryTaskUrl 完全一致（/retry-task/{examId}）
  const baseUrl = publicBaseUrl
    || process.env.PUBLIC_BASE_URL
    || 'https://minxue.pages.dev'
  const qrContent = `${baseUrl}/retry-task/${examId}`
  const qrSvg = makeQrSvg(qrContent)

  // 4. 拼 HTML → 出 PDF
  const html = buildExamHTML({
    title: examName,
    studentName,
    questions: active,
    qrSvg,
  })
  const filename = `${examName}.pdf`
  const pdfBuffer = await renderExamPDF({ html, filename })

  return { pdfBuffer, examId, qrContent, studentName, count: active.length, filename }
}