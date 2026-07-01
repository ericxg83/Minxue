import { useEffect, useState, useRef } from 'react'
import {
  Button,
  Toast,
  Empty,
  Dialog,
  SpinLoading,
  Checkbox,
  Badge,
  Popup,
  Space
} from 'antd-mobile'
import { RightOutline, DownOutline } from 'antd-mobile-icons'
import { useStudentStore, useWrongQuestionStore, useUIStore } from '../../store'
import { getWrongQuestionsByStudent, deleteWrongQuestion, updateWrongQuestionStatus, createGeneratedExam } from '../../services/apiService'
import { generateQRCodeContent } from '../../services/aiService'
import { saveAs } from 'file-saver'
import { generateExamPDF } from '../../utils/pdfGenerator'
import { mockWrongQuestions, mockStudents } from '../../data/mockData'
import StudentSwitcher from '../../components/StudentSwitcher'
import PrintPreview from '../PrintPreview'
import ScanQR from '../ScanQR'
import Grading from '../Grading'
import dayjs from 'dayjs'

// 使用真实 API 数据
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

// 掌握状态筛选标签（基于 lifecycle_status）
const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '不懂' },
  { key: 'review', label: '略懂' },
  { key: 'mastered', label: '完全懂' }
]

// 错题分类筛选
const QUESTION_TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'wrong', label: '错题' },
  { key: 'unanswered', label: '未作答' }
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

// 掌握情况筛选选项
const MASTERY_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'new', label: '不懂' },
  { key: 'review', label: '略懂' },
  { key: 'mastered', label: '完全懂' }
]

// 分类筛选选项（用于高级筛选栏的下拉）
const CATEGORY_OPTIONS = [
  { key: 'all', label: '全部分类' },
  { key: 'wrong', label: '错题' },
  { key: 'unanswered', label: '未作答' }
]

