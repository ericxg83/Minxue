import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { getStudents, getWrongQuestionsByStudent } from '../../services/apiService'
import { useLifecycleStore, LIFECYCLE_STATUS } from './lifecycleStore'

export const useReviewStore = defineStore('review', () => {
  const lifecycleStore = useLifecycleStore()
  
  // 学生列表
  const students = ref([])
  const currentStudent = ref(null)
  
  // 错题列表
  const wrongQuestions = ref([])
  
  // 当前审核的错题索引
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

  // 获取当前学生待审核的错题（所有非mastered状态的错题）
  const studentWrongQuestions = computed(() => {
    if (!currentStudent.value) return []
    return wrongQuestions.value.filter(wq => 
      wq.student_id === currentStudent.value.id && 
      wq.lifecycle_status !== LIFECYCLE_STATUS.MASTERED
    )
  })

  // 当前审核的错题
  const currentReviewQuestion = computed(() => {
    if (studentWrongQuestions.value.length === 0) return null
    return studentWrongQuestions.value[currentReviewIndex.value] || null
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

  // 初始化数据
  const initData = async () => {
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
    reviewStatus.value = studentWrongQuestions.value.length > 0 ? 'reviewing' : 'completed'
  }

  // 下一题
  const nextQuestion = () => {
    if (currentReviewIndex.value < studentWrongQuestions.value.length - 1) {
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

  // 审核错题（使用新的生命周期状态）
  const reviewQuestion = (wqId, result) => {
    const wq = wrongQuestions.value.find(w => w.id === wqId)
    if (wq) {
      const currentStatus = wq.lifecycle_status || LIFECYCLE_STATUS.NEW
      
      switch (result) {
        case 'correct':
          // 正确：进入下一个生命周期阶段
          wq.lifecycle_status = lifecycleStore.getNextStatus(currentStatus)
          wq.status = wq.lifecycle_status === LIFECYCLE_STATUS.MASTERED ? 'mastered' : 'pending'
          wq.practice_count = (wq.practice_count || 0) + 1
          break
        case 'wrong':
          // 错误：重新回到new
          wq.lifecycle_status = LIFECYCLE_STATUS.NEW
          wq.status = 'pending'
          wq.error_count = (wq.error_count || 0) + 1
          break
        case 'unanswered':
          // 未作答：保持当前状态或回到new
          wq.lifecycle_status = LIFECYCLE_STATUS.NEW
          wq.status = 'partial'
          break
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

  return {
    students,
    currentStudent,
    wrongQuestions,
    currentReviewIndex,
    reviewStatus,
    todayStats,
    studentWrongQuestions,
    currentReviewQuestion,
    getStudentPendingCount,
    getStudentTodayNewCount,
    calculateTodayStats,
    loadStudents,
    loadWrongQuestions,
    initData,
    setCurrentStudent,
    nextQuestion,
    prevQuestion,
    reviewQuestion
  }
})
