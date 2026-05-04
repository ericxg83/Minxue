import { useEffect, useState, useRef, createContext, useContext } from 'react'
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
  Eye
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { useUIStore, useStudentStore, useTaskStore, useWrongQuestionStore, usePendingQuestionStore, useExamStore } from './store'
import { getStudents, getTasksByStudent, getQuestionsByTask, addWrongQuestions, getWrongQuestionsByStudent, getExamsByStudent, createTask, updateTaskStatus, uploadImage, createQuestions } from './services/supabaseService'
import { recognizeQuestions, compressImage, saveRecognitionResult } from './services/aiService'
import { mockQuestions, mockTasks, mockWrongQuestions, mockExams, mockStudents } from './data/mockData'
import StudentSwitcher from './components/StudentSwitcher'
import QuestionEditDrawer from './components/QuestionEditDrawer'
import ScanQR from './pages/ScanQR'
import Grading from './pages/Grading'
import dayjs from 'dayjs'

// ==================== UI Tool Components ====================

// Toast Component
const ToastContext = createContext(null)

function ToastContainer({ toasts }) {
  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] flex flex-col items-center gap-3 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-slate-900/90 backdrop-blur-xl text-white px-6 py-4 rounded-2xl shadow-2xl min-w-[160px] max-w-[280px] text-center"
          >
            <div className="flex flex-col items-center gap-2">
              {toast.icon === 'success' && <CheckCircle2 size={32} className="text-green-400" strokeWidth={2.5} />}
              {toast.icon === 'fail' && <XCircle size={32} className="text-red-400" strokeWidth={2.5} />}
              {toast.icon === 'loading' && <Loader2 size={32} className="text-blue-400 animate-spin" strokeWidth={2.5} />}
              {toast.icon === 'info' && <Eye size={32} className="text-blue-400" strokeWidth={2.5} />}
              <div className="text-[13px] font-medium leading-snug">{toast.content}</div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = (options) => {
    const id = Date.now()
    const toast = { id, icon: options.icon, content: options.content, duration: options.duration || 2000 }
    setToasts(prev => [...prev, toast])
    if (toast.duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), toast.duration)
    }
    return id
  }

  const clear = () => setToasts([])

  return (
    <ToastContext.Provider value={{ addToast, clear }}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  )
}

const Toast = {
  show: (options) => {
    if (typeof window !== 'undefined' && window.__toast) {
      return window.__toast.addToast(options)
    }
  },
  clear: () => {
    if (typeof window !== 'undefined' && window.__toast) {
      window.__toast.clear()
    }
  }
}

// Dialog Component
function Dialog({ visible, title, content, confirmText = '确定', cancelText = '取消', onConfirm, onCancel }) {
  if (!visible) return null

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10001] bg-white rounded-3xl shadow-2xl max-w-[280px] w-[85%] overflow-hidden"
          >
            {title && (
              <div className="px-6 pt-6 pb-3">
                <h3 className="text-[17px] font-bold text-slate-900 text-center">{title}</h3>
              </div>
            )}
            <div className="px-6 pb-6">
              <p className="text-[14px] text-slate-600 leading-relaxed text-center">{content}</p>
            </div>
            <div className="flex border-t border-gray-100">
              <button onClick={onCancel} className="flex-1 py-4 text-[15px] font-medium text-slate-600 active:bg-gray-50 transition-colors">
                {cancelText}
              </button>
              <div className="w-px bg-gray-100" />
              <button onClick={onConfirm} className="flex-1 py-4 text-[15px] font-bold text-blue-600 active:bg-blue-50 transition-colors">
                {confirmText}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

const DialogAPI = {
  confirm: ({ title, content, confirmText, cancelText, onConfirm, onCancel }) => {
    if (typeof window !== 'undefined' && window.__dialog) {
      window.__dialog.show({
        title, content,
        confirmText: confirmText || '确定',
        cancelText: cancelText || '取消',
        onConfirm: () => { window.__dialog.hide(); onConfirm && onConfirm() },
        onCancel: () => { window.__dialog.hide(); onCancel && onCancel() }
      })
    }
  }
}

