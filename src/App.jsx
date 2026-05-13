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
  Edit3,
  Tag
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useUIStore, useStudentStore, useTaskStore, useWrongQuestionStore, useExamStore } from './store'
import { getStudents, getTasksByStudent, getQuestionsByTask, addWrongQuestions, getWrongQuestionsByStudent, getExamsByStudent, getGeneratedExamsByStudent, createTask, updateTaskStatus, uploadImage, updateQuestion, updateQuestionTags, invalidateCache, createStudent, updateWrongQuestionStatus, getQuestionsByIds, deleteTask, deleteGeneratedExam, deleteWrongQuestion } from './services/apiService'
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
      await deleteTask(taskId)
      setTasks((Array.isArray(tasks) ? tasks : []).filter(t => t.id !== taskId))
      Toast.show({ message: '删除成功', type: 'success' })
    } catch (error) {
      console.error('删除失败:', error)
      Toast.show({ message: '删除失败', type: 'error' })
    }
  }

  // Shared helper to get exam questions
  const getExamQuestions = async (exam) => {
    if (!exam?.question_ids?.length) {
      Toast.show({ message: '该试卷没有题目', type: 'error' })
      return null
    }
    try {
      const questions = await getQuestionsByIds(exam.question_ids)
      if (!questions?.length) {
        Toast.show({ message: '试卷中的题目已被删除，请重新生成', type: 'error' })
        return null
      }
      return { examQuestions: questions, examTitle: exam.name || '试卷' }
    } catch (error) {
      console.error('获取题目失败:', error)
      Toast.show({ message: '获取题目失败: ' + error.message, type: 'error' })
      return null
    }
  }

  // Print exam via browser print
  const handlePrint = async (exam) => {
    const result = await getExamQuestions(exam)
    if (!result) return
    const { examQuestions, examTitle } = result

    const printContent = `
      <html>
      <head><title>${examTitle}</title>
      <style>
        body { font-family: 'Noto Sans SC', sans-serif; padding: 20px; color: #333; }
        h1 { text-align: center; font-size: 18px; margin-bottom: 10px; }
        .meta { text-align: center; font-size: 12px; color: #666; margin-bottom: 20px; }
        .question { margin-bottom: 16px; page-break-inside: avoid; }
        .q-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
        .q-content { font-size: 13px; line-height: 1.6; margin-bottom: 6px; }
        .options { padding-left: 16px; font-size: 13px; line-height: 1.8; }
        .answer { font-size: 12px; color: #2563EB; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #E5E7EB; }
        @media print { body { padding: 0; } }
      </style>
      </head>
      <body>
        <h1>${examTitle}</h1>
        <div class="meta">共 ${examQuestions.length} 题 · ${dayjs().format('YYYY/MM/DD')}</div>
        ${examQuestions.map((q, i) => `
          <div class="question">
            <div class="q-title">${i + 1}. ${q.question_type === 'choice' ? '选择题' : '非选择题'}</div>
            <div class="q-content">${q.content}</div>
            ${q.options?.length ? `<div class="options">${q.options.map((o, oi) => `<div>${String.fromCharCode(65 + oi)}. ${o}</div>`).join('')}</div>` : ''}
            <div class="answer">答案：${q.answer || '略'}</div>
          </div>
        `).join('')}
      </body>
      </html>
    `
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(printContent)
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => printWindow.print(), 300)
    }
    setGeneratedExams((Array.isArray(generatedExams) ? generatedExams : []).map(e =>
      e.id === exam.id ? { ...e, printed: true, printCount: (e.printCount || 0) + 1 } : e
    ))
    Toast.show({ message: '已发送到打印机', type: 'success' })
  }

  // Download exam as PDF
  const handleDownloadPdf = async (exam) => {
    const result = await getExamQuestions(exam)
    if (!result) return
    const { examQuestions, examTitle } = result

    const doc = new jsPDF('p', 'mm', 'a4')
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 20
    let y = margin

    // Title
    doc.setFontSize(16)
    doc.setFont('helvetica', 'bold')
    doc.text(examTitle, pageWidth / 2, y, { align: 'center' })
    y += 8

    // Meta
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100)
    doc.text(`共 ${examQuestions.length} 题 · ${dayjs().format('YYYY/MM/DD')}`, pageWidth / 2, y, { align: 'center' })
    y += 10

    // Questions
    doc.setTextColor(50)
    for (let i = 0; i < examQuestions.length; i++) {
      const q = examQuestions[i]
      const label = `${i + 1}. ${q.question_type === 'choice' ? '选择题' : '非选择题'}`

      if (y > pageHeight - margin) {
        doc.addPage()
        y = margin
      }

      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text(label, margin, y)
      y += 6

      doc.setFontSize(11)
      doc.setFont('helvetica', 'normal')
      const lines = doc.splitTextToSize(q.content || '', pageWidth - margin * 2)
      if (y + lines.length * 5 > pageHeight - margin) {
        doc.addPage()
        y = margin
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text(label, margin, y)
        y += 6
        doc.setFontSize(11)
        doc.setFont('helvetica', 'normal')
      }
      doc.text(lines, margin, y)
      y += lines.length * 5 + 3

      if (q.options?.length) {
        if (y + q.options.length * 5 > pageHeight - margin) {
          doc.addPage()
          y = margin
        }
        q.options.forEach((opt, oi) => {
          doc.text(`${String.fromCharCode(65 + oi)}. ${opt}`, margin + 5, y)
          y += 5
        })
        y += 2
      }

      if (y + 5 > pageHeight - margin) {
        doc.addPage()
        y = margin
      }
      doc.setFont('helvetica', 'italic')
      doc.setTextColor(37, 99, 235)
      doc.text(`答案：${q.answer || '略'}`, margin, y)
      doc.setTextColor(50)
      y += 8
    }

    const fileName = `${examTitle}_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`
    doc.save(fileName)

    setGeneratedExams((Array.isArray(generatedExams) ? generatedExams : []).map(e =>
      e.id === exam.id ? { ...e, printed: true, printCount: (e.printCount || 0) + 1 } : e
    ))
    Toast.show({ message: 'PDF已生成，请查看下载', type: 'success' })
  }

  // Duplicate exam

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
      await deleteGeneratedExam(examId)
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
      <div className="min-h-screen" style={{ background: '#F5F7FA' }}>
        {/* Header */}
        <header className="sticky top-0 z-50 bg-white/90 border-b" style={{ borderColor: '#E5E7EB' }}>
          <div className="max-w-lg mx-auto px-4 h-11 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStudentSwitcher(true)}
                className="flex items-center gap-1.5 text-gray-900"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#EFF6FF' }}>
                  <User size={14} style={{ color: '#2563EB' }} />
                </div>
                <span style={{ fontSize: '15px', fontWeight: 600 }}>{currentStudent?.name || '选择学生'}</span>
                <ChevronDown size={14} className="text-gray-400" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSearch(true)}
                className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#F3F4F6' }}
              >
                <Search size={16} className="text-gray-500" />
              </button>
              <button
                onClick={handleShowNotifications}
                className="w-8 h-8 rounded-full flex items-center justify-center relative" style={{ background: '#F3F4F6' }}
              >
                <Bell size={16} className="text-gray-500" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full text-[9px] text-white flex items-center justify-center" style={{ background: '#EF4444' }}>
                    {notifications.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-lg mx-auto" style={{ paddingBottom: '80px' }}>
          <AnimatePresence>
            {currentPage === 'processing' && (
              <motion.div
                key="processing-page"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="w-full"
              >
                {/* Filter Tabs */}
                <section className="px-4 pt-2.5 mb-1.5 overflow-x-auto no-scrollbar">
                  <div className="flex gap-1.5 min-w-max">
                    {[
                      { id: 'all', label: '全部', count: filteredTasks.length },
                      { id: 'done', label: '已批改', count: filteredTasks.filter(t => t.status === 'done').length },
                      { id: 'pending', label: '未批改', count: filteredTasks.filter(t => t.status === 'processing' || t.status === 'failed' || t.status === 'pending').length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setProcessingFilter(filter.id)}
                        className={`filter-chip ${processingFilter === filter.id ? 'active' : 'inactive'}`}
                      >
                        {filter.label}
                        <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '3px' }}>
                          {filter.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Task List - Compact File Style */}
                <section className="px-4 space-y-1">
                  {searchFilteredTasks.length === 0 ? (
                    <div className="text-center py-16">
                      <Camera size={36} className="mx-auto" style={{ color: '#D1D5DB' }} />
                      <p className="mt-3" style={{ fontSize: '13px', color: '#9CA3AF' }}>暂无任务</p>
                      <p className="mt-0.5" style={{ fontSize: '11px', color: '#D1D5DB' }}>点击右下角按钮上传试卷</p>
                    </div>
                  ) : (
                    searchFilteredTasks.map((task) => (
                      <motion.div
                        key={task.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`${task.status === 'done' ? 'cursor-pointer' : ''}`}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '10px',
                          background: '#fff',
                          border: '1px solid #F3F4F6',
                          transition: 'all 0.15s'
                        }}
                        onClick={() => {
                          if (task.status === 'done') {
                            setReviewTask(task)
                            setShowExamReview(true)
                          }
                        }}
                      >
                        <div className="flex gap-2.5 items-center">
                          {/* Small thumbnail */}
                          <div
                            className="w-9 h-9 rounded-lg flex-shrink-0 overflow-hidden cursor-pointer"
                            style={{ background: '#F5F5F5' }}
                            onClick={(e) => { e.stopPropagation(); handleViewImage(task.image_url) }}
                          >
                            {task.image_url ? (
                              <img src={task.image_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon size={14} style={{ color: '#D1D5DB' }} />
                              </div>
                            )}
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span style={{ fontSize: '13px', fontWeight: 500, color: '#111827' }} className="truncate">
                                {task.original_name || '未命名试卷'}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'task', id: task.id }); setShowDeleteConfirm(true) }}
                                className="flex-shrink-0"
                                style={{ color: '#E5E7EB' }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span style={{ fontSize: '11px', color: '#9CA3AF' }}>
                                {dayjs(task.created_at).format('MM/DD HH:mm')}
                              </span>
                              {task.result?.questionCount ? (
                                <>
                                  <span style={{ fontSize: '10px', color: '#D1D5DB' }}>·</span>
                                  <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{task.result.questionCount} 题</span>
                                </>
                              ) : null}
                              {/* Inline status for non-done */}
                              {task.status !== 'done' && (
                                <>
                                  <span style={{ fontSize: '10px', color: '#D1D5DB' }}>·</span>
                                  <span style={{
                                    fontSize: '11px',
                                    color: task.status === 'failed' ? '#EF4444' : task.status === 'processing' ? '#2563EB' : '#F59E0B'
                                  }}>
                                    {task.status === 'processing' && <Loader2 size={9} className="animate-spin inline" style={{ marginRight: '1px' }} />}
                                    {task.status === 'processing' ? '批改中' : task.status === 'failed' ? '识别失败' : '等待中'}
                                  </span>
                                </>
                              )}
                            </div>
                            {/* Stats or Error */}
                            {task.status === 'done' && task.result?.questionCount ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span style={{
                                  fontSize: '10px',
                                  padding: '0 5px',
                                  height: '16px',
                                  lineHeight: '16px',
                                  borderRadius: '3px',
                                  background: '#F0FDF4',
                                  color: '#16A34A',
                                  display: 'inline-block'
                                }}>
                                  正确 {task.result?.questionCount - (task.result?.wrongCount || 0)}
                                </span>
                                <span style={{
                                  fontSize: '10px',
                                  padding: '0 5px',
                                  height: '16px',
                                  lineHeight: '16px',
                                  borderRadius: '3px',
                                  background: '#FEF2F2',
                                  color: '#EF4444',
                                  display: 'inline-block'
                                }}>
                                  错误 {task.result?.wrongCount || 0}
                                </span>
                              </div>
                            ) : null}
                            {task.status === 'failed' && task.result?.error && (
                              <p style={{ fontSize: '10px', color: '#EF4444', marginTop: '0.5px', lineHeight: 1.2 }}>
                                {task.result.error}
                              </p>
                            )}
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
                <section className="px-4 pt-3 mb-2 overflow-x-auto no-scrollbar">
                  <div className="flex gap-1.5 min-w-max">
                    {[
                      { id: 'all', label: '全部', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id).length },
                      { id: 'pending', label: '待复习', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.status === 'pending').length },
                      { id: 'partial', label: '有点懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.status === 'partial').length },
                      { id: 'mastered', label: '完全懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.status === 'mastered').length }
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        onClick={() => setBankFilter(filter.id)}
                        className={`filter-chip ${bankFilter === filter.id ? 'active' : 'inactive'}`}
                      >
                        {filter.label}
                        <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '3px' }}>{filter.count}</span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Advanced Filters */}
                <section className="px-4 mb-3 overflow-x-auto no-scrollbar">
                  <div className="flex gap-1.5 min-w-max">
                    <button
                      onClick={() => setShowSubjectFilter(!showSubjectFilter)}
                      className={`filter-chip ${selectedSubject !== 'all' ? 'active' : 'inactive'}`}
                    >
                      科目<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                    <button
                      onClick={() => setShowTimeFilter(!showTimeFilter)}
                      className={`filter-chip ${selectedTimeRange !== 'all' ? 'active' : 'inactive'}`}
                    >
                      时间<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                    <button
                      onClick={() => setShowErrorFilter(!showErrorFilter)}
                      className={`filter-chip ${selectedErrorCount !== 'all' ? 'active' : 'inactive'}`}
                    >
                      错次<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                    <button
                      onClick={() => setShowTagFilter(!showTagFilter)}
                      className={`filter-chip ${selectedTags.length > 0 ? 'active' : 'inactive'}`}
                    >
                      标签<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                  </div>
                </section>

                {/* Wrong Question List */}
                <section className="px-4">
                  {filteredWrongQuestions.length === 0 ? (
                    <div className="text-center py-16">
                      <LayoutGrid size={36} className="mx-auto" style={{ color: '#D1D5DB' }} />
                      <p className="mt-3" style={{ fontSize: '13px', color: '#9CA3AF' }}>暂无错题</p>
                      <p className="mt-0.5" style={{ fontSize: '11px', color: '#D1D5DB' }}>AI批改后错题会自动收录到错题本</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {filteredWrongQuestions.map((wq) => {
                        const question = wq.question || wq
                        const isSelected = selectedQuestions.find(q => q.id === wq.id)

                        const statusCfg = {
                          pending: { bg: '#FFFBEB', color: '#F59E0B', text: '待复习' },
                          partial: { bg: '#EFF6FF', color: '#2563EB', text: '有点懂' },
                          mastered: { bg: '#F0FDF4', color: '#16A34A', text: '完全懂' }
                        }
                        const st = statusCfg[wq.status] || statusCfg.pending

                        const tags = question.tags_source === 'manual'
                          ? (question.manual_tags || [])
                          : (question.ai_tags || [])

                        return (
                          <motion.div
                            key={wq.id}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="card"
                            style={{ padding: '10px 12px' }}
                          >
                            <div className="flex gap-2.5 items-start">
                              {/* Checkbox */}
                              <button
                                onClick={() => toggleSelection(wq)}
                                className="flex-shrink-0 mt-0.5"
                              >
                                <div
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    border: '2px solid',
                                    borderColor: isSelected ? '#2563EB' : '#D1D5DB',
                                    background: isSelected ? '#2563EB' : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.15s'
                                  }}
                                >
                                  {isSelected && (
                                    <CheckCircle2 size={12} className="text-white" />
                                  )}
                                </div>
                              </button>

                              {/* Content area */}
                              <div className="flex-1 min-w-0">
                                {/* Content - max 2 lines */}
                                <p className="text-[13px] leading-[1.4] text-gray-900 line-clamp-2">
                                  {question.content}
                                </p>

                                {/* Meta row: date · tags · status */}
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <span style={{ fontSize: '11px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                                    {dayjs(wq.added_at || wq.created_at).format('MM/DD')}
                                  </span>

                                  {tags.slice(0, 2).map((tag, idx) => (
                                    <span
                                      key={idx}
                                      style={{
                                        fontSize: '10px',
                                        padding: '1px 6px',
                                        borderRadius: '8px',
                                        background: '#F3F4F6',
                                        color: '#6B7280',
                                        whiteSpace: 'nowrap',
                                        maxWidth: '80px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                      }}
                                    >
                                      {tag}
                                    </span>
                                  ))}

                                  {/* Status badge with colored dot */}
                                  <span
                                    onClick={() => handleToggleMastery(wq)}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      fontSize: '11px',
                                      padding: '1px 8px',
                                      borderRadius: '10px',
                                      background: st.bg,
                                      color: st.color,
                                      cursor: 'pointer',
                                      whiteSpace: 'nowrap',
                                      fontWeight: 500,
                                      transition: 'all 0.15s'
                                    }}
                                  >
                                    <span style={{
                                      width: '5px',
                                      height: '5px',
                                      borderRadius: '50%',
                                      background: st.color,
                                      display: 'inline-block'
                                    }} />
                                    {st.text}
                                  </span>
                                </div>
                              </div>

                              {/* Action buttons - weak */}
                              <div className="flex-shrink-0 flex items-center gap-1 ml-1">
                                <button
                                  onClick={() => handleOpenEditor(wq)}
                                  style={{ fontSize: '11px', color: '#D1D5DB', cursor: 'pointer', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
                                  title="编辑"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeleteWrongQuestion(wq)}
                                  style={{ fontSize: '11px', color: '#D1D5DB', cursor: 'pointer', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
                                  title="删除"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>
                  )}
                </section>

                {/* Floating Bottom Action Bar */}
                <div className="fixed z-40 flex justify-center pointer-events-none" style={{ bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))', left: '12px', right: '12px' }}>
                  <div className="bg-white/85 backdrop-blur-xl rounded-xl shadow-lg border border-gray-200/80 px-4 py-2.5 w-full max-w-lg flex items-center justify-between pointer-events-auto" style={{ maxWidth: 'calc(448px - 24px)' }}>
                    <div className="flex items-center gap-1.5">
                      <span style={{ fontSize: '13px', color: '#6B7280' }}>已选</span>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: '#2563EB' }}>{selectedQuestions.length}</span>
                      <span style={{ fontSize: '13px', color: '#6B7280' }}>题</span>
                    </div>
                    <button
                      onClick={handlePrintPreview}
                      disabled={selectedQuestions.length === 0}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all"
                      style={{
                        background: selectedQuestions.length > 0 ? '#2563EB' : '#F3F4F6',
                        color: selectedQuestions.length > 0 ? 'white' : '#D1D5DB',
                      }}
                    >
                      <Sparkles size={14} />
                      生成试卷
                    </button>
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
                <section className="px-4 pt-3 mb-2">
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>历史组卷</h2>
                  <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '1px' }}>
                    共 {studentExams.length} 份试卷
                  </p>
                </section>

                {/* Exam List */}
                <section className="px-4 space-y-2">
                  {searchFilteredExams.length === 0 ? (
                    <div className="text-center py-16">
                      <FileText size={36} className="mx-auto" style={{ color: '#D1D5DB' }} />
                      <p className="mt-3" style={{ fontSize: '13px', color: '#9CA3AF' }}>暂无组卷记录</p>
                      <p className="mt-0.5" style={{ fontSize: '11px', color: '#D1D5DB' }}>在错题本选择题目后点击"生成试卷"</p>
                    </div>
                  ) : (
                    searchFilteredExams.map((exam) => (
                      <motion.div
                        key={exam.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="card"
                        style={{ padding: '12px' }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }} className="truncate">{exam.name}</h3>
                            <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                              {dayjs(exam.created_at).format('YYYY/MM/DD HH:mm')}
                            </p>
                            <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '1px' }}>
                              共 {exam.question_ids?.length || 0} 道题
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                            <span className="badge" style={{ background: exam.printed ? '#F0FDF4' : '#FFFBEB', color: exam.printed ? '#16A34A' : '#F59E0B' }}>
                              {exam.printed ? '已打印' : '未打印'}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleDownloadPdf(exam)}
                                className="px-2 py-1 rounded-lg text-[12px] flex items-center gap-1"
                                style={{ background: '#F3F4F6', color: '#2563EB' }}
                                title="下载PDF"
                              >
                                <FileText size={12} />
                                <span style={{ fontSize: '10px', fontWeight: 700 }}>PDF</span>
                              </button>
                              <button
                                onClick={() => handlePrint(exam)}
                                className="px-2 py-1 rounded-lg text-[12px]"
                                style={{ background: '#F3F4F6', color: '#6B7280' }}
                                title="打印"
                              >
                                <Printer size={12} />
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteTarget({ type: 'exam', id: exam.id })
                                  setShowDeleteConfirm(true)
                                }}
                                className="px-2 py-1 rounded-lg text-[12px]"
                                style={{ background: '#F3F4F6', color: '#9CA3AF' }}
                              >
                                <Trash2 size={12} />
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

        {/* Bottom Navigation - iOS Segmented Control Style */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white/90 border-t z-50" style={{ borderColor: '#E5E7EB' }}>
          <div className="max-w-lg mx-auto px-3 py-1.5" style={{ paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex gap-1 rounded-lg p-0.5" style={{ background: '#F3F4F6' }}>
              {[
                { id: 'processing', icon: Camera, label: '首页' },
                { id: 'wrongbook', icon: LayoutGrid, label: '错题本' },
                { id: 'exam', icon: FileText, label: '组卷记录' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setCurrentPage(tab.id); clearSelection() }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md transition-all"
                  style={{
                    background: currentPage === tab.id ? '#FFFFFF' : 'transparent',
                    boxShadow: currentPage === tab.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  <tab.icon
                    size={16}
                    strokeWidth={currentPage === tab.id ? 2.5 : 2}
                    style={{ color: currentPage === tab.id ? '#2563EB' : '#9CA3AF' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: currentPage === tab.id ? 600 : 400, color: currentPage === tab.id ? '#2563EB' : '#9CA3AF' }}>
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>
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
            className="fixed right-4 bottom-16 w-11 h-11 rounded-full flex items-center justify-center z-50"
            style={{ background: '#2563EB', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
          >
            <Plus size={20} className="text-white" />
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
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowDeleteConfirm(false)} />
            <div className="relative card mx-5 w-full max-w-sm" style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>确认删除</h3>
              <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '20px' }}>删除后不可恢复，确定要删除吗？</p>
              <div className="flex gap-2.5">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 rounded-lg text-[13px] font-medium"
                  style={{ background: '#F3F4F6', color: '#6B7280' }}
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-2 rounded-lg text-[13px] font-medium text-white"
                  style={{ background: '#EF4444' }}
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
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#E5E7EB' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>编辑题目</h3>
                <button onClick={() => setShowQuestionEditor(false)} className="p-1">
                  <X size={18} style={{ color: '#9CA3AF' }} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b" style={{ borderColor: '#E5E7EB' }}>
                {[
                  { key: 'stem', label: '题干' },
                  { key: 'answer', label: '答案' },
                  { key: 'tags', label: '标签' }
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setEditTab(tab.key)}
                    className="flex-1 py-2.5 text-[13px] font-medium relative"
                    style={{ color: editTab === tab.key ? '#2563EB' : '#9CA3AF' }}
                  >
                    {tab.label}
                    {editTab === tab.key && (
                      <div className="absolute bottom-0 left-1/3 right-1/3 h-0.5 rounded-full" style={{ background: '#2563EB' }} />
                    )}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Stem Tab */}
                {editTab === 'stem' && (
                  <>
                    <div className="card" style={{ padding: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280', display: 'block', marginBottom: '6px' }}>题目内容</label>
                      <textarea
                        value={editForm.content}
                        onChange={e => updateEditForm('content', e.target.value)}
                        placeholder="请输入题目内容"
                        className="w-full rounded-lg p-2.5 text-[13px] resize-none focus:outline-none"
                        style={{ border: '1px solid #E5E7EB', color: '#111827', minHeight: '80px' }}
                      />
                    </div>

                    {editForm.question_type === 'choice' && (
                      <div className="card" style={{ padding: '12px' }}>
                        <div className="flex items-center justify-between mb-2">
                          <label style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280' }}>选项</label>
                          <button onClick={addEditOption} style={{ fontSize: '12px', color: '#2563EB' }}>
                            + 添加选项
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {editForm.options.map((opt, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: '#EFF6FF', color: '#2563EB' }}>
                                {String.fromCharCode(65 + idx)}
                              </span>
                              <input
                                value={opt}
                                onChange={e => updateEditOption(idx, e.target.value)}
                                placeholder={`选项 ${String.fromCharCode(65 + idx)}`}
                                className="flex-1 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none"
                                style={{ border: '1px solid #E5E7EB' }}
                              />
                              <button onClick={() => removeEditOption(idx)} className="p-0.5">
                                <X size={13} style={{ color: '#EF4444' }} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {editForm.image_url && (
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280', display: 'block', marginBottom: '6px' }}>插图</label>
                        <div className="relative inline-block">
                          <img src={editForm.image_url} alt="插图" className="max-w-full max-h-[180px] rounded-lg" style={{ border: '1px solid #E5E7EB' }} />
                          <button onClick={() => updateEditForm('image_url', '')} className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
                            <X size={10} className="text-white" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Answer Tab */}
                {editTab === 'answer' && (
                  <>
                    <div className="card" style={{ padding: '12px', background: '#F9FAFB' }}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span style={{ fontSize: '11px', color: '#9CA3AF' }}>学生答案</span>
                        <span className="badge" style={{ background: '#FEF2F2', color: '#EF4444' }}>错误记录</span>
                      </div>
                      <p style={{ fontSize: '13px', color: '#111827', marginTop: '4px' }}>{editForm.student_answer || '未作答'}</p>
                    </div>

                    <div className="card" style={{ padding: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280', display: 'block', marginBottom: '6px' }}>正确答案</label>
                      <input
                        value={editForm.answer}
                        onChange={e => updateEditForm('answer', e.target.value)}
                        placeholder="请输入正确答案"
                        className="w-full rounded-lg px-3 py-2 text-[13px] focus:outline-none"
                        style={{ border: '1px solid #E5E7EB' }}
                      />
                    </div>

                    <div className="card" style={{ padding: '12px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280', display: 'block', marginBottom: '6px' }}>题目解析</label>
                      <textarea
                        value={editForm.analysis}
                        onChange={e => updateEditForm('analysis', e.target.value)}
                        placeholder="请输入解析内容..."
                        className="w-full rounded-lg p-2.5 text-[13px] resize-none focus:outline-none"
                        style={{ border: '1px solid #E5E7EB', color: '#111827', minHeight: '100px' }}
                      />
                    </div>
                  </>
                )}

                {/* Tags Tab */}
                {editTab === 'tags' && (
                  <div className="card" style={{ padding: '12px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 500, color: '#6B7280', display: 'block', marginBottom: '8px' }}>知识点标签</label>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {editTags.length === 0 ? (
                        <span style={{ fontSize: '12px', color: '#9CA3AF' }}>暂无标签</span>
                      ) : (
                        editTags.map((tag, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium" style={{ background: '#FFF7ED', color: '#EA580C' }}>
                            {tag}
                            <button onClick={() => handleRemoveEditTag(tag)}><X size={9} /></button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        value={editNewTag}
                        onChange={e => setEditNewTag(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddEditTag() } }}
                        placeholder="输入标签后按回车"
                        className="flex-1 rounded-lg px-2.5 py-1.5 text-[13px] focus:outline-none"
                        style={{ border: '1px solid #E5E7EB' }}
                      />
                      <button onClick={handleAddEditTag} disabled={!editNewTag.trim()} className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-white" style={{ background: editNewTag.trim() ? '#2563EB' : '#D1D5DB' }}>
                        添加
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex gap-2.5 px-4 py-3 border-t" style={{ borderColor: '#E5E7EB' }}>
                <button
                  onClick={() => setShowQuestionEditor(false)}
                  className="flex-1 py-2 rounded-lg text-[13px] font-medium"
                  style={{ background: '#F3F4F6', color: '#6B7280' }}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 py-2 rounded-lg text-[13px] font-medium text-white"
                  style={{ background: '#2563EB' }}
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