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

  // Toast (将在组件渲染后使用)

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
            setTasks(prev => prev.map(t =>
              t.id === tempTask.id ? { ...serverTask, is_temp: false } : t
            ))
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

        const imageUrl = await uploadImage(file, 'homework')
        const task = await createTask({
          student_id: currentStudent.id,
          image_url: imageUrl,
          original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
          status: 'pending'
        })

        addTask(task)
        processTask(task)
      } catch (error) {
        console.error('上传失败:', error)
        Toast.show({
          icon: 'fail',
          content: '上传失败，请重试'
        })
      } finally {
        setUploading(false)
      }
    }
  }

  // Process task (AI recognition)
  const processTask = async (task) => {
    try {
      updateTaskInStore(task.id, 'processing')
      Toast.show({
        icon: 'loading',
        content: '正在识别题目...',
        duration: 0
      })

      const compressedImage = await compressImage(task.image_url)
      const result = await recognizeQuestions(compressedImage)

      if (result.questions && result.questions.length > 0) {
        const questions = result.questions.map((q, idx) => ({
          task_id: task.id,
          student_id: currentStudent.id,
          content: q.content,
          options: q.options || [],
          answer: q.answer,
          analysis: q.analysis,
          question_type: q.question_type || 'choice',
          subject: q.subject,
          is_correct: q.is_correct,
          status: q.is_correct ? 'pending' : 'wrong',
          image_url: q.image_url,
          ai_tags: q.ai_tags || [],
          tags_source: 'ai'
        }))

        await createQuestions(questions)
        await saveRecognitionResult(task.id, result)
        updateTaskInStore(task.id, 'done', result)

        const wrongQuestions = questions.filter(q => !q.is_correct)
        if (wrongQuestions.length > 0) {
          await addWrongQuestions(currentStudent.id, wrongQuestions.map(q => q.id))
        }

        Toast.show({
          icon: 'success',
          content: `识别完成，共 ${questions.length} 道题，${wrongQuestions.length} 道错题`,
          duration: 2000
        })
      } else {
        updateTaskInStore(task.id, 'failed', { error: '未识别到题目' })
        Toast.show({
          icon: 'fail',
          content: '未识别到题目，请重新上传'
        })
      }
    } catch (error) {
      console.error('识别失败:', error)
      updateTaskInStore(task.id, 'failed', { error: error.message })
      Toast.show({
        icon: 'fail',
        content: '识别失败，请重试'
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

  // Filter pending questions
  const filteredQuestions = pendingQuestions.filter(q => {
    if (q.student_id !== currentStudent?.id) return false
    if (confirmFilter === 'all') return true
    return q.status === confirmFilter
  })

  // Filter wrong questions
  const isWithinTimeRange = (dateStr, timeKey) => {
    if (timeKey === 'all') return true
    const date = dayjs(dateStr)
    const now = dayjs()
    switch (timeKey) {
      case 'today': return date.isSame(now, 'day')
      case 'week': return date.isAfter(now.subtract(7, 'day'))
      case 'month': return date.isAfter(now.subtract(30, 'day'))
      case 'quarter': return date.isAfter(now.subtract(90, 'day'))
      default: return true
    }
  }

  const matchErrorCount = (count, filterKey) => {
    if (filterKey === 'all') return true
    switch (filterKey) {
      case '1': return count === 1
      case '2-3': return count >= 2 && count <= 3
      case '4-5': return count >= 4 && count <= 5
      case '5+': return count > 5
      default: return true
    }
  }

  const allAvailableTags = (() => {
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
    return Array.from(tagSet)
  })()

  const filteredWrongQuestions = wrongQuestions.filter(wq => {
    if (wq.student_id !== currentStudent?.id) return false
    if (bankFilter !== 'all' && wq.status !== bankFilter) return false
    if (selectedSubject !== 'all' && wq.subject !== selectedSubject) return false
    if (selectedTimeRange !== 'all' && !isWithinTimeRange(wq.added_at || wq.created_at, selectedTimeRange)) return false
    if (selectedErrorCount !== 'all' && !matchErrorCount(wq.error_count || 1, selectedErrorCount)) return false
    if (selectedTags.length > 0) {
      const question = wq.question || wq
      const qTags = question.tags_source === 'manual'
        ? (question.manual_tags || [])
        : (question.ai_tags || [])
      if (!selectedTags.some(t => qTags.includes(t))) return false
    }
    return true
  })

  // Filter generated exams
  const studentExams = generatedExams.filter(e => e.student_id === currentStudent?.id)
  const filteredExams = studentExams.filter(exam => {
    if (examFilter === 'all') return true
    return exam.status === examFilter
  })

  // Add student
  const handleAddStudent = async (studentData) => {
    try {
      const newStudent = await createStudent(studentData)
      addStudent(newStudent)
      setCurrentStudent(newStudent)
      setShowAddStudent(false)
      Toast.show({
        icon: 'success',
        content: '添加学生成功'
      })
    } catch (error) {
      console.error('添加学生失败:', error)
      Toast.show({
        icon: 'fail',
        content: '添加学生失败'
      })
    }
  }

  // Delete task
  const handleDeleteTask = async (taskId) => {
    try {
      setTasks(safeTasks.filter(t => t?.id !== taskId))
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

  // Confirm questions - 将选中的题目加入错题本
  const handleConfirmQuestions = async () => {
    try {
      // 将所有选中的题目（不管状态是wrong还是correct）都加入错题本
      const allSelectedIds = selectedConfirmIds

      if (allSelectedIds.length > 0) {
        await addWrongQuestions(currentStudent.id, allSelectedIds)
      }

      // 从待确认列表中移除已加入错题本的题目
      setPendingQuestions(pendingQuestions.filter(q => !selectedConfirmIds.includes(q.id)))
      setSelectedConfirmIds([])

      // 刷新缓存并重新加载数据
      invalidateCache('wrong', currentStudent.id)
      invalidateCache('pending', currentStudent.id)
      invalidateCache('tasks', currentStudent.id)
      loadPendingData(currentStudent.id, false)
      loadWrongBookData(currentStudent.id, false)

      Toast.show({
        icon: 'success',
        content: `已将 ${selectedConfirmIds.length} 题加入错题本`
      })
    } catch (error) {
      console.error('加入错题本失败:', error)
      Toast.show({
        icon: 'fail',
        content: '加入错题本失败'
      })
    }
  }

  // Generate exam - 组题打印，生成试卷ID并记录打印时间
  const handleGenerateExam = async () => {
    try {
      if (selectedQuestions.length === 0) {
        Toast.show({
          icon: 'fail',
          content: '请先选择错题'
        })
        return
      }

      // 生成试卷ID和打印标题
      const examId = `exam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const printTitle = `错题重练卷_${dayjs().format('YYYY-MM-DD HH:mm')}`

      const examData = {
        id: examId,
        student_id: currentStudent.id,
        name: printTitle,
        question_ids: selectedQuestions.map(q => q.question_id || q.id),
        status: 'ungraded',
        printed_at: new Date().toISOString(), // 记录打印时间
        created_at: new Date().toISOString()
      }

      const { createGeneratedExam } = await import('./services/supabaseService')
      const newExam = await createGeneratedExam(examData)
      setGeneratedExams([newExam, ...generatedExams])
      clearSelection()

      // 生成试卷后刷新缓存并重新加载数据
      invalidateCache('generated', currentStudent.id)
      loadGeneratedExams(false)

      Toast.show({
        icon: 'success',
        content: '组题打印成功'
      })
    } catch (error) {
      console.error('组题打印失败:', error)
      Toast.show({
        icon: 'fail',
        content: '组题打印失败'
      })
    }
  }

  // Print exam
  const handlePrintExam = (exam) => {
    setPrintTarget(exam)
    setShowPrintModal(true)
  }

  // Grade exam
  const handleGradeExam = (exam) => {
    setGradingExam(exam)
    setShowGrading(true)
  }

  // Reprint exam
  const handleReprintExam = (exam) => {
    setReprintExam(exam)
    setShowReprint(true)
  }

  // View exam detail
  const handleViewExamDetail = (exam) => {
    setSelectedExam(exam)
    setShowExamDetail(true)
    handlePrintExam(exam)
  }

  // Delete exam
  const handleDeleteExam = async (examId) => {
    try {
      await fetch(`${API_BASE}/generated-exams/${examId}`, {
        method: 'DELETE'
      })

      setGeneratedExams(generatedExams.filter(e => e.id !== examId))

      // 删除后刷新缓存并重新加载数据
      invalidateCache('generated', currentStudent.id)
      loadGeneratedExams(false)

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

  // View image
  const handleViewImage = (imageUrl) => {
    setPreviewImageUrl(imageUrl)
    setShowImagePreview(true)
  }

  // Edit question
  const handleEditQuestion = (question) => {
    setEditingQuestion(question)
  }

  // Save question edit
  const handleSaveQuestionEdit = async (questionId, updates) => {
    try {
      await updateQuestion(questionId, updates)
      setPendingQuestions(pendingQuestions.map(q =>
        q.id === questionId ? { ...q, ...updates } : q
      ))
      setEditingQuestion(null)
      Toast.show({
        icon: 'success',
        content: '保存成功'
      })
    } catch (error) {
      console.error('保存失败:', error)
      Toast.show({
        icon: 'fail',
        content: '保存失败'
      })
    }
  }

  // Manage tags
  const handleManageTags = (question) => {
    setManagingTagsQuestion(question)
    setShowTagManager(true)
  }

  // Save tags
  const handleSaveTags = async (questionId, tags) => {
    try {
      await updateQuestionTags(questionId, tags)
      setPendingQuestions(pendingQuestions.map(q =>
        q.id === questionId ? { ...q, manual_tags: tags, tags_source: 'manual' } : q
      ))
      setShowTagManager(false)
      Toast.show({
        icon: 'success',
        content: '标签更新成功'
      })
    } catch (error) {
      console.error('更新标签失败:', error)
      Toast.show({
        icon: 'fail',
        content: '更新标签失败'
      })
    }
  }

  // Show student QR
  const handleShowStudentQR = () => {
    if (!currentStudent) return
    setStudentQRData({
      id: currentStudent.id,
      name: currentStudent.name
    })
    setShowStudentQR(true)
  }

  // Show notifications
  const handleShowNotifications = () => {
    setShowNotifications(true)
  }

  // Mark notification as read
  const handleMarkNotificationRead = (notificationId) => {
    setNotifications(notifications.filter(n => n.id !== notificationId))
  }

  // Search
  const handleSearch = (query) => {
    setSearchQuery(query)
  }

  // Filter by search
  const searchFilteredTasks = filteredTasks.filter(t =>
    searchQuery === '' || t.original_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const searchFilteredQuestions = filteredQuestions.filter(q =>
    searchQuery === '' || q.content?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const searchFilteredWrongQuestions = filteredWrongQuestions.filter(wq => {
    const question = wq.question || wq
    return searchQuery === '' || question.content?.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const searchFilteredExams = filteredExams.filter(e =>
    searchQuery === '' || e.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const activePage = currentPage === 'home' ? 'processing' : currentPage
  const statusText = {
    pending: '待处理',
    processing: '处理中',
    done: '已完成',
    failed: '失败',
    ungraded: '未批改',
    graded: '已批改',
    mastered: '已掌握'
  }
  const statusClass = {
    pending: 'text-amber-500',
    processing: 'text-blue-600',
    done: 'text-emerald-600',
    failed: 'text-rose-500'
  }
  const displayTasks = searchFilteredTasks.length > 0 ? searchFilteredTasks : [
    { id: 'ui-task-1', original_name: '微信图片_20260428190806_488_...', status: 'done', created_at: '2026-04-29T09:18:00', result: { questionCount: 10 }, image_url: '' },
    { id: 'ui-task-2', original_name: '微信图片_20260402194621_22_1...', status: 'processing', created_at: '2026-04-29T09:13:00', result: { questionCount: 0 }, image_url: '' },
    { id: 'ui-task-3', original_name: '微信图片_20260401123033_7_2...', status: 'failed', created_at: '2026-04-29T08:52:00', result: { questionCount: 0 }, image_url: '' }
  ]
  const safePending = filteredQuestions.length > 0 ? filteredQuestions : [
    { id: 'ui-p-1', status: 'wrong', type: '解答题', content: '已知直线 l 与直线 y=2x+1 的交点的横坐标为 2，与直线 y=-x+2 的交点的纵坐标为 1，求直线 l 的函数表达式。' },
    { id: 'ui-p-2', status: 'correct', type: '选择题', content: '在等差数列 {an} 中，a1=2, a3=6，则公差 d 为多少？' },
    { id: 'ui-p-3', status: 'correct', type: '解答题', content: '请结合全文，分析文中“那一抹阳光”在情感表达上的作用。' },
    { id: 'ui-p-4', status: 'correct', type: '选择题', content: '关于重力，下列说法中正确的是？' }
  ]
  const safeWrong = filteredWrongQuestions.length > 0 ? filteredWrongQuestions : [
    { id: 'ui-w-1', subject: '数学', type: '解答题', content: '已知直线 l 与直线 y=2x+1 的交点的横坐标为 2，与直线 y=-x+2 的交点的纵坐标为 1，求直线 l 的函数表达式。', error_count: 1, status: 'pending', added_at: '2026-04-29' },
    { id: 'ui-w-2', subject: '物理', type: '选择题', content: '一个物体在水平力 F 的作用下静止在斜面上，若增大水平力 F 而物体仍保持静止，则物体受到的摩擦力如何变化？', error_count: 3, status: 'pending', added_at: '2026-04-25' },
    { id: 'ui-w-3', subject: '数学', type: '解答题', content: '已知函数 f(x)=ax²+bx+c 的图象过点(1,0)，且在 x=2 处取得极值。', error_count: 2, status: 'mastered', added_at: '2026-04-24' }
  ]
  const safeExams = searchFilteredExams.length > 0 ? searchFilteredExams : [
    { id: 'ui-e-1', name: '2026-04-29 数学错题重练卷', status: 'ungraded', created_at: '2026-04-29T09:18:00', question_ids: Array(10).fill(0) },
    { id: 'ui-e-2', name: '2026-04-25 期中复习错题集', status: 'ungraded', created_at: '2026-04-29T09:13:00', question_ids: Array(6).fill(0) },
    { id: 'ui-e-3', name: '2026-04-20 几何专题强化训练', status: 'graded', created_at: '2026-04-29T09:07:00', question_ids: Array(6).fill(0) },
    { id: 'ui-e-4', name: '2026-04-15 英语随堂测试卷', status: 'graded', created_at: '2026-04-29T08:33:00', question_ids: Array(12).fill(0) }
  ]
  const SegTabs = ({ tabs, value, onChange, compact = false }) => (
    <div className={`flex items-center gap-3 ${compact ? '' : 'px-5 pt-4'}`}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`h-9 px-4 rounded-full text-[13px] font-bold transition-all ${value === tab.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white text-slate-400'}`}
        >
          {tab.label} <span className={value === tab.id ? 'text-white' : 'text-slate-300'}>{tab.count}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen bg-white flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-[#F2F3F8] relative overflow-hidden flex flex-col shadow-2xl">
        <header className="h-[102px] bg-white px-5 pt-12 flex items-start justify-between shrink-0">
          <button onClick={() => setShowStudentSwitcher(true)} className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-black shadow-sm">诸</div>
            <div className="text-left">
              <div className="flex items-center gap-1 text-[15px] font-black text-slate-950 leading-tight">
                {currentStudent?.name || '诸葛亮'}
                <ChevronRight size={14} className="text-slate-300" />
              </div>
              <div className="text-[11px] font-medium text-slate-400 mt-0.5">{currentStudent?.grade || '高三·1班'}</div>
            </div>
          </button>
          <div className="flex items-center gap-5 pt-1 text-slate-400">
            <button onClick={() => setShowScanQR(true)} className="relative"><Maximize size={20} /></button>
            <button onClick={handleShowNotifications} className="relative">
              <Bell size={20} />
              <span className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">2</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar pb-28">
          <AnimatePresence mode="wait">
            {activePage === 'processing' && (
              <motion.div key="processing-ui" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <section className="px-5 pt-5">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => document.getElementById('file-input')?.click()}
                    className="w-full h-[246px] rounded-[2.25rem] bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700 text-white shadow-xl shadow-blue-200 flex flex-col items-center justify-center"
                  >
                    <div className="w-16 h-16 rounded-3xl bg-white/15 border border-white/25 flex items-center justify-center mb-5">
                      <Camera size={32} strokeWidth={2.5} />
                    </div>
                    <h1 className="text-[23px] font-black">拍照上传错题</h1>
                    <p className="text-[13px] text-white/65 mt-1">Qwen-VL 视觉大模型赋能</p>
                    <div className="mt-7 px-4 h-7 rounded-full bg-white/15 flex items-center gap-2 text-[11px] font-black">
                      <Sparkles size={13} fill="white" /> AI 智能识别已就绪
                    </div>
                  </motion.button>
                </section>
                <section className="px-5 pt-5">
                  <div className="h-10 bg-white rounded-full p-1 shadow-sm border border-slate-200 flex">
                    {[
                      ['all', '全部'],
                      ['processing', '处理中'],
                      ['done', '已完成'],
                      ['failed', '失败']
                    ].map(([id, label]) => (
                      <button key={id} onClick={() => setProcessingFilter(id)} className={`flex-1 rounded-full text-[13px] font-bold ${processingFilter === id ? 'bg-blue-50 text-blue-600 shadow-sm' : 'text-slate-400'}`}>{label}</button>
                    ))}
                  </div>
                </section>
                <section className="px-5 pt-5 space-y-3">
                  {filteredTasks.map(task => (
                    <div key={task.id} className="h-[90px] bg-white rounded-2xl shadow-sm border border-slate-200/80 px-4 flex items-center gap-3">
                      <button onClick={() => task.image_url && handleViewImage(task.image_url)} className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden shrink-0">
                        {task.image_url ? <img src={task.image_url} className="w-full h-full object-cover" /> : <ImageIcon size={22} className="m-auto mt-4 text-slate-300" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-3">
                          <h3 className="text-[14px] font-black text-slate-950 truncate">{task.original_name || '微信图片_20260428190806_488_...'}</h3>
                          <span className="text-[11px] font-bold text-slate-400 shrink-0">{dayjs(task.created_at).format('HH:mm')}</span>
                        </div>
                        <div className={`mt-2 flex items-center gap-1.5 text-[12px] font-bold ${statusClass[task.status] || 'text-slate-400'}`}>
                          {task.status === 'processing' ? <Loader2 size={13} className="animate-spin" /> : task.status === 'done' ? <CheckCircle2 size={13} /> : task.status === 'failed' ? <XCircle size={13} /> : <Loader2 size={13} />}
                          {statusText[task.status] || '待处理'} · {task.result?.questionCount || 0}题
                        </div>
                      </div>
                      {!String(task.id).startsWith('ui-') && (
                        <button
                          onClick={() => {
                            setDeleteTarget({ type: 'task', id: task.id })
                            setShowDeleteConfirm(true)
                          }}
                          className="p-2 -mr-2 text-slate-300 hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      <ChevronRight size={18} className="text-slate-200" />
                    </div>
                  ))}
                </section>
              </motion.div>
            )}

            {activePage === 'pending' && (
              <motion.div key="pending-ui" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <div className="flex items-center justify-between px-5 pt-4">
                  <SegTabs compact value={confirmFilter} onChange={setConfirmFilter} tabs={[
                    { id: 'all', label: '待核对', count: filteredQuestions.length },
                    { id: 'wrong', label: '疑似错题', count: filteredQuestions.filter(q => q.status === 'wrong').length },
                    { id: 'correct', label: '判定正确', count: filteredQuestions.filter(q => q.status === 'correct').length }
                  ]} />
                  <button onClick={() => {
                    const allIds = filteredQuestions.map(q => q.id)
                    if (selectedConfirmIds.length === allIds.length && allIds.length > 0) {
                      setSelectedConfirmIds([])
                    } else {
                      setSelectedConfirmIds(allIds)
                    }
                  }} className="w-12 h-8 rounded-full bg-white text-blue-600 text-[12px] font-black shadow-md">
                    {selectedConfirmIds.length === filteredQuestions.length && filteredQuestions.length > 0 ? '取消' : '全选'}
                  </button>
                </div>
                <section className="px-5 pt-5 space-y-4">
                  {filteredQuestions.map((q, idx) => (
                    <div key={q.id} className="bg-white rounded-[1.35rem] shadow-sm border border-slate-200/80 p-5 min-h-[135px]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[16px] italic font-black text-slate-200">#{idx + 1}</span>
                          <span className={`px-2 h-5 rounded-md text-[10px] font-black flex items-center ${q.status === 'wrong' ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
                            {q.status === 'wrong' ? '强似错题' : '判定正确'}
                          </span>
                          <span className="text-[11px] text-slate-400 font-bold">{q.type || '解答题'}</span>
                        </div>
                        <button onClick={() => setSelectedConfirmIds(prev => prev.includes(q.id) ? prev.filter(id => id !== q.id) : [...prev, q.id])} className={`w-6 h-6 rounded-full border-2 ${selectedConfirmIds.includes(q.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-100'}`} />
                      </div>
                      <p className="mt-4 text-[15px] leading-relaxed text-slate-900">{q.content}</p>
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-4">
                        <button onClick={() => q.image_url && handleViewImage(q.image_url)} className="flex items-center gap-1.5 text-[12px] font-bold text-slate-400">
                          <BookOpen size={14} /> 查看原图
                        </button>
                        <button onClick={() => handleEditQuestion(q)} className="flex items-center gap-1.5 text-[12px] font-bold text-blue-600">
                          <Edit3 size={14} /> 编辑
                        </button>
                        <button onClick={() => handleManageTags(q)} className="flex items-center gap-1.5 text-[12px] font-bold text-blue-600">
                          <Tag size={14} /> 标签
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
                {selectedConfirmIds.length > 0 && (
                  <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] w-[min(420px,calc(100vw-40px))] rounded-2xl bg-slate-950 text-white shadow-2xl px-4 py-3 flex items-center justify-between">
                    <span className="text-[13px] font-bold">已选 {selectedConfirmIds.length} 题</span>
                    <button onClick={handleConfirmQuestions} className="h-9 px-5 rounded-full bg-blue-600 text-[13px] font-black">确认入库</button>
                  </div>
                )}
              </motion.div>
            )}

            {activePage === 'wrongbook' && (
              <motion.div key="wrong-ui" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <SegTabs value={bankFilter} onChange={setBankFilter} tabs={[
                  { id: 'all', label: '全部', count: safeWrong.length },
                  { id: 'pending', label: '未掌握', count: safeWrong.filter(w => w.status !== 'mastered').length },
                  { id: 'mastered', label: '已掌握', count: safeWrong.filter(w => w.status === 'mastered').length }
                ]} />
                <div className="px-5 pt-4 flex items-center justify-between">
                  <div className="flex gap-2">
                    <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)} className="h-8 px-3 rounded-full bg-white shadow-sm text-[12px] font-bold text-slate-600 outline-none">
                      <option value="all">科目: 全部</option>
                      <option value="数学">数学</option>
                      <option value="语文">语文</option>
                      <option value="物理">物理</option>
                      <option value="化学">化学</option>
                    </select>
                    <select value={selectedTimeRange} onChange={(e) => setSelectedTimeRange(e.target.value)} className="h-8 px-3 rounded-full bg-white shadow-sm text-[12px] font-bold text-slate-600 outline-none">
                      <option value="all">时间: 全部</option>
                      <option value="today">今天</option>
                      <option value="week">7天内</option>
                      <option value="month">30天内</option>
                    </select>
                    <select value={selectedErrorCount} onChange={(e) => setSelectedErrorCount(e.target.value)} className="h-8 px-3 rounded-full bg-white shadow-sm text-[12px] font-bold text-slate-600 outline-none">
                      <option value="all">次数: 全部</option>
                      <option value="1">1次</option>
                      <option value="2-3">2-3次</option>
                      <option value="5+">5次以上</option>
                    </select>
                  </div>
                  <button onClick={() => {
                    const allFilteredIds = filteredWrongQuestions.map(wq => wq.id)
                    const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedQuestions.find(q => q.id === id))
                    if (allSelected) {
                      clearSelection()
                    } else {
                      filteredWrongQuestions.forEach(wq => {
                        if (!selectedQuestions.find(q => q.id === wq.id)) {
                          toggleSelection(wq)
                        }
                      })
                    }
                  }} className="w-12 h-8 rounded-full bg-white text-blue-600 text-[12px] font-black shadow-md flex-shrink-0">
                    {filteredWrongQuestions.length > 0 && filteredWrongQuestions.every(wq => selectedQuestions.find(q => q.id === wq.id)) ? '取消' : '全选'}
                  </button>
                </div>
                <section className="px-5 pt-5 space-y-4">
                  {filteredWrongQuestions.map(wq => {
                    const q = wq.question || wq
                    return (
                      <div key={wq.id} className="bg-white rounded-[1.35rem] shadow-sm border border-slate-200/80 p-5 min-h-[160px]">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 h-5 rounded-md bg-blue-50 text-blue-600 text-[11px] font-black">{q.subject || wq.subject || '数学'}</span>
                            <span className="text-[11px] text-slate-400 font-bold">{q.type || '解答题'}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-[12px] text-slate-300">{dayjs(wq.added_at || wq.created_at).format('YYYY-MM-DD')}</span>
                            <button onClick={() => toggleSelection(wq)} className={`w-6 h-6 rounded-full border-2 ${selectedQuestions.find(item => item.id === wq.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-100'}`} />
                          </div>
                        </div>
                        <p className="mt-4 text-[15px] leading-relaxed text-slate-900 line-clamp-2">{q.content}</p>
                        <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                          <span className="text-[12px] text-slate-400">错误次数: <b className="text-red-500">{wq.error_count || 1}次</b></span>
                          <span className={`px-2 h-5 rounded-md text-[11px] font-black ${wq.status === 'mastered' ? 'bg-emerald-50 text-emerald-500' : 'bg-red-50 text-red-500'}`}>{wq.status === 'mastered' ? '已掌握' : '未掌握'}</span>
                        </div>
                      </div>
                    )
                  })}
                </section>
                {selectedQuestions.length > 0 && (
                  <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] w-[min(420px,calc(100vw-40px))] rounded-2xl bg-slate-950 text-white shadow-2xl px-4 py-3 flex items-center justify-between">
                    <span className="text-[13px] font-bold">已选 {selectedQuestions.length} 题</span>
                    <div className="flex gap-2">
                      <button onClick={clearSelection} className="h-9 px-4 rounded-full bg-white/10 text-[13px] font-black">取消</button>
                      <button onClick={handleGenerateExam} className="h-9 px-5 rounded-full bg-blue-600 text-[13px] font-black">生成试卷</button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activePage === 'exam' && (
              <motion.div key="exam-ui" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <SegTabs value={examFilter} onChange={setExamFilter} tabs={[
                  { id: 'all', label: '全部', count: filteredExams.length },
                  { id: 'ungraded', label: '未批改', count: filteredExams.filter(e => e.status === 'ungraded').length },
                  { id: 'graded', label: '已批改', count: filteredExams.filter(e => e.status === 'graded').length }
                ]} />
                <section className="px-5 pt-5 space-y-3">
                  {filteredExams.map((exam, index) => (
                    <button key={exam.id} onClick={() => handleViewExamDetail(exam)} className={`w-full text-left bg-white rounded-2xl p-4 shadow-sm border-2 ${index === 0 ? 'border-blue-600' : 'border-transparent'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-black text-slate-950 truncate">{exam.name}</h3>
                          <div className="mt-2 flex items-center gap-4 text-[12px] font-bold text-slate-400">
                            <span>⌕ {dayjs(exam.created_at).format('YYYY-MM-DD HH:mm')}</span>
                            <span>题目: {exam.question_ids?.length || 0}</span>
                          </div>
                        </div>
                        <span className={`mt-1 w-6 h-6 rounded-full border-2 ${index === 0 ? 'border-blue-600 bg-blue-600' : 'border-slate-100'}`} />
                      </div>
                      <div className="mt-7 pt-4 border-t border-slate-100 flex items-center justify-between">
                        <span className={`px-3 h-6 rounded-full text-[11px] font-black tracking-wider ${exam.status === 'graded' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>{exam.status === 'graded' ? 'GRADED · 已批改' : 'PENDING · 未批改'}</span>
                        <div className="flex items-center gap-2">
                          <span onClick={(e) => { e.stopPropagation(); handlePrintExam(exam) }} className="h-9 px-5 rounded-full bg-slate-950 text-white text-[13px] font-black flex items-center gap-1.5"><Printer size={14} /> 打印</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <nav className="absolute bottom-0 left-0 right-0 h-[88px] bg-white/95 backdrop-blur-xl border-t border-slate-100 z-50">
          <div className="h-full grid grid-cols-4 px-3">
            {[
              { id: 'processing', icon: Camera, label: '处理' },
              { id: 'pending', icon: BookOpen, label: '待确认' },
              { id: 'wrongbook', icon: LayoutGrid, label: '错题本' },
              { id: 'exam', icon: FileText, label: '试卷' },
            ].map(tab => (
              <button key={tab.id} onClick={() => { setCurrentPage(tab.id); setSelectedConfirmIds([]); clearSelection() }} className="flex flex-col items-center justify-center gap-1.5">
                <tab.icon size={24} strokeWidth={activePage === tab.id ? 2.6 : 2.2} className={activePage === tab.id ? 'text-blue-600' : 'text-slate-300'} />
                <span className={`text-[11px] font-black ${activePage === tab.id ? 'text-blue-600' : 'text-slate-400'}`}>{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <AnimatePresence>
          {showSearch && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[100] bg-white">
              <div className="px-5 pt-12 pb-4 flex items-center gap-3 border-b border-slate-100">
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="搜索试卷、题目、错题"
                  className="flex-1 h-11 rounded-full bg-slate-100 px-4 text-[14px] outline-none"
                />
                <button onClick={() => setShowSearch(false)} className="text-[14px] font-bold text-blue-600">取消</button>
              </div>
              <div className="p-5 space-y-3 overflow-y-auto h-[calc(100%-104px)]">
                {[...searchFilteredTasks.map(item => ({ type: '任务', title: item.original_name, sub: statusText[item.status] || item.status })),
                  ...searchFilteredQuestions.map(item => ({ type: '待确认', title: item.content, sub: item.type })),
                  ...searchFilteredWrongQuestions.map(item => ({ type: '错题', title: (item.question || item).content, sub: `${item.error_count || 1}次` })),
                  ...searchFilteredExams.map(item => ({ type: '试卷', title: item.name, sub: statusText[item.status] || item.status }))
                ].map((item, idx) => (
                  <div key={idx} className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] font-black text-blue-600">{item.type}</div>
                    <div className="mt-1 text-[14px] font-bold text-slate-900 line-clamp-2">{item.title}</div>
                    <div className="mt-1 text-[12px] text-slate-400">{item.sub}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {showNotifications && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[100] bg-black/30 flex items-end">
              <motion.div initial={{ y: 220 }} animate={{ y: 0 }} exit={{ y: 220 }} className="w-full rounded-t-[2rem] bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[18px] font-black">通知</h3>
                  <button onClick={() => setShowNotifications(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"><X size={16} /></button>
                </div>
                {(notifications.length ? notifications : [
                  { id: 'n1', title: '识别完成', message: '有新的试卷已完成错题识别' },
                  { id: 'n2', title: '待核对提醒', message: '请确认疑似错题后加入错题本' }
                ]).map(n => (
                  <button key={n.id} onClick={() => handleMarkNotificationRead(n.id)} className="w-full text-left rounded-2xl bg-slate-50 p-4 mb-3">
                    <div className="text-[14px] font-black text-slate-900">{n.title}</div>
                    <div className="text-[12px] text-slate-500 mt-1">{n.message}</div>
                  </button>
                ))}
              </motion.div>
            </motion.div>
          )}

          {showImagePreview && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[110] bg-black flex items-center justify-center">
              <button onClick={() => setShowImagePreview(false)} className="absolute top-12 right-5 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center"><X size={20} /></button>
              {previewImageUrl ? <img src={previewImageUrl} className="max-w-full max-h-full object-contain" /> : <ImageIcon size={56} className="text-white/40" />}
            </motion.div>
          )}

          {showTagManager && managingTagsQuestion && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[105] bg-black/30 flex items-end">
              <motion.div initial={{ y: 260 }} animate={{ y: 0 }} exit={{ y: 260 }} className="w-full rounded-t-[2rem] bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[18px] font-black">标签管理</h3>
                  <button onClick={() => setShowTagManager(false)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"><X size={16} /></button>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {((managingTagsQuestion.manual_tags || managingTagsQuestion.ai_tags || [])).map(tag => (
                    <span key={tag} className="px-3 h-8 rounded-full bg-blue-50 text-blue-600 text-[12px] font-bold flex items-center">{tag}</span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={newTagInput} onChange={(e) => setNewTagInput(e.target.value)} placeholder="新增标签" className="flex-1 h-11 rounded-full bg-slate-100 px-4 outline-none text-[14px]" />
                  <button
                    onClick={() => {
                      const oldTags = managingTagsQuestion.manual_tags || managingTagsQuestion.ai_tags || []
                      const next = newTagInput.trim() ? [...oldTags, newTagInput.trim()] : oldTags
                      handleSaveTags(managingTagsQuestion.id, next)
                      setNewTagInput('')
                    }}
                    className="h-11 px-5 rounded-full bg-blue-600 text-white text-[13px] font-black"
                  >
                    保存
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {showDeleteConfirm && deleteTarget && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[105] bg-black/30 flex items-center justify-center p-8">
              <div className="w-full rounded-3xl bg-white p-5 text-center">
                <h3 className="text-[18px] font-black">确认删除</h3>
                <p className="text-[13px] text-slate-500 mt-2">删除后将从当前列表移除。</p>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 h-11 rounded-full bg-slate-100 text-slate-600 font-black">取消</button>
                  <button
                    onClick={() => {
                      if (deleteTarget.type === 'task') handleDeleteTask(deleteTarget.id)
                      if (deleteTarget.type === 'exam') handleDeleteExam(deleteTarget.id)
                      setShowDeleteConfirm(false)
                    }}
                    className="flex-1 h-11 rounded-full bg-red-500 text-white font-black"
                  >
                    删除
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {showExamDetail && selectedExam && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[105] bg-[#F2F3F8]">
              <div className="px-5 pt-12 pb-4 bg-white flex items-center justify-between">
                <button onClick={() => setShowExamDetail(false)} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X size={18} /></button>
                <h3 className="text-[16px] font-black">试卷详情</h3>
                <button onClick={() => { setDeleteTarget({ type: 'exam', id: selectedExam.id }); setShowDeleteConfirm(true) }} className="w-9 h-9 rounded-full bg-red-50 text-red-500 flex items-center justify-center"><Trash2 size={17} /></button>
              </div>
              <div className="p-5">
                <div className="rounded-2xl bg-white p-5 shadow-sm">
                  <h2 className="text-[18px] font-black text-slate-950">{selectedExam.name}</h2>
                  <p className="text-[13px] text-slate-400 mt-2">{dayjs(selectedExam.created_at).format('YYYY-MM-DD HH:mm')} · 题目 {selectedExam.question_ids?.length || 0}</p>
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    <button onClick={() => handleGradeExam(selectedExam)} className="h-11 rounded-full bg-blue-600 text-white font-black">开始批改</button>
                    <button onClick={() => handlePrintExam(selectedExam)} className="h-11 rounded-full bg-slate-950 text-white font-black">打印试卷</button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {showPrintModal && printTarget && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[110] bg-white flex flex-col">
              <div className="px-5 pt-12 pb-4 border-b border-slate-100 flex items-center justify-between">
                <button onClick={() => setShowPrintModal(false)} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center"><X size={18} /></button>
                <h3 className="text-[16px] font-black">打印预览</h3>
                <button onClick={() => window.print()} className="h-9 px-4 rounded-full bg-blue-600 text-white text-[13px] font-black">打印</button>
              </div>
              <div className="flex-1 overflow-y-auto bg-slate-100 p-5">
                <div className="min-h-[620px] bg-white shadow-xl p-8 text-slate-950">
                  <h1 className="text-center text-[24px] font-black tracking-widest">错题巩固强化训练卷</h1>
                  <div className="mt-6 pb-5 border-b-2 border-slate-900 text-center text-[13px] text-slate-500">{printTarget.name}</div>
                  <div className="mt-8 space-y-6">
                    {(reprintQuestions.length ? reprintQuestions : safeWrong.slice(0, 5)).map((item, idx) => {
                      const q = item.question || item
                      return <div key={idx} className="text-[15px] leading-relaxed">{idx + 1}. {q.content || '错题内容'}</div>
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {showScanQR && (
            <ScanQR
              onClose={() => setShowScanQR(false)}
              onScanSuccess={(data) => {
                setShowScanQR(false)
                setGradingExam(data)
                setShowGrading(true)
              }}
            />
          )}

          {showGrading && (
            <Grading
              paperId={gradingExam?.id || gradingExam?.paperId}
              studentId={currentStudent?.id || gradingExam?.studentId}
              onClose={() => setShowGrading(false)}
              onComplete={() => {
                setShowGrading(false)
                loadGeneratedExams(currentStudent?.id, false)
              }}
            />
          )}
        </AnimatePresence>

        <QuestionEditDrawer
          visible={!!editingQuestion}
          questionId={editingQuestion?.id}
          onClose={() => setEditingQuestion(null)}
          onSave={handleSaveQuestionEdit}
        />

        <StudentSwitcher visible={showStudentSwitcher} onClose={() => setShowStudentSwitcher(false)} />
        <input type="file" id="file-input" multiple accept="image/*" className="hidden" onChange={handleFileSelect} />
      </div>
    </div>
  )
}
   
 