import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getTasksSummary } from '../../services/apiService'

export const useNotificationStore = defineStore('notification', () => {
  const summary = ref({
    pendingReview: 0,
    failedTasks: 0,
    todayNewWrongQuestions: 0,
    totalNotifications: 0,
    recentTasks: []
  })

  const loading = ref(false)
  const lastFetchedAt = ref(null)

  let pollingTimer = null
  const POLL_INTERVAL = 45_000

  const totalCount = computed(() => summary.value.totalNotifications || 0)
  const recentTasks = computed(() => summary.value.recentTasks || [])
  const hasNotifications = computed(() => totalCount.value > 0)

  async function fetchSummary() {
    try {
      loading.value = true
      const data = await getTasksSummary()
      if (data.success) {
        summary.value = data.summary
        lastFetchedAt.value = new Date()
      }
    } catch (e) {
      console.error('[Notification] 获取通知摘要失败:', e)
    } finally {
      loading.value = false
    }
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
    totalCount,
    recentTasks,
    hasNotifications,
    fetchSummary,
    startPolling,
    stopPolling
  }
})
