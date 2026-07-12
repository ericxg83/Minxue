import { useEffect, useState, useRef, lazy, Suspense, useCallback, useMemo } from 'react'
import {
  Camera,
  ChevronRight,
  Check,
  CheckCircle2,
  XCircle,
  Loader2,
  LayoutGrid,
  FileText,
  Sparkles,
  Bell,
  Plus,
  Minus,
  ScanLine,
  Upload,
  X,
  Trash2,
  ChevronDown,
  User,
  Image as ImageIcon,
  Maximize,
  Eye,
  Tag,
  AlertCircle,
  Download
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useUIStore, useStudentStore, useTaskStore, useWrongQuestionStore, useExamStore } from './store'
import { getStudents, getTasksByStudent, getQuestionsByTask, addWrongQuestions, getWrongQuestionsByStudent, getExamsByStudent, getGeneratedExamsByStudent, getGeneratedExamById, createTask, updateTaskStatus, uploadImage, updateQuestion, updateQuestionTags, invalidateCache, createStudent, updateWrongQuestionStatus, getQuestionsByIds, deleteTask, deleteGeneratedExam, deleteWrongQuestion, getTaskById, recalculateTaskStats, clearStudentCaches, peekCache } from './services/apiService'
import { taskService } from './services/taskService'
import { recognizeQuestions, compressImage, saveRecognitionResult } from './services/aiService'
import { processMultiPagePaperLayout } from './services/paperBankAIService'
import { detectQRCode, groupFilesByQRCode } from './services/qrDetectionService'
import { downloadPaperWord } from './utils/docxGenerator'
import { mockQuestions, mockTasks, mockWrongQuestions, mockGeneratedExams, mockStudents } from './data/mockData'
import StudentSwitcher from './components/StudentSwitcher'
import SwipeableRow from './components/SwipeableRow'

import { useToast, ToastProvider } from './components/ToastProvider'
import dayjs from 'dayjs'
import RectCropper from './components/RectCropper'

// Lazy load non-critical pages with error handling
const lazyWithRetry = (factory) => {
  return lazy(() => {
    return factory().catch((err) => {
      console.error('Lazy load failed:', err)
      // Return a dummy module that renders an error UI
      return {
        default: () => (
          <div style={{
            position: 'fixed', inset: 0, background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: '16px', zIndex: 10000, padding: '20px'
          }}>
            <div style={{ fontSize: '16px', color: '#EF4444', textAlign: 'center' }}>
              页面加载失败，请刷新重试
            </div>
            <div style={{ fontSize: '12px', color: '#9CA3AF', textAlign: 'center' }}>
              如果问题持续，请清除浏览器缓存后重试
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 24px', background: '#2563EB', color: '#fff',
                borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: 600
              }}
            >
              刷新页面
            </button>
          </div>
        )
      }
    })
  })
}

const ScanQR = lazyWithRetry(() => import('./pages/ScanQR'))
const Grading = lazyWithRetry(() => import('./pages/Grading'))
const PrintPreview = lazyWithRetry(() => import('./pages/PrintPreview'))
const ExamReview = lazyWithRetry(() => import('./pages/ExamReview'))
const RetryTask = lazyWithRetry(() => import('./pages/RetryTask'))

// Simple Suspense fallback
const LazyFallback = () => (
  <div className="flex items-center justify-center p-8">
    <Loader2 size={24} className="animate-spin" style={{ color: '#9CA3AF' }} />
  </div>
)

// Task card skeleton for loading state
const TaskCardSkeleton = () => (
  <div style={{ padding: '8px 12px', borderRadius: '10px', background: '#fff', border: '1px solid #F3F4F6' }}>
    <div className="flex gap-2.5 items-center">
      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#F5F5F5' }} />
      <div className="flex-1">
        <div style={{ height: '13px', width: '60%', borderRadius: '6px', background: '#F3F4F6' }} />
        <div style={{ height: '11px', width: '40%', borderRadius: '4px', background: '#F9FAFB', marginTop: '6px' }} />
      </div>
    </div>
  </div>
)

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

// 错题重练任务入口路由：/retry-task/:id 仅渲染 RetryTask 页（二维码唯一入口）
const getRetryTaskIdFromPath = () => {
  const m = window.location.pathname.match(/^\/retry-task\/([0-9a-fA-F-]{36})$/)
  return m ? m[1] : null
}

function dataURLtoFile(dataUrl, filename) {
  const arr = dataUrl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new File([u8arr], filename, { type: mime })
}

// ==================== Main App ====================

const USE_MOCK_DATA = false

// 判断任务是否已完成批改（兼容不同状态值）
const isTaskCompleted = (task) => {
  return task.status === 'done' || task.status === 'graded' || task.status === 'completed' || task.status === 'reviewed' || !!task.result?.questionCount
}

