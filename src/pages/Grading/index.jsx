import { useState, useEffect } from 'react'
import {
  Button,
  Toast,
  NavBar,
  ProgressBar,
  Card,
  Dialog
} from 'antd-mobile'
import { mockWrongQuestions, mockStudents } from '../../data/mockData'
import { useWrongQuestionStore } from '../../store'
import dayjs from 'dayjs'

// 使用测试数据
const USE_MOCK_DATA = true

export default function Grading({ paperId, studentId, onClose, onComplete }) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [questions, setQuestions] = useState([])
  const [gradingResults, setGradingResults] = useState({})
  const [studentInfo, setStudentInfo] = useState(null)
  const [showResult, setShowResult] = useState(false)
  // 如果有 paperId，说明是从扫码进入，直接显示批改页面
  const [isScanning, setIsScanning] = useState(!paperId)
  
  const { wrongQuestions, updateWrongQuestionStatus } = useWrongQuestionStore()

  // 初始化加载数据
  useEffect(() => {
    console.log('Grading: 初始化', { paperId, studentId })
    if (USE_MOCK_DATA) {
      // 加载测试数据 - 获取该学生的错题
      const student = mockStudents.find(s => s.id === studentId) || mockStudents[0]
      const testQuestions = mockWrongQuestions
        .filter(wq => wq.student_id === student.id)
        .map(wq => ({
          ...wq.question,
          wrongQuestionId: wq.id,
          originalStatus: wq.status
        }))
      
      console.log('Grading: 加载题目', testQuestions.length, '道')
      setQuestions(testQuestions)
      setStudentInfo({
        name: student.name,
        class: student.class,
        date: dayjs().format('YYYY-MM-DD'),
        retryCount: 2
      })
    }
  }, [paperId, studentId])

  // 模拟扫描完成
  const handleScanComplete = () => {
    setIsScanning(false)
    Toast.show({ icon: 'success', content: '扫描成功' })
  }

  // 标记题目掌握状态
  const handleMarkStatus = (status) => {
    const currentQuestion = questions[currentQuestionIndex]
    const newResults = {
      ...gradingResults,
      [currentQuestion.id]: {
        ...gradingResults[currentQuestion.id],
        status,
        questionId: currentQuestion.id,
        wrongQuestionId: currentQuestion.wrongQuestionId,
        markedAt: Date.now()
      }
    }
    setGradingResults(newResults)

    // 自动下一题
    if (currentQuestionIndex < questions.length - 1) {
      setTimeout(() => {
        setCurrentQuestionIndex(currentQuestionIndex + 1)
      }, 300)
    } else {
      // 最后一题，显示结果
      setTimeout(() => {
        setShowResult(true)
      }, 300)
    }
  }

  // 上一题
  const handlePrev = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1)
    }
  }

  // 下一题
  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
    }
  }

  // 完成批改
  const handleComplete = async () => {
    // 计算统计
    const masteredCount = Object.values(gradingResults).filter(r => r.status === 'mastered').length
    const notMasteredCount = Object.values(gradingResults).filter(r => r.status === 'not_mastered').length
    
    // 更新错题本状态
    if (USE_MOCK_DATA) {
      // 模拟更新错题本状态
      Object.values(gradingResults).forEach(result => {
        if (result.wrongQuestionId) {
          updateWrongQuestionStatus(result.wrongQuestionId, result.status)
        }
      })
    }
    
    Toast.show({ 
      icon: 'success', 
      content: `批改完成！已掌握 ${masteredCount} 题，未掌握 ${notMasteredCount} 题` 
    })
    
    onComplete && onComplete({
      masteredCount,
      notMasteredCount,
      totalQuestions: questions.length,
      results: gradingResults
    })
  }

  // 渲染扫描页面
  const renderScanPage = () => (
    <div style={{ 
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#000',
      zIndex: 2000
    }}>
      {/* 扫描区域 */}
      <div style={{ 
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}>
        {/* 试卷预览卡片 */}
        <div style={{
          width: '280px',
          background: '#fff',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '40px'
        }}>
          <div style={{ 
            textAlign: 'center', 
            borderBottom: '2px solid #333',
            paddingBottom: '10px',
            marginBottom: '15px'
          }}>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>数学错题重练卷</div>
          </div>
          
          <div style={{ fontSize: '13px', color: '#333', marginBottom: '8px' }}>
            学生姓名：{studentInfo?.name}
          </div>
          <div style={{ fontSize: '13px', color: '#333', marginBottom: '8px' }}>
            重练次数：第{studentInfo?.retryCount}次
          </div>
          <div style={{ fontSize: '13px', color: '#333', marginBottom: '15px' }}>
            日期：{studentInfo?.date}
          </div>
          
          {/* 二维码占位 */}
          <div style={{
            width: '80px',
            height: '80px',
            background: '#f5f5f5',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #ddd'
          }}>
            <div style={{ fontSize: '10px', color: '#999' }}>二维码</div>
          </div>
        </div>

        {/* 扫描提示 */}
        <div style={{ color: '#fff', fontSize: '14px', textAlign: 'center' }}>
          将二维码放入框内，自动识别
        </div>
      </div>

      {/* 底部按钮 */}
      <div style={{ 
        padding: '20px',
        display: 'flex',
        justifyContent: 'center',
        gap: '40px'
      }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '8px'
          }}>
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M512 512m-512 0a512 512 0 1 0 1024 0 512 512 0 1 0-1024 0Z"/>
            </svg>
          </div>
          <div style={{ fontSize: '12px' }}>相册</div>
        </div>
        
        <div 
          onClick={handleScanComplete}
          style={{ 
            width: '64px', 
            height: '64px', 
            borderRadius: '50%',
            border: '4px solid #fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <div style={{ 
            width: '52px', 
            height: '52px', 
            borderRadius: '50%',
            background: '#fff'
          }} />
        </div>
        
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '8px'
          }}>
            <svg width="24" height="24" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M512 128c-211.2 0-384 172.8-384 384s172.8 384 384 384 384-172.8 384-384-172.8-384-384-384z m0 704c-176.8 0-320-143.2-320-320s143.2-320 320-320 320 143.2 320 320-143.2 320-320 320z"/>
              <path d="M512 320c-17.6 0-32 14.4-32 32v160c0 17.6 14.4 32 32 32s32-14.4 32-32V352c0-17.6-14.4-32-32-32z"/>
              <path d="M512 544c-17.6 0-32 14.4-32 32s14.4 32 32 32 32-14.4 32-32-14.4-32-32-32z"/>
            </svg>
          </div>
          <div style={{ fontSize: '12px' }}>扫码历史</div>
        </div>
      </div>
    </div>
  )

  // 渲染批改页面
  const renderGradingPage = () => {
    const currentQuestion = questions[currentQuestionIndex]
    const currentResult = gradingResults[currentQuestion?.id]
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100

    if (!currentQuestion) {
      return (
        <div style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f5f5f5',
          zIndex: 2000
        }}>
          <div style={{ fontSize: '16px', color: '#999' }}>加载中...</div>
        </div>
      )
    }

    const isShortOptions = currentQuestion.options && currentQuestion.options.every(opt => opt.length <= 10)

    return (
      <div style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#f5f5f5',
        zIndex: 2000
      }}>
        {/* 顶部导航 */}
        <NavBar
          back={null}
          left={<Button fill="none" onClick={onClose}>退出</Button>}
          right={<span style={{ color: '#1677ff' }}>批改中</span>}
        >
          批改中
        </NavBar>

        {/* 进度条 */}
        <div style={{ padding: '12px 16px', background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
            <span>{studentInfo?.name}</span>
            <span style={{ color: '#999' }}>{studentInfo?.date}</span>
            <span>第{studentInfo?.retryCount}次重练</span>
          </div>
          <ProgressBar
            percent={progress}
            style={{
              '--fill-color': '#1677ff',
              '--track-color': '#e6f7ff'
            }}
          />
          <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '12px', color: '#999' }}>
            进度 {currentQuestionIndex + 1}/{questions.length}
          </div>
        </div>

        {/* 题目内容 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          <Card style={{ marginBottom: '12px' }}>
            {/* 题号 */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '12px'
            }}>
              <div>
                <span style={{ 
                  color: '#1677ff', 
                  fontSize: '14px', 
                  fontWeight: 'bold',
                  marginRight: '8px'
                }}>
                  第 {currentQuestionIndex + 1} 题
                </span>
                <span style={{ color: '#999', fontSize: '13px' }}>
                  {currentQuestion.question_type === 'choice' ? '选择题' : 
                   currentQuestion.question_type === 'fill' ? '填空题' : '解答题'}
                </span>
              </div>
            </div>

            {/* 题目 */}
            <div style={{ fontSize: '15px', color: '#333', lineHeight: '1.6', marginBottom: '16px' }}>
              {currentQuestion.content}
            </div>

            {/* 选项 */}
            {currentQuestion.options && currentQuestion.options.length > 0 && (
              <div style={{ 
                display: isShortOptions ? 'flex' : 'grid',
                flexWrap: 'wrap',
                gap: isShortOptions ? '24px' : '8px',
                gridTemplateColumns: isShortOptions ? undefined : '1fr 1fr',
                marginBottom: '16px'
              }}>
                {currentQuestion.options.map((opt, i) => (
                  <div key={i} style={{ fontSize: '14px', color: '#333' }}>
                    {String.fromCharCode(65 + i)}. {opt}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 参考答案 */}
          <Card style={{ marginBottom: '12px', background: '#e6f7ff', border: '1px solid #91d5ff' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1677ff', marginBottom: '8px' }}>
              参考答案
            </div>
            <div style={{ fontSize: '14px', color: '#333', lineHeight: '1.6' }}>
              {currentQuestion.answer || '暂无答案'}
            </div>
          </Card>

          {/* 解析 */}
          <Card style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#52c41a', marginBottom: '8px' }}>
              解析
            </div>
            <div style={{ fontSize: '14px', color: '#333', lineHeight: '1.6' }}>
              {currentQuestion.analysis || 
                `本题考查${currentQuestion.question_type === 'choice' ? '基础概念' : '计算能力'}。` +
                `正确答案是 ${currentQuestion.answer}。` +
                `解题思路：根据题目条件，运用相关知识点进行推导计算。`
              }
            </div>
          </Card>
        </div>

        {/* 底部操作 */}
        <div style={{ 
          background: '#fff', 
          padding: '16px',
          borderTop: '1px solid #f0f0f0'
        }}>
          {/* 掌握状态按钮 */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
            <Button
              block
              color={currentResult?.status === 'mastered' ? 'success' : 'default'}
              onClick={() => handleMarkStatus('mastered')}
              style={{
                background: currentResult?.status === 'mastered' ? '#52c41a' : '#f6ffed',
                color: currentResult?.status === 'mastered' ? '#fff' : '#52c41a',
                border: 'none'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                  <path d="M912 224l-48-48-400 400-176-176-48 48 224 224z"/>
                </svg>
                已掌握
              </span>
            </Button>
            <Button
              block
              color={currentResult?.status === 'not_mastered' ? 'danger' : 'default'}
              onClick={() => handleMarkStatus('not_mastered')}
              style={{
                background: currentResult?.status === 'not_mastered' ? '#ff4d4f' : '#fff1f0',
                color: currentResult?.status === 'not_mastered' ? '#fff' : '#ff4d4f',
                border: 'none'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                  <path d="M544 448H320c-17.6 0-32 14.4-32 32s14.4 32 32 32h224c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
                  <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
                </svg>
                未掌握
              </span>
            </Button>
          </div>

          {/* 导航按钮 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button 
              size="small" 
              fill="none"
              disabled={currentQuestionIndex === 0}
              onClick={handlePrev}
            >
              上一题
            </Button>
            <span style={{ fontSize: '14px', color: '#666' }}>
              {currentQuestionIndex + 1} / {questions.length}
            </span>
            <Button 
              size="small" 
              fill="none"
              disabled={currentQuestionIndex === questions.length - 1}
              onClick={handleNext}
            >
              下一题
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // 渲染结果页面
  const renderResultPage = () => {
    const masteredCount = Object.values(gradingResults).filter(r => r.status === 'mastered').length
    const notMasteredCount = Object.values(gradingResults).filter(r => r.status === 'not_mastered').length
    const total = questions.length

    return (
      <div style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
        padding: '24px',
        zIndex: 2000,
        overflow: 'auto'
      }}>
        {/* 成功图标 */}
        <div style={{ textAlign: 'center', marginTop: '40px', marginBottom: '24px' }}>
          <div style={{
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            position: 'relative'
          }}>
            <svg width="60" height="60" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M912 224l-48-48-400 400-176-176-48 48 224 224z"/>
            </svg>
            {/* 装饰星星 */}
            <div style={{ position: 'absolute', top: '-10px', right: '-10px' }}>
              <svg width="30" height="30" viewBox="0 0 1024 1024" fill="#faad14">
                <path d="M512 64l128 320 352 32-272 224 96 352-304-208-304 208 96-352L32 416l352-32z"/>
              </svg>
            </div>
          </div>
        </div>

        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
            恭喜您！
          </div>
          <div style={{ fontSize: '14px', color: '#666' }}>
            本次批改已完成
          </div>
          <div style={{ fontSize: '14px', color: '#666' }}>
            你消灭了 {masteredCount} 道错题！
          </div>
        </div>

        {/* 统计卡片 */}
        <Card style={{ marginBottom: '24px', background: '#f6ffed', border: '1px solid #b7eb8f' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ 
              width: '80px', 
              height: '80px', 
              borderRadius: '50%',
              border: '8px solid #52c41a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto',
              position: 'relative'
            }}>
              <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#52c41a' }}>
                {masteredCount}
              </span>
              <span style={{ fontSize: '12px', color: '#999', position: 'absolute', bottom: '8px' }}>
                已掌握
              </span>
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '13px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#52c41a', fontWeight: 'bold' }}>{masteredCount} 题</div>
              <div style={{ color: '#999' }}>已掌握 ({Math.round(masteredCount/total*100)}%)</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#ff4d4f', fontWeight: 'bold' }}>{notMasteredCount} 题</div>
              <div style={{ color: '#999' }}>未掌握 ({Math.round(notMasteredCount/total*100)}%)</div>
            </div>
          </div>
        </Card>

        {/* 统计详情 */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '14px' }}>
            <span style={{ color: '#666' }}>重练次数</span>
            <span style={{ color: '#333' }}>+1（本次累计 {studentInfo?.retryCount} 次）</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
            <span style={{ color: '#666' }}>错题本状态</span>
            <span style={{ color: '#52c41a' }}>已同步更新</span>
          </div>
        </div>

        {/* 完成按钮 */}
        <Button 
          block 
          color="primary" 
          size="large"
          onClick={handleComplete}
        >
          完成
        </Button>
      </div>
    )
  }

  // 根据状态渲染不同页面
  if (isScanning) {
    return renderScanPage()
  }

  if (showResult) {
    return renderResultPage()
  }

  return renderGradingPage()
}