// ActionSheet Component
function ActionSheet({ visible, actions, onClose }) {
  if (!visible) return null

  return (
    <AnimatePresence>
      {visible && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 z-[10000] bg-white rounded-t-3xl overflow-hidden max-w-md mx-auto"
          >
            <div className="p-3">
              {actions.map((action, index) => (
                <button
                  key={action.key || index}
                  onClick={() => { action.onClick && action.onClick(action); onClose() }}
                  className="w-full py-4 px-4 text-center active:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                >
                  <div className="text-[16px] font-medium text-slate-900">{action.text}</div>
                  {action.description && <div className="text-[12px] text-gray-400 mt-1">{action.description}</div>}
                </button>
              ))}
              <button onClick={onClose} className="w-full py-4 px-4 text-center active:bg-gray-50 transition-colors mt-2">
                <div className="text-[16px] font-medium text-slate-600">取消</div>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ==================== Main App ====================

const USE_MOCK_DATA = false

export default function App() {
  // State from stores
  const { currentPage, setCurrentPage } = useUIStore()
  const { students, currentStudent, setCurrentStudent, setStudents, addStudent } = useStudentStore()
  const { tasks, setTasks, addTask, updateTaskStatus: updateTaskInStore } = useTaskStore()
  const { wrongQuestions, setWrongQuestions, selectedQuestions, setSelectedQuestions, clearSelection, addWrongQuestion, addWrongQuestions: addMultipleToStore } = useWrongQuestionStore()
  const { pendingQuestions, setPendingQuestions, addPendingQuestions } = usePendingQuestionStore()
  const { exams, setExams, generatedExams, setGeneratedExams } = useExamStore()

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
  const [showPrintPreview, setShowPrintPreview] = useState(false)

  // Exam Page State
  const [examFilter, setExamFilter] = useState('all')
  const [selectedPaperId, setSelectedPaperId] = useState(null)
  const [reprintExam, setReprintExam] = useState(null)
  const [reprintQuestions, setReprintQuestions] = useState([])

  // UI State
  const [showStudentSwitcher, setShowStudentSwitcher] = useState(false)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [showGrading, setShowGrading] = useState(false)
  const [showScanQR, setShowScanQR] = useState(false)
  const [gradingParams, setGradingParams] = useState(null)
  const [dialogState, setDialogState] = useState({ visible: false, title: '', content: '', confirmText: '确定', cancelText: '取消', onConfirm: null, onCancel: null })
  const fileInputRef = useRef(null)

  // New UI State from reference
  const [showOriginalPaper, setShowOriginalPaper] = useState(null)
  const [showFullPaper, setShowFullPaper] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [showCropTool, setShowCropTool] = useState(false)
  const [isAddStudentOpen, setIsAddStudentOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editTab, setEditTab] = useState('content')
  const [displayEditImage, setDisplayEditImage] = useState('')

  const getTypeLabel = (type) => {
    const map = { choice: '选择题', fill: '填空题', answer: '解答题', CHOICE: '选择题', FILL: '填空题', ANSWER: '解答题' }
    return map[type] || type || '选择题'
  }

  const cleanOptionPrefix = (options) => {
    return (options || []).map(opt => {
      const cleaned = String(opt).replace(/^[A-Da-d][、.\.\s]*/, '').trim()
      return cleaned
    })
  }

  const isChoiceQuestion = (type) => {
    const t = String(type || '').toLowerCase()
    return t === 'choice'
  }

  // Expose Toast and Dialog to window
  useEffect(() => {
    window.__toast = { addToast: (opts) => { /* implemented below */ }, clear: () => {} }
  }, [])

  // Toast State
  const [toastList, setToastList] = useState([])
  const showToast = (options) => {
    const id = Date.now()
    const toast = { id, icon: options.icon, content: options.content, duration: options.duration || 2000 }
    setToastList(prev => [...prev, toast])
    if (toast.duration > 0) {
      setTimeout(() => setToastList(prev => prev.filter(t => t.id !== id)), toast.duration)
    }
  }
  const clearToast = () => setToastList([])

  useEffect(() => {
    window.__toast = { addToast: showToast, clear: clearToast }
  }, [])

  useEffect(() => {
    window.__dialog = {
      show: (opts) => setDialogState({ visible: true, ...opts }),
      hide: () => setDialogState(prev => ({ ...prev, visible: false }))
    }
  }, [])

  // Initialize students
  useEffect(() => {
    const init = async () => {
      try {
        const loadedStudents = await getStudents(true)
        if (loadedStudents && loadedStudents.length > 0) {
          setStudents(loadedStudents)
          setCurrentStudent(loadedStudents[0])
        } else {
          setStudents([])
          setCurrentStudent(null)
        }
      } catch (error) {
        console.error('加载学生数据失败:', error)
        setStudents([])
        setCurrentStudent(null)
      }
    }
    init()
  }, [])

  // Load tasks when student changes
  useEffect(() => {
    if (currentStudent && currentPage === 'processing') {
      loadTasks()
    }
  }, [currentStudent?.id, currentPage])

  // Load pending questions
  useEffect(() => {
    if (currentStudent && currentPage === 'pending') {
      loadPendingData()
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
      loadGeneratedExams()
    }
  }, [currentStudent?.id, currentPage])

  // Exam: Load generated exams
  const loadGeneratedExams = async () => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) return
      const { getGeneratedExamsByStudent } = await import('./services/supabaseService')
      const examList = await getGeneratedExamsByStudent(currentStudent.id, true)
      const otherStudentExams = generatedExams.filter(e => e.student_id !== currentStudent.id)
      setGeneratedExams([...otherStudentExams, ...examList])
    } catch (error) {
      console.error('加载试卷失败:', error)
    }
  }

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

  // Processing: Load tasks
  const loadTasks = async () => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) {
        const filteredMockTasks = mockTasks.filter(t => t.student_id === currentStudent.id)
        const existingIds = new Set(tasks.map(t => t.id))
        const newTasks = filteredMockTasks.filter(t => !existingIds.has(t.id))
        if (newTasks.length > 0) {
          setTasks([...tasks, ...newTasks])
        }
        return
      }
      const taskList = await getTasksByStudent(currentStudent.id, true)
      const safeTaskList = Array.isArray(taskList) ? taskList : []
      const existingIds = new Set(tasks.map(t => t.id))
      const newTasks = safeTaskList.filter(t => !existingIds.has(t.id))
      if (newTasks.length > 0) {
        setTasks([...tasks, ...newTasks])
      }
    } catch (error) {
      console.error('加载任务失败:', error)
    }
  }

  // Pending: Load data
  const loadPendingData = async () => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) {
        return
      }
      const taskList = await getTasksByStudent(currentStudent.id, true)
      const safeTaskList = Array.isArray(taskList) ? taskList : []
      const doneTasks = safeTaskList.filter(t => t.status === 'done')
      const allQuestions = []
      for (const task of doneTasks) {
        try {
          const taskQuestions = await getQuestionsByTask(task.id, true)
          const safeQuestions = Array.isArray(taskQuestions) ? taskQuestions : []
          allQuestions.push(...safeQuestions.map(q => ({ ...q, status: q.is_correct ? 'correct' : 'wrong' })))
        } catch (taskError) {
          console.error(`获取任务 ${task.id} 的题目失败:`, taskError)
        }
      }
      // 更新 pendingQuestions 状态
      if (allQuestions.length > 0) {
        setPendingQuestions(allQuestions)
      }
    } catch (error) {
      console.error('加载任务失败:', error)
    }
  }

  // WrongBook: Load data
  const loadWrongBookData = async () => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) {
        if (mockWrongQuestions.length > 0) {
          const existingIds = new Set(wrongQuestions.map(wq => wq.id))
          const newMockQuestions = mockWrongQuestions.filter(wq => !existingIds.has(wq.id))
          if (newMockQuestions.length > 0) {
            setWrongQuestions(prev => [...prev, ...newMockQuestions])
          }
        }
        return
      }
      const data = await getWrongQuestionsByStudent(currentStudent.id, true)
      const safeData = Array.isArray(data) ? data : []
      const existingIds = new Set(wrongQuestions.map(wq => wq.id))
      const newData = safeData.filter(d => !existingIds.has(d.id))
      if (newData.length > 0) {
        setWrongQuestions(prev => [...prev, ...newData])
      }
    } catch (error) {
      console.error('加载错题失败:', error)
    }
  }

  // Exam: Load exams
  const loadExams = async () => {
    if (!currentStudent) return
    try {
      if (USE_MOCK_DATA) {
        const studentMockExams = mockExams.filter(e => e.student_id === currentStudent.id)
        const existingIds = new Set(exams.map(e => e.id))
        const newMockExams = studentMockExams.filter(e => !existingIds.has(e.id))
        if (newMockExams.length > 0) {
          setExams([...exams, ...newMockExams])
        }
        return
      }
      const examList = await getExamsByStudent(currentStudent.id, true)
      const otherStudentExams = exams.filter(e => e.student_id !== currentStudent.id)
      setExams([...otherStudentExams, ...examList])
    } catch (error) {
      console.error('加载试卷失败:', error)
    }
  }

  // Upload file handler
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return
    e.target.value = ''
    setUploading(true)
    showToast({ icon: 'loading', content: `正在上传 ${files.length} 个文件...`, duration: 0 })
    try {
      for (const file of files) {
        await uploadFile(file)
      }
      clearToast()
      showToast({ icon: 'success', content: `成功上传 ${files.length} 个文件`, duration: 2000 })
    } catch (error) {
      console.error('上传失败:', error)
      clearToast()
      showToast({ icon: 'fail', content: '上传失败，请重试' })
    } finally {
      setUploading(false)
    }
  }

  const uploadFile = async (file) => {
    const imageBase64 = await fileToBase64(file)

    let imageUrl = imageBase64

    try {
      const storageUrl = await uploadImage(file, `tasks/${currentStudent.id}`)
      imageUrl = storageUrl
    } catch (uploadError) {
      console.warn('上传图片到存储失败，使用 base64:', uploadError)
    }

    const taskData = {
      student_id: currentStudent.id,
      image_url: imageUrl,
      original_name: file.name || `照片_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.jpg`,
      status: 'processing',
      result: { progress: 0 }
    }

    console.log('准备保存任务到 Supabase:', taskData.original_name)
    
    try {
      const savedTask = await createTask(taskData)
      console.log('任务已成功保存到数据库:', savedTask.id, savedTask.student_id, savedTask.status)

      const localTask = {
        ...savedTask,
        result: { progress: 0 }
      }

      addTask(localTask)

      processImageAsync(localTask.id, file, savedTask.id)
    } catch (error) {
      console.error('创建任务失败:', error)
      console.error('错误详情:', error?.message, error?.code, error?.details)
      
      showToast({
        icon: 'fail',
        content: '上传失败，请重试'
      })
      throw error
    }
  }

  const processImageAsync = async (taskId, file, dbTaskId) => {
    try {
      updateTaskInStore(taskId, 'processing', { progress: 10 })
      await updateTaskStatus(dbTaskId, 'processing', { progress: 10 })
      console.log('开始压缩图片:', file.name, file.size, 'bytes')

      let compressedBase64
      try {
        compressedBase64 = await compressImage(file, 1920, 1920, 0.85)
        console.log('图片压缩完成，大小:', compressedBase64.length, 'bytes')
      } catch (compressError) {
        console.error('图片压缩失败:', compressError)
        updateTaskInStore(taskId, 'failed', { error: '图片压缩失败: ' + compressError.message })
        await updateTaskStatus(dbTaskId, 'failed', { error: '图片压缩失败: ' + compressError.message })
        return
      }
      updateTaskInStore(taskId, 'processing', { progress: 30 })
      await updateTaskStatus(dbTaskId, 'processing', { progress: 30 })

      updateTaskInStore(taskId, 'processing', { progress: 50 })
      await updateTaskStatus(dbTaskId, 'processing', { progress: 50 })
      const result = await recognizeQuestions(compressedBase64, currentStudent.id, taskId)

      if (!result.success) {
        updateTaskInStore(taskId, 'failed', {
          error: result.error || '识别失败，请重新上传或重试',
          shouldRetry: result.shouldRetry
        })
        await updateTaskStatus(dbTaskId, 'failed', {
          error: result.error || '识别失败，请重新上传或重试',
          shouldRetry: result.shouldRetry
        })
        return
      }

      updateTaskInStore(taskId, 'processing', { progress: 80 })
      await updateTaskStatus(dbTaskId, 'processing', { progress: 80 })

      const questions = result.questions || []
      const wrongCount = questions.filter(q => !q.is_correct).length

      const saveResult = saveRecognitionResult(taskId, currentStudent.id, questions)
      if (!saveResult.success) {
        console.warn('保存识别结果到本地失败:', saveResult.error)
      }

      if (questions.length > 0) {
        console.log('开始保存题目到 Supabase，数量:', questions.length)
        console.log('题目示例 task_id:', questions[0]?.task_id)
        try {
          const savedQ = await createQuestions(questions)
          console.log('题目已成功保存到 Supabase, 返回数量:', savedQ?.length || 0)
          if (savedQ && savedQ.length > 0) {
            console.log('已保存题目示例:', savedQ[0])
          }
        } catch (saveError) {
          console.error('保存题目到 Supabase 失败:', saveError)
          console.error('错误详情:', saveError?.message, saveError?.code, saveError?.details)
        }
      }

      await updateTaskStatus(dbTaskId, 'done', {
        questionCount: questions.length,
        wrongCount: wrongCount,
        duration: result.duration
      })
      updateTaskInStore(taskId, 'done', {
        questionCount: questions.length,
        wrongCount: wrongCount,
        duration: result.duration
      })

      if (questions.length > 0) {
        addPendingQuestions(questions)
      }

      console.log(`识别完成，发现 ${questions.length} 道题目，${wrongCount} 道疑似错题`)
      showToast({
        icon: 'success',
        content: `识别完成，发现 ${questions.length} 道题目，${wrongCount} 道疑似错题`
      })

      if (questions.filter(q => !q.is_correct).length > 0) {
        setCurrentPage('pending')
      }

    } catch (error) {
      console.error('处理失败:', error)
      updateTaskInStore(taskId, 'failed', {
        error: error.message || '处理失败，请重新上传或重试'
      })
      await updateTaskStatus(dbTaskId, 'failed', {
        error: error.message || '处理失败，请重新上传或重试'
      })

      showToast({
        icon: 'fail',
        content: '处理失败，请重新上传或重试'
      })
      throw error
    }
  }

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => resolve(reader.result)
      reader.onerror = (error) => reject(error)
    })
  }

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
          updateTaskInStore(taskId, 'done', { questionCount, wrongCount })
          showToast({ icon: 'success', content: `识别完成，发现 ${questionCount} 道题目` })
        } else {
          updateTaskInStore(taskId, 'failed', { error: '识别失败' })
        }
      } else {
        updateTaskInStore(taskId, 'processing', { progress: Math.floor(progress) })
      }
    }, 500)
  }

  // Confirm: Add to wrong book
  const addSingleToWrongBook = async (question) => {
    try {
      if (USE_MOCK_DATA) {
        const wrongQuestion = {
          id: `wq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          student_id: currentStudent.id,
          question_id: question.id,
          question: question,
          status: 'pending',
          error_count: 1,
          subject: question.subject || '数学',
          category: '其他',
          added_at: new Date().toISOString(),
          last_wrong_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        }
        addWrongQuestion(wrongQuestion)
        showToast({ icon: 'success', content: '已加入错题本' })
      } else {
        await addWrongQuestions(currentStudent.id, [question.id])
        addWrongQuestion(question)
        showToast({ icon: 'success', content: '已加入错题本' })
      }
    } catch (error) {
      console.error('添加失败:', error)
      showToast({ icon: 'fail', content: '添加失败' })
    }
  }

  const handleAddToWrongBook = async () => {
    if (selectedConfirmIds.length === 0) {
      showToast({ icon: 'info', content: '请先选择题目' })
      return
    }
    DialogAPI.confirm({
      content: `确定将选中的 ${selectedConfirmIds.length} 道题加入错题本？`,
      onConfirm: async () => {
        setLoading(true)
        try {
          if (USE_MOCK_DATA) {
            const selectedQuestions = pendingQuestions.filter(q => selectedConfirmIds.includes(q.id))
            const wrongQuestions = selectedQuestions.map(q => ({
              id: `wq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              student_id: currentStudent.id,
              question_id: q.id,
              question: q,
              status: 'pending',
              error_count: 1,
              subject: q.subject || '数学',
              category: '其他',
              added_at: new Date().toISOString(),
              last_wrong_at: new Date().toISOString(),
              created_at: new Date().toISOString()
            }))
            addMultipleToStore(wrongQuestions)
            setPendingQuestions(pendingQuestions.filter(q => !selectedConfirmIds.includes(q.id)))
          } else {
            await addWrongQuestions(currentStudent.id, selectedConfirmIds)
          }
          showToast({ icon: 'success', content: `成功添加 ${selectedConfirmIds.length} 道题到错题本` })
          setSelectedConfirmIds([])
        } catch (error) {
          console.error('添加失败:', error)
          showToast({ icon: 'fail', content: '添加失败' })
        } finally {
          setLoading(false)
        }
      }
    })
  }

  // Scan success handler
  const handleScanSuccess = (params) => {
    setGradingParams(params)
    setShowScanQR(false)
    setShowGrading(true)
  }

  // Filter processing tasks
  const filteredTasks = tasks
    .filter(task => {
      if (task.student_id !== currentStudent?.id) return false
      if (processingFilter === 'all') return true
      return task.status === processingFilter
    })
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

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

  const filteredWrongQuestions = wrongQuestions.filter(wq => {
    if (wq.student_id !== currentStudent?.id) return false
    if (bankFilter !== 'all' && wq.status !== bankFilter) return false
    if (selectedSubject !== 'all' && wq.subject !== selectedSubject) return false
    if (selectedTimeRange !== 'all' && !isWithinTimeRange(wq.added_at || wq.created_at, selectedTimeRange)) return false
    if (selectedErrorCount !== 'all' && !matchErrorCount(wq.error_count || 1, selectedErrorCount)) return false
    return true
  })

  // Filter generated exams
  const studentExams = generatedExams.filter(e => e.student_id === currentStudent?.id)
  const filteredExams = studentExams.filter(exam => {
    if (examFilter === 'all') return true
    return exam.status === examFilter
  })

  const setLoading = useUIStore(state => state.setLoading)

  return (
    <ToastProvider>
      <div className="min-h-screen bg-[#F2F2F7] text-slate-900 font-sans selection:bg-blue-100 flex justify-center overflow-hidden">
        <div className="w-full max-w-md bg-[#F2F2F7] h-screen shadow-2xl relative overflow-hidden flex flex-col">
          
          {/* Global Header */}
          <header className="px-5 pt-12 pb-3 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-xl z-30 border-b border-gray-100/50">
            <button 
              onClick={() => setShowStudentSwitcher(true)}
              className="flex items-center gap-2.5 group active:opacity-60 transition-opacity"
            >
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-sm ring-4 ring-blue-50">
                {currentStudent?.name?.charAt(0) || '学'}
              </div>
              <div className="text-left">
                <h2 className="text-[15px] font-bold tracking-tight text-gray-900 flex items-center gap-1">
                  {currentStudent?.name || '请选择学生'}
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                </h2>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none mt-0.5">{currentStudent?.class || '暂无班级'}</p>
              </div>
            </button>

            <div className="flex items-center gap-1.5">
              <button className="p-2.5 rounded-full text-gray-400 hover:bg-gray-50 active:bg-gray-100 transition-all">
                <QrCode size={20} strokeWidth={2.5} />
              </button>
              <div className="relative">
                <button className="p-2.5 rounded-full text-gray-400 hover:bg-gray-50 active:bg-gray-100">
                  <Bell size={20} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto no-scrollbar pb-20">
            <AnimatePresence mode="wait">
              {/* Processing Page */}
              {currentPage === 'processing' && (
                <motion.div
                  key="processing-page"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="w-full"
                >
                  {/* Scan Hero Section */}
                  <section className="p-5">
                    <motion.button 
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setShowActionSheet(true)}
                      className="w-full relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-white shadow-xl shadow-blue-200 disabled:opacity-60"
                      disabled={uploading}
                    >
                      <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
                      <div className="relative z-10 flex flex-col items-center">
                        <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-3xl flex items-center justify-center mb-4 border border-white/30 shadow-inner">
                          <Camera size={32} strokeWidth={2.5} />
                        </div>
                        <h1 className="text-xl font-black tracking-tight mb-1">拍照上传错题</h1>
                        <p className="text-white/60 text-[12px] font-medium tracking-wide">Qwen-VL 视觉大模型赋能</p>
                        <div className="mt-6 flex items-center gap-1.5 bg-white/15 px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase">
                          <Sparkles size={12} fill="white" className="shrink-0" />
                          <span>AI 智能识别已就绪</span>
                        </div>
                      </div>
                    </motion.button>
                  </section>

                  {/* Filter Tabs */}
                  <section className="px-5">
                    <div className="flex bg-white p-1 rounded-2xl shadow-sm">
                      {['all', 'processing', 'done', 'failed'].map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setProcessingFilter(tab)}
                          className={`flex-1 py-1.5 rounded-xl text-[12px] font-bold transition-all ${
                            processingFilter === tab ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'
                          }`}
                        >
                          {tab === 'all' && '全部'}
                          {tab === 'processing' && '处理中'}
                          {tab === 'done' && '已完成'}
                          {tab === 'failed' && '失败'}
                        </button>
                      ))}
                    </div>
                  </section>

                  {/* Task List */}
                  <section className="mt-5 px-5 space-y-3 pb-4">
                    {filteredTasks.map((task) => (
                      <div key={task.id} className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-white">
                        <img 
                          src={task.image_url} 
                          className="w-14 h-14 object-cover rounded-xl shrink-0 cursor-pointer" 
                          alt=""
                          onClick={() => setPreviewImage(task.image_url)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="text-[13px] font-bold text-gray-900 truncate pr-4">{task.original_name || '未命名作业'}</h4>
                            <span className="text-[10px] text-gray-400 font-bold">{dayjs(task.created_at).format('HH:mm')}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {task.status === 'done' && (
                              <span className="text-[11px] text-green-600 font-bold flex items-center gap-1">
                                <CheckCircle2 size={12} strokeWidth={3} /> 已完成
                              </span>
                            )}
                            {task.status === 'processing' && (
                              <span className="text-[11px] text-blue-500 font-bold flex items-center gap-1">
                                <Loader2 size={12} strokeWidth={3} className="animate-spin" /> 处理中
                              </span>
                            )}
                            {task.status === 'failed' && (
                              <span className="text-[11px] text-red-500 font-bold flex items-center gap-1">
                                <XCircle size={12} strokeWidth={3} /> 失败
                              </span>
                            )}
                            <span className="text-[11px] text-gray-400 font-bold">• {task.result?.questionCount || 0}题</span>
                          </div>
                        </div>
                        <ChevronRight size={18} className="text-gray-200" />
                      </div>
                    ))}
                    {filteredTasks.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-24 opacity-20">
                        <FileText size={48} strokeWidth={1} />
                        <p className="mt-4 text-[13px] font-medium">暂无任务</p>
                      </div>
                    )}
                  </section>
                </motion.div>
              )}

              {/* Confirm Page */}
              {currentPage === 'pending' && (
                <motion.div
                  key="confirm-page"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="w-full"
                >
                  {/* Segmented Filters */}
                  <section className="px-5 pt-4 mb-5 overflow-x-auto no-scrollbar">
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

                  {/* Question List */}
                  <section className="px-5 space-y-4 pb-4">
                    {filteredQuestions.map((q, idx) => {
                      const isSelected = selectedConfirmIds.includes(q.id)
                      return (
                        <motion.div 
                          key={q.id}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`bg-white rounded-[1.5rem] p-4 shadow-sm border-2 transition-all cursor-pointer relative ${
                            isSelected ? 'border-blue-500 shadow-blue-50' : 'border-transparent'
                          }`}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedConfirmIds(selectedConfirmIds.filter(id => id !== q.id))
                            } else {
                              setSelectedConfirmIds([...selectedConfirmIds, q.id])
                            }
                          }}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-bold text-gray-300 italic">#{idx + 1}</span>
                              <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold tracking-tight uppercase ${
                                q.status === 'wrong' ? 'bg-red-50 text-red-500 border border-red-100' : 'bg-green-50 text-green-500 border border-green-100'
                              }`}>
                                {q.status === 'wrong' ? '疑似错题' : '识别正确'}
                              </span>
                              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{q.question_type || '解答题'}</span>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-all ${
                              isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-100'
                            }`}>
                              {isSelected && <CheckCircle2 size={12} className="text-white" strokeWidth={4} />}
                            </div>
                          </div>

                          <div className="text-[14px] leading-snug text-gray-700 mb-4 px-1">
                            {q.content}
                          </div>

                          <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                console.log('查看原图 - question:', q);
                                setShowOriginalPaper(q);
                              }}
                              className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              <BookOpen size={13} strokeWidth={2.5} /> 查看原图
                            </button>
                            <div className="flex items-center gap-4">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingQuestion(q);
                                  setIsEditing(true);
                                }}
                                className="text-[11px] font-bold text-gray-400 hover:text-blue-500 active:opacity-60"
                              >
                                编辑
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowDeleteConfirm(q.id);
                                }}
                                className="text-[11px] font-bold text-gray-400 hover:text-red-500 active:opacity-60"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                    {filteredQuestions.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-24 opacity-20">
                        <FileText size={48} strokeWidth={1} />
                        <p className="mt-4 text-[13px] font-medium">暂无待确认的题目</p>
                      </div>
                    )}
                  </section>
                </motion.div>
              )}

              {/* WrongBook Page */}
              {currentPage === 'wrongbook' && (
                <motion.div
                  key="bank-page"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="w-full pb-32"
                >
                  {/* Primary State Tabs */}
                  <div className="flex gap-2 px-5 pt-4 overflow-x-auto no-scrollbar">
                    {[
                      { id: 'all', label: '全部', count: wrongQuestions.filter(wq => wq.status === 'pending' || wq.status === 'mastered').length },
                      { id: 'pending', label: '未掌握', count: wrongQuestions.filter(wq => wq.status === 'pending').length },
                      { id: 'mastered', label: '已掌握', count: wrongQuestions.filter(wq => wq.status === 'mastered').length }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setBankFilter(tab.id)}
                        className={`px-5 py-2.5 rounded-full text-[13px] font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
                          bankFilter === tab.id 
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-white text-gray-400 border border-gray-100'
                        }`}
                      >
                        {tab.label}
                        <span className={`text-[11px] font-medium ${
                          bankFilter === tab.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Sub-Filters - Dropdown Style */}
                  <div className="px-5 mt-4 flex gap-2 overflow-x-auto no-scrollbar">
                    {[
                      { label: '科目', value: selectedSubject, options: ['all', '数学', '语文', '物理', '化学', '生物'], setter: setSelectedSubject },
                      { id: 'time', label: '时间', value: selectedTimeRange, options: ['all', 'today', 'week', 'month', 'quarter'], setter: setSelectedTimeRange },
                      { id: 'errors', label: '次数', value: selectedErrorCount, options: ['all', '1', '2-3', '4-5', '5+'], setter: setSelectedErrorCount },
                    ].map((filter, i) => (
                      <div key={i} className="relative shrink-0">
                        <select
                          value={filter.value}
                          onChange={(e) => filter.setter(e.target.value)}
                          className="appearance-none bg-white border border-gray-100 rounded-full pl-3 pr-7 py-1.5 text-[11px] font-bold text-gray-500 shadow-sm focus:outline-none focus:border-blue-200 transition-all cursor-pointer"
                        >
                          {filter.options.map(opt => (
                            <option key={opt} value={opt}>{filter.label}: {opt === 'all' ? '全部' : opt}</option>
                          ))}
                        </select>
                        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                    ))}
                  </div>

                  {/* Question List */}
                  <div className="px-5 mt-5 space-y-4 pb-4">
                    {filteredWrongQuestions.map((wq) => {
                      const question = wq.question || wq
                      const isSelected = selectedQuestions.some(sq => sq.id === wq.id)
                      return (
                        <div 
                          key={wq.id}
                          onClick={() => {
                            const exists = selectedQuestions.find(sq => sq.id === wq.id)
                            if (exists) {
                              setSelectedQuestions(selectedQuestions.filter(sq => sq.id !== wq.id))
                            } else {
                              setSelectedQuestions([...selectedQuestions, wq])
                            }
                          }}
                          className={`bg-white rounded-2xl p-5 shadow-sm border-2 transition-all relative ${
                            isSelected ? 'border-blue-500 shadow-blue-50' : 'border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-all ${
                                 isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-200'
                              }`}>
                                {isSelected && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
                              </div>
                              <span className="text-[12px] font-bold text-gray-400">{question.subject || '数学'} · {question.category || '其他'}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-[11px] text-gray-300 font-medium">{dayjs(wq.added_at || wq.created_at).format('YYYY-MM-DD')}</span>
                              <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-tight ${
                                wq.status === 'pending' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'
                              }`}>
                                {wq.status === 'pending' ? '未掌握' : '已掌握'}
                              </span>
                            </div>
                          </div>
                          <div className="text-[14px] leading-relaxed text-gray-700 mb-4 px-1">
                            {question.content}
                          </div>
                          <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400">
                              <XCircle size={13} strokeWidth={2.5} className="text-red-200" /> 
                              错误次数: <span className="text-red-400 underline decoration-red-100 underline-offset-2">{wq.error_count || 1}次</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingQuestion(question);
                                  setIsEditing(true);
                                }}
                                className="text-[11px] font-bold text-gray-400 hover:text-blue-500"
                              >
                                编辑
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowDeleteConfirm(wq.id);
                                }}
                                className="text-[11px] font-bold text-gray-400 hover:text-red-500"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {filteredWrongQuestions.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-24 opacity-20">
                        <FileText size={48} strokeWidth={1} />
                        <p className="mt-4 text-[13px] font-medium">错题本为空</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Exam Page */}
              {currentPage === 'exam' && (
                <motion.div
                  key="exam-page"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="w-full pb-32"
                >
                  {/* Filter Tabs */}
                  <div className="flex gap-2 px-5 pt-4 overflow-x-auto no-scrollbar">
                    {[
                      { id: 'all', label: '全部', count: studentExams.length },
                      { id: 'ungraded', label: '未批改', count: studentExams.filter(e => e.status === 'ungraded').length },
                      { id: 'graded', label: '已批改', count: studentExams.filter(e => e.status === 'graded').length }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setExamFilter(tab.id)}
                        className={`px-5 py-2.5 rounded-full text-[13px] font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                          examFilter === tab.id 
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                          : 'bg-white text-gray-400 border border-gray-100'
                        }`}
                      >
                        {tab.label}
                        <span className={`text-[11px] font-medium ${
                          examFilter === tab.id ? 'text-white/80' : 'text-gray-300'
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Exam List */}
                  <div className="px-5 mt-6 space-y-4 pb-4">
                    {filteredExams.map((paper) => (
                      <div 
                        key={paper.id}
                        className={`bg-white rounded-[1.5rem] p-5 shadow-sm border-2 transition-all relative ${
                          selectedPaperId === paper.id ? 'border-blue-500 shadow-lg shadow-blue-100/50' : 'border-transparent'
                        }`}
                      >
                        {/* Content */}
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0 pr-8">
                            <h4 className="text-[15px] font-black text-gray-900 truncate tracking-tight mb-2">
                              {paper.name}
                            </h4>
                            <div className="flex items-center gap-x-3 gap-y-1 text-gray-400 mb-3">
                              <div className="flex items-center gap-1">
                                <Search size={12} className="opacity-50" />
                                <span className="text-[11px] font-bold">{dayjs(paper.created_at).format('YYYY-MM-DD HH:mm')}</span>
                              </div>
                              <span className="text-[11px] font-bold whitespace-nowrap">题目数: {paper.question_ids?.length || 0}题</span>
                            </div>
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-tight ${
                              paper.status === 'ungraded' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'
                            }`}>
                              {paper.status === 'ungraded' ? '未批改' : '已批改'}
                            </span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setReprintExam(paper);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-blue-100 bg-blue-50/50 text-blue-600 hover:bg-blue-50 transition-colors active:scale-95 shrink-0"
                          >
                            <Printer size={12} />
                            <span className="text-[11px] font-black">重打印</span>
                          </button>
                        </div>

                        {/* Selection Indicator */}
                        <div className="absolute top-6 right-6">
                           <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                              selectedPaperId === paper.id ? 'bg-blue-600 border-blue-600' : 'border-gray-100'
                           }`}>
                             {selectedPaperId === paper.id && <div className="w-2 h-2 bg-white rounded-full" />}
                           </div>
                        </div>
                      </div>
                    ))}

                    {/* Empty State */}
                    {filteredExams.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-24 opacity-20">
                        <FileText size={48} strokeWidth={1} />
                        <p className="mt-4 text-[13px] font-medium">暂无此类试卷</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          {/* Batch Action Toolbar */}
          <AnimatePresence>
            {selectedConfirmIds.length > 0 && currentPage === 'pending' && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                className="fixed bottom-20 left-0 right-0 max-w-md mx-auto px-5 z-[80]"
              >
                <div className="bg-slate-900/95 backdrop-blur-3xl rounded-[2rem] p-5 flex items-center justify-between shadow-2xl border border-white/10 ring-1 ring-white/10">
                  <div className="pl-1">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">已选题目</p>
                    <p className="text-[15px] font-bold text-white">共 {selectedConfirmIds.length} 道</p>
                  </div>
                  <button 
                    onClick={handleAddToWrongBook}
                    className="px-6 py-3 rounded-2xl text-[12px] font-black text-white bg-blue-600 hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/50"
                  >
                    批量加入错题本
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {selectedQuestions.length > 0 && currentPage === 'wrongbook' && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                className="fixed bottom-20 left-0 right-0 max-w-md mx-auto px-5 z-[80]"
              >
                <div className="bg-slate-900/95 backdrop-blur-3xl rounded-[2rem] p-5 flex items-center justify-between shadow-2xl border border-white/10 ring-1 ring-white/10">
                  <div className="pl-1">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">已选题目</p>
                    <p className="text-[15px] font-bold text-white">共 {selectedQuestions.length} 道</p>
                  </div>
                  <button 
                    onClick={() => setShowPrintPreview(true)}
                    className="px-6 py-3 rounded-2xl text-[12px] font-black text-white bg-blue-600 hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/50"
                  >
                    打印 ({selectedQuestions.length})
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* iOS Tab Bar */}
          <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/80 backdrop-blur-2xl border-t border-gray-100/50 flex justify-between px-8 pt-4 pb-8 z-[70]">
            {[
              { id: 'processing', icon: Camera, label: '处理' },
              { id: 'pending', icon: BookOpen, label: '待确认' },
              { id: 'wrongbook', icon: LayoutGrid, label: '错题本' },
              { id: 'exam', icon: FileText, label: '试卷' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setCurrentPage(tab.id); setSelectedConfirmIds([]); clearSelection() }}
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
          </nav>

          {/* Student Sheet */}
          <StudentSwitcher
            visible={showStudentSwitcher}
            onClose={() => setShowStudentSwitcher(false)}
          />

          {/* ActionSheet */}
          <ActionSheet
            visible={showActionSheet}
            onClose={() => setShowActionSheet(false)}
            actions={[
              { key: 'camera', text: '拍照上传', description: '拍摄试卷或作业', onClick: () => {
                if (fileInputRef.current) {
                  fileInputRef.current.setAttribute('capture', 'environment')
                  fileInputRef.current.click()
                }
              }},
              { key: 'album', text: '从相册选择', description: '选择已有照片', onClick: () => {
                if (fileInputRef.current) {
                  fileInputRef.current.removeAttribute('capture')
                  fileInputRef.current.click()
                }
              }}
            ]}
          />

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          {/* Image Preview */}
          <AnimatePresence>
            {previewImage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPreviewImage(null)}
                className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] flex items-center justify-center"
              >
                <img src={previewImage} className="max-w-full max-h-full object-contain" alt="预览" />
                <button className="absolute top-12 right-6 p-2 bg-white/10 rounded-full text-white">
                  <X size={24} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dialog */}
          <Dialog
            visible={dialogState.visible}
            title={dialogState.title}
            content={dialogState.content}
            confirmText={dialogState.confirmText}
            cancelText={dialogState.cancelText}
            onConfirm={dialogState.onConfirm}
            onCancel={dialogState.onCancel}
          />

          {/* Scan QR */}
          {showScanQR && (
            <ScanQR
              onClose={() => setShowScanQR(false)}
              onScanSuccess={handleScanSuccess}
            />
          )}

          {/* Grading */}
          {showGrading && (
            <Grading
              paperId={gradingParams?.paperId}
              studentId={gradingParams?.studentId}
              onClose={() => { setShowGrading(false); setGradingParams(null) }}
              onComplete={(results) => {
                showToast({ icon: 'success', content: '批改完成' })
                setShowGrading(false)
                setGradingParams(null)
              }}
            />
          )}

          {/* Print Preview Overlay - Reference Design */}
          <AnimatePresence>
            {showPrintPreview && (
              <motion.div
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="fixed inset-0 bg-[#F2F2F7] z-[200] flex flex-col max-w-md mx-auto h-screen overflow-hidden"
              >
                <div className="flex-1 overflow-y-auto bg-white px-6 pt-10 pb-32 no-scrollbar">
                  <button 
                    onClick={() => setShowPrintPreview(false)}
                    className="absolute top-10 left-4 w-8 h-8 bg-black/5 rounded-full flex items-center justify-center text-slate-900 active:scale-90 transition-transform z-10"
                  >
                    <ChevronRight size={18} className="rotate-180" />
                  </button>

                  {/* Compact Academic Header with QR */}
                  <div className="relative flex items-center justify-between mb-10 pt-2 px-2">
                    <div className="flex-1">
                      <h2 className="text-[18px] font-serif font-black text-gray-900 tracking-tight leading-tight">
                        {currentStudent?.name || '学生'} <br/> 错题强化训练卷
                      </h2>
                      <div className="flex items-center gap-3 mt-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-blue-500" />
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] italic">SMART LEARNING SYSTEM</p>
                        </div>
                        <div className="w-px h-2.5 bg-gray-200" />
                        <span className="text-[11px] font-black text-gray-400 tracking-tight">
                          {dayjs().format('YYYY-M-D')}
                        </span>
                      </div>
                    </div>
                    <div className="w-20 h-20 bg-gray-100 rounded-xl flex flex-col items-center justify-center p-2 shrink-0">
                      <QRCodeSVG 
                        value={`https://scan.example.com/paper/${currentStudent?.id || 'student'}`}
                        size={48}
                        className="rounded-sm"
                      />
                      <span className="text-[7px] font-black text-gray-400 uppercase tracking-tighter mt-0.5">批改扫码</span>
                    </div>
                  </div>

                  {/* Paper Content Area */}
                  <div className="space-y-6">
                    {(() => {
                      const displayQuestions = selectedQuestions.length > 0
                        ? selectedQuestions.map(wq => wq.question || wq)
                        : pendingQuestions.slice(0, 1).map(q => q.question || q)
                      
                      return displayQuestions.map((q, i) => {
                        const questionType = q.question_type || q.type || '选择题'
                        const subject = q.subject || '数学'
                        const content = q.content || '无内容'
                        const options = q.options || []
                        
                        return (
                          <div key={q.id || i} className="relative group">
                            <div className="flex items-start gap-4 mb-4">
                              <div className="w-6 h-6 flex items-center justify-center rounded-lg bg-slate-900 text-white text-[11px] font-black tracking-tighter shrink-0 mt-1">
                                {i + 1}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-widest underline decoration-gray-200 underline-offset-1">
                                    {questionType}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-[9px] font-black text-blue-500 uppercase tracking-widest">
                                    {subject}
                                  </span>
                                </div>
                                <div className="text-[14px] leading-relaxed text-slate-800 font-medium font-serif">
                                  {content}
                                </div>
                              </div>
                            </div>

                            {/* Contextual Answer Area - Paper Efficient */}
                            {(questionType === '解答题' || questionType === '简答题' || questionType === 'answer') && (
                              <div className="ml-10 h-32 border border-gray-100 rounded-xl bg-gray-50/10 flex flex-col items-center justify-start relative overflow-hidden group-hover:bg-blue-50/5 transition-colors">
                                 <div className="absolute top-3 left-4 text-[10px] font-black text-gray-300 italic">Solution:</div>
                                 <div className="w-full h-full border-t border-gray-50 mt-10 opacity-30" />
                                 <div className="w-full h-full border-t border-gray-50 opacity-30" />
                              </div>
                            )}

                            {questionType === '填空题' || questionType === 'fill' && (
                              <div className="ml-10 h-10" />
                            )}

                            {questionType === '选择题' || questionType === 'choice' && (
                              <div className="ml-10 flex gap-10 mt-2">
                                 {['A','B','C','D'].map(opt => (
                                   <div key={opt} className="flex items-center gap-2">
                                     <div className="w-4 h-4 rounded-full border border-gray-200" />
                                     <span className="text-[12px] font-bold text-gray-300">{opt}</span>
                                   </div>
                                 ))}
                              </div>
                            )}
                          </div>
                        )
                      })
                    })()}
                  </div>

                  <div className="mt-20 pt-8 border-t border-gray-100 flex items-center justify-between pb-12">
                     <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-[0.2em]">Personalized Exam Pack</p>
                     </div>
                     <p className="text-[10px] text-gray-300 font-mono tracking-tighter">PAGE 01 / 01</p>
                  </div>
                </div>

                {/* iOS Style Floating Actions */}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-3xl border-t border-gray-100 flex gap-4 z-[210]">
                  <button className="flex-1 py-4 border-2 border-gray-50 px-4 rounded-2xl text-[14px] font-black text-gray-900 active:scale-95 transition-transform bg-white/50">PDF 导出</button>
                  <button 
                    onClick={() => {
                      setShowPrintPreview(false)
                    }}
                    className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl text-[14px] font-black shadow-[0_10px_30px_rgba(37,99,235,0.3)] active:scale-95 transition-transform"
                  >
                    直接打印
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reprint Overlay */}
          <AnimatePresence>
            {reprintExam && (
              <motion.div
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="fixed inset-0 bg-[#F2F2F7] z-[200] flex flex-col max-w-md mx-auto h-screen overflow-hidden"
              >
                <div className="flex-1 overflow-y-auto bg-white px-6 pt-10 pb-32 no-scrollbar">
                  <button 
                    onClick={() => { setReprintExam(null); setReprintQuestions([]) }}
                    className="absolute top-10 left-4 w-8 h-8 bg-black/5 rounded-full flex items-center justify-center text-slate-900 active:scale-90 transition-transform z-10"
                  >
                    <ChevronRight size={18} className="rotate-180" />
                  </button>

                  {/* Academic Header with QR */}
                  <div className="relative flex items-center justify-between mb-10 pt-2 px-2">
                    <div className="flex-1">
                      <h2 className="text-[18px] font-serif font-black text-gray-900 tracking-tight leading-tight">
                        {currentStudent?.name || '学生'} <br/> {reprintExam.name}
                      </h2>
                      <div className="flex items-center gap-3 mt-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1 h-1 rounded-full bg-blue-500" />
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] italic">SMART LEARNING SYSTEM</p>
                        </div>
                        <div className="w-px h-2.5 bg-gray-200" />
                        <span className="text-[11px] font-black text-gray-400 tracking-tight">
                          {dayjs(reprintExam.created_at).format('YYYY-M-D')}
                        </span>
                      </div>
                    </div>
                    <div className="w-20 h-20 bg-gray-100 rounded-xl flex flex-col items-center justify-center p-2 shrink-0">
                      <QRCodeSVG 
                        value={`https://scan.example.com/paper/${reprintExam.id}`}
                        size={48}
                        className="rounded-sm"
                      />
                      <span className="text-[7px] font-black text-gray-400 uppercase tracking-tighter mt-0.5">批改扫码</span>
                    </div>
                  </div>

                  {/* Questions */}
                  {reprintQuestions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 opacity-30">
                      <FileText size={48} strokeWidth={1} />
                      <p className="mt-4 text-[13px] font-medium">题目加载中...</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {reprintQuestions.map((q, i) => {
                        const questionType = q.question_type || q.type || '选择题'
                        const subject = q.subject || '数学'
                        const content = q.content || '无内容'
                        
                        return (
                          <div key={q.id || i} className="relative group">
                            <div className="flex items-start gap-4 mb-4">
                              <div className="w-6 h-6 flex items-center justify-center rounded-lg bg-slate-900 text-white text-[11px] font-black tracking-tighter shrink-0 mt-1">
                                {i + 1}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-widest underline decoration-gray-200 underline-offset-1">
                                    {questionType}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-[9px] font-black text-blue-500 uppercase tracking-widest">
                                    {subject}
                                  </span>
                                </div>
                                <div className="text-[14px] leading-relaxed text-slate-800 font-medium font-serif">
                                  {content}
                                </div>
                                {q.options && q.options.length > 0 && (
                                  <div className="ml-10 flex gap-10 mt-2">
                                    {q.options.map((opt, idx) => (
                                      <div key={idx} className="flex items-center gap-2">
                                        <div className="w-4 h-4 rounded-full border border-gray-200" />
                                        <span className="text-[12px] font-bold text-gray-300">{String.fromCharCode(65 + idx)} {opt}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {(questionType === '解答题' || questionType === '简答题' || questionType === 'answer') && (
                              <div className="ml-10 h-32 border border-gray-100 rounded-xl bg-gray-50/10 flex flex-col items-center justify-start relative overflow-hidden group-hover:bg-blue-50/5 transition-colors">
                                 <div className="absolute top-3 left-4 text-[10px] font-black text-gray-300 italic">Solution:</div>
                                 <div className="w-full h-full border-t border-gray-50 mt-10 opacity-30" />
                                 <div className="w-full h-full border-t border-gray-50 opacity-30" />
                              </div>
                            )}

                            {(questionType === '填空题' || questionType === 'fill') && (
                              <div className="ml-10 h-10" />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="mt-20 pt-8 border-t border-gray-100 flex items-center justify-between pb-12">
                     <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-[0.2em]">Personalized Exam Pack</p>
                     </div>
                     <p className="text-[10px] text-gray-300 font-mono tracking-tighter">PAGE 01 / 01</p>
                  </div>
                </div>

                {/* iOS Style Floating Actions */}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-white/80 backdrop-blur-3xl border-t border-gray-100 flex gap-4 z-[210]">
                  <button className="flex-1 py-4 border-2 border-gray-50 px-4 rounded-2xl text-[14px] font-black text-gray-900 active:scale-95 transition-transform bg-white/50">PDF 导出</button>
                  <button 
                    onClick={() => {
                      setReprintExam(null)
                      setReprintQuestions([])
                    }}
                    className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl text-[14px] font-black shadow-[0_10px_30px_rgba(37,99,235,0.3)] active:scale-95 transition-transform"
                  >
                    直接打印
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Delete Confirm Dialog */}
          <AnimatePresence>
            {showDeleteConfirm && (
              <div className="fixed inset-0 z-[1000] flex items-center justify-center px-8">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowDeleteConfirm(null)}
                  className="absolute inset-0 bg-black/60 backdrop-blur-md"
                />
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className="relative w-full max-w-[280px] bg-white/90 backdrop-blur-xl rounded-[2rem] p-6 shadow-2xl text-center"
                >
                  <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Trash2 size={28} />
                  </div>
                  <h3 className="text-[17px] font-black text-gray-900 mb-2">确认删除该题目？</h3>
                  <p className="text-[13px] text-gray-500 mb-6 leading-relaxed">
                    删除后将无法恢复，建议先确认为正确或自行修改。
                  </p>
                  <div className="space-y-2">
                    <button 
                      onClick={() => {
                        setShowDeleteConfirm(null)
                      }}
                      className="w-full py-3.5 bg-red-500 text-white font-black rounded-2xl shadow-lg shadow-red-100 active:scale-95 transition-transform"
                    >
                      确定删除
                    </button>
                    <button 
                      onClick={() => setShowDeleteConfirm(null)}
                      className="w-full py-3.5 text-gray-400 font-bold active:scale-95 transition-transform"
                    >
                      取消
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Original Paper Viewer - Question Image Only */}
          <AnimatePresence>
            {showOriginalPaper && (() => {
              const q = showOriginalPaper
              const questionImage = q?.image_url || ''
              const task = tasks.find(t => t.id === q?.task_id)
              const fullPaperImage = task?.image_url || task?.result?.image_url || ''
              const displayImage = questionImage || fullPaperImage

              if (!displayImage) return null

              return (
                <div className="fixed inset-0 z-[1000] bg-black overflow-hidden" onClick={() => { setShowOriginalPaper(null); setShowFullPaper(false) }}>
                  <motion.div 
                    initial={{ opacity: 0, scale: 1.05 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05 }}
                    className="relative h-full w-full flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="absolute top-0 left-0 right-0 z-30 px-4 pt-12 pb-4 flex items-center justify-between">
                      <div className="text-white">
                        <h3 className="text-[15px] font-bold">{questionImage ? '题目截图' : '原试卷'}</h3>
                        <p className="text-white/50 text-[10px]">{q?.content?.slice(0, 30) || ''}...</p>
                      </div>
                      <button 
                        onClick={() => { setShowOriginalPaper(null); setShowFullPaper(false) }}
                        className="w-9 h-9 bg-white/20 backdrop-blur-xl rounded-full flex items-center justify-center text-white active:scale-90 transition-transform"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* Image Display */}
                    <div className="flex-1 overflow-auto bg-[#1a1a1a] flex items-center justify-center p-4 pt-24 pb-20 no-scrollbar">
                       <div className="relative bg-white shadow-[0_20px_60px_rgba(0,0,0,0.5)] rounded-lg overflow-hidden max-w-full">
                         <img 
                           src={displayImage}
                           className="w-full h-auto object-contain max-h-[80vh]"
                           alt={questionImage ? '题目截图' : '原试卷'}
                         />
                       </div>
                    </div>
                  </motion.div>
                </div>
              )
            })()}
          </AnimatePresence>

          {/* Edit Question Modal */}
          <AnimatePresence>
            {isEditing && (
              <>
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsEditing(false)}
                  className="absolute inset-0 bg-black/60 backdrop-blur-md z-[200]"
                />
                <motion.div 
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 300, mass: 0.8 }}
                  className="absolute bottom-0 left-0 right-0 bg-[#F2F2F7] rounded-t-[2.5rem] z-[201] flex flex-col max-h-[92vh] overflow-hidden"
                >
                  {/* Visual Handle */}
                  <div className="w-10 h-1.5 bg-gray-300/30 rounded-full mx-auto mt-3 mb-2" />
                  
                  {/* Header */}
                  <div className="px-6 py-4 flex items-center justify-between bg-white border-b border-gray-100/50 rounded-t-[2.5rem]">
                    <button 
                      onClick={() => setIsEditing(false)}
                      className="text-[15px] font-medium text-gray-400 active:opacity-60 px-2"
                    >
                      取消
                    </button>
                    <h3 className="text-[17px] font-bold text-gray-900">编辑题目</h3>
                    <button 
                      onClick={() => setIsEditing(false)}
                      className="text-[15px] font-bold text-blue-600 active:opacity-60 px-2"
                    >
                      保存
                    </button>
                  </div>

                  {/* Tabs */}
                  <div className="flex bg-white px-2 border-b border-gray-50">
                    {[
                      { id: 'content', label: '题干' },
                      { id: 'answer', label: '答案' }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setEditTab(tab.id)}
                        className={`flex-1 py-4 text-[14px] font-bold relative transition-colors ${
                          editTab === tab.id ? 'text-blue-600' : 'text-gray-400'
                        }`}
                      >
                        {tab.label}
                        {editTab === tab.id && (
                          <motion.div 
                            layoutId="edit-tab-underline"
                            className="absolute bottom-0 left-0 right-0 h-[3px] bg-blue-600 rounded-full mx-auto w-12"
                          />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {editTab === 'content' && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="space-y-4"
                      >
                        <div className="bg-white rounded-3xl p-6 shadow-sm mb-4">
                          <div className="flex gap-4">
                            {/* Text Area - Larger portion */}
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-[13px] font-bold text-gray-900">题目内容</span>
                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-black uppercase tracking-tight">{getTypeLabel(editingQuestion?.question_type)}</span>
                              </div>
                              <textarea 
                                className="w-full text-[15px] text-gray-800 bg-transparent border-none focus:ring-0 resize-none leading-relaxed min-h-[120px] placeholder:text-gray-300"
                                defaultValue={editingQuestion?.content || ''}
                              />
                              <div className="flex justify-between items-center mt-2">
                                <span className="text-[10px] text-gray-300 font-bold tracking-tight uppercase">
                                  {editingQuestion?.content?.length || 0}/500
                                </span>
                                <button
                                  onClick={() => setShowCropTool(true)}
                                  className="text-[11px] text-blue-600 font-bold cursor-pointer uppercase tracking-tighter"
                                >
                                  {displayEditImage ? '更换插图' : '补充插图'}
                                </button>
                              </div>
                              {displayEditImage && (
                                <div className="mt-3 w-28 h-28 rounded-xl overflow-hidden mx-auto">
                                  <img src={displayEditImage} alt="" className="w-full h-full object-cover" />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Multiple Choice Options List */}
                          {isChoiceQuestion(editingQuestion?.question_type) && (
                            <div className="mt-8">
                              <div className="flex items-center justify-between mb-4">
                                <span className="text-[13px] font-bold text-gray-900">选项 (单选)</span>
                                <button className="text-[11px] font-bold text-blue-600 flex items-center gap-1">
                                  <Plus size={12} /> 添加选项
                                </button>
                              </div>
                              <div className="space-y-2">
                                {(() => {
                                  const opts = cleanOptionPrefix(editingQuestion?.options || [])
                                  const labels = ['A', 'B', 'C', 'D']
                                  return (opts.length > 0 ? opts : ['A', 'B', 'C', 'D']).map((opt, idx) => {
                                    const label = labels[idx]
                                    const value = typeof opt === 'string' ? opt : opt?.value || opt?.content || ''
                                    return (
                                      <div key={idx} className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-[13px] font-bold text-gray-400 border border-gray-100">
                                          {label}
                                        </div>
                                        <div className="flex-1 px-4 py-3 bg-gray-50 rounded-xl text-[14px] text-gray-800 font-medium">
                                          {value}
                                        </div>
                                        <button className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-400">
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    )
                                  })
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                    
                    {editTab === 'answer' && (
                      <motion.div 
                        key="answer-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                      >
                        <div className="bg-white rounded-2xl p-4 shadow-sm">
                          <div className="flex gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className="w-1 h-1 rounded-full bg-gray-300" />
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">学生内容</span>
                              </div>
                              <div className="px-3 py-2 bg-gray-50 rounded-xl text-[13px] text-gray-500 italic border border-gray-100/50">
                                 {editingQuestion?.student_answer || '未作答'}
                              </div>
                            </div>

                            <div className="flex-1">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                <span className="w-1 h-1 rounded-full bg-blue-500" />
                                <span className="text-[10px] font-black text-blue-600 uppercase tracking-wider">标准答案</span>
                              </div>
                              <div className="px-3 py-2 bg-blue-50/30 rounded-xl text-[13px] text-gray-900 font-bold border border-blue-100/30">
                                 {editingQuestion?.answer || '暂无答案'}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="bg-white rounded-3xl p-6 shadow-sm mb-4">
                          <h4 className="text-[14px] font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <Sparkles size={14} className="text-blue-500" />
                            题目解析 (选填)
                          </h4>
                          <textarea 
                            className="w-full text-[14px] text-gray-600 bg-transparent border-none focus:ring-0 resize-none leading-relaxed min-h-[220px] placeholder:text-gray-200"
                            placeholder="请输入详细的 AI 解析内容或手动编辑解析内容..."
                            defaultValue={editingQuestion?.analysis || ''}
                          />
                        </div>
                      </motion.div>
                    )}
                  </div>

                  {/* Footer Actions */}
                  <div className="px-6 pt-4 pb-12 bg-white/80 backdrop-blur-xl border-t border-gray-100 flex gap-3">
                    <button 
                      onClick={() => setIsEditing(false)}
                      className="flex-1 py-4 bg-gray-50 text-gray-500 font-bold rounded-2xl active:scale-95 transition-transform"
                    >
                      取消
                    </button>
                    <button 
                      onClick={() => setIsEditing(false)}
                      className="flex-[2] py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-100 active:scale-95 transition-transform"
                    >
                      保存
                    </button>
                  </div>

                  {/* Crop/Upload Menu */}
                  <AnimatePresence>
                    {showCropTool && (
                      <div className="fixed inset-0 z-[800] flex items-end">
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => setShowCropTool(false)}
                          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        />
                        <motion.div 
                          initial={{ y: '100%' }}
                          animate={{ y: 0 }}
                          exit={{ y: '100%' }}
                          className="relative w-full max-w-sm mx-auto bg-white rounded-t-[2.5rem] p-6 pb-12 shadow-2xl"
                        >
                          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-6" />
                          <h3 className="text-center text-[14px] font-black text-gray-900 mb-5">更换题目插图</h3>
                          <div className="grid grid-cols-2 gap-3 max-w-[320px] mx-auto">
                            <button className="flex flex-col items-center gap-2 p-3.5 rounded-2xl bg-blue-50/50 border border-blue-100 active:scale-95 transition-transform">
                              <div className="w-9 h-9 bg-white rounded-xl shadow-sm flex items-center justify-center text-blue-600">
                                <Maximize size={18} />
                              </div>
                              <p className="text-[12px] font-bold text-gray-900">从原卷裁剪</p>
                            </button>
                            <button className="flex flex-col items-center gap-2 p-3.5 rounded-2xl bg-gray-50/50 border border-gray-100 active:scale-95 transition-transform">
                              <div className="w-9 h-9 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-400">
                                <Camera size={18} />
                              </div>
                              <p className="text-[12px] font-bold text-gray-900">拍照上传</p>
                            </button>
                          </div>
                        </motion.div>
                      </div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Toast Container */}
          <ToastContainer toasts={toastList} />
        </div>
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </ToastProvider>
  )
}
