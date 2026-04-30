import { useEffect, useState, useRef } from 'react'
import {
  Button,
  Toast,
  Empty,
  Dialog,
  SpinLoading,
  Checkbox,
  Badge,
  Dropdown,
  Space,
  Mask
} from 'antd-mobile'
import { RightOutline, DownOutline } from 'antd-mobile-icons'
import { useStudentStore, useWrongQuestionStore, useUIStore } from '../../store'
import { getWrongQuestionsByStudent, deleteWrongQuestion, updateWrongQuestionStatus } from '../../services/supabaseService'
import { generateQRCodeContent } from '../../services/aiService'
import { mockWrongQuestions, mockStudents } from '../../data/mockData'
import StudentSwitcher from '../../components/StudentSwitcher'
import PrintPreview from '../PrintPreview'
import QuestionEdit from '../QuestionEdit'
import dayjs from 'dayjs'

// 使用测试数据
const USE_MOCK_DATA = false

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

// 掌握状态筛选标签
const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '未掌握' },
  { key: 'mastered', label: '已掌握' }
]

// 科目选项
const SUBJECT_OPTIONS = [
  { key: 'all', label: '全部科目' },
  { key: '数学', label: '数学' },
  { key: '语文', label: '语文' },
  { key: '英语', label: '英语' },
  { key: '物理', label: '物理' },
  { key: '化学', label: '化学' }
]

// 时间筛选选项
const TIME_OPTIONS = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '最近7天' },
  { key: 'month', label: '最近30天' },
  { key: 'quarter', label: '最近3个月' }
]

// 错误次数筛选选项
const ERROR_COUNT_OPTIONS = [
  { key: 'all', label: '全部次数' },
  { key: '1', label: '1次' },
  { key: '2-3', label: '2-3次' },
  { key: '4-5', label: '4-5次' },
  { key: '5+', label: '5次以上' }
]

