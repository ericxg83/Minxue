import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWrongQuestionsByStudent, deleteWrongQuestion, updateWrongQuestionStatus } from '../../services/apiService'
import { mockWrongQuestions } from '../../data/mockData'
import dayjs from 'dayjs'

// 使用测试数据（与移动端保持一致）
const USE_MOCK_DATA = true

export const useWrongBookStore = defineStore('wrongBook', () => {
  // 状态
  const wrongQuestions = ref([])
  const selectedQuestions = ref([])
  const currentStudent = ref(null)
  const loading = ref(false)
  
  const filters = ref({
    status: 'pending',
    questionType: 'all',
    subject: 'all',
    time: 'all',
    errorCount: 'all',
    tag: 'all',
    category: 'all'
  })
  
  const sortBy = ref('time_desc')
  const searchQuery = ref('')
  const currentPage = ref(1)
  const pageSize = ref(20)

  // 辅助函数 - 时间筛选
  const isWithinTimeRange = (dateStr, timeKey) => {
    if (timeKey === 'all') return true
    const date = dayjs(dateStr)
    const now = dayjs()
    switch (timeKey) {
      case 'today':
        return date.isSame(now, 'day')
      case 'week':
        return date.isAfter(now.subtract(7, 'day'))
      case 'month':
        return date.isAfter(now.subtract(30, 'day'))
      case 'quarter':
        return date.isAfter(now.subtract(90, 'day'))
      default:
        return true
    }
  }

  // 辅助函数 - 错误次数筛选
  const matchErrorCount = (count, filterKey) => {
    if (filterKey === 'all') return true
    switch (filterKey) {
      case '1':
        return count === 1
      case '2-3':
        return count >= 2 && count <= 3
      case '4-5':
        return count >= 4 && count <= 5
      case '5+':
        return count > 5
      default:
        return true
    }
  }

  // 判定题目类型
  const getQuestionType = (wq) => {
    const question = wq.question || wq
    const answerSource = question.answer_source || question._answer_source || 'recognized'
    const isBlank = answerSource === 'blank'
    const isCorrect = question.is_correct !== undefined ? question.is_correct : wq.is_correct
    
    if (isBlank && isCorrect === null) return 'unanswered'
    if (isCorrect === false) return 'wrong'
    return 'other'
  }

  // 获取所有标签
  const getAllTags = computed(() => {
    const tagSet = new Set()
    wrongQuestions.value
      .filter(wq => wq.student_id === currentStudent.value?.id)
      .forEach(wq => {
        const question = wq.question || wq
        const tags = question.tags_source === 'manual'
          ? (question.manual_tags || [])
          : (question.ai_tags || [])
        tags.forEach(tag => tagSet.add(tag))
      })
    return Array.from(tagSet).sort()
  })

  // 筛选错题
  const filteredQuestions = computed(() => {
    return (Array.isArray(wrongQuestions.value) ? wrongQuestions.value : [])
      .filter(wq => {
        if (wq.student_id !== currentStudent.value?.id) return false
        
        // 分类筛选
        if (filters.value.category !== 'all') {
          const question = wq.question || wq
          const answerSource = question.answer_source || question._answer_source || 'recognized'
          const isBlank = answerSource === 'blank'
          const isCorrect = question.is_correct !== undefined ? question.is_correct : wq.is_correct
          const isUnanswered = isBlank && isCorrect === null
          const isWrong = isCorrect === false
          
          if (filters.value.category === 'wrong' && !isWrong) return false
          if (filters.value.category === 'unanswered' && !isUnanswered) return false
        }
        
        // 掌握状态筛选
        if (filters.value.status !== 'all' && wq.status !== filters.value.status) return false
        
        // 科目筛选
        if (filters.value.subject !== 'all' && wq.subject !== filters.value.subject) return false
        
        // 时间筛选
        if (filters.value.time !== 'all' && !isWithinTimeRange(wq.added_at || wq.created_at, filters.value.time)) return false
        
        // 错误次数筛选
        if (filters.value.errorCount !== 'all' && !matchErrorCount(wq.error_count || 1, filters.value.errorCount)) return false

        // 标签筛选
        if (filters.value.tag !== 'all') {
          const question = wq.question || wq
          const tags = question.tags_source === 'manual'
            ? (question.manual_tags || [])
            : (question.ai_tags || [])
          if (!tags.includes(filters.value.tag)) return false
        }
        
        // 搜索筛选
        if (searchQuery.value) {
          const q = wq.question || wq
          const content = q.content || ''
          if (!content.toLowerCase().includes(searchQuery.value.toLowerCase())) return false
        }
        
        return true
      })
      .sort((a, b) => {
        switch (sortBy.value) {
          case 'time_desc':
            return new Date(b.added_at || b.created_at) - new Date(a.added_at || a.created_at)
          case 'time_asc':
            return new Date(a.added_at || a.created_at) - new Date(b.added_at || b.created_at)
          case 'error_asc':
            return (a.error_count || 1) - (b.error_count || 1)
          case 'error_desc':
            return (b.error_count || 1) - (a.error_count || 1)
          case 'subject':
            return (a.subject || '').localeCompare(b.subject || '', 'zh')
          default:
            return 0
        }
      })
  })

  // 分页错题
  const paginatedQuestions = computed(() => {
    const start = (currentPage.value - 1) * pageSize.value
    return filteredQuestions.value.slice(start, start + pageSize.value)
  })

  // 总页数
  const totalPages = computed(() => Math.ceil(filteredQuestions.value.length / pageSize.value))

  // 统计数据
  const stats = computed(() => {
    const studentQuestions = (Array.isArray(wrongQuestions.value) ? wrongQuestions.value : [])
      .filter(wq => wq.student_id === currentStudent.value?.id)
    const total = studentQuestions.length
    const mastered = studentQuestions.filter(wq => wq.status === 'mastered').length
    const partial = studentQuestions.filter(wq => wq.status === 'partial').length
    const pending = studentQuestions.filter(wq => wq.status === 'pending').length
    return { total, mastered, partial, pending }
  })

  // 加载错题数据
  const loadWrongQuestions = async (studentId) => {
    if (!studentId) return
    
    loading.value = true
    try {
      if (USE_MOCK_DATA) {
        // 直接使用 mock 数据
        wrongQuestions.value = [...mockWrongQuestions]
        return
      }

      const data = await getWrongQuestionsByStudent(studentId, true)
      const safeData = Array.isArray(data) ? data : []
      
      // 合并新数据
      const existingIds = new Set(wrongQuestions.value.map(wq => wq.id))
      const newData = safeData.filter(d => !existingIds.has(d.id))
      if (newData.length > 0) {
        wrongQuestions.value = [...wrongQuestions.value, ...newData]
      }

      // 后台静默刷新
      const backgroundRefresh = async () => {
        try {
          const freshData = await getWrongQuestionsByStudent(studentId, false)
          const safeFreshData = Array.isArray(freshData) ? freshData : []
          wrongQuestions.value = safeFreshData
        } catch (error) {
          console.debug('后台刷新错题失败:', error)
        }
      }
      
      backgroundRefresh()
    } catch (error) {
      console.error('加载错题失败:', error)
    } finally {
      loading.value = false
    }
  }

  // 设置当前学生
  const setCurrentStudent = (student) => {
    currentStudent.value = student
    currentPage.value = 1 // 重置分页
  }

  // 切换选择
  const toggleSelection = (wq) => {
    const index = selectedQuestions.value.findIndex(sq => sq.id === wq.id)
    if (index === -1) {
      selectedQuestions.value = [...selectedQuestions.value, wq]
    } else {
      selectedQuestions.value = selectedQuestions.value.filter(sq => sq.id !== wq.id)
    }
  }

  // 清空选择
  const clearSelection = () => {
    selectedQuestions.value = []
  }

  // 全选
  const selectAll = () => {
    if (selectedQuestions.value.length === paginatedQuestions.value.length) {
      clearSelection()
    } else {
      selectedQuestions.value = [...paginatedQuestions.value]
    }
  }

  // 更新掌握状态
  const updateStatus = async (wqId, status) => {
    try {
      if (!USE_MOCK_DATA) {
        await updateWrongQuestionStatus(wqId, status)
      }
      // 更新本地状态
      const wq = wrongQuestions.value.find(w => w.id === wqId)
      if (wq) {
        wq.status = status
      }
      return true
    } catch (error) {
      console.error('更新状态失败:', error)
      return false
    }
  }

  // 删除错题
  const deleteQuestion = async (wqId) => {
    try {
      if (!USE_MOCK_DATA) {
        await deleteWrongQuestion(wqId)
      }
      wrongQuestions.value = wrongQuestions.value.filter(wq => wq.id !== wqId)
      selectedQuestions.value = selectedQuestions.value.filter(sq => sq.id !== wqId)
      return true
    } catch (error) {
      console.error('删除错题失败:', error)
      return false
    }
  }

  // 设置筛选条件
  const setFilter = (key, value) => {
    filters.value[key] = value
    currentPage.value = 1 // 重置分页
  }

  // 重置筛选
  const resetFilters = () => {
    filters.value = {
      status: 'pending',
      questionType: 'all',
      subject: 'all',
      time: 'all',
      errorCount: 'all',
      tag: 'all',
      category: 'all'
    }
    sortBy.value = 'time_desc'
    searchQuery.value = ''
    currentPage.value = 1
  }

  // 获取各状态数量
  const getStatusCount = (status) => {
    const studentQuestions = (Array.isArray(wrongQuestions.value) ? wrongQuestions.value : [])
      .filter(wq => wq.student_id === currentStudent.value?.id)
    if (status === 'all') return studentQuestions.length
    return studentQuestions.filter(wq => wq.status === status).length
  }

  // 获取各类型数量
  const getQuestionTypeCount = (type) => {
    const studentQuestions = (Array.isArray(wrongQuestions.value) ? wrongQuestions.value : [])
      .filter(wq => wq.student_id === currentStudent.value?.id)
    if (type === 'all') return studentQuestions.length
    return studentQuestions.filter(wq => getQuestionType(wq) === type).length
  }

  return {
    wrongQuestions,
    selectedQuestions,
    currentStudent,
    loading,
    filters,
    sortBy,
    searchQuery,
    currentPage,
    pageSize,
    filteredQuestions,
    paginatedQuestions,
    totalPages,
    stats,
    getAllTags,
    loadWrongQuestions,
    setCurrentStudent,
    toggleSelection,
    clearSelection,
    selectAll,
    updateStatus,
    deleteQuestion,
    setFilter,
    resetFilters,
    getStatusCount,
    getQuestionTypeCount,
    getQuestionType
  }
})