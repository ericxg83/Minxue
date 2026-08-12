import dayjs from 'dayjs'
import { getQuestionsByIds } from '../services/apiService'
import { triggerBrowserPrint } from './browserPrint'
import { exportServerPDF } from './serverPdfExporter'

/**
 * 错题卷 PDF 公共导出引擎（WrongBookPdfExporter）
 *
 * 统一「周诊断报告·错题再测卷」「移动端错题本·重练卷」「后台自动重练卷」三处生成：
 *   数据源可以不同（周报自动拉取 / 用户手动勾选），但渲染模板、公式解析、样式组件 100% 一致。
 *
 * 【本轮改造：双路径方案 —— 服务端 Playwright + 浏览器原生打印】
 *
 *   之前 html2canvas 是光栅化（PNG/JPEG），KaTeX 用 vlist + 负 margin 渲染的
 *   根号对勾 SVG 实际绘制范围越出 .katex bbox，导致"对勾飘出""\frac 分子丢失"等
 *   系列视觉错位。本轮彻底弃用 html2canvas/jsPDF。
 *
 *   新方案（按环境分流）：
 *     - 开发环境（localhost / import.meta.env.PROD=false）：
 *       主路径 → 服务端 Playwright（exportServerPDF）：客户端跑 KaTeX + QR，
 *       POST HTML 给后端 /api/exam-pdf，后端 Chromium page.pdf() 矢量保留。
 *       fallback → 浏览器原生打印（triggerBrowserPrint）。
 *
 *     - 生产环境（minxue.pages.dev 等线上环境）：
 *       直接走浏览器原生打印（triggerBrowserPrint），避免依赖服务端 Chromium 部署。
 *       浏览器原生 print() 走 Chromium 内置 PDF 引擎，矢量保留，与 PrintPreview 100% 一致。
 *
 *   关键：所有路径都明确选择，不静默 fallback —— 生产环境不会调 exportServerPDF。
 *
 * 职责：
 *   1. 数据标准化 —— 若传入的题目缺 options/几何配图等字段，自动用 getQuestionsByIds 拉取完整数据；
 *   2. 环境分流 —— 开发/生产不同路径，避免生产前端 fetch 不存在的 /api/exam-pdf；
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
 * @param {boolean} [opt.forceServer]  强制走服务端 Playwright（仅开发/测试用）
 * @param {boolean} [opt.forceBrowser] 强制走浏览器原生打印（仅开发/测试用）
 * @returns {Promise<{downloaded|printed: true, filename: string, message?: string, mode: string} | null>}
 *   - 成功：返回 { downloaded/printed: true, filename, message, mode: 'server'|'browser' }
 *   - 失败：返回 null
 */

/**
 * 判断当前是否生产环境
 * - Vite 内置：import.meta.env.PROD（生产 build=true，dev=false）
 * - 用户配置：VITE_APP_ENV === 'production'（在 .env.production 里配了）
 * - 兜底：hostname 不在 localhost/127.0.0.1/常见内网段 → 生产
 *   - 完整覆盖 RFC1918 私有地址段：10.x / 172.16-31.x / 192.168.x
 *   - IPv6 回环 ::1
 */
export function detectProductionEnv() {
  if (import.meta.env?.PROD === true) return true
  if (import.meta.env?.VITE_APP_ENV === 'production') return true
  if (typeof window !== 'undefined') {
    const h = window.location?.hostname || ''
    if (isLocalHostname(h)) return false
  }
  // 其他情况默认生产（更安全：避免线上 fetch 不存在的端点）
  return true
}

/**
 * 判断 hostname 是否属于本地/内网（开发环境）。
 * RFC1918 私有地址：10.0.0.0/8、172.16.0.0/12、192.168.0.0/16
 * 链路本地：169.254.0.0/16
 * 回环：127.0.0.0/8、::1
 */
export function isLocalHostname(h) {
  if (!h) return true // 空字符串（如 file://）按本地处理
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
  if (h.startsWith('192.168.') || h.startsWith('10.')) return true
  // 172.16.0.0/12 = 172.16.0.0 ~ 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  // 链路本地地址（云服务元数据接口等）
  if (h.startsWith('169.254.')) return true
  return false
}

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
  forceServer = false,
  forceBrowser = false,
}) {
  // 0. 环境检测
  const isProd = detectProductionEnv()
  const useServer = (forceServer || (!isProd && !forceBrowser))

  console.log(`[WrongBookPdfExporter] 环境检测 isProd=${isProd} useServer=${useServer} (forceServer=${forceServer} forceBrowser=${forceBrowser})`)

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

  // 3. 按环境分流选择路径
  if (useServer) {
    // 开发环境：主路径 = 服务端 Playwright；失败 fallback 到浏览器原生打印
    try {
      console.log('[WrongBookPdfExporter] 主路径：服务端 Playwright 渲染')
      const result = await exportServerPDF({
        studentId,
        studentName: name,
        questions: qs,
        showAnswers,
        qrContent,
        filename: baseFile,
      })
      return { ...result, filename: baseFile, mode: 'server', message: '服务端 Playwright 渲染完成，已下载 PDF' }
    } catch (serverErr) {
      console.error('[WrongBookPdfExporter] ❌ 服务端 Playwright 渲染失败:', serverErr?.message || serverErr)
      try {
        const { Toast } = await import('antd-mobile')
        Toast.show({
          icon: 'fail',
          content: `服务端 PDF 失败：${serverErr?.message || '未知错误'}，已降级到浏览器打印`,
          duration: 4000,
        })
      } catch { /* 静默忽略 toast 失败 */ }
      // 继续走下面的浏览器原生打印（开发环境允许 fallback）
    }
  } else {
    // 生产环境：明确告知走浏览器原生打印
    console.log('[WrongBookPdfExporter] 生产环境：直接走浏览器原生打印（iframe + window.print，浏览器内置 PDF 引擎，矢量保留）')
  }

  // 5. 浏览器原生打印：走 iframe + window.print()，由浏览器内置 PDF 引擎矢量输出
  //    - 不经过 html2canvas/jsPDF（彻底避免光栅化问题）
  //    - KaTeX 渲染在 iframe 内由浏览器原生 KaTeX + 字体完成
  //    - 用户在打印对话框选"另存为 PDF"即获得与 PrintPreview 100% 一致的 PDF
  try {
    const result = await triggerBrowserPrint({
      title: baseTitle,
      studentName: name,
      questions: qs,
      showAnswers,
      qrContent,
      orientation,
    })
    return { ...result, filename: baseFile, mode: 'browser', message: useServer ? '服务端失败，已降级到浏览器原生打印' : '浏览器原生打印（生产环境方案）' }
  } catch (printErr) {
    console.error('[WrongBookPdfExporter] 浏览器打印也失败:', printErr.message)
    return null
  }
}

/**
 * 按题目 ID 直接导出一份错题卷（快捷入口）。
 */
export async function exportWrongBookPDFByIds({ studentId, studentName, questionIds, title, filename, showAnswers, qrContent, orientation, forceServer, forceBrowser }) {
  return exportWrongBookPDF({
    studentId,
    studentName,
    questionIds,
    title,
    filename,
    showAnswers,
    qrContent,
    orientation,
    forceServer,
    forceBrowser,
  })
}
