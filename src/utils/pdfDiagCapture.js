/**
 * pdfDiagCapture.js —— 纯诊断（不改任何生产 PDF 逻辑）。
 *
 * 用途：在【真实业务调用点】wrongBookPdfExporter.exportWrongBookPDF 调用
 * generateExamPDF() 之前，抓取真正交给 PDF 生成器的题目数据。
 *
 * 每道题打印：
 *  - question id
 *  - question_type / subject
 *  - content（= renderContent 的输入）与 renderContent 的输出 HTML
 *  - options / answer（含 renderContent 输入/输出）
 *  - 原始对象全部字段（可能含 mathText / latex / parsed content / geometry 等）
 *
 * 产物：
 *  - 控制台输出（前缀 [PDF-DIAG]）
 *  - window.__PDF_DIAG_LAST__（供 e2e Playwright 从真实浏览器读取并落盘）
 */
import { renderContent } from './mathText'

function renderDetail(inp) {
  const input = inp == null ? '' : String(inp)
  return {
    input,
    renderContent_output: renderContent(input),
  }
}

export function captureBeforeGenerateExamPDF({ title, studentName, questions, showAnswers, qrContent }) {
  try {
    const list = (Array.isArray(questions) ? questions : []).map((q) => {
      const raw = q && typeof q === 'object' ? q : {}

      const optionsRaw = Array.isArray(raw.options) ? raw.options.map(o => (o == null ? '' : String(o))) : []
      const diag = {
        id: raw.id ?? null,
        question_type: raw.question_type ?? null,
        subject: raw.subject ?? null,
        content: renderDetail(raw.content),
        options: optionsRaw.map(renderDetail),
        answer: renderDetail(raw.answer),
      }

      // 保留原始对象全部字段（含 mathText / latex / parsed content / geometry_svg / image_url 等），
      // 供后续 A/B 与复现使用；跳过函数与已单独拆解的 options，避免冗余/序列化失败。
      const preserved = {}
      for (const k of Object.keys(raw)) {
        const v = raw[k]
        if (typeof v === 'function') continue
        if (k === 'options') continue
        if (v !== undefined) preserved[k] = v
      }

      return { ...diag, raw_question: preserved }
    })

    const payload = {
      capturedAt: new Date().toISOString(),
      count: list.length,
      title,
      studentName,
      showAnswers,
      qrContent,
      questions: list,
    }

    console.log('[PDF-DIAG] ============ 真实题目数据（调用 generateExamPDF 之前抓取）============')
    console.log('[PDF-DIAG] title=%s  studentName=%s  showAnswers=%s  qrContent=%s  count=%d',
      title, studentName, showAnswers, qrContent, list.length)
    list.forEach((q, i) => {
      console.log(`[PDF-DIAG] --- [#${i + 1}] id=${q.id}  type=${q.question_type}  subject=${q.subject}`)
      console.log('[PDF-DIAG]      content_input          :', JSON.stringify(q.content.input))
      console.log('[PDF-DIAG]      content_renderContentout:', q.content.renderContent_output)
      q.options.forEach((o, j) => {
        console.log(`[PDF-DIAG]      opt[${j}] input=`, JSON.stringify(o.input), ' renderContent=', o.renderContent_output)
      })
      if (q.answer.input) {
        console.log('[PDF-DIAG]      answer_input           :', JSON.stringify(q.answer.input))
        console.log('[PDF-DIAG]      answer_renderContent   :', q.answer.renderContent_output)
      }
      // 顺带打印疑似数学/解析字段，若存在
      const suspectKeys = Object.keys(q.raw_question).filter(k => /math|latex|pars|tex/i.test(k))
      if (suspectKeys.length) {
        for (const k of suspectKeys) {
          console.log(`[PDF-DIAG]      raw.${k} =`, JSON.stringify(q.raw_question[k]))
        }
      }
    })
    console.log('[PDF-DIAG] JSON:', JSON.stringify(payload))
    console.log('[PDF-DIAG] ============ END ============')

    try {
      if (typeof window !== 'undefined' && window) window.__PDF_DIAG_LAST__ = payload
    } catch (e) { /* ignore */ }

    return payload
  } catch (e) {
    console.warn('[PDF-DIAG] capture failed:', e)
    return null
  }
}

export default captureBeforeGenerateExamPDF