export default function WrongBook({ onScanQR }) {
  const { currentStudent } = useStudentStore()
  const { 
    wrongQuestions, 
    setWrongQuestions, 
    selectedQuestions, 
    toggleSelection: storeToggleSelection,
    clearSelection: storeClearSelection
  } = useWrongQuestionStore()
  
  const [activeStatus, setActiveStatus] = useState('pending')
  const [activeQuestionType, setActiveQuestionType] = useState('all')
  const [activeSubject, setActiveSubject] = useState('all')
  const [activeTime, setActiveTime] = useState('all')
  const [activeErrorCount, setActiveErrorCount] = useState('all')
  const [activeMastery, setActiveMastery] = useState('all')
  const [activeTag, setActiveTag] = useState('all')
  const [activeCategory, setActiveCategory] = useState('all') // 分类筛选：错题/未作答/全部
  const [sortBy, setSortBy] = useState('time_desc')
  const [activeFilterType, setActiveFilterType] = useState('') // 'subject', 'time', 'errorCount', 'tag', 'sort', 'category'
  const [showInlineCategoryDropdown, setShowInlineCategoryDropdown] = useState(false) // 分类原地下拉菜单
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [showScanQR, setShowScanQR] = useState(false)
  const [showGrading, setShowGrading] = useState(false)
  const [gradingData, setGradingData] = useState(null)

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
  const filteredQuestions = (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => {
    // 首先过滤当前学生的错题
    if (wq.student_id !== currentStudent?.id) return false
    
    // 分类筛选（全部/错题/未作答）— 第219-233行
    if (activeCategory !== 'all') {
      const question = wq.question || wq
      const answerSource = question.answer_source || question._answer_source || 'recognized'
      const isBlank = answerSource === 'blank'
      const isCorrect = question.is_correct !== undefined ? question.is_correct : wq.is_correct
      
      // 复审页面判定逻辑：
      // 未作答: answer_source === 'blank' && is_correct === null
      // 错题: is_correct === false
      const isUnanswered = isBlank && isCorrect === null
      const isWrong = isCorrect === false
      
      if (activeCategory === 'wrong' && !isWrong) return false
      if (activeCategory === 'unanswered' && !isUnanswered) return false
    }
    
    // 掌握状态筛选（顶部标签和高级筛选共享此逻辑）
    if (activeStatus !== 'all') {
      const ls = wq.lifecycle_status || ''
      if (activeStatus === 'new' && ls !== 'new') return false
      if (activeStatus === 'review' && ls !== 'review_1' && ls !== 'review_2') return false
      if (activeStatus === 'mastered' && ls !== 'mastered') return false
    }

    // 科目筛选
    if (activeSubject !== 'all' && wq.subject !== activeSubject) return false
    
    // 时间筛选
    if (activeTime !== 'all' && !isWithinTimeRange(wq.added_at || wq.created_at, activeTime)) return false
    
    // 错误次数筛选
    if (activeErrorCount !== 'all' && !matchErrorCount(wq.error_count || 1, activeErrorCount)) return false

    // 掌握情况筛选（按 lifecycle_status）
    if (activeMastery !== 'all') {
      const ls = wq.lifecycle_status || ''
      if (activeMastery === 'new' && ls !== 'new') return false
      if (activeMastery === 'review' && ls !== 'review_1' && ls !== 'review_2') return false
      if (activeMastery === 'mastered' && ls !== 'mastered') return false
    }

    if (activeTag !== 'all') {
      const question = wq.question || wq
      const tags = question.tags_source === 'manual'
        ? (question.manual_tags || [])
        : (question.ai_tags || [])
      if (!tags.includes(activeTag)) return false
    }
    
    return true
  })

  // 排序逻辑
  const sortedQuestions = [...filteredQuestions].sort((a, b) => {
    switch (sortBy) {
      case 'time_desc':
        return new Date(b.added_at || b.created_at) - new Date(a.added_at || a.created_at)
      case 'time_asc':
        return new Date(a.added_at || a.created_at) - new Date(b.added_at || b.created_at)
      case 'error_asc':
        return (a.error_count || 1) - (b.error_count || 1)
      case 'error_desc':
        return (b.error_count || 1) - (a.error_count || 1)
      case 'subject':
        return (a.subject || '').localeCompare(b.subject || '', 'zh')
      default:
        return 0
    }
  })

  // 获取各状态数量（只统计当前学生的错题，按 lifecycle_status）
  const getStatusCount = (key) => {
    const studentQuestions = (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id)
    if (key === 'all') return studentQuestions.length
    if (key === 'new') return studentQuestions.filter(wq => (wq.lifecycle_status || 'new') === 'new').length
    if (key === 'review') return studentQuestions.filter(wq => wq.lifecycle_status === 'review_1' || wq.lifecycle_status === 'review_2').length
    if (key === 'mastered') return studentQuestions.filter(wq => wq.lifecycle_status === 'mastered').length
    return 0
  }

  // 获取当前筛选条件的显示文本
  const getFilterLabel = () => {
    const parts = []
    if (activeCategory !== 'all') {
      parts.push(CATEGORY_OPTIONS.find(o => o.key === activeCategory)?.label)
    }
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
  const hasActiveFilters = activeCategory !== 'all' || activeSubject !== 'all' || activeTime !== 'all' || activeErrorCount !== 'all' || activeTag !== 'all' || activeMastery !== 'all'

  const resetFilters = () => {
    setActiveQuestionType('all')
    setActiveSubject('all')
    setActiveTime('all')
    setActiveErrorCount('all')
    setActiveTag('all')
    setActiveCategory('all')
    setActiveMastery('all')
    setSortBy('time_desc')
  }

  const getAllTags = () => {
    const tagSet = new Set()
    wrongQuestions
      .filter(wq => wq.student_id === currentStudent?.id)
      .forEach(wq => {
        const question = wq.question || wq
        const tags = question.tags_source === 'manual'
          ? (question.manual_tags || [])
          : (question.ai_tags || [])
        tags.forEach(tag => tagSet.add(tag))
      })
    return Array.from(tagSet).sort()
  }

  const allTags = getAllTags()

  // 判定题目类型（基于复审页面逻辑）
  const getQuestionType = (wq) => {
    const question = wq.question || wq
    const answerSource = question.answer_source || question._answer_source || 'recognized'
    const isBlank = answerSource === 'blank'
    const isCorrect = question.is_correct !== undefined ? question.is_correct : wq.is_correct
    
    if (isBlank && isCorrect === null) return 'unanswered'
    if (isCorrect === false) return 'wrong'
    return 'other'
  }

  // 获取各类型数量
  const getQuestionTypeCount = (type) => {
    const studentQuestions = (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id)
    if (type === 'all') return studentQuestions.length
    return studentQuestions.filter(wq => getQuestionType(wq) === type).length
  }

  // 获取统计数据（只统计当前学生的错题，按 lifecycle_status）
  const getStats = () => {
    const studentQuestions = (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id)
    const total = studentQuestions.length
    const mastered = studentQuestions.filter(wq => wq.lifecycle_status === 'mastered').length
    const review = studentQuestions.filter(wq => wq.lifecycle_status === 'review_1' || wq.lifecycle_status === 'review_2').length
    const notMastered = studentQuestions.filter(wq => (wq.lifecycle_status || 'new') === 'new').length
    return { total, mastered, review, notMastered }
  }

  // 切换选择
  const toggleSelection = (wq) => {
    storeToggleSelection(wq)
  }

  // 清空选择
  const handleClearSelection = () => {
    storeClearSelection()
  }

  // 全选/取消全选当前筛选的题目
  const handleSelectAll = () => {
    if (selectedQuestions.length === sortedQuestions.length && sortedQuestions.length > 0) {
      storeClearSelection()
    } else {
      // 全选所有筛选后的题目
      sortedQuestions.forEach(wq => {
        if (!selectedQuestions.find(sq => sq.id === wq.id)) {
          storeToggleSelection(wq)
        }
      })
    }
  }

  // 删除错题
  const handleDelete = async (id) => {
    Dialog.confirm({
      content: '确定从错题本中移除这道题？',
      confirmText: '移除',
      onConfirm: async () => {
        try {
          if (USE_MOCK_DATA) {
            setWrongQuestions(prev => prev.filter(wq => wq.id !== id))
          } else {
            await deleteWrongQuestion(id)
            loadData()
          }
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

  // 切换掌握等级（不懂 → 略懂 → 完全懂 → 不懂）
  const handleToggleMastery = async (wq) => {
    const currentLs = wq.lifecycle_status || 'new'
    let nextLs
    switch (currentLs) {
      case 'new':
        nextLs = 'review_1'
        break
      case 'review_1':
        nextLs = 'review_2'
        break
      case 'review_2':
        nextLs = 'mastered'
        break
      case 'mastered':
        nextLs = 'new'
        break
      default:
        nextLs = 'new'
    }
    const nextStatus = nextLs === 'mastered' ? 'mastered' : 'pending'

    try {
      await updateWrongQuestionStatus(wq.id, nextStatus, { lifecycle_status: nextLs })
      loadData()
      const statusText = { new: '不懂', review_1: '略懂', review_2: '略懂', mastered: '完全懂' }
      Toast.show({
        icon: 'success',
        content: `已标记为${statusText[nextLs]}`
      })
    } catch (error) {
      Toast.show({
        icon: 'fail',
        content: '操作失败'
      })
    }
  }

  // 扫码批改回调
  const handleScanSuccess = (scanData) => {
    setShowScanQR(false)
    setGradingData(scanData)
    setShowGrading(true)
  }

  // 批改完成回调
  const handleGradingComplete = (result) => {
    setShowGrading(false)
    setGradingData(null)
    
    Toast.show({
      icon: 'success',
      content: `批改完成！已掌握 ${result.masteredCount} 题，未掌握 ${result.notMasteredCount} 题`
    })
    
    loadData()
  }

  // 生成试卷
  const handleGenerateExam = async () => {
    if (selectedQuestions.length === 0) {
      Toast.show('请先选择要组卷的错题')
      return
    }

    try {
      // 提取选中的题目ID
      const questionIds = selectedQuestions.map(wq => wq.question_id || wq.id)
      
      // 创建试卷名称（例如："错题组卷 - 2023年12月1日"）
      const examName = `错题组卷 - ${dayjs().format('YYYY年MM月DD日')}`
      
      // 调用后端API创建试卷
      const examData = {
        student_id: currentStudent.id,
        name: examName,
        question_ids: questionIds
      }
      
      const result = await createGeneratedExam(examData)

      Toast.show({
        icon: 'success',
        content: '试卷生成成功，即将开始下载...'
      })

      // 落库成功后自动生成 PDF
      const questions = selectedQuestions.map(wq => wq.question || wq)
      const newPaperId = 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
      const qrContent = JSON.stringify({
        type: 'grading',
        paperId: newPaperId,
        studentId: currentStudent?.id,
        questionIds: questions.map(q => q.id).filter(Boolean),
        ts: Date.now()
      })
      const filename = `${currentStudent?.name || 'student'}_错题组卷_${dayjs().format('YYYYMMDD_HHmm')}`
      try {
        const result = await generateExamPDF({
          title: `${currentStudent?.name || '学生'} - 错题练习`,
          studentName: currentStudent?.name || '',
          questions: questions,
          filename: filename,
          showAnswers: false,
          qrContent: qrContent,
        })
        if (result && result.pdfBlob) {
          saveAs(result.pdfBlob, `${filename}.pdf`)
        }
      } catch (pdfErr) {
        console.warn('PDF生成失败:', pdfErr)
      }

      // 清空选择
      storeClearSelection()
    } catch (error) {
      console.error('生成试卷失败:', error)
      Toast.show({
        icon: 'fail',
        content: '生成试卷失败: ' + (error.message || '未知错误')
      })
    }
  }

  const generatePaperId = () => {
    return 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
  }

  const handlePrint = async () => {
    if (selectedQuestions.length === 0) {
      Toast.show('请先选择要打印的题目')
      return
    }

    const questions = selectedQuestions.map(wq => wq.question || wq)
    const newPaperId = 'paper_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    const qrContent = JSON.stringify({
      type: 'grading',
      paperId: newPaperId,
      studentId: currentStudent?.id,
      questionIds: selectedQuestions.map(wq => (wq.question || wq).id),
      ts: Date.now()
    })

    // 先保存组卷记录
    try {
      await createGeneratedExam({
        student_id: currentStudent.id,
        name: `错题组卷 - ${dayjs().format('YYYY年MM月DD日')}`,
        question_ids: selectedQuestions.map(wq => wq.question_id || wq.id)
      })
    } catch (e) {
      console.warn('创建组卷记录失败:', e)
    }

    try {
      const filename = `${currentStudent?.name || 'student'}_错题练习_${dayjs().format('YYYYMMDD_HHmm')}`
      const result = await generateExamPDF({
        title: `${currentStudent?.name || '学生'} - 错题练习`,
        studentName: currentStudent?.name || '',
        questions: questions,
        filename: filename,
        showAnswers: false,
        qrContent: qrContent,
      })
      if (result && result.pdfBlob) {
        saveAs(result.pdfBlob, `${filename}.pdf`)
      }
      Toast.show({ icon: 'success', content: 'PDF已生成，包含二维码' })
    } catch (error) {
      console.error('PDF生成失败:', error)
      Toast.show({ icon: 'fail', content: 'PDF生成失败' })
    }
  }

// 渲染掌握状态标签 - 基于 lifecycle_status
const renderMasteredTag = (wq) => {
  // 优先使用 lifecycle_status（新系统），回退到 status（旧系统）
  const lifecycle = wq.lifecycle_status || ''
  const status = wq.status || ''

  let label, color, bg
  if (lifecycle === 'mastered' || status === 'mastered') {
    label = '完全懂'
    color = APPLE_COLORS.success
    bg = '#E8F5E9'
  } else if (lifecycle === 'review_2') {
    label = '略懂'
    color = '#52C41A'
    bg = '#F0FAEB'
  } else if (lifecycle === 'review_1') {
    label = '略懂'
    color = APPLE_COLORS.warning
    bg = '#FFF8E1'
  } else if (lifecycle === 'new' || status === 'pending') {
    label = '不懂'
    color = APPLE_COLORS.danger
    bg = '#FFEBEE'
  } else {
    label = '不懂'
    color = APPLE_COLORS.danger
    bg = '#FFEBEE'
  }

  return (
    <span style={{
      color,
      fontSize: '12px',
      padding: '4px 10px',
      borderRadius: '12px',
      background: bg,
      fontWeight: 500,
      display: 'inline-block'
    }}>
      {label}
    </span>
  )
}

  const stats = getStats()

  // 计算所有学生未掌握题的总数（用于顶部按钮提醒）
  const getTotalPendingCount = () => {
    return (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => {
      const ls = wq.lifecycle_status || ''
      return ls !== 'mastered' && ls !== 'excluded'
    }).length
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
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>错题总数</div>
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
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>完全懂</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: APPLE_COLORS.success }}>{stats.mastered}道</div>
          </div>
          <div style={{
            flex: 1,
            background: '#FFF8E1',
            padding: '14px',
            borderRadius: '12px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>略懂</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: APPLE_COLORS.warning }}>{stats.review}道</div>
          </div>
          <div style={{
            flex: 1,
            background: '#FFEBEE',
            padding: '14px',
            borderRadius: '12px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginBottom: '4px' }}>不懂</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: APPLE_COLORS.danger }}>{stats.notMastered}道</div>
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
          const tabColor = tab.key === 'mastered' ? APPLE_COLORS.success : tab.key === 'review' ? APPLE_COLORS.warning : tab.key === 'new' ? APPLE_COLORS.danger : APPLE_COLORS.primary
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

      {/* 错题分类标签 - 苹果风格 */}
      <div style={{ 
        background: APPLE_COLORS.card, 
        padding: '8px 16px',
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        borderBottom: '1px solid ' + APPLE_COLORS.border
      }}>
        {QUESTION_TYPE_TABS.map(tab => {
          const isActive = activeQuestionType === tab.key
          const tabColor = tab.key === 'wrong' ? APPLE_COLORS.danger : tab.key === 'unanswered' ? APPLE_COLORS.warning : APPLE_COLORS.primary
          return (
            <div
              key={tab.key}
              onClick={() => setActiveQuestionType(tab.key)}
              style={{
                padding: '6px 12px',
                borderRadius: '16px',
                fontSize: '13px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                background: isActive ? tabColor : APPLE_COLORS.background,
                color: isActive ? '#fff' : APPLE_COLORS.textSecondary,
                fontWeight: isActive ? 500 : 400,
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
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
        <div style={{ display: 'flex', gap: '16px', flex: 1 }}>
          {/* 科目筛选 */}
          <div 
            onClick={() => { setActiveFilterType('subject'); setShowFilterPanel(true) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              color: activeSubject !== 'all' ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
              fontWeight: activeSubject !== 'all' ? 500 : 400
            }}
          >
            <span style={{ fontSize: '14px' }}>科目</span>
            <DownOutline style={{ fontSize: '12px', pointerEvents: 'none' }} />
            {activeSubject !== 'all' && (
              <span style={{ fontSize: '12px', color: APPLE_COLORS.primary }}>
                {SUBJECT_OPTIONS.find(o => o.key === activeSubject)?.label}
              </span>
            )}
          </div>

          {/* 时间筛选 */}
          <div 
            onClick={() => { setActiveFilterType('time'); setShowFilterPanel(true) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              color: activeTime !== 'all' ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
              fontWeight: activeTime !== 'all' ? 500 : 400
            }}
          >
            <span style={{ fontSize: '14px' }}>时间</span>
            <DownOutline style={{ fontSize: '12px', pointerEvents: 'none' }} />
            {activeTime !== 'all' && (
              <span style={{ fontSize: '12px', color: APPLE_COLORS.primary }}>
                {TIME_OPTIONS.find(o => o.key === activeTime)?.label}
              </span>
            )}
          </div>

          {/* 错次筛选 */}
          <div 
            onClick={() => { setActiveFilterType('errorCount'); setShowFilterPanel(true) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              color: activeErrorCount !== 'all' ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
              fontWeight: activeErrorCount !== 'all' ? 500 : 400
            }}
          >
            <span style={{ fontSize: '14px' }}>错次</span>
            <DownOutline style={{ fontSize: '12px', pointerEvents: 'none' }} />
            {activeErrorCount !== 'all' && (
              <span style={{ fontSize: '12px', color: APPLE_COLORS.primary }}>
                {ERROR_COUNT_OPTIONS.find(o => o.key === activeErrorCount)?.label}
              </span>
            )}
          </div>

          {/* 标签筛选 */}
          {allTags.length > 0 && (
            <div 
              onClick={() => { setActiveFilterType('tag'); setShowFilterPanel(true) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
                color: activeTag !== 'all' ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
                fontWeight: activeTag !== 'all' ? 500 : 400
              }}
            >
              <span style={{ fontSize: '14px' }}>标签</span>
              <DownOutline style={{ fontSize: '12px', pointerEvents: 'none' }} />
              {activeTag !== 'all' && (
                <span style={{ fontSize: '12px', color: APPLE_COLORS.primary }}>
                  {activeTag}
                </span>
              )}
            </div>
          )}

          {/* 分类筛选（错题/未作答） */}
          <div
            onClick={() => { setActiveFilterType('category'); setShowFilterPanel(true) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              color: activeCategory !== 'all' ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
              fontWeight: activeCategory !== 'all' ? 500 : 400
            }}
          >
            <span style={{ fontSize: '14px' }}>分类</span>
            <DownOutline style={{ fontSize: '12px', pointerEvents: 'none' }} />
            {activeCategory !== 'all' && (
              <span style={{ fontSize: '12px', color: APPLE_COLORS.primary }}>
                {CATEGORY_OPTIONS.find(o => o.key === activeCategory)?.label}
              </span>
            )}
          </div>

          {/* 掌握情况筛选 */}
          <div
            onClick={() => { setActiveFilterType('mastery'); setShowFilterPanel(true) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              color: activeMastery !== 'all' ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
              fontWeight: activeMastery !== 'all' ? 500 : 400
            }}
          >
            <span style={{ fontSize: '14px' }}>掌握</span>
            <DownOutline style={{ fontSize: '12px', pointerEvents: 'none' }} />
            {activeMastery !== 'all' && (
              <span style={{ fontSize: '12px', color: APPLE_COLORS.primary }}>
                {MASTERY_OPTIONS.find(o => o.key === activeMastery)?.label}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 排序按钮 */}
          <div 
            onClick={() => { setActiveFilterType('sort'); setShowFilterPanel(true) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
              color: APPLE_COLORS.textSecondary,
              fontSize: '14px'
            }}
          >
            <span>排序</span>
            <DownOutline style={{ fontSize: '12px', pointerEvents: 'none' }} />
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
          <div 
            onClick={handleSelectAll}
            style={{
              fontSize: '14px',
              color: selectedQuestions.length === sortedQuestions.length && sortedQuestions.length > 0 ? APPLE_COLORS.primary : APPLE_COLORS.textSecondary,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            {selectedQuestions.length === sortedQuestions.length && sortedQuestions.length > 0 ? '取消全选' : '全选'}
          </div>
        </div>
      </div>

      {/* 错题列表 - 苹果风格 */}
      <div style={{ padding: '12px' }}>
        {sortedQuestions.length === 0 ? (
          <Empty
            description="错题本为空"
            style={{ padding: '64px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {sortedQuestions.map((wq) => {
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
                      <span onClick={() => handleToggleMastery(wq)} style={{ cursor: 'pointer' }} title="点击切换掌握等级">
                        {renderMasteredTag(wq)}
                      </span>
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

                  {/* 原试卷已删除提示 */}
                  {(!question.task_id || wq.task_deleted) && (
                    <div style={{
                      fontSize: '12px',
                      color: '#FF9500',
                      background: '#FFF8E1',
                      padding: '6px 10px',
                      borderRadius: '8px',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor">
                        <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm-32 240c0-4.4 3.6-8 8-8h48c4.4 0 8 3.6 8 8v240c0 4.4-3.6 8-8 8h-48c-4.4 0-8-3.6-8-8V304zm32 416c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32z"/>
                      </svg>
                      原试卷已删除，但错题保留
                    </div>
                  )}

                  {/* 知识点标签 */}
                  {(() => {
                    const tags = question.tags_source === 'manual'
                      ? (question.manual_tags || [])
                      : (question.ai_tags || [])
                    if (tags.length === 0) return null
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                        {tags.map((tag, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              background: question.tags_source === 'manual' ? '#FFF7E6' : '#E8F4FD',
                              color: question.tags_source === 'manual' ? '#FA8C16' : APPLE_COLORS.primary,
                              fontWeight: 400
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )
                  })()}

                  {/* 错误次数 */}
                  <div style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>错误次数：{question.wrong_count || 1}次</span>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <span
                        onClick={(e) => { e.stopPropagation(); handleDelete(wq.id) }}
                        style={{
                          color: APPLE_COLORS.danger,
                          fontSize: '13px',
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        删除
                      </span>
                    </div>
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
            onClick={() => setShowScanQR(true)}
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button 
            color="primary" 
            fill="outline"
            disabled={selectedQuestions.length === 0}
            onClick={handleGenerateExam}
            style={{ 
              minWidth: '80px',
              borderColor: APPLE_COLORS.primary,
              color: APPLE_COLORS.primary,
              borderRadius: '10px'
            }}
          >
            生成试卷
          </Button>
          <Button
            color="primary"
            disabled={selectedQuestions.length === 0}
            onClick={() => setShowPrintPreview(true)}
            style={{
              minWidth: '80px',
              background: APPLE_COLORS.primary,
              borderRadius: '10px'
            }}
          >
            打印
          </Button>
        </div>
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

      {/* 扫码批改弹窗 */}
      {showScanQR && (
        <ScanQR
          onClose={() => setShowScanQR(false)}
          onScanSuccess={handleScanSuccess}
        />
      )}

      {/* 批改页面 */}
      {showGrading && gradingData && (
        <Grading
          paperId={gradingData.paperId}
          studentId={gradingData.studentId}
          questionIds={gradingData.questionIds}
          onClose={() => {
            setShowGrading(false)
            setGradingData(null)
          }}
          onComplete={handleGradingComplete}
        />
      )}

      {/* 筛选面板弹窗 - 苹果风格 */}
      <Popup
        visible={showFilterPanel}
        onMaskClick={() => setShowFilterPanel(false)}
        position="bottom"
        bodyStyle={{
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          maxHeight: '80vh',
          overflow: 'auto',
          background: APPLE_COLORS.card
        }}
      >
        <div>
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
            {/* 分类筛选（错题/未作答） */}
            {activeFilterType === '' || activeFilterType === 'category' ? (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '15px', color: APPLE_COLORS.text, marginBottom: '12px', fontWeight: 500 }}>分类</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {CATEGORY_OPTIONS.map(option => {
                    const tabColor = option.key === 'wrong' ? APPLE_COLORS.danger : option.key === 'unanswered' ? APPLE_COLORS.warning : APPLE_COLORS.primary
                    return (
                      <div
                        key={option.key}
                        onClick={() => setActiveCategory(option.key)}
                        style={{
                          padding: '10px 18px',
                          borderRadius: '20px',
                          fontSize: '14px',
                          cursor: 'pointer',
                          background: activeCategory === option.key ? tabColor : APPLE_COLORS.background,
                          color: activeCategory === option.key ? '#fff' : APPLE_COLORS.textSecondary,
                          fontWeight: activeCategory === option.key ? 500 : 400,
                          transition: 'all 0.2s'
                        }}
                      >
                        {option.label}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {/* 掌握情况筛选 */}
            {(activeFilterType === '' || activeFilterType === 'mastery') ? (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '15px', color: APPLE_COLORS.text, marginBottom: '12px', fontWeight: 500 }}>掌握情况</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {MASTERY_OPTIONS.map(option => {
                    const tabColor = option.key === 'mastered' ? APPLE_COLORS.success : option.key === 'review' ? APPLE_COLORS.warning : option.key === 'new' ? APPLE_COLORS.danger : APPLE_COLORS.primary
                    return (
                      <div
                        key={option.key}
                        onClick={() => setActiveMastery(option.key)}
                        style={{
                          padding: '10px 18px',
                          borderRadius: '20px',
                          fontSize: '14px',
                          cursor: 'pointer',
                          background: activeMastery === option.key ? tabColor : APPLE_COLORS.background,
                          color: activeMastery === option.key ? '#fff' : APPLE_COLORS.textSecondary,
                          fontWeight: activeMastery === option.key ? 500 : 400,
                          transition: 'all 0.2s'
                        }}
                      >
                        {option.label}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {/* 科目筛选 */}
            {(activeFilterType === '' || activeFilterType === 'subject') ? (
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
            ) : null}

            {/* 时间筛选 */}
            {(activeFilterType === '' || activeFilterType === 'time') ? (
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
            ) : null}

            {/* 错误次数筛选 */}
            {(activeFilterType === '' || activeFilterType === 'errorCount') ? (
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
            ) : null}

            {/* 知识点标签筛选 */}
            {(activeFilterType === '' || activeFilterType === 'tag') && allTags.length > 0 ? (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '15px', color: APPLE_COLORS.text, marginBottom: '12px', fontWeight: 500 }}>知识点标签</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  <div
                    onClick={() => setActiveTag('all')}
                    style={{
                      padding: '10px 18px',
                      borderRadius: '20px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      background: activeTag === 'all' ? APPLE_COLORS.primary : APPLE_COLORS.background,
                      color: activeTag === 'all' ? '#fff' : APPLE_COLORS.textSecondary,
                      fontWeight: activeTag === 'all' ? 500 : 400,
                      transition: 'all 0.2s'
                    }}
                  >
                    全部标签
                  </div>
                  {allTags.map(tag => (
                    <div
                      key={tag}
                      onClick={() => setActiveTag(tag)}
                      style={{
                        padding: '10px 18px',
                        borderRadius: '20px',
                        fontSize: '14px',
                        cursor: 'pointer',
                        background: activeTag === tag ? '#FA8C16' : APPLE_COLORS.background,
                        color: activeTag === tag ? '#fff' : APPLE_COLORS.textSecondary,
                        fontWeight: activeTag === tag ? 500 : 400,
                        transition: 'all 0.2s'
                      }}
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 排序方式 */}
            {activeFilterType === '' || activeFilterType === 'sort' ? (
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '15px', color: APPLE_COLORS.text, marginBottom: '12px', fontWeight: 500 }}>排序方式</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[
                    { key: 'time_desc', label: '最新加入' },
                    { key: 'time_asc', label: '最早加入' },
                    { key: 'error_desc', label: '错次最多' },
                    { key: 'error_asc', label: '错次最少' },
                    { key: 'subject', label: '按科目' }
                  ].map(option => (
                    <div
                      key={option.key}
                      onClick={() => setSortBy(option.key)}
                      style={{
                        padding: '10px 18px',
                        borderRadius: '20px',
                        fontSize: '14px',
                        cursor: 'pointer',
                        background: sortBy === option.key ? APPLE_COLORS.primary : APPLE_COLORS.background,
                        color: sortBy === option.key ? '#fff' : APPLE_COLORS.textSecondary,
                        fontWeight: sortBy === option.key ? 500 : 400,
                        transition: 'all 0.2s'
                      }}
                    >
                      {option.label}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
      </Popup>
    </div>
  )
}
