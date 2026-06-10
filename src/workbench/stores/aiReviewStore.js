import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getStudents, getTasksByStudent, getQuestionsByTask } from '../../services/apiService'

// AI批改结果状态
export const AI_REVIEW_STATUS = {
  PENDING: 'pending',       // 待复审
  CONFIRMED: 'confirmed',   // 已确认
  CORRECTED: 'corrected'    // 已修正
}

// 复审判定结果
export const REVIEW_RESULT = {
  CORRECT: 'correct',       // 正确
  WRONG: 'wrong',           // 错误
  UNANSWERED: 'unanswered'  // 未作答
}

export const useAIReviewStore = defineStore('aiReview', () => {
  // 学生列表
  const students = ref([])
  const currentStudent = ref(null)

  // 待复审队列（task状态为done的题目）
  const pendingTasks = ref([])
  const currentTask = ref(null)

  // 当前任务的题目列表
  const taskQuestions = ref([])
  const currentQuestionIndex = ref(0)

  // 复审状态
  const reviewStatus = ref('idle') // idle, loading, reviewing, completed

  // 图片查看器状态
  const imageScale = ref(1)
  const imagePosition = ref({ x: 0, y: 0 })
  const isDragging = ref(false)
  const dragStart = ref({ x: 0, y: 0 })

  // 当前题目
  const currentQuestion = computed(() => {
    if (taskQuestions.value.length === 0) return null
    return taskQuestions.value[currentQuestionIndex.value] || null
  })

  // 统计
  const stats = computed(() => {
    const total = taskQuestions.value.length
    const confirmed = taskQuestions.value.filter(q => q._reviewStatus === AI_REVIEW_STATUS.CONFIRMED).length
    const corrected = taskQuestions.value.filter(q => q._reviewStatus === AI_REVIEW_STATUS.CORRECTED).length
    const pending = total - confirmed - corrected

    return { total, confirmed, corrected, pending }
  })

  // 进度
  const progress = computed(() => {
    if (stats.value.total === 0) return 0
    return Math.round(((stats.value.confirmed + stats.value.corrected) / stats.value.total) * 100)
  })

  // 加载学生列表
  const loadStudents = async () => {
    try {
      const result = await getStudents(false)
      const list = result.data || result || []
      students.value = Array.isArray(list) ? list : []
      
      if (students.value.length > 0 && !currentStudent.value) {
        setCurrentStudent(students.value[0])
      }
    } catch (e) {
      console.error('加载学生列表失败:', e)
      students.value = []
    }
  }

  // 设置当前学生
  const setCurrentStudent = (student) => {
    currentStudent.value = student
    if (student) {
      loadPendingTasks(student.id)
    }
  }

  // 加载待复审任务
  const loadPendingTasks = async (studentId) => {
    reviewStatus.value = 'loading'
    try {
      const tasks = await getTasksByStudent(studentId, false)
      // 只显示已完成的任务（AI已批改）
      pendingTasks.value = (tasks || []).filter(t => t.status === 'done')
    } catch (e) {
      console.error('加载任务失败:', e)
      pendingTasks.value = []
    } finally {
      reviewStatus.value = 'idle'
    }
  }

  // 选择任务开始复审
  const selectTask = async (task) => {
    currentTask.value = task
    reviewStatus.value = 'loading'
    
    try {
      const questions = await getQuestionsByTask(task.id, false)
      // 为每道题添加复审状态标记
      taskQuestions.value = (questions || []).map(q => ({
        ...q,
        _reviewStatus: q._reviewStatus || AI_REVIEW_STATUS.PENDING,
        _originalContent: q.content,
        _originalAnswer: q.answer,
        _originalAnalysis: q.analysis
      }))
      currentQuestionIndex.value = 0
      reviewStatus.value = 'reviewing'
    } catch (e) {
      console.error('加载题目失败:', e)
      taskQuestions.value = []
      reviewStatus.value = 'idle'
    }
  }

  // 切换到上一题
  const prevQuestion = () => {
    if (currentQuestionIndex.value > 0) {
      currentQuestionIndex.value--
      resetImageViewer()
    }
  }

  // 切换到下一题
  const nextQuestion = () => {
    if (currentQuestionIndex.value < taskQuestions.value.length - 1) {
      currentQuestionIndex.value++
      resetImageViewer()
    }
  }

  // 跳转到指定题目
  const goToQuestion = (index) => {
    if (index >= 0 && index < taskQuestions.value.length) {
      currentQuestionIndex.value = index
      resetImageViewer()
    }
  }

  // 复审判定
  const confirmReview = (questionId, result) => {
    const q = taskQuestions.value.find(q => q.id === questionId)
    if (q) {
      q._reviewStatus = result === 'correct' ? AI_REVIEW_STATUS.CONFIRMED : AI_REVIEW_STATUS.CORRECTED
      q._reviewResult = result
    }
  }

  // 修改题目内容
  const updateQuestionContent = (questionId, updates) => {
    const q = taskQuestions.value.find(q => q.id === questionId)
    if (q) {
      Object.assign(q, updates)
      q._reviewStatus = AI_REVIEW_STATUS.CORRECTED
    }
  }

  // 图片缩放
  const zoomImage = (delta) => {
    imageScale.value = Math.max(0.5, Math.min(3, imageScale.value + delta))
  }

  // 重置图片查看器
  const resetImageViewer = () => {
    imageScale.value = 1
    imagePosition.value = { x: 0, y: 0 }
    isDragging.value = false
  }

  // 图片拖拽
  const startDrag = (e) => {
    isDragging.value = true
    dragStart.value = { x: e.clientX - imagePosition.value.x, y: e.clientY - imagePosition.value.y }
  }

  const onDrag = (e) => {
    if (isDragging.value) {
      imagePosition.value = {
        x: e.clientX - dragStart.value.x,
        y: e.clientY - dragStart.value.y
      }
    }
  }

  const endDrag = () => {
    isDragging.value = false
  }

  // 返回列表
  const backToTaskList = () => {
    currentTask.value = null
    taskQuestions.value = []
    currentQuestionIndex.value = 0
    reviewStatus.value = 'idle'
    resetImageViewer()
  }

  return {
    students,
    currentStudent,
    pendingTasks,
    currentTask,
    taskQuestions,
    currentQuestionIndex,
    currentQuestion,
    reviewStatus,
    stats,
    progress,
    imageScale,
    imagePosition,
    isDragging,
    loadStudents,
    setCurrentStudent,
    loadPendingTasks,
    selectTask,
    prevQuestion,
    nextQuestion,
    goToQuestion,
    confirmReview,
    updateQuestionContent,
    zoomImage,
    resetImageViewer,
    startDrag,
    onDrag,
    endDrag,
    backToTaskList
  }
})
