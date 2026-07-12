/**
 * 统一批改工作台（Review Workspace）的 UI 配置
 *
 * 目前仅题目校对（homework）走此三栏工作台。
 * 后续扩展（考试批改、周测诊断）只需新增一项并补充 store 分支。
 */

export const TASK_TYPE = {
  HOMEWORK: 'homework',
}

export const REVIEW_CONFIG = {
  [TASK_TYPE.HOMEWORK]: {
    modeLabel: '题目校对',
    topTitle: '作业批改',
    detailTitle: '作业批改',
    // 底部审核按钮
    buttons: {
      correct: '正确',
      wrong: '错误',
      exclude: '排除',
    },
    // 是否显示「排除」按钮
    showExclude: true,
    // 错误题是否触发「加入错题本」门禁
    showWrongGate: true,
    // 右栏是否显示本次掌握变化
    showMasteryChange: false,
    // 完成按钮文案
    completeLabel: '完成复核',
    // 快捷键：正确/错误/排除
    shortcuts: { correct: 'c', wrong: 'w', exclude: 'e' },
  },
}

export const getReviewConfig = (taskType) =>
  REVIEW_CONFIG[taskType] || REVIEW_CONFIG[TASK_TYPE.HOMEWORK]
