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
 *   2. `exam.status` 只能区分「是否已结算」，**绝不能**用来判断「有没有交卷」——
 *      「交没交卷」的唯一判据是 `tasks.generated_exam_id = exam.id` 的行是否存在。
 *      [2026-09-17 更新] 结算时机已提前到「AI 批完时」（与通用作业管线对齐），
 *      因此 'graded' 的语义是「结果已出」，**不再等于**「老师确认了」；
 *      「老师确认了」看答卷 task.status === 'reviewed'。
 *   3. 「还有几道要老师定」看 `exam.not_answered_count`（未判定题数，
 *      口径 = server/utils/questionResultCaliber.js，与移动端分数同源）。
 *
 * 数据事实（2026-09-12 全库探针）：
 *   - generated_exams 24 份 / retry_task_id 非空 0 份
 *   - tasks 中带 generated_exam_id 的只有 1 条（陆晨曦 · 错题再测-0904，status='done'）
 *   - tasks.status 实际取值只有 reviewed / done / failed
 *   [2026-09-24 更新] tasks 中重练卷答卷已增至 17 条（涉 8 名学生），
 *   其中 status ∈ {done, reviewed} 的全部 17 条 —— 这正是「作业批改」下拉被污染的量。
 *
 * 消费方：src/workbench/stores/reviewStore.js（批改页三栏）
 *         src/workbench/views/GradeCenterWorkbench.vue（批改中心卡片）
 * 两个消费方必须都走本文件，禁止各自另判一套（历史上就是这么分叉的）。
 * [2026-09-24] `isRetryPaperTask` 也已收敛到本文件：识别「哪些 task 是重练卷答卷」
 * 与识别「卷处于什么状态」同属一条口径，分家就会再次漏判（详见该函数注释）。
 */

/** 重练卷批改状态 */
export const RETRY_PAPER_STATE = {
  /** 已布置：卷已生成，学生还没交答卷 → 老师无从复核 */
  ISSUED: 'issued',
  /** 批改中：学生已交答卷，AI 正在处理 */
  GRADING: 'grading',
  /** 识别异常：学生已交答卷，AI 处理失败（老师可进去查看答卷并重处理） */
  FAILED: 'failed',
  /** 待复核：学生已交答卷，AI 批完等老师确认（本卷尚未结算） */
  PENDING_REVIEW: 'pending_review',
  /**
   * 待确认：AI 已出结果（exam 已结算），但本卷仍有 AI 给不出结论的题等老师拍板。
   * 2026-09-17 新增 —— 结算提前到批改时（worker slim 批完即结算）后，
   * exam.status='graded' 的语义从「老师确认了」变成「AI 批完了、结果已出」，
   * 因此必须再看「还有没有未判定题」，否则这几道题会随"已确认"一起从老师待办里消失。
   */
  PENDING_CONFIRM: 'pending_confirm',
  /** 已确认：老师已拍板（答卷 task 被标 reviewed），掌握度已结算 */
  REVIEWED: 'reviewed',
}

/**
 * 判断一条 tasks 记录是不是「重练卷的答卷」。
 *
 * 判据（唯一口径）：带 `generated_exam_id`，或 `task_type === 'wrong_retry'`。
 * 这类 task 是学生扫码提交的答题卡照片，**不是独立作业**：
 *   · 题目不挂在它自己身上（questions.task_id 指向原始作业，靠
 *     generated_exams.question_ids 关联）⇒ 按 task_id 拉题目必然为空，
 *     左栏题目列表空白、右栏无内容，只剩中间那张卷面图；
 *   · 归属判定必须走「卷」（generated_exams），答卷只作附件。
 *
 * ⛔ 2026-09-24 修复：此前只有批改中心（GradeCenterWorkbench）用了这条判据，
 *    reviewStore.loadStudentTasks 的 homework 分支漏了 → 全库 17 条重练卷答卷
 *    （涉 8 名学生）混进「作业批改」的试卷下拉；其中 4 条 status='done' 进待复核队列，
 *    虞晨熙 / 陈昊煜 / 蔡怡希 三人这条卷还会被 autoSelectPendingTask 自动打开。
 *    两个消费方现在都必须走本函数，禁止各自另判一套。
 */
