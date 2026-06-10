import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getQuestionsByIds, updateQuestion } from '../../services/apiService'

// 题目类型
export const QUESTION_TYPES = {
  SINGLE_CHOICE: 'single_choice',    // 单选题
  MULTIPLE_CHOICE: 'multiple_choice', // 多选题
  FILL_BLANK: 'fill_blank',          // 填空题
  SHORT_ANSWER: 'short_answer',      // 简答题
  JUDGE: 'judge'                     // 判断题
}

export const QUESTION_TYPE_LABELS = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  fill_blank: '填空题',
  short_answer: '简答题',
  judge: '判断题'
}

export const useQuestionStore = defineStore('questionBank', () => {
  // 题目列表（从所有任务中聚合）
  const allQuestions = ref([])
  const loading = ref(false)

  // 当前选中的题目
  const currentQuestion = ref(null)
  const isEditing = ref(false)

  // 筛选条件
  const filters = ref({
    search: '',
    type: 'all',
    subject: 'all',
    sortBy: 'last_seen',   // last_seen, reference_count, student_count
    sortOrder: 'desc'      // asc, desc
  })

  // 分页
  const pagination = ref({
    page: 1,
    pageSize: 20,
    total: 0
  })

  // 批量选择
  const selectedQuestions = ref([])
  const isBatchMode = ref(false)

  // 题目引用映射（question_id -> 使用信息）
  const questionUsageMap = ref({})

  // 过滤后的题目列表
  const filteredQuestions = computed(() => {
    let result = [...allQuestions.value]

    // 搜索
    if (filters.value.search) {
      const keyword = filters.value.search.toLowerCase()
      result = result.filter(q => 
        q.content?.toLowerCase().includes(keyword) ||
        q.answer?.toLowerCase().includes(keyword) ||
        q.ai_tags?.some(tag => tag.toLowerCase().includes(keyword)) ||
        q.manual_tags?.some(tag => tag.toLowerCase().includes(keyword))
      )
    }

    // 类型筛选
    if (filters.value.type !== 'all') {
      result = result.filter(q => q.question_type === filters.value.type)
    }

    // 科目筛选
    if (filters.value.subject !== 'all') {
      result = result.filter(q => q.subject === filters.value.subject)
    }

    // 排序
    result.sort((a, b) => {
      let aVal, bVal
      
      switch (filters.value.sortBy) {
        case 'last_seen':
          aVal = new Date(a._lastSeen || 0).getTime()
          bVal = new Date(b._lastSeen || 0).getTime()
          break
        case 'reference_count':
          aVal = a._referenceCount || 0
          bVal = b._referenceCount || 0
          break
        case 'student_count':
          aVal = a._studentCount || 0
          bVal = b._studentCount || 0
          break
        default:
          aVal = 0
          bVal = 0
      }

      return filters.value.sortOrder === 'desc' ? bVal - aVal : aVal - bVal
    })

    // 分页
    pagination.value.total = result.length
    const start = (pagination.value.page - 1) * pagination.value.pageSize
    return result.slice(start, start + pagination.value.pageSize)
  })

  // 已选题目数量
  const selectedCount = computed(() => selectedQuestions.value.length)

  // 获取所有题目（从所有学生任务中聚合）
  const loadAllQuestions = async () => {
    loading.value = true
    try {
      // 这里需要一个API来获取所有题目ID
      // 暂时通过遍历所有学生的任务来获取
      const { getStudents, getTasksByStudent, getQuestionsByTask } = await import('../../services/apiService')
      
      const studentsResult = await getStudents(false)
      const students = studentsResult.data || studentsResult || []
      
      const questionMap = new Map()
      const usageMap = {}

      for (const student of students) {
        const tasks = await getTasksByStudent(student.id, false)
        const doneTasks = (tasks || []).filter(t => t.status === 'done')

        for (const task of doneTasks) {
          const questions = await getQuestionsByTask(task.id, false)
          
          for (const q of (questions || [])) {
            const existing = questionMap.get(q.id)
            if (!existing) {
              questionMap.set(q.id, {
                ...q,
                _referenceCount: 1,
                _studentCount: 1,
                _students: [student.id],
                _lastSeen: task.created_at
              })
            } else {
              existing._referenceCount++
              if (!existing._students.includes(student.id)) {
                existing._studentCount++
                existing._students.push(student.id)
              }
              if (new Date(task.created_at) > new Date(existing._lastSeen || 0)) {
                existing._lastSeen = task.created_at
              }
            }

            // 更新使用映射
            if (!usageMap[q.id]) {
              usageMap[q.id] = {
                referenceCount: 0,
                studentCount: 0,
                students: new Set(),
                lastSeen: null
              }
            }
            usageMap[q.id].referenceCount++
            usageMap[q.id].students.add(student.id)
            usageMap[q.id].studentCount = usageMap[q.id].students.size
            if (!usageMap[q.id].lastSeen || new Date(task.created_at) > new Date(usageMap[q.id].lastSeen)) {
              usageMap[q.id].lastSeen = task.created_at
            }
          }
        }
      }

      allQuestions.value = Array.from(questionMap.values())
      questionUsageMap.value = usageMap
      
      // 重置分页
      pagination.value.page = 1
    } catch (e) {
      console.error('加载题目库失败:', e)
      allQuestions.value = []
    } finally {
      loading.value = false
    }
  }

  // 搜索
  const search = (keyword) => {
    filters.value.search = keyword
    pagination.value.page = 1
  }

  // 设置筛选条件
  const setFilter = (key, value) => {
    filters.value[key] = value
    pagination.value.page = 1
  }

  // 设置排序
  const setSort = (sortBy, sortOrder = 'desc') => {
    filters.value.sortBy = sortBy
    filters.value.sortOrder = sortOrder
  }

  // 分页
  const setPage = (page) => {
    pagination.value.page = page
  }

  const setPageSize = (pageSize) => {
    pagination.value.pageSize = pageSize
    pagination.value.page = 1
  }

  // 选择/取消选题目
  const toggleSelect = (questionId) => {
    const index = selectedQuestions.value.indexOf(questionId)
    if (index > -1) {
      selectedQuestions.value.splice(index, 1)
    } else {
      selectedQuestions.value.push(questionId)
    }
  }

  const selectAll = () => {
    selectedQuestions.value = filteredQuestions.value.map(q => q.id)
  }

  const clearSelection = () => {
    selectedQuestions.value = []
  }

  // 进入编辑模式
  const startEdit = (question) => {
    currentQuestion.value = { ...question }
    isEditing.value = true
  }

  // 取消编辑
  const cancelEdit = () => {
    currentQuestion.value = null
    isEditing.value = false
  }

  // 保存编辑
  const saveEdit = async () => {
    if (!currentQuestion.value) return false

    loading.value = true
    try {
      const updates = {
        content: currentQuestion.value.content,
        options: currentQuestion.value.options,
        answer: currentQuestion.value.answer,
        analysis: currentQuestion.value.analysis,
        question_type: currentQuestion.value.question_type,
        subject: currentQuestion.value.subject,
        image_url: currentQuestion.value.image_url
      }

      await updateQuestion(currentQuestion.value.id, updates)

      // 更新本地数据
      const index = allQuestions.value.findIndex(q => q.id === currentQuestion.value.id)
      if (index > -1) {
        allQuestions.value[index] = {
          ...allQuestions.value[index],
          ...updates
        }
      }

      isEditing.value = false
      currentQuestion.value = null
      return true
    } catch (e) {
      console.error('保存题目失败:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  // 批量修改
  const batchUpdate = async (updates) => {
    loading.value = true
    try {
      const results = await Promise.all(
        selectedQuestions.value.map(id => updateQuestion(id, updates))
      )

      // 更新本地数据
      for (const id of selectedQuestions.value) {
        const index = allQuestions.value.findIndex(q => q.id === id)
        if (index > -1) {
          allQuestions.value[index] = {
            ...allQuestions.value[index],
            ...updates
          }
        }
      }

      clearSelection()
      isBatchMode.value = false
      return true
    } catch (e) {
      console.error('批量修改失败:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  // 获取题目使用信息
  const getQuestionUsage = (questionId) => {
    return questionUsageMap.value[questionId] || {
      referenceCount: 0,
      studentCount: 0,
      students: [],
      lastSeen: null
    }
  }

  return {
    allQuestions,
    loading,
    currentQuestion,
    isEditing,
    filters,
    pagination,
    selectedQuestions,
    isBatchMode,
    questionUsageMap,
    filteredQuestions,
    selectedCount,
    loadAllQuestions,
    search,
    setFilter,
    setSort,
    setPage,
    setPageSize,
    toggleSelect,
    selectAll,
    clearSelection,
    startEdit,
    cancelEdit,
    saveEdit,
    batchUpdate,
    getQuestionUsage
  }
})
