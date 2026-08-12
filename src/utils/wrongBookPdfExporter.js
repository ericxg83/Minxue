import dayjs from 'dayjs'
import { getQuestionsByIds } from '../services/apiService'
import { triggerBrowserPrint } from './browserPrint'
import { captureBeforeGenerateExamPDF } from './pdfDiagCapture'
import { exportServerPDF } from './serverPdfExporter'

/**
 * 错题卷 PDF 公共导出引擎（WrongBookPdfExporter）
 *
 * 统一「周诊断报告·错题再测卷」「移动端错题本·重练卷」「后台自动重练卷」三处生成：
 *   数据源可以不同（周报自动拉取 / 用户手动勾选），但渲染模板、公式解析、样式组件 100% 一致。
 *
 * 【本轮改造：html2canvas + jsPDF → 服务端 Playwright + page.pdf()】
 * 之前 generateExamPDF 走 html2canvas 光栅化路径，KaTeX 的负 margin 越界 SVG
 * 会被 bbox 截断，导致"根号对勾飘出""\frac 分子丢失"等系列视觉错位。
 * 即使在 print() 路径下完美，下载 PDF 走的也是错位的 html2canvas 链路。
 *
 * 新方案：
 *   主路径 → 服务端 Playwright（exportServerPDF）：客户端跑 KaTeX + QR 渲染出
 *   完整 HTML，POST 给后端 /api/exam-pdf，后端用 Chromium 矢量渲染 page.pdf()。
 *   视觉与 PrintPreview 100% 一致（同一份 HTML 序列化结果）。
 *   fallback → 浏览器原生 print()（triggerBrowserPrint）：当服务端不可达时降级。
 *
 * 职责：
 *   1. 数据标准化 —— 若传入的题目缺 options/几何配图等字段，自动用 getQuestionsByIds 拉取完整数据；
 *   2. 双路径调度 —— 主走服务端 Playwright，失败时降级到浏览器原生打印；
 *   3. 标题/文件名兜底 —— 未传时按「学生 + 错题重练 + 日期」自动生成。
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
 * @param {string} [opt.orientation] 'portrait' | 'landscape'（保留以兼容旧调用，实际由 PDF 引擎决定）
 * @returns {Promise<{downloaded|printed: true, filename: string, message?: string} | null>}
 *   - 成功：返回 { downloaded/printed: true, filename, message }
 *   - 失败：返回 null
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
  orientation = 'portrait',
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

  // 2. 统一标题/文件名兜底
  const name = studentName || ''
  const baseTitle = title || (name ? `${name} - 错题重练` : '错题重练')
  const baseFile = filename || (name ? `${name}_错题重练_${dayjs().format('YYYYMMDD_HHmm')}` : `错题重练_${dayjs().format('YYYYMMDD_HHmm')}`)

  // 3. 诊断抓取（保留以兼容旧诊断逻辑）
  captureBeforeGenerateExamPDF({
    title: baseTitle,
    studentName: name,
    questions: qs,
    showAnswers,
    qrContent,
  })

  // 4. 主路径：服务端 Playwright 渲染 + 直接下载
  try {
    const result = await exportServerPDF({
      studentId,
      studentName: name,
      questions: qs,
      showAnswers,
      qrContent,
      filename: baseFile,
    })
    return { ...result, filename: baseFile, message: '服务端 Playwright 渲染完成，已下载 PDF' }
  } catch (serverErr) {
    // 主路径失败：详细日志 + Toast 提示用户
    console.error('[WrongBookPdfExporter] ❌ 服务端 Playwright 渲染失败:', serverErr)
    console.error('[WrongBookPdfExporter] 错误堆栈:', serverErr?.stack)
    try {
      const { Toast } = await import('antd-mobile')
      Toast.show({
        icon: 'fail',
        content: `服务端 PDF 失败：${serverErr?.message || '未知错误'}，已降级到浏览器打印`,
        duration: 5000,
      })
    } catch { /* 静默忽略 toast 失败 */ }
  }

  // 5. fallback：浏览器原生打印（让用户在打印对话框"另存为 PDF"）
  // 仅在主路径失败时降级，避免前端打开打印对话框干扰体验
  try {
    console.warn('[WrongBookPdfExporter] ⚠️ 降级到浏览器原生打印（主路径服务端失败）')
    const result = await triggerBrowserPrint({
      title: baseTitle,
      studentName: name,
      questions: qs,
      showAnswers,
      qrContent,
      orientation,
    })
    return { ...result, filename: baseFile, fallback: true, message: '已降级到浏览器打印（服务端失败）' }
  } catch (printErr) {
    console.error('[WrongBookPdfExporter] 浏览器打印也失败:', printErr.message)
    return null
  }
}

/**
 * 按题目 ID 直接导出一份错题卷（快捷入口）。
 */
export async function exportWrongBookPDFByIds({ studentId, studentName, questionIds, title, filename, showAnswers, qrContent, orientation }) {
  return exportWrongBookPDF({
    studentId,
    studentName,
    questionIds,
    title,
    filename,
    showAnswers,
    qrContent,
    orientation,
  })
}
