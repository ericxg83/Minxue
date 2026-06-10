/**
 * 学生成长中心 Store
 * 
 * 功能：
 * - 累计录入题目
 * - 累计错题（去重后）
 * - 已掌握/未掌握题目
 * - 掌握率
 * - 最近30天新增错题/消灭错题
 * - 掌握率趋势
 * - 错题变化趋势
 * - 重练完成率
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { mockTasks, mockWrongQuestions, mockQuestions } from '../../data/mockData'
import { useLifecycleStore, LIFECYCLE_STATUS } from './lifecycleStore'
import { deduplicateWrongQuestions } from '../../utils/questionDedup'
import dayjs from 'dayjs'

export const useGrowthStore = defineStore('growth', () => {
  const lifecycleStore = useLifecycleStore()
  const currentStudentId = ref(null)

  // ===================== 基础统计数据 =====================

  // 累计录入题目（所有task中的题目总数）
  const totalQuestions = computed(() => {
    if (!currentStudentId.value) return 0
    const doneTasks = mockTasks.filter(t => t.student_id === currentStudentId.value && t.status === 'done')
    const taskIds = new Set(doneTasks.map(t => t.id))
    return mockQuestions.filter(q => taskIds.has(q.task_id)).length
  })

  // 累计错题（去重后，知识漏洞数量）
  const totalWrongQuestions = computed(() => {
    if (!currentStudentId.value) return 0
    const studentWrong = mockWrongQuestions.filter(wq => wq.student_id === currentStudentId.value)
    const deduped = deduplicateWrongQuestions(studentWrong)
    return deduped.length
  })

  // 已掌握题目
  const masteredQuestions = computed(() => {
    if (!currentStudentId.value) return 0
    const studentWrong = mockWrongQuestions.filter(wq => wq.student_id === currentStudentId.value)
    const deduped = deduplicateWrongQuestions(studentWrong)
    return deduped.filter(wq => wq.lifecycle_status === LIFECYCLE_STATUS.MASTERED).length
  })

  // 未掌握题目（待掌握 = 累计错题 - 已掌握）
  const pendingQuestions = computed(() => {
    return totalWrongQuestions.value - masteredQuestions.value
  })

  // 掌握率
  const masteryRate = computed(() => {
    if (totalWrongQuestions.value === 0) return 0
    return Math.round((masteredQuestions.value / totalWrongQuestions.value) * 100)
  })

  // ===================== 最近30天统计 =====================

  // 最近30天新增错题
  const newWrongLast30Days = computed(() => {
    if (!currentStudentId.value) return 0
    const thirtyDaysAgo = dayjs().subtract(30, 'day')
    return mockWrongQuestions.filter(wq => {
      if (wq.student_id !== currentStudentId.value) return false
      const addedAt = dayjs(wq.added_at || wq.created_at)
      return addedAt.isAfter(thirtyDaysAgo)
    }).length
  })

  // 最近30天消灭错题（进入mastered状态的）
  const eliminatedWrongLast30Days = computed(() => {
    if (!currentStudentId.value) return 0
    const thirtyDaysAgo = dayjs().subtract(30, 'day')
    // 查找最近30天内有last_wrong_at记录且状态为mastered的错题
    const studentWrong = mockWrongQuestions.filter(wq => wq.student_id === currentStudentId.value)
    const deduped = deduplicateWrongQuestions(studentWrong)
    return deduped.filter(wq => {
      if (wq.lifecycle_status !== LIFECYCLE_STATUS.MASTERED) return false
      const lastWrong = dayjs(wq.last_wrong_at || wq.added_at)
      return lastWrong.isAfter(thirtyDaysAgo)
    }).length
  })

  // ===================== 趋势数据（按天） =====================

  // 掌握率趋势（最近7天）
  const masteryRateTrend = computed(() => {
    if (!currentStudentId.value) return []

    const days = 7
    const result = []
    const studentWrong = mockWrongQuestions.filter(wq => wq.student_id === currentStudentId.value)

    for (let i = days - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day')
      const dateStr = date.format('MM-DD')

      // 计算截止到这一天的错题情况
      const wrongUntilDate = studentWrong.filter(wq => {
        const addedAt = dayjs(wq.added_at || wq.created_at)
        return !addedAt.isAfter(date.endOf('day'))
      })

      const dedupedUntilDate = deduplicateWrongQuestions(wrongUntilDate)
      const total = dedupedUntilDate.length
      const mastered = dedupedUntilDate.filter(wq => wq.lifecycle_status === LIFECYCLE_STATUS.MASTERED).length
      const rate = total > 0 ? Math.round((mastered / total) * 100) : 0

      result.push({
        date: dateStr,
        rate,
        mastered,
        total
      })
    }

    return result
  })

  // 错题变化趋势（最近7天每天新增错题数）
  const wrongQuestionTrend = computed(() => {
    if (!currentStudentId.value) return []

    const days = 7
    const result = []
    const studentWrong = mockWrongQuestions.filter(wq => wq.student_id === currentStudentId.value)

    for (let i = days - 1; i >= 0; i--) {
      const date = dayjs().subtract(i, 'day')
      const dateStr = date.format('MM-DD')

      const count = studentWrong.filter(wq => {
        const addedAt = dayjs(wq.added_at || wq.created_at)
        return addedAt.format('YYYY-MM-DD') === date.format('YYYY-MM-DD')
      }).length

      result.push({
        date: dateStr,
        count
      })
    }

    return result
  })

  // 重练完成率
  const reviewCompletionRate = computed(() => {
    if (!currentStudentId.value) return 0
    const studentWrong = mockWrongQuestions.filter(wq => wq.student_id === currentStudentId.value)
    const deduped = deduplicateWrongQuestions(studentWrong)
    const withPractice = deduped.filter(wq => (wq.practice_count || 0) > 0).length
    if (deduped.length === 0) return 0
    return Math.round((withPractice / deduped.length) * 100)
  })

  // ===================== 按科目统计 =====================

  const subjectStats = computed(() => {
    if (!currentStudentId.value) return []
    const studentWrong = mockWrongQuestions.filter(wq => wq.student_id === currentStudentId.value)
    const deduped = deduplicateWrongQuestions(studentWrong)

    const subjectMap = {}
    deduped.forEach(wq => {
      const subject = wq.subject || '其他'
      if (!subjectMap[subject]) {
        subjectMap[subject] = { subject, total: 0, mastered: 0 }
      }
      subjectMap[subject].total++
      if (wq.lifecycle_status === LIFECYCLE_STATUS.MASTERED) {
        subjectMap[subject].mastered++
      }
    })

    return Object.values(subjectMap).map(s => ({
      ...s,
      pending: s.total - s.mastered,
      rate: s.total > 0 ? Math.round((s.mastered / s.total) * 100) : 0
    }))
  })

  // ===================== 方法 =====================

  const setCurrentStudent = (studentId) => {
    currentStudentId.value = studentId
  }

  return {
    currentStudentId,
    setCurrentStudent,
    // 基础统计
    totalQuestions,
    totalWrongQuestions,
    masteredQuestions,
    pendingQuestions,
    masteryRate,
    // 30天统计
    newWrongLast30Days,
    eliminatedWrongLast30Days,
    // 趋势
    masteryRateTrend,
    wrongQuestionTrend,
    reviewCompletionRate,
    // 科目统计
    subjectStats
  }
})
