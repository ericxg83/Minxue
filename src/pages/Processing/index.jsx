import { useEffect, useState, useRef, useCallback } from 'react'
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
import { getTasksByStudent, updateTaskStatus, createTask, uploadImage } from '../../services/supabaseService'
import { taskService } from '../../services/taskService'
import { compressImage } from '../../services/aiService'
import { mockTasks, mockStudents } from '../../data/mockData'
import StudentSwitcher from '../../components/StudentSwitcher'
import dayjs from 'dayjs'

const USE_MOCK_DATA = false

const USE_BACKEND_API = true

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'processing', label: '处理中' },
  { key: 'pending', label: '等待中' },
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '失败' }
]

const STATUS_CONFIG = {
  processing: { text: '处理中', color: '#4A9EFF', bgColor: '#EBF5FF', icon: 'processing' },
  done: { text: '已完成', color: '#34C759', bgColor: '#E8F5E9', icon: 'done' },
  failed: { text: '处理失败', color: '#FF3B30', bgColor: '#FFEBEE', icon: 'failed' },
  pending: { text: '等待处理', color: '#FF9500', bgColor: '#FFF3E0', icon: 'pending' }
}

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

const getFailedStudentsCount = (allTasks) => {
  const failedStudentIds = new Set(
    allTasks.filter(t => t.status === 'failed').map(t => t.student_id)
  )
  return failedStudentIds.size
}

