import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Camera,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  BookOpen,
  LayoutGrid,
  FileText,
  Sparkles,
  Search,
  Bell,
  Plus,
  QrCode,
  Printer,
  X,
  Trash2,
  ChevronDown,
  User,
  Image as ImageIcon,
  Maximize,
  Eye,
  Tag,
  Edit3
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useUIStore, useStudentStore, useTaskStore, useWrongQuestionStore, usePendingQuestionStore, useExamStore } from './store'
import { getStudents, getTasksByStudent, getQuestionsByTask, addWrongQuestions, getWrongQuestionsByStudent, getExamsByStudent, createTask, updateTaskStatus, uploadImage, createQuestions, updateQuestion, updateQuestionTags, invalidateCache } from './services/supabaseService'
import { taskService } from './services/taskService'
import { recognizeQuestions, compressImage, saveRecognitionResult } from './services/aiService'
import { mockQuestions, mockTasks, mockWrongQuestions, mockExams, mockStudents } from './data/mockData'
import StudentSwitcher from './components/StudentSwitcher'
import QuestionEditDrawer from './components/QuestionEditDrawer'
import { ProcessingSkeleton, PendingSkeleton, WrongBookSkeleton, ExamSkeleton } from './components/Skeleton'
import preloadEngine from './utils/preloadEngine'
import cacheManager from './utils/cacheManager'
import apiService from './services/apiService'
import { useToast } from './components/ToastProvider.jsx'
import Home from './pages/Home'
import ScanQR from './pages/ScanQR'
import Grading from './pages/Grading'
import dayjs from 'dayjs'
import jsPDF from 'jspdf'

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

// ==================== Main App ====================
const USE_MOCK_DATA = false

