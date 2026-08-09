import dayjs from 'dayjs'
import { getQuestionsByIds } from '../services/apiService'
import { generateExamPDF } from './pdfGenerator'

/**
 * 错题卷 PDF 公共导出引擎（WrongBookPdfExporter）
 *
 * 统一「周诊断报告·错题再测卷」「移动端错题本·重练卷」「后台自动重练卷」三处生成：
 *   数据源可以不同（周报自动拉取 / 用户手动勾选），但 PDF 渲染模板、公式解析、样式组件 100% 一致。
 *
 * 职责：
 *   1. 数据标准化 —— 若传入的题目缺 options/几何配图等字段，自动用 getQuestionsByIds 拉取完整数据（与周报告同源）；
 *   2. 唯一渲染出口 —— 全部走 pdfGenerator.generateExamPDF（含 KaTeX 公式解析、智能分页、二维码）；
 *   3. 标题/文件名兜底 —— 未传时按「学生 + 错题重练 + 日期」自动生成，避免各处命名分叉。
 *
 * @param {Object} opt
 * @param {string} [opt.studentId]   学生 ID（拉取完整题目时用于带出掌握度信息，可选）
 * @param {string} [opt.studentName] 学生姓名（PDF 头部）
 * @param {Array}  [opt.questions]   已选题目 JSON（可缺失 options/几何字段，内部自动补齐）
 * @param {Array}  [opt.questionIds] 或只给题目 ID 列表，由内部拉取完整数据
 * @param {string} [opt.title]       试卷标题
 * @param {string} [opt.filename]    导出文件名（不含 .pdf）
 * @param {boolean} [opt.showAnswers] 是否附带参考答案（错题卷默认 false）
 * @param {string} [opt.qrContent]   二维码内容（扫码入口/组卷定位）
 * @returns {Promise<{blobUrl: string, pdfBlob: Blob}|null>} 生成失败返回 null
 */
export async function exportWrongBookPDF({
  studentId,
  studentName,
  questions,
  questionIds,
  title,
  filename,
  showAnswers = false,
  qrContent,
}) {
  // 1. 归一化题目列表：优先直接用调用方传入的 JSON，缺完整字段时按 id 拉取
  let qs = Array.isArray(questions) && questions.length > 0 ? questions.slice() : null
  const ids = (
    qs ? qs.map(q => q && q.id).filter(Boolean)
      : (Array.isArray(questionIds) ? questionIds : [])
  ).filter(Boolean)

  const needsFullData = qs ? qs.some(q => !Array.isArray(q.options)) : true
  if (ids.length > 0 && needsFullData) {
    try {
      const fullQs = await getQuestionsByIds(ids, studentId)
      if (fullQs && fullQs.length > 0) {
        const map = {}
        fullQs.forEach(q => { map[q.id] = q })
        qs = qs ? qs.map(q => map[q.id] || q) : fullQs
      }
    } catch (e) {
      console.warn('[WrongBookPdfExporter] 拉取完整题目失败，使用本地数据:', e.message)
    }
  }

  if (!qs || qs.length === 0) return null

  // 2. 统一标题/文件名兜底，避免各入口命名/样式分叉
  const name = studentName || ''
  const baseTitle = title || (name ? `${name} - 错题重练` : '错题重练')
  const baseFile = filename || (name ? `${name}_错题重练_${dayjs().format('YYYYMMDD_HHmm')}` : `错题重练_${dayjs().format('YYYYMMDD_HHmm')}`)

  // 3. 唯一渲染出口
  return generateExamPDF({
    title: baseTitle,
    studentName: name,
    questions: qs,
    filename: baseFile,
    showAnswers,
    qrContent,
  })
}

/**
 * 按题目 ID 直接导出一份错题卷（快捷入口）。
 * @param {Object} opt 同 exportWrongBookPDF，但以 questionIds 为准
 */
export async function exportWrongBookPDFByIds({ studentId, studentName, questionIds, title, filename, showAnswers, qrContent }) {
  return exportWrongBookPDF({
    studentId,
    studentName,
    questionIds,
    title,
    filename,
    showAnswers,
    qrContent,
  })
}
