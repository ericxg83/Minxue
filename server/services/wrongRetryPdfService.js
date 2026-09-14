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
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { query, TABLES } from '../config/neon.js'
import { renderExamPDF } from './examPdfRenderer.js'
// 多小问（题组）共享题干的展示口径：与 PC 端 / 移动端共用同一套实现，
// 保证「重练卷上的题干」和「错题本卡片上的题干」逐字一致。
import { resolveQuestionDisplayStem, getQuestionGroupKey, extractPrereqRefs, resolvePrereqHints } from '../utils/questionStem.js'
// 重练卷排卷与卷面编号的唯一口径（与判题侧 worker.js processSlimGrading 同源）。
// 2026-09-13 事故：此前本文件自带的「分块 + 编号」逻辑与判题侧的 question_ids
// 顺序各自为政，题型混合时卷面第 N 题 ≠ 判题第 N 题（实测 21/25 份卷整体错位）。
import { buildRetryPaperOrder, RETRY_PAPER_BLOCKS, difficultyStars } from '../utils/retryPaperOrder.js'
// 数学文本规范化：与前端 src/utils/mathText.js 同一份纯函数，
// 保证「服务端重练卷」和「移动端/周报再测卷」的公式排版口径 100% 一致。
import { preprocessMath, splitToSegments } from '../../src/utils/mathText.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * KaTeX CSS 加载（含字体内联）。
 *
 * 【历史缺陷】旧代码用 `require('katex/dist/katex.min.css')` —— 本服务是纯 ESM，
 * require 不存在 → 恒走 catch → KATEX_CSS 恒为空 → PDF 里所有公式完全无样式。
 * 且 katex.min.css 的字体是相对路径 url(fonts/*.woff2)，examPdfRenderer 用
 * page.setContent（base = about:blank）加载时解析不到 → 字体回退 →
 * 数学符号出方块（\neq 斜线覆盖层字形）、字母变系统斜体（"a=方块"乱码事故）。
 *
 * 现改为：createRequire 定位 katex 包内文件 → fs 读取 CSS → 把 20 个 woff2
 * 以 base64 data-URL 内联进 CSS，无任何运行时网络/相对路径依赖。
 */
let KATEX_CSS = ''
try {
  const require = createRequire(import.meta.url)
  const cssPath = require.resolve('katex/dist/katex.min.css')
  let css = readFileSync(cssPath, 'utf8')
  // fonts 目录与 katex.min.css 同级（katex/dist/fonts/），不要去 resolve package.json
  // （部分安装形态下 server/node_modules 有残缺目录，resolve package.json 会误报）
  const fontsDir = cssPath.replace(/katex\.min\.css$/, 'fonts')
  css = css.replace(/url\(fonts\/(KaTeX_[A-Za-z0-9_-]+\.woff2)\)/g, (_, name) => {
    try {
      const buf = readFileSync(`${fontsDir}/${name}`)
      return `url(data:font/woff2;base64,${buf.toString('base64')})`
    } catch (e) {
      console.warn(`[wrongRetryPdf] 字体读取失败 ${name}:`, e.message)
      return _
    }
  })
  KATEX_CSS = css
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

const katexRender = (latex, displayMode) => {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'html' })
  } catch (e) {
    return `<code class="katex-fallback">${escapeHtml(latex)}</code>`
  }
}

/**
 * 服务端 KaTeX 渲染：与前端 src/utils/mathText.js 的 renderContent 完全同口径。
 * 题干多为 OCR 落库的纯文本（无 $...$ 定界符），不能只认 $ 定界 —— 那样整段
 * 公式会以正文中字体直排，符号（² ≠ ≤ 等）在无数学字体的容器里直接变方块。
 * 统一走 preprocessMath（Unicode 上标/√/×÷≥≤≠ → LaTeX）+ splitToSegments
 * （数学片段自动识别），数学片段交 KaTeX，中文等文本片段原样转义输出。
 */
