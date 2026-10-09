/**
 * pendingReviewCaliber · 「还有几份卷子等老师复核」的唯一口径（2026-10-09）
 *
 * ── 起因（口径漂移事故）──
 * 首页 KPI「待复核」显示 1 份，点进批改中心却是 7 份。两边根本不是同一件事：
 *
 *   · 首页那个数字来自 `/api/tasks/summary` 的 `pendingReview`，SQL 是
 *     `tasks.status='done' AND notification_read_at IS NULL` —— 语义是**未读通知数**，
 *     不是"待复核卷数"。老师点一次通知铃铛
 *     （移动端 `App.jsx#handleOpenNotifications` → `markNotificationsRead()`）
 *     就会把**全部** done/failed 任务标已读，这个数字立刻塌缩到 0 —— 与"还有几份要复核"无关。
 *     它还有两处偏差：只数 `status='done'`（漏掉还在跑的 pending/processing），
 *     且按 `tasks` 原始行计数（重练卷多页答卷会被算成多行）。
 *
 *   · 批改中心 chip「待人工复核」才是老师要的那个数：**卡片数**
 *     （重练卷按卷合并成一张卡），取 workflowStatus ∈ {pending,processing,review,retry}，
 *     再排除「重练卷·已布置待学生作答」。
 *
 * ── 收敛方式 ──
 * 本模块把这套判据收敛成**唯一实现**，三个消费方 import 同一份：
 *   · src/workbench/views/GradeCenterWorkbench.vue —— 前端卡片列表 + pendingCount
 *   · server/services/pendingReviewService.js  —— `/api/tasks/summary` 的 pendingReviewPapers
 * ⛔ 禁止任一消费方另写一套（历史上就是各判一套才漂移的）。
 *
 * 注意：铃铛/通知中心继续用 `pendingReview`（未读）——那是通知语义，本来就该随"已读"归零。
 * 本模块只管"待办工作量"这一个语义。
 */
import {
  isRetryPaperTask,
  resolveRetryPaperState,
  RETRY_PAPER_STATE,
  RETRY_STATE_TO_WORKFLOW,
} from './retryPaperState.js'
import { isSelfHealing, autoRetryState } from '../../domain/taskAutoRetry.js'

/**
 * 「待人工复核」家族的 workflowStatus 集合。
 * `retry` = 重练卷·已布置待学生作答：留在集合里（它是「重练卷」这一族的合法状态），
 * 但被 isAwaitingStudent 排除出「待人工复核」——「等学生」不是「等我干活」。
 *
 * ⚠️ 批改中心「待处理」列表用的判据是 `isPendingReviewItem`（**不是**直接 has 本集合）：
 *    2026-10-09 负责人反馈「顶部 chip 写着重练待验证 0，点进去却列出 10 张不能批改的卡」，
 *    根因就是列表当时直接用本集合（含 'retry'）过滤，把未交卷的卷也列了进来。
 */
export const PENDING_REVIEW_WORKFLOW_STATUSES = new Set(['pending', 'processing', 'review', 'retry'])

/**
 * tasks.status → 卡片 workflowStatus。
 *
 * 第 90 轮：系统还会自己救的失败（自动重试排队中 / 等配额跨日重置）**不显示成「识别异常」**，
 * 判据来自服务端 `pendingTaskRecovery.js#describeAutoRetry`（经 `auto_retry` 字段下发），
 * 前端只翻译、不自己看 retry_count。
 */
export function normalizeHomeworkStatus(task) {
  const status = task?.status
  if (status === 'failed' && isSelfHealing(task)) {
    const waitingQuota = autoRetryState(task) === 'quota-wait'
    return waitingQuota
      ? { workflowStatus: 'processing', statusLabel: '等待 AI 服务恢复', tone: 'processing', aiStatusLabel: '额度已用满，恢复后自动继续' }
      : { workflowStatus: 'processing', statusLabel: 'AI 处理中', tone: 'processing', aiStatusLabel: '正在识别与判题' }
  }
  if (status === 'failed') return { workflowStatus: 'failed', statusLabel: '识别异常', tone: 'danger', aiStatusLabel: '识别异常' }
  if (status === 'reviewed') return { workflowStatus: 'completed', statusLabel: '已确认', tone: 'success', aiStatusLabel: '教师已确认' }
  if (status === 'done') return { workflowStatus: 'review', statusLabel: '待复核', tone: 'warning', aiStatusLabel: 'AI 已完成' }
  if (['pending', 'processing', 'queued'].includes(status)) return { workflowStatus: 'processing', statusLabel: 'AI 处理中', tone: 'processing', aiStatusLabel: '正在识别与判题' }
  return { workflowStatus: 'pending', statusLabel: '待处理', tone: 'warning', aiStatusLabel: '等待处理' }
}

