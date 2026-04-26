import { useEffect, useState, useRef } from 'react'
import {
  Button,
  Toast,
  Empty,
  Dialog,
  SpinLoading,
  ProgressBar,
  ActionSheet,
  ImageViewer,
  Badge,
  SwipeAction
} from 'antd-mobile'
import { RightOutline } from 'antd-mobile-icons'
import { useStudentStore, useTaskStore, usePendingQuestionStore, useUIStore } from '../../store'
import { getTasksByStudent, updateTaskStatus, createTask } from '../../services/supabaseService'
import { recognizeQuestions, compressImage, saveRecognitionResult } from '../../services/aiService'
import { mockTasks, mockStudents } from '../../data/mockData'
import StudentSwitcher from '../../components/StudentSwitcher'
import dayjs from 'dayjs'

// 使用测试数据 - 设为 false 启用真实 AI 识别
const USE_MOCK_DATA = false

// 状态筛选标签
const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'processing', label: '处理中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' }
]

// 状态配置 - 苹果风格
const STATUS_CONFIG = {
  processing: { text: '处理中', color: '#007AFF', bgColor: '#E8F4FD', icon: 'processing' },
  done: { text: '已完成', color: '#34C759', bgColor: '#E8F5E9', icon: 'done' },
  failed: { text: '处理失败', color: '#FF3B30', bgColor: '#FFEBEE', icon: 'failed' },
  pending: { text: '等待处理', color: '#FF9500', bgColor: '#FFF3E0', icon: 'pending' }
}

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

// 计算有失败任务的学生数量
const getFailedStudentsCount = (allTasks) => {
  const failedStudentIds = new Set(
    allTasks.filter(t => t.status === 'failed').map(t => t.student_id)
  )
  return failedStudentIds.size
}