const renderMath = (text) => {
  if (!text) return ''
  const processed = preprocessMath(String(text))
  const segments = splitToSegments(processed)
  const mathSegs = segments.filter((s) => s.isMath && s.text)
  const hasRealText = segments.some((s) => !s.isMath && s.text.trim().length > 0)
  // 独立成行唯一数学片段（如答案行）用块级排版，与前端口径一致
  const standalone = mathSegs.length === 1 && !hasRealText
  return segments
    .map((seg) => (seg.isMath && seg.text ? katexRender(seg.text, standalone) : escapeHtml(seg.text)))
    .join('')
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
.q-diff { color:#F59E0B; font-size:12px; letter-spacing:1px; white-space:nowrap; flex-shrink:0; }
.q-text { flex:1; word-break:break-word; }
.q-stem { font-size:13px; line-height:1.7; margin:0 0 2px 32px; word-break:break-word; }
.q-prereq { font-size:12px; line-height:1.7; color:#0B7285; margin:0 0 2px 32px; word-break:break-word; }
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
  // 排卷 + 卷面编号走唯一口径（server/utils/retryPaperOrder.js），
  // 与判题侧 worker.js processSlimGrading、前端 pdfGenerator/RetryPaperPreview 同源。
  // 分块只重排桶间顺序，桶内保持 questions 原本的相对顺序（= question_ids 顺序）。
  const paperOrder = buildRetryPaperOrder(questions)
  const blocks = RETRY_PAPER_BLOCKS.map((b) => ({
    ...b,
    items: paperOrder.filter((it) => it.blockKey === b.key),
  }))

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
    // 编号与连排判定已在 buildRetryPaperOrder 内完成（与判题侧同源），此处只负责渲染：
    //   · 同一大题的连续小问共用一个编号，写成「10(1).」「10(2).」；
    //   · 公共题干（parent_stem）只渲染一次（组内首题），后继小问不重复；
    //   · 每个小问各自渲染自己的题干与作答区，仍按小问分别计分。
    // 只有单独一问答错被选进来（不成组）时，它自带 parent_stem，
    // 会按「非连排」分支完整渲染公共条件 —— 单题也能作答。
    blk.items.forEach(({ question: q, label, isContinuation }) => {
      const { parentStem, content } = resolveQuestionDisplayStem(q)
      const typeClass = q.question_type === 'choice' ? 'q-choice'
        : q.question_type === 'fill' ? 'q-fill' : 'q-answer'
      html += `<div class="question ${typeClass}">`
      if (parentStem && !isContinuation) {
        html += `<div class="q-stem">${renderMath(parentStem)}</div>`
      }
      // 方案 A：前置小问答案提示（「在(1)的条件下」→ 印出 (1) 的结果作已知条件）
      if (Array.isArray(q._prereq_hints)) {
        for (const h of q._prereq_hints) {
          html += `<div class="q-prereq">已知：第(${h.ref})问的结果为 ${renderMath(h.answer)}</div>`
        }
      }
      // 卷面难度星级（★☆☆ 简单 / ★★☆ 中等 / ★★★ 难）；无难度值时不渲染，避免假难度误导
      const stars = difficultyStars(q.difficulty)
      html += `<div class="q-head"><span class="q-num">${label}.</span>${stars ? `<span class="q-diff">${stars}</span>` : ''}<span class="q-text">${renderMath(content)}</span></div>`
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
 * 选题口径（2026-09-13 队列分层）：默认只允许「待复习(new)」进入每日/手动重练卷；
 * review_1 / review_2（基本掌握）已移出每日池，仅当调用方显式传 includeReview1=true
 * （教师在错题本手动勾选「基本掌握」题纳入）时才放行；mastered 永远拒绝。
 *
 * @param {Object} args
 * @param {string} args.studentId 学生 ID
 * @param {string[]} args.wrongQuestionIds 错题行 ID 列表（wrong_questions.id）
 * @param {boolean} [args.includeReview1=false] 是否允许基本掌握(review_1/review_2)题目入卷（教师手动勾选场景）
 * @param {string} [args.publicBaseUrl] 二维码基址（默认 process.env.PUBLIC_BASE_URL，否则 https://minxue.pages.dev）
 * @returns {Promise<{pdfBuffer: Buffer, examId: string, qrContent: string, studentName: string, count: number}>}
 */
export async function exportWrongRetryPdf({ studentId, wrongQuestionIds, includeReview1 = false, publicBaseUrl }) {
  if (!UUID_RE.test(studentId)) {
    throw new Error('无效的 studentId')
  }
  if (!Array.isArray(wrongQuestionIds) || wrongQuestionIds.length === 0) {
    throw new Error('wrongQuestionIds 不能为空')
  }
  // 全部要 UUID
  const invalid = wrongQuestionIds.find((id) => !UUID_RE.test(String(id)))
  if (invalid) throw new Error(`无效的错题ID: ${invalid}`)

  // 1. 校验 + 拉数据：错题必须属于该学生；选题口径见函数注释（默认排除 mastered/review_1/review_2）
  const { rows: wqRows } = await query(
    // parent_stem / sub_no：多小问大题的共享题干与小问号（迁移 057），
    // 供 buildPaperBody 把小问连排成一个题组块并补回公共条件。
    // ORDER BY：同一大题的小问必须相邻，否则「连排」失效、公共条件会重复渲染。
    //   按 页码 → 题号 → 小问号 排序，NULLS LAST 让缺题号的题沉到末尾。
    `SELECT wq.id, wq.question_id, wq.status,
            COALESCE(wq.lifecycle_status, 'new') AS lifecycle_status,
            s.name AS student_name,
            q.content, q.options, q.answer, q.analysis,
            q.question_type, q.subject, q.difficulty,
            q.parent_stem, q.sub_no, q.question_number, q.task_id, q.page_number,
            q.image_url, q.geometry_image_url,
            q.clean_geometry_svg, q.tikz_svg_url, q.clean_geometry_image_url
     FROM ${TABLES.WRONG_QUESTIONS} wq
     JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
     LEFT JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
     WHERE wq.student_id = $1 AND wq.id = ANY($2::uuid[])
     ORDER BY q.page_number NULLS LAST, q.question_number NULLS LAST, q.sub_no NULLS LAST`,
    [studentId, wrongQuestionIds]
  )

  if (wqRows.length !== wrongQuestionIds.length) {
    const foundIds = new Set(wqRows.map((r) => r.id))
    const missing = wrongQuestionIds.filter((id) => !foundIds.has(id))
    throw new Error(`错题不属于该学生或不存在: ${missing.join(', ')}`)
  }

  // 队列分层（2026-09-13）：每日/手动重练池默认只装「待复习(new)」；
  // 基本掌握(review_1/review_2) 由周报重练卷承载第二次验证，仅显式 opt-in 才入卷。
  const active = includeReview1
    ? wqRows.filter((r) => r.lifecycle_status !== 'mastered')
    : wqRows.filter((r) => r.lifecycle_status === 'new')
  if (active.length === 0) {
    const allMastered = wqRows.length > 0 && wqRows.every((r) => r.lifecycle_status === 'mastered')
    throw new Error(allMastered
      ? '所选错题均已完全掌握，无需重练'
      : '所选错题中没有「待复习」状态的题目（基本掌握的题请通过周回顾重练卷验证，或在请求中显式 includeReview1=true）')
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

  // 3.5 方案 A（2026-09-12 用户拍板）：前置小问联动。
  //     「(1)对 (2)错」时只有 (2) 进重练卷，而 (2) 的题干常写着「在(1)的条件下」，
  //     学生缺 (1) 的数值结论。这里把前置小问的标准答案查出来，渲染时印成
  //     「已知：第(1)问的结果为 …」。前置小问若本身也在本卷（会被连排、学生重做），
  //     resolvePrereqHints 内部会自动跳过、不剧透。
  const needGroups = new Map()
  for (const q of active) {
    if (!q.task_id || q.page_number == null || q.question_number == null) continue
    if (extractPrereqRefs(q.content).length === 0) continue
    const gk = getQuestionGroupKey(q)
    if (!gk) continue
    if (!needGroups.has(gk)) {
      needGroups.set(gk, { task_id: q.task_id, page_number: q.page_number, question_number: q.question_number })
    }
  }
  if (needGroups.size > 0) {
    const tuples = [...needGroups.values()]
    const where = tuples.map((_, i) => `($${i * 3 + 1}::uuid, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ')
    const params = []
    for (const t of tuples) params.push(t.task_id, t.page_number, t.question_number)
    const { rows: siblingRows } = await query(
      `SELECT id, task_id, page_number, question_number, sub_no, answer,
              btrim(coalesce(content, '')) AS content
       FROM ${TABLES.QUESTIONS}
       WHERE (task_id, page_number, question_number) IN (${where})`,
      params
    )
    let injected = 0
    for (const q of active) {
      const hints = resolvePrereqHints(q, siblingRows, active)
      if (hints.length > 0) { q._prereq_hints = hints; injected++ }
    }
    if (injected > 0) console.log(`   [RetryPDF] 前置答案提示已注入 ${injected} 题`)
  }

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