export const isRetryPaperTask = (task) =>
  Boolean(task?.generated_exam_id) || task?.task_type === 'wrong_retry'

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
 * @param {Object} exam  generated_exams 行 + 接口附带的统计字段
 *                      （只需 status 与 not_answered_count；可为空对象）
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

  // 到这里说明答卷已批完。
  //
  // [2026-09-17] exam.status 的语义变了：结算从「老师点完成复核时」提前到「AI 批完时」
  // （worker.js::processSlimGrading 批完即结算，与通用作业管线的 finalizeGradingBatch 对齐），
  // 所以 'graded' 不再等于"老师确认了"，只表示"结果已出"。
  // 于是分三档：
  //   · 老师已拍板（答卷 task 被标 reviewed）→ 已确认（终态，不再打扰老师）
  //   · 还没拍板 + 还有未判定题 → 待确认（老师只需处理这几道）
  //   · 还没拍板 + 没有未判定题 → 已确认
  if (exam?.status === 'graded') {
    if (taskStatus === 'reviewed') return RETRY_PAPER_STATE.REVIEWED
    return Number(exam?.not_answered_count || 0) > 0
      ? RETRY_PAPER_STATE.PENDING_CONFIRM
      : RETRY_PAPER_STATE.REVIEWED
  }

  // task.status='done' 且未结算：AI 批完但结算没成功（或历史数据）
  return RETRY_PAPER_STATE.PENDING_REVIEW
}

/** 是否有学生答卷 —— 唯一区分「已布置」的口径 */
export const hasAnswerSheet = (state) => state !== RETRY_PAPER_STATE.ISSUED

/** 是否还能进入批改页：有答卷，且 AI 不在处理中 */
export const canOpenReview = (state) =>
  hasAnswerSheet(state) && state !== RETRY_PAPER_STATE.GRADING

/** 是否允许「完成批改」结算：只有 AI 批完待老师确认的卷才可结算 */
export const canSettleReview = (state) =>
  state === RETRY_PAPER_STATE.PENDING_REVIEW || state === RETRY_PAPER_STATE.PENDING_CONFIRM

/** 是否「待复核 / 待确认」（老师现在就该动手的） */
export const isPendingReview = (state) =>
  state === RETRY_PAPER_STATE.PENDING_REVIEW || state === RETRY_PAPER_STATE.PENDING_CONFIRM

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
  [RETRY_PAPER_STATE.PENDING_CONFIRM]: {
    // 结果已出（移动端此时已能看到对/错/未判定），只剩几道 AI 给不出结论的题等老师定。
    // 文案刻意不说「待复核」：那会让老师以为整卷都没批。
    statusLabel: '待确认',
    tone: 'warning',
    aiStatusLabel: 'AI 已出结果',
    actionLabel: '进入确认',
    stepNote: '剩余题待您定',
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
 *   pending_confirm → 'review'     待确认（已出结果，只剩几道等老师定）—— 同样进主队列
 *   reviewed        → 'completed'  已完成
 */
export const RETRY_STATE_TO_WORKFLOW = {
  [RETRY_PAPER_STATE.ISSUED]: 'retry',
  [RETRY_PAPER_STATE.GRADING]: 'processing',
  [RETRY_PAPER_STATE.FAILED]: 'failed',
  [RETRY_PAPER_STATE.PENDING_REVIEW]: 'review',
  [RETRY_PAPER_STATE.PENDING_CONFIRM]: 'review',
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
  [RETRY_PAPER_STATE.PENDING_CONFIRM]: 'done',
  [RETRY_PAPER_STATE.REVIEWED]: 'reviewed',
}
