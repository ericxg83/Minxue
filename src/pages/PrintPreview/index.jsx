import { useState, useRef, useEffect } from 'react'
import {
  Button,
  Toast,
  NavBar,
  Modal,
  List,
  Radio,
  TextArea
} from 'antd-mobile'
import { QRCodeSVG } from 'qrcode.react'
import { useStudentStore, useWrongQuestionStore, useUIStore } from '../../store'
import { mockWrongQuestions } from '../../data/mockData'
import dayjs from 'dayjs'

// 使用测试数据
const USE_MOCK_DATA = false

// 生成唯一试卷ID
const generatePaperId = () => {
  return 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

export default function PrintPreview({ onClose }) {
  const { currentStudent } = useStudentStore()
  const { selectedQuestions } = useWrongQuestionStore()
  const { setLoading } = useUIStore()
  
  const [previewQuestions, setPreviewQuestions] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [paperId, setPaperId] = useState('')
  const [qrContent, setQrContent] = useState('')
  const [showGradingModal, setShowGradingModal] = useState(false)
  const [gradingData, setGradingData] = useState(null)
  const [studentAnswers, setStudentAnswers] = useState({})
  const [gradingResults, setGradingResults] = useState({})
  const printRef = useRef(null)

  // 初始化试卷ID和二维码
  useEffect(() => {
    const newPaperId = generatePaperId()
    setPaperId(newPaperId)
    
    // 生成二维码内容（包含试卷ID、题目ID列表、学生ID）
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

  // 加载题目数据
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

  // 计算总页数
  const totalPages = Math.ceil(previewQuestions.length / 5) || 1

  // 生成打印内容
  const generatePrintContent = () => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${currentStudent?.name || '学生'} - 错题重练卷</title>
        <style>
          @page { 
            size: A4; 
            margin: 20mm;
          }
          body { 
            font-family: 'Microsoft YaHei', 'SimSun', sans-serif; 
            line-height: 1.8;
            font-size: 12pt;
          }
          .paper {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            padding: 20mm;
            box-sizing: border-box;
            background: white;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #333;
            position: relative;
          }
          .title {
            font-size: 18pt;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .subtitle {
            font-size: 10pt;
            color: #666;
            display: flex;
            justify-content: center;
            gap: 30px;
          }
          .qr-code-print {
            position: absolute;
            top: 0;
            right: 0;
            text-align: center;
          }
          .qr-code-print img {
            width: 60px;
            height: 60px;
          }
          .qr-text {
            font-size: 8pt;
            color: #999;
            margin-top: 4px;
          }
          .info-bar {
            display: flex;
            justify-content: flex-start;
            align-items: center;
            margin-bottom: 20px;
            font-size: 10pt;
            border-bottom: 1px solid #ddd;
            padding-bottom: 10px;
            gap: 40px;
          }
          .question {
            margin-bottom: 20px;
            page-break-inside: avoid;
          }
          .question-header {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 8px;
          }
          .question-number {
            font-weight: bold;
            min-width: 30px;
          }
          .question-type {
            font-size: 9pt;
            color: #999;
          }
          .question-content {
            margin-bottom: 8px;
            line-height: 1.6;
          }
          .options {
            margin-left: 30px;
            margin-top: 8px;
          }
          .options-inline {
            display: flex;
            flex-wrap: wrap;
            gap: 32px;
          }
          .options-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .option {
            font-size: 11pt;
            white-space: nowrap;
          }
          .answer-area {
            margin-top: 15px;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            min-height: 40px;
          }
          .answer-area-fill {
            display: inline-block;
            min-width: 80px;
            border-bottom: 1px solid #333;
            margin: 0 4px;
          }
          .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 9pt;
            color: #999;
            border-top: 1px solid #ddd;
            padding-top: 15px;
          }
          .page-number {
            text-align: center;
            margin-top: 20px;
            font-size: 10pt;
            color: #666;
          }
          @media print {
            body { background: white; }
            .paper { box-shadow: none; margin: 0; }
          }
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
            <div class="qr-code-print">
              <div style="width:60px;height:60px;background:#f5f5f5;display:flex;align-items:center;justify-content:center;font-size:8pt;">二维码</div>
              <div class="qr-text">扫码批改</div>
            </div>
          </div>
          
          <div class="info-bar">
            <span>姓名：______________</span>
            <span>日期：____年____月____日</span>
          </div>

          ${previewQuestions.map((q, index) => {
            const isShortOptions = q.options && q.options.every(opt => opt.length <= 10)
            // 处理填空题的下划线
            let content = q.content || '无内容'
            if (q.question_type === 'fill') {
              content = content.replace(/_____/g, '<span class="answer-area-fill">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>')
            }
            return `
              <div class="question">
                <div class="question-header">
                  <span class="question-number">${index + 1}.</span>
                  <span class="question-type">(${q.question_type === 'choice' ? '选择题' : q.question_type === 'fill' ? '填空题' : '解答题'})</span>
                </div>
                <div class="question-content">${content}</div>
                ${q.options && q.options.length > 0 ? `
                  <div class="options ${isShortOptions ? 'options-inline' : 'options-grid'}">
                    ${q.options.map((opt, i) => `
                      <div class="option">${String.fromCharCode(65 + i)}. ${opt}</div>
                    `).join('')}
                  </div>
                ` : ''}
                ${q.question_type === 'answer' ? `
                  <div class="answer-area">
                    答：
                  </div>
                ` : ''}
              </div>
            `
          }).join('')}

          <div class="footer">
            敏学错题本 - 智能学习助手
          </div>
          
          <div class="page-number">第 1 页 / 共 1 页</div>
        </div>
      </body>
      </html>
    `
  }

  // 执行打印
  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      Toast.show('请允许弹出窗口')
      return
    }

    const content = generatePrintContent()
    printWindow.document.write(content)
    printWindow.document.close()
    
    Toast.show({ icon: 'success', content: '正在生成打印预览...' })
  }

  // 导出PDF
  const handleExportPDF = () => {
    Toast.show({ icon: 'loading', content: '正在生成PDF...' })
    setTimeout(() => {
      Toast.show({ icon: 'success', content: 'PDF生成成功' })
    }, 1000)
  }

  // 模拟扫描二维码后的批改界面
  const handleSimulateScan = () => {
    setShowGradingModal(true)
    // 初始化学生答案（模拟）
    const initialAnswers = {}
    previewQuestions.forEach((q, idx) => {
      initialAnswers[idx] = ''
    })
    setStudentAnswers(initialAnswers)
  }

  // 提交批改
  const handleSubmitGrading = () => {
    // 计算批改结果
    const results = {}
    let correctCount = 0
    
    previewQuestions.forEach((q, idx) => {
      const studentAnswer = studentAnswers[idx]
      const isCorrect = studentAnswer && q.answer && 
        studentAnswer.toString().trim().toLowerCase() === q.answer.toString().trim().toLowerCase()
      
      results[idx] = {
        studentAnswer,
        correctAnswer: q.answer,
        isCorrect,
        analysis: q.analysis || '暂无解析'
      }
      
      if (isCorrect) correctCount++
    })
    
    setGradingResults(results)
    
    Toast.show({ 
      icon: 'success', 
      content: `批改完成！正确 ${correctCount}/${previewQuestions.length} 题` 
    })
  }

  if (previewQuestions.length === 0) {
    return (
      <div style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#f5f5f5',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column'
      }}>
        <NavBar
          back={null}
          left={<Button fill="none" onClick={onClose}>返回</Button>}
        >
          打印预览
        </NavBar>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
          请先选择要打印的题目
        </div>
      </div>
    )
  }

  return (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: '#f5f5f5',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 顶部导航栏 */}
      <NavBar
        back={null}
        left={<Button fill="none" onClick={onClose}>返回</Button>}
        right={<Button fill="none" onClick={handleSimulateScan}>模拟扫码批改</Button>}
      >
        打印预览
      </NavBar>

      {/* 试卷预览区 - 全屏 */}
      <div style={{ 
        flex: 1, 
        background: '#e8e8e8',
        padding: '20px',
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center'
      }}>
        <div style={{
          width: '210mm',
          minHeight: '297mm',
          background: 'white',
          padding: '20mm',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          fontSize: '12pt',
          lineHeight: '1.8',
          position: 'relative'
        }}>
          {/* 二维码 - 右上角 */}
          <div style={{
            position: 'absolute',
            top: '15mm',
            right: '20mm',
            textAlign: 'center'
          }}>
            <QRCodeSVG
              value={qrContent || 'https://minxue.app/grading'}
              size={70}
              level="H"
              includeMargin={true}
            />
            <div style={{ fontSize: '8pt', color: '#999', marginTop: '4px' }}>
              扫码批改
            </div>
          </div>

          {/* 试卷头部 */}
          <div style={{ 
            textAlign: 'center', 
            marginBottom: '20px', 
            paddingBottom: '15px', 
            borderBottom: '2px solid #333',
            paddingRight: '80px'
          }}>
            <div style={{ fontSize: '18pt', fontWeight: 'bold', marginBottom: '10px' }}>
              {currentStudent?.name || '学生'} - 错题重练卷
            </div>
            <div style={{ fontSize: '10pt', color: '#666', display: 'flex', justifyContent: 'center', gap: '30px' }}>
              <span>总题数：{previewQuestions.length}题</span>
              <span>满分：100分</span>
              <span>限时：60分钟</span>
            </div>
          </div>

          {/* 信息栏 */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'flex-start', 
            alignItems: 'center', 
            marginBottom: '20px', 
            fontSize: '10pt',
            borderBottom: '1px solid #ddd',
            paddingBottom: '10px',
            gap: '40px'
          }}>
            <span>姓名：______________</span>
            <span>日期：____年____月____日</span>
          </div>

          {/* 题目列表 */}
          {previewQuestions.map((q, index) => {
            const isShortOptions = q.options && q.options.every(opt => opt.length <= 10)
            // 处理填空题的下划线
            let content = q.content
            if (q.question_type === 'fill') {
              content = content.replace(/_____/g, '__________')
            }
            return (
              <div key={q.id} style={{ marginBottom: '20px', pageBreakInside: 'avoid' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 'bold', minWidth: '30px' }}>{index + 1}.</span>
                  <span style={{ fontSize: '9pt', color: '#999' }}>
                    ({q.question_type === 'choice' ? '选择题' : q.question_type === 'fill' ? '填空题' : '解答题'})
                  </span>
                </div>
                <div style={{ marginBottom: '8px', lineHeight: '1.6' }}>{content}</div>
                {q.options && q.options.length > 0 && (
                  <div style={{ 
                    marginLeft: '30px', 
                    marginTop: '8px',
                    display: isShortOptions ? 'flex' : 'grid',
                    flexWrap: 'wrap',
                    gap: isShortOptions ? '32px' : '8px',
                    gridTemplateColumns: isShortOptions ? undefined : '1fr 1fr'
                  }}>
                    {q.options.map((opt, i) => (
                      <div key={i} style={{ fontSize: '11pt', whiteSpace: 'nowrap' }}>
                        {String.fromCharCode(65 + i)}. {opt}
                      </div>
                    ))}
                  </div>
                )}
                {/* 解答题答题区域 */}
                {q.question_type === 'answer' && (
                  <div style={{ 
                    marginTop: '15px', 
                    padding: '12px', 
                    border: '1px solid #ddd', 
                    borderRadius: '4px',
                    minHeight: '60px'
                  }}>
                    答：
                  </div>
                )}
              </div>
            )
          })}

          {/* 页脚 */}
          <div style={{ marginTop: '40px', textAlign: 'center', fontSize: '9pt', color: '#999', borderTop: '1px solid #ddd', paddingTop: '15px' }}>
            敏学错题本 - 智能学习助手
          </div>
          
          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '10pt', color: '#666' }}>
            第 {currentPage} 页 / 共 {totalPages} 页
          </div>
        </div>
      </div>

      {/* 底部按钮栏 */}
      <div style={{ 
        background: '#fff', 
        padding: '12px 16px',
        borderTop: '1px solid #f0f0f0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '16px'
      }}>
        <Button 
          fill="outline"
          onClick={handleExportPDF}
          style={{ 
            borderColor: '#1677ff', 
            color: '#1677ff',
            fontWeight: 'bold',
            minWidth: '100px'
          }}
        >
          PDF
        </Button>
        <Button 
          color="primary"
          onClick={handlePrint}
          style={{ minWidth: '120px' }}
        >
          直接打印
        </Button>
      </div>

      {/* 提示：实际项目中，扫描二维码后会跳转到批改页面 */}
      <div style={{ 
        position: 'absolute', 
        top: '50%', 
        left: '50%', 
        transform: 'translate(-50%, -50%)',
        background: 'rgba(0,0,0,0.8)',
        color: '#fff',
        padding: '20px',
        borderRadius: '8px',
        display: showGradingModal ? 'block' : 'none'
      }}>
        请使用独立批改页面进行批改
      </div>
    </div>
  )
}
