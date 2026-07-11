/**
 * 统一批改工作台（Review Workspace）按场景的 UI 配置
 *
 * 两个入口（题目校对 homework / 错题重练 wrong_retry）共用同一套三栏组件，
 * 仅通过这里的配置差异渲染顶部信息、底部按钮、结果区与完成动作。
 * 后续扩展（考试批改、周测诊断）只需新增一项并补充 store 分支。
 */

export const TASK_TYPE = {
  HOMEWORK: 'homework',
  WRONG_RETRY: 'wrong_retry',
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

  [TASK_TYPE.WRONG_RETRY]: {
    modeLabel: '错题重练',
    topTitle: '掌握度检测',
    detailTitle: '错题重练批改',
    buttons: {
      correct: '做对',
      wrong: '做错',
      exclude: '排除',
    },
    // 错题重练无「排除」动作
    showExclude: false,
    // 错误不再入册，无门禁
    showWrongGate: false,
    // 右栏显示本次掌握变化
    showMasteryChange: true,
    completeLabel: '完成批改',
    // 快捷键：做对/做错（无排除）
    shortcuts: { correct: 'c', wrong: 'w', exclude: null },
  },
}

export const getReviewConfig = (taskType) =>
  REVIEW_CONFIG[taskType] || REVIEW_CONFIG[TASK_TYPE.HOMEWORK]