export default function App() {
  // Store hooks
  const { currentPage, setCurrentPage } = useUIStore()
  const { students, currentStudent, setCurrentStudent, setStudents, addStudent } = useStudentStore()
  const { tasks, setTasks, addTask, updateTaskStatus: updateTaskInStore } = useTaskStore()
  const { wrongQuestions, setWrongQuestions, selectedQuestions, setSelectedQuestions, clearSelection, addWrongQuestion, addWrongQuestions: addMultipleToStore } = useWrongQuestionStore()
  const { exams, setExams, generatedExams, setGeneratedExams } = useExamStore()

  // 错题重练任务入口：pathname 命中 /retry-task/:id 时全屏渲染 RetryTask
  const [retryTaskId, setRetryTaskId] = useState(() => getRetryTaskIdFromPath())
  useEffect(() => {
    const onPop = () => setRetryTaskId(getRetryTaskIdFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Processing Page State
  const [processingFilter, setProcessingFilter] = useState('all')
  const [uploading, setUploading] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [uploadingTasks, setUploadingTasks] = useState([]) // Track uploading tasks for batch processing

  // Bank Page State
  const [bankFilter, setBankFilter] = useState('all')
  const [selectedSubject, setSelectedSubject] = useState('all')
  const [selectedTimeRange, setSelectedTimeRange] = useState('all')
  const [selectedErrorCount, setSelectedErrorCount] = useState('all')
  const [selectedTags, setSelectedTags] = useState([])
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)
  const [showPrintOptions, setShowPrintOptions] = useState(false)
  const [printMode, setPrintMode] = useState('all')
  const [printSize, setPrintSize] = useState('a4')
  const [showGrading, setShowGrading] = useState(false)
  const [showReprint, setShowReprint] = useState(false)
  const [reprintExam, setReprintExam] = useState(null)
  const [reprintQuestions, setReprintQuestions] = useState([])
  const [submitExamId, setSubmitExamId] = useState(null) // 正在上传答卷的组卷 id
  const submitFileInputRef = useRef(null)
  const submitTargetExamRef = useRef(null)

  // Exam Page State
  const [showScanQR, setShowScanQR] = useState(false) // QR scan trigger
  const [gradingData, setGradingData] = useState(null) // Data from scanned QR

  // UI State
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [showAddStudent, setShowAddStudent] = useState(false)
  const [showImagePreview, setShowImagePreview] = useState(false)
  const [previewImageUrl, setPreviewImageUrl] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
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
  const [uploadingImage, setUploadingImage] = useState(false)
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
  const [uploadingCrop, setUploadingCrop] = useState(false)
  const [showEditSourcePicker, setShowEditSourcePicker] = useState(false)
  const [loadingTaskImage, setLoadingTaskImage] = useState(false)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [printTarget, setPrintTarget] = useState(null)
  const [selectedImage, setSelectedImage] = useState(null)
  const [showImageViewer, setShowImageViewer] = useState(false)
  const [showExamReview, setShowExamReview] = useState(false)
  const [reviewTask, setReviewTask] = useState(null)
  const [showUploadOptions, setShowUploadOptions] = useState(false)

  // Paper Bank State
  const [paperBankStep, setPaperBankStep] = useState('list') // list | upload | processing | proofread | export
  const [paperBankPapers, setPaperBankPapers] = useState(() => {
    try {
      const cached = localStorage.getItem('paperbank_papers')
      return cached ? JSON.parse(cached) : []
    } catch { return [] }
  })

  // QR Detection State
  const [qrDetectionResults, setQrDetectionResults] = useState({})
  const [paperBankDraft, setPaperBankDraft] = useState(null)
  const [paperBankUploadedPages, setPaperBankUploadedPages] = useState([])
  const [paperBankReconstructedPages, setPaperBankReconstructedPages] = useState([]) // 存储每页原图+layoutBlocks
  const [paperBankProcessing, setPaperBankProcessing] = useState(false)
  const [paperBankProgress, setPaperBankProgress] = useState(0)
  const [paperBankProofreadMode, setPaperBankProofreadMode] = useState(false)
  const [paperBankInfo, setPaperBankInfo] = useState(null)
  const [editingBlock, setEditingBlock] = useState(null) // {pageNo, blockIndex} 当前编辑的区块
  const [paperBankCurrentPage, setPaperBankCurrentPage] = useState(0) // 当前校对页码（0-based）
  const [paperBankShowOriginal, setPaperBankShowOriginal] = useState(false) // 是否显示原图对比
  // 试卷入库视图响应式检测：基于实际容器宽度（适配手机模拟器）
  const paperBankContainerRef = useRef(null)
  const [paperBankNarrow, setPaperBankNarrow] = useState(false)
  
  useEffect(() => {
    if (!paperBankContainerRef.current) return
    const checkWidth = () => {
      const w = paperBankContainerRef.current?.getBoundingClientRect().width || 0
      setPaperBankNarrow(w < 768)
    }
    checkWidth()
    const observer = new ResizeObserver(checkWidth)
    observer.observe(paperBankContainerRef.current)
    return () => observer.disconnect()
  }, [paperBankStep])

  // Paper Bank Filter State
  const [paperBankFilterGrade, setPaperBankFilterGrade] = useState('all')
  const [paperBankFilterSubject, setPaperBankFilterSubject] = useState('all')
  const [paperBankSearchKeyword, setPaperBankSearchKeyword] = useState('')
  const [paperBankShowFilters, setPaperBankShowFilters] = useState(false)
  const [paperBankPreviewPaper, setPaperBankPreviewPaper] = useState(null)

  // 初始化状态
  const [isInitializing, setIsInitializing] = useState(true)
  const [uploadQueue, setUploadQueue] = useState([])
  const [isUploading, setIsUploading] = useState(false)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)

  // Toast
  const Toast = useToast()

  // Initialize students - fast path: load cache first, then refresh in background
  useEffect(() => {
    const init = async () => {
      try {
        if (USE_MOCK_DATA) {
          // Mock data path removed - using real API only
          setIsInitializing(false)
          return
        }
        
        // Try cache first for instant display
        const cached = localStorage.getItem('students_cache')
        if (cached) {
          try {
            const cachedData = JSON.parse(cached)
            if (Array.isArray(cachedData) && cachedData.length > 0) {
              setStudents(cachedData)
              
              // Restore last selected student
              const lastStudentId = localStorage.getItem('lastStudentId')
              const lastStudent = lastStudentId 
                ? cachedData.find(s => s.id === lastStudentId) 
                : null
              setCurrentStudent(lastStudent || cachedData[0])
              
              setIsInitializing(false)
              
              // Background refresh for fresh data
              getStudents(false).then(freshResult => {
                const freshList = freshResult.data || []
                if (Array.isArray(freshList) && freshList.length > 0) {
                  setStudents(freshList)
                  // Re-apply last student selection with fresh data
                  const freshLastStudent = lastStudentId 
                    ? freshList.find(s => s.id === lastStudentId) 
                    : null
                  if (freshLastStudent) {
                    setCurrentStudent(freshLastStudent)
                  }
                }
              }).catch(() => {})
              return
            }
          } catch (e) { /* ignore parse error */ }
        }
        
        // No cache — show mock data immediately, fetch real data in background
        setIsInitializing(false)
        setStudents(mockStudents)
        const lastStudentId = localStorage.getItem('lastStudentId')
        const initialStudent = lastStudentId
          ? mockStudents.find(s => s.id === lastStudentId)
          : null
        setCurrentStudent(initialStudent || mockStudents[0])

        getStudents(false).then(result => {
          const studentList = result.data || []
          if (Array.isArray(studentList) && studentList.length > 0) {
            setStudents(studentList)
            const freshLastStudent = lastStudentId
              ? studentList.find(s => s.id === lastStudentId)
              : null
            setCurrentStudent(freshLastStudent || studentList[0])
          }
        }).catch(err => {
          console.error('后台获取学生数据失败，保留模拟数据:', err)
        })
      } catch (error) {
        console.error('初始化失败:', error)
        setIsInitializing(false)
      }
    }
    init()
  }, [])

  // Persist last selected student
  useEffect(() => {
    if (currentStudent?.id) {
      localStorage.setItem('lastStudentId', currentStudent.id)
    }
  }, [currentStudent?.id])

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

  // Auto-refresh pending tasks every 30 seconds
  useEffect(() => {
    if (!currentStudent || currentPage !== 'processing') return

    const interval = setInterval(() => {
      const pendingTasks = (Array.isArray(tasks) ? tasks : []).filter(t => !isTaskCompleted(t))
      if (pendingTasks.length > 0) {
        // Only refresh if there are pending/processing tasks
        invalidateCache('tasks', currentStudent.id)
        loadTasks()
      }
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [currentStudent?.id, currentPage, tasks])


  // Load wrong questions
  useEffect(() => {
    if (currentStudent && currentPage === 'wrongbook') {
      loadWrongBookData()
    }
  }, [currentStudent?.id, currentPage])

  // Load exams
  useEffect(() => {
    if (currentStudent && currentPage === 'exam') {
      loadGeneratedExams(false, true) // 首次进入：先展示缓存再后台刷新
      const interval = setInterval(() => loadGeneratedExams(false), 3000)
      return () => clearInterval(interval)
    }
  }, [currentStudent?.id, currentPage])

  // Load questions for reprint — 始终从服务端获取最新 question_ids，防止缓存/列表数据过期
  useEffect(() => {
    if (reprintExam && reprintExam.question_ids?.length > 0) {
      const loadReprintQuestions = async () => {
        try {
          // 1) 用组卷 ID 从服务端拉取最新记录（确保 question_ids 是最新的）
          const freshExam = await getGeneratedExamById(reprintExam.id).catch(() => null)
          const questionIds = freshExam?.question_ids || reprintExam.question_ids
          // 2) 按最新的 question_ids 加载题目（不加 studentId，与移动端其他接口一致）
          const questions = await getQuestionsByIds(questionIds)
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

  // Processing: Load tasks（秒开策略：先展示本地缓存，再后台刷新）
  const loadTasks = async (showSkeleton = true) => {
    if (!currentStudent) return
    const studentId = currentStudent.id
    if (USE_MOCK_DATA) {
      setTasks(mockTasks.filter(t => t.student_id === studentId))
      return
    }
    // 1) 无视 TTL 先读缓存立即上屏（避免白屏等待网络）
    const cached = peekCache(`tasks_cache_${studentId}`)
    const hasCache = Array.isArray(cached) && cached.length > 0
    if (hasCache) setTasks(cached)
    if (showSkeleton && !hasCache) setIsLoadingTasks(true)
    // 2) 后台拉取最新数据覆盖
    try {
      const taskList = await getTasksByStudent(studentId, false)
      if (Array.isArray(taskList)) setTasks(taskList)
    } catch (error) {
      console.error('加载任务失败:', error)
      // Don't clear tasks on failure — keep showing existing data
    } finally {
      setIsLoadingTasks(false)
    }
  }

  // WrongBook: Load data（秒开策略：先展示本地缓存，再后台刷新）
  const loadWrongBookData = async () => {
    if (!currentStudent) return
    const studentId = currentStudent.id

    // 同一题目内容去重：保留上传时间最晚的一条
    const dedupByContent = (rawList) => {
      const contentDedupMap = new Map()
      for (const wq of rawList) {
        const question = wq.question || wq
        const content = (question.content || '').trim()
        if (!content) continue
        const existing = contentDedupMap.get(content)
        const curDate = wq.added_at || wq.created_at || ''
        const existDate = existing ? (existing.added_at || existing.created_at || '') : ''
        if (!existing || curDate > existDate) {
          contentDedupMap.set(content, wq)
        }
      }
      return Array.from(contentDedupMap.values())
    }

    if (USE_MOCK_DATA) {
      setWrongQuestions(mockWrongQuestions.filter(wq => wq.student_id === studentId))
      return
    }

    // 1) 先用缓存立即上屏
    const cached = peekCache(`wrong_questions_cache_${studentId}`)
    if (Array.isArray(cached) && cached.length > 0) {
      setWrongQuestions(dedupByContent(cached))
    }
    // 2) 后台拉取最新数据覆盖
    try {
      const data = await getWrongQuestionsByStudent(studentId, false)
      const rawList = Array.isArray(data) ? data : []
      const deduped = dedupByContent(rawList)
      if (deduped.length < rawList.length) {
        console.log(`错题本去重: ${rawList.length} → ${deduped.length} 条`)
      }
      setWrongQuestions(deduped)
    } catch (error) {
      console.error('加载错题失败:', error)
      // 网络失败时保留已展示的缓存数据
    }
  }

  // Exam: Load generated exams（秒开策略：先展示本地缓存，再后台刷新）
  const loadGeneratedExams = async (useCache = false, showCachedFirst = false) => {
    if (!currentStudent) return
    const studentId = currentStudent.id
    if (USE_MOCK_DATA) {
      setGeneratedExams(mockGeneratedExams.filter(e => e.student_id === studentId))
      return
    }
    if (showCachedFirst) {
      const cached = peekCache(`generated_exams_cache_${studentId}`)
      if (Array.isArray(cached) && cached.length > 0) setGeneratedExams(cached)
    }
    try {
      const examList = await getGeneratedExamsByStudent(studentId, useCache)
      if (Array.isArray(examList)) setGeneratedExams(examList)
    } catch (error) {
      console.error('加载试卷失败:', error)
      // 网络失败时保留已展示的数据
    }
  }

  // 处理上传队列
  useEffect(() => {
    if (uploadQueue.length > 0 && !isUploading && !isInitializing && currentStudent?.id) {
      processUploadQueue()
    }
  }, [uploadQueue, isUploading, isInitializing, currentStudent?.id])

  // 处理上传队列
  const processUploadQueue = async () => {
    if (uploadQueue.length === 0 || isUploading || !currentStudent?.id) return
    
    setIsUploading(true)
    const filesToUpload = [...uploadQueue]
    setUploadQueue([])
    
    try {
      if (USE_MOCK_DATA) {
        await uploadViaFrontend(filesToUpload)
      } else {
        await uploadViaBackend(filesToUpload)
      }
    } finally {
      setIsUploading(false)
    }
  }

  // Upload file handler with QR detection
  const handleFileSelect = async (e) => {
    console.debug('🔥🔥🔥🔥🔥 [UPLOAD] === handleFileSelect TRIGGERED === 🔥🔥🔥🔥🔥')
    try {
      const files = Array.from(e.target.files)
      console.debug('🔥🔥 [UPLOAD] Files received:', files.length, files.map(f => ({ name: f.name, size: f.size, type: f.type })))
      if (files.length === 0) {
        console.debug('🔥 [UPLOAD] No files selected, returning early')
        return
      }
      e.target.value = ''

      setShowUploadOptions(false)

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

      console.debug('🔥🔥 [UPLOAD] After dedup - newFiles:', newFiles.length, 'duplicateFiles:', duplicateFiles.length)

      if (duplicateFiles.length > 0) {
        Toast.show({ message: `${duplicateFiles.length} 个文件已存在，已自动跳过`, type: 'error' })
      }

      if (newFiles.length === 0) {
        console.debug('🔥🔥 [UPLOAD] No new files after dedup, returning')
        return
      }

      if (isInitializing) {
        console.debug('🔥 [UPLOAD] Initializing, adding to queue')
        Toast.show({ message: `正在初始化，已缓存 ${newFiles.length} 个文件，稍后自动上传...`, type: 'success', duration: 2000 })
        setUploadQueue(prev => [...prev, ...newFiles])
        return
      }

      if (!currentStudent || !currentStudent?.id) {
        console.debug('💥💥💥 [UPLOAD] BLOCKED: currentStudent is NULL or undefined!')
        Toast.show({ message: '请先选择学生后再上传试卷', type: 'error', duration: 3000 })
        return
      }

      console.debug('✅ [UPLOAD] currentStudent:', currentStudent.id, currentStudent.name)

      // Step 1: Detect QR codes for all files
      setUploading(true)
      Toast.show({ message: '正在检测二维码...', type: 'loading', duration: 0 })

      const filesWithQR = []
      for (const file of newFiles) {
        const qrContent = await detectQRCode(file)
        filesWithQR.push({ file, qrContent })
        console.debug(`🔍 [QR] File: ${file.name}, QR Content:`, qrContent)
      }

      // Step 2: Group files by QR code content
      const groupedFiles = groupFilesByQRCode(filesWithQR)
      console.debug('📁 [QR] Grouped files:', groupedFiles)

      // Step 3: Process each group
      for (const group of groupedFiles) {
        if (group.isRetryPaper && group.qrContent) {
          // Handle retry paper (group by QR content)
          await uploadRetryPaperGroup(group.files, group.qrContent)
        } else {
          // Handle regular homework (each file individually)
          for (const file of group.files) {
            await uploadRegularHomework(file)
          }
        }
      }

      setUploading(false)
    } catch (err) {
      console.error('💥💥💥💥💥 [UPLOAD] UNCAUGHT ERROR in handleFileSelect:', err)
      console.error('💥 [UPLOAD] Error stack:', err.stack)
      Toast.show({ message: `上传出错: ${err.message}`, type: 'error', duration: 5000 })
      setUploading(false)
    }
  }

  // Upload via backend API
  const uploadRetryPaperGroup = async (files, qrContent) => {
    console.debug('🔄 [UPLOAD] === Processing retry paper group ===')
    console.debug('🔄 [UPLOAD] QR Content:', qrContent)
    console.debug('🔄 [UPLOAD] Files count:', files.length)

    Toast.show({ message: `检测到错题重练卷，正在上传 ${files.length} 页...`, type: 'loading', duration: 0 })

    try {
      // Create a single task for the entire paper
      const tempTask = {
        id: `temp-retry-${Date.now()}`,
        student_id: currentStudent.id,
        original_name: `错题重练_${qrContent}_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}`,
        task_type: 'retry_paper',
        retry_paper_id: qrContent,
        pages: files.map((file, index) => ({
          id: `page-${index + 1}`,
          image_url: URL.createObjectURL(file),
          file_name: file.name,
          page_number: index + 1
        })),
        status: 'pending',
        created_at: new Date().toISOString(),
        isRetryPaper: true
      }

      // Add temp task to store
      addTask(tempTask)
      setUploadingTasks(prev => [...prev, tempTask.id])

      // Upload all files to backend as a batch
      const formData = new FormData()
      formData.append('studentId', currentStudent.id)
      formData.append('taskType', 'retry_paper')
      formData.append('retryPaperId', qrContent)

      files.forEach((file, index) => {
        formData.append(`files`, file)
        formData.append(`fileNames[${index}]`, file.name)
      })

      const result = await taskService.uploadFiles(currentStudent.id, files, {
        taskType: 'retry_paper',
        retryPaperId: qrContent
      })

      // Update task with real ID and status
      if (result.success && result.tasks && result.tasks.length > 0) {
        const updatedTask = result.tasks[0]
        updateTaskInStore(tempTask.id, 'processing', {
          id: updatedTask.id,
          generatedExamId: updatedTask.generated_exam_id
        })

        // Process the task (AI grading will handle retry paper logic)
        processTask(updatedTask)
      }

      Toast.show({ message: `错题重练卷上传成功！`, type: 'success', duration: 2000 })
    } catch (error) {
      console.error('💥 [uploadRetryPaperGroup] Error:', error)
      updateTaskInStore(tempTask.id, 'failed', { error: error.message || '上传失败' })
      Toast.show({ message: '错题重练卷上传失败', type: 'error', duration: 3000 })
    } finally {
      setUploadingTasks(prev => prev.filter(id => id !== tempTask.id))
    }
  }

  // Upload regular homework (single file)
  const uploadRegularHomework = async (file) => {
    console.debug('📝 [UPLOAD] === Processing regular homework ===')
    console.debug('📝 [UPLOAD] File:', file.name)

    try {
      if (USE_MOCK_DATA) {
        await uploadViaFrontend([file])
      } else {
        await uploadViaBackend([file])
      }
    } catch (error) {
      console.error('💥 [uploadRegularHomework] Error:', error)
      Toast.show({ message: `作业上传失败: ${error.message}`, type: 'error', duration: 3000 })
    }
  }

  // Upload via backend API
  const uploadViaBackend = async (files) => {
    console.debug('📤📤📤 [uploadViaBackend] STARTING with', files.length, 'files')
    console.debug('📤 [uploadViaBackend] currentStudent:', currentStudent?.id, currentStudent?.name)
    
    const pendingTasks = []
    
    files.forEach((file) => {
      const tempTask = {
        id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        student_id: currentStudent.id,
        image_url: URL.createObjectURL(file),
        original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
        task_type: 'homework',
        status: 'pending',
        result: { progress: 0 },
        created_at: new Date().toISOString(),
        is_temp: true
      }
      addTask(tempTask)
      pendingTasks.push({ tempTask, file })
    })

    console.debug('📤 [uploadViaBackend] Created', pendingTasks.length, 'temp tasks')

    clearStudentCaches(currentStudent.id)
    
    Toast.show({ message: `已添加 ${files.length} 个文件，正在上传...`, type: 'success', duration: 2000 })

    let successCount = 0
    let failedCount = 0

    // 批量上传所有文件（单次请求）
    try {
      const files = pendingTasks.map(p => p.file)
      const result = await taskService.uploadFiles(currentStudent.id, files)
      const tasks = result.tasks || []

      tasks.forEach((taskResult, idx) => {
        const tempTask = pendingTasks[idx]?.tempTask
        if (!tempTask) return

        if (taskResult.error) {
          failedCount++
          const errorMsg = taskResult.message || taskResult.error || '上传失败'
          updateTaskInStore(tempTask.id, 'failed', { error: errorMsg })
        } else {
          successCount++
          updateTaskInStore(tempTask.id, 'pending', { progress: 0 })
          setTasks(prev => prev.map(t =>
            t.id === tempTask.id ? { ...taskResult, is_temp: false } : t
          ))
        }
      })
    } catch (error) {
      console.error('💥 [uploadViaBackend] Batch upload exception:', error)
      pendingTasks.forEach(({ tempTask }) => {
        failedCount++
        updateTaskInStore(tempTask.id, 'failed', { error: error.message || '上传失败' })
      })
    }

    // 上传完成后刷新缓存并重新加载列表
    if (successCount > 0) {
      console.debug('🔄 [uploadViaBackend] Invalidating cache and reloading tasks')
      invalidateCache('tasks', currentStudent.id)
      loadTasks()
    }

    if (failedCount > 0) {
      Toast.show({ message: `${successCount} 个成功，${failedCount} 个失败`, type: 'error', duration: 3000 })
    } else if (successCount > 0) {
      Toast.show({ message: `${successCount} 个文件上传成功！`, type: 'success', duration: 2000 })
    }

    console.debug('📤📤📤 [uploadViaBackend] COMPLETED - success:', successCount, 'failed:', failedCount)
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
          task_type: 'homework',
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
    if (processingFilter === 'done') return isTaskCompleted(t)
    if (processingFilter === 'pending') return !isTaskCompleted(t)
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
    if (bankFilter !== 'all') {
      const ls = wq.lifecycle_status || 'new'
      if (bankFilter === 'new' && ls !== 'new') return false
      if (bankFilter === 'review' && ls !== 'review_1' && ls !== 'review_2') return false
      if (bankFilter === 'mastered' && ls !== 'mastered') return false
    }
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
      // For local-only temp tasks (upload failed/never synced), skip API call
      if (typeof taskId === 'string' && taskId.startsWith('temp-')) {
        setTasks((Array.isArray(tasks) ? tasks : []).filter(t => t.id !== taskId))
        invalidateCache('tasks', currentStudent?.id)
        Toast.show({ message: '删除成功', type: 'success' })
        return
      }
      await deleteTask(taskId)
      setTasks((Array.isArray(tasks) ? tasks : []).filter(t => t.id !== taskId))
      invalidateCache('tasks', currentStudent?.id)
      Toast.show({ message: '删除成功', type: 'success' })
    } catch (error) {
      console.error('删除失败:', error)
      Toast.show({ message: '删除失败', type: 'error' })
    }
  }

  // Download exam as PDF — 改用 PrintPreview 组件
  const handleDownloadPdf = async (exam) => {
    handleReprintExam(exam)
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

  const handleScanSuccess = (scanData) => {
    setShowScanQR(false)
    // 新格式：扫码内容含 /retry-task/{id} → 进入「任务入口页」（二维码只定位 task，不进批改页）
    if (scanData?.retryTaskId) {
      window.history.pushState({ retryTask: scanData.retryTaskId }, '', `/retry-task/${scanData.retryTaskId}`)
      setRetryTaskId(scanData.retryTaskId)
      return
    }
    // 旧格式：MXG:<id> → 沿用原有批改流程
    setGradingData(scanData)
    setShowGrading(true)
  }

  const handleGradingComplete = (results) => {
    setShowGrading(false)
    setGradingData(null)
    Toast.show({ message: `批改完成，${results.masteredCount} 题已掌握`, type: 'success' })
    loadWrongBookData()
  }

  // ==================== Paper Bank Handlers ====================

  // Utility: Convert File to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      // Check file size - limit to 10MB
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error('图片过大（超过10MB），请选择较小的图片'))
        return
      }

      const reader = new FileReader()
      reader.onloadend = () => {
        const base64String = reader.result
        if (base64String && typeof base64String === 'string') {
          resolve(base64String)
        } else {
          reject(new Error('Failed to convert file to base64'))
        }
      }
      reader.onerror = () => reject(new Error('FileReader error'))
      reader.readAsDataURL(file)
    })
  }

  // Persist paper bank papers
  useEffect(() => {
    try {
      localStorage.setItem('paperbank_papers', JSON.stringify(paperBankPapers))
    } catch (e) { /* ignore */ }
  }, [paperBankPapers])

  // Paper Bank: Handle file select for upload
  const handlePaperBankFileSelect = async (e) => {
    const files = Array.from(e.target?.files || [])
    if (files.length === 0) return

    try {
      // Convert all files to base64 immediately
      const pages = await Promise.all(
        files.map(async (file, index) => ({
          id: `page_${Date.now()}_${index}`,
          name: file.name,
          imageUrl: URL.createObjectURL(file),
          imageBase64: await fileToBase64(file),
          file: file
        }))
      )

      setPaperBankUploadedPages(prev => [...prev, ...pages])
      Toast.show({ message: `已添加${files.length}页`, type: 'success', duration: 1500 })
    } catch (error) {
      console.error('[PaperBank] 文件选择失败:', error)
      Toast.show({ message: '文件读取失败', type: 'error', duration: 2000 })
    }
  }

  // Paper Bank: Remove uploaded page
  const handlePaperBankRemovePage = (pageId) => {
    setPaperBankUploadedPages(prev => prev.filter(p => p.id !== pageId))
  }

  // Paper Bank: Start AI processing (Layout Analysis mode)
  const handlePaperBankStartProcessing = async () => {
    if (paperBankUploadedPages.length === 0) {
      Toast.show({ message: '请先上传试卷', type: 'error', duration: 2000 })
      return
    }

    // Validate base64 data
    const validPages = paperBankUploadedPages.filter(p => p.imageBase64)
    if (validPages.length === 0) {
      Toast.show({ message: '图片数据无效，请重新上传', type: 'error', duration: 2000 })
      return
    }

    setPaperBankProcessing(true)
    setPaperBankProgress(0)
    setPaperBankStep('processing')

    try {
      // Update progress during processing
      let currentProgress = 10
      const progressInterval = setInterval(() => {
        currentProgress += Math.random() * 5
        if (currentProgress < 90) {
          setPaperBankProgress(currentProgress)
        }
      }, 1000)

      // Call AI layout analysis service
      const result = await processMultiPagePaperLayout(validPages)

      clearInterval(progressInterval)
      setPaperBankProgress(100)

      if (result.success) {
        const info = result.data.paperInfo || {}
        const pageResults = result.data.pageResults || []

        // Store reconstructed pages with original images and layout blocks
        setPaperBankReconstructedPages(pageResults)

        // Set extracted info
        setPaperBankInfo({
          name: info.name || paperBankUploadedPages[0]?.name?.replace(/\.[^.]+$/, '') || '未命名试卷',
          subject: info.subject || '',
          grade: info.grade || '',
          examType: info.examType || '',
          schoolYear: info.schoolYear || '',
          semester: info.semester || ''
        })

        // Move to proofread step
        setTimeout(() => {
          setPaperBankStep('proofread')
        }, 500)
      } else {
        Toast.show({ message: result.error || 'AI识别失败', type: 'error', duration: 3000 })
        setPaperBankStep('upload')
      }
    } catch (error) {
      console.error('[PaperBank] AI处理失败:', error)
      Toast.show({ message: '处理失败，请重试', type: 'error', duration: 3000 })
      setPaperBankStep('upload')
    } finally {
      setPaperBankProcessing(false)
    }
  }

  // Paper Bank: Download Word file
  const handlePaperBankDownloadWord = async () => {
    if (!paperBankInfo) return
    
    const paperData = {
      name: paperBankInfo.name,
      subject: paperBankInfo.subject,
      grade: paperBankInfo.grade,
      examType: paperBankInfo.examType,
      pages: paperBankReconstructedPages
    }
    
    try {
      Toast.show({ message: '正在生成Word...', type: 'loading', duration: 0 })
      await downloadPaperWord(paperData, paperBankInfo.name)
      Toast.dismiss()
      Toast.show({ message: 'Word已下载！', type: 'success', duration: 2000 })
    } catch (error) {
      console.error('[PaperBank] Word生成失败:', error)
      Toast.dismiss()
      Toast.show({ message: 'Word生成失败：' + error.message, type: 'error', duration: 3000 })
    }
  }

  // Paper Bank: Finalize paper (save to bank)
  const handlePaperBankFinalize = () => {
    if (!paperBankInfo) return

    const newPaper = {
      id: `paper_${Date.now()}`,
      name: paperBankInfo.name,
      subject: paperBankInfo.subject,
      grade: paperBankInfo.grade,
      examType: paperBankInfo.examType,
      schoolYear: paperBankInfo.schoolYear,
      semester: paperBankInfo.semester,
      pages: paperBankReconstructedPages.map(p => ({
        pageNo: p.pageNo,
        originalImage: p.originalImage,
        layoutBlocks: p.layoutBlocks
      })),
      totalPages: paperBankReconstructedPages.length,
      thumbnail: paperBankReconstructedPages[0]?.originalImage || '',
      createdAt: new Date().toISOString()
    }

    setPaperBankPapers(prev => [newPaper, ...prev])
    Toast.show({ message: '试卷入库成功！', type: 'success', duration: 2000 })

    // Reset
    setPaperBankStep('list')
    setPaperBankUploadedPages([])
    setPaperBankReconstructedPages([])
    setPaperBankDraft(null)
    setPaperBankInfo(null)
    setEditingBlock(null)
  }

  // Paper Bank: Reset to upload
  const handlePaperBankReset = () => {
    setPaperBankStep('upload')
    setPaperBankUploadedPages([])
    setPaperBankReconstructedPages([])
    setPaperBankDraft(null)
    setPaperBankInfo(null)
    setEditingBlock(null)
    setPaperBankCurrentPage(0)
    setPaperBankShowOriginal(false)
    setPaperBankProofreadMode(false)
  }

  // Paper Bank: Delete paper from bank
  const handlePaperBankDelete = (paperId) => {
    setPaperBankPapers(prev => prev.filter(p => p.id !== paperId))
    Toast.show({ message: '已删除', type: 'success', duration: 1500 })
  }

  // Paper Bank: Handle block edit
  const handleBlockEdit = (pageNo, blockIndex) => {
    setEditingBlock({ pageNo, blockIndex })
  }

  // Paper Bank: Update block content
  const handleBlockUpdate = (pageNo, blockIndex, newContent) => {
    setPaperBankReconstructedPages(prev => 
      prev.map(page => 
        page.pageNo === pageNo
          ? {
              ...page,
              layoutBlocks: page.layoutBlocks.map((block, idx) =>
                idx === blockIndex ? { ...block, content: newContent } : block
              )
            }
          : page
      )
    )
    setEditingBlock(null)
  }

  // Paper Bank: Render a single block with full paper layout styling
  const renderBlock = (block, pageNo, blockIndex) => {
    const isEditing = editingBlock?.pageNo === pageNo && editingBlock?.blockIndex === blockIndex
    const isLowConfidence = block.confidence !== undefined && block.confidence < 0.7
    
    const editableContent = (
      <div 
        className={`cursor-pointer rounded transition-colors ${isLowConfidence ? 'bg-amber-50 border border-amber-300 px-1' : 'hover:bg-blue-50/50'}`}
        onClick={() => !isEditing && handleBlockEdit(pageNo, blockIndex)}
      >
        {isEditing ? (
          <textarea
            value={block.content || ''}
            onChange={(e) => handleBlockUpdate(pageNo, blockIndex, e.target.value)}
            className="w-full p-2 text-sm border-2 border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
            style={{ minHeight: '60px', lineHeight: '1.6' }}
            autoFocus
            onBlur={() => setEditingBlock(null)}
          />
        ) : (
          <div className="flex items-start gap-1">
            <span>{block.content}</span>
            {isLowConfidence && (
              <span className="inline-flex items-center gap-0.5 text-amber-600 text-[10px] ml-1 shrink-0" title={`置信度: ${Math.round(block.confidence * 100)}%`}>
                <AlertCircle size={10} />
              </span>
            )}
          </div>
        )}
      </div>
    )

    switch (block.type) {
      case 'title':
        return (
          <div className="text-center py-3" style={block.style || {}}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', lineHeight: '1.3', color: '#111827' }}>
              {editableContent}
            </div>
          </div>
        )
      case 'subtitle':
        return (
          <div className="text-center py-1" style={block.style || {}}>
            <div style={{ fontSize: '13px', color: '#6B7280', lineHeight: '1.4' }}>
              {editableContent}
            </div>
          </div>
        )
      case 'section':
        return (
          <div className="mt-6 mb-3" style={block.style || {}}>
            <div className="flex items-center gap-2">
              <div style={{ width: '3px', height: '18px', background: '#111827', borderRadius: '2px' }} />
              <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#111827', lineHeight: '1.4' }}>
                {editableContent}
              </div>
            </div>
            <div className="mt-2" style={{ borderBottom: '1.5px solid #D1D5DB' }} />
          </div>
        )
      case 'question':
        return (
          <div className="mb-3" style={block.style || {}}>
            <div style={{ fontSize: '14px', lineHeight: '1.7', color: '#1F2937' }}>
              {editableContent}
            </div>
            {block.options && block.options.length > 0 && (
              <div className="mt-2 ml-4">
                {block.options.map((opt, optIdx) => (
                  <div 
                    key={optIdx}
                    className="cursor-pointer rounded px-1 py-0.5 hover:bg-blue-50/50"
                    onClick={() => {
                      const newOptions = [...block.options]
                      const newContent = newOptions[optIdx]
                      setEditingBlock({ pageNo, blockIndex, optionIndex: optIdx })
                      // For simplicity, edit the whole option
                    }}
                  >
                    <span style={{ fontSize: '13px', lineHeight: '1.6', color: '#374151' }}>
                      {opt}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      case 'text':
        return (
          <div className="mb-2" style={block.style || {}}>
            <div style={{ fontSize: '14px', lineHeight: '1.7', color: '#374151' }}>
              {editableContent}
            </div>
          </div>
        )
      case 'image': {
        // 有原图（局部截图）→ 显示原图；无原图 → 占位符
        return (
          <div className="my-3 text-center">
            {block.src ? (
              // 显示截取的局部图 - 永不丢弃
              <div className="inline-block">
                <img 
                  src={block.src} 
                  alt={block.caption || '题目配图'}
                  className="rounded border border-gray-200 max-w-full"
                  style={{ maxHeight: '220px', objectFit: 'contain' }}
                />
                {block.caption && (
                  <div className="text-xs text-gray-500 mt-1 text-center">{block.caption}</div>
                )}
              </div>
            ) : (
              // 占位符 - AI未检测到图形区域
              <div className="inline-flex flex-col items-center gap-1 px-3 py-2 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50">
                <ImageIcon size={16} style={{ color: '#D97706' }} />
                <span className="text-xs text-amber-600">
                  {block.caption ? `[图: ${block.caption}]` : '[图片区域]'}
                </span>
                <span className="text-[10px] text-amber-400">AI未检测到此区域，请手动插入</span>
              </div>
            )}
          </div>
        )
      }
      case 'table':
        if (!block.rows || block.rows.length === 0) return null
        return (
          <div className="my-4 overflow-x-auto">
            <table className="w-full border-collapse border border-gray-400 text-sm">
              <tbody>
                {block.rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, cellIdx) => (
                      <td 
                        key={cellIdx} 
                        className="border border-gray-400 px-3 py-2"
                        style={{ fontSize: '13px', lineHeight: '1.5' }}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'footer':
        return (
          <div className="text-center py-3 mt-4" style={{ borderTop: '1px solid #E5E7EB' }}>
            <div style={{ fontSize: '11px', color: '#9CA3AF' }}>
              {editableContent}
            </div>
          </div>
        )
      default:
        return (
          <div className="mb-2" style={block.style || {}}>
            <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#374151' }}>
              {editableContent}
            </div>
          </div>
        )
    }
  }

  // Paper Bank: Render a full page of the reconstructed paper
  const renderReconstructedPage = (page) => {
    return (
      <div 
        className="bg-white rounded-lg shadow-sm overflow-hidden"
        style={{ 
          border: '1px solid #E5E7EB',
          marginBottom: '16px',
          minHeight: '600px'
        }}
      >
        {/* Page content */}
        <div className="p-6">
          {page.layoutBlocks && page.layoutBlocks.length > 0 ? (
            page.layoutBlocks.map((block, idx) => (
              <div key={idx}>
                {renderBlock(block, page.pageNo, idx)}
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-gray-400 text-sm">
              {page.error ? `识别失败：${page.error}` : '该页未识别到内容'}
            </div>
          )}
        </div>
        {/* Page number footer */}
        <div className="text-center py-2 text-xs text-gray-400" style={{ borderTop: '1px solid #F3F4F6' }}>
          — {page.pageNo} —
        </div>
      </div>
    )
  }

  // Paper Bank: Print paper (supports structured pages with layoutBlocks)
  const handlePaperBankPrint = async (paper) => {
    try {
      Toast.show({ message: '正在生成PDF...', type: 'loading', duration: 0 })
      setPaperBankPreviewPaper(paper)

      // Use html2canvas + jsPDF directly for raw text content
      const html2canvas = (await import('html2canvas')).default
      const jsPDF = (await import('jspdf')).default

      // Build block rendering helper
      function renderBlockToHTML(block) {
        switch (block.type) {
          case 'title':
            return `<div class="block-title">${escapeHtml(block.content)}</div>`
          case 'subtitle':
            return `<div class="block-subtitle">${escapeHtml(block.content)}</div>`
          case 'section':
            return `<div class="block-section">${escapeHtml(block.content)}</div>`
          case 'question':
            let qHTML = `<div class="block-question">${escapeHtml(block.content)}`
            if (block.options && block.options.length > 0) {
              qHTML += `<div class="block-options">`
              block.options.forEach(opt => {
                qHTML += `<div class="block-option">${escapeHtml(opt)}</div>`
              })
              qHTML += `</div>`
            }
            qHTML += `</div>`
            return qHTML
          case 'text':
            return `<div class="block-text">${escapeHtml(block.content)}</div>`
          case 'image': {
            if (block.src) {
              return `<div class="block-image" style="text-align:center;"><img src="${block.src}" alt="${escapeHtml(block.caption || '')}" style="max-width:100%;display:block;margin:8px auto;" />${block.caption ? `<div style="font-size:10px;color:#666;">${escapeHtml(block.caption)}</div>` : ''}</div>`
            }
            return `<div class="block-image" style="text-align:center;color:#999;font-style:italic;">[图: ${escapeHtml(block.caption || '待插入')}]</div>`
          }
          case 'table':
            if (!block.rows || block.rows.length === 0) return ''
            let tHTML = `<table class="block-table"><tbody>`
            block.rows.forEach(row => {
              tHTML += `<tr>`
              row.forEach(cell => {
                tHTML += `<td>${escapeHtml(cell)}</td>`
              })
              tHTML += `</tr>`
            })
            tHTML += `</tbody></table>`
            return tHTML
          case 'footer':
            return `<div class="block-footer">${escapeHtml(block.content)}</div>`
          default:
            return `<div class="block-text">${escapeHtml(block.content || '')}</div>`
        }
      }

      // Build paper content HTML from pages with layoutBlocks
      let pagesHTML = ''
      
      if (paper.pages && paper.pages.length > 0) {
        // New structured format with pages and layoutBlocks
        paper.pages.forEach((page, pageIdx) => {
          pagesHTML += `<div class="paper-page">`
          if (pageIdx === 0) {
            pagesHTML += `<div class="paper-title">${escapeHtml(paper.name)}</div>`
            pagesHTML += `<div class="paper-info">${[paper.subject, paper.grade, paper.examType].filter(Boolean).join(' · ') || ''}</div>`
            pagesHTML += `<div class="divider"></div>`
          }
          if (page.layoutBlocks && page.layoutBlocks.length > 0) {
            page.layoutBlocks.forEach(block => {
              pagesHTML += renderBlockToHTML(block)
            })
          }
          pagesHTML += `<div class="footer">- ${page.pageNo} -</div>`
          pagesHTML += `</div>`
        })
      } else if (paper.content) {
        // Legacy format with plain text content
        pagesHTML = `<div class="paper-page">
          <div class="paper-title">${escapeHtml(paper.name)}</div>
          <div class="paper-info">${[paper.subject, paper.grade, paper.examType].filter(Boolean).join(' · ') || ''}</div>
          <div class="divider"></div>
          <div class="paper-content">${escapeHtml(paper.content).replace(/\n/g, '<br>')}</div>
          <div class="footer">- 试卷资源库 · ${dayjs(paper.createdAt).format('YYYY/MM/DD')} -</div>
        </div>`
      }

      const paperHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC','SimSun',sans-serif;color:#1a1a1a}
        .paper-page{width:794px;padding:40px 60px;page-break-after:always}
        .paper-page:last-child{page-break-after:auto}
        .paper-title{text-align:center;font-size:24px;font-weight:bold;margin-bottom:8px}
        .paper-info{text-align:center;font-size:13px;color:#666;margin-bottom:16px}
        .divider{border-top:2px solid #333;margin:12px 0 20px}
        .paper-content{font-size:14px;line-height:2;white-space:pre-wrap;word-break:break-all}
        .block-title{text-align:center;font-size:22px;font-weight:bold;margin-bottom:12px}
        .block-subtitle{text-align:center;font-size:13px;color:#666;margin-bottom:12px}
        .block-section{font-size:16px;font-weight:bold;margin:20px 0 10px;border-left:3px solid #333;padding-left:8px}
        .block-question{font-size:14px;line-height:1.8;margin-bottom:8px}
        .block-options{margin:8px 0 8px 20px}
        .block-option{font-size:14px;line-height:1.6}
        .block-text{font-size:14px;line-height:1.8;margin-bottom:8px}
        .block-image{margin:12px 0;text-align:center}
        .block-table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
        .block-table td{border:1px solid #333;padding:6px 8px}
        .block-footer{text-align:center;font-size:11px;color:#999;margin-top:20px;padding-top:8px;border-top:1px solid #ddd}
        .footer{text-align:center;font-size:11px;color:#999;margin-top:30px;padding-top:8px;border-top:1px solid #ddd}
      </style></head><body>
        ${pagesHTML}
      </body></html>`

      const container = document.createElement('div')
      container.innerHTML = paperHTML
      container.style.position = 'absolute'
      container.style.left = '-9999px'
      container.style.top = '0'
      container.style.width = '794px'
      document.body.appendChild(container)

      try {
        const canvas = await html2canvas(container, {
          scale: 2,
          useCORS: true,
          logging: false,
          width: 794,
          height: container.scrollHeight,
        })

        const imgData = canvas.toDataURL('image/jpeg', 0.92)
        const A4_W = 210
        const A4_H = 297
        const pageH = (794 / A4_W) * A4_H
        const totalPages = Math.ceil(canvas.height / pageH)

        const doc = new jsPDF('p', 'mm', 'a4')

        for (let p = 0; p < totalPages; p++) {
          if (p > 0) doc.addPage()
          const srcY = p * pageH
          const sliceH = Math.min(pageH, canvas.height - srcY)

          const pageCanvas = document.createElement('canvas')
          pageCanvas.width = canvas.width
          pageCanvas.height = sliceH
          const ctx = pageCanvas.getContext('2d')
          ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH)

          const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
          const mmH = (sliceH / canvas.width) * A4_W
          doc.addImage(pageImg, 'JPEG', 0, 0, A4_W, mmH)
        }

        const filename = `${paper.name || '试卷'}_${dayjs().format('YYYYMMDD')}`
        doc.save(`${filename}.pdf`)
        Toast.dismiss()
        Toast.show({ message: 'PDF已生成，请在下载目录查看', type: 'success', duration: 2000 })
      } finally {
        document.body.removeChild(container)
      }
    } catch (error) {
      console.error('[PaperBank] PDF生成失败:', error)
      Toast.dismiss()
      Toast.show({ message: 'PDF生成失败，请重试', type: 'error', duration: 3000 })
    } finally {
      setPaperBankPreviewPaper(null)
    }
  }

  // Escape HTML helper
  const escapeHtml = (text) => {
    if (!text) return ''
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // Paper Bank: Clear all filters
  const handlePaperBankClearFilters = () => {
    setPaperBankFilterGrade('all')
    setPaperBankFilterSubject('all')
    setPaperBankSearchKeyword('')
  }

  // Paper Bank: Get unique grades and subjects from papers
  const paperBankGrades = Array.from(new Set(paperBankPapers.map(p => p.grade).filter(Boolean)))
  const paperBankSubjects = Array.from(new Set(paperBankPapers.map(p => p.subject).filter(Boolean)))

  // Paper Bank: Filtered papers
  const filteredPaperBankPapers = paperBankPapers.filter(paper => {
    if (paperBankFilterGrade !== 'all' && paper.grade !== paperBankFilterGrade) return false
    if (paperBankFilterSubject !== 'all' && paper.subject !== paperBankFilterSubject) return false
    if (paperBankSearchKeyword) {
      const keyword = paperBankSearchKeyword.toLowerCase()
      const matchName = paper.name?.toLowerCase().includes(keyword)
      const matchContent = paper.content?.toLowerCase().includes(keyword)
      if (!matchName && !matchContent) return false
    }
    return true
  })

  const hasActiveFilters = paperBankFilterGrade !== 'all' || paperBankFilterSubject !== 'all' || paperBankSearchKeyword

  // Reprint exam
  const handleReprintExam = (exam) => {
    setReprintExam(exam)
    setShowReprint(true)
  }

  // 提交作业：上传该组卷的答卷图，走错题重练批改流程（与二维码入口一致）
  const handleSubmitExam = (exam) => {
    submitTargetExamRef.current = exam
    submitFileInputRef.current?.click()
  }

  const handleSubmitFilesSelected = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const exam = submitTargetExamRef.current
    if (!exam || files.length === 0) return
    const studentId = exam.student_id || currentStudent?.id
    if (!studentId) {
      Toast.show({ message: '缺少学生信息，无法提交', type: 'error' })
      return
    }
    setSubmitExamId(exam.id)
    const loadingToast = Toast.show({ message: '正在上传答卷...', type: 'loading', duration: 0 })
    try {
      const res = await taskService.uploadFiles(studentId, files, {
        generatedExamId: exam.id,
        taskType: 'wrong_retry'
      })
      const created = (res?.tasks || []).filter(t => !t.error)
      if (created.length === 0) throw new Error(res?.report?.summary || '上传失败')
      loadingToast?.dismiss?.()
      Toast.show({ message: '答卷已提交，开始批改', type: 'success', duration: 2000 })
      loadGeneratedExams(false)
    } catch (error) {
      console.error('提交作业失败:', error)
      loadingToast?.dismiss?.()
      Toast.show({ message: error.message || '提交失败，请重试', type: 'error', duration: 3000 })
    } finally {
      setSubmitExamId(null)
      submitTargetExamRef.current = null
    }
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
    const currentLs = wq.lifecycle_status || 'new'
    let nextLs
    switch (currentLs) {
      case 'new':
        nextLs = 'review_1'
        break
      case 'review_1':
        nextLs = 'review_2'
        break
      case 'review_2':
        nextLs = 'mastered'
        break
      case 'mastered':
        nextLs = 'new'
        break
      default:
        nextLs = 'new'
    }
    const nextStatus = nextLs === 'mastered' ? 'mastered' : 'pending'

    try {
      await updateWrongQuestionStatus(wq.id, nextStatus, { lifecycle_status: nextLs })
      loadWrongBookData()
      const statusText = { new: '不懂', review_1: '略懂', review_2: '略懂', mastered: '完全懂' }
      Toast.show({ message: `已标记为${statusText[nextLs]}`, type: 'success' })
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

  // 全选/取消全选当前筛选出的题目
  const handleSelectAll = () => {
    const filteredIds = filteredWrongQuestions.map(wq => wq.id)
    const allSelected = filteredWrongQuestions.length > 0 && filteredWrongQuestions.every(wq => selectedQuestions.find(sq => sq.id === wq.id))
    if (allSelected) {
      setSelectedQuestions(selectedQuestions.filter(sq => !filteredIds.includes(sq.id)))
    } else {
      const existingIds = new Set(selectedQuestions.map(sq => sq.id))
      const toAdd = filteredWrongQuestions.filter(wq => !existingIds.has(wq.id))
      setSelectedQuestions([...selectedQuestions, ...toAdd])
    }
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

  // Open edit source picker
  const handleOpenEditSourcePicker = () => {
    setShowEditSourcePicker(true)
  }

  // Handle file selected for cropping
  const handleEditFileSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!file.type.startsWith('image/')) {
      Toast.show({ message: '请选择图片文件', type: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      setCropImage(ev.target.result)
      setShowImageCrop(true)
      setShowEditSourcePicker(false)
    }
    reader.onerror = () => {
      Toast.show({ message: '图片读取失败', type: 'error' })
    }
    reader.readAsDataURL(file)
  }

  // Crop from original task image
  const handleCropFromTask = async () => {
    const question = editingQuestionItem?.question || editingQuestionItem
    if (!question?.task_id) {
      Toast.show({ message: '未找到原试卷信息', type: 'error' })
      return
    }
    setLoadingTaskImage(true)
    setShowEditSourcePicker(false)
    try {
      const task = await getTaskById(question.task_id)
      if (!task?.image_url) {
        Toast.show({ message: '原试卷无图片', type: 'error' })
        return
      }
      setCropImage(task.image_url)
      setShowImageCrop(true)
    } catch (error) {
      console.error('获取原试卷图片失败:', error)
      Toast.show({ message: '获取原试卷失败', type: 'error' })
    } finally {
      setLoadingTaskImage(false)
    }
  }

  // Crop from upload
  const handleCropFromUpload = () => {
    setShowEditSourcePicker(false)
    const el = document.getElementById('edit-image-file-input')
    if (el) el.click()
  }

  // Confirm crop - receives dataUrl from RectCropper
  const handleCropConfirm = async (dataUrl) => {
    if (!dataUrl) return
    setUploadingCrop(true)
    try {
      const file = dataURLtoFile(dataUrl, 'question_image.jpg')
      const url = await uploadImage(file)
      updateEditForm('image_url', url)
      setShowImageCrop(false)
      setCropImage(null)
      Toast.show({ message: '图片裁剪上传成功', type: 'success' })
    } catch (error) {
      console.error('裁剪/上传失败:', error)
      Toast.show({ message: '图片处理失败', type: 'error' })
    } finally {
      setUploadingCrop(false)
    }
  }

  // Cancel crop
  const handleCropCancel = () => {
    setShowImageCrop(false)
    setCropImage(null)
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

  // Manual refresh
  const handleRefresh = async () => {
    if (!currentStudent) {
      Toast.show({ message: '请先选择学生', type: 'error', duration: 1500 })
      return
    }
    setRefreshing(true)
    try {
      invalidateCache('students')
      invalidateCache('tasks', currentStudent.id)
      invalidateCache('wrong', currentStudent.id)
      invalidateCache('exams', currentStudent.id)
      invalidateCache('generated', currentStudent.id)

      // 重新计算所有已批改任务的统计数据
      if (currentPage === 'processing') {
        const taskList = await getTasksByStudent(currentStudent.id, false)
        const doneTasks = (Array.isArray(taskList) ? taskList : []).filter(t => isTaskCompleted(t))
        // 并行刷新所有已批改任务的统计
        await Promise.allSettled(doneTasks.map(t => recalculateTaskStats(t.id)))
        // 重新加载任务数据
        setTasks(doneTasks.length > 0 ? taskList : [])
        // 重新从服务器获取以获取更新后的 result
        const freshTasks = await getTasksByStudent(currentStudent.id, false)
        setTasks(Array.isArray(freshTasks) ? freshTasks : [])
      } else if (currentPage === 'wrongbook') {
        await loadWrongBookData()
      } else if (currentPage === 'exam') {
        await loadGeneratedExams(false)
      }
      Toast.show({ message: '刷新成功', type: 'success', duration: 1500 })
    } catch (error) {
      console.error('刷新失败:', error)
      Toast.show({ message: '刷新失败，请重试', type: 'error', duration: 2000 })
    } finally {
      setRefreshing(false)
    }
  }

  // Retry a pending/failed task
  const handleRetryTask = async (taskId) => {
    if (!currentStudent) {
      Toast.show({ message: '请先选择学生', type: 'error', duration: 1500 })
      return
    }

    try {
      Toast.show({ message: '正在重新处理...', type: 'info', duration: 2000 })
      
      // Fetch the task info
      const task = await getTaskById(taskId, false)
      if (!task) {
        Toast.show({ message: '任务不存在', type: 'error', duration: 2000 })
        return
      }

      // Re-add to queue via server endpoint
      const response = await fetch('/api/tasks/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, imageUrl: task.image_url, studentId: task.student_id, originalName: task.original_name })
      })

      if (!response.ok) {
        throw new Error('重新处理失败')
      }

      Toast.show({ message: '已重新加入处理队列', type: 'success', duration: 2000 })

      // Refresh task list after a short delay
      setTimeout(() => loadTasks(), 1000)
    } catch (error) {
      console.error('重新处理失败:', error)
      Toast.show({ message: '重新处理失败，请稍后重试', type: 'error', duration: 2000 })
    }
  }

  // Trigger upload with specified capture mode
  const triggerUpload = (capture) => {
    const input = document.getElementById('file-input')
    if (!input) return

    // Both camera and gallery modes support multiple selection
    if (capture) {
      input.setAttribute('capture', 'environment')
    } else {
      input.removeAttribute('capture')
    }
    input.setAttribute('multiple', 'multiple')
    input.click()
    setShowUploadOptions(false)
  }

  // Render
  const appContent = (
    <>
      {/* Header */}
        <header className="sticky top-0 z-50 glass border-b" style={{ borderColor: 'rgba(232,229,224,0.5)', paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <div className="max-w-lg mx-auto px-4 h-12 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowStudentSwitcher(true)}
                className="flex items-center gap-2 text-[var(--text)] active:scale-[0.97] transition-transform"
                disabled={isInitializing}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--primary-soft)' }}>
                  <User size={14} style={{ color: 'var(--primary)' }} />
                </div>
                <span style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {isInitializing ? '加载中...' : (currentStudent?.name || '选择学生')}
                </span>
                <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setShowScanQR(true); setGradingData(null) }}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                style={{ background: 'var(--bg-secondary)' }}
                title="扫码批改"
              >
                <ScanLine size={16} style={{ color: 'var(--text-secondary)' }} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-lg mx-auto" style={{ paddingBottom: '80px' }}>
          {/* 上传队列提示 — Claude style */}
          {uploadQueue.length > 0 && (
            <div className="sticky top-11 z-40 px-4 py-2.5 animate-fade-in" style={{ background: 'var(--warning-soft)', borderBottom: '1px solid rgba(232,168,56,0.2)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--warning)' }} />
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#7C5A1E' }}>
                  正在排队上传 {uploadQueue.length} 个文件...
                </span>
              </div>
            </div>
          )}

          {/* 正在上传提示 — Claude style */}
          {isUploading && (
            <div className="sticky top-11 z-40 px-4 py-2.5 animate-fade-in" style={{ background: 'var(--primary-soft)', borderBottom: '1px solid rgba(59,130,246,0.15)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--primary)' }} />
                <span style={{ fontSize: '12px', fontWeight: 500, color: '#4A3F9E' }}>
                  正在上传试卷...
                </span>
              </div>
            </div>
          )}

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
                      { id: 'done', label: '已批改', count: filteredTasks.filter(t => isTaskCompleted(t)).length },
                      { id: 'pending', label: '未批改', count: filteredTasks.filter(t => !isTaskCompleted(t)).length }
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
                <section className="px-4 space-y-2">
                  {isLoadingTasks ? (
                    <div className="space-y-1">
                      <TaskCardSkeleton />
                      <TaskCardSkeleton />
                      <TaskCardSkeleton />
                    </div>
                  ) : filteredTasks.length === 0 ? (
                    isInitializing ? (
                      <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--primary-soft)' }}>
                          <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
                        </div>
                        <p className="mt-4" style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>正在加载学生数据...</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
                        <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
                          <Camera size={28} style={{ color: 'var(--text-tertiary)' }} />
                        </div>
                        <p className="mt-4" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>暂无任务</p>
                        <p className="mt-1" style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>点击右下角按钮上传试卷</p>
                      </div>
                    )
                  ) : (
                    filteredTasks.map((task) => (
                      <SwipeableRow
                        key={task.id}
                        onDelete={() => { setDeleteTarget({ type: 'task', id: task.id }); setShowDeleteConfirm(true) }}
                      >
                        <motion.div
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`card ${isTaskCompleted(task) ? 'cursor-pointer hover:shadow-md' : ''}`}
                          style={{
                            padding: '12px',
                            borderLeft: isTaskCompleted(task) ? '3px solid var(--primary)' : '3px solid var(--warning)',
                          }}
                          onClick={() => {
                            if (isTaskCompleted(task)) {
                              setReviewTask(task)
                              setShowExamReview(true)
                            }
                          }}
                        >
                        <div className="list-card-row items-center">
                          {/* Task Type Badge */}
                          <div className="flex-shrink-0 mr-2">
                            {task.task_type === 'retry_paper' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium" style={{
                                background: 'var(--purple-soft)',
                                color: 'var(--purple)',
                                border: '1px solid var(--purple)'
                              }}>
                                <ScanLine size={10} />
                                错题重练
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium" style={{
                                background: 'var(--primary-soft)',
                                color: 'var(--primary)',
                                border: '1px solid var(--primary)'
                              }}>
                                <BookOpen size={10} />
                                日常作业
                              </span>
                            )}
                          </div>

                          {/* Thumbnail */}
                          <div
                            className="relative w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden cursor-pointer ring-1 ring-black/5"
                            style={{ background: 'var(--bg-mist)' }}
                            onClick={(e) => { e.stopPropagation(); handleViewImage(task.image_url) }}
                          >
                            {task.image_url ? (
                              task.isRetryPaper && task.pages && task.pages.length > 1 ? (
                                // Stacked pages for retry papers
                                <div className="relative w-full h-full">
                                  {task.pages.slice(0, 3).map((page, index) => (
                                    <div
                                      key={page.id}
                                      className="absolute inset-0 rounded-lg overflow-hidden"
                                      style={{
                                        transform: `translateX(${index * 2}px) translateY(${index * 2}px)`,
                                        zIndex: index,
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                                      }}
                                    >
                                      <img
                                        src={page.image_url || task.image_url}
                                        alt={`Page ${page.page_number}`}
                                        className="w-full h-full object-cover"
                                      />
                                    </div>
                                  ))}
                                  {task.pages.length > 3 && (
                                    <div className="absolute inset-0 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-500">
                                      +{task.pages.length - 3}页
                                    </div>
                                  )}
                                </div>
                              ) : (
                                // Single image for regular homework
                                <img src={task.image_url} alt="" className="w-full h-full object-cover" />
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <FileText size={16} style={{ color: 'var(--text-tertiary)' }} />
                              </div>
                            )}

                            {/* Page count indicator for retry papers */}
                            {task.isRetryPaper && task.pages && task.pages.length > 1 && (
                              <div className="absolute -top-1 -right-1 bg-purple-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium border-2 border-white shadow-sm">
                                {task.pages.length}
                              </div>
                            )}
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-card-title truncate">
                                {task.original_name || '未命名试卷'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className="text-meta">
                                {dayjs(task.created_at).format('MM/DD HH:mm')}
                              </span>
                              {/* Task status indicators */}
                              {task.task_type === 'retry_paper' && (
                                <>
                                  <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                                  <span className="text-xs" style={{ color: 'var(--purple)' }}>错题重练</span>
                                </>
                              )}
                              {task.result?.questionCount ? (
                                <>
                                  <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                                  <span className="text-meta-highlight">{task.result.questionCount} 题</span>
                                </>
                              ) : null}

                              {/* Task type and page count */}
                              {task.isRetryPaper && task.pages && task.pages.length > 1 && (
                                <>
                                  <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                                  <span className="text-meta-highlight">{task.pages.length} 页</span>
                                </>
                              )}
                              {!isTaskCompleted(task) && (
                                <>
                                  <span className="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                                  {(() => {
                                    const pendingMinutes = dayjs().diff(dayjs(task.created_at), 'minute')

                                    if (task.status === 'processing') {
                                      return (
                                        <span className="inline-flex items-center gap-1 text-meta" style={{ color: 'var(--primary)' }}>
                                          <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--primary)' }} />
                                          批改中
                                        </span>
                                      )
                                    }

                                    if (task.status === 'failed') {
                                      return (
                                        <span className="inline-flex items-center gap-1 text-meta" style={{ color: 'var(--danger)' }}>
                                          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />
                                          识别失败
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleRetryTask(task.id) }}
                                            className="rounded text-[10px] font-medium px-1.5 py-0.5 transition-colors tap-scale"
                                            style={{
                                              border: '1px solid var(--danger)',
                                              background: 'var(--danger-soft)',
                                              color: 'var(--danger)',
                                            }}
                                          >
                                            重试
                                          </button>
                                        </span>
                                      )
                                    }

                                    return (
                                      <span className="inline-flex items-center gap-1 text-meta" style={{ color: pendingMinutes > 30 ? 'var(--danger)' : 'var(--warning)' }}>
                                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: pendingMinutes > 30 ? 'var(--danger)' : 'var(--warning)' }} />
                                        等待中 ({pendingMinutes}分钟)
                                      </span>
                                    )
                                  })()}
                                </>
                              )}
                            </div>
                            {isTaskCompleted(task) && task.result?.questionCount ? (
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="stat-pill" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                                  <Check size={10} />
                                  正确 {task.result?.questionCount - (task.result?.wrongCount || 0) - (task.result?.emptyCount || 0)}
                                </span>
                                <span className="stat-pill" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                                  <X size={10} />
                                  错误 {task.result?.wrongCount || 0}
                                </span>
                                {task.result?.emptyCount > 0 && (
                                  <span className="stat-pill" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                                    <AlertCircle size={10} />
                                    空题 {task.result.emptyCount}
                                  </span>
                                )}
                              </div>
                            ) : null}
                            {task.status === 'failed' && task.result?.error && (
                              <p className="text-meta mt-0.5" style={{ color: 'var(--danger)' }}>
                                {task.result.error}
                              </p>
                            )}
                          </div>
                        </div>
                        </motion.div>
                      </SwipeableRow>
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
                      { id: 'new', label: '不懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && (wq.lifecycle_status || 'new') === 'new').length },
                      { id: 'review', label: '略懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && (wq.lifecycle_status === 'review_1' || wq.lifecycle_status === 'review_2')).length },
                      { id: 'mastered', label: '完全懂', count: (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id && wq.lifecycle_status === 'mastered').length }
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
                      onClick={() => setShowFilterPanel(true)}
                      className={`filter-chip ${selectedSubject !== 'all' ? 'active' : 'inactive'}`}
                    >
                      科目<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                    <button
                      onClick={() => setShowFilterPanel(true)}
                      className={`filter-chip ${selectedTimeRange !== 'all' ? 'active' : 'inactive'}`}
                    >
                      时间<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                    <button
                      onClick={() => setShowFilterPanel(true)}
                      className={`filter-chip ${selectedErrorCount !== 'all' ? 'active' : 'inactive'}`}
                    >
                      错次<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                    <button
                      onClick={() => setShowFilterPanel(true)}
                      className={`filter-chip ${selectedTags.length > 0 ? 'active' : 'inactive'}`}
                    >
                      标签<ChevronDown size={10} style={{ marginLeft: '2px' }} />
                    </button>
                    {/* 全选/取消全选 */}
                    <button
                      onClick={handleSelectAll}
                      className={`filter-chip ${filteredWrongQuestions.length > 0 && filteredWrongQuestions.every(wq => selectedQuestions.find(sq => sq.id === wq.id)) ? 'active' : 'inactive'}`}
                      style={{ flexShrink: 0 }}
                    >
                      {filteredWrongQuestions.length > 0 && filteredWrongQuestions.every(wq => selectedQuestions.find(sq => sq.id === wq.id)) ? '取消全选' : '全选'}
                    </button>
                  </div>
                </section>

                {/* Filter Drawer — 参考 PC FilterPanel 的 pill-chip 样式 */}
                {showFilterPanel && (
                  <>
                    {/* Overlay */}
                    <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setShowFilterPanel(false)} />
                    {/* Drawer */}
                    <div
                      className="fixed top-0 right-0 z-50 h-full bg-white shadow-xl"
                      style={{
                        width: '85%',
                        maxWidth: '360px',
                        animation: 'slideInRight 0.25s ease-out'
                      }}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <span style={{ fontSize: '17px', fontWeight: 600, color: '#1c1c1e' }}>筛选</span>
                        <button onClick={() => setShowFilterPanel(false)} style={{ padding: '4px', cursor: 'pointer' }}>
                          <X size={20} style={{ color: '#8E8E93' }} />
                        </button>
                      </div>

                      {/* Scrollable content */}
                      <div className="overflow-y-auto" style={{ height: 'calc(100% - 52px)' }}>
                        <div style={{ padding: '16px' }}>
                          {/* 科目 */}
                          <div style={{ marginBottom: '24px' }}>
                            <div style={{ fontSize: '15px', color: '#1c1c1e', marginBottom: '12px', fontWeight: 500 }}>科目</div>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { key: 'all', label: '全部科目' },
                                { key: '数学', label: '数学' },
                                { key: '语文', label: '语文' },
                                { key: '英语', label: '英语' },
                                { key: '物理', label: '物理' },
                                { key: '化学', label: '化学' }
                              ].map(s => (
                                <button
                                  key={s.key}
                                  onClick={() => setSelectedSubject(s.key)}
                                  style={{
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    fontSize: '13px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: selectedSubject === s.key ? 500 : 400,
                                    background: selectedSubject === s.key ? '#2563EB' : '#F2F2F7',
                                    color: selectedSubject === s.key ? '#fff' : '#8E8E93',
                                    transition: 'all 0.15s'
                                  }}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 时间 */}
                          <div style={{ marginBottom: '24px' }}>
                            <div style={{ fontSize: '15px', color: '#1c1c1e', marginBottom: '12px', fontWeight: 500 }}>加入时间</div>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { key: 'all', label: '全部时间' },
                                { key: 'today', label: '今天' },
                                { key: 'week', label: '最近7天' },
                                { key: 'month', label: '最近30天' },
                                { key: 'quarter', label: '最近3个月' }
                              ].map(t => (
                                <button
                                  key={t.key}
                                  onClick={() => setSelectedTimeRange(t.key)}
                                  style={{
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    fontSize: '13px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: selectedTimeRange === t.key ? 500 : 400,
                                    background: selectedTimeRange === t.key ? '#2563EB' : '#F2F2F7',
                                    color: selectedTimeRange === t.key ? '#fff' : '#8E8E93',
                                    transition: 'all 0.15s'
                                  }}
                                >
                                  {t.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 错次 */}
                          <div style={{ marginBottom: '24px' }}>
                            <div style={{ fontSize: '15px', color: '#1c1c1e', marginBottom: '12px', fontWeight: 500 }}>错误次数</div>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { key: 'all', label: '全部次数' },
                                { key: '1', label: '1次' },
                                { key: '2-3', label: '2-3次' },
                                { key: '4-5', label: '4-5次' },
                                { key: '5+', label: '5次以上' }
                              ].map(e => (
                                <button
                                  key={e.key}
                                  onClick={() => setSelectedErrorCount(e.key)}
                                  style={{
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    fontSize: '13px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: selectedErrorCount === e.key ? 500 : 400,
                                    background: selectedErrorCount === e.key ? '#2563EB' : '#F2F2F7',
                                    color: selectedErrorCount === e.key ? '#fff' : '#8E8E93',
                                    transition: 'all 0.15s'
                                  }}
                                >
                                  {e.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 标签 */}
                          {allAvailableTags.length > 0 && (
                            <div style={{ marginBottom: '24px' }}>
                              <div style={{ fontSize: '15px', color: '#1c1c1e', marginBottom: '12px', fontWeight: 500 }}>知识点标签</div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => setSelectedTags([])}
                                  style={{
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    fontSize: '13px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: selectedTags.length === 0 ? 500 : 400,
                                    background: selectedTags.length === 0 ? '#2563EB' : '#F2F2F7',
                                    color: selectedTags.length === 0 ? '#fff' : '#8E8E93',
                                    transition: 'all 0.15s'
                                  }}
                                >
                                  全部标签
                                </button>
                                {allAvailableTags.map(tag => {
                                  const isActive = selectedTags.includes(tag)
                                  return (
                                    <button
                                      key={tag}
                                      onClick={() => {
                                        setSelectedTags(isActive ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag])
                                      }}
                                      style={{
                                        padding: '8px 16px',
                                        borderRadius: '20px',
                                        fontSize: '13px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontWeight: isActive ? 500 : 400,
                                        background: isActive ? '#fa8c16' : '#F2F2F7',
                                        color: isActive ? '#fff' : '#8E8E93',
                                        transition: 'all 0.15s'
                                      }}
                                    >
                                      {tag}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {/* Reset */}
                          <div style={{ paddingTop: '12px', borderTop: '1px solid #E5E5EA' }}>
                            <button
                              onClick={() => {
                                setSelectedSubject('all')
                                setSelectedTimeRange('all')
                                setSelectedErrorCount('all')
                                setSelectedTags([])
                              }}
                              style={{
                                width: '100%',
                                padding: '10px',
                                borderRadius: '20px',
                                fontSize: '14px',
                                fontWeight: 500,
                                border: 'none',
                                cursor: 'pointer',
                                background: '#F2F2F7',
                                color: '#8E8E93',
                                transition: 'all 0.15s'
                              }}
                            >
                              重置
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Wrong Question List */}
                <section className="px-4">
                  {filteredWrongQuestions.length === 0 ? (
                    <div className="text-center py-16">
                      <LayoutGrid size={36} className="mx-auto" style={{ color: '#D1D5DB' }} />
                      <p className="mt-3" style={{ fontSize: '13px', color: '#9CA3AF' }}>暂无错题</p>
                      <p className="mt-0.5" style={{ fontSize: '11px', color: '#D1D5DB' }}>AI批改后错题会自动收录到错题本</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredWrongQuestions.map((wq) => {
                        const question = wq.question || wq
                        const isSelected = selectedQuestions.find(q => q.id === wq.id)

                        const statusCfg = (() => {
                          const ls = wq.lifecycle_status || 'new'
                          if (ls === 'mastered' || wq.status === 'mastered') return { bg: '#F0FDF4', color: '#16A34A', text: '完全懂' }
                          if (ls === 'review_2' || ls === 'review_1') return { bg: '#EFF6FF', color: '#2563EB', text: '略懂' }
                          return { bg: '#FFFBEB', color: '#F59E0B', text: '不懂' }
                        })()

                        const tags = question.tags_source === 'manual'
                          ? (question.manual_tags || [])
                          : (question.ai_tags || [])

                        return (
                          <SwipeableRow
                            key={wq.id}
                            onDelete={() => handleDeleteWrongQuestion(wq)}
                          >
                          <motion.div
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="card"
                            style={{ padding: '12px' }}
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
                                      background: statusCfg.bg,
                                      color: statusCfg.color,
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
                                      background: statusCfg.color,
                                      display: 'inline-block'
                                    }} />
                                    {statusCfg.text}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                          </SwipeableRow>
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
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>组卷历史</h2>
                  <p style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '1px' }}>
                    共 {studentExams.length} 份试卷
                  </p>
                </section>

                {/* Exam List */}
                <section className="px-4 space-y-2">
                  {studentExams.length === 0 ? (
                    <div className="text-center py-16">
                      <FileText size={36} className="mx-auto" style={{ color: '#D1D5DB' }} />
                      <p className="mt-3" style={{ fontSize: '13px', color: '#9CA3AF' }}>暂无组卷历史</p>
                      <p className="mt-0.5" style={{ fontSize: '11px', color: '#D1D5DB' }}>在错题本选择题目后点击"生成试卷"</p>
                    </div>
                  ) : (
                    studentExams.map((exam) => (
                      <SwipeableRow
                        key={exam.id}
                        onDelete={() => { setDeleteTarget({ type: 'exam', id: exam.id }); setShowDeleteConfirm(true) }}
                      >
                      <motion.div
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
                                className="px-2 py-1 rounded-lg"
                                style={{ background: '#F3F4F6', color: '#2563EB' }}
                                title="下载PDF"
                              >
                                <FileText size={12} />
                              </button>
                              <button
                                onClick={() => handleSubmitExam(exam)}
                                disabled={submitExamId === exam.id}
                                className="px-2 py-1 rounded-lg"
                                style={{ background: submitExamId === exam.id ? '#EDE9FE' : '#F3F4F6', color: '#7C3AED' }}
                                title="提交作业"
                              >
                                {submitExamId === exam.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                      </SwipeableRow>
                    ))
                  )}
                </section>

                {/* 提交作业隐藏文件输入（拍照/相册，多张） */}
                <input
                  ref={submitFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleSubmitFilesSelected}
                />
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        {/* Bottom Navigation — Claude Style */}
        <nav className="fixed bottom-0 left-0 right-0 z-50 glass border-t" style={{ borderColor: 'rgba(232,229,224,0.6)' }}>
          <div className="max-w-lg mx-auto flex items-center justify-around" style={{ padding: '6px 0', paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))' }}>
            {[
              { id: 'processing', icon: Camera, label: '首页' },
              { id: 'wrongbook', icon: LayoutGrid, label: '错题本' },
              { id: 'exam', icon: FileText, label: '组卷历史' },
            ].map((tab) => {
              const isActive = currentPage === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => { setCurrentPage(tab.id); clearSelection() }}
                  className="flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90"
                  style={{ minWidth: '64px', padding: '4px 12px' }}
                >
                  <div
                    className="flex items-center justify-center transition-all duration-200"
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--primary-soft)' : 'transparent',
                    }}
                  >
                    <tab.icon
                      size={18}
                      strokeWidth={isActive ? 2.5 : 1.8}
                      style={{ color: isActive ? 'var(--primary)' : 'var(--text-tertiary)' }}
                    />
                  </div>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--primary)' : 'var(--text-tertiary)',
                    letterSpacing: '0.02em',
                  }}>
                    {tab.label}
                  </span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Student Sheet */}
        <StudentSwitcher
          visible={showStudentSwitcher}
          onClose={() => setShowStudentSwitcher(false)}
        />

        {/* Floating Action Button — Claude style */}
        {currentPage === 'processing' && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            onClick={() => setShowUploadOptions(true)}
            className="fixed right-5 z-50 flex items-center justify-center shadow-lg tap-scale"
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, var(--primary) 0%, #60A5FA 100%)',
              boxShadow: 'var(--shadow-primary)',
              bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <Plus size={24} strokeWidth={3} className="text-white" />
          </motion.button>
        )}

        {/* Upload Options Menu — Claude style */}
        {showUploadOptions && (
          <div className="fixed inset-0 z-[25000] flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowUploadOptions(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative bg-white rounded-t-3xl w-full max-w-lg mx-auto shadow-xl"
              style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' }}
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-8 h-1 rounded-full" style={{ background: 'var(--border)' }} />
              </div>
              <div className="px-6 pt-2 pb-4">
                <h3 className="text-center text-[17px] font-semibold text-[var(--text)] mb-6">上传试卷</h3>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => triggerUpload(true)}
                    className="flex flex-col items-center gap-3 p-5 rounded-2xl transition-all active:scale-[0.97] tap-scale"
                    style={{ background: 'var(--accent-soft)' }}
                  >
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md" style={{ background: 'linear-gradient(135deg, var(--accent), #F97316)' }}>
                      <Camera size={28} className="text-white" />
                    </div>
                    <div className="text-center">
                      <span className="block text-[14px] font-semibold" style={{ color: 'var(--text)' }}>拍照上传</span>
                      <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>可连续拍摄多张</span>
                    </div>
                  </button>
                  <button
                    onClick={() => triggerUpload(false)}
                    className="flex flex-col items-center gap-3 p-5 rounded-2xl transition-all active:scale-[0.97] tap-scale"
                    style={{ background: 'var(--primary-soft)' }}
                  >
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md" style={{ background: 'var(--primary)' }}>
                      <ImageIcon size={28} className="text-white" />
                    </div>
                    <div className="text-center">
                      <span className="block text-[14px] font-semibold" style={{ color: 'var(--text)' }}>相册选择</span>
                      <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>可多选试卷上传</span>
                    </div>
                  </button>
                </div>
              </div>
              <div className="px-6 pb-2">
                <button
                  onClick={() => setShowUploadOptions(false)}
                  className="w-full py-3.5 rounded-2xl text-[15px] font-medium transition-colors active:scale-[0.98]"
                  style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                >
                  取消
                </button>
              </div>
            </motion.div>
          </div>
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

        {/* Delete Confirm Dialog — Claude style */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[20000] flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative card mx-5 w-full max-w-sm"
              style={{ padding: '24px' }}
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'var(--danger-soft)' }}>
                  <AlertCircle size={24} style={{ color: 'var(--danger)' }} />
                </div>
                <h3 style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text)', marginBottom: '6px' }}>确认删除</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                  删除后不可恢复，确定要删除吗？
                </p>
                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl text-[14px] font-medium transition-colors active:scale-[0.98]"
                    style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    className="flex-1 py-2.5 rounded-xl text-[14px] font-medium text-white transition-colors active:scale-[0.98]"
                    style={{ background: 'var(--danger)' }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Question Editor Dialog — Claude style */}
        {showQuestionEditor && editingQuestionItem && (
          <div className="fixed inset-0 z-[20000] flex flex-col">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowQuestionEditor(false)} />
            <div className="relative mt-auto bg-white rounded-t-3xl max-h-[85vh] min-h-[60vh] flex flex-col shadow-xl">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>编辑题目</h3>
                <button onClick={() => setShowQuestionEditor(false)} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg-secondary)' }}>
                  <X size={16} style={{ color: 'var(--text-secondary)' }} />
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
                    className="flex-1 py-2.5 text-[13px] font-medium relative transition-colors"
                    style={{ color: editTab === tab.key ? 'var(--primary)' : 'var(--text-tertiary)' }}
                  >
                    {tab.label}
                    {editTab === tab.key && (
                      <div className="absolute bottom-0 left-1/3 right-1/3 h-0.5 rounded-full" style={{ background: 'var(--primary)' }} />
                    )}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* Stem Tab */}
                {editTab === 'stem' && (
                  <>
                    <div className="card" style={{ padding: '14px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>题目内容</label>
                      <textarea
                        value={editForm.content}
                        onChange={e => updateEditForm('content', e.target.value)}
                        placeholder="请输入题目内容"
                        className="w-full rounded-xl p-3 text-[13px] resize-none focus:outline-none transition-all"
                        style={{ border: '1px solid var(--border)', color: 'var(--text)', minHeight: '80px', background: 'var(--bg-mist)' }}
                      />
                    </div>

                    {editForm.question_type === 'choice' && (
                      <div className="card" style={{ padding: '14px' }}>
                        <div className="flex items-center justify-between mb-2">
                          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>选项</label>
                          <button onClick={addEditOption} style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 500 }}>
                            + 添加选项
                          </button>
                        </div>
                        <div className="space-y-2">
                          {editForm.options.map((opt, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
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

                    {/* Image upload area with cropping */}
                    <input
                      id="edit-image-file-input"
                      type="file"
                      accept="image/*"
                      onChange={handleEditFileSelected}
                      style={{ display: 'none' }}
                    />
                    <div style={{
                      border: `2px dashed ${editForm.image_url ? '#2563EB' : '#D1D5DB'}`,
                      borderRadius: '12px',
                      padding: editForm.image_url ? '12px' : '20px',
                      textAlign: 'center',
                      background: editForm.image_url ? '#F8FAFF' : '#FAFAFA',
                      transition: 'all 0.2s'
                    }}>
                      {editForm.image_url ? (
                        <div style={{ width: '100%' }}>
                          <img
                            src={editForm.image_url}
                            alt="题目配图"
                            style={{
                              width: '100%',
                              maxHeight: '200px',
                              objectFit: 'contain',
                              borderRadius: '8px',
                              display: 'block',
                              background: '#F5F7FA'
                            }}
                          />
                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <span
                              onClick={handleOpenEditSourcePicker}
                              style={{ fontSize: '12px', color: '#2563EB', cursor: 'pointer', padding: '4px 12px', borderRadius: '6px', background: '#EFF6FF', fontWeight: 500 }}
                            >
                              裁剪替换
                            </span>
                            <span
                              onClick={() => updateEditForm('image_url', '')}
                              style={{ fontSize: '12px', color: '#EF4444', cursor: 'pointer', padding: '4px 12px', borderRadius: '6px', background: '#FEF2F2', fontWeight: 500 }}
                            >
                              删除配图
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={handleOpenEditSourcePicker}
                          style={{ cursor: 'pointer', padding: '8px 0' }}
                        >
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" style={{ margin: '0 auto 8px', display: 'block' }}>
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: '#2563EB' }}>添加配图</div>
                          <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>支持裁剪上传，可选</div>
                        </div>
                      )}
                    </div>
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

        {/* Edit Source Picker Dialog */}
        {showEditSourcePicker && (
          <div className="fixed inset-0 z-[30000] flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div onClick={() => setShowEditSourcePicker(false)} style={{ flex: 1 }} />
            <div style={{
              background: '#fff', borderRadius: '16px 16px 0 0',
              padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))'
            }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#111827', textAlign: 'center', marginBottom: '20px' }}>
                选择配图来源
              </div>
              {(editingQuestionItem?.question || editingQuestionItem)?.task_id && (
                <div
                  onClick={handleCropFromTask}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '16px', borderRadius: '12px',
                    background: '#F5F7FA', marginBottom: '12px',
                    cursor: 'pointer', transition: 'background 0.2s'
                  }}
                >
                  <div style={{
                    width: '48px', height: '48px', borderRadius: '12px',
                    background: '#EFF6FF', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>从原试卷裁剪</div>
                    <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>从原试卷图片中截取本题区域</div>
                  </div>
                  {loadingTaskImage && (
                    <div style={{ fontSize: '12px', color: '#2563EB' }}>加载中...</div>
                  )}
                </div>
              )}
              <div
                onClick={handleCropFromUpload}
                style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  padding: '16px', borderRadius: '12px',
                  background: '#F5F7FA', marginBottom: '8px',
                  cursor: 'pointer', transition: 'background 0.2s'
                }}
              >
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: '#FEF2F2', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>拍摄或上传裁剪</div>
                  <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '2px' }}>拍照或从相册选择图片进行裁剪</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', marginTop: '12px' }}>
                <span
                  onClick={() => setShowEditSourcePicker(false)}
                  style={{ fontSize: '14px', color: '#6B7280', cursor: 'pointer', padding: '8px 16px' }}
                >
                  取消
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Crop Dialog */}
        {showImageCrop && (
          <RectCropper
            image={cropImage}
            onConfirm={handleCropConfirm}
            onCancel={handleCropCancel}
            theme="light"
          />
        )}

        {/* Exam Review / 复审 */}
        {showExamReview && reviewTask && (
          <Suspense fallback={<LazyFallback />}>
            <ExamReview
              task={reviewTask}
              onClose={() => { setShowExamReview(false); setReviewTask(null); loadTasks() }}
              onSave={() => {
                // 保存后重新计算统计并刷新首页
                if (reviewTask?.id) {
                  recalculateTaskStats(reviewTask.id).catch(e => console.error('刷新统计失败:', e))
                }
                loadTasks()
              }}
            />
          </Suspense>
        )}

        {/* Print Preview / 组卷 */}
        {showPrintPreview && (
          <Suspense fallback={<LazyFallback />}>
            <PrintPreview onClose={() => setShowPrintPreview(false)} />
          </Suspense>
        )}

        {/* Reprint Exam / 重新打印 */}
        {showReprint && reprintExam && (
          <Suspense fallback={<LazyFallback />}>
            <PrintPreview
              questions={reprintQuestions}
              existingExamId={reprintExam.id}
              examName={reprintExam.name}
              onClose={() => { setShowReprint(false); setReprintExam(null); setReprintQuestions([]) }}
            />
          </Suspense>
        )}

        {/* Scan QR / 扫码批改 */}
        {showScanQR && (
          <Suspense fallback={<LazyFallback />}>
            <ScanQR
              onClose={() => setShowScanQR(false)}
              onScanSuccess={handleScanSuccess}
            />
          </Suspense>
        )}

        {/* Grading / 批改试卷 */}
        {showGrading && gradingData && (
          <Suspense fallback={<LazyFallback />}>
            <Grading
              paperId={gradingData.paperId}
              studentId={gradingData.studentId}
              questionIds={gradingData.questionIds}
              generatedExamId={gradingData.generatedExamId}
              onClose={() => { setShowGrading(false); setGradingData(null) }}
              onComplete={handleGradingComplete}
            />
          </Suspense>
        )}
      </>
    )

    // 错题重练任务入口：/retry-task/:id 全屏渲染，无底部 tab
    if (retryTaskId) {
      return (
        <ToastProvider>
          <Suspense fallback={<LazyFallback />}>
            <RetryTask
              taskId={retryTaskId}
              onBack={() => {
                setRetryTaskId(null)
                if (window.history.length > 1) window.history.back()
                else window.location.assign('/')
              }}
            />
          </Suspense>
        </ToastProvider>
      )
    }

    return (
      <ToastProvider>
        {/* PC端 + 试卷入库校对/结果时，全屏显示，跳出手机模拟器 */}
        {!isMobile && paperBankStep === 'proofread' ? (
          <div className="min-h-screen flex flex-col" style={{ background: '#F5F7FA' }}>
            {appContent}
          </div>
        ) : isMobile ? (
          <div className="min-h-screen" style={{ background: '#F5F7FA' }}>
            {appContent}
          </div>
        ) : (
          <div className="min-h-screen" style={{ background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div style={{
              width: '100%',
              maxWidth: '430px',
              height: '100vh',
              maxHeight: '932px',
              background: '#000',
              borderRadius: '40px',
              padding: '12px',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* 刘海 */}
              <div style={{ height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: '120px', height: '28px', background: '#000', borderRadius: '0 0 20px 20px' }} />
              </div>
              {/* 屏幕内容 */}
              <div style={{ flex: 1, borderRadius: '32px', overflow: 'hidden', background: '#F5F7FA', position: 'relative' }}>
                {appContent}
              </div>
              {/* 底部指示条 */}
              <div style={{ height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: '134px', height: '5px', background: '#333', borderRadius: '100px' }} />
              </div>
            </div>
          </div>
        )}
      </ToastProvider>
    )
}