import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { getStudents, getWrongQuestionsByStudent, getQuestionsByTask, getTasksByStudent, updateWrongQuestionStatus, updateTaskStatus, getLatestJudgements, clearStudentCaches, updateQuestionReviewStatus } from '../../services/apiService'
import { useLifecycleStore, LIFECYCLE_STATUS } from './lifecycleStore'

export const useReviewStore = defineStore('review', () => {
  const lifecycleStore = useLifecycleStore()
  
  // 学生列表
  const students = ref([])
  const currentStudent = ref(null)
  
  // 错题列表（从 wrong_questions 表）
  const wrongQuestions = ref([])
  
  // 当前试卷的所有题目（从 questions 表）
  const allQuestions = ref([])
  const currentTaskId = ref(null)

  // 当前选中的试卷（task 对象，含 image_url）
  const currentTask = ref(null)

  // AI 置信度阈值（低于此值标记为"待确认"）
  const confidenceThreshold = ref(0.5)

  // 当前学生的已完成任务列表
  const studentTasks = ref([])
  
  // 当前审核的题目索引
  const currentReviewIndex = ref(0)
  
  // 审核状态
  const reviewStatus = ref('idle') // idle, reviewing, completed
  
  // 今日统计数据
  const todayStats = ref({
    pendingReview: 0,       // 今日待审核错题数量
    pendingStudents: 0,     // 今日待处理学生数量
    newWrongQuestions: 0,   // 今日新增错题数量
    pendingPrintExams: 0    // 已生成待打印重练卷数量
  })

  // 所有题目（用于显示完整题号导航 1~N）
  const studentAllQuestions = computed(() => {
    return allQuestions.value
  })

  // 当前审核的题目（优先显示有 review_status 的，即需要人工复核的）
  const currentReviewQuestion = computed(() => {
    if (allQuestions.value.length === 0) return null
    return allQuestions.value[currentReviewIndex.value] || null
  })

  // 题目确认状态：已有人工审核记录 OR AI confidence >= 阈值
  const questionConfirmationMap = computed(() => {
    const map = {}
    for (const q of allQuestions.value) {
      map[q.id] = !!(q.review_status || (q.confidence != null && q.confidence >= confidenceThreshold.value))
    }
    return map
  })

  // 复审进度
  const reviewProgress = computed(() => {
    const total = allQuestions.value.length
    const confirmed = Object.values(questionConfirmationMap.value).filter(Boolean).length
    return { total, confirmed, unconfirmed: total - confirmed, percent: total ? Math.round(confirmed / total * 100) : 0 }
  })

  // 获取学生待审核题目数
  const getStudentPendingCount = (studentId) => {
    return wrongQuestions.value.filter(wq => 
      wq.student_id === studentId && wq.lifecycle_status !== LIFECYCLE_STATUS.MASTERED
    ).length
  }

  // 获取学生今日新增错题数
  const getStudentTodayNewCount = (studentId) => {
    const today = dayjs().format('YYYY-MM-DD')
    return wrongQuestions.value.filter(wq => {
      if (wq.student_id !== studentId) return false
      const addedDate = dayjs(wq.added_at).format('YYYY-MM-DD')
      return addedDate === today
    }).length
  }

  // 获取今日统计数据
  const calculateTodayStats = () => {
    const today = dayjs().format('YYYY-MM-DD')
    
    // 今日待审核错题数量（非mastered状态）
    const pendingReview = wrongQuestions.value.filter(wq => 
      wq.lifecycle_status !== LIFECYCLE_STATUS.MASTERED
    ).length
    
    // 今日待处理学生数量（有待审核错题的学生数）
    const studentIds = new Set()
    wrongQuestions.value.forEach(wq => {
      if (wq.lifecycle_status !== LIFECYCLE_STATUS.MASTERED) {
        studentIds.add(wq.student_id)
      }
    })
    const pendingStudents = studentIds.size
    
    // 今日新增错题数量（lifecycle_status为new的错题）
    const newWrongQuestions = wrongQuestions.value.filter(wq => {
      const addedDate = dayjs(wq.added_at).format('YYYY-MM-DD')
      return addedDate === today && wq.lifecycle_status === LIFECYCLE_STATUS.NEW
    }).length
    
    // 已生成待打印重练卷数量（模拟数据）
    const pendingPrintExams = 3
    
    todayStats.value = {
      pendingReview,
      pendingStudents,
      newWrongQuestions,
      pendingPrintExams
    }
  }

  // 加载学生列表
  const loadStudents = async () => {
    try {
      const result = await getStudents(false)
      const list = result.data || result || []
      students.value = Array.isArray(list) ? list : []
    } catch (e) {
      console.error('加载学生列表失败:', e)
      students.value = []
    }
  }

  // 加载试卷的所有题目
  const loadQuestions = async (taskId) => {
    if (!taskId) return
    currentTaskId.value = taskId
    try {
      const questions = await getQuestionsByTask(taskId, false)
      // Sort questions by sort_order or sequence
      allQuestions.value = (Array.isArray(questions) ? questions : []).sort((a, b) => {
        const aOrder = a.sort_order || a.sequence || 0
        const bOrder = b.sort_order || b.sequence || 0
        return aOrder - bOrder
      })
    } catch (e) {
      console.error('加载题目数据失败:', e)
      allQuestions.value = []
    }
  }

  // 加载错题数据
  const loadWrongQuestions = async (studentId) => {
    if (!studentId) return
    try {
      const data = await getWrongQuestionsByStudent(studentId, false)
      wrongQuestions.value = (Array.isArray(data) ? data : []).map(wq => ({
        ...wq,
        lifecycle_status: wq.lifecycle_status || LIFECYCLE_STATUS.NEW
      }))
    } catch (e) {
      console.error('加载错题数据失败:', e)
      wrongQuestions.value = []
    }
  }

  // 清理旧缓存（版本更新时使用）
  const clearOldCaches = () => {
    try {
      const prefixes = ['students_cache', 'tasks_cache_', 'wrong_questions_cache_', 'exams_cache_', 'generated_exams_cache_']
      prefixes.forEach(prefix => {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith(prefix)) {
            localStorage.removeItem(key)
            localStorage.removeItem(key + '_ts')
          }
        })
      })
    } catch (e) {}
  }

  // 初始化数据
  const initData = async () => {
    // 清理旧缓存，确保加载最新数据
    clearOldCaches()

    // 加载学生列表
    await loadStudents()

    // 默认选择第一个学生（无论是否有错题）
    const firstStudent = students.value[0]
    if (firstStudent) {
      setCurrentStudent(firstStudent)
      // 加载该学生的已完成任务
      await loadStudentTasks(firstStudent.id)
      // 加载错题数据
      await loadWrongQuestions(firstStudent.id)
      // 自动选择第一份待复核试卷（优先 done，其次任一）
      if (studentTasks.value.length > 0) {
        const firstPending = studentTasks.value.find(t => t.status === 'done')
        await selectTask(firstPending || studentTasks.value[0])
      }
    }

    // 计算今日统计
    calculateTodayStats()
  }

  // 设置当前学生
  const setCurrentStudent = (student) => {
    currentStudent.value = student
    currentReviewIndex.value = 0
    reviewStatus.value = allQuestions.value.length > 0 ? 'reviewing' : 'completed'
  }

  // 下一题
  const nextQuestion = () => {
    if (currentReviewIndex.value < allQuestions.value.length - 1) {
      currentReviewIndex.value++
      return true
    }
    return false
  }

  // 上一题
  const prevQuestion = () => {
    if (currentReviewIndex.value > 0) {
      currentReviewIndex.value--
      return true
    }
    return false
  }

  // 跳转到指定题目
  const jumpToQuestion = (idx) => {
    if (idx >= 0 && idx < allQuestions.value.length) {
      currentReviewIndex.value = idx
    }
  }

  // 审核错题（使用新的生命周期状态）
  const reviewQuestion = (questionId, result) => {
    const question = allQuestions.value.find(q => q.id === questionId)
    if (question) {
      // Store manual review status on the question
      question.review_status = result

      // 持久化 review_status 到数据库
      updateQuestionReviewStatus(questionId, result).catch(e =>
        console.error(`review_status 持久化失败 q=${questionId.substring(0, 8)}:`, e.message)
      )

      // Also update the wrong question if it exists
      const wq = wrongQuestions.value.find(w => w.question_id === questionId)
      if (wq) {
        const currentStatus = wq.lifecycle_status || LIFECYCLE_STATUS.NEW

        switch (result) {
          case 'correct':
            wq.lifecycle_status = lifecycleStore.getNextStatus(currentStatus)
            wq.status = wq.lifecycle_status === LIFECYCLE_STATUS.MASTERED ? 'mastered' : 'pending'
            wq.practice_count = (wq.practice_count || 0) + 1
            break
          case 'wrong':
            wq.lifecycle_status = LIFECYCLE_STATUS.NEW
            wq.status = 'pending'
            wq.error_count = (wq.error_count || 0) + 1
            break
          case 'exclude':
            wq.lifecycle_status = LIFECYCLE_STATUS.EXCLUDED
            wq.status = 'excluded'
            break
        }

        // [P0-3c] 持久化审核结果到数据库
        updateWrongQuestionStatus(wq.id, wq.status, {
          lifecycle_status: wq.lifecycle_status
        }).catch(e => console.error(`[P0-3c] 审核结果持久化失败 wq=${wq.id.substring(0, 8)}:`, e.message))
      }

      // 重新计算统计
      calculateTodayStats()

      // 自动进入下一题
      if (!nextQuestion()) {
        // 最后一道题已复核 → 自动完成复核 + 进入下一份
        reviewStatus.value = 'completed'
        // 延迟触发自动保存和跳转，让 UI 先更新
        setTimeout(() => autoCompleteAndAdvance(), 300)
      }
    }
  }

  // 自动完成复核并跳转到下一份试卷
  const autoCompleteAndAdvance = async () => {
    if (!currentTask.value) return
    // 先保存复核完成状态
    await updateTaskStatus(currentTask.value.id, 'reviewed').catch(e =>
      console.error('自动保存复核状态失败:', e.message)
    )
    currentTask.value.status = 'reviewed'
    if (currentStudent.value?.id) {
      clearStudentCaches(currentStudent.value.id)
    }
    // 刷新任务列表
    await loadStudentTasks(currentStudent.value.id)
    // 确保刚复核的试卷始终在 studentTasks 中
    if (currentTask.value && !studentTasks.value.some(t => t.id === currentTask.value.id)) {
      studentTasks.value.push({ ...currentTask.value })
      const sorter = { done: 0, reviewed: 1 }
      studentTasks.value.sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))
    }
    // 自动进入下一份试卷
    const next = nextTask()
    if (next) {
      await selectTask(next)
    }
  }

  // 加载当前学生的已完成任务列表（含 done 和 reviewed）
  const loadStudentTasks = async (studentId) => {
    try {
      const tasks = await getTasksByStudent(studentId, false)
      // 纳入 done 和 reviewed，按 status 排序：done 优先
      const sorter = { done: 0, reviewed: 1 }
      studentTasks.value = (tasks || [])
        .filter(t => t.status === 'done' || t.status === 'reviewed')
        .sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))
    } catch (e) {
      console.error('加载学生任务失败:', e)
      studentTasks.value = []
    }
  }

  // 待复核试卷（status === 'done'）
  const pendingTasks = computed(() =>
    studentTasks.value.filter(t => t.status === 'done')
  )

  // 已复核试卷（status === 'reviewed'）
  const reviewedTasks = computed(() =>
    studentTasks.value.filter(t => t.status === 'reviewed')
  )

  // 其他待复核试卷（status === 'done' 且不是当前试卷）
  const otherPendingTasks = computed(() => {
    if (!currentTask.value) return pendingTasks.value
    return pendingTasks.value.filter(t => t.id !== currentTask.value.id)
  })

  // 选择试卷 → 加载题目 + 判定数据 + 错题数据
  const selectTask = async (task) => {
    currentTask.value = task
    currentReviewIndex.value = 0
    reviewStatus.value = 'reviewing'
    await loadQuestions(task.id)

    // [修复] 加载最新判定数据（含 confidence），合并到每道题
    if (currentStudent.value?.id && allQuestions.value.length > 0) {
      await mergeJudgements(currentStudent.value.id, allQuestions.value)
    }

    if (currentStudent.value?.id) {
      await loadWrongQuestions(currentStudent.value.id)
    }
  }

  // 从 judgements 表合并 confidence 到 questions
  const mergeJudgements = async (studentId, questions) => {
    try {
      const qIds = questions.map(q => q.id).filter(Boolean)
      if (qIds.length === 0) return
      const result = await getLatestJudgements(studentId, qIds)
      const judgements = result.judgements || []
      if (!Array.isArray(judgements) || judgements.length === 0) return

      const judgeMap = {}
      for (const j of judgements) {
        if (j.question_id) judgeMap[j.question_id] = j
      }

      for (const q of questions) {
        const j = judgeMap[q.id]
        if (j) {
          q.confidence = j.confidence
          // 若 question 本身没有 is_correct，从 judgement 补充
          if (q.is_correct == null && j.is_correct != null) {
            q.is_correct = j.is_correct
          }
        }
      }
    } catch (e) {
      console.error('合并判定数据失败:', e)
    }
  }

  // 获取人工复核进度
  const getManualReviewProgress = () => {
    const total = allQuestions.value.length
    if (total === 0) return { reviewed: 0, total: 0, percent: 0 }
    const reviewed = allQuestions.value.filter(q => q.review_status).length
    return { reviewed, total, percent: Math.round((reviewed / total) * 100) }
  }

  // 获取题目状态
  const getQuestionReviewStatus = (question) => {
    return question.review_status || null
  }

  // 跳到下一份试卷（仅在 done 的待复核试卷中导航）
  const nextTask = () => {
    if (!currentTask.value || pendingTasks.value.length === 0) return null
    const idx = pendingTasks.value.findIndex(t => t.id === currentTask.value.id)
    if (idx < pendingTasks.value.length - 1) {
      return pendingTasks.value[idx + 1]
    }
    return null // 已经是最后一份
  }

  // 完成任务复核：将试卷标记为 reviewed，清理缓存
  const completeTaskReview = async () => {
    if (!currentTask.value) return
    await updateTaskStatus(currentTask.value.id, 'reviewed')
    currentTask.value.status = 'reviewed'
    if (currentStudent.value?.id) {
      clearStudentCaches(currentStudent.value.id)
      await loadStudentTasks(currentStudent.value.id)
    }
    // 确保刚复核的试卷始终在 studentTasks 中（即使服务端返回有延迟）
    if (currentTask.value && !studentTasks.value.some(t => t.id === currentTask.value.id)) {
      studentTasks.value.push({ ...currentTask.value })
      const sorter = { done: 0, reviewed: 1 }
      studentTasks.value.sort((a, b) => (sorter[a.status] ?? 99) - (sorter[b.status] ?? 99))
    }
  }

  return {
    students,
    currentStudent,
    wrongQuestions,
    allQuestions,
    currentReviewIndex,
    currentTaskId,
    reviewStatus,
    todayStats,
    studentAllQuestions,
    currentReviewQuestion,
    getStudentPendingCount,
    getStudentTodayNewCount,
    calculateTodayStats,
    loadStudents,
    loadWrongQuestions,
    loadQuestions,
    initData,
    setCurrentStudent,
    nextQuestion,
    prevQuestion,
    jumpToQuestion,
    reviewQuestion,
    getManualReviewProgress,
    getQuestionReviewStatus,
    // 新增
    currentTask,
    confidenceThreshold,
    studentTasks,
    questionConfirmationMap,
    reviewProgress,
    loadStudentTasks,
    selectTask,
    nextTask,
    completeTaskReview,
    autoCompleteAndAdvance,
    otherPendingTasks,
    pendingTasks,
    reviewedTasks
  }
})
