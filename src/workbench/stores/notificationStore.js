import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getTasksSummary } from '../../services/apiService'

export const useNotificationStore = defineStore('notification', () => {
  const summary = ref({
    pendingReview: 0,
    failedTasks: 0,
    todayNewWrongQuestions: 0,
    totalNotifications: 0,
    pendingTasks: [],
    recentTasks: []
  })

  const loading = ref(false)
  const lastFetchedAt = ref(null)
  // 评审 A12：暴露错误状态，dashboard 渲染可观察的失败态
  const error = ref(null)

  let pollingTimer = null
  const POLL_INTERVAL = 45_000

  const totalCount = computed(() => summary.value.totalNotifications || 0)
  const recentTasks = computed(() => summary.value.recentTasks || [])
  const pendingTasks = computed(() => summary.value.pendingTasks || [])
  const hasNotifications = computed(() => totalCount.value > 0)
  const hasFailed = computed(() => (summary.value.failedTasks || 0) > 0)

  async function fetchSummary() {
    try {
      loading.value = true
      error.value = null
      const data = await getTasksSummary()
      if (data && data.success) {
        summary.value = data.summary
        lastFetchedAt.value = new Date()
      } else {
        error.value = (data && data.error) || '返回数据格式异常'
      }
    } catch (e) {
      console.error('[Notification] 获取通知摘要失败:', e)
      error.value = e && e.message ? e.message : '网络异常，请稍后重试'
    } finally {
      loading.value = false
    }
  }

  function clearError() {
    error.value = null
  }

  function startPolling() {
    fetchSummary()
    pollingTimer = setInterval(fetchSummary, POLL_INTERVAL)
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  return {
    summary,
    loading,
    lastFetchedAt,
    error,
    totalCount,
    recentTasks,
    pendingTasks,
    hasNotifications,
    hasFailed,
    fetchSummary,
    clearError,
    startPolling,
    stopPolling
  }
})
