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
  Tag
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
  const { wrongQuestions, setWrongQuestions, selectedQuestions, setSelectedQuestions, clearSelection, addWrongQuestion, addWrongQuestions: addMultipleToStore, loading: wrongLoading, initialized: wrongInitialized } = useWrongQuestionStore()
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

  // Toast (将在组件渲染后使用)

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

  // 页面数据加载 - 使用SWR模式
  const loadTasks = useCallback(async (studentId, showLoading = true) => {
    if (!studentId) return
    if (showLoading) useTaskStore.getState().setLoading(true)

    try {
      const result = await apiService.swrFetch(
        `tasks_${studentId}`,
        () => getTasksByStudent(studentId, false),
        {
          maxAge: 10 * 60 * 1000,
          onUpdate: (fresh) => {
            setTasks(fresh)
          }
        }
      )
      setTasks(Array.isArray(result.data) ? result.data : [])
    } catch (error) {
      console.error('加载任务失败:', error)
      setTasks([])
    } finally {
      if (showLoading) useTaskStore.getState().setLoading(false)
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

  // 页面切换时加载数据 + 预加载
  useEffect(() => {
    if (!currentStudent) return

    const studentId = currentStudent.id

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
        const interval = setInterval(() => loadGeneratedExams(studentId, false), 3000)
        return () => clearInterval(interval)
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

    // 上传完成后刷新缓存并重新加载列表
    if (successCount > 0) {
      invalidateCache('tasks', currentStudent.id)
      loadTasks()
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
  const filteredTasks = tasks.filter(t => {
    if (t.student_id !== currentStudent?.id) return false
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
      setTasks(tasks.filter(t => t.id !== taskId))
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

  // Confirm questions
  const handleConfirmQuestions = async () => {
    try {
      const wrongIds = selectedConfirmIds.filter(id => {
        const q = pendingQuestions.find(pq => pq.id === id)
        return q && q.status === 'wrong'
      })

      if (wrongIds.length > 0) {
        await addWrongQuestions(currentStudent.id, wrongIds)
      }

      setPendingQuestions(pendingQuestions.filter(q => !selectedConfirmIds.includes(q.id)))
      setSelectedConfirmIds([])

      // 确认后刷新缓存并重新加载数据
      invalidateCache('wrong', currentStudent.id)
      invalidateCache('tasks', currentStudent.id)
      loadPendingData()
      loadWrongBookData()

      Toast.show({
        icon: 'success',
        content: `已确认 ${selectedConfirmIds.length} 道题`
      })
    } catch (error) {
      console.error('确认失败:', error)
      Toast.show({
        icon: 'fail',
        content: '确认失败'
      })
    }
  }

  // Generate exam
  const handleGenerateExam = async () => {
    try {
      const selectedWrongQuestions = wrongQuestions.filter(wq => selectedQuestions.includes(wq.id))
      if (selectedWrongQuestions.length === 0) {
        Toast.show({
          icon: 'fail',
          content: '请先选择错题'
        })
        return
      }

      const examData = {
        student_id: currentStudent.id,
        name: `错题重练卷_${dayjs().format('MM-DD')}`,
        question_ids: selectedWrongQuestions.map(wq => wq.question_id || wq.id)
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
        content: '生成试卷成功'
      })
    } catch (error) {
      console.error('生成试卷失败:', error)
      Toast.show({
        icon: 'fail',
        content: '生成试卷失败'
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
  }

  // Delete exam
  const handleDeleteExam = async (examId) => {
    try {
      setGeneratedExams(generatedExams.filter(e => e.id !== examId))
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

  // Render
  return (
    <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
          <div className="max-w-lg mx-auto px-5 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowStudentSwitcher(true)}
                className="flex items-center gap-2 text-gray-900"
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <User size={16} className="text-blue-600" />
                </div>
                <span className="text-[15px] font-bold">{currentStudent?.name || '选择学生'}</span>
                <ChevronDown size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSearch(true)}
                className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center"
              >
                <Search size={18} className="text-gray-600" />
              </button>
              <button
                onClick={handleShowNotifications}
                className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center relative"
              >
                <Bell size={18} className="text-gray-600" />
                {notifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-lg mx-auto pb-24">
          <AnimatePresence mode="wait">
            {currentPage === 'home' && (
              <motion.div
                key="home-page"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="w-full"
              >
                <Home onNavigate={setCurrentPage} />
              </motion.div>
            )}

            {currentPage === 'processing' && (
              <motion.div
                key="processing-page"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="w-full"
              >
                {/* Filter Tabs */}
                <section className="px-5 pt-4 mb-3 overflow-x-auto no-scrollbar">
                  <div className="flex gap-2 min-w-max">
                    {[
                      { id: 'all', label: '全部', count: filteredTasks.length },
                      { id: 'pending', label: '待处理', count: filteredTasks.filter(t => t.status === 'pending').length },
                      { id: 'processing', label: '处理中', count: filteredTasks.filter(t => t.status === 'processing').length },
                      { id: 'done', label: '已完成', count: filteredTasks.filter(t => t.status === 'done').length },
                      { id: 'failed', label: '失败', count: filteredTasks.filter(t => t.status === 'failed').length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setProcessingFilter(filter.id)}
                        className={`px-5 py-2.5 rounded-full text-[13px] font-bold flex items-center gap-2 transition-all ${
                          processingFilter === filter.id
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-gray-100/80 text-gray-400'
                        }`}
                      >
                        {filter.label}
                        <span className={`text-[11px] font-medium ${
                          processingFilter === filter.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Task List - 骨架屏/内容 */}
                <section className="px-5 space-y-3">
                  {tasksLoading && !tasksInitialized ? (
                    <ProcessingSkeleton />
                  ) : searchFilteredTasks.length === 0 ? (
                    <div className="text-center py-20">
                      <Camera size={48} className="mx-auto text-gray-200 mb-4" />
                      <p className="text-gray-400 text-[15px]">暂无任务</p>
                      <p className="text-gray-300 text-[13px] mt-1">点击右下角按钮上传试卷</p>
                    </div>
                  ) : (
                    searchFilteredTasks.map((task) => (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
                      >
                        <div className="flex gap-3">
                          <div
                            className="w-20 h-20 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden cursor-pointer"
                            onClick={() => handleViewImage(task.image_url)}
                          >
                            {task.image_url ? (
                              <img src={task.image_url} alt="试卷" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon size={24} className="text-gray-300" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <h3 className="text-[14px] font-bold text-gray-900 truncate">
                                {task.original_name || '未命名试卷'}
                              </h3>
                              <button
                                onClick={() => {
                                  setDeleteTarget({ type: 'task', id: task.id })
                                  setShowDeleteConfirm(true)
                                }}
                                className="text-gray-300 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <p className="text-[12px] text-gray-400 mt-1">
                              {dayjs(task.created_at).format('MM-DD HH:mm')}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              {task.status === 'pending' && (
                                <span className="px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-600 text-[11px] font-bold">
                                  待处理
                                </span>
                              )}
                              {task.status === 'processing' && (
                                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[11px] font-bold flex items-center gap-1">
                                  <Loader2 size={10} className="animate-spin" />
                                  处理中
                                </span>
                              )}
                              {task.status === 'done' && (
                                <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-600 text-[11px] font-bold">
                                  已完成
                                </span>
                              )}
                              {task.status === 'failed' && (
                                <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-600 text-[11px] font-bold">
                                  失败
                                </span>
                              )}
                              {task.result?.questionCount && (
                                <span className="text-[11px] text-gray-400">
                                  {task.result.questionCount} 道题
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </section>
              </motion.div>
            )}

            {currentPage === 'pending' && (
              <motion.div
                key="confirm-page"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full"
              >
                {/* Segmented Filters */}
                <section className="px-5 pt-4 mb-3 overflow-x-auto no-scrollbar">
                  <div className="flex gap-2 min-w-max">
                    {[
                      { id: 'all', label: '全部待确认', count: pendingQuestions.filter(q => q.status === 'wrong' || q.status === 'correct' || q.isSuspicious).length },
                      { id: 'wrong', label: '疑似错题', count: pendingQuestions.filter(q => q.status === 'wrong').length },
                      { id: 'correct', label: '识别正确', count: pendingQuestions.filter(q => q.status === 'correct' && !q.isSuspicious).length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setConfirmFilter(filter.id)}
                        className={`px-5 py-2.5 rounded-full text-[13px] font-bold flex items-center gap-2 transition-all ${
                          confirmFilter === filter.id
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-gray-100/80 text-gray-400'
                        }`}
                      >
                        {filter.label}
                        <span className={`text-[11px] font-medium ${
                          confirmFilter === filter.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Select All Bar */}
                {filteredQuestions.length > 0 && (
                  <section className="px-5 mb-4">
                    <button
                      onClick={() => {
                        const allFilteredIds = filteredQuestions.map(q => q.id)
                        const allSelected = allFilteredIds.every(id => selectedConfirmIds.includes(id))
                        if (allSelected) {
                          setSelectedConfirmIds([])
                        } else {
                          setSelectedConfirmIds(allFilteredIds)
                        }
                      }}
                      className="flex items-center gap-2 text-[12px] font-bold text-gray-400 hover:text-blue-600 transition-colors"
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                        filteredQuestions.every(q => selectedConfirmIds.includes(q.id))
                        ? 'bg-blue-600 border-blue-600'
                        : 'border-gray-300'
                      }`}>
                        {filteredQuestions.every(q => selectedConfirmIds.includes(q.id)) && (
                          <CheckCircle2 size={14} className="text-white" />
                        )}
                      </div>
                      <span>{filteredQuestions.every(q => selectedConfirmIds.includes(q.id)) ? '取消全选' : '全选'}</span>
                      <span className="text-gray-300">({filteredQuestions.length}题)</span>
                    </button>
                  </section>
                )}

                {/* Question List */}
                <section className="px-5 space-y-3">
                  {pendingLoading && !pendingInitialized ? (
                    <PendingSkeleton />
                  ) : filteredQuestions.length === 0 ? (
                    <div className="text-center py-20">
                      <BookOpen size={48} className="mx-auto text-gray-200 mb-4" />
                      <p className="text-gray-400 text-[15px]">暂无待确认题目</p>
                      <p className="text-gray-300 text-[13px] mt-1">上传试卷后会自动识别题目</p>
                    </div>
                  ) : (
                    filteredQuestions.map((q, idx) => (
                      <motion.div
                        key={q.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
                      >
                        <div className="flex gap-3">
                          <button
                            onClick={() => {
                              if (selectedConfirmIds.includes(q.id)) {
                                setSelectedConfirmIds(selectedConfirmIds.filter(id => id !== q.id))
                              } else {
                                setSelectedConfirmIds([...selectedConfirmIds, q.id])
                              }
                            }}
                            className="flex-shrink-0 mt-1"
                          >
                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                              selectedConfirmIds.includes(q.id)
                              ? 'bg-blue-600 border-blue-600'
                              : 'border-gray-300'
                            }`}>
                              {selectedConfirmIds.includes(q.id) && (
                                <CheckCircle2 size={14} className="text-white" />
                              )}
                            </div>
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <span className="text-[12px] text-gray-400 font-medium">第 {idx + 1} 题</span>
                              <div className="flex items-center gap-2">
                                {q.status === 'wrong' && (
                                  <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">
                                    疑似错题
                                  </span>
                                )}
                                {q.status === 'correct' && (
                                  <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-600 text-[10px] font-bold">
                                    识别正确
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-[14px] text-gray-900 mt-2 leading-relaxed">
                              {q.content}
                            </p>
                            {q.options && q.options.length > 0 && (
                              <div className="mt-3 space-y-1.5">
                                {q.options.map((opt, optIdx) => (
                                  <div
                                    key={optIdx}
                                    className={`text-[13px] py-2 px-3 rounded-lg ${
                                      opt === q.answer
                                      ? 'bg-green-50 text-green-700 font-medium'
                                      : 'bg-gray-50 text-gray-600'
                                    }`}
                                  >
                                    {opt}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-3 mt-3">
                              <button
                                onClick={() => handleEditQuestion(q)}
                                className="text-[12px] text-blue-600 font-medium hover:text-blue-700"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => handleManageTags(q)}
                                className="text-[12px] text-blue-600 font-medium hover:text-blue-700 flex items-center gap-1"
                              >
                                <Tag size={12} />
                                标签
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </section>
              </motion.div>
            )}

            {currentPage === 'wrongbook' && (
              <motion.div
                key="bank-page"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full"
              >
                {/* Filter Tabs */}
                <section className="px-5 pt-4 mb-3 overflow-x-auto no-scrollbar">
                  <div className="flex gap-2 min-w-max">
                    {[
                      { id: 'pending', label: '待复习', count: wrongQuestions.filter(wq => wq.status === 'pending').length },
                      { id: 'mastered', label: '已掌握', count: wrongQuestions.filter(wq => wq.status === 'mastered').length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setBankFilter(filter.id)}
                        className={`px-5 py-2.5 rounded-full text-[13px] font-bold flex items-center gap-2 transition-all ${
                          bankFilter === filter.id
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-gray-100/80 text-gray-400'
                        }`}
                      >
                        {filter.label}
                        <span className={`text-[11px] font-medium ${
                          bankFilter === filter.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Advanced Filters */}
                <section className="px-5 mb-4">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    <button
                      onClick={() => setShowSubjectFilter(!showSubjectFilter)}
                      className={`px-4 py-2 rounded-full text-[12px] font-bold flex items-center gap-1 transition-all ${
                        selectedSubject !== 'all'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      科目
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={() => setShowTimeFilter(!showTimeFilter)}
                      className={`px-4 py-2 rounded-full text-[12px] font-bold flex items-center gap-1 transition-all ${
                        selectedTimeRange !== 'all'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      时间
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={() => setShowErrorFilter(!showErrorFilter)}
                      className={`px-4 py-2 rounded-full text-[12px] font-bold flex items-center gap-1 transition-all ${
                        selectedErrorCount !== 'all'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      错次
                      <ChevronDown size={12} />
                    </button>
                    <button
                      onClick={() => setShowTagFilter(!showTagFilter)}
                      className={`px-4 py-2 rounded-full text-[12px] font-bold flex items-center gap-1 transition-all ${
                        selectedTags.length > 0
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      标签
                      <ChevronDown size={12} />
                    </button>
                  </div>
                </section>

                {/* Wrong Question List */}
                <section className="px-5 space-y-3">
                  {wrongLoading && !wrongInitialized ? (
                    <WrongBookSkeleton />
                  ) : filteredWrongQuestions.length === 0 ? (
                    <div className="text-center py-20">
                      <LayoutGrid size={48} className="mx-auto text-gray-200 mb-4" />
                      <p className="text-gray-400 text-[15px]">暂无错题</p>
                      <p className="text-gray-300 text-[13px] mt-1">在待确认页面标记错题后会自动收录</p>
                    </div>
                  ) : (
                    filteredWrongQuestions.map((wq) => (
                      <motion.div
                        key={wq.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
                      >
                        <div className="flex gap-3">
                          <button
                            onClick={() => toggleSelection(wq)}
                            className="flex-shrink-0 mt-1"
                          >
                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                              selectedQuestions.find(q => q.id === wq.id)
                              ? 'bg-blue-600 border-blue-600'
                              : 'border-gray-300'
                            }`}>
                              {selectedQuestions.find(q => q.id === wq.id) && (
                                <CheckCircle2 size={14} className="text-white" />
                              )}
                            </div>
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-gray-400 font-medium">错题</span>
                                {wq.error_count > 1 && (
                                  <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">
                                    错 {wq.error_count} 次
                                  </span>
                                )}
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                wq.status === 'pending'
                                ? 'bg-yellow-50 text-yellow-600'
                                : 'bg-green-50 text-green-600'
                              }`}>
                                {wq.status === 'pending' ? '待复习' : '已掌握'}
                              </span>
                            </div>
                            <p className="text-[14px] text-gray-900 mt-2 leading-relaxed">
                              {(wq.question || wq).content}
                            </p>
                            <div className="flex items-center gap-3 mt-3">
                              <span className="text-[12px] text-gray-400">
                                {dayjs(wq.added_at || wq.created_at).format('MM-DD')}
                              </span>
                              <button
                                onClick={() => handleManageTags(wq)}
                                className="text-[12px] text-blue-600 font-medium hover:text-blue-700 flex items-center gap-1"
                              >
                                <Tag size={12} />
                                标签
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </section>
              </motion.div>
            )}

            {currentPage === 'exam' && (
              <motion.div
                key="exam-page"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="w-full"
              >
                {/* Filter Tabs */}
                <section className="px-5 pt-4 mb-3 overflow-x-auto no-scrollbar">
                  <div className="flex gap-2 min-w-max">
                    {[
                      { id: 'all', label: '全部', count: filteredExams.length },
                      { id: 'ungraded', label: '未批改', count: filteredExams.filter(e => e.status === 'ungraded').length },
                      { id: 'graded', label: '已批改', count: filteredExams.filter(e => e.status === 'graded').length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setExamFilter(filter.id)}
                        className={`px-5 py-2.5 rounded-full text-[13px] font-bold flex items-center gap-2 transition-all ${
                          examFilter === filter.id
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-gray-100/80 text-gray-400'
                        }`}
                      >
                        {filter.label}
                        <span className={`text-[11px] font-medium ${
                          examFilter === filter.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Exam List */}
                <section className="px-5 space-y-3">
                  {examLoading && !examInitialized ? (
                    <ExamSkeleton />
                  ) : filteredExams.length === 0 ? (
                    <div className="text-center py-20">
                      <FileText size={48} className="mx-auto text-gray-200 mb-4" />
                      <p className="text-gray-400 text-[15px]">暂无试卷</p>
                      <p className="text-gray-300 text-[13px] mt-1">在错题本选择题目生成试卷</p>
                    </div>
                  ) : (
                    filteredExams.map((exam) => (
                      <motion.div
                        key={exam.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-[14px] font-bold text-gray-900">{exam.name}</h3>
                            <p className="text-[12px] text-gray-400 mt-1">
                              {dayjs(exam.created_at).format('MM-DD HH:mm')} · {exam.question_ids?.length || 0} 道题
                            </p>
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            exam.status === 'ungraded'
                            ? 'bg-yellow-50 text-yellow-600'
                            : 'bg-green-50 text-green-600'
                          }`}>
                            {exam.status === 'ungraded' ? '未批改' : '已批改'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-4">
                          <button
                            onClick={() => handleViewExamDetail(exam)}
                            className="flex-1 py-2.5 rounded-xl bg-blue-50 text-blue-600 text-[13px] font-bold hover:bg-blue-100 transition-colors"
                          >
                            查看详情
                          </button>
                          <button
                            onClick={() => handlePrintExam(exam)}
                            className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[13px] font-bold hover:bg-gray-200 transition-colors flex items-center justify-center gap-1"
                          >
                            <Printer size={14} />
                            打印
                          </button>
                        </div>
                      </motion.div>
                    ))
                  )}
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 z-50">
          <div className="max-w-lg mx-auto px-6 h-16 flex items-center justify-around">
            {[
              { id: 'home', icon: Camera, label: '首页' },
              { id: 'processing', icon: Camera, label: '处理' },
              { id: 'pending', icon: BookOpen, label: '待确认' },
              { id: 'wrongbook', icon: LayoutGrid, label: '错题本' },
              { id: 'exam', icon: FileText, label: '试卷' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setCurrentPage(tab.id); setSelectedConfirmIds([]); clearSelection() }}
                onMouseEnter={() => preloadEngine.hoverPreload(tab.id, currentStudent?.id)}
                onMouseLeave={() => preloadEngine.cancelHoverPreload()}
                onTouchStart={() => preloadEngine.hoverPreload(tab.id, currentStudent?.id)}
                className="flex flex-col items-center gap-1.5 transition-all group relative"
              >
                <tab.icon
                  size={22}
                  strokeWidth={currentPage === tab.id ? 2.5 : 2}
                  className={currentPage === tab.id ? 'text-blue-600' : 'text-gray-300'}
                />
                <span className={`text-[10px] font-bold tracking-[0.05em] uppercase ${currentPage === tab.id ? 'text-blue-600' : 'text-gray-400'}`}>
                  {tab.label}
                </span>
                {currentPage === tab.id && (
                  <motion.div layoutId="nav-pill" className="absolute -top-1 w-1 h-1 bg-blue-600 rounded-full" />
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* Student Sheet */}
        <StudentSwitcher
          visible={showStudentSwitcher}
          onClose={() => setShowStudentSwitcher(false)}
        />

        {/* Floating Action Button */}
        {currentPage === 'processing' && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => document.getElementById('file-input').click()}
            className="fixed right-5 bottom-20 w-14 h-14 bg-blue-600 rounded-full shadow-lg shadow-blue-200 flex items-center justify-center z-50"
          >
            <Plus size={24} className="text-white" />
          </motion.button>
        )}

        {/* Hidden File Input */}
        <input
          type="file"
          id="file-input"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Modals */}
      </div>
  )
}