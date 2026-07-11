import { useState, useRef, useEffect } from 'react'
import { AnimatePresence } from 'motion/react'
import { Printer, FileDown, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Toast } from 'antd-mobile'
import { useStudentStore, useWrongQuestionStore, useUIStore, useExamStore } from '../../store'
import { mockWrongQuestions } from '../../data/mockData'
import { createGeneratedExam } from '../../services/apiService'
import dayjs from 'dayjs'
import { saveAs } from 'file-saver'
import { generateExamPDF } from '../../utils/pdfGenerator'

const USE_MOCK_DATA = false

/**
 * 判断选项内容是否已经自带字母前缀（如 "A. xxx"），避免显示 "A. A. xxx"
 */
const isOptionWithLetterPrefix = (opt) => {
  if (!opt) return false
  const trimmed = String(opt).trim()
  return /^[A-Da-d][.、)\)]\s/.test(trimmed)
}

/**
 * 如果选项已带字母前缀，则直接使用；否则自动添加
 */
const formatOption = (opt, index) => {
  if (isOptionWithLetterPrefix(opt)) return opt
  return `${String.fromCharCode(65 + index)}. ${opt}`
}

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

  // A4 页面按真实宽度(794px)渲染，再缩放适配视口宽度（手机端完整呈现，不再挤压变形）
  const A4_PX = 794
  const previewWrapRef = useRef(null)
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

  // 组件挂载时即保存组卷记录，使二维码中包含 generatedExamId
  // 重打/历史重下场景已带合法 existingExamId，直接复用，无需新建
  useEffect(() => {
    if (validExistingId) {
      examRecorded.current = true
      return
    }
    saveGeneratedExamRecord()
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

  const totalPages = Math.ceil(previewQuestions.length / 5) || 1

  // 按题型分组，与 PDF 排版一致：选择题 / 填空题 / 解答题
  const questionSections = (() => {
    const choice = previewQuestions.filter(q => q.question_type === 'choice')
    const fill = previewQuestions.filter(q => q.question_type === 'fill')
    const answer = previewQuestions.filter(q => q.question_type === 'answer')
    const other = previewQuestions.filter(
      q => !['choice', 'fill', 'answer'].includes(q.question_type)
    )
    const sections = []
    let num = 0
    if (choice.length) sections.push({ label: '一、选择题', items: choice.map(q => ({ q, num: ++num })) })
    if (fill.length) sections.push({ label: '二、填空题', items: fill.map(q => ({ q, num: ++num })) })
    if (answer.length) sections.push({ label: '三、解答题', items: answer.map(q => ({ q, num: ++num })) })
    if (other.length) sections.push({ label: '四、其他', items: other.map(q => ({ q, num: ++num })) })
    return sections
  })()

  // 计算 base 试卷名（不含序号）：重打模式用原始名，新建模式按学科 + 日期
  const getBaseExamName = () => {
    if (examName) return examName
    const subjects = [...new Set(previewQuestions.map(q => q.subject).filter(Boolean))]
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
                    ${q.options.map((opt, i) => {
                      const formatted = isOptionWithLetterPrefix(opt) ? opt : String.fromCharCode(65 + i) + '. ' + opt
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

  const generatePDF = async () => {
    if (generatingPdf) return
    setGeneratingPdf(true)
    setPdfBlobUrl('')
    setPdfBlob(null)
    const examName = getExamName()
    try {
      const result = await generateExamPDF({
        title: `${currentStudent?.name || '学生'} - ${examName}`,
        studentName: currentStudent?.name || '',
        questions: previewQuestions,
        filename: `${currentStudent?.name || 'student'}_${examName}_${dayjs().format('YYYYMMDD_HHmm')}`,
        showAnswers: false,
        qrContent: getQrContent(),
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
    if (examRecorded.current) return
    const questionIds = previewQuestions.map(q => q.id).filter(Boolean)
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
        }
        examRecorded.current = true
      } catch (e) {
        console.error('保存组卷记录失败:', e)
      }
    }
  }

  const handleExportPDF = async () => {
    if (generatingPdf) return
    await saveGeneratedExamRecord()
    const result = await generatePDF()
    if (result && result.pdfBlob) {
      const examName = getExamName()
      const filename = `${currentStudent?.name || 'student'}_${examName}_${dayjs().format('YYYYMMDD_HHmm')}.pdf`
      saveAs(result.pdfBlob, filename)
    }
  }

  const handleDirectPrint = () => {
    if (generatingPdf || pdfDownloading) return
    const doPrint = async () => {
      await saveGeneratedExamRecord()
      let blobUrl = pdfBlobUrl
      if (!blobUrl) {
        setGeneratingPdf(true)
        const examName = getExamName()
        try {
          const result = await generateExamPDF({
            title: `${currentStudent?.name || '学生'} - ${examName}`,
            studentName: currentStudent?.name || '',
            questions: previewQuestions,
            filename: `${currentStudent?.name || 'student'}_${examName}_${dayjs().format('YYYYMMDD_HHmm')}`,
            showAnswers: false,
            qrContent: getQrContent(),
          })
          if (result) {
            blobUrl = result.blobUrl
            setPdfBlobUrl(result.blobUrl)
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
        <div className="fixed inset-0 z-[10000] flex flex-col" style={{ background: '#F5F7FA' }}>
          <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-white border-b" style={{ borderColor: '#E5E7EB' }}>
            <button onClick={onClose} style={{ fontSize: '13px', color: '#2563EB' }}>
              返回
            </button>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>打印预览</h2>
            <div className="w-10" />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ fontSize: '13px', color: '#9CA3AF' }}>
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
      <div className="fixed inset-0 z-[10000] flex flex-col" style={{ background: '#F5F7FA' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-12 pb-3 bg-white border-b" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={onClose} style={{ fontSize: '13px', color: '#2563EB' }}>
            返回
          </button>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>打印预览</h2>
          <button onClick={handleSimulateScan} style={{ fontSize: '12px', color: '#2563EB' }}>
            {showGradingModal ? '关闭模拟' : '模拟扫码'}
          </button>
        </div>

        {/* Preview Area — A4 真实宽度渲染后按视口缩放，手机端完整呈现 */}
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
              <div className="bg-white shadow-lg relative" style={{ padding: '30px 40px' }}>
                {/* QR Code — 顶部右侧固定，标题区已预留空间避免重叠 */}
                <div className="absolute text-center" style={{ top: 24, right: 36 }}>
                  <QRCodeSVG
                    value={qrContent || 'https://minxue.app/retry-task'}
                    size={150}
                    level="H"
                    includeMargin={true}
                  />
                  <div className="text-[11px] text-gray-500 mt-1 font-bold tracking-wider">扫码批改</div>
                </div>

                {/* Header — 右侧留出 170px 给二维码 */}
                <div style={{ minHeight: 150, paddingRight: 170 }}>
                  <div className="text-[22px] font-bold mb-1.5 tracking-wide">{currentStudent?.name || '学生'} - {getExamName()}</div>
                  <div className="text-[13px] text-gray-500 mb-3">{currentStudent?.name || '学生'}</div>
                  <div className="flex gap-10 text-[14px] mb-1">
                    <span>姓名：<span className="inline-block w-[100px] border-b border-gray-800 ml-1"></span></span>
                    <span>班级：<span className="inline-block w-[100px] border-b border-gray-800 ml-1"></span></span>
                    <span>得分：<span className="inline-block w-[100px] border-b border-gray-800 ml-1"></span></span>
                  </div>
                  <div className="border-t-2 border-gray-800 mt-1.5 mb-2.5"></div>
                  <div className="text-[13px] text-gray-500 mb-2.5">共 {previewQuestions.length} 题</div>
                </div>

                {/* Questions — 按题型分节，与 PDF 一致 */}
                {questionSections.map((section) => (
                  <div key={section.label}>
                    <div className="text-[16px] font-bold my-3 py-1.5 pl-3 border-l-4 border-blue-600 bg-blue-50">
                      {section.label}
                    </div>
                    {section.items.map(({ q, num }) => {
                      const maxLen = q.options && q.options.length
                        ? Math.max(...q.options.map(o => String(o || '').length))
                        : 0
                      const colClass = maxLen <= 8 ? 'grid-cols-4' : maxLen <= 20 ? 'grid-cols-2' : 'grid-cols-1'
                      let content = q.content || ''
                      if (q.question_type === 'fill') {
                        content = content.replace(/_____/g, '__________')
                      }
                      return (
                        <div key={q.id} className="mb-4" style={{ pageBreakInside: 'avoid' }}>
                          <div className="flex gap-2 text-[14px] leading-[1.8] mb-2">
                            <span className="font-bold min-w-[28px] whitespace-nowrap">{num}.</span>
                            <span className="flex-1 break-words">{content}</span>
                          </div>
                          {q.image_url && (
                            <div className="my-2 ml-9" style={{ textAlign: 'center' }}>
                              <img
                                src={q.image_url}
                                alt="配图"
                                style={{ maxWidth: '100%', maxHeight: '250px', objectFit: 'contain', borderRadius: '4px' }}
                              />
                            </div>
                          )}
                          {q.options && q.options.length > 0 && (
                            <div className={`grid ${colClass} gap-x-4 gap-y-2 pl-9 mb-1`}>
                              {q.options.map((opt, i) => (
                                <div key={i} className="text-[13px] leading-relaxed break-words">
                                  {formatOption(opt, i)}
                                </div>
                              ))}
                            </div>
                          )}
                          {q.question_type === 'fill' && (
                            <div className="ml-9 mt-2 mb-1.5 border-b-[1.5px] border-gray-800" style={{ width: 220, height: 24 }}></div>
                          )}
                          {q.question_type === 'answer' && (
                            <div className="ml-9 mt-1.5">
                              {[0, 1, 2, 3, 4].map(r => (
                                <div key={r} className="border-b border-gray-300" style={{ height: 32, marginBottom: 4 }}></div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}

                {/* Footer */}
                <div className="mt-5 text-center text-[11px] text-gray-400 border-t border-gray-200 pt-2">
                  敏学错题本 - 智能学习助手
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Buttons */}
        <div className="bg-white px-4 py-3 border-t flex justify-center gap-3" style={{ borderColor: '#E5E7EB' }}>
          {generatingPdf ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: '#6B7280' }}>
              <span style={{
                display: 'inline-block',
                width: 16,
                height: 16,
                border: '2px solid #2563EB',
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'pdf-spin 0.8s linear infinite'
              }}></span>
              <style>{`@keyframes pdf-spin{to{transform:rotate(360deg)}}`}</style>
              PDF 生成中...
            </div>
          ) : (
            <>
              <button onClick={handleExportPDF}
                className="px-5 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5"
                style={{ background: '#10B981', color: 'white' }}>
                <FileDown size={15} />
                下载PDF
              </button>
              <button onClick={handleDirectPrint}
                className="px-6 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5" style={{ background: '#2563EB', color: 'white' }}>
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
