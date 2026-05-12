import { useEffect, useState, useRef } from 'react'
import {
  Camera,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
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
import { useUIStore, useStudentStore, useTaskStore, useWrongQuestionStore, useExamStore } from './store'
import { getStudents, getTasksByStudent, getQuestionsByTask, addWrongQuestions, getWrongQuestionsByStudent, getExamsByStudent, createTask, updateTaskStatus, uploadImage, updateQuestion, updateQuestionTags, invalidateCache, createStudent, updateWrongQuestionStatus, getQuestionsByIds } from './services/apiService'
import { taskService } from './services/taskService'
import { recognizeQuestions, compressImage, saveRecognitionResult } from './services/aiService'
import { mockQuestions, mockTasks, mockWrongQuestions, mockGeneratedExams, mockStudents } from './data/mockData'
import StudentSwitcher from './components/StudentSwitcher'

import ScanQR from './pages/ScanQR'
import Grading from './pages/Grading'
import PrintPreview from './pages/PrintPreview'
import ExamReview from './pages/ExamReview'
import { useToast, ToastProvider } from './components/ToastProvider'
import dayjs from 'dayjs'
import jsPDF from 'jspdf'

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

// ==================== Main App ====================

const USE_MOCK_DATA = false

export default function App() {
  // Store hooks
  const { currentPage, setCurrentPage } = useUIStore()
  const { students, currentStudent, setCurrentStudent, setStudents, addStudent } = useStudentStore()
  const { tasks, setTasks, addTask, updateTaskStatus: updateTaskInStore } = useTaskStore()
  const { wrongQuestions, setWrongQuestions, selectedQuestions, setSelectedQuestions, clearSelection, addWrongQuestion, addWrongQuestions: addMultipleToStore } = useWrongQuestionStore()
  const { exams, setExams, generatedExams, setGeneratedExams } = useExamStore()

  // Processing Page State
  const [processingFilter, setProcessingFilter] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)

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
  const [showQuestionEditor, setShowQuestionEditor] = useState(false)
  const [editingQuestionItem, setEditingQuestionItem] = useState(null)
  const [editTab, setEditTab] = useState('stem')
  const [editForm, setEditForm] = useState({ content: '', options: [], answer: '', analysis: '', image_url: '', student_answer: '', question_type: 'choice' })
  const [editTags, setEditTags] = useState([])
  const [editNewTag, setEditNewTag] = useState('')
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
  const [selectedImage, setSelectedImage] = useState(null)
  const [showImageViewer, setShowImageViewer] = useState(false)
  const [showExamReview, setShowExamReview] = useState(false)
  const [reviewTask, setReviewTask] = useState(null)

  // Toast
  const Toast = useToast()

  // Initialize students
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
        const studentList = await getStudents()
        const safeStudentList = Array.isArray(studentList) ? studentList : []
        setStudents(safeStudentList)
        if (safeStudentList.length > 0 && !currentStudent) {
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

  // Clear data when student changes
  useEffect(() => {
    setTasks([])
    setWrongQuestions([])
    setGeneratedExams([])
    setExams([])
  }, [currentStudent?.id])

  // Load tasks when student changes
  useEffect(() => {
    if (currentStudent && currentPage === 'processing') {
      loadTasks()
    }
  }, [currentStudent?.id, currentPage])


  // Load wrong questions
  useEffect(() => {
    if (currentStudent && currentPage === 'wrongbook') {
      loadWrongBookData()
    }
  }, [currentStudent?.id, currentPage])

  // Load exams
  useEffect(() => {
    if (currentStudent && currentPage === 'exam') {
      loadGeneratedExams(false)
      const interval = setInterval(() => loadGeneratedExams(false), 3000)
      return () => clearInterval(interval)
    }
  }, [currentStudent?.id, currentPage])

  // Load questions for reprint
  useEffect(() => {
    if (reprintExam && reprintExam.question_ids?.length > 0) {
      const loadReprintQuestions = async () => {
        try {
          const { getQuestionsByIds } = await import('./services/apiService')
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

  // Processing: Load tasks
  const loadTasks = async () => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) {
        const filteredMockTasks = mockTasks.filter(t => t.student_id === currentStudent.id)
        setTasks(filteredMockTasks)
        return
      }
      const taskList = await getTasksByStudent(currentStudent.id, false)
      setTasks(Array.isArray(taskList) ? taskList : [])
    } catch (error) {
      console.error('加载任务失败:', error)
      setTasks([])
    }
  }

  // WrongBook: Load data
  const loadWrongBookData = async () => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) {
        const filteredMock = mockWrongQuestions.filter(wq => wq.student_id === currentStudent.id)
        setWrongQuestions(filteredMock)
        return
      }
      const data = await getWrongQuestionsByStudent(currentStudent.id, false)
      setWrongQuestions(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('加载错题失败:', error)
      setWrongQuestions([])
    }
  }

  // Exam: Load generated exams
  const loadGeneratedExams = async (useCache = false) => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) {
        const studentMockExams = mockGeneratedExams.filter(e => e.student_id === currentStudent.id)
        setGeneratedExams(studentMockExams)
        return
      }
      const { getGeneratedExamsByStudent } = await import('./services/apiService')
      const examList = await getGeneratedExamsByStudent(currentStudent.id, useCache)
      setGeneratedExams(Array.isArray(examList) ? examList : [])
    } catch (error) {
      console.error('加载试卷失败:', error)
      setGeneratedExams([])
    }
  }

  // Upload file handler
  const handleFileSelect = async (e) => {
    console.log('🔥🔥🔥🔥🔥 [UPLOAD] === handleFileSelect TRIGGERED === 🔥🔥🔥🔥🔥')
    try {
      if (!currentStudent || !currentStudent?.id) {
        console.log('💥💥💥 [UPLOAD] BLOCKED: currentStudent is NULL or undefined!')
        Toast.show({ message: '请先选择学生后再上传试卷', type: 'error', duration: 3000 })
        return
      }
      console.log('✅ [UPLOAD] currentStudent:', currentStudent.id, currentStudent.name)

      const files = Array.from(e.target.files)
      console.log('🔥🔥 [UPLOAD] Files received:', files.length, files.map(f => ({ name: f.name, size: f.size, type: f.type })))
      if (files.length === 0) {
        console.log('🔥 [UPLOAD] No files selected, returning early')
        return
      }
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

      console.log('🔥🔥 [UPLOAD] After dedup - newFiles:', newFiles.length, 'duplicateFiles:', duplicateFiles.length)

      if (duplicateFiles.length > 0) {
        Toast.show({ message: `${duplicateFiles.length} 个文件已存在，已自动跳过`, type: 'error' })
      }

      if (newFiles.length === 0) {
        console.log('🔥🔥 [UPLOAD] No new files after dedup, returning')
        return
      }

      if (USE_MOCK_DATA) {
        console.log('🔥🔥🔥 [UPLOAD] === Using MOCK path (uploadViaFrontend) ===')
        await uploadViaFrontend(newFiles)
      } else {
        console.log('🔥🔥🔥 [UPLOAD] === Using BACKEND path (uploadViaBackend) ===')
        await uploadViaBackend(newFiles)
      }
    } catch (err) {
      console.error('💥💥💥💥💥 [UPLOAD] UNCAUGHT ERROR in handleFileSelect:', err)
      console.error('💥 [UPLOAD] Error stack:', err.stack)
      Toast.show({ message: `上传出错: ${err.message}`, type: 'error', duration: 5000 })
    }
  }

  // Upload via backend API
  const uploadViaBackend = async (files) => {
    console.log('📤📤📤 [uploadViaBackend] STARTING with', files.length, 'files')
    console.log('📤 [uploadViaBackend] currentStudent:', currentStudent?.id, currentStudent?.name)
    
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

    console.log('📤 [uploadViaBackend] Created', pendingTasks.length, 'temp tasks')

    Toast.show({ message: `已添加 ${files.length} 个文件，正在上传...`, type: 'success', duration: 2000 })

    let successCount = 0
    let failedCount = 0

    for (const { tempTask, file } of pendingTasks) {
      try {
        console.log('📤📤 [uploadViaBackend] Uploading file:', file.name, 'tempTaskId:', tempTask.id)
        const result = await taskService.uploadFiles(currentStudent.id, [file])
        console.log('📤📤 [uploadViaBackend] Upload result:', JSON.stringify(result))
        
        if (result.success && result.tasks.length > 0 && !result.tasks[0].error) {
          const serverTask = result.tasks[0]
          console.log('✅ [uploadViaBackend] File uploaded successfully, serverTaskId:', serverTask.id)
          updateTaskInStore(tempTask.id, 'pending', { progress: 0 })
          setTasks(prev => prev.map(t => 
            t.id === tempTask.id ? { ...serverTask, is_temp: false } : t
          ))
          successCount++
        } else {
          failedCount++
          const taskResult = result.tasks[0] || {}
          const errorMsg = taskResult.message || taskResult.error || result.error || '上传失败'
          console.error('❌ [uploadViaBackend] Upload failed:', errorMsg)
          console.error('❌ [uploadViaBackend] Task result:', taskResult)
          updateTaskInStore(tempTask.id, 'failed', { error: errorMsg })
        }
      } catch (error) {
        console.error('💥💥 [uploadViaBackend] EXCEPTION uploading', file.name, ':', error)
        console.error('💥 [uploadViaBackend] Error stack:', error.stack)
        failedCount++
        updateTaskInStore(tempTask.id, 'failed', { error: error.message || '上传失败' })
      }
    }

    // 上传完成后刷新缓存并重新加载列表
    if (successCount > 0) {
      console.log('🔄 [uploadViaBackend] Invalidating cache and reloading tasks')
      invalidateCache('tasks', currentStudent.id)
      loadTasks()
    }

    if (failedCount > 0) {
      Toast.show({ message: `${successCount} 个成功，${failedCount} 个失败`, type: 'error', duration: 3000 })
    } else if (successCount > 0) {
      Toast.show({ message: `${successCount} 个文件上传成功！`, type: 'success', duration: 2000 })
    }

    console.log('📤📤📤 [uploadViaBackend] COMPLETED - success:', successCount, 'failed:', failedCount)
  }

  // Upload via frontend (fallback)
  const uploadViaFrontend = async (files) => {
    for (const file of files) {
      try {
        setUploading(true)
        Toast.show({ message: '正在上传...', type: 'loading', duration: 0 })

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
        Toast.show({ message: '上传失败，请重试', type: 'error' })
      } finally {
        setUploading(false)
      }
    }
  }

  // Process task (AI recognition)
  const processTask = async (task) => {
    try {
      updateTaskInStore(task.id, 'processing')
      Toast.show({ message: '正在识别题目...', type: 'loading', duration: 0 })

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

        // Questions are created by the backend queue worker, just save the recognition result
        await saveRecognitionResult(task.id, result)
        updateTaskInStore(task.id, 'done', result)

        const wrongQuestions = questions.filter(q => !q.is_correct)
        if (wrongQuestions.length > 0) {
          await addWrongQuestions(currentStudent.id, wrongQuestions.map(q => q.id))
        }

        Toast.show({ message: `识别完成，共 ${questions.length} 道题，${wrongQuestions.length} 道错题`, type: 'success', duration: 2000 })
      } else {
        updateTaskInStore(task.id, 'failed', { error: '未识别到题目' })
        Toast.show({ message: '未识别到题目，请重新上传', type: 'error' })
      }
    } catch (error) {
      console.error('识别失败:', error)
      updateTaskInStore(task.id, 'failed', { error: error.message })
      Toast.show({ message: '识别失败，请重试', type: 'error' })
    }
  }

  // Filter tasks
  const filteredTasks = (Array.isArray(tasks) ? tasks : []).filter(t => {
    if (t.student_id !== currentStudent?.id) return false
    if (processingFilter === 'all') return true
    if (processingFilter === 'done') return t.status === 'done'
    if (processingFilter === 'pending') return t.status === 'processing' || t.status === 'failed' || t.status === 'pending'
    return t.status === processingFilter
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

  const filteredWrongQuestions = (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => {
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
  const studentExams = (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id === currentStudent?.id)

  // Add student
  const handleAddStudent = async (studentData) => {
    try {
      const newStudent = await createStudent(studentData)
      addStudent(newStudent)
      setCurrentStudent(newStudent)
      setShowAddStudent(false)
      Toast.show({ message: '添加学生成功', type: 'success' })
    } catch (error) {
      console.error('添加学生失败:', error)
      Toast.show({ message: '添加学生失败', type: 'error' })
    }
  }

  // Delete task
  const handleDeleteTask = async (taskId) => {
    try {
      const { deleteTask } = await import('./services/apiService')
      await deleteTask(taskId)
      setTasks((Array.isArray(tasks) ? tasks : []).filter(t => t.id !== taskId))
      Toast.show({ message: '删除成功', type: 'success' })
    } catch (error) {
      console.error('删除失败:', error)
      Toast.show({ message: '删除失败', type: 'error' })
    }
  }

  // Print exam
  const handlePrintExam = async (exam) => {
    setPrintTarget(exam)
    setShowPrintModal(true)
    const updated = (Array.isArray(generatedExams) ? generatedExams : []).map(e =>
      e.id === exam.id ? { ...e, printed: true } : e
    )
    setGeneratedExams(updated)
  }

  // Duplicate exam
  const handleDuplicateExam = (exam) => {
    const newName = `${exam.name} (副本)`
    const newExam = {
      ...exam,
      id: `gen-${Date.now()}`,
      name: newName,
      created_at: new Date().toISOString(),
      printed: false,
      status: 'pending'
    }
    setGeneratedExams([newExam, ...(Array.isArray(generatedExams) ? generatedExams : [])])
    Toast.show({ message: '已复制生成新卷', type: 'success' })
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

  // Delete exam
  const handleDeleteExam = async (examId) => {
    try {
      const { apiRequest } = await import('./services/apiService')
      // Use fetch directly since apiRequest is not exported
      await fetch(`${import.meta.env.VITE_API_URL || '/api'}/generated-exams/${examId}`, { method: 'DELETE' })
      setGeneratedExams((Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.id !== examId))
      Toast.show({ message: '删除成功', type: 'success' })
    } catch (error) {
      console.error('删除失败:', error)
      Toast.show({ message: '删除失败', type: 'error' })
    }
  }

  // View image
  const handleViewImage = (imageUrl) => {
    setSelectedImage(imageUrl)
    setShowImageViewer(true)
  }

  // Toggle mastery
  const handleToggleMastery = async (wq) => {
    const currentStatus = wq.status
    let nextStatus
    switch (currentStatus) {
      case 'pending':
        nextStatus = 'partial'
        break
      case 'partial':
        nextStatus = 'mastered'
        break
      case 'mastered':
        nextStatus = 'pending'
        break
      default:
        nextStatus = 'pending'
    }
    
    try {
      await updateWrongQuestionStatus(wq.id, nextStatus)
      loadWrongBookData()
      const statusText = { pending: '待复习', partial: '有点懂', mastered: '完全懂' }
      Toast.show({ message: `已标记为${statusText[nextStatus]}`, type: 'success' })
    } catch (error) {
      Toast.show({ message: '操作失败', type: 'error' })
    }
  }

  // 打印预览/组卷
  const handlePrintPreview = () => {
    if (selectedQuestions.length === 0) {
      Toast.show({ message: '请先选择要组卷的错题', type: 'error' })
      return
    }
    setShowPrintPreview(true)
  }

  // Toggle selection for wrong questions
  const toggleSelection = (question) => {
    const exists = selectedQuestions.find(q => q.id === question.id)
    if (exists) {
      setSelectedQuestions(selectedQuestions.filter(q => q.id !== question.id))
    } else {
      setSelectedQuestions([...selectedQuestions, question])
    }
  }

  // Edit question
  const handleEditQuestion = (question) => {
    setManagingTagsQuestion(question)
    setShowTagManager(true)
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
      setWrongQuestions(wrongQuestions.map(wq => {
        const question = wq.question || wq
        return question.id === questionId
          ? { ...wq, question: { ...question, manual_tags: tags, tags_source: 'manual' } }
          : wq
      }))
      setShowTagManager(false)
      Toast.show({ message: '标签更新成功', type: 'success' })
    } catch (error) {
      console.error('更新标签失败:', error)
      Toast.show({ message: '更新标签失败', type: 'error' })
    }
  }

  // Open question editor
  const handleOpenEditor = (wq) => {
    const question = wq.question || wq
    setEditingQuestionItem(wq)
    setEditForm({
      content: question.content || '',
      options: question.options || [],
      answer: question.answer || '',
      analysis: question.analysis || '',
      image_url: question.image_url || '',
      student_answer: question.student_answer || '',
      question_type: question.question_type || 'choice'
    })
    const tags = question.tags_source === 'manual'
      ? (question.manual_tags || [])
      : (question.ai_tags || [])
    setEditTags([...tags])
    setEditNewTag('')
    setEditTab('stem')
    setShowQuestionEditor(true)
  }

  // Handle edit form changes
  const updateEditForm = (field, value) => {
    setEditForm(prev => ({ ...prev, [field]: value }))
  }

  // Add option in editor
  const addEditOption = () => {
    setEditForm(prev => ({ ...prev, options: [...prev.options, ''] }))
  }

  // Update option in editor
  const updateEditOption = (index, value) => {
    setEditForm(prev => {
      const newOptions = [...prev.options]
      newOptions[index] = value
      return { ...prev, options: newOptions }
    })
  }

  // Remove option in editor
  const removeEditOption = (index) => {
    setEditForm(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index)
    }))
  }

  // Add tag in editor
  const handleAddEditTag = () => {
    const trimmed = editNewTag.trim()
    if (!trimmed || editTags.includes(trimmed)) return
    setEditTags([...editTags, trimmed])
    setEditNewTag('')
  }

  // Remove tag in editor
  const handleRemoveEditTag = (tag) => {
    setEditTags(editTags.filter(t => t !== tag))
  }

  // Save question edits
  const handleSaveEdit = async () => {
    if (!editForm.content.trim()) {
      Toast.show({ message: '请输入题目内容', type: 'error' })
      return
    }
    const question = editingQuestionItem.question || editingQuestionItem
    const updatedData = {
      content: editForm.content,
      options: editForm.options,
      answer: editForm.answer,
      analysis: editForm.analysis,
      image_url: editForm.image_url,
      question_type: editForm.question_type,
      manual_tags: editTags,
      tags_source: 'manual',
      updated_at: new Date().toISOString()
    }
    try {
      await updateQuestion(question.id, updatedData)
      setWrongQuestions(wrongQuestions.map(wq => {
        if (wq.id === editingQuestionItem.id) {
          return { ...wq, question: { ...(wq.question || wq), ...updatedData } }
        }
        return wq
      }))
      setShowQuestionEditor(false)
      setEditingQuestionItem(null)
      Toast.show({ message: '保存成功', type: 'success' })
    } catch (error) {
      console.error('保存失败:', error)
      Toast.show({ message: '保存失败', type: 'error' })
    }
  }

  // Delete wrong question
  const handleDeleteWrongQuestion = (wq) => {
    setDeleteTarget({ type: 'wrong', id: wq.id })
    setShowDeleteConfirm(true)
  }

  // Confirm delete
  const handleConfirmDelete = async () => {
    setShowDeleteConfirm(false)
    if (deleteTarget?.type === 'task') {
      await handleDeleteTask(deleteTarget.id)
    } else if (deleteTarget?.type === 'exam') {
      await handleDeleteExam(deleteTarget.id)
    } else if (deleteTarget?.type === 'wrong') {
      try {
        const { deleteWrongQuestion } = await import('./services/apiService')
        await deleteWrongQuestion(deleteTarget.id)
        setWrongQuestions(wrongQuestions.filter(wq => wq.id !== deleteTarget.id))
        Toast.show({ message: '已从错题本移除', type: 'success' })
      } catch (error) {
        console.error('删除失败:', error)
        Toast.show({ message: '删除失败', type: 'error' })
      }
    }
    setDeleteTarget(null)
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
    setNotifications((Array.isArray(notifications) ? notifications : []).filter(n => n.id !== notificationId))
  }

  // Search
  const handleSearch = (query) => {
    setSearchQuery(query)
  }

  // Filter by search
  const searchFilteredTasks = filteredTasks.filter(t =>
    searchQuery === '' || t.original_name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const searchFilteredWrongQuestions = filteredWrongQuestions.filter(wq => {
    const question = wq.question || wq
    return searchQuery === '' || question.content?.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const searchFilteredExams = studentExams.filter(e =>
    searchQuery === '' || e.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Render
  return (
    <ToastProvider>
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
                      { id: 'done', label: '已批改', count: filteredTasks.filter(t => t.status === 'done').length },
                      { id: 'pending', label: '未批改', count: filteredTasks.filter(t => t.status === 'processing' || t.status === 'failed' || t.status === 'pending').length }
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

                {/* Task List */}
                <section className="px-5 space-y-3">
                  {searchFilteredTasks.length === 0 ? (
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
                        className={`bg-white rounded-2xl p-4 shadow-sm border border-gray-100 relative ${
                          task.status === 'done' ? 'cursor-pointer active:bg-gray-50' : ''
                        }`}
                        onClick={() => {
                          if (task.status === 'done') {
                            setReviewTask(task)
                            setShowExamReview(true)
                          }
                        }}
                      >
                        {task.status === 'failed' && (
                          <span className="absolute top-2 right-2 text-red-500 text-lg" title="处理失败">
                            ⚠️
                          </span>
                        )}
                        <div className="flex gap-3">
                          <div
                            className="w-20 h-20 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); handleViewImage(task.image_url) }}
                          >
                            {task.image_url ? (
                              <img src={task.image_url} alt="试卷" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon size={24} className="text-gray-300" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 pr-6">
                            <div className="flex items-start justify-between">
                              <h3 className="text-[14px] font-bold text-gray-900 truncate">
                                {task.original_name || '未命名试卷'}
                              </h3>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget({ type: 'task', id: task.id })
                                  setShowDeleteConfirm(true)
                                }}
                                className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 ml-2"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1">
                              上传时间：{dayjs(task.created_at).format('YYYY/MM/DD HH:mm')}
                            </p>
                            {task.status === 'done' && (
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                题目数量：{task.result?.questionCount || 0}题
                              </p>
                            )}
                            {task.status === 'done' && task.result?.questionCount && (
                              <div className="flex gap-3 mt-1.5 text-[11px]">
                                <span className="text-green-600">
                                  正确 {task.result?.questionCount - (task.result?.wrongCount || 0)}
                                </span>
                                <span className="text-red-500">
                                  错误 {task.result?.wrongCount || 0}
                                </span>
                              </div>
                            )}
                            {task.status === 'failed' && task.result?.error && (
                              <p className="text-[11px] text-red-400 mt-1">
                                {task.result.error}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                              {task.status === 'done' ? (
                                <span className="px-2.5 py-1 rounded-full bg-green-50 text-green-600 text-[11px] font-bold">
                                  已批改
                                </span>
                              ) : (
                                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 ${
                                  task.status === 'failed'
                                    ? 'bg-red-50 text-red-600'
                                    : task.status === 'processing'
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'bg-yellow-50 text-yellow-600'
                                }`}>
                                  {task.status === 'processing' && <Loader2 size={10} className="animate-spin" />}
                                  未批改
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
                      { id: 'all', label: '全部', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id).length },
                      { id: 'pending', label: '待复习', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.status === 'pending').length },
                      { id: 'partial', label: '有点懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.status === 'partial').length },
                      { id: 'mastered', label: '完全懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.status === 'mastered').length }
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
                <section className="px-5 space-y-3 pb-20">
                  {filteredWrongQuestions.length === 0 ? (
                    <div className="text-center py-20">
                      <LayoutGrid size={48} className="mx-auto text-gray-200 mb-4" />
                      <p className="text-gray-400 text-[15px]">暂无错题</p>
                      <p className="text-gray-300 text-[13px] mt-1">AI批改后错题会自动收录到错题本</p>
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
                                <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">
                                  错 {wq.error_count || 1} 次
                                </span>
                              </div>
                              <span 
                                onClick={() => handleToggleMastery(wq)}
                                className={`text-[10px] px-2 py-0.5 rounded-full cursor-pointer ${
                                  wq.status === 'pending'
                                  ? 'bg-yellow-50 text-yellow-600'
                                  : wq.status === 'partial'
                                  ? 'bg-orange-50 text-orange-600'
                                  : 'bg-green-50 text-green-600'
                                }`}
                              >
                                {wq.status === 'pending' ? '待复习' : wq.status === 'partial' ? '有点懂' : '完全懂'}
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
                              <span className="text-gray-200">|</span>
                              <button
                                onClick={() => handleOpenEditor(wq)}
                                className="text-[12px] text-blue-600 font-medium hover:text-blue-700"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => handleDeleteWrongQuestion(wq)}
                                className="text-[12px] text-red-500 font-medium hover:text-red-600"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </section>

                {/* Bottom Action Bar - Wrongbook */}
                <div className="fixed bottom-16 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 px-5 py-3 z-40">
                  <div className="max-w-lg mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-gray-500">已选</span>
                      <span className="text-[16px] font-bold text-blue-600">{selectedQuestions.length}</span>
                      <span className="text-[13px] text-gray-500">题</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handlePrintPreview}
                        disabled={selectedQuestions.length === 0}
                        className={`px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all flex items-center gap-1 ${
                          selectedQuestions.length > 0
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100 active:bg-blue-700'
                          : 'bg-gray-100 text-gray-300'
                        }`}
                      >
                        <Printer size={14} />
                        组卷打印
                      </button>
                    </div>
                  </div>
                </div>
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
                {/* Page Title */}
                <section className="px-5 pt-4 mb-3">
                  <h2 className="text-[20px] font-bold text-gray-900">历史组卷</h2>
                  <p className="text-[13px] text-gray-400 mt-1">
                    共 {studentExams.length} 份试卷
                  </p>
                </section>

                {/* Exam List */}
                <section className="px-5 space-y-3">
                  {searchFilteredExams.length === 0 ? (
                    <div className="text-center py-20">
                      <FileText size={48} className="mx-auto text-gray-200 mb-4" />
                      <p className="text-gray-400 text-[15px]">暂无组卷记录</p>
                      <p className="text-gray-300 text-[13px] mt-1">在错题本选择题目后点击"生成试卷"</p>
                    </div>
                  ) : (
                    searchFilteredExams.map((exam) => (
                      <motion.div
                        key={exam.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 relative"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 pr-4">
                            <h3 className="text-[15px] font-bold text-gray-900 truncate">{exam.name}</h3>
                            <p className="text-[12px] text-gray-400 mt-1.5">
                              生成时间：{dayjs(exam.created_at).format('YYYY/MM/DD HH:mm')}
                            </p>
                            <p className="text-[12px] text-gray-400 mt-0.5">
                              共 {exam.question_ids?.length || 0} 道题
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${
                              exam.printed
                                ? 'bg-green-50 text-green-600'
                                : 'bg-yellow-50 text-yellow-600'
                            }`}>
                              {exam.printed ? '已打印' : '未打印'}
                            </span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handlePrintExam(exam)}
                                className="py-2 px-4 rounded-xl bg-blue-600 text-white text-[12px] font-bold hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm"
                              >
                                <Printer size={13} />
                                打印
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteTarget({ type: 'exam', id: exam.id })
                                  setShowDeleteConfirm(true)
                                }}
                                className="py-2 px-3 rounded-xl bg-gray-100 text-gray-400 text-[12px] font-medium hover:bg-red-50 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={13} />
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
          </AnimatePresence>
        </main>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-gray-100 z-50">
          <div className="max-w-lg mx-auto px-6 h-16 flex items-center justify-around">
            {[
              { id: 'processing', icon: Camera, label: '处理' },
              { id: 'wrongbook', icon: LayoutGrid, label: '错题本' },
              { id: 'exam', icon: FileText, label: '试卷' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setCurrentPage(tab.id); clearSelection() }}
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

        {/* Delete Confirm Dialog */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[20000] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
            <div className="relative bg-white rounded-2xl p-6 mx-5 w-full max-w-sm shadow-xl">
              <h3 className="text-[16px] font-bold text-gray-900 mb-2">确认删除</h3>
              <p className="text-[14px] text-gray-500 mb-6">删除后不可恢复，确定要删除吗？</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[14px] font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-[14px] font-bold"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Question Editor Dialog */}
        {showQuestionEditor && editingQuestionItem && (
          <div className="fixed inset-0 z-[20000] flex flex-col">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowQuestionEditor(false)} />
            <div className="relative mt-auto bg-white rounded-t-2xl max-h-[85vh] min-h-[60vh] flex flex-col shadow-xl">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="text-[16px] font-bold text-gray-900">编辑题目</h3>
                <button onClick={() => setShowQuestionEditor(false)} className="p-1">
                  <X size={20} className="text-gray-400" />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-100">
                {[
                  { key: 'stem', label: '题干' },
                  { key: 'answer', label: '答案' },
                  { key: 'tags', label: '标签' }
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setEditTab(tab.key)}
                    className={`flex-1 py-3 text-[14px] font-medium relative ${
                      editTab === tab.key ? 'text-blue-600' : 'text-gray-400'
                    }`}
                  >
                    {tab.label}
                    {editTab === tab.key && (
                      <div className="absolute bottom-0 left-1/3 right-1/3 h-0.5 bg-blue-600 rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* Stem Tab */}
                {editTab === 'stem' && (
                  <>
                    <div>
                      <label className="text-[13px] font-medium text-gray-500 mb-1.5 block">题目内容</label>
                      <textarea
                        value={editForm.content}
                        onChange={e => updateEditForm('content', e.target.value)}
                        placeholder="请输入题目内容"
                        className="w-full border border-gray-200 rounded-xl p-3 text-[14px] text-gray-900 min-h-[100px] resize-none focus:outline-none focus:border-blue-300"
                      />
                    </div>

                    {editForm.question_type === 'choice' && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[13px] font-medium text-gray-500">选项</label>
                          <button
                            onClick={addEditOption}
                            className="text-[12px] text-blue-600 font-medium"
                          >
                            + 添加选项
                          </button>
                        </div>
                        <div className="space-y-2">
                          {editForm.options.map((opt, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 text-[12px] font-bold flex items-center justify-center flex-shrink-0">
                                {String.fromCharCode(65 + idx)}
                              </span>
                              <input
                                value={opt}
                                onChange={e => updateEditOption(idx, e.target.value)}
                                placeholder={`选项 ${String.fromCharCode(65 + idx)}`}
                                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-300"
                              />
                              <button onClick={() => removeEditOption(idx)} className="p-1">
                                <X size={14} className="text-red-400" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {editForm.image_url && (
                      <div>
                        <label className="text-[13px] font-medium text-gray-500 mb-1.5 block">插图</label>
                        <div className="relative inline-block">
                          <img
                            src={editForm.image_url}
                            alt="插图"
                            className="max-w-full max-h-[200px] rounded-xl border border-gray-200"
                          />
                          <button
                            onClick={() => updateEditForm('image_url', '')}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center"
                          >
                            <X size={12} className="text-white" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Answer Tab */}
                {editTab === 'answer' && (
                  <>
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] text-gray-400 font-medium">学生答案</span>
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[10px] font-bold">错误记录</span>
                      </div>
                      <p className="text-[15px] text-gray-900 mt-1">{editForm.student_answer || '未作答'}</p>
                    </div>

                    <div>
                      <label className="text-[13px] font-medium text-gray-500 mb-1.5 block">正确答案</label>
                      <input
                        value={editForm.answer}
                        onChange={e => updateEditForm('answer', e.target.value)}
                        placeholder="请输入正确答案"
                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-[14px] focus:outline-none focus:border-blue-300"
                      />
                    </div>

                    <div>
                      <label className="text-[13px] font-medium text-gray-500 mb-1.5 block">题目解析</label>
                      <textarea
                        value={editForm.analysis}
                        onChange={e => updateEditForm('analysis', e.target.value)}
                        placeholder="请输入解析内容..."
                        className="w-full border border-gray-200 rounded-xl p-3 text-[14px] text-gray-900 min-h-[120px] resize-none focus:outline-none focus:border-blue-300"
                      />
                    </div>
                  </>
                )}

                {/* Tags Tab */}
                {editTab === 'tags' && (
                  <div>
                    <label className="text-[13px] font-medium text-gray-500 mb-2 block">知识点标签</label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {editTags.length === 0 ? (
                        <span className="text-[13px] text-gray-400">暂无标签</span>
                      ) : (
                        editTags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-orange-50 text-orange-600 text-[12px] font-medium"
                          >
                            {tag}
                            <button onClick={() => handleRemoveEditTag(tag)} className="ml-0.5">
                              <X size={10} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={editNewTag}
                        onChange={e => setEditNewTag(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddEditTag() } }}
                        placeholder="输入标签后按回车添加"
                        className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-[14px] focus:outline-none focus:border-blue-300"
                      />
                      <button
                        onClick={handleAddEditTag}
                        disabled={!editNewTag.trim()}
                        className="px-4 py-2 rounded-xl bg-blue-600 text-white text-[13px] font-medium disabled:opacity-50"
                      >
                        添加
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
                <button
                  onClick={() => setShowQuestionEditor(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-[14px] font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-[14px] font-bold"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Exam Review / 复审 */}
        {showExamReview && reviewTask && (
          <ExamReview
            task={reviewTask}
            onClose={() => { setShowExamReview(false); setReviewTask(null); loadTasks() }}
          />
        )}

        {/* Print Preview / 组卷 */}
        {showPrintPreview && (
          <PrintPreview onClose={() => setShowPrintPreview(false)} />
        )}
      </div>
    </ToastProvider>
  )
}