export default function App() {
  // Store hooks
  const { currentPage, setCurrentPage } = useUIStore()
  const { students, currentStudent, setCurrentStudent, setStudents, addStudent } = useStudentStore()
  const { tasks, setTasks, addTask, updateTaskStatus: updateTaskInStore, loading: tasksLoading, initialized: tasksInitialized } = useTaskStore()
  const { wrongQuestions, setWrongQuestions, selectedQuestions, setSelectedQuestions, toggleSelection, clearSelection, addWrongQuestion, addWrongQuestions: addMultipleToStore, loading: wrongLoading, initialized: wrongInitialized } = useWrongQuestionStore()
  const { pendingQuestions, setPendingQuestions, addPendingQuestions, loading: pendingLoading, initialized: pendingInitialized } = usePendingQuestionStore()
  const { exams, setExams, generatedExams, setGeneratedExams, loading: examLoading, initialized: examInitialized } = useExamStore()

  // Processing Page State
  const [processingFilter, setProcessingFilter] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)

  // Confirm Page State
  const [confirmFilter, setConfirmFilter] = useState('wrong')
  const [selectedConfirmIds, setSelectedConfirmIds] = useState([])
  const [editingQuestion, setEditingQuestion] = useState(null)

  // Bank Page State
  const [bankFilter, setBankFilter] = useState('pending')
  const [selectedSubject, setSelectedSubject] = useState('all')
  const [selectedTimeRange, setSelectedTimeRange] = useState('all')
  const [selectedErrorCount, setSelectedErrorCount] = useState('all')
  const [selectedTags, setSelectedTags] = useState([])
  const [showTagFilter, setShowTagFilter] = useState(false)
  const [showTimeFilter, setShowTimeFilter] = useState(false)
  const [showErrorFilter, setShowErrorFilter] = useState(false)
  const [showSubjectFilter, setShowSubjectFilter] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)
  const [showPrintOptions, setShowPrintOptions] = useState(false)
  const [printMode, setPrintMode] = useState('all')
  const [printSize, setPrintSize] = useState('a4')
  const [showGrading, setShowGrading] = useState(false)
  const [gradingExam, setGradingExam] = useState(null)
  const [showReprint, setShowReprint] = useState(false)
  const [reprintExam, setReprintExam] = useState(null)
  const [reprintQuestions, setReprintQuestions] = useState([])

  // Exam Page State
  const [examFilter, setExamFilter] = useState('all')
  const [showExamDetail, setShowExamDetail] = useState(false)
  const [selectedExam, setSelectedExam] = useState(null)
  const [showExamPrint, setShowExamPrint] = useState(false)
  const [showScanQR, setShowScanQR] = useState(false)

  // UI State
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [showImagePreview, setShowImagePreview] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState(null)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showTagManager, setShowTagManager] = useState(false)
  const [managingTagsQuestion, setManagingTagsQuestion] = useState(null)
  const [showAddTag, setShowAddTag] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showBatchActions, setShowBatchActions] = useState(false)
  const [showGenerateExam, setShowGenerateExam] = useState(false)
  const [generatedExamPreview, setGeneratedExamPreview] = useState(null)
  const [showStudentQR, setShowStudentQR] = useState(false)
  const [studentQRData, setStudentQRData] = useState(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [printPreviewData, setPrintPreviewData] = useState(null)
  const [showImageCrop, setShowImageCrop] = useState(false)
  const [cropImage, setCropImage] = useState(null)
  const [cropTaskId, setCropTaskId] = useState(null)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [printTarget, setPrintTarget] = useState(null)

  const toast = useToast()
  const Toast = {
    show: ({ icon, content, duration = 2000 }) => toast.show({
      message: content,
      type: icon === 'success' ? 'success' : icon === 'fail' ? 'error' : icon === 'loading' ? 'loading' : 'info',
      duration
    }),
    clear: () => {}
  }

  // ==================== 保持 Render 实例活跃 ====================
  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_URL || '/api'
    // 每 4 分钟 ping 一次后端，防止休眠
    const pingInterval = setInterval(() => {
      fetch(`${API_BASE}/health`).catch(() => {})
    }, 4 * 60 * 1000)

    // 立即 ping 一次
    fetch(`${API_BASE}/health`).catch(() => {})

    return () => clearInterval(pingInterval)
  }, [])

  // ==================== 优化的数据加载逻辑 ====================
  // Initialize students - SWR模式
  useEffect(() => {
    const init = async () => {
      try {
        if (USE_MOCK_DATA) {
          setStudents(mockStudents)
          if (mockStudents.length > 0) {
            setCurrentStudent(mockStudents[0])
          }
          return
        }

        const result = await apiService.swrFetch(
          'students',
          () => getStudents(false),
          {
            maxAge: 15 * 60 * 1000,
            onUpdate: (fresh) => {
              setStudents(fresh)
            }
          }
        )

        const safeStudentList = Array.isArray(result.data) ? result.data : []
        setStudents(safeStudentList)

        // 恢复上次选择的学生
        const lastStudentId = cacheManager.session.get('current_student_id')
        if (lastStudentId) {
          const found = safeStudentList.find(s => s.id === lastStudentId)
          if (found) {
            setCurrentStudent(found)
          } else if (safeStudentList.length > 0) {
            setCurrentStudent(safeStudentList[0])
          }
        } else if (safeStudentList.length > 0) {
          setCurrentStudent(safeStudentList[0])
        }
      } catch (error) {
        console.error('加载学生数据失败:', error)
        setStudents([])
        setCurrentStudent(null)
      }
    }

    init()
  }, [])

  // 学生加载完成后，自动加载当前页面数据
  useEffect(() => {
    if (!currentStudent) return
    const studentId = currentStudent.id

    // 根据当前页面自动加载数据
    switch (currentPage) {
      case 'processing':
        loadTasks(studentId)
        preloadEngine.smartPreload('processing', studentId)
        break
      case 'pending':
        loadPendingData(studentId)
        break
      case 'wrongbook':
        loadWrongBookData(studentId)
        preloadEngine.smartPreload('wrongbook', studentId)
        break
      case 'exam':
        loadGeneratedExams(studentId)
        break
      default:
        break
    }
  }, [currentStudent?.id])

  // 页面数据加载 - 使用SWR模式
  const loadTasks = useCallback(async (studentId, showLoading = true) => {
    if (!studentId) return
    const state = useTaskStore.getState()
    const isFirstLoad = !state.initialized
    if (isFirstLoad && showLoading) {
      state.setLoading(true)
    }

    try {
      console.log('🔄 开始加载任务列表, studentId:', studentId)
      const result = await apiService.swrFetch(
        `tasks_${studentId}`,
        () => getTasksByStudent(studentId, false),
        {
          maxAge: 10 * 60 * 1000,
          onUpdate: (fresh) => {
            console.log('📥 任务列表更新 (onUpdate):', fresh?.length, '条')
            if (Array.isArray(fresh) && fresh.length > 0) {
              useTaskStore.getState().syncTasksFromServer(fresh)
            }
          }
        }
      )
      console.log('✅ 任务列表加载完成, 数据源:', result.from, ', 数量:', result.data?.length)
      const safeData = Array.isArray(result.data) ? result.data : []
      // 合并现有任务（保留临时上传中的任务）
      const existingTasks = useTaskStore.getState().tasks || []
      const serverIds = new Set(safeData.map(t => t?.id).filter(Boolean))
      const tempTasks = existingTasks.filter(t => t?.is_temp && !serverIds.has(t.id))
      useTaskStore.getState().setTasks([...safeData, ...tempTasks])
    } catch (error) {
      console.error('加载任务失败:', error)
      // 不要清空列表，保留现有数据
    } finally {
      if (isFirstLoad) {
        useTaskStore.getState().setLoading(false)
      }
    }
  }, [])

  const loadPendingData = useCallback(async (studentId, showLoading = true) => {
    if (!studentId) return
    if (showLoading) usePendingQuestionStore.getState().setLoading(true)

    try {
      // 并行获取任务和错题
      const [tasksResult, wrongResult] = await Promise.all([
        apiService.swrFetch(
          `tasks_${studentId}`,
          () => getTasksByStudent(studentId, false),
          { maxAge: 10 * 60 * 1000 }
        ),
        apiService.swrFetch(
          `wrong_questions_${studentId}`,
          () => getWrongQuestionsByStudent(studentId, false),
          { maxAge: 5 * 60 * 1000 }
        )
      ])

      const taskList = Array.isArray(tasksResult.data) ? tasksResult.data : []
      const doneTasks = taskList.filter(t => t.status === 'done')

      // 并行获取所有题目的详情
      const questionPromises = doneTasks.slice(0, 5).map(task =>
        apiService.swrFetch(
          `questions_${task.id}`,
          () => getQuestionsByTask(task.id, false),
          { maxAge: 5 * 60 * 1000 }
        )
      )

      const questionResults = await Promise.all(questionPromises)
      const allQuestions = []
      for (const result of questionResults) {
        const qs = Array.isArray(result.data) ? result.data : []
        allQuestions.push(...qs.map(q => ({ ...q, status: q.is_correct ? 'correct' : 'wrong' })))
      }

      const wrongQuestionIds = new Set(
        (Array.isArray(wrongResult.data) ? wrongResult.data : []).map(w => w.question_id)
      )
      const pendingOnly = allQuestions.filter(q => !wrongQuestionIds.has(q.id))

      setPendingQuestions(pendingOnly)
    } catch (error) {
      console.error('加载待确认数据失败:', error)
      setPendingQuestions([])
    } finally {
      if (showLoading) usePendingQuestionStore.getState().setLoading(false)
    }
  }, [])

  const loadWrongBookData = useCallback(async (studentId, showLoading = true) => {
    if (!studentId) return
    if (showLoading) useWrongQuestionStore.getState().setLoading(true)

    try {
      const result = await apiService.swrFetch(
        `wrong_questions_${studentId}`,
        () => getWrongQuestionsByStudent(studentId, false),
        {
          maxAge: 5 * 60 * 1000,
          onUpdate: (fresh) => {
            setWrongQuestions(fresh)
          }
        }
      )
      setWrongQuestions(Array.isArray(result.data) ? result.data : [])
    } catch (error) {
      console.error('加载错题失败:', error)
      setWrongQuestions([])
    } finally {
      if (showLoading) useWrongQuestionStore.getState().setLoading(false)
    }
  }, [])

  const loadGeneratedExams = useCallback(async (studentId, showLoading = true) => {
    if (!studentId) return
    if (showLoading) useExamStore.getState().setLoading(true)

    try {
      const { getGeneratedExamsByStudent } = await import('./services/supabaseService')
      const result = await apiService.swrFetch(
        `generated_exams_${studentId}`,
        () => getGeneratedExamsByStudent(studentId, false),
        {
          maxAge: 10 * 60 * 1000,
          onUpdate: (fresh) => {
            setGeneratedExams(fresh)
          }
        }
      )
      setGeneratedExams(Array.isArray(result.data) ? result.data : [])
    } catch (error) {
      console.error('加载试卷失败:', error)
      setGeneratedExams([])
    } finally {
      if (showLoading) useExamStore.getState().setLoading(false)
    }
  }, [])

  // 学生切换时清空数据
  useEffect(() => {
    setTasks([])
    setPendingQuestions([])
    setWrongQuestions([])
    setGeneratedExams([])
    setExams([])
    preloadEngine.reset()
  }, [currentStudent?.id])

  // 页面切换或学生切换时加载数据
  useEffect(() => {
    if (!currentStudent) return
    const studentId = currentStudent.id

    // 根据当前页面自动加载数据
    switch (currentPage) {
      case 'processing':
        loadTasks(studentId)
        preloadEngine.smartPreload('processing', studentId)
        break
      case 'pending':
        loadPendingData(studentId)
        break
      case 'wrongbook':
        loadWrongBookData(studentId)
        preloadEngine.smartPreload('wrongbook', studentId)
        break
      case 'exam':
        loadGeneratedExams(studentId)
        break
      default:
        break
    }
  }, [currentStudent?.id, currentPage])

  // Load questions for reprint
  useEffect(() => {
    if (reprintExam && reprintExam.question_ids?.length > 0) {
      const loadReprintQuestions = async () => {
        try {
          const { getQuestionsByIds } = await import('./services/supabaseService')
          const questions = await getQuestionsByIds(reprintExam.question_ids)
          setReprintQuestions(questions || [])
        } catch (error) {
          console.error('加载题目失败:', error)
          setReprintQuestions([])
        }
      }
      loadReprintQuestions()
    } else {
      setReprintQuestions([])
    }
  }, [reprintExam])

  // Upload file handler
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    e.target.value = ''

    const duplicateFiles = []
    const newFiles = []

    for (const file of files) {
      const localDuplicate = tasks.find(t =>
        t.original_name === file.name &&
        t.student_id === currentStudent?.id
      )
      if (localDuplicate) {
        duplicateFiles.push(file)
      } else {
        newFiles.push(file)
      }
    }

    if (duplicateFiles.length > 0) {
      Toast.show({
        icon: 'fail',
        content: `${duplicateFiles.length} 个文件已存在，已自动跳过`
      })
    }

    if (newFiles.length === 0) return

    if (USE_MOCK_DATA) {
      await uploadViaFrontend(newFiles)
    } else {
      await uploadViaBackend(newFiles)
    }
  }

  // Upload via backend API
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

        if (result.success && result.tasks && result.tasks.length > 0) {
          const serverTask = result.tasks[0]
          if (!serverTask.error) {
            updateTaskInStore(tempTask.id, serverTask.status || 'pending', serverTask.result || { progress: 0 })
            setTasks(prev => {
              const safePrev = Array.isArray(prev) ? prev : []
              return safePrev.map(t =>
                t?.id === tempTask.id ? { ...serverTask, is_temp: false } : t
              )
            })
            successCount++
          } else {
            failedCount++
            updateTaskInStore(tempTask.id, 'failed', { error: serverTask.message || '上传失败' })
          }
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

    // 上传完成后刷新缓存并重新加载列表
    if (successCount > 0) {
      invalidateCache('tasks', currentStudent.id)
      // 不重新加载，直接使用store中的现有数据
      // 后台的syncTasksFromServer会自动更新
    }

    if (failedCount > 0) {
      Toast.show({
        icon: 'fail',
        content: `${successCount} 个成功，${failedCount} 个失败`,
        duration: 2000
      })
    }
  }

  // Upload via frontend (fallback)
  const uploadViaFrontend = async (files) => {
    for (const file of files) {
      try {
        setUploading(true)
        Toast.show({
          icon: 'loading',
          content: '正在上传...',
          duration: 0
        })

        const imageUrl = await uploadImage(file)
        if (!imageUrl) {
          throw new Error('上传图片失败')
        }

        // 创建任务记录
        const taskData = {
          student_id: currentStudent.id,
          image_url: imageUrl,
          original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
          status: 'processing',
          result: { progress: 0 }
        }

        const task = await createTask(taskData)
        addTask(task)

        // 开始AI识别
        Toast.show({
          icon: 'loading',
          content: 'AI识别中...',
          duration: 0
        })

        const compressedFile = await compressImage(file)
        const reader = new FileReader()
        reader.readAsDataURL(compressedFile)

        reader.onload = async () => {
          try {
            const base64 = reader.result.split(',')[1]
            const result = await recognizeQuestions(base64, task.id)

            if (result.success && result.questions?.length > 0) {
              // 保存识别结果
              await saveRecognitionResult(task.id, result.questions)

              // 更新任务状态
              await updateTaskStatus(task.id, 'done', {
                questionCount: result.questions.length,
                wrongCount: result.questions.filter(q => !q.is_correct).length
              })

              // 创建题目记录
              await createQuestions(result.questions.map(q => ({
                ...q,
                student_id: currentStudent.id,
                task_id: task.id
              })))

              Toast.show({
                icon: 'success',
                content: `识别完成！发现 ${result.questions.length} 道题目`,
                duration: 3000
              })
            } else {
              await updateTaskStatus(task.id, 'failed', {
                error: result.error || '识别失败'
              })

              Toast.show({
                icon: 'fail',
                content: result.error || '识别失败',
                duration: 3000
              })
            }

            // 刷新任务列表
            loadTasks(currentStudent.id)
          } catch (error) {
            console.error('AI识别失败:', error)
            await updateTaskStatus(task.id, 'failed', {
              error: error.message || '识别失败'
            })

            Toast.show({
              icon: 'fail',
              content: 'AI识别失败',
              duration: 3000
            })

            loadTasks(currentStudent.id)
          }
        }
      } catch (error) {
        console.error('上传失败:', error)
        Toast.show({
          icon: 'fail',
          content: error.message || '上传失败',
          duration: 3000
        })
      } finally {
        setUploading(false)
      }
    }
  }

  // Delete task
  const handleDeleteTask = async (taskId) => {
    try {
      setTasks(prev => {
        const safePrev = Array.isArray(prev) ? prev : []
        return safePrev.filter(t => t?.id !== taskId)
      })
      Toast.show({
        icon: 'success',
        content: '删除成功'
      })
    } catch (error) {
      console.error('删除失败:', error)
      Toast.show({
        icon: 'fail',
        content: '删除失败'
      })
    }
  }

  // Filter tasks
  const safeTasks = Array.isArray(tasks) ? tasks : []
  const filteredTasks = safeTasks.filter(t => {
    if (!t || t.student_id !== currentStudent?.id) return false
    if (processingFilter === 'all') return true
    return t.status === processingFilter
  })

  const getTotalFailedCount = () => {
    return safeTasks.filter(t => t?.status === 'failed').length
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto bg-white min-h-screen shadow-lg">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowStudentSwitcher(true)}
                className="flex items-center gap-2"
              >
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                  {currentStudent?.name?.[0] || '?'}
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-gray-900">{currentStudent?.name || '请选择学生'}</div>
                  <div className="text-xs text-gray-500">{currentStudent?.grade || ''}</div>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSearch(true)}
                className="p-2 rounded-lg hover:bg-gray-100"
              >
                <Search className="w-5 h-5 text-gray-600" />
              </button>
              <button
                onClick={() => setShowNotifications(true)}
                className="p-2 rounded-lg hover:bg-gray-100 relative"
              >
                <Bell className="w-5 h-5 text-gray-600" />
                {notifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="pb-20">
          {currentPage === 'home' && (
            <Home
              currentStudent={currentStudent}
              onNavigate={setCurrentPage}
              tasks={safeTasks}
              wrongQuestions={wrongQuestions}
              exams={exams}
            />
          )}

          {currentPage === 'processing' && (
            <div className="p-4">
              {/* Upload Area */}
              <div className="mb-6">
                <div
                  className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
                  onClick={() => document.getElementById('file-input').click()}
                >
                  <Camera className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 font-medium">拍照上传错题</p>
                  <p className="text-sm text-gray-400 mt-1">支持 JPG、PNG 格式</p>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-2 mb-4 overflow-x-auto">
                {['all', 'pending', 'processing', 'done', 'failed'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setProcessingFilter(status)}
                    className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
                      processingFilter === status
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {status === 'all' && '全部'}
                    {status === 'pending' && '待处理'}
                    {status === 'processing' && '处理中'}
                    {status === 'done' && '已完成'}
                    {status === 'failed' && '失败'}
                  </button>
                ))}
              </div>

              {/* Task List */}
              {tasksLoading ? (
                <ProcessingSkeleton />
              ) : filteredTasks.length === 0 ? (
                <div className="text-center py-12">
                  <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">暂无任务</p>
                  <p className="text-sm text-gray-400 mt-1">点击上方上传试卷</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredTasks.map((task) => (
                    <motion.div
                      key={task.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-16 h-16 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden">
                          {task.image_url ? (
                            <img
                              src={task.image_url}
                              alt={task.original_name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.src = ''
                                e.target.className = 'w-full h-full flex items-center justify-center'
                              }}
                            />
                          ) : (
                            <ImageIcon className="w-6 h-6 text-gray-400 m-5" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between">
                            <div>
                              <h3 className="font-medium text-gray-900 truncate">{task.original_name}</h3>
                              <p className="text-sm text-gray-500 mt-1">
                                {dayjs(task.created_at).format('MM-DD HH:mm')}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {task.status === 'pending' && (
                                <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full">
                                  待处理
                                </span>
                              )}
                              {task.status === 'processing' && (
                                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  处理中
                                </span>
                              )}
                              {task.status === 'done' && (
                                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />
                                  已完成
                                </span>
                              )}
                              {task.status === 'failed' && (
                                <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full flex items-center gap-1">
                                  <XCircle className="w-3 h-3" />
                                  失败
                                </span>
                              )}
                              <button
                                onClick={() => handleDeleteTask(task.id)}
                                className="p-1 hover:bg-gray-100 rounded"
                              >
                                <Trash2 className="w-4 h-4 text-gray-400" />
                              </button>
                            </div>
                          </div>

                          {task.status === 'processing' && task.result?.progress !== undefined && (
                            <div className="mt-2">
                              <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                  style={{ width: `${task.result.progress}%` }}
                                />
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                {task.result.progress}%
                              </p>
                            </div>
                          )}

                          {task.status === 'done' && task.result?.questionCount > 0 && (
                            <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
                              <span>共 {task.result.questionCount} 题</span>
                              <span className="text-red-500">{task.result.wrongCount} 道错题</span>
                            </div>
                          )}

                          {task.status === 'failed' && task.result?.error && (
                            <p className="mt-2 text-sm text-red-500">
                              {task.result.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentPage === 'pending' && (
            <div className="p-4">
              <h2 className="text-lg font-bold text-gray-900 mb-4">待确认错题</h2>
              {pendingLoading ? (
                <PendingSkeleton />
              ) : pendingQuestions.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">暂无待确认错题</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingQuestions.map((question) => (
                    <motion.div
                      key={question.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedConfirmIds.includes(question.id)}
                          onChange={() => {
                            if (selectedConfirmIds.includes(question.id)) {
                              setSelectedConfirmIds(prev => prev.filter(id => id !== question.id))
                            } else {
                              setSelectedConfirmIds(prev => [...prev, question.id])
                            }
                          }}
                          className="mt-1 w-4 h-4 text-blue-500 rounded border-gray-300"
                        />
                        <div className="flex-1">
                          <p className="text-gray-900 font-medium">{question.content}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                              {question.subject}
                            </span>
                            <span className={`px-2 py-1 text-xs rounded ${
                              question.status === 'wrong'
                                ? 'bg-red-100 text-red-600'
                                : 'bg-green-100 text-green-600'
                            }`}>
                              {question.status === 'wrong' ? '错题' : '正确'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {selectedConfirmIds.length > 0 && (
                <div className="fixed bottom-20 left-0 right-0 p-4">
                  <button
                    onClick={async () => {
                      try {
                        const selectedQuestions = pendingQuestions.filter(q => selectedConfirmIds.includes(q.id))
                        await addWrongQuestions(selectedQuestions.map(q => ({
                          student_id: currentStudent.id,
                          question_id: q.id,
                          content: q.content,
                          subject: q.subject,
                          error_type: q.error_type || '未分类'
                        })))
                        setSelectedConfirmIds([])
                        Toast.show({
                          icon: 'success',
                          content: `已添加 ${selectedQuestions.length} 道错题到错题本`
                        })
                        loadPendingData(currentStudent.id)
                      } catch (error) {
                        Toast.show({
                          icon: 'fail',
                          content: '添加失败'
                        })
                      }
                    }}
                    className="w-full max-w-md mx-auto bg-blue-500 text-white py-3 rounded-xl font-medium shadow-lg"
                  >
                    确认添加 {selectedConfirmIds.length} 道错题
                  </button>
                </div>
              )}
            </div>
          )}

          {currentPage === 'wrongbook' && (
            <div className="p-4">
              <h2 className="text-lg font-bold text-gray-900 mb-4">错题本</h2>
              {wrongLoading ? (
                <WrongBookSkeleton />
              ) : wrongQuestions.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">暂无错题</p>
                  <p className="text-sm text-gray-400 mt-1">去上传试卷，AI会自动识别错题</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {wrongQuestions.map((question) => (
                    <motion.div
                      key={question.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm"
                    >
                      <p className="text-gray-900 font-medium">{question.content}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                          {question.subject}
                        </span>
                        <span className="px-2 py-1 bg-red-100 text-red-600 text-xs rounded">
                          {question.error_type || '未分类'}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentPage === 'exam' && (
            <div className="p-4">
              <h2 className="text-lg font-bold text-gray-900 mb-4">试卷</h2>
              {examLoading ? (
                <ExamSkeleton />
              ) : generatedExams.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">暂无试卷</p>
                  <p className="text-sm text-gray-400 mt-1">从错题本生成试卷</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {generatedExams.map((exam) => (
                    <motion.div
                      key={exam.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm cursor-pointer"
                      onClick={() => {
                        setSelectedExam(exam)
                        setShowExamDetail(true)
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium text-gray-900">{exam.name || '未命名试卷'}</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            {exam.question_count || 0} 道题目 · {dayjs(exam.created_at).format('MM-DD HH:mm')}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
          <div className="max-w-md mx-auto flex items-center justify-around py-2">
            <button
              onClick={() => setCurrentPage('home')}
              className={`flex flex-col items-center gap-1 px-4 py-2 ${
                currentPage === 'home' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <LayoutGrid className="w-5 h-5" />
              <span className="text-xs">首页</span>
            </button>
            <button
              onClick={() => setCurrentPage('processing')}
              className={`flex flex-col items-center gap-1 px-4 py-2 ${
                currentPage === 'processing' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <Camera className="w-5 h-5" />
              <span className="text-xs">上传</span>
            </button>
            <button
              onClick={() => setCurrentPage('pending')}
              className={`flex flex-col items-center gap-1 px-4 py-2 ${
                currentPage === 'pending' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <BookOpen className="w-5 h-5" />
              <span className="text-xs">待确认</span>
            </button>
            <button
              onClick={() => setCurrentPage('wrongbook')}
              className={`flex flex-col items-center gap-1 px-4 py-2 ${
                currentPage === 'wrongbook' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <FileText className="w-5 h-5" />
              <span className="text-xs">错题本</span>
            </button>
            <button
              onClick={() => setCurrentPage('exam')}
              className={`flex flex-col items-center gap-1 px-4 py-2 ${
                currentPage === 'exam' ? 'text-blue-500' : 'text-gray-500'
              }`}
            >
              <Printer className="w-5 h-5" />
              <span className="text-xs">试卷</span>
            </button>
          </div>
        </nav>

        {/* Student Switcher */}
        <StudentSwitcher visible={showStudentSwitcher} onClose={() => setShowStudentSwitcher(false)} />

        {/* Hidden File Input */}
        <input
          type="file"
          id="file-input"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  )
}