/**
 * 「已布置·待学生作答」的重练卷：学生还没交卷，老师无事可做。
 * 它**不算「待人工复核」**，也**不进批改中心「待处理」列表**（2026-10-09 起）——
 * 否则就是把「等学生」混进「等我干活」（这正是 2026-09-12 那次事故的认知来源）。
 * 要看这批卷：批改中心顶部「重练已布置」chip / 状态 tab「待学生作答」。
 */
export const isAwaitingStudent = (item) =>
  item?.source === 'retry' && item?.retryState === RETRY_PAPER_STATE.ISSUED

/** 一张卡是否计入「待人工复核」 */
export const isPendingReviewItem = (item) =>
  PENDING_REVIEW_WORKFLOW_STATUSES.has(item?.workflowStatus) && !isAwaitingStudent(item)

/**
 * 服务端计数：原始 `tasks` 行 + 原始 `generated_exams` 行 → 「待人工复核卷数」。
 *
 * 与前端 `GradeCenterWorkbench.mergeStudentQueue` + `pendingCount` 逐字同构：
 * 重练卷答卷（isRetryPaperTask）不单独成卡，挂到卷下；卷按**最新一次答卷**的状态定档。
 *
 * @param {Object}   input
 * @param {Array}    input.tasks           tasks 行（需含 status / task_type / generated_exam_id / auto_retry）
 * @param {Array}    input.exams           generated_exams 行（需含 id / status）
 * @param {Map}      input.unjudgedByExam  examId → 未判定题数（口径 = server/utils/questionResultCaliber.js）
 * @returns {number}
 */
export function countPendingReviewPapers({ tasks = [], exams = [], unjudgedByExam = new Map() } = {}) {
  const cards = []
  const pagesByExam = new Map()

  for (const task of tasks) {
    if (!isRetryPaperTask(task)) {
      cards.push({ source: 'homework', workflowStatus: normalizeHomeworkStatus(task).workflowStatus })
      continue
    }
    // 没有卷可归的重练答卷（卷被删 / 跨学生）：降级成独立卡，不能让任务凭空消失。
    if (!task.generated_exam_id) {
      cards.push({ source: 'retry', retryState: null, workflowStatus: normalizeHomeworkStatus(task).workflowStatus })
      continue
    }
    if (!pagesByExam.has(task.generated_exam_id)) pagesByExam.set(task.generated_exam_id, [])
    pagesByExam.get(task.generated_exam_id).push(task)
  }

  const examById = new Map(exams.map((e) => [e.id, e]))
  for (const [examId, pages] of pagesByExam) {
    const exam = examById.get(examId) || {}
    const state = resolveRetryPaperState(
      { ...exam, not_answered_count: unjudgedByExam.get(examId) || 0 },
      pages
    )
    cards.push({ source: 'retry', retryState: state, workflowStatus: RETRY_STATE_TO_WORKFLOW[state] })
  }

  // 一份答卷都没有的卷 → 已布置待学生作答（ISSUED），卡片存在但不计入待复核
  const withPages = new Set(pagesByExam.keys())
  for (const exam of exams) {
    if (withPages.has(exam.id)) continue
    const state = resolveRetryPaperState({ ...exam, not_answered_count: unjudgedByExam.get(exam.id) || 0 }, [])
    cards.push({ source: 'retry', retryState: state, workflowStatus: RETRY_STATE_TO_WORKFLOW[state] })
  }

  return cards.filter(isPendingReviewItem).length
}
