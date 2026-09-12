/**
 * retryPaperState · 错题重练卷（generated_exams）的批改状态单一口径
 *
 * 背景（2026-09-12 事故沉淀）：
 *   PC 工作台「批改中心 → 重练批改」把「重练卷生成」等同于「有作业可批改」，
 *   于是 24 份重练卷全部落进老师的待复核队列。但其中 23 份**学生从未上传答卷**，
 *   点进去中间栏无图（图片加载失败）、左右栏显示的是原始作业的旧判定。
 *
 * 口径铁律：
 *   1. 重练卷只有在学生上传答卷之后，才进入老师的待批改队列。
 *   2. **`exam.status` 绝不能用来判断「有没有交卷」** —— 全库 24 份 status 都是
 *      'ungraded'，连那份已经批完、答卷 task.status='done' 的也是。它只能区分
 *      「待复核 / 已确认」（'graded' 由 gradingFinalizer 结算时写入）。
 *   3. 「交没交卷」的唯一判据是 `tasks.generated_exam_id = exam.id` 的行是否存在。
 *
 * 数据事实（2026-09-12 全库探针）：
 *   - generated_exams 24 份 / retry_task_id 非空 0 份
 *   - tasks 中带 generated_exam_id 的只有 1 条（陆晨曦 · 错题再测-0904，status='done'）
 *   - tasks.status 实际取值只有 reviewed / done / failed
 *
 * 消费方：src/workbench/stores/reviewStore.js（批改页三栏）
 *         src/workbench/views/GradeCenterWorkbench.vue（批改中心卡片）
 * 两个消费方必须都走本文件，禁止各自另判一套（历史上就是这么分叉的）。
 */

/** 重练卷批改状态 */
export const RETRY_PAPER_STATE = {
  /** 已布置：卷已生成，学生还没交答卷 → 老师无从复核 */
  ISSUED: 'issued',
  /** 批改中：学生已交答卷，AI 正在处理 */
  GRADING: 'grading',
  /** 识别异常：学生已交答卷，AI 处理失败（老师可进去查看答卷并重处理） */
  FAILED: 'failed',
  /** 待复核：学生已交答卷，AI 批完等老师确认 */
  PENDING_REVIEW: 'pending_review',
  /** 已确认：老师已确认，掌握度已结算（exam.status='graded'） */
  REVIEWED: 'reviewed',
}

/** AI 正在处理中的答卷 task 状态（与 server 侧 task 状态机一致） */
const GRADING_TASK_STATUSES = ['pending', 'processing', 'queued']

/**
 * 答卷 task 排序：按 created_at 升序。
 * 同一份重练卷可能被交多次，判据取**最新一次**答卷的状态。
 */
const sortPages = (pages) => {
  const list = Array.isArray(pages) ? pages.slice() : []
  return list.sort((a, b) => new Date(a?.created_at || 0) - new Date(b?.created_at || 0))
}

/**
 * 解析重练卷批改状态（单一出口）
 *
 * @param {Object} exam  generated_exams 行（只需 status；可为空对象）
 * @param {Array}  pages 该卷的答卷 task 列表（tasks.generated_exam_id = exam.id）
 * @returns {string} RETRY_PAPER_STATE 之一
 */
export function resolveRetryPaperState(exam, pages = []) {
  const list = sortPages(pages)

  // 没有答卷 task → 学生还没交卷。这是本次修复的核心分支：
  // 此前一律落到「待复核」，才导致老师进到无图的批改页。
  if (list.length === 0) return RETRY_PAPER_STATE.ISSUED

  const latest = list[list.length - 1]
  const taskStatus = latest?.status

  if (GRADING_TASK_STATUSES.includes(taskStatus)) return RETRY_PAPER_STATE.GRADING
  if (taskStatus === 'failed') return RETRY_PAPER_STATE.FAILED

  // 到这里说明答卷已批完。区分「待复核 / 已确认」才轮到 exam.status ——
  // 这是它唯一可信的用途（gradingFinalizer 结算时写入 'graded'）。
  if (exam?.status === 'graded') return RETRY_PAPER_STATE.REVIEWED

  // task.status='done' / 'reviewed' 都按待复核处理：
  // paper 模式结算只写 exam.status，不会把答卷 task 改成 reviewed（见
  // reviewStore.persistTaskCompletion 的 paper 分支），因此不能依赖 task.status。
  return RETRY_PAPER_STATE.PENDING_REVIEW
}

/** 是否有学生答卷 —— 唯一区分「已布置」的口径 */
export const hasAnswerSheet = (state) => state !== RETRY_PAPER_STATE.ISSUED

