import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getWrongQuestionsByStudent, deleteWrongQuestion, updateWrongQuestionStatus, batchUpsertWrongQuestionStatus } from '../../services/apiService'
import { useLifecycleStore, LIFECYCLE_STATUS } from './lifecycleStore'
import { deduplicateWrongQuestions } from '../../utils/questionDedup'
import { debounce } from '../utils/performance'
import dayjs from 'dayjs'

// 使用真实API数据
const USE_MOCK_DATA = false

export const useWrongBookStore = defineStore('wrongBook', () => {
  const lifecycleStore = useLifecycleStore()

  // 状态
  const wrongQuestions = ref([])
  const selectedQuestions = ref([])
  const currentStudent = ref(null)
  const loading = ref(false)
  const dedupEnabled = ref(true)  // 是否启用去重

  // 去重缓存（优化性能）
  const dedupCache = ref(null)
  const dedupCacheKey = ref('')

  const filters = ref({
    status: 'pending',
    lifecycleStatus: 'all',    // 新增：生命周期状态筛选
    questionType: 'all',
    subject: 'all',
    time: 'all',
    errorCount: 'all',
    tag: 'all',
    category: 'all'
  })

  const sortBy = ref('time_desc')
  const searchQuery = ref('')
  const debouncedSearchQuery = ref('')  // 防抖后的搜索词
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

  // 原始错题（未去重）- 优化：合并多个 filter 为单次遍历
  const rawFilteredQuestions = computed(() => {
    const allQuestions = Array.isArray(wrongQuestions.value) ? wrongQuestions.value : []
    const result = []

    for (const wq of allQuestions) {
      // 学生筛选
      if (wq.student_id !== currentStudent.value?.id) continue

      // 分类筛选
      if (filters.value.category !== 'all') {
        const question = wq.question || wq
        const answerSource = question.answer_source || question._answer_source || 'recognized'
        const isBlank = answerSource === 'blank'
        const isCorrect = question.is_correct !== undefined ? question.is_correct : wq.is_correct
        const isUnanswered = isBlank && isCorrect === null
        const isWrong = isCorrect === false

        if (filters.value.category === 'wrong' && !isWrong) continue
        if (filters.value.category === 'unanswered' && !isUnanswered) continue
      }

      // 生命周期状态筛选
      if (filters.value.lifecycleStatus !== 'all' && wq.lifecycle_status !== filters.value.lifecycleStatus) continue

      // 掌握状态筛选
      if (filters.value.status !== 'all' && wq.status !== filters.value.status) continue

      // 科目筛选
      if (filters.value.subject !== 'all' && wq.subject !== filters.value.subject) continue

      // 时间筛选
      if (filters.value.time !== 'all' && !isWithinTimeRange(wq.added_at || wq.created_at, filters.value.time)) continue

      // 错误次数筛选
      if (filters.value.errorCount !== 'all' && !matchErrorCount(wq.error_count || 1, filters.value.errorCount)) continue

      // 标签筛选
      if (filters.value.tag !== 'all') {
        const question = wq.question || wq
        const tags = question.tags_source === 'manual'
          ? (question.manual_tags || [])
          : (question.ai_tags || [])
        if (!tags.includes(filters.value.tag)) continue
      }

      // 搜索筛选（使用防抖后的搜索词）
      if (debouncedSearchQuery.value) {
        const q = wq.question || wq
        const content = q.content || ''
        if (!content.toLowerCase().includes(debouncedSearchQuery.value.toLowerCase())) continue
      }

      result.push(wq)
    }

    return result
  })

  // 筛选错题（应用去重，带缓存优化）
  const filteredQuestions = computed(() => {
    const base = rawFilteredQuestions.value

    // 应用去重（使用缓存优化）
    let questions
    if (dedupEnabled.value) {
      // 生成缓存键
      const cacheKey = JSON.stringify(base.map(q => q.id).sort())

      // 如果缓存有效，直接使用
      if (dedupCacheKey.value === cacheKey && dedupCache.value) {
        questions = dedupCache.value
      } else {
        // 缓存失效，重新去重
        questions = deduplicateWrongQuestions(base)
        dedupCache.value = questions
        dedupCacheKey.value = cacheKey
      }
    } else {
      questions = base
    }

    // 排序
    return questions.sort((a, b) => {
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

  // 统计数据（优化：单次遍历计算所有统计）
  const stats = computed(() => {
    const studentQuestions = []
    const allQuestions = Array.isArray(wrongQuestions.value) ? wrongQuestions.value : []

    // 单次遍历收集当前学生的错题
    for (const wq of allQuestions) {
      if (wq.student_id === currentStudent.value?.id) {
        studentQuestions.push(wq)
      }
    }

    const rawTotal = studentQuestions.length

    // 去重后的数据
    const dedupedQuestions = dedupEnabled.value
      ? deduplicateWrongQuestions(studentQuestions)
      : studentQuestions

    const total = dedupedQuestions.length

    // 单次遍历统计所有指标
    let mastered = 0
    let newCount = 0
    let review1 = 0
    let review2 = 0

    for (const wq of dedupedQuestions) {
      if (wq.lifecycle_status === LIFECYCLE_STATUS.MASTERED) mastered++
      if (wq.lifecycle_status === LIFECYCLE_STATUS.NEW) newCount++
      if (wq.lifecycle_status === LIFECYCLE_STATUS.REVIEW_1) review1++
      if (wq.lifecycle_status === LIFECYCLE_STATUS.REVIEW_2) review2++
    }

    const pendingMaster = total - mastered

    // 掌握率
    const masteryRate = total > 0 ? Math.round((mastered / total) * 100) : 0

    // 去重统计
    const duplicateCount = rawTotal - total
    const dedupRate = rawTotal > 0 ? Math.round(((rawTotal - total) / rawTotal) * 100) : 0

    return {
      total,
      mastered,
      new: newCount,
      review_1: review1,
      review_2: review2,
      pendingMaster,
      masteryRate,
      rawTotal,
      duplicateCount,
      dedupRate
    }
  })

  // 加载错题数据（优化：移除自动后台刷新）
  const loadWrongQuestions = async (studentId, forceRefresh = false) => {
    if (!studentId) return

    loading.value = true
    try {
      // 优化：只在强制刷新时禁用缓存
      const data = await getWrongQuestionsByStudent(studentId, !forceRefresh)
      const safeData = Array.isArray(data) ? data : []

      wrongQuestions.value = safeData

      // 清除去重缓存
      dedupCache.value = null
      dedupCacheKey.value = ''
    } catch (error) {
      console.error('加载错题失败:', error)
    } finally {
      loading.value = false
    }
  }

  // 设置当前学生
  const setCurrentStudent = (student) => {
    currentStudent.value = student
    currentPage.value = 1
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

  // 更新掌握状态（带乐观更新）
  const updateStatus = async (wqId, status) => {
    // 乐观更新：立即更新本地状态
    const wq = wrongQuestions.value.find(w => w.id === wqId)
    if (!wq) return false

    const previousStatus = wq.status
    wq.status = status

    try {
      await updateWrongQuestionStatus(wqId, status)
      return true
    } catch (error) {
      // 回滚
      console.error('更新状态失败，回滚:', error)
      wq.status = previousStatus
      return false
    }
  }

  // 批量更新掌握状态（带乐观更新）
  const batchUpdateStatus = async (wqIds, status) => {
    try {
      if (!currentStudent.value) return false

      // 乐观更新：立即更新本地状态
      const previousStates = new Map()
      for (const wqId of wqIds) {
        const wq = wrongQuestions.value.find(w => w.id === wqId)
        if (wq) {
          previousStates.set(wqId, wq.status)
          wq.status = status
        }
      }

      // 准备批量更新数据
      const results = wqIds.map(wqId => ({
        questionId: wqId,
        status: status === 'mastered' ? 'mastered' : 'pending',
        isCorrect: status === 'mastered'
      }))

      // 调用批量接口
      await batchUpsertWrongQuestionStatus(currentStudent.value.id, results)

      console.log(`批量更新成功: ${wqIds.length} 条记录`)
      return true
    } catch (error) {
      console.error('批量更新状态失败，回滚:', error)
      // 回滚所有更改
      for (const wqId of wqIds) {
        const wq = wrongQuestions.value.find(w => w.id === wqId)
        if (wq && previousStates.has(wqId)) {
          wq.status = previousStates.get(wqId)
        }
      }
      return false
    }
  }

  // 更新生命周期状态
  const updateLifecycleStatus = async (wqId, lifecycleStatus) => {
    const wq = wrongQuestions.value.find(w => w.id === wqId)
    if (wq) {
      wq.lifecycle_status = lifecycleStatus
      wq.status = lifecycleStatus === LIFECYCLE_STATUS.MASTERED ? 'mastered' : 'pending'

      // [P0-3e] 持久化生命周期状态
      updateWrongQuestionStatus(wqId, wq.status, {
        lifecycle_status: lifecycleStatus
      }).catch(e => console.error(`[P0-3e] 生命周期状态持久化失败 wq=${wqId.substring(0, 8)}:`, e.message))

      return true
    }
    return false
  }

  // 删除错题（带乐观更新）
  const deleteQuestion = async (wqId) => {
    // 乐观更新：立即从列表中移除
    const wqIndex = wrongQuestions.value.findIndex(wq => wq.id === wqId)
    if (wqIndex === -1) return false

    const deletedWq = wrongQuestions.value[wqIndex]
    wrongQuestions.value = wrongQuestions.value.filter(wq => wq.id !== wqId)
    selectedQuestions.value = selectedQuestions.value.filter(sq => sq.id !== wqId)

    try {
      await deleteWrongQuestion(wqId)
      return true
    } catch (error) {
      console.error('删除错题失败，回滚:', error)
      // 回滚：恢复删除的错题
      wrongQuestions.value.splice(wqIndex, 0, deletedWq)
      return false
    }
  }

  // 批量删除错题（Week 2 优化）
  const batchDeleteQuestions = async (wqIds) => {
    try {
      // 并发删除
      const deletePromises = wqIds.map(wqId => deleteWrongQuestion(wqId))
      await Promise.all(deletePromises)

      // 更新本地状态
      wrongQuestions.value = wrongQuestions.value.filter(wq => !wqIds.includes(wq.id))
      selectedQuestions.value = selectedQuestions.value.filter(sq => !wqIds.includes(sq.id))

      console.log(`批量删除成功: ${wqIds.length} 条记录`)
      return true
    } catch (error) {
      console.error('批量删除失败:', error)
      return false
    }
  }

  // 设置筛选条件
  const setFilter = (key, value) => {
    filters.value[key] = value
    currentPage.value = 1
  }

  // 重置筛选
  const resetFilters = () => {
    filters.value = {
      status: 'pending',
      lifecycleStatus: 'all',
      questionType: 'all',
      subject: 'all',
      time: 'all',
      errorCount: 'all',
      tag: 'all',
      category: 'all'
    }
    sortBy.value = 'time_desc'
    searchQuery.value = ''
    debouncedSearchQuery.value = ''
    currentPage.value = 1
  }

  // 获取各状态数量（优化：使用单次遍历）
  const getStatusCount = (status) => {
    if (status === 'all') return stats.value.rawTotal

    let count = 0
    for (const wq of wrongQuestions.value) {
      if (wq.student_id === currentStudent.value?.id && wq.status === status) {
        count++
      }
    }
    return count
  }

  // 获取生命周期状态数量（优化：使用单次遍历）
  const getLifecycleStatusCount = (lifecycleStatus) => {
    if (lifecycleStatus === 'all') return stats.value.rawTotal

    let count = 0
    for (const wq of wrongQuestions.value) {
      if (wq.student_id === currentStudent.value?.id && wq.lifecycle_status === lifecycleStatus) {
        count++
      }
    }
    return count
  }

  // 获取各类型数量（优化：使用单次遍历）
  const getQuestionTypeCount = (type) => {
    if (type === 'all') return stats.value.rawTotal

    let count = 0
    for (const wq of wrongQuestions.value) {
      if (wq.student_id === currentStudent.value?.id && getQuestionType(wq) === type) {
        count++
      }
    }
    return count
  }

  // 切换去重开关
  const toggleDedup = () => {
    dedupEnabled.value = !dedupEnabled.value
    currentPage.value = 1
  }

  // 设置去重开关
  const setDedupEnabled = (enabled) => {
    dedupEnabled.value = enabled
    currentPage.value = 1
  }

  // 防抖搜索设置函数
  const debouncedSetSearch = debounce((query) => {
    debouncedSearchQuery.value = query
    currentPage.value = 1
  }, 300)

  // 立即设置搜索词（用于输入框绑定）
  const setSearchQuery = (query) => {
    searchQuery.value = query
    debouncedSetSearch(query)
  }

  // 强制刷新数据
  const refreshData = () => {
    if (currentStudent.value) {
      loadWrongQuestions(currentStudent.value.id, true)
    }
  }

  return {
    wrongQuestions,
    selectedQuestions,
    currentStudent,
    loading,
    dedupEnabled,
    filters,
    sortBy,
    searchQuery,
    debouncedSearchQuery,
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
    batchUpdateStatus,
    updateLifecycleStatus,
    deleteQuestion,
    batchDeleteQuestions,
    setFilter,
    resetFilters,
    getStatusCount,
    getLifecycleStatusCount,
    getQuestionTypeCount,
    getQuestionType,
    toggleDedup,
    setDedupEnabled,
    setSearchQuery,
    refreshData
  }
})
