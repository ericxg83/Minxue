import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { mockStudents, mockWrongQuestions } from '../../data/mockData'

export const useReviewStore = defineStore('review', () => {
  // 学生列表
  const students = ref(mockStudents)
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

  // 获取当前学生待审核的错题
  const studentWrongQuestions = computed(() => {
    if (!currentStudent.value) return []
    return wrongQuestions.value.filter(wq => 
      wq.student_id === currentStudent.value.id && 
      wq.status === 'pending'
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
      wq.student_id === studentId && wq.status === 'pending'
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
    
    // 今日待审核错题数量
    const pendingReview = wrongQuestions.value.filter(wq => wq.status === 'pending').length
    
    // 今日待处理学生数量（有待审核错题的学生数）
    const studentIds = new Set()
    wrongQuestions.value.forEach(wq => {
      if (wq.status === 'pending') {
        studentIds.add(wq.student_id)
      }
    })
    const pendingStudents = studentIds.size
    
    // 今日新增错题数量
    const newWrongQuestions = wrongQuestions.value.filter(wq => {
      const addedDate = dayjs(wq.added_at).format('YYYY-MM-DD')
      return addedDate === today
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

  // 初始化数据
  const initData = () => {
    // 加载错题数据
    wrongQuestions.value = mockWrongQuestions.map(wq => ({
      ...wq,
      // 添加原始试卷图片（模拟）
      originalImage: wq.question?.task_id ? 
        `https://images.unsplash.com/photo-${Math.random() > 0.5 ? '1503676260728-1c00da094a0b' : '1456513080510-7bf3a84b82f8'}?w=800&h=1200&fit=crop` 
        : null
    }))
    
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

  // 审核错题
  const reviewQuestion = (wqId, result) => {
    const wq = wrongQuestions.value.find(w => w.id === wqId)
    if (wq) {
      switch (result) {
        case 'correct':
          wq.status = 'mastered'
          break
        case 'wrong':
          // 保持 pending 或更新错误次数
          wq.error_count = (wq.error_count || 0) + 1
          break
        case 'unanswered':
          // 标记为未作答
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
    initData,
    setCurrentStudent,
    nextQuestion,
    prevQuestion,
    reviewQuestion
  }
})