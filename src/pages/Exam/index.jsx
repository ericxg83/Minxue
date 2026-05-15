import { useEffect, useState } from 'react'
import {
  Button,
  Toast,
  Empty,
  Badge
} from 'antd-mobile'
import { RightOutline } from 'antd-mobile-icons'
import { useStudentStore, useExamStore } from '../../store'
import { getGeneratedExamsByStudent, getQuestionsByIds } from '../../services/apiService'
import StudentSwitcher from '../../components/StudentSwitcher'
import ExamReview from '../ExamReview'
import dayjs from 'dayjs'
import { generateExamPDF } from '../../utils/pdfGenerator'

const USE_MOCK_DATA = false

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

// 苹果风格颜色
const APPLE_COLORS = {
  primary: '#007AFF',
  success: '#34C759',
  danger: '#FF3B30',
  warning: '#FF9500',
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#1C1C1E',
  textSecondary: '#8E8E93',
  border: '#E5E5EA'
}

// 筛选标签
const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'ungraded', label: '未批改' },
  { key: 'graded', label: '已批改' }
]

// 状态配置 - 苹果风格
const STATUS_CONFIG = {
  ungraded: { text: '未批改', color: APPLE_COLORS.danger, bgColor: '#FFEBEE' },
  graded: { text: '已批改', color: APPLE_COLORS.success, bgColor: '#E8F5E9' }
}

