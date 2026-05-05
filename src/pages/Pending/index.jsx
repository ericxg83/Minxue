import { useEffect, useState } from 'react'
import {
  Button,
  Toast,
  Empty,
  Dialog,
  SpinLoading,
  Checkbox,
  Badge,
  SwipeAction
} from 'antd-mobile'
import { RightOutline } from 'antd-mobile-icons'
import { useStudentStore, useTaskStore, useWrongQuestionStore, usePendingQuestionStore, useUIStore } from '../../store'
import { getTasksByStudent, getQuestionsByTask, addWrongQuestions, getWrongQuestionsByStudent } from '../../services/supabaseService'
import { mockQuestions, mockTasks } from '../../data/mockData'
import { ImageViewer } from 'antd-mobile'
import StudentSwitcher from '../../components/StudentSwitcher'
import QuestionEditDrawer from '../../components/QuestionEditDrawer'

// 使用测试数据
const USE_MOCK_DATA = false

// 现代移动应用颜色
const COLORS = {
  primary: '#2B7DE9',
  primaryLight: '#EBF5FF',
  primaryDark: '#1A3A5C',
  accent: '#4A9EFF',
  success: '#34C759',
  danger: '#FF3B30',
  warning: '#FF9500',
  background: '#F5F8FC',
  card: '#FFFFFF',
  text: '#1A3A5C',
  textSecondary: '#8B9DB5',
  textTertiary: '#A8B8CC',
  border: '#E5ECF5'
}

// 状态筛选标签 - 默认显示疑似错题（方便审核）
const FILTER_TABS = [
  { key: 'wrong', label: '疑似错题', color: COLORS.danger },
  { key: 'all', label: '全部', color: COLORS.primary },
  { key: 'correct', label: '正确', color: COLORS.success }
]

// 状态标签配置
const STATUS_CONFIG = {
  wrong: { text: '疑似错题', color: COLORS.danger, bgColor: '#FFEBEE' },
  correct: { text: '正确', color: COLORS.success, bgColor: '#E8F5E9' }
}

