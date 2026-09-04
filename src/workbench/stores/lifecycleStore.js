import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 错题生命周期管理 Store
 *
 * 状态流转规则（与后端 gradingFinalizer.getNextLifecycle 保持一致）：
 * - 首次错误 → new
 * - 累计答对 1 次 → review_1
 * - 累计答对 2 次 → mastered
 * - 答错不重置进度；仅"已掌握答错"退回 review_1 重新验证
 *
 * review_2 保留为历史兼容枚举（生产库 0 条），不再被写入。
 */

// 生命周期状态定义
export const LIFECYCLE_STATUS = {
  NEW: 'new',           // 新错题
  REVIEW_1: 'review_1', // 累计答对 1 次
  REVIEW_2: 'review_2', // 历史兼容枚举，不再被写入
  MASTERED: 'mastered'  // 累计答对 2 次
}

// 状态显示名称
export const LIFECYCLE_STATUS_LABELS = {
  new: '新错题',
  review_1: '第一次重练',
  review_2: '第二次重练',
  mastered: '已掌握'
}

// 状态颜色
export const LIFECYCLE_STATUS_COLORS = {
  new: 'danger',
  review_1: 'warning',
  review_2: 'primary',
  mastered: 'success'
}

export const useLifecycleStore = defineStore('lifecycle', () => {
  // 计算下一个生命周期状态（重练正确）
  // review_2 是历史脏值，按 review_1 语义处理
  const getNextStatus = (currentStatus) => {
    switch (currentStatus) {
      case LIFECYCLE_STATUS.NEW:
      case LIFECYCLE_STATUS.REVIEW_2:
        return LIFECYCLE_STATUS.REVIEW_1
      case LIFECYCLE_STATUS.REVIEW_1:
      case LIFECYCLE_STATUS.MASTERED:
        return LIFECYCLE_STATUS.MASTERED
      default:
        return LIFECYCLE_STATUS.REVIEW_1
    }
  }

  // 处理重练结果
  const processReviewResult = (currentStatus, isCorrect) => {
    if (isCorrect) {
      return getNextStatus(currentStatus)
    }
    // 答错不重置进度；已掌握退回 review_1 重新验证
    if (currentStatus === LIFECYCLE_STATUS.MASTERED) return LIFECYCLE_STATUS.REVIEW_1
    return currentStatus
  }

  // 判断是否需要重练（非 mastered 状态都需要重练）
  const needsReview = (status) => {
    return status !== LIFECYCLE_STATUS.MASTERED
  }

  // 判断是否已掌握
  const isMastered = (status) => {
    return status === LIFECYCLE_STATUS.MASTERED
  }

  // 获取状态显示名称
  const getStatusLabel = (status) => {
    return LIFECYCLE_STATUS_LABELS[status] || status
  }

  // 获取状态颜色
  const getStatusColor = (status) => {
    return LIFECYCLE_STATUS_COLORS[status] || 'info'
  }

  return {
    LIFECYCLE_STATUS,
    LIFECYCLE_STATUS_LABELS,
    LIFECYCLE_STATUS_COLORS,
    getNextStatus,
    processReviewResult,
    needsReview,
    isMastered,
    getStatusLabel,
    getStatusColor
  }
})