export default function Processing() {
  const { students, currentStudent } = useStudentStore()
  const { tasks, setTasks, addTask, updateTaskStatus: updateTaskInStore } = useTaskStore()
  const { addPendingQuestions } = usePendingQuestionStore()
  const { setLoading, setCurrentPage } = useUIStore()
  
  const [loading, setLocalLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const fileInputRef = useRef(null)

  // 标记是否已经初始化过 mock 数据
  const [initializedStudents, setInitializedStudents] = useState(new Set())

  // 加载任务 - 在组件挂载和切换学生时执行
  useEffect(() => {
    if (currentStudent) {
      // 只在第一次切换到该学生时加载 mock 数据
      loadMockTasks()
    }
  }, [currentStudent?.id])

  // 加载 mock 任务数据（只在第一次切换到该学生时加载 mock 数据）
  const loadMockTasks = async () => {
    if (!currentStudent) return
    
    setLocalLoading(true)
    setLoading(true)
    
    try {
      if (USE_MOCK_DATA) {
        // 检查该学生是否已经初始化过
        if (initializedStudents.has(currentStudent.id)) {
          // 已初始化过，只更新 loading 状态
          setLocalLoading(false)
          setLoading(false)
          return
        }
        
        // 获取当前学生的 mock 数据
        const filteredMockTasks = mockTasks.filter(t => t.student_id === currentStudent.id)
        
        // 添加测试用的失败和处理中任务（如果不存在）
        const testTasks = [
          {
            id: `task-failed-${currentStudent.id}`,
            student_id: currentStudent.id,
            image_url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=300&fit=crop',
            original_name: '2024-04-20_数学试卷.jpg',
            status: 'failed',
            result: { error: '识别失败，请重新上传或重试' },
            created_at: '2024-04-20T20:05:00Z'
          },
          {
            id: `task-processing-${currentStudent.id}`,
            student_id: currentStudent.id,
            image_url: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&h=300&fit=crop',
            original_name: '2024-04-20_语文试卷.jpg',
            status: 'processing',
            result: { progress: 20 },
            created_at: '2024-04-20T20:01:00Z'
          }
        ]
        
        // 获取当前 store 中该学生的任务
        const currentStudentExistingTasks = tasks.filter(t => t.student_id === currentStudent.id)
        const existingTaskIds = new Set(currentStudentExistingTasks.map(t => t.id))
        
        // 只添加不存在的 mock 任务
        const newMockTasks = filteredMockTasks.filter(t => !existingTaskIds.has(t.id))
        const newTestTasks = testTasks.filter(t => !existingTaskIds.has(t.id))
        
        // 合并所有任务
        const allTasks = [
          ...tasks,
          ...newMockTasks,
          ...newTestTasks
        ]
        
        setTasks(allTasks)
        
        // 标记该学生已初始化
        setInitializedStudents(prev => new Set([...prev, currentStudent.id]))
        
        setLocalLoading(false)
        setLoading(false)
        return
      }

      // 从 Supabase 加载任务数据
      console.log('从 Supabase 加载任务数据...')
      console.log('当前学生ID:', currentStudent.id, '类型:', typeof currentStudent.id)
      try {
        const tasksData = await getTasksByStudent(currentStudent.id)
        console.log('Supabase 返回的任务数据:', tasksData)
        
        if (tasksData && tasksData.length > 0) {
          // 合并现有任务和从 Supabase 加载的任务
          const existingTaskIds = new Set(tasks.map(t => t.id))
          const newTasks = tasksData.filter(t => !existingTaskIds.has(t.id))
          
          if (newTasks.length > 0) {
            setTasks([...tasks, ...newTasks])
          }
        }
      } catch (error) {
        console.error('从 Supabase 加载任务失败:', error)
        console.error('错误详情:', JSON.stringify(error, null, 2))
      }
      
      // 标记该学生已初始化
      setInitializedStudents(prev => new Set([...prev, currentStudent.id]))
    } catch (error) {
      console.error('加载失败:', error)
      // 静默处理错误，不显示 Toast
    } finally {
      setLocalLoading(false)
      setLoading(false)
    }
  }
  
  // 刷新任务列表（供刷新按钮使用）
  const loadTasks = async () => {
    // 刷新时只重新加载 mock 数据，保留用户上传的任务
    await loadMockTasks()
  }

  // 筛选并排序任务（只显示当前学生的任务，最新的在前）
  const filteredTasks = tasks
    .filter(task => {
      // 先按学生过滤
      if (task.student_id !== currentStudent?.id) return false
      // 再按状态过滤
      if (activeFilter === 'all') return true
      return task.status === activeFilter
    })
    .sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime()
      const timeB = new Date(b.created_at || 0).getTime()
      return timeB - timeA // 降序排列，最新的在前
    })

  // 获取各状态数量（只统计当前学生的任务）
  const getStatusCount = (status) => {
    const studentTasks = tasks.filter(t => t.student_id === currentStudent?.id)
    if (status === 'all') return studentTasks.length
    return studentTasks.filter(t => t.status === status).length
  }

  // 显示上传选项
  const showUploadOptions = () => {
    ActionSheet.show({
      actions: [
        { key: 'camera', text: '拍照上传', description: '拍摄试卷或作业' },
        { key: 'album', text: '从相册选择', description: '选择已有照片' },
      ],
      onAction: (action) => {
        if (action.key === 'camera') {
          handleCameraUpload()
        } else if (action.key === 'album') {
          handleAlbumUpload()
        }
      }
    })
  }

  // 拍照上传
  const handleCameraUpload = () => {
    // 触发文件选择，使用 camera 模式
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('capture', 'environment')
      fileInputRef.current.click()
    }
  }

  // 相册上传
  const handleAlbumUpload = () => {
    // 触发文件选择，不使用 capture
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture')
      fileInputRef.current.click()
    }
  }

  // 处理文件选择
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return

    // 立即清空 input，关闭文件选择器弹窗
    e.target.value = ''

    setUploading(true)
    Toast.show({
      icon: 'loading',
      content: `正在上传 ${files.length} 个文件...`,
      duration: 0
    })

    // 使用 setTimeout 让弹窗先关闭，再处理上传
    setTimeout(async () => {
      try {
        for (const file of files) {
          // 先完成上传（创建任务），不等待AI识别完成
          await uploadFile(file)
        }
        
        // 立即关闭loading弹窗，显示成功
        Toast.clear()
        Toast.show({
          icon: 'success',
          content: `成功上传 ${files.length} 个文件，正在后台识别...`,
          duration: 2000
        })
        
        // 不需要调用 loadTasks，因为 addTask 已经更新了 store
        // React 会自动重新渲染组件
      } catch (error) {
        console.error('上传失败:', error)
        Toast.clear()
        Toast.show({
          icon: 'fail',
          content: '上传失败，请重试'
        })
      } finally {
        setUploading(false)
      }
    }, 100)
  }

  // 上传单个文件 - 只创建任务，不等待AI识别
  const uploadFile = async (file) => {
    // 将图片转换为 base64 以便持久化存储
    const imageBase64 = await fileToBase64(file)

    // 创建新任务
    const newTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      student_id: currentStudent.id,
      image_url: imageBase64,  // 使用 base64 存储，确保刷新后图片不丢失
      original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
      status: 'processing',
      result: { progress: 0 },
      created_at: new Date().toISOString()
    }

    // 添加到任务列表
    addTask(newTask)

    if (USE_MOCK_DATA) {
      // 模拟处理过程
      simulateProcessing(newTask.id)
      return
    }

    // 真实 AI 识别处理逻辑 - 在后台异步执行，不阻塞上传
    processImageAsync(newTask.id, file)
  }

  // 将文件转换为 base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result)
      reader.onerror = (error) => reject(error)
    })
  }

  // 后台异步处理图片识别
  const processImageAsync = async (taskId, file) => {
    try {
      // 更新进度到10% - 开始压缩图片
      updateTaskInStore(taskId, 'processing', { progress: 10 })
      console.log('开始压缩图片:', file.name, file.size, 'bytes')

      // 1. 压缩图片（限制在 2048x2048 以内）
      let compressedBase64
      try {
        compressedBase64 = await compressImage(file, 1920, 1920, 0.85)
        console.log('图片压缩完成，大小:', compressedBase64.length, 'bytes')
      } catch (compressError) {
        console.error('图片压缩失败:', compressError)
        updateTaskInStore(taskId, 'failed', { error: '图片压缩失败: ' + compressError.message })
        return
      }
      updateTaskInStore(taskId, 'processing', { progress: 30 })

      // 2. 调用 AI 接口识别题目
      updateTaskInStore(taskId, 'processing', { progress: 50 })
      const result = await recognizeQuestions(compressedBase64, currentStudent.id, taskId)

      if (!result.success) {
        // 识别失败
        updateTaskInStore(taskId, 'failed', {
          error: result.error || '识别失败，请重新上传或重试',
          shouldRetry: result.shouldRetry
        })
        return
      }

      // 识别成功
      updateTaskInStore(taskId, 'processing', { progress: 80 })

      const questions = result.questions || []
      const wrongCount = questions.filter(q => !q.is_correct).length

      // 3. 保存识别结果到本地数据库
      const saveResult = saveRecognitionResult(taskId, currentStudent.id, questions)
      if (!saveResult.success) {
        console.warn('保存识别结果到本地失败:', saveResult.error)
      }

      // 4. 更新任务状态为完成
      updateTaskInStore(taskId, 'done', {
        questionCount: questions.length,
        wrongCount: wrongCount,
        duration: result.duration
      })

      // 5. 将题目添加到待确认列表
      if (questions.length > 0) {
        addPendingQuestions(questions)
      }

      updateTaskInStore(taskId, 'processing', { progress: 100 })

      // 静默显示识别完成提示（可选）
      console.log(`识别完成，发现 ${questions.length} 道题，${wrongCount} 道疑似错题`)

    } catch (error) {
      console.error('处理失败:', error)
      updateTaskInStore(newTask.id, 'failed', {
        error: error.message || '处理失败，请重新上传或重试'
      })

      Toast.show({
        icon: 'fail',
        content: '处理失败，请重新上传或重试'
      })
      throw error
    }
  }

  // 模拟处理过程
  const simulateProcessing = (taskId) => {
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 20
      if (progress >= 100) {
        progress = 100
        clearInterval(interval)
        
        // 模拟随机成功或失败
        const isSuccess = Math.random() > 0.2
        if (isSuccess) {
          // 生成模拟识别的题目（6道题）
          const questionCount = 6
          const wrongCount = Math.floor(Math.random() * 3) + 1 // 1-3道错题
          
          // 更新任务状态
          updateTaskInStore(taskId, 'done', { 
            questionCount,
            wrongCount
          })
          
          // 生成题目并同步到待确认列表
          const generatedQuestions = generateMockQuestions(taskId, questionCount, wrongCount)
          console.log('生成的题目:', generatedQuestions)
          addPendingQuestions(generatedQuestions)
          console.log('已添加到待确认列表，学生ID:', currentStudent.id)
          
          Toast.show({
            icon: 'success',
            content: `识别完成，发现 ${questionCount} 道题，${wrongCount} 道疑似错题`
          })
        } else {
          updateTaskInStore(taskId, 'failed', { 
            error: '识别失败，请重新上传或重试' 
          })
        }
      } else {
        updateTaskInStore(taskId, 'processing', { progress: Math.floor(progress) })
      }
    }, 500)
  }
  
  // 生成模拟识别的题目
  const generateMockQuestions = (taskId, count, wrongCount) => {
    const questions = []
    const wrongIndices = new Set()
    
    // 随机选择哪些题目是错题
    while (wrongIndices.size < wrongCount) {
      wrongIndices.add(Math.floor(Math.random() * count))
    }
    
    for (let i = 0; i < count; i++) {
      const isWrong = wrongIndices.has(i)
      questions.push({
        id: `q-${taskId}-${i}`,
        task_id: taskId,
        student_id: currentStudent.id,
        content: `第 ${i + 1} 题：这是从上传的试卷中识别出的第 ${i + 1} 道题目内容...`,
        options: ['A. 选项A', 'B. 选项B', 'C. 选项C', 'D. 选项D'],
        answer: 'A',
        student_answer: isWrong ? 'B' : 'A',
        is_correct: !isWrong,
        question_type: 'choice',
        subject: '数学',
        status: isWrong ? 'wrong' : 'correct',
        created_at: new Date().toISOString()
      })
    }
    
    return questions
  }

  // 重试失败的任务
  const handleRetry = async (task) => {
    Dialog.confirm({
      title: '重新处理',
      content: '确定要重新处理这个文件吗？',
      onConfirm: async () => {
        Toast.show({
          icon: 'loading',
          content: '重新处理中...',
          duration: 0
        })

        try {
          if (USE_MOCK_DATA) {
            // 更新为处理中状态
            updateTaskInStore(task.id, 'processing', { progress: 0 })
            Toast.clear()
            // 重新模拟处理
            simulateProcessing(task.id)
            return
          }

          // 真实重试逻辑：需要重新获取文件并识别
          // 由于浏览器安全限制，无法直接重新获取已选择的文件
          // 这里提示用户重新上传
          Toast.clear()
          Toast.show({
            icon: 'fail',
            content: '请重新上传图片进行识别'
          })

          // 删除失败的任务
          setTasks(tasks.filter(t => t.id !== task.id))
        } catch (error) {
          Toast.clear()
          Toast.show({
            icon: 'fail',
            content: '重试失败'
          })
        }
      }
    })
  }

  // 删除任务
  const handleDelete = (task) => {
    Dialog.confirm({
      title: '删除任务',
      content: '确定要删除这个任务吗？',
      confirmText: '删除',
      confirmButtonProps: { color: 'danger' },
      onConfirm: () => {
        setTasks(tasks.filter(t => t.id !== task.id))
        Toast.show({
          icon: 'success',
          content: '已删除'
        })
      }
    })
  }

  // 渲染任务状态
  const renderTaskStatus = (task) => {
    const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending
    
    switch (task.status) {
      case 'processing':
        return (
          <div style={{ flex: 1 }}>
            <div style={{ 
              color: config.color, 
              fontSize: '14px', 
              marginBottom: '6px',
              fontWeight: 500
            }}>
              {config.text} {task.result?.progress || 0}%
            </div>
            <ProgressBar
              percent={task.result?.progress || 0}
              style={{
                '--fill-color': config.color,
                '--track-color': config.bgColor,
                '--track-width': '4px'
              }}
            />
          </div>
        )
      case 'done':
        return (
          <div style={{ color: config.color, fontSize: '14px', fontWeight: 500 }}>
            {config.text}
            {task.result?.questionCount && (
              <span style={{ color: APPLE_COLORS.textSecondary, marginLeft: '8px', fontWeight: 400 }}>
                {task.result.questionCount}题
              </span>
            )}
          </div>
        )
      case 'failed':
        return (
          <div style={{ flex: 1 }}>
            <div style={{ color: config.color, fontSize: '14px', fontWeight: 500 }}>
              {config.text}
            </div>
            <div style={{ color: config.color, fontSize: '12px', marginTop: '4px' }}>
              {task.result?.error || '识别失败，请重新上传或重试'}
            </div>
          </div>
        )
      default:
        return (
          <div style={{ color: config.color, fontSize: '14px', fontWeight: 500 }}>
            {config.text}
          </div>
        )
    }
  }

  // 渲染右侧图标
  const renderRightIcon = (task) => {
    switch (task.status) {
      case 'done':
        return (
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: APPLE_COLORS.success,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="14" height="14" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M912 224l-48-48-400 400-176-176-48 48 224 224z"/>
            </svg>
          </div>
        )
      case 'failed':
        return (
          <div 
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: APPLE_COLORS.danger,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            onClick={(e) => {
              e.stopPropagation()
              handleRetry(task)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M512 64C264.8 64 64 264.8 64 512s200.8 448 448 448 448-200.8 448-448S759.2 64 512 64z"/>
              <path d="M704 352c-12.8-12.8-32-12.8-44.8 0L512 499.2 364.8 352c-12.8-12.8-32-12.8-44.8 0-12.8 12.8-12.8 32 0 44.8L467.2 544 320 691.2c-12.8 12.8-12.8 32 0 44.8 6.4 6.4 16 9.6 22.4 9.6s16-3.2 22.4-9.6L512 588.8l147.2 147.2c6.4 6.4 16 9.6 22.4 9.6s16-3.2 22.4-9.6c12.8-12.8 12.8-32 0-44.8L556.8 544l147.2-147.2c12.8-12.8 12.8-32 0-44.8z"/>
            </svg>
          </div>
        )
      case 'processing':
        return (
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            border: '2px solid ' + APPLE_COLORS.primary,
            borderTopColor: 'transparent',
            animation: 'spin 1s linear infinite'
          }} />
        )
      default:
        return null
    }
  }

  // 渲染耗时信息
  const renderTimeInfo = (task) => {
    if (task.status === 'done' && task.result?.questionCount) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
          <span style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="12" height="12" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
              <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v192c0 17.6 14.4 32 32 32h192c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
            </svg>
            耗时 {dayjs(task.created_at).format('mm:ss')}
          </span>
        </div>
      )
    }
    return null
  }

  // 所有学生失败任务的总数量（用于提醒还有其他学生待处理）
  const getTotalFailedCount = () => {
    // 只从 store 中的 tasks 统计所有学生的失败任务
    // store 中的 tasks 是真实状态，已删除的任务不会在这里
    return tasks.filter(t => t.status === 'failed').length
  }
  
  const totalFailedCount = getTotalFailedCount()

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
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* 顶部标题栏 - 苹果风格 */}
      <div style={{ 
        background: APPLE_COLORS.card, 
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid ' + APPLE_COLORS.border
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: APPLE_COLORS.text }}>处理中</h1>
        <Button 
          fill="none" 
          style={{ color: APPLE_COLORS.primary, fontSize: '15px' }}
          onClick={loadTasks}
          disabled={uploading}
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
              content={totalFailedCount > 0 ? (totalFailedCount > 9 ? '9+' : String(totalFailedCount)) : null}
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

      {/* 上传按钮区域 - 苹果风格 */}
      <div style={{ padding: '16px', background: APPLE_COLORS.card, borderBottom: '1px solid ' + APPLE_COLORS.border }}>
        <div
          onClick={showUploadOptions}
          style={{
            border: '2px dashed ' + APPLE_COLORS.primary,
            borderRadius: '12px',
            padding: '32px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            background: 'linear-gradient(135deg, #F0F7FF 0%, #E8F4FD 100%)',
            opacity: uploading ? 0.6 : 1,
            transition: 'all 0.2s',
            boxShadow: '0 2px 12px rgba(0,122,255,0.08)'
          }}
        >
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, ' + APPLE_COLORS.primary + ' 0%, #0051D5 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,122,255,0.3)'
          }}>
            <svg width="28" height="28" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M832 256h-96l-32-64c-12.8-25.6-38.4-41.6-67.2-41.6H387.2c-28.8 0-54.4 16-67.2 41.6l-32 64H192c-70.4 0-128 57.6-128 128v384c0 70.4 57.6 128 128 128h640c70.4 0 128-57.6 128-128V384c0-70.4-57.6-128-128-128zM512 832c-88 0-160-72-160-160s72-160 160-160 160 72 160 160-72 160-160 160zm0-256c-52.8 0-96 43.2-96 96s43.2 96 96 96 96-43.2 96-96-43.2-96-96-96z"/>
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '17px', fontWeight: 600, color: APPLE_COLORS.primary, marginBottom: '4px' }}>
              点击上传
            </div>
            <div style={{ fontSize: '14px', color: APPLE_COLORS.textSecondary }}>
              支持拍照上传或从相册选择
            </div>
            <div style={{ fontSize: '12px', color: APPLE_COLORS.textSecondary, marginTop: '2px' }}>
              可批量上传作业或试卷
            </div>
          </div>
        </div>
      </div>

      {/* 状态筛选标签 - 苹果风格 */}
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
                padding: '8px 16px',
                borderRadius: '20px',
                fontSize: '14px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                background: isActive ? APPLE_COLORS.primary : APPLE_COLORS.background,
                color: isActive ? '#fff' : APPLE_COLORS.textSecondary,
                fontWeight: isActive ? 600 : 400,
                transition: 'all 0.2s',
                boxShadow: isActive ? '0 2px 8px rgba(0,122,255,0.3)' : 'none'
              }}
            >
              {tab.label} {count}
            </div>
          )
        })}
      </div>

      {/* 任务列表 - 苹果风格 */}
      <div style={{ padding: '12px' }}>
        {filteredTasks.length === 0 ? (
          <Empty
            description="暂无任务，点击上方上传按钮添加"
            style={{ padding: '64px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredTasks.map((task) => (
              <SwipeAction
                key={task.id}
                rightActions={[
                  {
                    key: 'delete',
                    text: '删除',
                    color: '#FF3B30',
                    onClick: () => {
                      Dialog.confirm({
                        title: '删除确认',
                        content: `确定要删除"${task.original_name || '未命名作业'}"吗？删除后不可恢复。`,
                        confirmText: '删除',
                        cancelText: '取消',
                        confirmButtonProps: { color: 'danger' },
                        onConfirm: () => {
                          setTasks(tasks.filter(t => t.id !== task.id))
                          Toast.show({
                            icon: 'success',
                            content: '已删除'
                          })
                        }
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
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'flex-start',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                  }}
                >
                  {/* 缩略图 */}
                  <div 
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '10px',
                      background: APPLE_COLORS.background,
                      overflow: 'hidden',
                      flexShrink: 0,
                      cursor: 'pointer'
                    }}
                    onClick={() => setPreviewImage(task.image_url)}
                  >
                    <img 
                      src={task.image_url} 
                      alt="" 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
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
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        marginRight: '8px',
                        fontWeight: 500
                      }}>
                        {task.original_name || '未命名作业'}
                      </div>
                      <span style={{ fontSize: '13px', color: APPLE_COLORS.textSecondary, flexShrink: 0 }}>
                        {dayjs(task.created_at).format('HH:mm')}
                      </span>
                    </div>
                    
                    {renderTaskStatus(task)}
                    {renderTimeInfo(task)}
                  </div>

                  {/* 右侧图标 */}
                  <div style={{ flexShrink: 0, marginTop: '4px' }}>
                    {renderRightIcon(task)}
                  </div>
                </div>
              </SwipeAction>
            ))}
          </div>
        )}
      </div>

      {/* 图片预览 */}
      <ImageViewer
        image={previewImage}
        visible={!!previewImage}
        onClose={() => setPreviewImage(null)}
      />

      {/* 学生切换弹窗 */}
      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        badgeType="failed"
      />

      {/* 添加旋转动画样式 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