/** 是否还能进入批改页：有答卷，且 AI 不在处理中 */
export const canOpenReview = (state) =>
  hasAnswerSheet(state) && state !== RETRY_PAPER_STATE.GRADING

/** 是否允许「完成批改」结算：只有 AI 批完待老师确认的卷才可结算 */
export const canSettleReview = (state) => state === RETRY_PAPER_STATE.PENDING_REVIEW

/** 是否「待复核」（老师现在就该动手的） */
export const isPendingReview = (state) => state === RETRY_PAPER_STATE.PENDING_REVIEW

/** 是否「已确认」 */
export const isReviewed = (state) => state === RETRY_PAPER_STATE.REVIEWED

/** 是否「已布置待学生作答」 */
export const isIssued = (state) => state === RETRY_PAPER_STATE.ISSUED

/**
 * 状态 → 卡片/列表文案。
 * tone 必须落在 StatusTag 的合法枚举内：neutral | success | info | warning | danger | processing
 * （见 components/ui/StatusTag.vue 的 validator，写别的值会在开发态报 prop 校验警告）。
 */
export const RETRY_PAPER_STATE_META = {
  [RETRY_PAPER_STATE.ISSUED]: {
    statusLabel: '待学生作答',
    // 「等学生」不是异常也不是成功，用 neutral 中性态，避免老师误判成待处理
    tone: 'neutral',
    aiStatusLabel: '等待学生作答',
    actionLabel: '查看重练卷',
    stepNote: '等待学生作答',
    canEnterReview: false,
  },
  [RETRY_PAPER_STATE.GRADING]: {
    statusLabel: 'AI 批改中',
    tone: 'processing',
    aiStatusLabel: '正在识别与判题',
    actionLabel: '查看进度',
    stepNote: '正在进行',
    canEnterReview: false,
  },
  [RETRY_PAPER_STATE.FAILED]: {
    statusLabel: '识别异常',
    tone: 'danger',
    aiStatusLabel: '识别异常',
    actionLabel: '查看答卷',
    stepNote: '处理出现异常',
    canEnterReview: true,
  },
  [RETRY_PAPER_STATE.PENDING_REVIEW]: {
    statusLabel: '待复核',
    tone: 'warning',
    aiStatusLabel: 'AI 已完成，待确认',
    actionLabel: '进入复核',
    stepNote: '等待处理',
    canEnterReview: true,
  },
  [RETRY_PAPER_STATE.REVIEWED]: {
    statusLabel: '已确认',
    tone: 'success',
    aiStatusLabel: '验证已完成',
    actionLabel: '查看结果',
    stepNote: '已确认',
    canEnterReview: true,
  },
}

/**
 * 取状态元信息（带兜底，避免未知值把卡片渲染崩）
 * @param {string} state
 */
export function getRetryPaperStateMeta(state) {
  return RETRY_PAPER_STATE_META[state] || RETRY_PAPER_STATE_META[RETRY_PAPER_STATE.ISSUED]
}

/**
 * 状态 → 批改中心列表用的 workflowStatus（沿用既有优先级/筛选体系）
 *
 * 映射表（GradeCenterWorkbench）：
 *   issued          → 'retry'      停在「等学生」，仍在 activeStatuses 里，卡片可见但不给复核入口
 *   grading         → 'processing' AI 处理中
 *   failed          → 'failed'     识别异常
 *   pending_review  → 'review'     待复核（主队列）
 *   reviewed        → 'completed'  已完成
 */
export const RETRY_STATE_TO_WORKFLOW = {
  [RETRY_PAPER_STATE.ISSUED]: 'retry',
  [RETRY_PAPER_STATE.GRADING]: 'processing',
  [RETRY_PAPER_STATE.FAILED]: 'failed',
  [RETRY_PAPER_STATE.PENDING_REVIEW]: 'review',
  [RETRY_PAPER_STATE.REVIEWED]: 'completed',
}

/**
 * 状态 → reviewStore.studentTasks 里的 task.status 镜像。
 * paper 模式下 status 被下游多处读取（排序、pendingTasks 等），
 * 这里给一个稳定镜像；权威字段始终是 _reviewState。
 */
export const RETRY_STATE_TO_TASK_STATUS = {
  [RETRY_PAPER_STATE.ISSUED]: 'issued',
  [RETRY_PAPER_STATE.GRADING]: 'grading',
  [RETRY_PAPER_STATE.FAILED]: 'failed',
  [RETRY_PAPER_STATE.PENDING_REVIEW]: 'done',
  [RETRY_PAPER_STATE.REVIEWED]: 'reviewed',
}