export default function Exam() {
  const { currentStudent } = useStudentStore()
  const { setGeneratedExams, generatedExams } = useExamStore()
  
  const [activeFilter, setActiveFilter] = useState('all')
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [allExams, setAllExams] = useState([])
  const [showReview, setShowReview] = useState(false)
  const [reviewExam, setReviewExam] = useState(null)

  const loadGeneratedExams = async (forceRefresh = false) => {
    if (!currentStudent) return
    
    try {
      if (USE_MOCK_DATA) return

      const generatedExamList = await getGeneratedExamsByStudent(currentStudent.id, !forceRefresh)
      console.log('生成的试卷数据:', generatedExamList, '当前store数据:', generatedExams.length)
      
      // Merge with existing, keeping locally added ones that aren't in DB yet
      const existingIds = new Set(generatedExams.map(e => e.id))
      const dbIds = new Set(generatedExamList.map(e => e.id))
      
      // Keep locally added exams not yet in DB + all DB exams for this student
      const localOnly = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id === currentStudent.id && !dbIds.has(e.id))
      const otherStudents = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id !== currentStudent.id)
      
      setGeneratedExams([...generatedExamList, ...localOnly, ...otherStudents])

      if (!forceRefresh) {
        const backgroundRefresh = async () => {
          try {
            const freshData = await getGeneratedExamsByStudent(currentStudent.id, false)
            const dbIds = new Set(freshData.map(e => e.id))
            const localOnly = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id === currentStudent.id && !dbIds.has(e.id))
            const otherStudents = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id !== currentStudent.id)
            setGeneratedExams([...freshData, ...localOnly, ...otherStudents])
          } catch (error) {
            console.debug('后台刷新生成试卷失败:', error)
          }
        }
        
        backgroundRefresh()
      }
    } catch (error) {
      console.error('加载生成试卷失败:', error)
    }
  }

  useEffect(() => {
    if (currentStudent) {
      loadGeneratedExams(true)
    }
  }, [currentStudent?.id])

  useEffect(() => {
    const interval = setInterval(() => {
      loadGeneratedExams(true)
    }, 3000)
    return () => clearInterval(interval)
  }, [currentStudent?.id])

  useEffect(() => {
    const generated = generatedExams
      .filter(e => e.student_id === currentStudent?.id)
      .map(e => ({ ...e, source: 'generated' }))
    
    const sorted = generated.sort((a, b) => 
      new Date(b.created_at) - new Date(a.created_at)
    )
    
    setAllExams(sorted)
  }, [generatedExams, currentStudent?.id])

  const filteredExams = allExams.filter(exam => {
    if (activeFilter === 'all') return true
    return exam.status === activeFilter
  })

  const getStatusCount = (status) => {
    if (status === 'all') return allExams.length
    return allExams.filter(e => e.status === status).length
  }
  
  const totalUngradedCount = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.status === 'ungraded').length
  
  const handleOpenReview = (exam) => {
    setReviewExam(exam)
    setShowReview(true)
  }

  const handleCloseReview = () => {
    setShowReview(false)
    setReviewExam(null)
  }
  
  // 渲染状态标签 - 苹果风格
  const renderStatusTag = (status) => {
    const config = STATUS_CONFIG[status]
    if (!config) return null
    return (
      <span style={{
        color: config.color,
        fontSize: '12px',
        padding: '4px 10px',
        borderRadius: '12px',
        background: config.bgColor,
        fontWeight: 500
      }}>
        {config.text}
      </span>
    )
  }

  // 重打印试卷 - 获取错题本组卷的题目
  const handleReprint = async (exam) => {
    const questionIds = exam.question_ids || []
    if (questionIds.length === 0) {
      Toast.show({
        icon: 'fail',
        content: '该试卷暂无题目可打印'
      })
      return
    }
    
    let examQuestions = []
    try {
      examQuestions = await getQuestionsByIds(questionIds)
    } catch (error) {
      console.error('获取题目失败:', error)
      Toast.show({
        icon: 'fail',
        content: '获取题目失败'
      })
      return
    }
    
    if (examQuestions.length === 0) {
      Toast.show({
        icon: 'fail',
        content: '该试卷暂无题目可打印'
      })
      return
    }

    const examTitle = exam.name

    if (isMobile) {
      try {
        generateExamPDF({
          title: `${currentStudent?.name || '学生'} - ${examTitle}`,
          studentName: currentStudent?.name || '',
          questions: examQuestions,
          filename: `${currentStudent?.name || 'student'}_${examTitle}_${dayjs().format('YYYYMMDD_HHmm')}`,
          showAnswers: false,
        })

        Toast.show({
          icon: 'success',
          content: 'PDF已生成，请查看下载'
        })
      } catch (error) {
        console.error('PDF生成失败:', error)
        Toast.show({
          icon: 'fail',
          content: 'PDF生成失败'
        })
      }
    } else {
      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${currentStudent?.name || '学生'} - ${examTitle}</title>
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
              <div class="title">${currentStudent?.name || '学生'} - ${examTitle}</div>
              <div class="subtitle">
                <span>总题数：${examQuestions.length}题</span>
                <span>满分：100分</span>
                <span>限时：60分钟</span>
              </div>
            </div>
            
            <div class="info-bar">
              <span>姓名：______________</span>
              <span>日期：____年____月____日</span>
            </div>

            ${examQuestions.map((q, index) => {
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

      const w = window.open('', '_blank')
      if (!w) {
        Toast.show('请允许弹出窗口')
        return
      }
      w.document.write(printContent)
      w.document.close()
      w.focus()
      w.print()
      
      Toast.show({
        icon: 'success',
        content: '正在准备打印...'
      })
    }
  }

  if (!currentStudent) {
    return (
      <Empty
        description="请先选择学生"
        style={{ padding: '64px 0' }}
      />
    )
  }

  return (
    <div style={{ padding: '0', background: APPLE_COLORS.background, minHeight: '100%', paddingBottom: '80px' }}>
      {/* 顶部标题栏 - 苹果风格 */}
      <div style={{ 
        background: APPLE_COLORS.card, 
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid ' + APPLE_COLORS.border
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: APPLE_COLORS.text }}>试卷</h1>
        <Button 
          fill="none" 
          style={{ color: APPLE_COLORS.primary, fontSize: '15px' }}
          onClick={() => loadGeneratedExams(true)}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M832 384c-12.8-12.8-32-12.8-44.8 0L704 467.2V320c0-105.6-86.4-192-192-192S320 214.4 320 320s86.4 192 192 192c48 0 92.8-17.6 128-48 12.8-12.8 12.8-32 0-44.8s-32-12.8-44.8 0C572.8 438.4 544 448 512 448c-70.4 0-128-57.6-128-128s57.6-128 128-128 128 57.6 128 128v147.2l-83.2-83.2c-12.8-12.8-32-12.8-44.8 0s-12.8 32 0 44.8l137.6 137.6c12.8 12.8 32 12.8 44.8 0l137.6-137.6c12.8-12.8 12.8-32 0-44.8z"/>
            </svg>
            刷新
          </span>
        </Button>
      </div>

      {/* 学生信息卡片 - 苹果风格 */}
      <div style={{ background: APPLE_COLORS.card, padding: '16px', borderBottom: '1px solid ' + APPLE_COLORS.border }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #E8F4FD 0%, #D6EBFA 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,122,255,0.15)'
              }}
            >
              {currentStudent.avatar ? (
                <img src={currentStudent.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <svg width="28" height="28" viewBox="0 0 1024 1024" fill={APPLE_COLORS.primary}>
                  <path d="M512 512c88 0 160-72 160-160s-72-160-160-160-160 72-160 160 72 160 160 160zm0-256c52.8 0 96 43.2 96 96s-43.2 96-96 96-96-43.2-96-96 43.2-96 96-96zm448 544v64c0 35.2-28.8 64-64 64H128c-35.2 0-64-28.8-64-64v-64c0-88 72-160 160-160h32c17.6 0 34.4 3.2 50.4 9.6 33.6 12.8 70.4 20.8 108.8 23.2 9.6 0.8 19.2 1.2 28.8 1.2s19.2-0.4 28.8-1.2c38.4-2.4 75.2-10.4 108.8-23.2 16-6.4 32.8-9.6 50.4-9.6h32c88 0 160 72 160 160zM128 800h768c0-52.8-43.2-96-96-96h-32c-11.2 0-22.4 2.4-32.8 6.4-40 16-84.8 25.6-130.4 28.8-11.2 0.8-22.4 1.2-33.6 1.2s-22.4-0.4-33.6-1.2c-45.6-3.2-90.4-12.8-130.4-28.8-10.4-4-21.6-6.4-32.8-6.4h-32c-52.8 0-96 43.2-96 96z"/>
                </svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: '17px', fontWeight: 600, color: APPLE_COLORS.text }}>
                {currentStudent.name}
              </div>
              <div style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary, marginTop: '2px' }}>
                {currentStudent.class || '暂无班级'}
              </div>
            </div>
          </div>
          <Button 
            fill="none" 
            style={{ color: APPLE_COLORS.primary, fontSize: '15px', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setShowStudentSwitcher(true)}
          >
            切换学生
            <Badge 
              content={totalUngradedCount > 0 ? (totalUngradedCount > 9 ? '9+' : String(totalUngradedCount)) : null}
              style={{ 
                '--color': APPLE_COLORS.primary,
                '--background': '#fff',
                '--border': APPLE_COLORS.primary,
                '--padding': '0 6px',
                '--font-size': '12px',
                '--top': '-4px'
              }}
            >
              <RightOutline />
            </Badge>
          </Button>
        </div>
      </div>

      {/* 筛选标签 - 苹果风格 */}
      <div style={{ 
        background: APPLE_COLORS.card, 
        padding: '12px 16px',
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        borderBottom: '1px solid ' + APPLE_COLORS.border
      }}>
        {FILTER_TABS.map(tab => {
          const count = getStatusCount(tab.key)
          const isActive = activeFilter === tab.key
          const tabColor = tab.key === 'graded' ? APPLE_COLORS.success : tab.key === 'ungraded' ? APPLE_COLORS.danger : APPLE_COLORS.primary
          return (
            <div
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              style={{
                padding: '8px 16px',
                borderRadius: '20px',
                fontSize: '14px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                background: isActive ? tabColor : APPLE_COLORS.background,
                color: isActive ? '#fff' : APPLE_COLORS.textSecondary,
                fontWeight: isActive ? 600 : 400,
                transition: 'all 0.2s',
                boxShadow: isActive ? `0 2px 8px ${tabColor}40` : 'none'
              }}
            >
              {tab.label} {count}
            </div>
          )
        })}
      </div>

      {/* 试卷列表 - 苹果风格 */}
      <div style={{ padding: '12px' }}>
        {filteredExams.length === 0 ? (
          <Empty
            description="暂无试卷"
            style={{ padding: '64px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredExams.map((exam) => (
              <div
                key={exam.id}
                onClick={() => exam.status === 'graded' || exam.status === 'done' ? handleOpenReview(exam) : handleReprint(exam)}
                style={{
                  background: APPLE_COLORS.card,
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}
              >
                {/* 缩略图 - 固定试卷图标 */}
                <div 
                  style={{
                    width: '80px',
                    height: '60px',
                    borderRadius: '10px',
                    background: '#E8F4FD',
                    overflow: 'hidden',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <svg width="32" height="32" viewBox="0 0 1024 1024" fill={APPLE_COLORS.primary}>
                    <path d="M854.6 288.6L639.4 73.4c-6-6-14.1-9.4-22.6-9.4H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V311.3c0-8.5-3.4-16.7-9.4-22.7zM790.2 326H602V137.8L790.2 326zM816 872H208V152h346v192c0 17.7 14.3 32 32 32h192v496z"/>
                  </svg>
                </div>

                {/* 内容 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'flex-start',
                    marginBottom: '8px'
                  }}>
                    <div style={{ 
                      fontSize: '15px', 
                      color: APPLE_COLORS.text,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      marginRight: '8px'
                    }}>
                      {exam.name}
                    </div>
                  </div>
                  
                  {/* 上传时间 */}
                  <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>
                    上传时间：{dayjs(exam.created_at).format('YYYY/MM/DD HH:mm')}
                  </div>
                  
                  {/* 题目数量 */}
                  <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>
                    题目数量：{exam.question_ids?.length || 0}题
                  </div>

                  {/* 批改结果（仅已批改显示） */}
                  {exam.status === 'done' && (
                    <div style={{ fontSize: '13px', display: 'flex', gap: '12px', marginBottom: '4px' }}>
                      <span style={{ color: APPLE_COLORS.success }}>
                        正确 {exam.correct_count || 0}
                      </span>
                      <span style={{ color: APPLE_COLORS.danger }}>
                        错误 {exam.wrong_count || 0}
                      </span>
                    </div>
                  )}
                </div>

                {/* 右侧状态和图标 */}
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', position: 'relative' }}>
                  {exam.status === 'failed' && (
                    <span style={{ position: 'absolute', top: '-4px', right: '-4px', color: APPLE_COLORS.danger, fontSize: '16px' }} title="处理失败">
                      ⚠️
                    </span>
                  )}
                  {renderStatusTag(exam.status)}
                  {/* 所有试卷都显示重打印按钮 */}
                    <Button
                      size="small"
                      fill="outline"
                      style={{
                        borderColor: APPLE_COLORS.primary,
                        color: APPLE_COLORS.primary,
                        fontSize: '12px',
                        padding: '4px 10px',
                        borderRadius: '10px',
                        marginTop: '4px'
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleReprint(exam)
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor">
                          <path d="M768 256H640v-64c0-35.2-28.8-64-64-64H448c-35.2 0-64 28.8-64 64v64H256c-52.8 0-96 43.2-96 96v320c0 52.8 43.2 96 96 96h512c52.8 0 96-43.2 96-96V352c0-52.8-43.2-96-96-96zM448 192h128v64H448V192zm320 512H256V352h512v352z"/>
                          <path d="M320 448h384v64H320zM320 544h256v64H320z"/>
                        </svg>
                        {isMobile ? '下载PDF' : '重打印'}
                      </span>
                    </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 学生切换弹窗 */}
      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        badgeType="grading"
      />

      {/* 试卷复审弹窗 */}
      {showReview && reviewExam && (
        <ExamReview
          task={reviewExam}
          onClose={handleCloseReview}
        />
      )}
    </div>
  )
}
