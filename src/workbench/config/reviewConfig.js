/**
 * 统一批改工作台（Review Workspace）的 UI 配置
 *
 * 两个批改入口共用同一套三栏工作台，仅数据来源不同：
 * - homework（题目校对 / 作业批改）：source=image，基于学生上传图片
 * - paper（错题重练 / 练习批改）：source=paper，基于生成的练习卷（多页答题卡）
 *
 * 差异只由下方开关驱动，布局与交互保持完全一致。
 */

export const TASK_TYPE = {
  HOMEWORK: 'homework',
  PAPER: 'paper',
}

export const REVIEW_CONFIG = {
  [TASK_TYPE.HOMEWORK]: {
    // 数据来源：image=学生上传图片
    source: 'image',
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
    // 中间查看区下方是否显示「其他待复核试卷」缩略图
    showOtherPapers: false,
    // 是否支持多页试卷切换
    multiPage: false,
    // 完成按钮文案
    completeLabel: '完成复核',
    // 快捷键：正确/错误/排除
    shortcuts: { correct: 'c', wrong: 'w', exclude: 'e' },
  },

  [TASK_TYPE.PAPER]: {
    // 数据来源：paper=生成的练习卷
    source: 'paper',
    modeLabel: '错题重练',
    topTitle: '练习批改',
    detailTitle: '练习批改',
    buttons: {
      correct: '正确',
      wrong: '错误',
      exclude: '排除',
    },
    showExclude: true,
    showWrongGate: true,
    showMasteryChange: false,
    // 同一份作业可能有多张试卷 → 保留「其他待复核试卷」
    showOtherPapers: true,
    // 支持多页答题卡切换
    multiPage: true,
    completeLabel: '完成批改',
    shortcuts: { correct: 'c', wrong: 'w', exclude: 'e' },
  },
}

export const getReviewConfig = (taskType) =>
  REVIEW_CONFIG[taskType] || REVIEW_CONFIG[TASK_TYPE.HOMEWORK]
