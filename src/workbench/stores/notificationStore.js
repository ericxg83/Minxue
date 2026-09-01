import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getTasksSummary, getInProgressTasks } from '../../services/apiService'

export const useNotificationStore = defineStore('notification', () => {
  const summary = ref({
    pendingReview: 0,
    failedTasks: 0,
    todayNewWrongQuestions: 0,
    inProgressCount: 0,
    totalNotifications: 0,
    pendingTasks: [],
    recentTasks: []
  })

  const loading = ref(false)
  const lastFetchedAt = ref(null)
  // 评审 A12：暴露错误状态，dashboard 渲染可观察的失败态
  const error = ref(null)

  // 批改中任务列表（独立于 summary，独立 15s 轮询）
  const inProgressTasks = ref([])
  const inProgressLoading = ref(false)
  let inProgressTimer = null
  const IN_PROGRESS_POLL_INTERVAL = 15_000

  let pollingTimer = null
  const POLL_INTERVAL = 45_000

  const totalCount = computed(() => summary.value.totalNotifications || 0)
  const recentTasks = computed(() => summary.value.recentTasks || [])
  const pendingTasks = computed(() => summary.value.pendingTasks || [])
  const inProgressCount = computed(() => summary.value.inProgressCount || 0)
  const hasNotifications = computed(() => totalCount.value > 0)
  const hasFailed = computed(() => (summary.value.failedTasks || 0) > 0)
  const hasInProgress = computed(() => inProgressCount.value > 0)

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

  async function fetchInProgress() {
    try {
      inProgressLoading.value = true
      const data = await getInProgressTasks(50)
      if (data && data.success) {
        inProgressTasks.value = data.tasks || []
      }
    } catch (e) {
      console.error('[Notification] 获取批改中任务失败:', e)
    } finally {
      inProgressLoading.value = false
    }
  }

  function startInProgressPolling() {
    fetchInProgress()
    inProgressTimer = setInterval(fetchInProgress, IN_PROGRESS_POLL_INTERVAL)
  }

  function stopInProgressPolling() {
    if (inProgressTimer) {
      clearInterval(inProgressTimer)
      inProgressTimer = null
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
    inProgressTasks,
    inProgressLoading,
    inProgressCount,
    hasInProgress,
    totalCount,
    recentTasks,
    pendingTasks,
    hasNotifications,
    hasFailed,
    fetchSummary,
    fetchInProgress,
    startInProgressPolling,
    stopInProgressPolling,
    clearError,
    startPolling,
    stopPolling
  }
})
