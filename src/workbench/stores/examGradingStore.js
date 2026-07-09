import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getQuestionsByIds, gradeGeneratedExam, clearCache } from '../../services/apiService'
import { LIFECYCLE_STATUS_LABELS } from './lifecycleStore'

export const useExamGradingStore = defineStore('examGrading', () => {
  // ── State ──
  const currentExam = ref(null)
  const questions = ref([])
  const gradingResults = ref({})     // { [questionId]: { isCorrect, previousLifecycle, newLifecycle } }
  const currentQuestionIndex = ref(0)
  const isSaving = ref(false)
  const isLoading = ref(false)
  const isCompleted = ref(false)
  const error = ref(null)

  // ── Computed ──
  const currentQuestion = computed(() => questions.value[currentQuestionIndex.value] || null)

  const totalQuestions = computed(() => questions.value.length)

  const gradedCount = computed(() => Object.keys(gradingResults.value).length)

  const progress = computed(() => {
    if (totalQuestions.value === 0) return 0
    return Math.round((gradedCount.value / totalQuestions.value) * 100)
  })

  const isFullyGraded = computed(() => gradedCount.value >= totalQuestions.value && totalQuestions.value > 0)

  const currentLifecycleLabel = computed(() => {
    const q = currentQuestion.value
    if (!q) return ''
    const lifecycle = gradingResults.value[q.id]?.newLifecycle || q.lifecycle_status || 'new'
    return LIFECYCLE_STATUS_LABELS[lifecycle] || lifecycle
  })

  const currentErrorCount = computed(() => {
    const q = currentQuestion.value
    if (!q) return 0
    return q.error_count || 0
  })

  // ── Actions ──
  function loadExam(exam) {
    currentExam.value = exam
    currentQuestionIndex.value = 0
    gradingResults.value = {}
    isCompleted.value = false
    error.value = null
  }

  async function loadQuestions(studentId) {
    if (!currentExam.value) return
    isLoading.value = true
    error.value = null
    try {
      const fetched = await getQuestionsByIds(currentExam.value.question_ids, studentId)
      // 按题型分组排序，与打印/PDF 排版一致：选择题 → 填空题 → 解答题 → 其他
      // 同题型内保持原始顺序
      const TYPE_ORDER = { choice: 0, fill: 1, essay: 2, answer: 2 }
      questions.value = (fetched || [])
        .map((q, idx) => ({ ...q, _originalIndex: idx }))
        .sort((a, b) => {
          const oa = TYPE_ORDER[a.question_type] ?? 99
          const ob = TYPE_ORDER[b.question_type] ?? 99
          return oa !== ob ? oa - ob : a._originalIndex - b._originalIndex
        })
    } catch (e) {
      console.error('加载题目失败:', e)
      error.value = '加载题目失败: ' + e.message
    } finally {
      isLoading.value = false
    }
  }

  function markCurrent(isCorrect) {
    const q = currentQuestion.value
    if (!q) return

    const currentLifecycle = gradingResults.value[q.id]?.newLifecycle || q.lifecycle_status || 'new'
    const getNext = (status) => {
      switch (status) {
        case 'new': return 'review_1'
        case 'review_1': return 'review_2'
        case 'review_2': return 'mastered'
        default: return status
      }
    }
    const newLifecycle = isCorrect ? getNext(currentLifecycle) : 'new'

    gradingResults.value = {
      ...gradingResults.value,
      [q.id]: { isCorrect, previousLifecycle: currentLifecycle, newLifecycle }
    }

    // 自动进入下一题
    if (currentQuestionIndex.value < questions.value.length - 1) {
      setTimeout(() => {
        currentQuestionIndex.value++
      }, 300)
    } else {
      // 所有题已批改
      setTimeout(() => {
        isCompleted.value = true
      }, 300)
    }
  }

  function goToPrev() {
    if (currentQuestionIndex.value > 0) {
      currentQuestionIndex.value--
    }
  }

  function goToNext() {
    if (currentQuestionIndex.value < questions.value.length - 1) {
      currentQuestionIndex.value++
    }
  }

  async function saveResults(studentId, examId) {
    isSaving.value = true
    error.value = null
    try {
      const resultsArray = Object.entries(gradingResults.value).map(([questionId, result]) => ({
        questionId,
        isCorrect: result.isCorrect
      }))

      const data = await gradeGeneratedExam(examId, studentId, resultsArray)

      // 清缓存，使列表页刷新
      if (studentId) {
        clearCache(`generated_exams_cache_${studentId}`)
      }

      return data
    } catch (e) {
      console.error('保存批改结果失败:', e)
      error.value = '保存失败: ' + e.message
      throw e
    } finally {
      isSaving.value = false
    }
  }

  function reset() {
    currentExam.value = null
    questions.value = []
    gradingResults.value = {}
    currentQuestionIndex.value = 0
    isSaving.value = false
    isLoading.value = false
    isCompleted.value = false
    error.value = null
  }

  return {
    currentExam, questions, gradingResults, currentQuestionIndex,
    isSaving, isLoading, isCompleted, error,
    currentQuestion, totalQuestions, gradedCount, progress,
    isFullyGraded, currentLifecycleLabel, currentErrorCount,
    loadExam, loadQuestions, markCurrent, goToPrev, goToNext,
    saveResults, reset
  }
})