export default function WrongBook({ onScanQR }) {
  const { currentStudent } = useStudentStore()
  const { 
    wrongQuestions, 
    setWrongQuestions, 
    selectedQuestions, 
    setSelectedQuestions,
    clearSelection 
  } = useWrongQuestionStore()
  
  const [activeStatus, setActiveStatus] = useState('pending')
  const [activeSubject, setActiveSubject] = useState('all')
  const [activeTime, setActiveTime] = useState('all')
  const [activeErrorCount, setActiveErrorCount] = useState('all')
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState(null)

  // 组件挂载时，初始化所有学生的 mock 数据到 store
  useEffect(() => {
    if (USE_MOCK_DATA && mockWrongQuestions.length > 0) {
      // 合并 mock 数据和 store 中已有的数据（避免覆盖用户添加的数据）
      const existingIds = new Set(wrongQuestions.map(wq => wq.id))
      const newMockQuestions = mockWrongQuestions.filter(wq => !existingIds.has(wq.id))
      
      if (newMockQuestions.length > 0) {
        setWrongQuestions(prev => [...prev, ...newMockQuestions])
      }
    }
  }, []) // 只在组件挂载时执行一次

  // 加载错题本
  useEffect(() => {
    if (currentStudent) {
      loadData()
    }
  }, [currentStudent?.id])
  


  const loadData = async () => {
    if (!currentStudent) return
    
    try {
      if (USE_MOCK_DATA) {
        // mock 数据已经在组件挂载时加载到 store，这里不需要重复加载
        // 只需要确保当前学生的数据正确显示即可
        return
      }

      // 使用缓存数据（秒开）
      const data = await getWrongQuestionsByStudent(currentStudent.id, true)
      // 确保 data 是数组
      const safeData = Array.isArray(data) ? data : []
      setWrongQuestions(prev => {
        // 合并新数据，避免覆盖其他学生的数据
        const existingIds = new Set(prev.map(wq => wq.id))
        const newData = safeData.filter(d => !existingIds.has(d.id))
        return [...prev, ...newData]
      })

      // 后台静默刷新最新数据
      const backgroundRefresh = async () => {
        try {
          const freshData = await getWrongQuestionsByStudent(currentStudent.id, false)
          const safeFreshData = Array.isArray(freshData) ? freshData : []
          setWrongQuestions(safeFreshData)
        } catch (error) {
          console.debug('后台刷新错题失败:', error)
        }
      }
      
      backgroundRefresh()
    } catch (error) {
      console.error('加载错题失败:', error)
    }
  }

  // 时间筛选辅助函数
  const isWithinTimeRange = (dateStr, timeKey) => {
    if (timeKey === 'all') return true
    const date = dayjs(dateStr)
    const now = dayjs()
    switch (timeKey) {
      case 'today':
        return date.isSame(now, 'day')
      case 'week':
        return date.isAfter(now.subtract(7, 'day'))
      case 'month':
        return date.isAfter(now.subtract(30, 'day'))
      case 'quarter':
        return date.isAfter(now.subtract(90, 'day'))
      default:
        return true
    }
  }

  // 错误次数筛选辅助函数
  const matchErrorCount = (count, filterKey) => {
    if (filterKey === 'all') return true
    switch (filterKey) {
      case '1':
        return count === 1
      case '2-3':
        return count >= 2 && count <= 3
      case '4-5':
        return count >= 4 && count <= 5
      case '5+':
        return count > 5
      default:
        return true
    }
  }

  // 筛选错题（只显示当前学生的错题）
  const filteredQuestions = wrongQuestions.filter(wq => {
    // 首先过滤当前学生的错题
    if (wq.student_id !== currentStudent?.id) return false
    
    // 掌握状态筛选
    if (activeStatus !== 'all' && wq.status !== activeStatus) return false
    
    // 科目筛选
    if (activeSubject !== 'all' && wq.subject !== activeSubject) return false
    
    // 时间筛选
    if (activeTime !== 'all' && !isWithinTimeRange(wq.added_at || wq.created_at, activeTime)) return false
    
    // 错误次数筛选
    if (activeErrorCount !== 'all' && !matchErrorCount(wq.error_count || 1, activeErrorCount)) return false
    
    return true
  })

  // 获取各状态数量（只统计当前学生的错题）
  const getStatusCount = (status) => {
    const studentQuestions = wrongQuestions.filter(wq => wq.student_id === currentStudent?.id)
    if (status === 'all') return studentQuestions.length
    return studentQuestions.filter(wq => wq.status === status).length
  }

  // 获取当前筛选条件的显示文本
  const getFilterLabel = () => {
    const parts = []
    if (activeSubject !== 'all') {
      parts.push(SUBJECT_OPTIONS.find(o => o.key === activeSubject)?.label)
    }
    if (activeTime !== 'all') {
      parts.push(TIME_OPTIONS.find(o => o.key === activeTime)?.label)
    }
    if (activeErrorCount !== 'all') {
      parts.push(ERROR_COUNT_OPTIONS.find(o => o.key === activeErrorCount)?.label)
    }
    return parts.length > 0 ? parts.join(' · ') : '筛选'
  }

  // 是否有激活的筛选条件
  const hasActiveFilters = activeSubject !== 'all' || activeTime !== 'all' || activeErrorCount !== 'all'

  // 重置所有筛选
  const resetFilters = () => {
    setActiveSubject('all')
    setActiveTime('all')
    setActiveErrorCount('all')
  }

  // 获取统计数据（只统计当前学生的错题）
  const getStats = () => {
    const studentQuestions = wrongQuestions.filter(wq => wq.student_id === currentStudent?.id)
    const total = studentQuestions.length
    const mastered = studentQuestions.filter(wq => wq.status === 'mastered').length
    const pending = total - mastered
    return { total, mastered, pending }
  }

  // 切换选择
  const toggleSelection = (wq) => {
    const exists = selectedQuestions.find(sq => sq.id === wq.id)
    if (exists) {
      setSelectedQuestions(selectedQuestions.filter(sq => sq.id !== wq.id))
    } else {
      setSelectedQuestions([...selectedQuestions, wq])
    }
  }

  // 清空选择
  const handleClearSelection = () => {
    clearSelection()
  }

  // 删除错题
  const handleDelete = async (id) => {
    Dialog.confirm({
      content: '确定从错题本中移除这道题？',
      confirmText: '移除',
      onConfirm: async () => {
        try {
          await deleteWrongQuestion(id)
          loadData()
          Toast.show({
            icon: 'success',
            content: '已移除'
          })
        } catch (error) {
          Toast.show({
            icon: 'fail',
            content: '移除失败'
          })
        }
      }
    })
  }

  // 标记为已掌握
  const handleMarkMastered = async (id) => {
    try {
      await updateWrongQuestionStatus(id, 'mastered')
      loadData()
      Toast.show({
        icon: 'success',
        content: '已标记为掌握'
      })
    } catch (error) {
      Toast.show({
        icon: 'fail',
        content: '操作失败'
      })
    }
  }

  // 编辑题目
  const handleEditQuestion = (wq) => {
    setEditingQuestion(wq)
  }

  // 保存编辑
  const handleSaveEdit = (updatedQuestion) => {
    const updatedWrongQuestions = wrongQuestions.map(wq => {
      if (wq.id === updatedQuestion.id || wq.question_id === updatedQuestion.id) {
        return { ...wq, question: updatedQuestion }
      }
      return wq
    })
    setWrongQuestions(updatedWrongQuestions)
    setEditingQuestion(null)
  }

  // 生成打印内容
  const handlePrint = () => {
    if (selectedQuestions.length === 0) {
      Toast.show('请先选择要打印的题目')
      return
    }

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      Toast.show('请允许弹出窗口')
      return
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>错题打印 - ${currentStudent?.name || '学生'}</title>
        <style>
          @page { size: A4; margin: 20mm; }
          body { font-family: 'Microsoft YaHei', sans-serif; line-height: 1.6; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .student-name { font-size: 18px; font-weight: bold; }
          .date { font-size: 12px; color: #666; margin-top: 5px; }
          .question { margin-bottom: 30px; page-break-inside: avoid; }
          .question-number { font-weight: bold; font-size: 14px; margin-bottom: 10px; }
          .question-content { font-size: 14px; margin-bottom: 10px; }
          .options { margin-left: 20px; margin-bottom: 10px; }
          .option { margin-bottom: 5px; }
          .answer-section { margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 5px; }
          .answer-label { font-weight: bold; color: #333; }
          .student-answer { color: #ff4d4f; }
          .correct-answer { color: #52c41a; }
          .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #ddd; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="student-name">${currentStudent?.name || '学生'} - 错题练习</div>
          <div class="date">生成时间：${dayjs().format('YYYY年MM月DD日 HH:mm')}</div>
        </div>
        ${selectedQuestions.map((wq, index) => {
          const q = wq.question || wq
          return `
            <div class="question">
              <div class="question-number">题目 ${index + 1}</div>
              <div class="question-content">${q.content || '无内容'}</div>
              ${q.options && q.options.length > 0 ? `
                <div class="options">
                  ${q.options.map((opt, i) => `<div class="option">${String.fromCharCode(65 + i)}. ${opt}</div>`).join('')}
                </div>
              ` : ''}
              <div class="answer-section">
                <div><span class="answer-label">你的答案：</span><span class="student-answer">${q.student_answer || '未作答'}</span></div>
                <div><span class="answer-label">正确答案：</span><span class="correct-answer">${q.answer || '无'}</span></div>
              </div>
            </div>
          `
        }).join('')}
        <div class="footer">敏学错题本</div>
        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `

    printWindow.document.write(printContent)
    printWindow.document.close()
  }

  // 渲染掌握状态标签 - 苹果风格
  const renderMasteredTag = (status) => {
    if (status === 'mastered') {
      return (
        <span style={{
          color: APPLE_COLORS.success,
          fontSize: '12px',
          padding: '4px 10px',
          borderRadius: '12px',
          background: '#E8F5E9',
          fontWeight: 500
        }}>
          已掌握
        </span>
      )
    }
    return (
      <span style={{
        color: APPLE_COLORS.danger,
        fontSize: '12px',
        padding: '4px 10px',
        borderRadius: '12px',
        background: '#FFEBEE',
        fontWeight: 500
      }}>
        未掌握
      </span>
    )
  }

  const stats = getStats()

  // 计算所有学生未掌握题的总数（用于顶部按钮提醒）
  const getTotalPendingCount = () => {
    return wrongQuestions.filter(wq => wq.status !== 'mastered').length
  }
  
  const totalPendingCount = getTotalPendingCount()

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
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: APPLE_COLORS.text }}>错题本</h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button fill="none" style={{ color: APPLE_COLORS.textSecondary, fontSize: '15px' }}>
            <svg width="22" height="22" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M464 144c0-26.4 21.6-48 48-48s48 21.6 48 48-21.6 48-48 48-48-21.6-48-48z"/>
              <path d="M464 464c0-26.4 21.6-48 48-48s48 21.6 48 48-21.6 48-48 48-48-21.6-48-48z"/>
              <path d="M464 784c0-26.4 21.6-48 48-48s48 21.6 48 48-21.6 48-48 48-48-21.6-48-48z"/>
            </svg>
          </Button>
        </div>
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
              content={totalPendingCount > 0 ? (totalPendingCount > 99 ? '99+' : String(totalPendingCount)) : null}
              style={{ 
                '--color': APPLE_COLORS.danger,
                '--background': '#fff',
                '--border': APPLE_COLORS.danger,
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

      {/* 统计卡片 - 苹果风格 */}
      <div style={{ background: APPLE_COLORS.card, padding: '16px', borderBottom: '1px solid ' + APPLE_COLORS.border }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ 
            flex: 1, 
            background: '#FFEBEE', 
            padding: '14px', 
            borderRadius: '12px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>错题数量</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: APPLE_COLORS.danger }}>{stats.total}道</div>
          </div>
          <div style={{ 
            flex: 1, 
            background: '#E8F5E9', 
            padding: '14px', 
            borderRadius: '12px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>已掌握</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: APPLE_COLORS.success }}>{stats.mastered}道</div>
          </div>
          <div style={{ 
            flex: 1, 
            background: '#E8F4FD', 
            padding: '14px', 
            borderRadius: '12px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>未掌握</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: APPLE_COLORS.primary }}>{stats.pending}道</div>
          </div>
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
        {STATUS_TABS.map(tab => {
          const count = getStatusCount(tab.key)
          const isActive = activeStatus === tab.key
          const tabColor = tab.key === 'mastered' ? APPLE_COLORS.success : tab.key === 'pending' ? APPLE_COLORS.danger : APPLE_COLORS.primary
          return (
            <div
              key={tab.key}
              onClick={() => setActiveStatus(tab.key)}
              style={{
                padding: '8px 14px',
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

      {/* 高级筛选栏 - 苹果风格 */}
      <div style={{ 
        background: APPLE_COLORS.card, 
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid ' + APPLE_COLORS.border
      }}>
        <div 
          onClick={() => setShowFilterPanel(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '8px 14px',
            borderRadius: '20px',
            background: hasActiveFilters ? '#E8F4FD' : APPLE_COLORS.background,
            color: hasActiveFilters ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
            fontSize: '14px',
            cursor: 'pointer',
            fontWeight: hasActiveFilters ? 500 : 400
          }}
        >
          <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
            <path d="M832 160H192c-17.6 0-32 14.4-32 32s14.4 32 32 32h640c17.6 0 32-14.4 32-32s-14.4-32-32-32zM704 352H320c-17.6 0-32 14.4-32 32s14.4 32 32 32h384c17.6 0 32-14.4 32-32s-14.4-32-32-32zM576 544H448c-17.6 0-32 14.4-32 32s14.4 32 32 32h128c17.6 0 32-14.4 32-32s-14.4-32-32-32zM512 736c-17.6 0-32 14.4-32 32s14.4 32 32 32 32-14.4 32-32-14.4-32-32-32z"/>
          </svg>
          {getFilterLabel()}
          <DownOutline />
        </div>
        {hasActiveFilters && (
          <div 
            onClick={resetFilters}
            style={{
              fontSize: '14px',
              color: APPLE_COLORS.textSecondary,
              cursor: 'pointer'
            }}
          >
            重置
          </div>
        )}
      </div>

      {/* 错题列表 - 苹果风格 */}
      <div style={{ padding: '12px' }}>
        {filteredQuestions.length === 0 ? (
          <Empty
            description="错题本为空"
            style={{ padding: '64px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredQuestions.map((wq) => {
              const question = wq.question || wq
              const isSelected = selectedQuestions.some(sq => sq.id === wq.id)
              
              return (
                <div
                  key={wq.id}
                  style={{
                    background: APPLE_COLORS.card,
                    borderRadius: '12px',
                    padding: '16px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                  }}
                >
                  {/* 头部：复选框、分类、日期、掌握状态 */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleSelection(wq)}
                      />
                      <span style={{ fontSize: '14px', color: APPLE_COLORS.textSecondary }}>
                        {question.subject || '数学'} · {question.category || '其他'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary }}>
                        {dayjs(wq.added_at || wq.created_at).format('YYYY-MM-DD')}
                      </span>
                      {renderMasteredTag(wq.status)}
                    </div>
                  </div>

                  {/* 题目内容 */}
                  <div style={{ 
                    fontSize: '15px', 
                    color: APPLE_COLORS.text, 
                    lineHeight: '1.6',
                    marginBottom: '8px'
                  }}>
                    {question.content}
                  </div>

                  {/* 错误次数 */}
                  <div style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>错误次数：{question.wrong_count || 1}次</span>
                    <span 
                      onClick={() => handleEditQuestion(wq)}
                      style={{ 
                        color: APPLE_COLORS.primary, 
                        fontSize: '13px', 
                        cursor: 'pointer',
                        fontWeight: 500
                      }}
                    >
                      编辑
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 底部操作栏 - 苹果风格 */}
      <div style={{
        position: 'fixed',
        bottom: '50px',
        left: 0,
        right: 0,
        background: APPLE_COLORS.card,
        padding: '12px 16px',
        borderTop: '1px solid ' + APPLE_COLORS.border,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 100
      }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button 
            fill="outline"
            onClick={onScanQR}
            style={{ 
              borderColor: APPLE_COLORS.success, 
              color: APPLE_COLORS.success,
              borderRadius: '10px'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
                <path d="M320 320h128v128H320zM576 320h128v128H576zM320 576h128v128H320zM576 576h128v128H576zM128 128h256v256H128zM640 128h256v256H640zM128 640h256v256H128zM640 640h256v256H640z"/>
              </svg>
              扫码批改
            </span>
          </Button>
          <div style={{ fontSize: '14px', color: APPLE_COLORS.textSecondary, display: 'flex', alignItems: 'center' }}>
            已选 <strong style={{ color: APPLE_COLORS.primary, margin: '0 4px' }}>{selectedQuestions.length}</strong> 题
          </div>
        </div>
        <Button 
          color="primary" 
          disabled={selectedQuestions.length === 0}
          onClick={() => setShowPrintPreview(true)}
          style={{ 
            minWidth: '100px',
            background: APPLE_COLORS.primary,
            borderRadius: '10px'
          }}
        >
          打印 ({selectedQuestions.length})
        </Button>
      </div>

      {/* 打印预览弹窗 */}
      {showPrintPreview && (
        <PrintPreview
          onClose={() => setShowPrintPreview(false)}
        />
      )}

      {/* 学生切换弹窗 */}
      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        badgeType="wrongbook"
      />

      {/* 题目编辑弹窗 */}
      {editingQuestion && (
        <QuestionEdit
          questionId={editingQuestion.question?.id || editingQuestion.question_id}
          visible={!!editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSave={handleSaveEdit}
        />
      )}

      {/* 筛选面板弹窗 - 苹果风格 */}
      <Mask
        visible={showFilterPanel}
        onMaskClick={() => setShowFilterPanel(false)}
        opacity={0.5}
      >
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: APPLE_COLORS.card,
          borderRadius: '20px 20px 0 0',
          maxHeight: '80vh',
          overflow: 'auto'
        }}>
          {/* 面板头部 */}
          <div style={{
            padding: '16px',
            borderBottom: '1px solid ' + APPLE_COLORS.border,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: '18px', fontWeight: 600, color: APPLE_COLORS.text }}>筛选条件</span>
            <div 
              onClick={() => setShowFilterPanel(false)}
              style={{ padding: '4px', cursor: 'pointer' }}
            >
              <svg width="24" height="24" viewBox="0 0 1024 1024" fill={APPLE_COLORS.textSecondary}>
                <path d="M563.8 512l262.5-312.9c4.4-5.2.7-13.1-6.1-13.1h-79.8c-4.7 0-9.2 2.1-12.3 5.7L511.6 449.8 295.1 191.7c-3-3.6-7.5-5.7-12.3-5.7H203c-6.8 0-10.5 7.9-6.1 13.1L459.4 512 196.9 824.9c-4.4 5.2-.7 13.1 6.1 13.1h79.8c4.7 0 9.2-2.1 12.3-5.7l216.5-258.1 216.5 258.1c3 3.6 7.5 5.7 12.3 5.7h79.8c6.8 0 10.5-7.9 6.1-13.1L563.8 512z"/>
              </svg>
            </div>
          </div>

          {/* 筛选内容 */}
          <div style={{ padding: '16px' }}>
            {/* 科目筛选 */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '15px', color: APPLE_COLORS.text, marginBottom: '12px', fontWeight: 500 }}>科目</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {SUBJECT_OPTIONS.map(option => (
                  <div
                    key={option.key}
                    onClick={() => setActiveSubject(option.key)}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '20px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      background: activeSubject === option.key ? APPLE_COLORS.primary : APPLE_COLORS.background,
                      color: activeSubject === option.key ? '#fff' : APPLE_COLORS.textSecondary,
                      fontWeight: activeSubject === option.key ? 500 : 400,
                      transition: 'all 0.2s'
                    }}
                  >
                    {option.label}
                  </div>
                ))}
              </div>
            </div>

            {/* 时间筛选 */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '15px', color: APPLE_COLORS.text, marginBottom: '12px', fontWeight: 500 }}>加入时间</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {TIME_OPTIONS.map(option => (
                  <div
                    key={option.key}
                    onClick={() => setActiveTime(option.key)}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '20px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      background: activeTime === option.key ? APPLE_COLORS.primary : APPLE_COLORS.background,
                      color: activeTime === option.key ? '#fff' : APPLE_COLORS.textSecondary,
                      fontWeight: activeTime === option.key ? 500 : 400,
                      transition: 'all 0.2s'
                    }}
                  >
                    {option.label}
                  </div>
                ))}
              </div>
            </div>

            {/* 错误次数筛选 */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '15px', color: APPLE_COLORS.text, marginBottom: '12px', fontWeight: 500 }}>错误次数</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {ERROR_COUNT_OPTIONS.map(option => (
                  <div
                    key={option.key}
                    onClick={() => setActiveErrorCount(option.key)}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '20px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      background: activeErrorCount === option.key ? APPLE_COLORS.primary : APPLE_COLORS.background,
                      color: activeErrorCount === option.key ? '#fff' : APPLE_COLORS.textSecondary,
                      fontWeight: activeErrorCount === option.key ? 500 : 400,
                      transition: 'all 0.2s'
                    }}
                  >
                    {option.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 底部按钮 */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid ' + APPLE_COLORS.border,
            display: 'flex',
            gap: '12px'
          }}>
            <Button
              fill="outline"
              style={{ 
                flex: 1,
                borderRadius: '10px',
                borderColor: APPLE_COLORS.border,
                color: APPLE_COLORS.text
              }}
              onClick={() => {
                resetFilters()
              }}
            >
              重置
            </Button>
            <Button
              color="primary"
              style={{ 
                flex: 1,
                borderRadius: '10px',
                background: APPLE_COLORS.primary
              }}
              onClick={() => setShowFilterPanel(false)}
            >
              确定
            </Button>
          </div>
        </div>
      </Mask>
    </div>
  )
}
