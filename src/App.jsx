import { useCallback, useEffect, useState, useRef, lazy, Suspense, useMemo } from 'react'
import {
  Camera,
  Loader2,
  LayoutGrid,
  FileText,
  Plus,
  Upload,
  X,
  Tag,
  Download,
  RotateCcw
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStudentStore, useTaskStore, useWrongQuestionStore, useExamStore } from './store'
import { getStudents, getTasksByStudent, getQuestionsByTask, getExamsByStudent, getGeneratedExamsByStudent, getGeneratedExamById, updateTaskStatus, updateQuestion, updateQuestionTags, invalidateCache, createStudent, getQuestionsByIds, deleteTask, deleteGeneratedExam, deleteWrongQuestion, getTaskById, recalculateTaskStats, clearStudentCaches, peekCache, writeCache, fetchWrongQuestionsPage, getTasksSummary, markNotificationsRead } from './services/apiService'
import { taskService } from './services/taskService'
import { usePaperBank } from './features/PaperBank/index.jsx'
import { useUploadFlow } from './hooks/useUploadFlow'
import { usePolling } from './hooks/usePolling'
import { __pendingUploadStore } from './features/upload/pendingUploadStore'
import { mockTasks, mockWrongQuestions, mockGeneratedExams, mockStudents } from './data/mockData'
import StudentSwitcher from './components/StudentSwitcher'
import AppHeader from './components/AppHeader'
import UploadOptionsModal from './components/UploadOptionsModal'
import DeleteConfirmModal from './components/DeleteConfirmModal'
import StagingModal from './components/StagingModal'
import ExamChoiceModal from './components/ExamChoiceModal'
import NotificationsPanel from './components/NotificationsPanel'
import LearningReportPanel from './components/LearningReportPanel'
import ImagePreview from './components/ImagePreview'
import ProcessingPage from './pages/ProcessingPage'
import HomeDashboard from './components/HomeDashboard'
import WrongBookPage from './pages/WrongBookPage'
import ExamPage from './pages/ExamPage'
import WorksheetPicker from './components/WorksheetPicker'

import { useToast, ToastProvider } from './components/ToastProvider'
import dayjs from 'dayjs'

// 错题本分页大小（与服务端 limit 保持一致）
const WRONG_PAGE_SIZE = 100

// 错题去重兜底：有 question_id 按 id 去重（后端已按 (student_id, question_id) 唯一）；
// question_id 为空的自包含错题按题干去重；保留时间最新的一条；不合并不同 question_id 的同题干题目。
const dedupWrongQuestions = (rawList) => {
  const dedupMap = new Map()
  for (const wq of rawList) {
    const question = wq.question || wq
    const qContent = (question.content || '').trim()
    const key = wq.question_id ? `q:${wq.question_id}` : (qContent ? `c:${qContent}` : null)
    if (!key) continue
    const existing = dedupMap.get(key)
    const curDate = wq.added_at || wq.created_at || ''
    const existDate = existing ? (existing.added_at || existing.created_at || '') : ''
    if (!existing || curDate > existDate) {
      dedupMap.set(key, wq)
    }
  }
  return Array.from(dedupMap.values())
}

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
            <div style={{ fontSize: 'var(--fs-16)', color: 'var(--danger)', textAlign: 'center' }}>
              页面加载失败，请刷新重试
            </div>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)', textAlign: 'center' }}>
              如果问题持续，请清除浏览器缓存后重试
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 24px', background: 'var(--primary-hover)', color: '#fff',
                borderRadius: 'var(--radius-8)', border: 'none', cursor: 'pointer',
                fontSize: 'var(--fs-14)', fontWeight: 600
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
const WeeklyReport = lazyWithRetry(() => import('./pages/WeeklyReport'))

// Simple Suspense fallback
const LazyFallback = () => (
  <div className="flex items-center justify-center p-8">
    <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-secondary)' }} />
  </div>
)

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

// 错题重练任务入口路由：/retry-task/:id 仅渲染 RetryTask 页（二维码唯一入口）
// 双源检测：
//  1) React Router location.pathname（hash 路由，站内扫码 navigate 而来 #/retry-task/:id）
//  2) 浏览器真实 pathname（二维码外部直达 /retry-task/:id，无 hash，由服务器 SPA fallback 渲染 index.html）
const getRetryTaskIdFromPath = (pathname) => {
  const m = (pathname || '').match(/^\/retry-task\/([0-9a-fA-F-]{36})$/)
  return m ? m[1] : null
}

// ==================== Main App ====================

const USE_MOCK_DATA = false

// 判断任务是否已完成批改（兼容不同状态值）
const isTaskCompleted = (task) => {
  return task.status === 'done' || task.status === 'graded' || task.status === 'completed' || task.status === 'reviewed' || !!task.result?.questionCount
}

