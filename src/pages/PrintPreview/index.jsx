import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowLeft, Printer, FileDown, QrCode, Eye, EyeOff } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Toast } from 'antd-mobile'
import { useStudentStore, useWrongQuestionStore, useUIStore, useExamStore } from '../../store'
import { mockWrongQuestions } from '../../data/mockData'
import { createGeneratedExam } from '../../services/apiService'
import dayjs from 'dayjs'
import { generateExamPDF } from '../../utils/pdfGenerator'

const USE_MOCK_DATA = false

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

const generatePaperId = () => {
  return 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

export default function PrintPreview({ onClose }) {
  const { currentStudent } = useStudentStore()
  const { selectedQuestions, clearSelection } = useWrongQuestionStore()
  const { setLoading } = useUIStore()
  const { addGeneratedExam } = useExamStore()
  
  const initQuestions = selectedQuestions.length > 0 
    ? selectedQuestions.map(wq => wq.question || wq)
    : [];
  
  const [previewQuestions, setPreviewQuestions] = useState(initQuestions)
  const [currentPage, setCurrentPage] = useState(1)
  const [paperId, setPaperId] = useState('')
  const [qrContent, setQrContent] = useState('')
  const [showGradingModal, setShowGradingModal] = useState(false)
  const [gradingData, setGradingData] = useState(null)
  const [studentAnswers, setStudentAnswers] = useState({})
  const [gradingResults, setGradingResults] = useState({})
  const printRef = useRef(null)

  useEffect(() => {
    const newPaperId = generatePaperId()
    setPaperId(newPaperId)
    
    const content = JSON.stringify({
      type: 'grading',
      paperId: newPaperId,
      studentId: currentStudent?.id,
      studentName: currentStudent?.name,
      questionIds: previewQuestions.map(q => q.id),
      timestamp: Date.now()
    })
    setQrContent(content)
  }, [currentStudent, previewQuestions])

  useEffect(() => {
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

  const generatePrintContent = () => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${currentStudent?.name || '学生'} - 错题重练卷</title>
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
            <div class="title">${currentStudent?.name || '学生'} - 错题重练卷</div>
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
                  <span class="question-type">(${q.question_type === 'choice' ? '选择题' : q.question_type === 'fill' ? '填空题' : '解答题'})</span>
                </div>
                <div class="question-content">${content}</div>
                ${q.image_url ? `<div style="text-align:center;margin-bottom:8px;"><img src="${q.image_url}" alt="配图" style="max-width:100%;max-height:200px;object-fit:contain;border-radius:4px;" /></div>` : ''}
                ${q.options && q.options.length > 0 ? `
                  <div class="options ${isShortOptions ? 'options-inline' : 'options-grid'}">
                    ${q.options.map((opt, i) => `<div class="option"><span style="display:inline-block;width:14px;height:14px;border:1px solid #999;border-radius:50%;margin-right:6px;vertical-align:middle;"></span>${String.fromCharCode(65 + i)}</div>`).join('')}
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
    if (currentStudent && selectedQuestions.length > 0) {
      const questionIds = selectedQuestions.map(wq => {
        const q = wq.question || wq
        return q.id
      }).filter(Boolean)

      if (questionIds.length > 0) {
        createGeneratedExam({
          student_id: currentStudent.id,
          name: '错题重练卷',
          question_ids: questionIds
        }).then(() => {
          console.log('试卷已保存')
        }).catch(error => {
          console.error('保存生成试卷失败:', error)
        })
      }

      clearSelection()
    }

    if (isMobile) {
      await generatePDF()
    } else {
      await generatePDF()
    }

    onClose()
  }

  const generatePDF = async () => {
    try {
      await generateExamPDF({
        title: `${currentStudent?.name || '学生'} - 错题重练卷`,
        studentName: currentStudent?.name || '',
        questions: previewQuestions,
        filename: `${currentStudent?.name || 'student'}_cuoti_${dayjs().format('YYYYMMDD_HHmm')}`,
        showAnswers: false,
        qrContent: qrContent,
      })
    } catch (error) {
      console.error('PDF生成失败:', error)
      alert('PDF生成失败，请重试')
    }
  }

  const handleExportPDF = async () => {
    try {
      await generateExamPDF({
        title: `${currentStudent?.name || '学生'} - 错题重练卷`,
        studentName: currentStudent?.name || '',
        questions: previewQuestions,
        filename: `${currentStudent?.name || 'student'}_cuoti_${dayjs().format('YYYYMMDD_HHmm')}`,
        showAnswers: false,
        qrContent: qrContent,
      })
      Toast.show({ icon: 'success', content: 'PDF已生成，请查看下载' })
    } catch (error) {
      console.error('PDF生成失败:', error)
      Toast.show({ icon: 'fail', content: 'PDF生成失败，请重试' })
    }
  }

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
          <div className="flex-1 flex items-center justify-center" style={{ fontSize: '13px', color: '#9CA3AF' }}>
            请先选择要打印的题目
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

        {/* Preview Area */}
        <div className="flex-1 bg-gray-200 p-5 overflow-auto flex justify-center">
          <div className="w-full max-w-[210mm] bg-white p-8 shadow-lg relative">
            {/* QR Code */}
            <div className="absolute top-6 right-8 text-center">
              <QRCodeSVG
                value={qrContent || 'https://minxue.app/grading'}
                size={70}
                level="H"
                includeMargin={true}
              />
              <div className="text-[8pt] text-gray-400 mt-1">扫码批改</div>
            </div>

            {/* Header */}
            <div className="text-center mb-6 pb-4 border-b-2 border-gray-800 pr-20">
              <div className="text-[18pt] font-bold mb-3">{currentStudent?.name || '学生'} - 错题重练卷</div>
              <div className="text-[10pt] text-gray-500 flex justify-center gap-8">
                <span>总题数：{previewQuestions.length}题</span>
                <span>满分：100分</span>
                <span>限时：60分钟</span>
              </div>
            </div>

            {/* Info Bar */}
            <div className="flex justify-start items-center mb-6 text-[10pt] border-b border-gray-200 pb-3 gap-10">
              <span>姓名：______________</span>
              <span>日期：____年____月____日</span>
            </div>

            {/* Questions */}
            {previewQuestions.map((q, index) => {
              const isShortOptions = q.options && q.options.every(opt => opt.length <= 10)
              let content = q.content
              if (q.question_type === 'fill') {
                content = content.replace(/_____/g, '__________')
              }
              return (
                <div key={q.id} className="mb-6">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="font-bold min-w-[30px]">{index + 1}.</span>
                    <span className="text-[9pt] text-gray-400">
                      ({q.question_type === 'choice' ? '选择题' : q.question_type === 'fill' ? '填空题' : '解答题'})
                    </span>
                  </div>
                  <div className="mb-2 leading-relaxed">{content}</div>
                  {q.image_url && (
                    <div className="mb-2" style={{ textAlign: 'center' }}>
                      <img
                        src={q.image_url}
                        alt="配图"
                        style={{
                          maxWidth: '100%',
                          maxHeight: '200px',
                          objectFit: 'contain',
                          borderRadius: '4px'
                        }}
                      />
                    </div>
                  )}
                  {q.options && q.options.length > 0 && (
                    <div className={`ml-8 mt-2 ${isShortOptions ? 'flex flex-wrap gap-8' : 'grid grid-cols-2 gap-2'}`}>
                      {q.options.map((opt, i) => (
                        <div key={i} className="text-[11pt] whitespace-nowrap flex items-center gap-2">
                          <span className="inline-block w-3.5 h-3.5 border border-gray-400 rounded-full flex-shrink-0"></span>
                          {String.fromCharCode(65 + i)}
                        </div>
                      ))}
                    </div>
                  )}
                  {q.question_type === 'answer' && (
                    <div className="mt-4 p-3 border border-gray-200 rounded-lg min-h-[60px]">答：</div>
                  )}
                </div>
              )
            })}

            {/* Footer */}
            <div className="mt-10 text-center text-[9pt] text-gray-400 border-t border-gray-200 pt-4">
              敏学错题本 - 智能学习助手
            </div>
            <div className="text-center mt-4 text-[10pt] text-gray-500">
              第 {currentPage} 页 / 共 {totalPages} 页
            </div>
          </div>
        </div>

        {/* Bottom Buttons */}
        <div className="bg-white px-4 py-3 border-t flex justify-center gap-3" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={handleExportPDF}
            className="px-5 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5"
            style={{ border: '1px solid #2563EB', color: '#2563EB', background: 'transparent' }}>
            <FileDown size={15} />
            PDF
          </button>
          <button onClick={handlePrint}
            className="px-6 py-2 rounded-lg text-[13px] font-medium flex items-center gap-1.5" style={{ background: '#2563EB', color: 'white' }}>
            {isMobile ? <FileDown size={15} /> : <Printer size={15} />}
            {isMobile ? '下载PDF' : '直接打印'}
          </button>
        </div>
      </div>
    </AnimatePresence>
  )
}
