import { useState, useRef, useEffect } from 'react'
import { AnimatePresence } from 'motion/react'
import { Printer, FileDown, Loader2 } from 'lucide-react'
import { Toast } from 'antd-mobile'
import { useStudentStore, useWrongQuestionStore, useUIStore, useExamStore } from '../../store'
import { mockWrongQuestions } from '../../data/mockData'
import { createGeneratedExam, getQuestionsByIds } from '../../services/apiService'
import dayjs from 'dayjs'
import { saveAs } from 'file-saver'
import { exportWrongBookPDF } from '../../utils/wrongBookPdfExporter'
import {
  buildPaperBody,
  buildPaperCSS,
  renderMathInContainer,
  applyQRToContainer,
  preloadKatexFonts,
} from '../../utils/pdfGenerator'
import { normalizeOptions } from '../../utils/optionText'
import katexCss from 'katex/dist/katex.min.css?inline'

const USE_MOCK_DATA = false

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

const generatePaperId = () => {
  return 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

export default function PrintPreview({ onClose, questions: propQuestions, existingExamId, examName }) {
  const { currentStudent } = useStudentStore()
  const { selectedQuestions, clearSelection } = useWrongQuestionStore()
  const { setLoading } = useUIStore()
  const { addGeneratedExam, generatedExams } = useExamStore()

  // 仅当 existingExamId 是合法 UUID（服务端真实组卷ID）时才复用；
  // 本地副本(gen-xxx等)不是有效ID，扫码端会拒绝，退回正常新建流程
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validExistingId = existingExamId && UUID_RE.test(existingExamId) ? existingExamId : ''

  // 重打模式：不从 store selectedQuestions fallback，避免异步加载期间被残留数据污染
  const initQuestions = propQuestions && propQuestions.length > 0
    ? propQuestions
    : (validExistingId ? []
        : (selectedQuestions.length > 0
            ? selectedQuestions.map(wq => wq.question || wq)
            : []));

  const [previewQuestions, setPreviewQuestions] = useState(initQuestions)
  const [currentPage, setCurrentPage] = useState(1)
  const [paperId, setPaperId] = useState('')
  const [qrContent, setQrContent] = useState('')
  const [showGradingModal, setShowGradingModal] = useState(false)
  const [gradingData, setGradingData] = useState(null)
  const [studentAnswers, setStudentAnswers] = useState({})
  const [gradingResults, setGradingResults] = useState({})
  const printRef = useRef(null)
  const examRecorded = useRef(false)
  const [pdfBlobUrl, setPdfBlobUrl] = useState('')
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [pdfBlob, setPdfBlob] = useState(null)
  const [pdfDownloading, setPdfDownloading] = useState(false)
  const [generatedExamId, setGeneratedExamId] = useState(validExistingId || '')
  const examIdRef = useRef(validExistingId || '') // 同步保存组卷ID，避免导出时 state 未刷新
  const [savedExamName, setSavedExamName] = useState('') // 保存后的带序号最终名，供展示/文件名统一使用

  // 实时题目引用：异步补齐题目数据后，导出/打印始终使用最新题目列表，避免闭包读到旧数据
  const previewRef = useRef(previewQuestions)
  useEffect(() => { previewRef.current = previewQuestions }, [previewQuestions])

  // 错题本返回的题目缺少 options / 几何配图等完整字段，直接生成会丢选项、丢图。
  // 参照周报告「错题再测卷」的生成方式（getQuestionsByIds 拉取完整题目），
  // 在预览与导出前补齐，保证移动端重练卷与报告中的再测卷格式一致。
  const needsFullData = (qs) => qs.length > 0 && qs.some(q => !Array.isArray(q.options))

  const ensureEnriched = async () => {
    const qs = previewRef.current
    if (!qs || qs.length === 0) return qs
    if (!needsFullData(qs)) return qs
    const ids = qs.map(q => q && q.id).filter(Boolean)
    if (ids.length === 0) return qs
    try {
      const fullQs = await getQuestionsByIds(ids)
      if (fullQs && fullQs.length > 0) {
        const map = {}
        fullQs.forEach(q => { map[q.id] = q })
        const merged = qs.map(q => (map[q.id] ? map[q.id] : q))
        setPreviewQuestions(merged)
        previewRef.current = merged
        return merged
      }
    } catch (err) {
      console.warn('加载题目完整数据失败，使用错题本原始数据:', err.message)
    }
    return qs
  }

  // 打开即补齐，保证预览页就能看到选项 / 几何图，与 PDF 一致
  useEffect(() => {
    ensureEnriched()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A4 页面按真实宽度(794px)渲染，再缩放适配视口宽度（手机端完整呈现，不再挤压变形）
  const A4_PX = 794
  const previewWrapRef = useRef(null)
  const paperMountRef = useRef(null)
  const [previewScale, setPreviewScale] = useState(1)
  useEffect(() => {
    const compute = () => {
      const wrap = previewWrapRef.current
      if (!wrap) return
      const avail = wrap.clientWidth
      setPreviewScale(Math.min(1, avail / A4_PX))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [previewQuestions.length])

  // 用与 PDF 完全一致的模板（buildPaperBody + buildPaperCSS + 同一 KaTeX auto-render + 二维码）
  // 渲染到 Shadow DOM，保证「预览 = PDF 格式」。
  useEffect(() => {
    const host = paperMountRef.current
    const qs = previewQuestions
    if (!host || !qs || qs.length === 0) return

    let shadow = host.shadowRoot
    if (!shadow) shadow = host.attachShadow({ mode: 'open' })

    try {
      const name = currentStudent?.name || '学生'
      const title = `${name} - ${getExamName()}`
      shadow.innerHTML = `<style>${katexCss}\n${buildPaperCSS()}</style>${buildPaperBody({
        title,
        studentName: name,
        questions: qs,
        showAnswers: false,
      })}`
      // 等 DOM 插入后再渲染公式与二维码，保证与 PDF 生成时一致
      requestAnimationFrame(() => {
        renderMathInContainer(shadow)
        applyQRToContainer(shadow, qrContent || getQrContent())
        preloadKatexFonts()
      })
    } catch (err) {
      console.warn('试卷预览渲染失败:', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewQuestions, qrContent, generatedExamId])

  // 二维码内容：错题重练任务入口 URL（/retry-task/{id}），任意相机可扫
  // 二维码只承载唯一 task 定位，不再绑定具体批改页面
  const getRetryTaskUrl = (id) => {
    const base = import.meta.env.VITE_APP_BASE_URL || window.location.origin
    return `${base}/retry-task/${id.toUpperCase()}`
  }

  // 计算二维码内容：优先任务入口 URL，兜底旧 JSON
  const getQrContent = () => {
    const examId = examIdRef.current || generatedExamId
    if (examId) return getRetryTaskUrl(examId)
    return qrContent
  }

  // 不再在挂载时自动建卷：仅"预览"不应产生组卷历史记录。
  // 重打/历史重下场景已带合法 existingExamId，直接复用，无需新建；
  // 新建场景推迟到用户点击"下载PDF"/"直接打印"时再 saveGeneratedExamRecord()，
  // 避免老师只是打开预览就生成一条组卷历史、二维码也被提前占用。
  useEffect(() => {
    if (validExistingId) {
      examRecorded.current = true
    }
  }, [])

  // 当外部的 questions prop 变化时同步（用于"重打"等异步加载场景）
  useEffect(() => {
    if (propQuestions && propQuestions.length > 0) {
      setPreviewQuestions(propQuestions)
    }
  }, [propQuestions])

  useEffect(() => {
    const newPaperId = generatePaperId()
    setPaperId(newPaperId)

    if (generatedExamId) {
      // 二维码 = 错题重练任务入口 URL（任意相机可扫），不再绑定具体批改页面
      setQrContent(getRetryTaskUrl(generatedExamId))
    } else {
      // 兜底：组卷记录尚未创建成功时使用完整 JSON（密度高，但保证可用）
      setQrContent(JSON.stringify({
        type: 'grading',
        paperId: newPaperId,
        studentId: currentStudent?.id,
        studentName: currentStudent?.name || '',
        questionIds: previewQuestions.map(q => q.id),
        ts: Date.now()
      }))
    }
  }, [currentStudent, previewQuestions, generatedExamId])

  // 重打模式（validExistingId）下不从 store selectedQuestions 恢复，避免覆盖已加载的 propQuestions
  useEffect(() => {
    if (validExistingId) return
    if (selectedQuestions.length > 0) {
      const questions = selectedQuestions.map(wq => wq.question || wq)
      setPreviewQuestions(questions)
    } else if (USE_MOCK_DATA) {
      const questions = mockWrongQuestions
        .filter(wq => wq.student_id === currentStudent?.id)
        .map(wq => wq.question)
      setPreviewQuestions(questions)
    }
  }, [selectedQuestions, currentStudent])

  // 计算 base 试卷名（不含序号）：重打模式用原始名，新建模式按学科 + 日期
  const getBaseExamName = () => {
    if (examName) return examName
    const qs = previewRef.current || previewQuestions
    const subjects = [...new Set(qs.map(q => q.subject).filter(Boolean))]
    if (subjects.length === 0) return `错题重练-${dayjs().format('MMDD')}`
    if (subjects.length <= 2) return `${subjects.join('')}-${dayjs().format('MMDD')}`
    return `综合-${dayjs().format('MMDD')}`
  }

  // 展示/文件名用：已保存则用带序号的最终名，否则用 base 名
  const getExamName = () => savedExamName || getBaseExamName()

  // 生成带序号的组卷名：同一学生、同一 base 名（科目+日期）当天第几张 → -01/-02...
  // 例："数学-0708-01"、"数学-0708-02"，避免同天多张重名难以区分
  const buildExamNameWithSeq = (baseName) => {
    const today = dayjs().format('YYYY-MM-DD')
    // 统计当前学生今天已存在、且 base 名相同的组卷数量
    const sameBaseToday = (generatedExams || []).filter(e => {
      if (e.student_id !== currentStudent?.id) return false
      const createdDay = e.created_at ? dayjs(e.created_at).format('YYYY-MM-DD') : null
      if (createdDay !== today) return false
      // 去掉已有的 -NN 序号后比较 base
      const eBase = (e.name || '').replace(/-\d{2}$/, '')
      return eBase === baseName
    }).length
    const seq = String(sameBaseToday + 1).padStart(2, '0')
    return `${baseName}-${seq}`
  }

  const generatePrintContent = () => {
    const examName = getExamName()
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${currentStudent?.name || '学生'} - ${examName}</title>
        <style>
          @page { size: A4; margin: 20mm; }
          body { font-family: 'Microsoft YaHei', 'SimSun', sans-serif; line-height: 1.8; font-size: 12pt; }
          .paper { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm; box-sizing: border-box; background: white; }
          .header { text-align: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #333; position: relative; }
          .title { font-size: 18pt; font-weight: bold; margin-bottom: 10px; }
          .subtitle { font-size: 10pt; color: #666; display: flex; justify-content: center; gap: 30px; }
          .info-bar { display: flex; justify-content: flex-start; align-items: center; margin-bottom: 20px; font-size: 10pt; border-bottom: 1px solid #ddd; padding-bottom: 10px; gap: 40px; }
          .question { margin-bottom: 20px; page-break-inside: avoid; }
          .question-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
          .question-number { font-weight: bold; min-width: 30px; }
          .question-type { font-size: 9pt; color: #999; }
          .question-content { margin-bottom: 8px; line-height: 1.6; }
          .options { margin-left: 30px; margin-top: 8px; }
          .options-inline { display: flex; flex-wrap: wrap; gap: 32px; }
          .options-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .option { font-size: 11pt; white-space: nowrap; }
          .answer-area { margin-top: 15px; padding: 12px; border: 1px solid #ddd; border-radius: 4px; min-height: 40px; }
          .footer { margin-top: 40px; text-align: center; font-size: 9pt; color: #999; border-top: 1px solid #ddd; padding-top: 15px; }
          @media print { body { background: white; } .paper { box-shadow: none; margin: 0; } }
        </style>
      </head>
      <body>
        <div class="paper">
          <div class="header">
            <div class="title">${currentStudent?.name || '学生'} - ${examName}</div>
            <div class="subtitle">
              <span>总题数：${previewQuestions.length}题</span>
              <span>满分：100分</span>
              <span>限时：60分钟</span>
            </div>
          </div>
          <div class="info-bar">
            <span>姓名：______________</span>
            <span>日期：____年____月____日</span>
          </div>
          ${previewQuestions.map((q, index) => {
            const isShortOptions = q.options && q.options.every(opt => opt.length <= 10)
            let content = q.content || '无内容'
            if (q.question_type === 'fill') {
              content = content.replace(/_____/g, '<span style="display:inline-block;min-width:80px;border-bottom:1px solid #333;margin:0 4px;">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>')
            }
            return `
              <div class="question">
                <div class="question-header">
                  <span class="question-number">${index + 1}.</span>
                  <span class="question-type">(${q.question_type === 'choice' ? '选择题' : q.question_type === 'fill' ? '填空题' : q.question_type === 'judge' ? '判断题' : '解答题'})</span>
                </div>
                <div class="question-content">${content}</div>
                ${q.image_url ? `<div style="text-align:center;margin-bottom:8px;"><img src="${q.image_url}" alt="配图" style="max-width:100%;max-height:200px;object-fit:contain;border-radius:4px;" /></div>` : ''}
                ${q.options && q.options.length > 0 ? `
                  <div class="options ${isShortOptions ? 'options-inline' : 'options-grid'}">
                    ${normalizeOptions(q.options).map((opt, i) => {
                      const formatted = String.fromCharCode(65 + i) + '. ' + opt
                      return `<div class="option"><span style="display:inline-block;width:14px;height:14px;border:1px solid #999;border-radius:50%;margin-right:6px;vertical-align:middle;"></span>${formatted}</div>`
                    }).join('')}
                  </div>
                ` : ''}
                ${q.question_type === 'answer' ? `<div class="answer-area">答：</div>` : ''}
              </div>
            `
          }).join('')}</div>
          <div class="footer">敏学错题本 - 智能学习助手</div>
        </div>
        <script>
          setTimeout(function() { window.print(); }, 300);
        </script>
      </body>
      </html>
    `
  }

  const handlePrint = async () => {
    await handleExportPDF()
  }

  const generatePDF = async (questionsOverride) => {
    if (generatingPdf) return
    setGeneratingPdf(true)
    setPdfBlobUrl('')
    setPdfBlob(null)
    const examName = getExamName()
    const questions = questionsOverride || previewRef.current || previewQuestions
    try {
      // 统一走公共导出引擎（数据标准化 + 唯一渲染出口），与周报告再测卷/后台重练卷一致
      const result = await exportWrongBookPDF({
        studentId: currentStudent?.id,
        studentName: currentStudent?.name || '',
        questions,
        title: `${currentStudent?.name || '学生'} - ${examName}`,
        filename: `${currentStudent?.name || 'student'}_${examName}_${dayjs().format('YYYYMMDD_HHmm')}`,
        showAnswers: false,
        qrContent: getQrContent(),
        returnPdfBlob: true,
      })
      if (result) {
        setPdfBlobUrl(result.blobUrl)
        setPdfBlob(result.pdfBlob)
        return result
      }
    } catch (error) {
      console.error('PDF生成失败:', error)
      Toast.show({ icon: 'fail', content: 'PDF生成失败，请重试' })
    } finally {
      setGeneratingPdf(false)
    }
    return null
  }

  const saveGeneratedExamRecord = async () => {
    if (examRecorded.current) return false
    const qs = previewRef.current || previewQuestions
    const questionIds = qs.map(q => q.id).filter(Boolean)
    if (currentStudent && questionIds.length > 0) {
      try {
        // 计算 base 名（科目+日期），再追加当天序号
        const baseName = getBaseExamName()
        const examName = buildExamNameWithSeq(baseName)
        setSavedExamName(examName)

        const exam = await createGeneratedExam({
          student_id: currentStudent.id,
          name: examName,
          question_ids: questionIds
        })
        if (exam?.id) {
          examIdRef.current = exam.id
          setGeneratedExamId(exam.id)
          // 加入 store，使后续同天组卷的序号继续递增
          if (addGeneratedExam) {
            addGeneratedExam({
              id: exam.id,
              student_id: currentStudent.id,
              name: examName,
              question_ids: questionIds,
              created_at: exam.created_at || new Date().toISOString(),
              status: 'ungraded',
              source: 'generated',
            })
          }
          examRecorded.current = true
          return true
        }
      } catch (e) {
        console.error('保存组卷记录失败:', e)
        Toast.show({ icon: 'fail', content: '保存组卷记录失败' })
      }
    }
    return false
  }

  const handleExportPDF = async () => {
    if (generatingPdf) return
    const saved = await saveGeneratedExamRecord()
    const questions = await ensureEnriched()
    const result = await generatePDF(questions)
    if (result && result.pdfBlob) {
      const examName = getExamName()
      const filename = `${currentStudent?.name || 'student'}_${examName}_${dayjs().format('YYYYMMDD_HHmm')}.pdf`
      saveAs(result.pdfBlob, filename)
      if (saved) Toast.show({ icon: 'success', content: '已保存到组卷历史' })
    }
  }

  const handleDirectPrint = () => {
    if (generatingPdf || pdfDownloading) return
    const doPrint = async () => {
      const saved = await saveGeneratedExamRecord()
      const questions = await ensureEnriched()
      let blobUrl = pdfBlobUrl
      if (!blobUrl) {
        setGeneratingPdf(true)
        const examName = getExamName()
        try {
          const result = await exportWrongBookPDF({
            studentId: currentStudent?.id,
            studentName: currentStudent?.name || '',
            questions,
            title: `${currentStudent?.name || '学生'} - ${examName}`,
            filename: `${currentStudent?.name || 'student'}_${examName}_${dayjs().format('YYYYMMDD_HHmm')}`,
            showAnswers: false,
            qrContent: getQrContent(),
            returnPdfBlob: true,
          })
          if (result) {
            blobUrl = result.blobUrl || (result.pdfBlob ? URL.createObjectURL(result.pdfBlob) : "")
            setPdfBlobUrl(blobUrl)
            setPdfBlob(result.pdfBlob)
          }
        } catch (e) {
          console.error('PDF生成失败:', e)
          Toast.show({ icon: 'fail', content: 'PDF生成失败' })
          setGeneratingPdf(false)
          return
        }
        setGeneratingPdf(false)
      }
      if (blobUrl) {
        window.open(blobUrl, '_blank')
        if (saved) Toast.show({ icon: 'success', content: '已保存到组卷历史' })
      }
    }
    doPrint()
  }

  // 组件卸载时清理 blob URL 防止内存泄漏
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl)
    }
  }, [pdfBlobUrl])

  const handleSimulateScan = () => {
    setShowGradingModal(!showGradingModal)
  }

  if (previewQuestions.length === 0) {
    return (
      <AnimatePresence>
        <div className="fixed inset-0 z-[10000] flex flex-col" style={{ background: 'var(--bg)' }}>
          <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-white border-b" style={{ borderColor: 'var(--border-light)' }}>
            <button onClick={onClose} style={{ fontSize: 'var(--fs-13)', color: 'var(--primary-hover)' }}>
              返回
            </button>
            <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 600, color: 'var(--text)' }}>打印预览</h2>
            <div className="w-10" />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ fontSize: 'var(--fs-13)', color: 'var(--text-secondary)' }}>
            {validExistingId ? (
              <>
                <Loader2 size={28} className="animate-spin" />
                <span>正在加载试卷题目...</span>
              </>
            ) : (
              <span>请先选择要打印的题目</span>
            )}
          </div>
        </div>
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex flex-col" style={{ background: 'var(--bg)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-white border-b" style={{ borderColor: 'var(--border-light)' }}>
          <button onClick={onClose} style={{ fontSize: 'var(--fs-13)', color: 'var(--primary-hover)' }}>
            返回
          </button>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 600, color: 'var(--text)' }}>打印预览</h2>
          <button onClick={handleSimulateScan} style={{ fontSize: 'var(--fs-12)', color: 'var(--primary-hover)' }}>
            {showGradingModal ? '关闭模拟' : '模拟扫码'}
          </button>
        </div>

        {/* Preview Area — A4 真实宽度渲染后按视口缩放，手机端完整呈现 */}
        <div className="px-4 py-2 bg-white border-b text-center" style={{ borderColor: 'var(--border-light)', fontSize: 'var(--fs-12)', color: 'var(--text-secondary)' }}>
          本次重练 {previewQuestions.length} 道题，完成后可继续处理剩余错题
        </div>

        <div ref={previewWrapRef} className="flex-1 bg-gray-200 p-3 sm:p-5 overflow-auto">
          <div
            style={{
              width: A4_PX * previewScale,
              height: previewScale < 1 ? 'auto' : undefined,
              margin: '0 auto',
            }}
          >
            <div
              style={{
                width: A4_PX,
                transform: `scale(${previewScale})`,
                transformOrigin: 'top left',
              }}
            >
              <div
                ref={paperMountRef}
                className="bg-white shadow-lg relative"
                style={{ padding: 0, minHeight: 1123, width: A4_PX, background: '#fff' }}
              />
            </div>
          </div>
        </div>

        {/* Bottom Buttons */}
        <div className="bg-white px-4 py-3 border-t flex justify-center gap-3" style={{ borderColor: 'var(--border-light)' }}>
          {generatingPdf ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              <span style={{
                display: 'inline-block',
                width: 16,
                height: 16,
                border: '2px solid var(--primary-hover)',
                borderTopColor: 'transparent',
                borderRadius: 'var(--radius-full)',
                animation: 'pdf-spin 0.8s linear infinite'
              }}></span>
              <style>{`@keyframes pdf-spin{to{transform:rotate(360deg)}}`}</style>
              PDF 生成中...
            </div>
          ) : (
            <>
              <button onClick={handleExportPDF}
                className="px-5 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5"
                style={{ background: 'var(--success)', color: 'white' }}>
                <FileDown size={15} />
                下载PDF
              </button>
              <button onClick={handleDirectPrint}
                className="px-6 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5" style={{ background: 'var(--primary-hover)', color: 'white' }}>
                <Printer size={15} />
                直接打印
              </button>
            </>
          )}
        </div>
      </div>
    </AnimatePresence>
  )
}