export default function App() {
  // 路由化：以 URL hash 为唯一数据源派生底部 tab（/ → processing，#/processing / wrongbook / exam）
  const navigate = useNavigate()
  const location = useLocation()
  const routePage = location.pathname.replace(/^\/+/, '').split('/')[0]
  const currentPage = ['processing', 'tasks', 'wrongbook', 'exam'].includes(routePage) ? routePage : 'processing'
  const setCurrentPage = (page) => navigate('/' + page)

  // Store hooks
  const { students, currentStudent, setCurrentStudent, setStudents, addStudent } = useStudentStore()
  const { tasks, setTasks, addTask, updateTaskStatus: updateTaskInStore } = useTaskStore()
  const { wrongQuestions, setWrongQuestions, selectedQuestions, setSelectedQuestions, clearSelection, addWrongQuestion, addWrongQuestions: addMultipleToStore } = useWrongQuestionStore()
  const { exams, setExams, generatedExams, setGeneratedExams } = useExamStore()

  // 错题重练任务入口：hash 路由命中 /retry-task/:id 时全屏渲染 RetryTask（站内扫码 navigate 进入）
  // 外部二维码直达 /retry-task/{id}（无 hash，服务器 SPA fallback 返回 index.html）时 pathname 也是该形式，
  // HashRouter 会把它映射为 location.pathname，双源取其一即可。
  const retryTaskId = getRetryTaskIdFromPath(location.pathname) || getRetryTaskIdFromPath(window.location.pathname)

  // Processing Page State
  const [processingFilter, setProcessingFilter] = useState('all')
  const [previewImage, setPreviewImage] = useState(null)

  // Bank Page State
  const [bankFilter, setBankFilter] = useState('all')
  const [selectedSubject, setSelectedSubject] = useState('all')
  const [selectedTimeRange, setSelectedTimeRange] = useState('all')
  const [selectedErrorCount, setSelectedErrorCount] = useState('all')
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedErrorType, setSelectedErrorType] = useState('all')
  const [selectedRecentWrongRange, setSelectedRecentWrongRange] = useState('all')
  const [selectedMasteryStage, setSelectedMasteryStage] = useState('all')
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showBatchActions, setShowBatchActions] = useState(false)
  const [showGenerateExam, setShowGenerateExam] = useState(false)
  const [generatedExamPreview, setGeneratedExamPreview] = useState(null)
  const [showStudentQR, setShowStudentQR] = useState(false)
  const [studentQRData, setStudentQRData] = useState(null)
  const [showPrintPreview, setShowPrintPreview] = useState(false)
  const [printPreviewData, setPrintPreviewData] = useState(null)
  const [showPrintModal, setShowPrintModal] = useState(false)
  const [printTarget, setPrintTarget] = useState(null)
  const [selectedImage, setSelectedImage] = useState(null)
  const [showImageViewer, setShowImageViewer] = useState(false)
  const [wrongBookDetail, setWrongBookDetail] = useState(null) // 错题详情弹窗数据
  // 错题本分页与计数状态：服务端 total/counts 驱动，计数器不再被首批 100 条截断
  const [bankCounts, setBankCounts] = useState(null)
  const [wrongBookOffset, setWrongBookOffset] = useState(0)
  const [wrongBookLoading, setWrongBookLoading] = useState(false)
  const [wrongBookHasMore, setWrongBookHasMore] = useState(false)
  const [showExamReview, setShowExamReview] = useState(false)
  const [reviewTask, setReviewTask] = useState(null)

  // 从 WorksheetPicker 选择练习册后的回调
  const [showNotifications, setShowNotifications] = useState(false)
  const [showLearningReport, setShowLearningReport] = useState(false)
  const [notifSummary, setNotifSummary] = useState(null) // 通知摘要（铃铛红点）

  // QR Detection State
  const [qrDetectionResults, setQrDetectionResults] = useState({})

  // 初始化状态
  const [isInitializing, setIsInitializing] = useState(true)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)

  // Toast
  const Toast = useToast()

  // FAB 长按计时
  const fabPressRef = useRef(0)
  const fabLongPressRef = useRef(false)

  // Paper Bank 自包含模块
  const paperBank = usePaperBank()

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

  // 切换学生：不手动清空列表——各页面 load 函数按 studentId 走「先缓存后刷新」，
  // 立即用新学生缓存覆盖旧数据，避免先清空导致的空屏闪烁。
  // (缓存键 tasks_cache_{studentId} / wrong_questions_cache_{studentId} 已按学生隔离)

  // Load tasks when student changes
  useEffect(() => {
    if (currentStudent && (currentPage === 'processing' || currentPage === 'tasks')) {
      loadTasks()
    }
  }, [currentStudent?.id, currentPage])

  // Auto-refresh pending tasks every 30 seconds（页面隐藏时暂停）
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  usePolling(() => {
    const pendingTasks = (Array.isArray(tasksRef.current) ? tasksRef.current : []).filter(t => !isTaskCompleted(t))
    if (pendingTasks.length > 0) {
      invalidateCache('tasks', currentStudent?.id)
      loadTasks()
    }
  }, 30000, currentStudent && (currentPage === 'processing' || currentPage === 'tasks'), [currentStudent?.id, currentPage])


  // Load wrong questions
  useEffect(() => {
    if (currentStudent && currentPage === 'wrongbook') {
      loadWrongBookData()
    }
  }, [currentStudent?.id, currentPage])

  // Load exams（合并原 App.jsx 3s 轮询与 Exam/index.jsx 3s 轮询，统一由 App 层调度）
  usePolling(() => {
    loadGeneratedExams(false)
  }, 15000, currentStudent && currentPage === 'exam', [currentStudent?.id, currentPage])
  // 首次进入：先展示缓存再后台刷新（enabled 打开时 usePolling 立即执行一次 loadGeneratedExams(false)，
  // 这里额外触发一次 showCachedFirst 版本让缓存先上屏）
  useEffect(() => {
    if (currentStudent && currentPage === 'exam') {
      loadGeneratedExams(false, true)
    }
  }, [currentStudent?.id, currentPage])

  // 通知摘要（铃铛红点）：低频率后台刷新，仅在需要时（页面可见）拉取
  usePolling(async () => {
    try {
      const data = await getTasksSummary(false)
      if (data?.success) setNotifSummary(data.summary)
    } catch { /* 忽略通知摘要失败 */ }
  }, 30000, true, [])

  // 打开通知面板：先标记全部已读（铃铛数字归零），再展示面板与最新摘要
  const handleOpenNotifications = async () => {
    try {
      await markNotificationsRead()
    } catch { /* 标记失败不阻塞打开面板 */ }
    setShowNotifications(true)
    try {
      const data = await getTasksSummary(false)
      if (data?.success) setNotifSummary(data.summary)
    } catch { /* 忽略 */ }
  }

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

  // 上传流程（自包含 hook：上传队列/多图暂存/练习册/答案库/QR 识别/后台批量上传）
  const {
    pendingFlow, setPendingFlow,
    selectedWorksheetId, setSelectedWorksheetId,
    selectedExamResourceId, setSelectedExamResourceId,
    flowSubject, setFlowSubject,
    clearPendingUploadFlow,
    showUploadOptions, setShowUploadOptions,
    showWorksheetPicker, setShowWorksheetPicker,
    triggerUpload,
    handleFileSelect,
    uploading, uploadingTasks,
    uploadQueue, isUploading,
    showStaging, stagingFiles, stagingType, stagingUploading,
    cameraInputRef, albumInputRef,
    openStaging, clearStaging,
    handleStagingSelectFiles, removeStagingFile,
    handleSubmitStaging,
    homeworkChoiceFiles, homeworkChoiceRef,
    handleUploadAsWorkbook, handleUploadAsRegular,
    showExamChoice, setShowExamChoice,
    examChoiceFiles, setExamChoiceFiles,
    availableExamResources,
    handleUploadWithExamResource, handleUploadFreshExam
  } = useUploadFlow({ loadTasks, isInitializing })

  // H5 移动端上传入口：Home/index.jsx 在用户选完类型后通过 'set-workbook-flow'
  // 自定义事件把 flow/worksheetId/subject 传过来。这里同步写入 state + module 兜底，
  // 让随后的 handleFileSelect 链路能正确分流到 workbook/exam/通用 三条管道。
  useEffect(() => {
    const onSetFlow = (e) => {
      const detail = e?.detail || {}
      const flow = detail.flow                       // 'workbook' | 'homework' | 'exam' | 'regular' | null
      const worksheetId = detail.worksheetId || null
      const examResourceId = detail.examResourceId || null
      const subject = detail.subject || '数学'

      // ── state 镜像（用于 UI 展示）──
      setPendingFlow(flow === 'workbook' ? 'workbook' : (flow === 'exam' ? 'exam' : null))
      setSelectedWorksheetId(flow === 'workbook' ? worksheetId : null)
      setSelectedExamResourceId(flow === 'exam' ? examResourceId : null)
      if (subject) setFlowSubject(subject)

      // ── module 级兜底（避开 React 18 批处理时序）──
      __pendingUploadStore.worksheetId = flow === 'workbook' ? worksheetId : null
      __pendingUploadStore.examResourceId = flow === 'exam' ? examResourceId : null
      __pendingUploadStore.subject = subject

      console.log('🔥📡 [set-workbook-flow] 收到移动端上传类型:', {
        flow, worksheetId, examResourceId, subject,
        worksheetIdLen: worksheetId?.length
      })
    }
    window.addEventListener('set-workbook-flow', onSetFlow)
    return () => window.removeEventListener('set-workbook-flow', onSetFlow)
  }, [setPendingFlow, setSelectedWorksheetId, setSelectedExamResourceId, setFlowSubject])

  // WrongBook: Load data（秒开策略：先展示本地缓存，再后台刷新；总数与生命周期计数来自服务端，不再被首批 100 条截断）
  const loadWrongBookData = async () => {
    if (!currentStudent) return
    const studentId = currentStudent.id

    if (USE_MOCK_DATA) {
      setWrongQuestions(mockWrongQuestions.filter(wq => wq.student_id === studentId))
      return
    }

    // 1) 先用缓存立即上屏
    const cached = peekCache(`wrong_questions_cache_${studentId}`)
    if (Array.isArray(cached) && cached.length > 0) {
      setWrongQuestions(dedupWrongQuestions(cached))
    }
    // 2) 后台拉取第一页（含 total / counts），后续页面由滚动触底加载
    try {
      const { wrongQuestions: rawList, total, counts } = await fetchWrongQuestionsPage(studentId, { limit: WRONG_PAGE_SIZE, offset: 0 })
      const deduped = dedupWrongQuestions(rawList)
      setWrongQuestions(deduped)
      setBankCounts(counts)
      setWrongBookOffset(rawList.length)
      setWrongBookHasMore(rawList.length < total)
      writeCache(`wrong_questions_cache_${studentId}`, deduped)
    } catch (error) {
      console.error('加载错题失败:', error)
      // 网络失败时保留已展示的缓存数据
    }
  }

  // 滚动触底加载下一页错题，跨页按 question_id / 题干去重合并，并保持秒开缓存
  const loadMoreWrongQuestions = useCallback(async () => {
    if (!currentStudent || wrongBookLoading || !wrongBookHasMore) return
    const studentId = currentStudent.id
    setWrongBookLoading(true)
    try {
      const { wrongQuestions: rawList, total, counts } = await fetchWrongQuestionsPage(studentId, { limit: WRONG_PAGE_SIZE, offset: wrongBookOffset })
      if (!Array.isArray(rawList) || rawList.length === 0) {
        setWrongBookHasMore(false)
        return
      }
      const merged = dedupWrongQuestions([...(Array.isArray(wrongQuestions) ? wrongQuestions : []), ...rawList])
      setWrongQuestions(merged)
      setBankCounts(counts)
      const nextOffset = wrongBookOffset + rawList.length
      setWrongBookOffset(nextOffset)
      setWrongBookHasMore(nextOffset < total)
      writeCache(`wrong_questions_cache_${studentId}`, merged)
    } catch (error) {
      console.error('加载更多错题失败:', error)
    } finally {
      setWrongBookLoading(false)
    }
  }, [currentStudent, wrongBookLoading, wrongBookHasMore, wrongBookOffset, wrongQuestions, setWrongQuestions])

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


  // Filter tasks
  const isRetryTask = (t) => t.task_type === 'retry_paper' || t.task_type === 'wrong_retry'
  const filteredTasks = useMemo(() => (Array.isArray(tasks) ? tasks : []).filter(t => {
    if (t.student_id !== currentStudent?.id) return false
    if (processingFilter === 'all') return true
    if (processingFilter === 'homework') return !isRetryTask(t)
    if (processingFilter === 'retry') return isRetryTask(t)
    return t.status === processingFilter
  }), [tasks, currentStudent?.id, processingFilter])

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

  const allAvailableTags = useMemo(() => {
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
  }, [wrongQuestions, currentStudent?.id])

  const allAvailableErrorTypes = useMemo(() => {
    const typeSet = new Set()
    wrongQuestions
      .filter(wq => wq.student_id === currentStudent?.id)
      .forEach(wq => {
        if (wq.error_type) typeSet.add(wq.error_type)
      })
    return Array.from(typeSet)
  }, [wrongQuestions, currentStudent?.id])

  const filteredWrongQuestions = useMemo(() => (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => {
    if (wq.student_id !== currentStudent?.id) return false
    if (bankFilter !== 'all') {
      const ls = wq.lifecycle_status || 'new'
      if (bankFilter === 'new' && ls !== 'new') return false
      if (bankFilter === 'review' && ls !== 'review_1' && ls !== 'review_2') return false
      if (bankFilter === 'mastered' && ls !== 'mastered') return false
    }
    if (selectedSubject !== 'all') {
      // wrong_questions.subject 历史数据大多缺失，回退到 question.subject 兜底
      const subj = wq.subject || (wq.question && wq.question.subject)
      if (subj !== selectedSubject) return false
    }
    if (selectedTimeRange !== 'all' && !isWithinTimeRange(wq.added_at || wq.created_at, selectedTimeRange)) return false
    if (selectedErrorCount !== 'all' && !matchErrorCount(wq.error_count || 1, selectedErrorCount)) return false
    if (selectedErrorType !== 'all' && (wq.error_type || '') !== selectedErrorType) return false
    if (selectedRecentWrongRange !== 'all' && !wq.last_wrong_at) return false
    if (selectedRecentWrongRange !== 'all' && !isWithinTimeRange(wq.last_wrong_at, selectedRecentWrongRange)) return false
    if (selectedMasteryStage !== 'all') {
      const ls = wq.lifecycle_status || 'new'
      if (selectedMasteryStage === 'reviewing') {
        if (ls !== 'review_1' && ls !== 'review_2') return false
      } else if (ls !== selectedMasteryStage) {
        return false
      }
    }
    if (selectedTags.length > 0) {
      const question = wq.question || wq
      const qTags = question.tags_source === 'manual'
        ? (question.manual_tags || [])
        : (question.ai_tags || [])
      if (!selectedTags.some(t => qTags.includes(t))) return false
    }
    return true
  }), [wrongQuestions, currentStudent?.id, bankFilter, selectedSubject, selectedTimeRange, selectedErrorCount, selectedErrorType, selectedRecentWrongRange, selectedMasteryStage, selectedTags])

  // Mobile wrong-book action: prioritize unresolved items without creating a second retry flow.
  const pendingWrongQuestions = useMemo(() => (Array.isArray(wrongQuestions) ? wrongQuestions : [])
    .filter(wq => wq.student_id === currentStudent?.id && (wq.lifecycle_status || 'new') !== 'mastered'), [wrongQuestions, currentStudent?.id])

  const priorityWrongQuestions = useMemo(() => [...pendingWrongQuestions]
    .sort((a, b) => {
      const statusRank = { new: 0, review_1: 1, review_2: 2 }
      const rankDiff = (statusRank[a.lifecycle_status || 'new'] ?? 3) - (statusRank[b.lifecycle_status || 'new'] ?? 3)
      if (rankDiff !== 0) return rankDiff
      const errorDiff = (b.error_count || 1) - (a.error_count || 1)
      if (errorDiff !== 0) return errorDiff
      return dayjs(b.added_at || b.created_at).valueOf() - dayjs(a.added_at || a.created_at).valueOf()
    })
    .slice(0, 5), [pendingWrongQuestions])

  // Filter generated exams
  const studentExams = useMemo(() => (Array.isArray(generatedExams) ? generatedExams : []).filter(e => e.student_id === currentStudent?.id),
    [generatedExams, currentStudent?.id])

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
      navigate(`/retry-task/${scanData.retryTaskId}`)
      return
    }
    // 旧格式：MXG:<id> → 沿用原有批改流程
    setGradingData(scanData)
    setShowGrading(true)
  }

  const handleGradingComplete = (results) => {
    setShowGrading(false)
    setGradingData(null)
    Toast.show({ message: '批改完成，已更新错题本', type: 'success' })
    loadWrongBookData()
  }

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
    if (e.target && 'value' in e.target) e.target.value = ''
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

  // 打开错题详情弹窗（轻量查看：题干/选项/答案/解析/标签，编辑请去 PC 后台）
  const handleOpenWrongBookDetail = (wq) => {
    setWrongBookDetail(wq)
  }

  // 打印预览/组卷
  const handlePrintPreview = () => {
    if (selectedQuestions.length === 0) {
      Toast.show({ message: '请先选择要组卷的错题', type: 'error' })
      return
    }
    setShowPrintPreview(true)
  }

  const handleStartPriorityRetry = () => {
    if (priorityWrongQuestions.length === 0) {
      Toast.show({ message: '暂无待重练错题', type: 'info' })
      return
    }
    setSelectedQuestions(priorityWrongQuestions)
    setShowPrintPreview(true)
  }

  const handleRetrySingleWrongQuestion = (wq) => {
    setSelectedQuestions([wq])
    setWrongBookDetail(null)
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

  // 一键将当前筛选结果全部纳入重练（P2：知识点筛选→组卷重练）
  const handleRetryFiltered = () => {
    if (filteredWrongQuestions.length === 0) {
      Toast.show({ message: '当前筛选下没有可重练的错题', type: 'info' })
      return
    }
    setSelectedQuestions(filteredWrongQuestions)
    setShowPrintPreview(true)
  }

  const handleResetWrongBookFilters = () => {
    setSelectedSubject('all')
    setSelectedTimeRange('all')
    setSelectedErrorCount('all')
    setSelectedTags([])
    setSelectedErrorType('all')
    setSelectedRecentWrongRange('all')
    setSelectedMasteryStage('all')
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
        setSelectedQuestions(selectedQuestions.filter(q => q.id !== deleteTarget.id))
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

  // Render
  const appContent = (
    <>
      <div className="phone-frame">
        {/* Header */}
        <AppHeader
          currentStudent={currentStudent}
          isInitializing={isInitializing}
          onOpenStudentSwitcher={() => setShowStudentSwitcher(true)}
          onOpenLearningReport={() => setShowLearningReport(true)}
          onOpenNotifications={handleOpenNotifications}
          notificationCount={notifSummary?.totalNotifications || 0}
        />

        {/* Main Content */}
        <main className="w-full overflow-scroll-area" style={{ paddingBottom: '12px' }}>
          {/* 上传队列提示 — Claude style */}
          {uploadQueue.length > 0 && (
            <div className="sticky top-11 z-40 px-4 py-2.5 animate-fade-in" style={{ background: 'var(--warning-soft)', borderBottom: '1px solid rgba(232,168,56,0.2)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--warning)' }} />
                <span style={{ fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--warning)' }}>
                  正在排队上传 {uploadQueue.length} 个文件...
                </span>
              </div>
            </div>
          )}

          {/* 正在上传提示 — Claude style */}
          {isUploading && (
            <div className="sticky top-11 z-40 px-4 py-2.5 animate-fade-in" style={{ background: 'var(--primary-soft)', borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--primary)' }} />
                <span style={{ fontSize: 'var(--fs-12)', fontWeight: 500, color: 'var(--primary-hover)' }}>
                  正在上传试卷...
                </span>
              </div>
            </div>
          )}

          <AnimatePresence>
            {currentPage === 'processing' && (
              <HomeDashboard
                currentStudent={currentStudent}
                tasks={tasks}
                isLoadingTasks={isLoadingTasks}
                isInitializing={isInitializing}
                wrongCount={wrongQuestions.length}
                pendingWrongCount={pendingWrongQuestions.length}
                onStartUpload={() => setShowUploadOptions(true)}
                onOpenTasks={() => { setCurrentPage('tasks'); clearSelection() }}
                onOpenWrongBook={() => { setCurrentPage('wrongbook'); clearSelection() }}
                onOpenExam={() => { setCurrentPage('exam'); clearSelection() }}
                onOpenReview={(task) => { setReviewTask(task); setShowExamReview(true) }}
                onRetryTask={handleRetryTask}
              />
            )}

            {currentPage === 'tasks' && (
              <ProcessingPage
                currentStudent={currentStudent}
                tasks={tasks}
                filteredTasks={filteredTasks}
                isLoadingTasks={isLoadingTasks}
                isInitializing={isInitializing}
                processingFilter={processingFilter}
                onFilterChange={setProcessingFilter}
                onViewImage={handleViewImage}
                onRetryTask={handleRetryTask}
                onDeleteTask={(taskId) => { setDeleteTarget({ type: 'task', id: taskId }); setShowDeleteConfirm(true) }}
                onOpenReview={(task) => { setReviewTask(task); setShowExamReview(true) }}
              />
            )}

            {currentPage === 'wrongbook' && (
              <WrongBookPage
                currentStudent={currentStudent}
                wrongQuestions={wrongQuestions}
                filteredWrongQuestions={filteredWrongQuestions}
                bankFilter={bankFilter}
                onFilterChange={setBankFilter}
                showFilterPanel={showFilterPanel}
                onCloseFilterPanel={setShowFilterPanel}
                selectedSubject={selectedSubject}
                onSubjectChange={setSelectedSubject}
                selectedTimeRange={selectedTimeRange}
                onTimeRangeChange={setSelectedTimeRange}
                selectedErrorCount={selectedErrorCount}
                onErrorCountChange={setSelectedErrorCount}
                selectedTags={selectedTags}
                onTagsChange={setSelectedTags}
                allAvailableTags={allAvailableTags}
                selectedQuestions={selectedQuestions}
                priorityQuestions={priorityWrongQuestions}
                pendingWrongQuestionCount={pendingWrongQuestions.length}
                onToggleSelection={toggleSelection}
                onOpenDetail={handleOpenWrongBookDetail}
                onDelete={handleDeleteWrongQuestion}
                onStartPriorityRetry={handleStartPriorityRetry}
                onSelectAll={handleSelectAll}
                onPrintPreview={handlePrintPreview}
                selectedErrorType={selectedErrorType}
                onErrorTypeChange={setSelectedErrorType}
                selectedRecentWrongRange={selectedRecentWrongRange}
                onRecentWrongRangeChange={setSelectedRecentWrongRange}
                selectedMasteryStage={selectedMasteryStage}
                onMasteryStageChange={setSelectedMasteryStage}
                allAvailableErrorTypes={allAvailableErrorTypes}
                onRetryFiltered={handleRetryFiltered}
                onResetFilters={handleResetWrongBookFilters}
                bankCounts={bankCounts}
                hasMore={wrongBookHasMore}
                loadingMore={wrongBookLoading}
                onLoadMore={loadMoreWrongQuestions}
              />
            )}

            {/* 错题详情弹窗（轻量查看，编辑请去 PC 后台）
                修复：改为居中弹出（之前 items-end 从底部弹出 75vh，用户在 main 中间看错题时视线在屏幕中央，
                弹窗在屏幕下方容易看不到）。maxHeight 限 720px + 圆角，居中显示更显眼 */}
            {wrongBookDetail && (
              <div className="absolute inset-0 z-[20000] flex items-center justify-center px-4">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                  onClick={() => setWrongBookDetail(null)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  className="relative bg-white rounded-3xl w-full max-w-lg mx-auto shadow-xl"
                  style={{
                    maxHeight: 'min(85vh, 720px)',
                    display: 'flex',
                    flexDirection: 'column',
                    paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))'
                  }}
                >
                  <div className="flex justify-center pt-3 pb-1">
                    <div className="w-8 h-1 rounded-full" style={{ background: 'var(--border)' }} />
                  </div>
                  <div className="flex items-center justify-between px-5 pt-1 pb-2">
                    <h3 style={{ fontSize: 'var(--fs-16)', fontWeight: 600, color: 'var(--text)' }}>错题详情</h3>
                    <button
                      onClick={() => setWrongBookDetail(null)}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--bg-mist)' }}
                    >
                      <X size={14} style={{ color: 'var(--text-secondary)' }} />
                    </button>
                  </div>
                  <div className="overflow-y-auto px-5 pb-4">
                    {(() => {
                      const wq = wrongBookDetail
                      const q = wq.question || wq
                      const tags = q.tags_source === 'manual' ? (q.manual_tags || []) : (q.ai_tags || [])
                      const ls = wq.lifecycle_status || 'new'
                      const statusMap = { new: { text: '不懂', color: 'var(--warning)' }, review_1: { text: '复习1轮', color: 'var(--primary-hover)' }, review_2: { text: '复习2轮', color: 'var(--primary-hover)' }, mastered: { text: '完全懂', color: 'var(--success)' } }
                      const status = statusMap[ls] || statusMap.new
                      return (
                        <>
                          {/* 掌握状态 */}
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                              {dayjs(wq.added_at || wq.created_at).format('YYYY/MM/DD')}
                            </span>
                            <span style={{ fontSize: 'var(--fs-11)', padding: '2px 10px', borderRadius: 'var(--radius-sm)', background: status.color + '1A', color: status.color, fontWeight: 500 }}>
                              {status.text}
                            </span>
                          </div>

                          {/* 题目内容 */}
                          <p style={{ fontSize: 'var(--fs-14)', lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
                            {q.content || '（无题干）'}
                          </p>

                          {/* 选项 */}
                          {Array.isArray(q.options) && q.options.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              {q.options.map((opt, i) => {
                                const letter = String.fromCharCode(65 + i)
                                return (
                                  <div key={i} className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--text)' }}>
                                    <span className="font-medium flex-shrink-0">{letter}.</span>
                                    <span className="flex-1">{opt}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* 答案 */}
                          {q.answer && (
                            <div className="mt-3 rounded-lg px-3 py-2" style={{ background: 'var(--success-soft)' }}>
                              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--success)', fontWeight: 600 }}>答案 </span>
                              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--success)' }}>{q.answer}</span>
                            </div>
                          )}

                          {/* 解析 */}
                          {q.analysis && (
                            <div className="mt-2 rounded-lg px-3 py-2" style={{ background: 'var(--bg-mist)' }}>
                              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)', fontWeight: 600 }}>解析 </span>
                              <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text)' }}>{q.analysis}</span>
                            </div>
                          )}

                          {/* 配图 */}
                          {q.image_url && (
                            <div className="mt-3">
                              <button
                                onClick={() => handleViewImage(q.image_url)}
                                className="w-full rounded-xl overflow-hidden block"
                                style={{ background: 'var(--bg-secondary)' }}
                              >
                                <img
                                  src={q.image_url}
                                  alt="配图"
                                  loading="lazy"
                                  className="w-full object-cover"
                                  style={{ maxHeight: '260px' }}
                                  onError={(e) => {
                                    // 图片加载失败（如历史错误截图）→ 自动回退到整页原图，保证能看到本题
                                    const full = q.full_image_url
                                    if (full && e.currentTarget.src !== full) {
                                      e.currentTarget.src = full
                                    } else {
                                      e.currentTarget.style.display = 'none'
                                    }
                                  }}
                                />
                              </button>
                              {q.full_image_url && q.full_image_url !== q.image_url && (
                                <button
                                  onClick={() => handleViewImage(q.full_image_url)}
                                  className="mt-2 w-full py-2 rounded-lg text-[12px] font-medium"
                                  style={{ background: 'var(--primary-soft)', color: 'var(--primary-hover)' }}
                                >
                                  查看完整原图（含本题）
                                </button>
                              )}
                            </div>
                          )}

                          {/* 标签 */}
                          {tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                              {tags.map((tag, idx) => (
                                <span key={idx} style={{ fontSize: 'var(--fs-11)', padding: '2px 8px', borderRadius: 'var(--radius-8)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="mt-4 pt-3 flex gap-2" style={{ borderTop: '1px solid var(--border-light)' }}>
                            <button
                              onClick={() => handleRetrySingleWrongQuestion(wq)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium"
                              style={{ background: 'var(--primary)', color: 'var(--text-inverse)' }}
                            >
                              <RotateCcw size={15} />
                              只练这道题
                            </button>
                          </div>

                          {/* 编辑提示 */}
                          <div className="mt-4 rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: 'var(--primary-soft)' }}>
                            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-secondary)' }}>
                              需要修改题干 / 答案 / 标签？请到 <b>PC 端工作台 · 错题本</b> 中编辑
                            </span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </motion.div>
              </div>
            )}

            {/* 全屏图片查看器 — 支持单击放大/双击复位/双指捏合/滚轮缩放 */}
            {showImageViewer && selectedImage && (
              <div className="absolute inset-0 z-[30000] bg-black/95 flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 text-white">
                  <span style={{ fontSize: 'var(--fs-13)', color: 'rgba(255,255,255,0.7)' }}>双击放大 · 双指缩放 · 滚轮缩放</span>
                  <button className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.15)' }} onClick={() => setShowImageViewer(false)} aria-label="关闭预览">
                    <X size={18} />
                  </button>
                </div>
                <ImagePreview
                  src={selectedImage}
                  onClose={() => setShowImageViewer(false)}
                />
              </div>
            )}

            {currentPage === 'exam' && (
              <ExamPage
                studentExams={studentExams}
                submitExamId={submitExamId}
                submitFileInputRef={submitFileInputRef}
                onDeleteExam={(examId) => { setDeleteTarget({ type: 'exam', id: examId }); setShowDeleteConfirm(true) }}
                onDownloadPdf={handleDownloadPdf}
                onSubmitExam={handleSubmitExam}
                onSubmitFilesSelected={handleSubmitFilesSelected}
              />
            )}

          </AnimatePresence>
        </main>

        {/* Bottom Navigation — Claude Style */}
        <nav className="sticky bottom-0 z-50 glass border-t" style={{ borderColor: 'rgba(232,229,224,0.6)' }}>
          <div className="max-w-lg mx-auto flex items-center justify-around" style={{ padding: '6px 0', paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))' }}>
            {[
              { id: 'processing', icon: Camera, label: '???' },
              { id: 'tasks', icon: Upload, label: '??' },
              { id: 'wrongbook', icon: LayoutGrid, label: '??' },
              { id: 'exam', icon: FileText, label: '??' },
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
                      style={{ color: isActive ? 'var(--primary)' : 'var(--text-secondary)' }}
                    />
                  </div>
                  <span style={{
                    fontSize: 'var(--fs-10)',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
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

        {/* Worksheet Picker */}
        <WorksheetPicker
          visible={showWorksheetPicker}
          onClose={() => {
            setShowWorksheetPicker(false)
          }}
          onSelect={({ worksheetId, worksheetName }) => {
            setShowWorksheetPicker(false)
            if (homeworkChoiceRef.current.length > 0) {
              // 来自暂存区：有练习册 → 走练习册批改；"不使用练习册" → 未知来源 AI 批改
              if (worksheetId) {
                handleUploadAsWorkbook(worksheetId)
              } else {
                handleUploadAsRegular()
              }
            } else if (worksheetId) {
              // 旧 flow：选完练习册 → 打开暂存区（连拍/多选）
              setSelectedWorksheetId(worksheetId)
              setPendingFlow('workbook')
              openStaging('workbook')
            } else {
              // 用户点击"不使用练习册" → 清除 workbook 流程
              setPendingFlow(null)
            }
          }}
          subject={flowSubject}
        />

        {/* Floating Action Button — Claude style
            单击：直达暂存区（拍照/相册，零菜单）
            长按(>450ms)：展开上传类型选择（日常作业/普通试卷/错题重练） */}
        {currentPage === 'processing' && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.05 }}
            onClick={() => {
              if (fabLongPressRef.current) { fabLongPressRef.current = false; return }
              setPendingFlow(null); setSelectedWorksheetId(null); openStaging('regular')
            }}
            onPointerDown={() => { fabPressRef.current = Date.now() }}
            onPointerUp={() => {
              if (Date.now() - fabPressRef.current > 450) {
                fabLongPressRef.current = true
                setShowUploadOptions(true)
              }
            }}
            onPointerCancel={() => { fabPressRef.current = 0 }}
            onContextMenu={(e) => e.preventDefault()}
            className="absolute right-5 z-50 flex items-center justify-center shadow-lg tap-scale"
            style={{
              width: '54px',
              height: '54px',
              borderRadius: 'var(--radius-16)',
              background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
              boxShadow: 'var(--shadow-primary)',
              bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <Plus size={24} strokeWidth={3} className="text-white" />
          </motion.button>
        )}

        {/* Upload Options Menu — Three cards */}
        {showUploadOptions && (
          <UploadOptionsModal
            onClose={() => setShowUploadOptions(false)}
            onStartHomework={() => { setShowUploadOptions(false); openStaging('homework') }}
            onStartRegular={() => { setShowUploadOptions(false); setPendingFlow(null); setSelectedWorksheetId(null); openStaging('regular') }}
            onStartWrongRetry={() => { setShowUploadOptions(false); setPendingFlow(null); setSelectedWorksheetId(null); openStaging('wrong_retry') }}
          />
        )}

        {/* 拍照+相册暂存区 */}
        {showStaging && (
          <StagingModal
            stagingType={stagingType}
            stagingFiles={stagingFiles}
            stagingUploading={stagingUploading}
            cameraInputRef={cameraInputRef}
            albumInputRef={albumInputRef}
            onBackdrop={() => { if (!stagingUploading) clearStaging() }}
            onClose={() => { if (!stagingUploading) clearStaging() }}
            onCamera={() => cameraInputRef.current?.click()}
            onAlbum={() => albumInputRef.current?.click()}
            onFilesSelected={handleStagingSelectFiles}
            onRemoveFile={removeStagingFile}
            onSubmit={handleSubmitStaging}
          />
        )}

        {/* 普通试卷已有答案库选择对话框 */}
        {showExamChoice && (
          <ExamChoiceModal
            examChoiceFiles={examChoiceFiles}
            availableExamResources={availableExamResources}
            onBackdrop={() => { setShowExamChoice(false); setExamChoiceFiles([]) }}
            onUploadWithResource={handleUploadWithExamResource}
            onUploadFresh={handleUploadFreshExam}
          />
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
          <DeleteConfirmModal
            onCancel={() => setShowDeleteConfirm(false)}
            onConfirm={handleConfirmDelete}
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

        {/* Notification Panel / 通知 */}
        {showNotifications && (
          <NotificationsPanel onClose={() => setShowNotifications(false)} />
        )}

        {/* Learning Report / 学习报告 */}
        {showLearningReport && (
          <LearningReportPanel onClose={() => setShowLearningReport(false)} WeeklyReport={WeeklyReport} />
        )}
        </div>
      </>
    )

    // 错题重练任务入口：/retry-task/:id 全屏渲染，无底部 tab
    if (retryTaskId) {
      return (
        <ToastProvider>
          <Suspense fallback={<LazyFallback />}>
            <RetryTask
              taskId={retryTaskId}
              onBack={() => navigate('/')}
            />
          </Suspense>
        </ToastProvider>
      )
    }

    return (
      <ToastProvider>
        {/* PC端 + 试卷入库校对/结果时，全屏显示，跳出手机模拟器 */}
        {!isMobile && paperBank.paperBankStep === 'proofread' ? (
          <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
            {appContent}
          </div>
        ) : (
          <div className="min-h-screen" style={{ background: isMobile ? 'var(--bg)' : 'var(--border-light)' }}>
            {appContent}
          </div>
        )}
      </ToastProvider>
    )
}