export default function Processing() {
  const { students, currentStudent } = useStudentStore()
  const { tasks, setTasks, addTask, updateTaskStatus: updateTaskInStore, startRealtimeSync, stopRealtimeSync, startPolling, stopPolling, cleanup: cleanupSync } = useTaskStore()
  const { addPendingQuestions } = usePendingQuestionStore()
  const { setLoading, setCurrentPage } = useUIStore()
  
  const [loading, setLocalLoading] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const fileInputRef = useRef(null)
  const [initializedStudents, setInitializedStudents] = useState(new Set())

  useEffect(() => {
    startRealtimeSync()
    return () => {
      cleanupSync()
    }
  }, [])

  useEffect(() => {
    if (currentStudent) {
      loadTasks()
      stopPolling()
      startPolling(currentStudent.id)
    }
    return () => {
      stopPolling()
    }
  }, [currentStudent?.id])

  const loadTasks = async () => {
    if (!currentStudent) return
    
    try {
      if (USE_MOCK_DATA) {
        if (initializedStudents.has(currentStudent.id)) return
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
        const allTasks = [...tasks, ...newMockTasks, ...newTestTasks]
        setTasks(allTasks)
        setInitializedStudents(prev => new Set([...prev, currentStudent.id]))
        return
      }

      try {
        const tasksData = await getTasksByStudent(currentStudent.id, true)
        if (tasksData && tasksData.length > 0) {
          const existingTaskIds = new Set(tasks.map(t => t.id))
          const newTasks = tasksData.filter(t => !existingTaskIds.has(t.id))
          if (newTasks.length > 0) {
            setTasks([...tasks, ...newTasks])
          }
        }
      } catch (error) {
        console.error('加载任务失败:', error)
      }

      const backgroundRefresh = async () => {
        try {
          const freshData = await getTasksByStudent(currentStudent.id, false)
          if (freshData && freshData.length > 0) {
            setTasks(freshData)
          }
        } catch (error) {
          console.debug('后台刷新任务失败:', error)
        }
      }
      backgroundRefresh()
      setInitializedStudents(prev => new Set([...prev, currentStudent.id]))
    } catch (error) {
      console.error('加载失败:', error)
    }
  }

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

  const getStatusCount = (status) => {
    const studentTasks = tasks.filter(t => t.student_id === currentStudent?.id)
    if (status === 'all') return studentTasks.length
    return studentTasks.filter(t => t.status === status).length
  }

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

  const handleCameraUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('capture', 'environment')
      fileInputRef.current.click()
    }
  }

  const handleAlbumUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture')
      fileInputRef.current.click()
    }
  }

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    e.target.value = ''

    const duplicateFiles = []
    const newFiles = []

    for (const file of files) {
      const localDuplicate = tasks.find(t =>
        t.student_id === currentStudent.id &&
        t.original_name === file.name
      )
      if (localDuplicate) {
        duplicateFiles.push(file)
        continue
      }
      try {
        const allTasks = await getTasksByStudent(currentStudent.id)
        const dbDuplicate = allTasks?.find(t => t.original_name === file.name)
        if (dbDuplicate) {
          duplicateFiles.push(file)
          continue
        }
      } catch (checkError) {
        console.warn('检查重复试卷失败:', checkError)
      }
      newFiles.push(file)
    }

    let filesToUpload = [...newFiles]

    if (duplicateFiles.length > 0) {
      const duplicateNames = duplicateFiles.map(f => f.name).join('、')
      await new Promise((resolve) => {
        Dialog.confirm({
          title: '检测到重复试卷',
          content: `以下试卷已上传过：${duplicateNames}。是否跳过重复试卷？`,
          confirmText: '跳过重复，上传新文件',
          cancelText: '全部上传',
          onConfirm: () => {
            if (newFiles.length === 0) {
              Toast.show({ icon: 'info', content: '所有试卷均已上传过，已跳过' })
            }
            resolve()
          },
          onCancel: () => {
            filesToUpload = [...newFiles, ...duplicateFiles]
            resolve()
          }
        })
      })
    }

    if (filesToUpload.length === 0) return

    setUploading(true)
    Toast.show({
      icon: 'loading',
      content: `正在上传 ${filesToUpload.length} 个文件...`,
      duration: 0
    })

    try {
      if (USE_BACKEND_API) {
        await uploadViaBackend(filesToUpload)
      } else {
        await uploadViaFrontend(filesToUpload)
      }
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
  }

  const uploadViaBackend = async (files) => {
    const pendingTasks = []
    
    files.forEach((file) => {
      const tempTask = {
        id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        student_id: currentStudent.id,
        image_url: URL.createObjectURL(file),
        original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
        status: 'pending',
        result: { progress: 0 },
        created_at: new Date().toISOString(),
        is_temp: true
      }
      addTask(tempTask)
      pendingTasks.push({ tempTask, file })
    })

    Toast.clear()
    Toast.show({
      icon: 'success',
      content: `已添加 ${files.length} 个文件，正在上传...`,
      duration: 2000
    })

    let successCount = 0
    let failedCount = 0

    for (const { tempTask, file } of pendingTasks) {
      try {
        const result = await taskService.uploadFiles(currentStudent.id, [file])
        
        if (result.success && result.tasks.length > 0 && !result.tasks[0].error) {
          const serverTask = result.tasks[0]
          updateTaskInStore(tempTask.id, 'pending', { progress: 0 })
          setTasks(prev => prev.map(t => 
            t.id === tempTask.id ? { ...serverTask, is_temp: false } : t
          ))
          successCount++
        } else {
          failedCount++
          updateTaskInStore(tempTask.id, 'failed', { error: result.error || '上传失败' })
        }
      } catch (error) {
        console.error(`上传文件 ${file.name} 失败:`, error)
        failedCount++
        updateTaskInStore(tempTask.id, 'failed', { error: error.message || '上传失败' })
      }
    }

    if (failedCount > 0) {
      Toast.show({
        icon: 'fail',
        content: `${successCount} 个成功，${failedCount} 个失败`,
        duration: 2000
      })
    }
  }

  const uploadViaFrontend = async (files) => {
    for (const file of files) {
      await doUploadFileFrontend(file)
    }
    Toast.clear()
    Toast.show({
      icon: 'success',
      content: `成功上传 ${files.length} 个文件，后台识别中...`,
      duration: 2000
    })
  }

  const doUploadFileFrontend = async (file) => {
    let imageUrl = ''
    try {
      const storageUrl = await uploadImage(file, `tasks/${currentStudent.id}`)
      imageUrl = storageUrl
    } catch (uploadError) {
      console.warn('上传图片到存储失败:', uploadError)
    }

    const taskData = {
      student_id: currentStudent.id,
      image_url: imageUrl,
      original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
      status: 'pending',
      result: { progress: 0 }
    }

    try {
      const savedTask = await createTask(taskData)
      addTask(savedTask)

      try {
        await taskService.createTaskByUrl(currentStudent.id, imageUrl, taskData.original_name)
      } catch (backendError) {
        console.warn('提交到后端队列失败，任务仅在前端记录:', backendError)
      }
    } catch (error) {
      console.error('创建任务失败:', error)
      Toast.show({ icon: 'fail', content: '上传失败，请重试' })
      throw error
    }
  }

  const handleRetry = async (task) => {
    Dialog.confirm({
      title: '重新处理',
      content: '确定要重新处理这个文件吗？后端将重新进行AI识别。',
      onConfirm: async () => {
        Toast.show({
          icon: 'loading',
          content: '正在重新提交...',
          duration: 0
        })

        try {
          if (USE_BACKEND_API) {
            const result = await taskService.retryTask(task.id)
            if (result.success) {
              updateTaskInStore(task.id, 'pending', { progress: 0 })
              Toast.clear()
              Toast.show({
                icon: 'success',
                content: '已重新提交，后台处理中...'
              })
            } else {
              Toast.clear()
              Toast.show({
                icon: 'fail',
                content: result.error || '重试失败'
              })
            }
          } else {
            updateTaskInStore(task.id, 'processing', { progress: 0 })
            Toast.clear()
            Toast.show({
              icon: 'fail',
              content: '请重新上传图片进行识别'
            })
            setTasks(tasks.filter(t => t.id !== task.id))
          }
        } catch (error) {
          Toast.clear()
          Toast.show({
            icon: 'fail',
            content: '重试失败，请稍后再试'
          })
        }
      }
    })
  }

  const handleDelete = (task) => {
    Dialog.confirm({
      title: '删除任务',
      content: '确定要删除这个任务吗？',
      confirmText: '删除',
      confirmButtonProps: { color: 'danger' },
      onConfirm: () => {
        setTasks(tasks.filter(t => t.id !== task.id))
        Toast.show({ icon: 'success', content: '已删除' })
      }
    })
  }

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
      case 'pending':
        return (
          <div style={{ color: config.color, fontSize: '14px', fontWeight: 500 }}>
            {config.text}
            <span style={{ color: COLORS.textSecondary, marginLeft: '6px', fontSize: '12px', fontWeight: 400 }}>
              排队中...
            </span>
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
      case 'pending':
        return (
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: COLORS.warning,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="12" height="12" viewBox="0 0 1024 1024" fill="#fff">
              <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
              <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v192c0 17.6 14.4 32 32 32h192c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
            </svg>
          </div>
        )
      default:
        return null
    }
  }

  const renderTimeInfo = (task) => {
    if (task.status === 'done' && task.result?.duration) {
      const durationSec = Math.round(task.result.duration / 1000)
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
          <span style={{ fontSize: '12px', color: COLORS.textSecondary, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="12" height="12" viewBox="0 0 1024 1024" fill="currentColor">
              <path d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 832c-212 0-384-172-384-384s172-384 384-384 384 172 384 384-172 384-384 384z"/>
              <path d="M704 480H544V320c0-17.6-14.4-32-32-32s-32 14.4-32 32v192c0 17.6 14.4 32 32 32h192c17.6 0 32-14.4 32-32s-14.4-32-32-32z"/>
            </svg>
            耗时 {durationSec >= 60 ? `${Math.floor(durationSec / 60)}分${durationSec % 60}秒` : `${durationSec}秒`}
          </span>
          {task.result?.retryCount > 0 && (
            <span style={{ fontSize: '12px', color: COLORS.warning }}>
              重试 {task.result.retryCount} 次
            </span>
          )}
        </div>
      )
    }
    if (task.status === 'processing') {
      const elapsed = Math.round((Date.now() - new Date(task.updated_at || task.created_at).getTime()) / 1000)
      if (elapsed > 0) {
        return (
          <div style={{ marginTop: '4px' }}>
            <span style={{ fontSize: '12px', color: COLORS.textSecondary }}>
              已处理 {elapsed >= 60 ? `${Math.floor(elapsed / 60)}分${elapsed % 60}秒` : `${elapsed}秒`}
            </span>
          </div>
        )
      }
    }
    return null
  }

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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

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
              上传后后台自动识别，无需等待
            </div>
          </div>
        </div>
      </div>

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
                          Toast.show({ icon: 'success', content: '已删除' })
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

                  <div style={{ flexShrink: 0, marginTop: '4px' }}>
                    {renderRightIcon(task)}
                  </div>
                </div>
              </SwipeAction>
            ))}
          </div>
        )}
      </div>

      <ImageViewer
        image={previewImage}
        visible={!!previewImage}
        onClose={() => setPreviewImage(null)}
      />

      <StudentSwitcher
        visible={showStudentSwitcher}
        onClose={() => setShowStudentSwitcher(false)}
        badgeType="failed"
      />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
