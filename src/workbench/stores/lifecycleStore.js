import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 错题生命周期管理 Store
 * 
 * 状态流转规则：
 * - 首次错误 → new
 * - new 重练正确 → review_1
 * - review_1 重练正确 → review_2
 * - review_2 重练正确 → mastered
 * - 任何状态重练错误 → 回到 new
 */

// 生命周期状态定义
export const LIFECYCLE_STATUS = {
  NEW: 'new',           // 新错题
  REVIEW_1: 'review_1', // 第一次重练
  REVIEW_2: 'review_2', // 第二次重练
  MASTERED: 'mastered'  // 已掌握
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
  const getNextStatus = (currentStatus) => {
    switch (currentStatus) {
      case LIFECYCLE_STATUS.NEW:
        return LIFECYCLE_STATUS.REVIEW_1
      case LIFECYCLE_STATUS.REVIEW_1:
        return LIFECYCLE_STATUS.REVIEW_2
      case LIFECYCLE_STATUS.REVIEW_2:
        return LIFECYCLE_STATUS.MASTERED
      default:
        return currentStatus
    }
  }

  // 处理重练结果
  const processReviewResult = (currentStatus, isCorrect) => {
    if (isCorrect) {
      // 正确：进入下一个阶段
      return getNextStatus(currentStatus)
    } else {
      // 错误：重新回到 new
      return LIFECYCLE_STATUS.NEW
    }
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