export default function Pending() {
  const { currentStudent } = useStudentStore()
  const { tasks, setTasks } = useTaskStore()
  const { addWrongQuestion, addWrongQuestions: addMultipleToStore } = useWrongQuestionStore()
  const { pendingQuestions, setPendingQuestions } = usePendingQuestionStore()
  const { setLoading, setCurrentPage } = useUIStore()
  
  const [loading, setLocalLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState('wrong')
  const [questions, setQuestions] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [viewingImage, setViewingImage] = useState(null)

  // 从 localStorage 加载已加入错题本的题目ID
  const getAddedToWrongBookIds = () => {
    try {
      const stored = localStorage.getItem(`addedToWrongBook_${currentStudent?.id}`)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  }

  // 保存到 localStorage
  const saveAddedToWrongBookIds = (ids) => {
    try {
      localStorage.setItem(`addedToWrongBook_${currentStudent?.id}`, JSON.stringify([...ids]))
    } catch (error) {
      console.error('保存失败:', error)
    }
  }

  // 组件挂载时，初始化 mock 数据到 store（仅在 pendingQuestions 为空时）
  useEffect(() => {
    if (USE_MOCK_DATA && mockQuestions.length > 0 && pendingQuestions.length === 0) {
      const newMockQuestions = mockQuestions
        .map(q => ({ ...q, status: q.is_correct ? 'correct' : 'wrong' }))
      
      setPendingQuestions(newMockQuestions)
    }
  }, [])

  // 加载任务 and 题目 - 在组件挂载、切换学生和pendingQuestions变化时执行
  useEffect(() => {
    if (currentStudent) {
      loadData()
    }
  }, [currentStudent?.id, pendingQuestions.length])

  const loadData = async () => {
    if (!currentStudent) return

    try {
      if (USE_MOCK_DATA) {
        console.log('当前学生ID:', currentStudent.id)
        console.log('pendingQuestions:', pendingQuestions)
        const studentQuestions = pendingQuestions.filter(q => q.student_id === currentStudent.id)
        console.log('该学生的题目:', studentQuestions)
        
        const addedIds = getAddedToWrongBookIds()
        const filteredQuestions = studentQuestions.filter(q => !addedIds.has(q.id))
        
        const sortedQuestions = filteredQuestions.sort((a, b) => {
          const timeA = new Date(a.created_at || 0).getTime()
          const timeB = new Date(b.created_at || 0).getTime()
          return timeB - timeA
        })
        
        setQuestions(sortedQuestions)
        setSelectedIds([])
        return
      }

      // 使用缓存数据（秒开）
      console.log('从缓存/数据库加载已完成的任务...')
      const taskList = await getTasksByStudent(currentStudent.id, true)
      const safeTaskList = Array.isArray(taskList) ? taskList : []
      console.log('获取到的任务列表:', safeTaskList.length, '条')
      
      const doneTasks = safeTaskList.filter(t => t.status === 'done')
      console.log('已完成的任务:', doneTasks.length, '条')
      setTasks(safeTaskList)
      
      // 使用缓存加载题目
      const allQuestions = []
      for (const task of doneTasks) {
        console.log('加载任务题目, task_id:', task.id)
        try {
          const taskQuestions = await getQuestionsByTask(task.id, true)
          console.log(`任务 ${task.id} 的题目数量:`, Array.isArray(taskQuestions) ? taskQuestions.length : 0)
          const safeQuestions = Array.isArray(taskQuestions) ? taskQuestions : []
          allQuestions.push(...safeQuestions.map(q => ({
            ...q,
            status: q.is_correct ? 'correct' : 'wrong'
          })))
        } catch (taskError) {
          console.error(`获取任务 ${task.id} 的题目失败:`, taskError)
        }
      }
      
      console.log('最终加载的题目总数:', allQuestions.length)
      setQuestions(allQuestions)
      setSelectedIds([])

      // 后台静默刷新最新数据
      const backgroundRefresh = async () => {
        try {
          const freshTaskList = await getTasksByStudent(currentStudent.id, false)
          const safeFreshTaskList = Array.isArray(freshTaskList) ? freshTaskList : []
          const freshDoneTasks = safeFreshTaskList.filter(t => t.status === 'done')
          
          const freshAllQuestions = []
          for (const task of freshDoneTasks) {
            try {
              const taskQuestions = await getQuestionsByTask(task.id, false)
              const safeQuestions = Array.isArray(taskQuestions) ? taskQuestions : []
              freshAllQuestions.push(...safeQuestions.map(q => ({
                ...q,
                status: q.is_correct ? 'correct' : 'wrong'
              })))
            } catch (taskError) {
              console.debug(`刷新任务 ${task.id} 的题目失败:`, taskError)
            }
          }
          
          setTasks(safeFreshTaskList)
          setQuestions(freshAllQuestions)
        } catch (error) {
          console.debug('后台刷新任务数据失败:', error)
        }
      }
      
      backgroundRefresh()
    } catch (error) {
      console.error('加载任务失败:', error)
    }
  }

  // 筛选题目
  const filteredQuestions = questions.filter(q => {
    if (activeFilter === 'all') return true
    return q.status === activeFilter
  })

  // 获取各状态数量
  const getStatusCount = (status) => {
    if (status === 'all') return questions.length
    return questions.filter(q => q.status === status).length
  }

  // 获取疑似错题数量
  const getWrongCount = () => questions.filter(q => q.status === 'wrong').length

  // 切换选择
  const toggleSelection = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  // 清空选择
  const clearSelection = () => {
    setSelectedIds([])
  }

  // 全选当前筛选的题目
  const selectAll = () => {
    setSelectedIds(filteredQuestions.map(q => q.id))
  }

  // 将单个题目加入错题本
  const addSingleToWrongBook = async (question) => {
    try {
      if (USE_MOCK_DATA) {
        // 检查是否已在错题本中
        const addedIds = getAddedToWrongBookIds()
        if (addedIds.has(question.id)) {
          Toast.show({
            icon: 'info',
            content: '该题目已在错题本中'
          })
          return
        }

        const wrongQuestion = {
          id: `wq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          student_id: currentStudent.id,
          question_id: question.id,
          question: question,
          status: 'pending',
          error_count: 1,
          subject: question.subject || '数学',
          category: '其他',
          added_at: new Date().toISOString(),
          last_wrong_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }

        addWrongQuestion(wrongQuestion)
        addedIds.add(question.id)
        saveAddedToWrongBookIds(addedIds)

        setQuestions(questions.filter(q => q.id !== question.id))
        setPendingQuestions(pendingQuestions.filter(q => q.id !== question.id))
      } else {
        // 检查是否已在错题本中
        const existingWrong = await getWrongQuestionsByStudent(currentStudent.id)
        const existingIds = new Set((existingWrong || []).map(w => w.question_id))
        
        if (existingIds.has(question.id)) {
          Toast.show({
            icon: 'info',
            content: '该题目已在错题本中'
          })
          return
        }

        await addWrongQuestions(currentStudent.id, [question.id])
        addWrongQuestion(question)
        setQuestions(questions.filter(q => q.id !== question.id))
      }

      Toast.show({
        icon: 'success',
        content: '已加入错题本'
      })
    } catch (error) {
      console.error('添加失败:', error)
      console.error('错误详情:', error?.message, error?.code, error?.details)
      Toast.show({
        icon: 'fail',
        content: '添加失败: ' + (error?.message || '未知错误')
      })
    }
  }

  // 批量加入错题本
  const handleAddToWrongBook = async () => {
    if (selectedIds.length === 0) {
      Toast.show('请先选择题目')
      return
    }

    // 先检查重复
    setLoading(true)
    try {
      let existingIds = new Set()
      let duplicateCount = 0
      
      if (USE_MOCK_DATA) {
        const addedIds = getAddedToWrongBookIds()
        existingIds = addedIds
      } else {
        const existingWrong = await getWrongQuestionsByStudent(currentStudent.id)
        existingIds = new Set((existingWrong || []).map(w => w.question_id))
      }
      
      const newIds = selectedIds.filter(id => !existingIds.has(id))
      duplicateCount = selectedIds.length - newIds.length
      
      // 如果全部重复，直接提示
      if (newIds.length === 0) {
        setLoading(false)
        Toast.show({
          icon: 'info',
          content: `选中的 ${selectedIds.length} 道题都已在错题本中`
        })
        return
      }
      
      // 有重复的，提示用户
      if (duplicateCount > 0) {
        setLoading(false)
        Dialog.confirm({
          title: '部分题目已存在',
          content: `选中的 ${selectedIds.length} 道题中，${duplicateCount} 道已在错题本中，${newIds.length} 道是新题目。是否只添加新题目？`,
          confirmText: '只添加新题',
          cancelText: '取消',
          onConfirm: async () => {
            await doAddToWrongBook(newIds, newIds.length, duplicateCount)
          }
        })
        return
      }
      
      // 没有重复，直接添加
      setLoading(false)
      Dialog.confirm({
        content: `确定将选中的 ${newIds.length} 道题加入错题本？`,
        onConfirm: async () => {
          await doAddToWrongBook(newIds, newIds.length, 0)
        }
      })
    } catch (error) {
      console.error('检查重复失败:', error)
      setLoading(false)
      Toast.show({
        icon: 'fail',
        content: '检查失败，请重试'
      })
    }
  }

  // 实际执行添加到错题本
  const doAddToWrongBook = async (idsToAdd, newCount, duplicateCount) => {
    setLoading(true)
    
    try {
      if (USE_MOCK_DATA) {
        const selectedQuestions = questions.filter(q => idsToAdd.includes(q.id))

        const wrongQuestions = selectedQuestions.map(q => ({
          id: `wq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          student_id: currentStudent.id,
          question_id: q.id,
          question: q,
          status: 'pending',
          error_count: 1,
          subject: q.subject || '数学',
          category: '其他',
          added_at: new Date().toISOString(),
          last_wrong_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }))

        addMultipleToStore(wrongQuestions)

        const addedIds = getAddedToWrongBookIds()
        idsToAdd.forEach(id => addedIds.add(id))
        saveAddedToWrongBookIds(addedIds)

        const remainingQuestions = questions.filter(q => !idsToAdd.includes(q.id))
        setQuestions(remainingQuestions)

        const remainingPendingQuestions = pendingQuestions.filter(q => !idsToAdd.includes(q.id))
        setPendingQuestions(remainingPendingQuestions)
      } else {
        await addWrongQuestions(currentStudent.id, idsToAdd)
        const selectedQuestions = questions.filter(q => idsToAdd.includes(q.id))
        addMultipleToStore(selectedQuestions)
        setQuestions(questions.filter(q => !idsToAdd.includes(q.id)))
      }

      let msg = `成功添加 ${newCount} 道题到错题本`
      if (duplicateCount > 0) {
        msg += `（${duplicateCount} 道已存在，已跳过）`
      }
      Toast.show({
        icon: 'success',
        content: msg
      })

      setSelectedIds([])
    } catch (error) {
      console.error('添加失败:', error)
      console.error('错误详情:', error?.message, error?.code, error?.details)
      Toast.show({
        icon: 'fail',
        content: '添加失败: ' + (error?.message || '未知错误')
      })
    } finally {
      setLoading(false)
    }
  }

  // 标记为正确（剔除题目）
  const handleMarkAsCorrect = async () => {
    if (selectedIds.length === 0) {
      Toast.show('请先选择题目')
      return
    }

    Dialog.confirm({
      content: `确定将选中的 ${selectedIds.length} 道题标记为正确？`,
      onConfirm: async () => {
        setLoading(true)
        
        try {
          setQuestions(questions.map(q => 
            selectedIds.includes(q.id) 
              ? { ...q, status: 'correct', is_correct: true }
              : q
          ))
          
          Toast.show({
            icon: 'success',
            content: `成功标记 ${selectedIds.length} 道题为正确`
          })
          
          setSelectedIds([])
        } catch (error) {
          console.error('标记失败:', error)
          Toast.show({
            icon: 'fail',
            content: '标记失败'
          })
        } finally {
          setLoading(false)
        }
      }
    })
  }

  // 渲染状态标签
  const renderStatusTag = (status) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending
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

  // 渲染题型标签
  const renderTypeTag = (type) => {
    const typeMap = {
      choice: '选择题',
      fill: '填空题',
      answer: '解答题'
    }
    return (
      <span style={{ color: COLORS.textSecondary, fontSize: '13px' }}>
        {typeMap[type] || '解答题'}
      </span>
    )
  }

  // 获取题目所属任务的原图
  const getTaskImageUrl = (taskId) => {
    let task = tasks.find(t => t.id === taskId)
    if (!task) {
      task = mockTasks.find(t => t.id === taskId)
    }
    return task?.image_url || null
  }

  // 查看原图
  const handleViewImage = (taskId) => {
    if (!taskId) {
      Toast.show({
        icon: 'fail',
        content: '题目未关联作业图片'
      })
      return
    }
    const imageUrl = getTaskImageUrl(taskId)
    if (imageUrl) {
      setViewingImage(imageUrl)
    } else {
      Toast.show({
        icon: 'fail',
        content: '暂无原图'
      })
    }
  }

  // 所有学生疑似错题的总数量
  const getTotalWrongCount = () => {
    return pendingQuestions.filter(q => q.status === 'wrong' || !q.is_correct).length
  }
  
  const totalWrongCount = getTotalWrongCount()

  if (!currentStudent) {
    return (
      <Empty
        description="请先选择学生"
        style={{ padding: '64px 0' }}
      />
    )
  }

  if (loading) {
    return (
      <div style={{ padding: '64px 0', textAlign: 'center' }}>
        <SpinLoading style={{ '--size': '48px' }} />
        <div style={{ marginTop: '16px', color: COLORS.textSecondary }}>加载中...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0', background: COLORS.background, minHeight: '100%', paddingBottom: '80px' }}>
      {/* 顶部标题栏 */}
      <div style={{ 
        background: 'transparent', 
        padding: '12px 16px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, color: '#1A3A5C', letterSpacing: '-0.02em' }}>待确认</h1>
        <Button fill="none" style={{ color: COLORS.textSecondary, fontSize: '14px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            筛选
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/>
            </svg>
          </span>
        </Button>
      </div>

      {/* 学生信息卡片 */}
      <div style={{ 
        background: COLORS.card, 
        padding: '16px',
        margin: '12px 16px',
        borderRadius: '16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4A9EFF 0%, #2B7DE9 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                boxShadow: '0 4px 12px rgba(43, 125, 233, 0.25)'
              }}
            >
              {currentStudent.avatar ? (
                <img src={currentStudent.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
              )}
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#1A3A5C' }}>
                {currentStudent.name}
              </div>
              <div style={{ fontSize: '13px', color: '#8B9DB5', marginTop: '2px', fontWeight: 400 }}>
                {currentStudent.class || '暂无班级'}
              </div>
            </div>
          </div>
          <Button 
            fill="none" 
            style={{ color: '#4A9EFF', fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setShowStudentSwitcher(true)}
          >
            切换
            <Badge 
              content={totalWrongCount > 0 ? (totalWrongCount > 9 ? '9+' : String(totalWrongCount)) : null}
              style={{ 
                '--color': COLORS.danger,
                '--background': '#fff',
                '--border': COLORS.danger,
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

      {/* 统计信息 */}
      <div style={{ background: COLORS.card, padding: '12px 16px', margin: '0 16px 12px', borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.03)' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          color: COLORS.textSecondary,
          fontSize: '14px'
        }}>
          <span>共有 <strong style={{ color: COLORS.primary }}>{questions.length}</strong> 道题待确认，其中 <strong style={{ color: COLORS.danger }}>{getWrongCount()}</strong> 道疑似错题</span>
          <RightOutline color={COLORS.textSecondary} />
        </div>
      </div>

      {/* 筛选标签 */}
      <div style={{ 
        background: COLORS.card, 
        padding: '12px 16px',
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        borderBottom: '1px solid ' + COLORS.border
      }}>
        {FILTER_TABS.map(tab => {
          const count = getStatusCount(tab.key)
          const isActive = activeFilter === tab.key
          return (
            <div
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              style={{
                padding: '8px 14px',
                borderRadius: '20px',
                fontSize: '14px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                background: isActive ? tab.color : COLORS.background,
                color: isActive ? '#fff' : COLORS.textSecondary,
                fontWeight: isActive ? 600 : 400,
                transition: 'all 0.2s',
                boxShadow: isActive ? `0 2px 8px ${tab.color}40` : 'none'
              }}
            >
              {tab.label} {count}
            </div>
          )
        })}
      </div>

      {/* 题目列表 */}
      <div style={{ padding: '12px' }}>
        {filteredQuestions.length === 0 ? (
          <Empty
            description="暂无待确认的题目"
            style={{ padding: '64px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredQuestions.map((question, index) => (
              <SwipeAction
                key={question.id}
                rightActions={[
                  {
                    key: 'addToWrongBook',
                    text: '加入错题本',
                    color: COLORS.primary,
                    onClick: () => {
                      Dialog.confirm({
                        content: '确定将这道题加入错题本？',
                        confirmText: '加入',
                        onConfirm: () => addSingleToWrongBook(question)
                      })
                    }
                  }
                ]}
              >
              <div
                style={{
                  background: COLORS.card,
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}
              >
                {/* 头部：题号、状态、题型、复选框 */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ 
                      fontSize: '16px', 
                      fontWeight: 600, 
                      color: COLORS.text,
                      minWidth: '24px'
                    }}>
                      {index + 1}
                    </span>
                    {renderStatusTag(question.status)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {renderTypeTag(question.question_type)}
                    <Checkbox
                      checked={selectedIds.includes(question.id)}
                      onChange={() => toggleSelection(question.id)}
                    />
                  </div>
                </div>

                {/* 题目内容 */}
                <div style={{ 
                  fontSize: '15px', 
                  color: COLORS.text, 
                  lineHeight: '1.6',
                  marginBottom: question.options?.length > 0 ? '12px' : '0'
                }}>
                  {question.content}
                </div>

                {/* 选项 */}
                {question.options && question.options.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {question.options.map((option, i) => (
                      <div key={i} style={{ fontSize: '14px', color: COLORS.textSecondary }}>
                        {String.fromCharCode(65 + i)}. {option}
                      </div>
                    ))}
                  </div>
                )}

                {/* 查看原图、编辑和删除按钮 */}
                <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <Button
                    size="small"
                    fill="none"
                    style={{ color: COLORS.warning, fontSize: '14px' }}
                    onClick={() => handleViewImage(question.task_id)}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                      </svg>
                      查看原图
                    </span>
                  </Button>
                  <Button
                    size="small"
                    fill="none"
                    style={{ color: COLORS.primary, fontSize: '14px' }}
                    onClick={() => setEditingQuestion(question)}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                      </svg>
                      编辑
                    </span>
                  </Button>
                  <Button
                    size="small"
                    fill="none"
                    style={{ color: COLORS.danger, fontSize: '14px' }}
                    onClick={() => {
                      Dialog.confirm({
                        title: '删除确认',
                        content: '确定要删除这道题目吗？删除后不可恢复。',
                        confirmText: '删除',
                        cancelText: '取消',
                        onConfirm: () => {
                          setQuestions(questions.filter(q => q.id !== question.id))
                          setSelectedIds(selectedIds.filter(id => id !== question.id))
                          Toast.show({ icon: 'success', content: '删除成功' })
                        }
                      })
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                      删除
                    </span>
                  </Button>
                </div>
              </div>
              </SwipeAction>
            ))}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div style={{
        position: 'fixed',
        bottom: '50px',
        left: 0,
        right: 0,
        background: COLORS.card,
        padding: '12px 16px',
        borderTop: '1px solid ' + COLORS.border,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 100
      }}>
        <div style={{ fontSize: '14px', color: COLORS.textSecondary, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>已选择 <strong style={{ color: COLORS.primary }}>{selectedIds.length}</strong> 道</span>
          <Button 
            size="mini"
            fill="none" 
            style={{ color: COLORS.primary, fontSize: '13px', padding: '0 4px' }}
            onClick={() => {
              const allFilteredIds = filteredQuestions.map(q => q.id)
              const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.includes(id))
              if (allSelected) {
                clearSelection()
              } else {
                selectAll()
              }
            }}
          >
            {filteredQuestions.length > 0 && filteredQuestions.every(q => selectedIds.includes(q.id)) ? '取消全选' : '全选'}
          </Button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button 
            fill="none" 
            style={{ color: COLORS.textSecondary }}
            onClick={clearSelection}
            disabled={selectedIds.length === 0}
          >
            清空
          </Button>
          <Button 
            fill="outline"
            style={{ borderColor: COLORS.success, color: COLORS.success }}
            disabled={selectedIds.length === 0}
            onClick={handleMarkAsCorrect}
          >
            标记正确
          </Button>
          <Button 
            color="primary" 
            disabled={selectedIds.length === 0}
            onClick={handleAddToWrongBook}
            style={{ 
              background: COLORS.primary,
              borderRadius: '10px'
            }}
          >
            加入错题本({selectedIds.length})
          </Button>
        </div>
      </div>

      {/* 题目编辑抽屉 */}
      <QuestionEditDrawer
        questionId={editingQuestion?.id}
        visible={!!editingQuestion}
        onClose={() => setEditingQuestion(null)}
        onSave={(updatedQuestion) => {
          setQuestions(questions.map(q =>
            q.id === updatedQuestion.id ? updatedQuestion : q
          ))
          setEditingQuestion(null)
        }}
      />

      {/* 学生切换弹窗 */}
      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        badgeType="pending"
      />

      {/* 原图查看 */}
      <ImageViewer
        image={viewingImage}
        visible={!!viewingImage}
        onClose={() => setViewingImage(null)}
      />
    </div>
  )
}
