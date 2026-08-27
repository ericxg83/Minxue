import { useCallback, useEffect, useState, useRef, lazy, Suspense, useMemo } from 'react'
import {
  Camera,
  Loader2,
  LayoutGrid,
  FileText,
  Upload,
  X,
  Tag,
  Download
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStudentStore, useTaskStore, useWrongQuestionStore, useExamStore } from './store'
import { getStudents, getTasksByStudent, getQuestionsByTask, getExamsByStudent, getGeneratedExamsByStudent, getGeneratedExamById, updateTaskStatus, updateQuestion, updateQuestionTags, invalidateCache, createStudent, getQuestionsByIds, deleteTask, deleteGeneratedExam, deleteWrongQuestion, recalculateTaskStats, clearStudentCaches, peekCache, writeCache, fetchWrongQuestionsPage, getTasksSummary, markNotificationsRead } from './services/apiService'
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
import WrongQuestionDetailModal from './components/WrongQuestionDetailModal'
import ProcessingPage from './pages/ProcessingPageV2'
import HomeDashboard from './components/HomeDashboardV2'
import WrongBookPage from './pages/WrongBookPageV2'
import ExamPage from './pages/ExamPageV2'
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

  // Bank Page State — 筛选面板已随移动端重构移除，错题本只保留生命周期 Tab + 优选组卷
  const [showQRCode, setShowQRCode] = useState(false)
  const [printMode, setPrintMode] = useState('all')
  const [printSize, setPrintSize] = useState('a4')
  const [showGrading, setShowGrading] = useState(false)
  const [showReprint, setShowReprint] = useState(false)
  const [reprintExam, setReprintExam] = useState(null)
  const [reprintQuestions, setReprintQuestions] = useState([])

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

  // Load tasks when student changes（重练页需要 tasks 通过 generated_exam_id 关联批改结果）
  useEffect(() => {
    if (currentStudent && ['processing', 'tasks', 'exam'].includes(currentPage)) {
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


  // Load wrong questions（错题本计数供首页"待复习"卡片使用，首页也需预热；秒开缓存使其成本极低）
  useEffect(() => {
    if (currentStudent && (currentPage === 'wrongbook' || currentPage === 'processing')) {
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
  // 整体替换会冲掉"正在上传/上传失败"的本地 temp 任务（服务端还没有该记录），
  // 用户切页期间上传中的任务会凭空消失、失败也无从落地——这里始终把它们合并回来。
  const mergeTempTasks = (list, studentId) => {
    const temps = (Array.isArray(tasksRef.current) ? tasksRef.current : [])
      .filter(t => typeof t.id === 'string' && t.id.startsWith('temp-') && t.student_id === studentId)
    if (temps.length === 0) return Array.isArray(list) ? list : []
    const serverIds = new Set((Array.isArray(list) ? list : []).map(t => t.id))
    return [...temps.filter(t => !serverIds.has(t.id)), ...(Array.isArray(list) ? list : [])]
  }
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
    if (hasCache) setTasks(mergeTempTasks(cached, studentId))
    if (showSkeleton && !hasCache) setIsLoadingTasks(true)
    // 2) 后台拉取最新数据覆盖
    try {
      const taskList = await getTasksByStudent(studentId, false)
      setTasks(mergeTempTasks(taskList, studentId))
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
    retryTempUpload,
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

  // Filter wrong questions — 筛选面板移除后只保留学生维度过滤，生命周期筛选由错题本页内 Tab 完成
  const filteredWrongQuestions = useMemo(() => (Array.isArray(wrongQuestions) ? wrongQuestions : []).filter(wq => wq.student_id === currentStudent?.id),
    [wrongQuestions, currentStudent?.id])

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

  // 重练卷完成态 → 经 generated_exam_id 找回关联批改任务，复用作业页的复核界面
  const handleOpenExamResult = (exam) => {
    const all = Array.isArray(tasks) ? tasks : []
    const linked = all.find(t => t.generated_exam_id === exam.id && isTaskCompleted(t))
      || all.find(t => t.generated_exam_id === exam.id)
    if (!linked) {
      Toast.show({ message: '未找到这份卷的批改记录', type: 'info' })
      return
    }
    setReviewTask(linked)
    setShowExamReview(true)
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
        setTasks(mergeTempTasks(freshTasks, currentStudent.id))
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

    // 本地上传失败的任务：服务端没有记录，走客户端原样重传
    if (typeof taskId === 'string' && taskId.startsWith('temp-')) {
      await retryTempUpload(taskId)
      return
    }

    try {
      Toast.show({ message: '正在重新处理...', type: 'info', duration: 2000 })

      // 服务端从库里读取全部路由字段（taskType / worksheetId / resourceId / images），
      // 这里只传 taskId，避免前端缺字段导致 workbook 任务被降级为通用 AI 管线。
      const response = await fetch('/api/tasks/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || '重新处理失败')
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
              <HomeDashboard key='page-processing'
                currentStudent={currentStudent}
                tasks={tasks}
                isLoadingTasks={isLoadingTasks}
                isInitializing={isInitializing}
                pendingWrongCount={pendingWrongQuestions.length}
                onStartUpload={() => setShowUploadOptions(true)}
                onOpenTasks={() => { setCurrentPage('tasks'); clearSelection() }}
                onStartPriorityRetry={handleStartPriorityRetry}
                onRetryTask={handleRetryTask}
                onDismissTask={(taskId) => { setDeleteTarget({ type: 'task', id: taskId }); setShowDeleteConfirm(true) }}
              />
            )}

            {currentPage === 'tasks' && (
              <ProcessingPage key='page-tasks'
                currentStudent={currentStudent}
                tasks={tasks}
                filteredTasks={filteredTasks}
                isLoadingTasks={isLoadingTasks}
                isInitializing={isInitializing}
                processingFilter={processingFilter}
                onFilterChange={setProcessingFilter}
                onRetryTask={handleRetryTask}
                onDeleteTask={(taskId) => { setDeleteTarget({ type: 'task', id: taskId }); setShowDeleteConfirm(true) }}
                onOpenReview={(task) => { setReviewTask(task); setShowExamReview(true) }}
              />
            )}

            {currentPage === 'wrongbook' && (
              <WrongBookPage key='page-wrongbook'
                filteredWrongQuestions={filteredWrongQuestions}
                bankCounts={bankCounts}
                selectedQuestions={selectedQuestions}
                pendingWrongQuestionCount={pendingWrongQuestions.length}
                onToggleSelection={toggleSelection}
                onOpenDetail={handleOpenWrongBookDetail}
                onDelete={handleDeleteWrongQuestion}
                onPrintPreview={handlePrintPreview}
                hasMore={wrongBookHasMore}
                loadingMore={wrongBookLoading}
                onLoadMore={loadMoreWrongQuestions}
              />
            )}

            {/* 错题详情弹窗（轻量查看，编辑请去 PC 后台），结构对齐组卷详情 ExamDetailModal */}
            {wrongBookDetail && (
              <WrongQuestionDetailModal
                key='wrong-detail'
                wrongQuestion={wrongBookDetail}
                onClose={() => setWrongBookDetail(null)}
                onRetry={handleRetrySingleWrongQuestion}
                onViewImage={handleViewImage}
              />
            )}

            {/* 全屏图片查看器 — 支持单击放大/双击复位/双指捏合/滚轮缩放 */}
            {showImageViewer && selectedImage && (
              <div key='image-viewer' className="absolute inset-0 z-[30000] bg-black/95 flex flex-col">
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
              <ExamPage key='page-exam'
                studentExams={studentExams}
                onReprint={handleReprintExam}
                onDelete={(exam) => { setDeleteTarget({ type: 'exam', id: exam.id }); setShowDeleteConfirm(true) }}
                onOpenResult={handleOpenExamResult}
                onOpenWrongBook={() => setCurrentPage('wrongbook')}
              />
            )}

          </AnimatePresence>
        </main>

        {/* Bottom Navigation — Claude Style */}
        <nav className="sticky bottom-0 z-50 glass border-t" style={{ borderColor: 'rgba(232,229,224,0.6)' }}>
          <div className="max-w-lg mx-auto flex items-center justify-around" style={{ padding: '6px 0', paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))' }}>
            {[
              { id: 'processing', icon: Camera, label: '首页' },
              { id: 'tasks', icon: Upload, label: '作业' },
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
                handleUploadAsWorkbook(worksheetId, worksheetName)
              } else {
                handleUploadAsRegular()
              }
            } else if (worksheetId) {
              // 旧 flow：选完练习册 → 打开暂存区（连拍/多选）
              setSelectedWorksheetId(worksheetId)
              setPendingFlow('workbook')
              __pendingUploadStore.worksheetId = worksheetId
              __pendingUploadStore.worksheetName = worksheetName || null
              openStaging('workbook')
            } else {
              // 用户点击"不使用练习册" → 清除 workbook 流程
              setPendingFlow(null)
            }
          }}
          subject={flowSubject}
        />

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
