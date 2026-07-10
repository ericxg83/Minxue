import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import { PDFDocument } from 'pdf-lib'
import { generateExamPDF } from './pdfGenerator'
import { getQuestionsByIds, createGeneratedExam } from '../services/apiService'
import dayjs from 'dayjs'

const A4_W = 210
const A4_H = 297

/**
 * 生成诊断报告 HTML 内容
 * 第一页：学习概览，第二页：知识点诊断
 */
function buildDiagnosisHTML(reportData) {
  const { student, period, stats, knowledgeDiagnosis } = reportData
  const weekNum = dayjs(period.start).isoWeek()
  const accuracyColor = stats.accuracy >= 80 ? '#16A34A' : stats.accuracy >= 60 ? '#D97706' : '#DC2626'

  // 知识点诊断行
  const knowledgeRows = (knowledgeDiagnosis || []).map(kp => {
    const kpAccuracy = kp.accuracy
    const barColor = kpAccuracy >= 80 ? '#16A34A' : kpAccuracy >= 60 ? '#D97706' : '#DC2626'
    return `
      <tr>
        <td>${escapeHtml(kp.tag)}</td>
        <td>${kp.totalCount} 题</td>
        <td>${kp.wrongCount} 次</td>
        <td style="color: ${barColor}; font-weight: 600;">${kpAccuracy}%</td>
        <td>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: ${kpAccuracy}%; background: ${barColor};"></div>
          </div>
        </td>
      </tr>
    `
  }).join('')

  const hasKnowledgeData = knowledgeDiagnosis && knowledgeDiagnosis.length > 0

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC','SimSun',sans-serif;color:#1a1a1a;background:#fff}
  .page{width:794px;padding:40px;position:relative}

  /* 第一页：学习概览 */
  .report-header{text-align:center;margin-bottom:24px}
  .report-title{font-size:24px;font-weight:bold;color:#1E293B;letter-spacing:2px}
  .report-subtitle{font-size:13px;color:#64748B;margin-top:6px}
  .divider{border-top:2px solid #E2E8F0;margin:16px 0}

  /* 学生信息区 */
  .student-info{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:#F8FAFC;border-radius:12px;margin-bottom:20px}
  .student-name{font-size:18px;font-weight:bold;color:#1E293B}
  .student-meta{font-size:13px;color:#64748B;margin-top:4px}
  .period-badge{font-size:12px;color:#2563EB;background:#EFF6FF;padding:6px 14px;border-radius:20px;font-weight:500}

  /* KPI 卡片 */
  .kpi-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px}
  .kpi-card{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:16px;text-align:center}
  .kpi-card .kpi-value{font-size:28px;font-weight:700;margin:4px 0}
  .kpi-card .kpi-label{font-size:12px;color:#64748B}
  .kpi-card .kpi-unit{font-size:14px;font-weight:400;color:#94A3B8}

  .kpi-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}
  .kpi-card-half{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:16px;text-align:center}

  /* 作业详情 */
  .detail-section{background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:20px;margin-bottom:16px}
  .detail-section .section-title{font-size:15px;font-weight:600;color:#1E293B;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #F1F5F9}
  .detail-row{display:flex;justify-content:space-between;padding:8px 0;font-size:14px}
  .detail-row .label{color:#64748B}
  .detail-row .value{color:#1E293B;font-weight:500}

  /* 正确率大圆环 */
  .accuracy-ring{display:flex;align-items:center;justify-content:center;gap:20px;margin:16px 0}
  .ring-chart{width:100px;height:100px;border-radius:50%;background:conic-gradient(${accuracyColor} ${stats.accuracy * 3.6}deg, #F1F5F9 ${stats.accuracy * 3.6}deg);display:flex;align-items:center;justify-content:center;position:relative}
  .ring-chart::before{content:'';position:absolute;width:72px;height:72px;border-radius:50%;background:#fff}
  .ring-text{position:relative;z-index:1;font-size:22px;font-weight:700;color:${accuracyColor}}
  .ring-label{font-size:12px;color:#64748B}

  /* 第二页：知识点诊断 */
  .page-break{page-break-before:always;padding-top:40px}
  .knowledge-table{width:100%;border-collapse:collapse;font-size:13px}
  .knowledge-table th{background:#F8FAFC;padding:10px 12px;text-align:left;font-weight:600;color:#475569;border-bottom:2px solid #E2E8F0}
  .knowledge-table td{padding:10px 12px;border-bottom:1px solid #F1F5F9;color:#334155}
  .knowledge-table tr:last-child td{border-bottom:none}
  .progress-bar-bg{width:100%;height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden}
  .progress-bar-fill{height:100%;border-radius:4px;transition:width 0.3s}

  .empty-state{text-align:center;padding:40px;color:#94A3B8;font-size:14px}
  .empty-state .empty-icon{font-size:48px;margin-bottom:12px}

  .footer-text{text-align:center;font-size:11px;color:#94A3B8;margin-top:24px;padding-top:12px;border-top:1px solid #F1F5F9}
</style></head><body>
  <!-- 第一页 -->
  <div class="page">
    <div class="report-header">
      <div class="report-title">📖 周学习诊断报告</div>
      <div class="report-subtitle">敏学智能学习系统 · 自动生成</div>
    </div>

    <div class="student-info">
      <div>
        <div class="student-name">${escapeHtml(student.name)}</div>
        <div class="student-meta">${student.grade || ''}${student.class ? ' · ' + escapeHtml(student.class) : ''}</div>
      </div>
      <div class="period-badge">第 ${weekNum} 周 · ${period.start} ~ ${period.end}</div>
    </div>

    <div class="divider"></div>

    <!-- 正确率 -->
    <div class="accuracy-ring">
      <div class="ring-chart">
        <div class="ring-text">${stats.accuracy}%</div>
      </div>
      <div>
        <div class="ring-label">本周正确率</div>
        <div style="font-size:13px;color:#64748B;margin-top:4px;">
          正确 ${stats.correctCount} 题 / 共 ${stats.totalQuestions} 题
        </div>
      </div>
    </div>

    <!-- KPI 卡片：三列 -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">本周作业</div>
        <div class="kpi-value">${stats.totalTasks}<span class="kpi-unit"> 份</span></div>
        <div style="font-size:12px;color:#64748B;">已完成 ${stats.completedTasks} 份</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">新增错题</div>
        <div class="kpi-value" style="color:${stats.newWrongCount > 0 ? '#DC2626' : '#16A34A'}">${stats.newWrongCount}<span class="kpi-unit"> 题</span></div>
        <div style="font-size:12px;color:#64748B;">本周新收录</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">已掌握</div>
        <div class="kpi-value" style="color:#16A34A">${stats.masteredCount}<span class="kpi-unit"> 题</span></div>
        <div style="font-size:12px;color:#64748B;">待提升 ${stats.pendingCount} 题</div>
      </div>
    </div>

    <!-- 作业与批改详情 -->
    <div class="detail-section">
      <div class="section-title">📋 学习详情</div>
      <div class="detail-row">
        <span class="label">作业完成情况</span>
        <span class="value">${stats.completedTasks} / ${stats.totalTasks} 份${stats.totalTasks > 0 && stats.completedTasks < stats.totalTasks ? '（还有 ' + (stats.totalTasks - stats.completedTasks) + ' 份批改中）' : ''}</span>
      </div>
      <div class="detail-row">
        <span class="label">总批改题量</span>
        <span class="value">${stats.totalQuestions} 题</span>
      </div>
      <div class="detail-row">
        <span class="label">正确题数</span>
        <span class="value" style="color:#16A34A">${stats.correctCount} 题</span>
      </div>
      <div class="detail-row">
        <span class="label">错误题数</span>
        <span class="value" style="color:#DC2626">${stats.wrongCount} 题</span>
      </div>
      <div class="detail-row">
        <span class="label">错题掌握情况</span>
        <span class="value">已掌握 ${stats.masteredCount} 题 · 待提升 ${stats.pendingCount} 题</span>
      </div>
    </div>

    <div class="footer-text">敏学教育 · 让学习更有温度</div>
  </div>

  <!-- 第二页：知识点诊断 -->
  <div class="page page-break">
    <div class="report-header">
      <div class="report-title" style="font-size:20px;">📊 知识点掌握诊断</div>
      <div class="report-subtitle">${escapeHtml(student.name)} · 第 ${weekNum} 周</div>
    </div>

    <div class="divider"></div>

    ${hasKnowledgeData ? `
    <table class="knowledge-table">
      <thead>
        <tr>
          <th style="width:28%;">知识点</th>
          <th style="width:16%;">总题数</th>
          <th style="width:16%;">错误次数</th>
          <th style="width:14%;">正确率</th>
          <th style="width:26%;">掌握程度</th>
        </tr>
      </thead>
      <tbody>
        ${knowledgeRows}
      </tbody>
    </table>
    <div style="margin-top:16px;padding:12px 16px;background:#FFF7ED;border-radius:8px;border:1px solid #FED7AA;">
      <div style="font-size:13px;font-weight:600;color:#C2410C;margin-bottom:4px;">🔍 高频薄弱点</div>
      <div style="font-size:12px;color:#9A3412;">
        ${knowledgeDiagnosis.slice(0, 3).map(kp => `「${kp.tag}」正确率 ${kp.accuracy}%，错误 ${kp.wrongCount} 次`).join('；')}
      </div>
    </div>
    ` : `
    <div class="empty-state">
      <div class="empty-icon">🎉</div>
      <div>本周暂无知识点诊断数据</div>
      <div style="margin-top:8px;font-size:12px;">完成作业批改后自动生成知识点分析</div>
    </div>
    `}

    <div class="footer-text" style="margin-top:${hasKnowledgeData ? '24px' : '60px'}">敏学教育 · 让学习更有温度</div>
  </div>
</body></html>`
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成诊断报告 PDF（页 1-2）
 * @param {Object} reportData - 周统计数据
 * @returns {Blob} 诊断报告 PDF blob
 */
async function generateDiagnosisPDF(reportData) {
  const html = buildDiagnosisHTML(reportData)
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
    const pageH = (794 / A4_W) * A4_H
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

    return doc.output('blob')
  } finally {
    document.body.removeChild(container)
  }
}

/**
 * 合并两个 PDF Blob 为一个
 * @param {Blob} firstBlob - 诊断报告 PDF
 * @param {Blob} secondBlob - 错题再测卷 PDF
 * @returns {Blob} 合并后的 PDF
 */
async function mergePDFs(firstBlob, secondBlob) {
  const firstArr = await firstBlob.arrayBuffer()
  const secondArr = await secondBlob.arrayBuffer()

  const mergedPdf = await PDFDocument.create()

  const firstDoc = await PDFDocument.load(firstArr)
  const secondDoc = await PDFDocument.load(secondArr)

  const firstPages = await mergedPdf.copyPages(firstDoc, firstDoc.getPageIndices())
  firstPages.forEach(page => mergedPdf.addPage(page))

  const secondPages = await mergedPdf.copyPages(secondDoc, secondDoc.getPageIndices())
  secondPages.forEach(page => mergedPdf.addPage(page))

  const mergedBytes = await mergedPdf.save()
  return new Blob([mergedBytes], { type: 'application/pdf' })
}

/**
 * 为某个学生生成本周错题再测卷 PDF
 * @param {string} studentId
 * @param {string} studentName
 * @param {string[]} wrongQuestionIds
 * @param {Object} stats
 * @returns {Blob} 试卷 PDF blob
 */
async function generateExamPDFForReport(studentId, studentName, wrongQuestionIds, stats) {
  if (!wrongQuestionIds || wrongQuestionIds.length === 0) return null

  try {
    // 复用现有组卷流程：创建组卷记录
    const examName = `错题再测-${dayjs().format('MMDD')}`
    const examRecord = await createGeneratedExam({
      student_id: studentId,
      name: examName,
      question_ids: wrongQuestionIds
    })

    // 获取题目详情
    const questions = await getQuestionsByIds(wrongQuestionIds, studentId)
    if (!questions || questions.length === 0) return null

    // 复用现有 PDF 生成器生成试卷（showAnswers=false，保持空白卷风格）
    const result = await generateExamPDF({
      title: `${studentName} - 本周错题再测`,
      studentName,
      questions,
      filename: `${studentName}_错题再测_${dayjs().format('YYYYMMDD')}`,
      showAnswers: false,
      qrContent: examRecord?.id ? `MXG:${examRecord.id.toUpperCase()}` : undefined
    })

    return result.pdfBlob
  } catch (error) {
    console.warn('生成错题再测卷失败:', error)
    return null
  }
}

/**
 * 生成完整的周学习诊断报告（诊断 + 错题再测卷，合并为一个 PDF）
 * @param {string} studentId
 * @param {Object} options
 * @param {number} options.weeks - 周数，默认 1
 * @returns {Blob} 合并后的 PDF blob
 */
export async function generateWeeklyReport(studentId, { weeks = 1 } = {}) {
  // 1. 获取周统计数据
  const API_BASE = import.meta.env.VITE_API_URL || '/api'
  const resp = await fetch(`${API_BASE}/weekly-report/${studentId}?weeks=${weeks}`)
  if (!resp.ok) throw new Error('获取周统计数据失败')
  const reportData = await resp.json()
  if (!reportData.success) throw new Error(reportData.error || '获取周统计数据失败')

  // 2. 生成诊断报告 PDF
  const diagnosisBlob = await generateDiagnosisPDF(reportData)

  // 3. 生成错题再测卷 PDF
  const examBlob = await generateExamPDFForReport(
    studentId,
    reportData.student.name,
    reportData.stats.wrongQuestionIds,
    reportData.stats
  )

  // 4. 如果没有错题，只返回诊断报告
  if (!examBlob) return diagnosisBlob

  // 5. 合并两个 PDF
  const mergedBlob = await mergePDFs(diagnosisBlob, examBlob)
  return mergedBlob
}

/**
 * 为所有学生生成周学习诊断报告
 * @param {Object} options
 * @param {number} options.weeks
 * @param {Function} options.onProgress - 进度回调 (studentName, status)
 * @returns {Array<{student, pdfBlob, status, error?}>}
 */
export async function generateAllWeeklyReports({ weeks = 1, onProgress } = {}) {
  const API_BASE = import.meta.env.VITE_API_URL || '/api'

  // 1. 获取所有学生的摘要
  const summaryResp = await fetch(`${API_BASE}/weekly-report?weeks=${weeks}`)
  if (!summaryResp.ok) throw new Error('获取学生周统计失败')
  const summaryData = await summaryResp.json()

  const results = []

  // 串行为每个学生生成（避免浏览器内存爆炸）
  for (const report of summaryData.reports) {
    const { student, stats } = report
    if (!stats || stats.totalQuestions === 0) {
      // 本周无数据 → 跳过但记录
      onProgress?.(student.name, 'skipped')
      results.push({ student, pdfBlob: null, status: 'skipped' })
      continue
    }

    onProgress?.(student.name, 'generating')
    try {
      const pdfBlob = await generateWeeklyReport(student.id, { weeks })
      results.push({ student, pdfBlob, status: 'done' })
      onProgress?.(student.name, 'done')
    } catch (err) {
      console.error(`生成 ${student.name} 的报告失败:`, err)
      results.push({ student, pdfBlob: null, status: 'failed', error: err.message })
      onProgress?.(student.name, 'failed')
    }
  }

  return results
}