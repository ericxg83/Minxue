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
import { getTasksByStudent, getQuestionsByTask, addWrongQuestions } from '../../services/supabaseService'
import { mockQuestions, mockTasks } from '../../data/mockData'
import { ImageViewer } from 'antd-mobile'
import StudentSwitcher from '../../components/StudentSwitcher'
import QuestionEditDrawer from '../../components/QuestionEditDrawer'

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

// 状态筛选标签 - 默认显示疑似错题（方便审核）
const FILTER_TABS = [
  { key: 'wrong', label: '疑似错题', color: APPLE_COLORS.danger },
  { key: 'all', label: '全部', color: APPLE_COLORS.primary },
  { key: 'correct', label: '正确', color: APPLE_COLORS.success }
]

// 状态标签配置
const STATUS_CONFIG = {
  wrong: { text: '疑似错题', color: APPLE_COLORS.danger, bgColor: '#FFEBEE' },
  correct: { text: '正确', color: APPLE_COLORS.success, bgColor: '#E8F5E9' }
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
      // 只在 pendingQuestions 为空时初始化 mock 数据
      const newMockQuestions = mockQuestions
        .map(q => ({ ...q, status: q.is_correct ? 'correct' : 'wrong' }))
      
      setPendingQuestions(newMockQuestions)
    }
  }, []) // 只在组件挂载时执行一次

  // 加载任务和题目 - 在组件挂载、切换学生和pendingQuestions变化时执行
  useEffect(() => {
    if (currentStudent) {
      loadData()
    }
  }, [currentStudent?.id, pendingQuestions.length])

  const loadData = async () => {
    if (!currentStudent) return

    setLocalLoading(true)
    setLoading(true)

    try {
      if (USE_MOCK_DATA) {
        // 从 store 中获取该学生的待确认题目
        console.log('当前学生ID:', currentStudent.id)
        console.log('pendingQuestions:', pendingQuestions)
        const studentQuestions = pendingQuestions.filter(q => q.student_id === currentStudent.id)
        console.log('该学生的题目:', studentQuestions)
        
        // 过滤掉已加入错题本的题目
        const addedIds = getAddedToWrongBookIds()
        const filteredQuestions = studentQuestions.filter(q => !addedIds.has(q.id))
        
        // 按创建时间排序（最新的在前）
        const sortedQuestions = filteredQuestions.sort((a, b) => {
          const timeA = new Date(a.created_at || 0).getTime()
          const timeB = new Date(b.created_at || 0).getTime()
          return timeB - timeA // 降序排列，最新的在前
        })
        
        setQuestions(sortedQuestions)
        setSelectedIds([])
        setLocalLoading(false)
        setLoading(false)
        return
      }

      // 获取所有已完成的任务
      const taskList = await getTasksByStudent(currentStudent.id)
      const doneTasks = taskList.filter(t => t.status === 'done')
      setTasks(taskList)
      
      // 获取所有题目
      const allQuestions = []
      for (const task of doneTasks) {
        const taskQuestions = await getQuestionsByTask(task.id)
        allQuestions.push(...taskQuestions.map(q => ({
          ...q,
          status: q.is_correct ? 'correct' : 'wrong'
        })))
      }
      
      setQuestions(allQuestions)
      setSelectedIds([])
    } catch (error) {
      console.error('加载失败:', error)
      Toast.show({
        icon: 'fail',
        content: '加载失败'
      })
    } finally {
      setLocalLoading(false)
      setLoading(false)
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
        // Mock 数据模式：直接添加到错题本 store
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

        // 添加到错题本 store
        addWrongQuestion(wrongQuestion)

        // 记录已加入错题本的题目 ID 到 localStorage
        const addedIds = getAddedToWrongBookIds()
        addedIds.add(question.id)
        saveAddedToWrongBookIds(addedIds)

        // 从待确认列表中移除已添加的题目
        setQuestions(questions.filter(q => q.id !== question.id))

        // 同时更新 pendingQuestions store
        setPendingQuestions(pendingQuestions.filter(q => q.id !== question.id))
      } else {
        // 真实 API 模式
        await addWrongQuestions(currentStudent.id, [question.id])

        // 添加到本地存储
        addWrongQuestion(question)
      }

      Toast.show({
        icon: 'success',
        content: '已加入错题本'
      })
    } catch (error) {
      console.error('添加失败:', error)
      Toast.show({
        icon: 'fail',
        content: '添加失败'
      })
    }
  }

  // 批量加入错题本
  const handleAddToWrongBook = async () => {
    if (selectedIds.length === 0) {
      Toast.show('请先选择题目')
      return
    }

    Dialog.confirm({
      content: `确定将选中的 ${selectedIds.length} 道题加入错题本？`,
      onConfirm: async () => {
        setLoading(true)

        try {
          if (USE_MOCK_DATA) {
            // Mock 数据模式：直接添加到错题本 store
            const selectedQuestions = questions.filter(q => selectedIds.includes(q.id))

            // 转换为错题本格式
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

            // 批量添加到错题本 store
            addMultipleToStore(wrongQuestions)

            // 记录已加入错题本的题目 ID 到 localStorage
            const addedIds = getAddedToWrongBookIds()
            selectedIds.forEach(id => addedIds.add(id))
            saveAddedToWrongBookIds(addedIds)

            // 从待确认列表中移除已添加的题目
            const remainingQuestions = questions.filter(q => !selectedIds.includes(q.id))
            setQuestions(remainingQuestions)

            // 同时更新 pendingQuestions store
            const remainingPendingQuestions = pendingQuestions.filter(q => !selectedIds.includes(q.id))
            setPendingQuestions(remainingPendingQuestions)
          } else {
            // 真实 API 模式
            await addWrongQuestions(currentStudent.id, selectedIds)

            // 添加到本地存储
            const selectedQuestions = questions.filter(q => selectedIds.includes(q.id))
            addMultipleToStore(selectedQuestions)
          }

          Toast.show({
            icon: 'success',
            content: `成功添加 ${selectedIds.length} 道题到错题本`
          })

          setSelectedIds([])
        } catch (error) {
          console.error('添加失败:', error)
          Toast.show({
            icon: 'fail',
            content: '添加失败'
          })
        } finally {
          setLoading(false)
        }
      }
    })
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
          // 更新本地状态
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
      <span style={{ color: APPLE_COLORS.textSecondary, fontSize: '13px' }}>
        {typeMap[type] || '解答题'}
      </span>
    )
  }

  // 获取题目所属任务的原图
  const getTaskImageUrl = (taskId) => {
    console.log('查找任务:', taskId)
    console.log('tasks:', tasks)
    // 先从 store 的 tasks 中查找（包含用户上传的任务）
    let task = tasks.find(t => t.id === taskId)
    // 如果没找到，再从 mockTasks 中查找
    if (!task) {
      task = mockTasks.find(t => t.id === taskId)
    }
    console.log('找到任务:', task)
    return task?.image_url || null
  }

  // 查看原图
  const handleViewImage = (taskId) => {
    console.log('点击查看原图, taskId:', taskId)
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

  // 所有学生疑似错题的总数量（用于提醒还有其他学生待处理）
  const getTotalWrongCount = () => {
    // 从 pendingQuestions store 中统计所有学生的疑似错题
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
        <div style={{ marginTop: '16px', color: APPLE_COLORS.textSecondary }}>加载中...</div>
      </div>
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
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: APPLE_COLORS.text }}>待确认</h1>
        <Button fill="none" style={{ color: APPLE_COLORS.textSecondary, fontSize: '15px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            筛选
            <svg width="18" height="18" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M544 128v768c0 17.6-14.4 32-32 32s-32-14.4-32-32V128c0-17.6 14.4-32 32-32s32 14.4 32 32z"/>
              <path d="M320 384v512c0 17.6-14.4 32-32 32s-32-14.4-32-32V384c0-17.6 14.4-32 32-32s32 14.4 32 32z"/>
              <path d="M768 576v320c0 17.6-14.4 32-32 32s-32-14.4-32-32V576c0-17.6 14.4-32 32-32s32 14.4 32 32z"/>
            </svg>
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
              content={totalWrongCount > 0 ? (totalWrongCount > 9 ? '9+' : String(totalWrongCount)) : null}
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

      {/* 统计信息 - 苹果风格 */}
      <div style={{ background: APPLE_COLORS.card, padding: '12px 16px', borderBottom: '1px solid ' + APPLE_COLORS.border }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          color: APPLE_COLORS.textSecondary,
          fontSize: '14px'
        }}>
          <span>共有 <strong style={{ color: APPLE_COLORS.primary }}>{questions.length}</strong> 道题待确认，其中 <strong style={{ color: APPLE_COLORS.danger }}>{getWrongCount()}</strong> 道疑似错题</span>
          <RightOutline color={APPLE_COLORS.textSecondary} />
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
                background: isActive ? tab.color : APPLE_COLORS.background,
                color: isActive ? '#fff' : APPLE_COLORS.textSecondary,
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

      {/* 题目列表 - 苹果风格 */}
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
                    color: APPLE_COLORS.primary,
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
                  background: APPLE_COLORS.card,
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
                      color: APPLE_COLORS.text,
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
                  color: APPLE_COLORS.text, 
                  lineHeight: '1.6',
                  marginBottom: question.options?.length > 0 ? '12px' : '0'
                }}>
                  {question.content}
                </div>

                {/* 选项 */}
                {question.options && question.options.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {question.options.map((option, i) => (
                      <div key={i} style={{ fontSize: '14px', color: APPLE_COLORS.textSecondary }}>
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
                    style={{ color: APPLE_COLORS.warning, fontSize: '14px' }}
                    onClick={() => handleViewImage(question.task_id)}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                        <path d="M512 128c-212.8 0-384 171.2-384 384s171.2 384 384 384 384-171.2 384-384-171.2-384-384-384zM512 832c-176.8 0-320-143.2-320-320s143.2-320 320-320 320 143.2 320 320-143.2 320-320 320z"/>
                        <path d="M512 320c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96zM512 480c-35.2 0-64-28.8-64-64s28.8-64 64-64 64 28.8 64 64-28.8 64-64 64z"/>
                        <path d="M512 224c-17.6 0-32 14.4-32 32v48c0 17.6 14.4 32 32 32s32-14.4 32-32v-48c0-17.6-14.4-32-32-32zM512 688c-17.6 0-32 14.4-32 32v48c0 17.6 14.4 32 32 32s32-14.4 32-32v-48c0-17.6-14.4-32-32-32zM688 480c-17.6 0-32 14.4-32 32s14.4 32 32 32h48c17.6 0 32-14.4 32-32s-14.4-32-32-32h-48zM288 480c-17.6 0-32 14.4-32 32s14.4 32 32 32h48c17.6 0 32-14.4 32-32s-14.4-32-32-32h-48z"/>
                      </svg>
                      查看原图
                    </span>
                  </Button>
                  <Button
                    size="small"
                    fill="none"
                    style={{ color: APPLE_COLORS.primary, fontSize: '14px' }}
                    onClick={() => setEditingQuestion(question)}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                        <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128zM512 832c-88 0-160-72-160-160s72-160 160-160 160 72 160 160-72 160-160 160zm0-256c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96z"/>
                      </svg>
                      编辑
                    </span>
                  </Button>
                  <Button
                    size="small"
                    fill="none"
                    style={{ color: APPLE_COLORS.danger, fontSize: '14px' }}
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
                      <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                        <path d="M864 256H736v-64c0-52.8-43.2-96-96-96H384c-52.8 0-96 43.2-96 96v64H160c-17.6 0-32 14.4-32 32s14.4 32 32 32h32v544c0 52.8 43.2 96 96 96h448c52.8 0 96-43.2 96-96V320h32c17.6 0 32-14.4 32-32s-14.4-32-32-32zM384 192h256v64H384V192zm352 672c0 17.6-14.4 32-32 32H320c-17.6 0-32-14.4-32-32V320h448v544z"/>
                        <path d="M448 448c-17.6 0-32 14.4-32 32v256c0 17.6 14.4 32 32 32s32-14.4 32-32V480c0-17.6-14.4-32-32-32z"/>
                        <path d="M576 448c-17.6 0-32 14.4-32 32v256c0 17.6 14.4 32 32 32s32-14.4 32-32V480c0-17.6-14.4-32-32-32z"/>
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
        <div style={{ fontSize: '14px', color: APPLE_COLORS.textSecondary }}>
          已选择 <strong style={{ color: APPLE_COLORS.primary }}>{selectedIds.length}</strong> 题
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button 
            fill="none" 
            style={{ color: APPLE_COLORS.textSecondary }}
            onClick={clearSelection}
            disabled={selectedIds.length === 0}
          >
            清空
          </Button>
          <Button 
            fill="outline"
            style={{ borderColor: APPLE_COLORS.success, color: APPLE_COLORS.success }}
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
              background: APPLE_COLORS.primary,
              borderRadius: '10px'
            }}
          >
            加入错题本 ({selectedIds.length})
          </Button>
        </div>
      </div>

      {/* 题目编辑抽屉 */}
      <QuestionEditDrawer
        questionId={editingQuestion?.id}
        visible={!!editingQuestion}
        onClose={() => setEditingQuestion(null)}
        onSave={(updatedQuestion) => {
          // 更新本地数据
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

      {/* 原图查看器 */}
      <ImageViewer
        image={viewingImage}
        visible={!!viewingImage}
        onClose={() => setViewingImage(null)}
      />
    </div>
  )
}
