import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { getStudents, getWrongQuestionsByStudent, getQuestionsByTask } from '../../services/apiService'
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
    
    // 如果有当前学生，加载其错题
    if (currentStudent.value?.id) {
      await loadWrongQuestions(currentStudent.value.id)
    } else {
      // 加载第一个学生的错题
      const firstStudent = students.value[0]
      if (firstStudent) {
        await loadWrongQuestions(firstStudent.id)
        setCurrentStudent(firstStudent)
      }
    }
    
    // 计算今日统计
    calculateTodayStats()
    
    // 默认选择第一个有待审核错题的学生
    const firstStudentWithPending = students.value.find(s => getStudentPendingCount(s.id) > 0)
    if (firstStudentWithPending) {
      setCurrentStudent(firstStudentWithPending)
    }
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
      }
      
      // 重新计算统计
      calculateTodayStats()
      
      // 自动进入下一题
      if (!nextQuestion()) {
        // 如果没有更多题目，标记为完成
        reviewStatus.value = 'completed'
      }
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
    getQuestionReviewStatus
  }
})
