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

// 状态配置 - 现代风格
const STATUS_CONFIG = {
  processing: { text: '处理中', color: '#4A9EFF', bgColor: '#EBF5FF', icon: 'processing' },
  done: { text: '已完成', color: '#34C759', bgColor: '#E8F5E9', icon: 'done' },
  failed: { text: '处理失败', color: '#FF3B30', bgColor: '#FFEBEE', icon: 'failed' },
  pending: { text: '等待处理', color: '#FF9500', bgColor: '#FFF3E0', icon: 'pending' }
}

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
      loadMockTasks()
    }
  }, [currentStudent?.id])

  // 加载 mock 任务数据（只在第一次切换到该学生时加载）
  const loadMockTasks = async () => {
    if (!currentStudent) return
    
    setLocalLoading(true)
    setLoading(true)
    
    try {
      if (USE_MOCK_DATA) {
        if (initializedStudents.has(currentStudent.id)) {
          setLocalLoading(false)
          setLoading(false)
          return
        }
        
        const filteredMockTasks = mockTasks.filter(t => t.student_id === currentStudent.id)
        
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
        
        const currentStudentExistingTasks = tasks.filter(t => t.student_id === currentStudent.id)
        const existingTaskIds = new Set(currentStudentExistingTasks.map(t => t.id))
        
        const newMockTasks = filteredMockTasks.filter(t => !existingTaskIds.has(t.id))
        const newTestTasks = testTasks.filter(t => !existingTaskIds.has(t.id))
        
        const allTasks = [
          ...tasks,
          ...newMockTasks,
          ...newTestTasks
        ]
        
        setTasks(allTasks)
        setInitializedStudents(prev => new Set([...prev, currentStudent.id]))
        
        setLocalLoading(false)
        setLoading(false)
        return
      }

      console.log('从 Supabase 加载任务数据...')
      try {
        const tasksData = await getTasksByStudent(currentStudent.id)
        console.log('Supabase 返回的任务数据:', tasksData)
        
        if (tasksData && tasksData.length > 0) {
          const existingTaskIds = new Set(tasks.map(t => t.id))
          const newTasks = tasksData.filter(t => !existingTaskIds.has(t.id))
          
          if (newTasks.length > 0) {
            setTasks([...tasks, ...newTasks])
          }
        }
      } catch (error) {
        console.error('从 Supabase 加载任务失败:', error)
        console.error('错误详情:', error?.message, error?.code, error?.details)
      }
      
      setInitializedStudents(prev => new Set([...prev, currentStudent.id]))
    } catch (error) {
      console.error('加载失败:', error)
    } finally {
      setLocalLoading(false)
      setLoading(false)
    }
  }
  
  // 刷新任务列表（供刷新按钮使用）
  const loadTasks = async () => {
    await loadMockTasks()
  }

  // 筛选并排序任务（只显示当前学生的任务，最新的在前）
  const filteredTasks = tasks
    .filter(task => {
      if (task.student_id !== currentStudent?.id) return false
      if (activeFilter === 'all') return true
      return task.status === activeFilter
    })
    .sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime()
      const timeB = new Date(b.created_at || 0).getTime()
      return timeB - timeA
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
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('capture', 'environment')
      fileInputRef.current.click()
    }
  }

  // 相册上传
  const handleAlbumUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture')
      fileInputRef.current.click()
    }
  }

  // 处理文件选择
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return

    e.target.value = ''

    setUploading(true)
    Toast.show({
      icon: 'loading',
      content: `正在上传 ${files.length} 个文件...`,
      duration: 0
    })

    setTimeout(async () => {
      try {
        for (const file of files) {
          await uploadFile(file)
        }
        
        Toast.clear()
        Toast.show({
          icon: 'success',
          content: `成功上传 ${files.length} 个文件，正在后台识别...`,
          duration: 2000
        })
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
    const imageBase64 = await fileToBase64(file)

    const newTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      student_id: currentStudent.id,
      image_url: imageBase64,
      original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
      status: 'processing',
      result: { progress: 0 },
      created_at: new Date().toISOString()
    }

    addTask(newTask)

    if (USE_MOCK_DATA) {
      simulateProcessing(newTask.id)
      return
    }

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
      updateTaskInStore(taskId, 'processing', { progress: 10 })
      console.log('开始压缩图片:', file.name, file.size, 'bytes')

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

      updateTaskInStore(taskId, 'processing', { progress: 50 })
      const result = await recognizeQuestions(compressedBase64, currentStudent.id, taskId)

      if (!result.success) {
        updateTaskInStore(taskId, 'failed', {
          error: result.error || '识别失败，请重新上传或重试',
          shouldRetry: result.shouldRetry
        })
        return
      }

      updateTaskInStore(taskId, 'processing', { progress: 80 })

      const questions = result.questions || []
      const wrongCount = questions.filter(q => !q.is_correct).length

      const saveResult = saveRecognitionResult(taskId, currentStudent.id, questions)
      if (!saveResult.success) {
        console.warn('保存识别结果到本地失败:', saveResult.error)
      }

      updateTaskInStore(taskId, 'done', {
        questionCount: questions.length,
        wrongCount: wrongCount,
        duration: result.duration
      })

      if (questions.length > 0) {
        addPendingQuestions(questions)
      }

      updateTaskInStore(taskId, 'processing', { progress: 100 })
      console.log(`识别完成，发现 ${questions.length} 道题目，${wrongCount} 道疑似错题`)

    } catch (error) {
      console.error('处理失败:', error)
      updateTaskInStore(taskId, 'failed', {
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
        
        const isSuccess = Math.random() > 0.2
        if (isSuccess) {
          const questionCount = 6
          const wrongCount = Math.floor(Math.random() * 3) + 1
          
          updateTaskInStore(taskId, 'done', { 
            questionCount,
            wrongCount
          })
          
          const generatedQuestions = generateMockQuestions(taskId, questionCount, wrongCount)
          console.log('生成的题目:', generatedQuestions)
          addPendingQuestions(generatedQuestions)
          console.log('已添加到待确认列表，学生ID:', currentStudent.id)
          
          Toast.show({
            icon: 'success',
            content: `识别完成，发现 ${questionCount} 道题目，${wrongCount} 道疑似错题`
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
            updateTaskInStore(task.id, 'processing', { progress: 0 })
            Toast.clear()
            simulateProcessing(task.id)
            return
          }

          Toast.clear()
          Toast.show({
            icon: 'fail',
            content: '请重新上传图片进行识别'
          })

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
              <span style={{ color: COLORS.textSecondary, marginLeft: '8px', fontWeight: 400 }}>
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
            background: COLORS.success,
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
              background: COLORS.danger,
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
            border: '2px solid ' + COLORS.primary,
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
          <span style={{ fontSize: '12px', color: COLORS.textSecondary, display: 'flex', alignItems: 'center', gap: '4px' }}>
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

  // 所有学生失败任务的总数量
  const getTotalFailedCount = () => {
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
        <div style={{ marginTop: '16px', color: COLORS.textSecondary }}>加载中...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0', background: COLORS.background, minHeight: '100%', paddingBottom: '80px' }}>
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* 顶部标题栏 - 现代移动应用风格 */}
      <div style={{ 
        background: 'transparent', 
        padding: '12px 16px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: 'none'
      }}>
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, color: '#1A3A5C', letterSpacing: '-0.02em' }}>处理中</h1>
        <Button 
          fill="none" 
          style={{ color: '#4A9EFF', fontSize: '14px', fontWeight: 600 }}
          onClick={loadTasks}
          disabled={uploading}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M832 384c-12.8-12.8-32-12.8-44.8 0L704 467.2V320c0-105.6-86.4-192-192-192S320 214.4 320 320s86.4 192 192 192c48 0 92.8-17.6 128-48 12.8-12.8 12.8-32 0-44.8s-32-12.8-44.8 0C572.8 438.4 544 448 512 448c-70.4 0-128-57.6-128-128s57.6-128 128-128 128 57.6 128 128v147.2l-83.2-83.2c-12.8-12.8-32-12.8-44.8 0s-12.8 32 0 44.8l137.6 137.6c12.8 12.8 32 12.8 44.8 0l137.6-137.6c12.8-12.8 12.8-32 0-44.8z"/>
            </svg>
            刷新
          </span>
        </Button>
      </div>

      {/* 学生信息卡片 - 现代移动应用风格 */}
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
              content={totalFailedCount > 0 ? (totalFailedCount > 9 ? '9+' : String(totalFailedCount)) : null}
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

      {/* 上传按钮区域 - 现代移动应用风格 */}
      <div style={{ padding: '16px', background: COLORS.background }}>
        <div
          onClick={showUploadOptions}
          style={{
            borderRadius: '24px',
            padding: '48px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            background: 'linear-gradient(160deg, #EBF5FF 0%, #E0EEFB 50%, #D6E8F7 100%)',
            opacity: uploading ? 0.6 : 1,
            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 8px 24px rgba(0, 102, 204, 0.1), 0 2px 8px rgba(0, 102, 204, 0.06)',
            border: 'none'
          }}
        >
          <div style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #4A9EFF 0%, #2B7DE9 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 20px rgba(43, 125, 233, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
            transition: 'transform 0.25s ease'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="#fff">
              <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"/>
              <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" fillRule="evenodd"/>
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              fontSize: '22px', 
              fontWeight: 700, 
              color: '#1A3A5C', 
              marginBottom: '6px',
              letterSpacing: '-0.02em',
              lineHeight: '1.3'
            }}>
              拍照上传
            </div>
            <div style={{ 
              fontSize: '14px', 
              color: '#6B8AA8', 
              lineHeight: '1.5',
              fontWeight: 400
            }}>
              Qwen-VL 智能识别题目
            </div>
          </div>
        </div>
      </div>

      {/* 状态筛选标签 */}
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
                padding: '8px 16px',
                borderRadius: '20px',
                fontSize: '14px',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                background: isActive ? COLORS.primary : COLORS.background,
                color: isActive ? '#fff' : COLORS.textSecondary,
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

      {/* 任务列表 */}
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
                        content: `确定要删除 "${task.original_name || '未命名作业'}" 吗？删除后不可恢复。`,
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
                    background: COLORS.card,
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
                      background: COLORS.background,
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
                        color: COLORS.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                        marginRight: '8px',
                        fontWeight: 500
                      }}>
                        {task.original_name || '未命名作业'}
                      </div>
                      <span style={{ fontSize: '13px', color: COLORS.textSecondary, flexShrink: 0 }}>
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
