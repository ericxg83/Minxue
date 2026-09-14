/**
 * retryExamStage · 移动端「错题再测」列表的阶段口径（唯一出口）
 *
 * 背景（2026-09-14 截图取证）：
 *   移动端列表原来只有「待完成 / 正在整理结果 / 已完成」三句文案，而
 *   `src/services/apiService.js` 在归一化时把 exam.status 压成二值
 *   （'graded' / 'ungraded'），**'grading' 被吞掉** —— 于是「正在整理结果」
 *   这一档在生产数据上根本走不到：没交卷 / 已交卷 / 正在批改 / 批完等复核
 *   四种情况全部显示成「待完成」（蔡怡希 · 错题再测-0911 已批完待复核，
 *   显示的就是「待完成」）。
 *
 * 铁律：
 *   1. 状态判定复用 PC 唯一真相 `src/workbench/utils/retryPaperState.js` 的
 *      `resolveRetryPaperState(exam, pages)`，本文件**不另判一套**。
 *   2. 判「有没有交卷」只看答卷行（`tasks.generated_exam_id = exam.id`）是否存在；
 *      `exam.status` 只能区分「是否已结算」。
 *   3. 本文件只做「状态 → 移动端人话文案」的映射；PC 的老师向文案（待复核 /
 *      AI 批改中…）不受影响。
 *
 * 移动端四档（2026-09-14 老师确认）：
 *   等待作答 → 已提交答卷 → 正在批改 → 等待复核 → （已出结果，直接显示分数）
 */
// 带 .js 扩展名是刻意的：这样 server/ 下的只读回归脚本能直接 import 本文件，
// 用真实数据回放四档判定（见 server/_diag_exam_stage_render.mjs）。
import { RETRY_PAPER_STATE, resolveRetryPaperState } from '../workbench/utils/retryPaperState.js'

export const RETRY_EXAM_STAGE = {
  /** 卷子已出，学生还没交答卷 */
  ISSUED: 'issued',
  /** 学生已提交答卷，机器还没开始跑 */
  SUBMITTED: 'submitted',
  /** 系统正在批改 */
  GRADING: 'grading',
  /** 批改没成功，需要重新提交答卷 */
  FAILED: 'failed',
  /** 批改完成，等待老师复核 */
  PENDING_REVIEW: 'pending_review',
  /** 复核完成，已有结果 */
  RESULT: 'result',
}

/** 答卷已建但 worker 还没取走的状态（与 server 侧 task 状态机一致） */
const NOT_STARTED_TASK_STATUSES = ['pending', 'queued']

/** 该卷最新一次答卷（同一份卷可能被交多次，判据取最新一次） */
export function latestAnswerSheet(exam) {
  const list = Array.isArray(exam?.answer_sheets) ? exam.answer_sheets.slice() : []
  return list.sort((a, b) => new Date(a?.created_at || 0) - new Date(b?.created_at || 0)).pop() || null
}

/**
 * 解析重练卷在移动端列表里的阶段（唯一出口）
 * @param {Object} exam 组卷行，需含 status 与 answer_sheets（后端已补）
 * @returns {string} RETRY_EXAM_STAGE 之一
 */
export function resolveRetryExamStage(exam) {
  const sheets = Array.isArray(exam?.answer_sheets) ? exam.answer_sheets : []
  const base = resolveRetryPaperState(exam, sheets)

  if (base === RETRY_PAPER_STATE.REVIEWED) return RETRY_EXAM_STAGE.RESULT
  if (base === RETRY_PAPER_STATE.FAILED) return RETRY_EXAM_STAGE.FAILED
  if (base === RETRY_PAPER_STATE.PENDING_REVIEW) return RETRY_EXAM_STAGE.PENDING_REVIEW
  if (base === RETRY_PAPER_STATE.ISSUED) return RETRY_EXAM_STAGE.ISSUED

  // 剩下的就是 PC 的 GRADING 一档。移动端把它拆成两句人话 ——
  // 「已提交答卷」= 答卷刚建、机器还没开跑；「正在批改」= worker 已取走。
  // 两者在归属上仍是 PC 的同一个状态，不影响任何状态判定。
  const latest = latestAnswerSheet(exam)
  return NOT_STARTED_TASK_STATUSES.includes(latest?.status)
    ? RETRY_EXAM_STAGE.SUBMITTED
    : RETRY_EXAM_STAGE.GRADING
}

/**
 * 阶段 → 列表行内文案。
 * RESULT 刻意留空：已出结果时行内直接显示「11/17 题正确」，不再叠一句状态词。
 * 注意长度：行内还有「09/11 11:05 · 20 道题 · 」前缀，这里控制在 6 字以内。
 */
export const RETRY_EXAM_STAGE_TEXT = {
  [RETRY_EXAM_STAGE.ISSUED]: '等待作答',
  [RETRY_EXAM_STAGE.SUBMITTED]: '已提交答卷',
  [RETRY_EXAM_STAGE.GRADING]: '正在批改',
  [RETRY_EXAM_STAGE.FAILED]: '批改出错',
  [RETRY_EXAM_STAGE.PENDING_REVIEW]: '等待复核',
  [RETRY_EXAM_STAGE.RESULT]: '',
}

/** 详情页用的完整说明（列表放不下的「下一步」写在这里） */
export const RETRY_EXAM_STAGE_HINT = {
  [RETRY_EXAM_STAGE.ISSUED]: '把做完的卷子拍下来上传，系统会自动批改',
  [RETRY_EXAM_STAGE.SUBMITTED]: '答卷已收到，马上开始批改',
  [RETRY_EXAM_STAGE.GRADING]: '正在识别与判题，稍后可回来查看',
  [RETRY_EXAM_STAGE.FAILED]: '这次批改没有成功，请重新上传答卷',
  [RETRY_EXAM_STAGE.PENDING_REVIEW]: '系统批改完成，老师复核后出结果',
  [RETRY_EXAM_STAGE.RESULT]: '',
}

/**
 * 阶段 → 语义色槽。UI 层映射到项目 CSS 变量
 * （neutral→--text-secondary / primary→--primary / warning→--warning /
 *   danger→--danger / success→--success）
 */
export const RETRY_EXAM_STAGE_TONE = {
  [RETRY_EXAM_STAGE.ISSUED]: 'neutral',
  [RETRY_EXAM_STAGE.SUBMITTED]: 'primary',
  [RETRY_EXAM_STAGE.GRADING]: 'primary',
  [RETRY_EXAM_STAGE.FAILED]: 'danger',
  [RETRY_EXAM_STAGE.PENDING_REVIEW]: 'warning',
  [RETRY_EXAM_STAGE.RESULT]: 'success',
}

/** 是否已出结果（复核完成）—— Tab「已出结果」的判定 */
export const isResultStage = stage => stage === RETRY_EXAM_STAGE.RESULT

/** 是否还能在移动端提交答卷（只有没交过、或上次批改失败时才给这个入口） */
export const canSubmitAnswerSheet = stage =>
  stage === RETRY_EXAM_STAGE.ISSUED || stage === RETRY_EXAM_STAGE.FAILED

/** 是否正在处理中（转圈类动效只给这两档） */
export const isBusyStage = stage =>
  stage === RETRY_EXAM_STAGE.SUBMITTED || stage === RETRY_EXAM_STAGE.GRADING

/**
 * 已出结果时的数字口径（列表行与详情共用，避免两处各显示一套）。
 *
 * 为什么不用「11/17 题正确」：`correct_count` 之外的那几题里混着**未作答 / 未判定**
 * （`is_correct IS NULL` 或 `answer_source='blank'`），用比例式表达会把它们全读成"错"。
 * 家长真正要看的是"错了几题"，所以分段写出错误数，其余单独标「未判定」。
 *
 * 口径与服务端 `/generated-exams/student/:id` 的统计完全一致，不在这里重算判题。
 *
 * @returns {{total:number, correct:number, wrong:number, rest:number, allCorrect:boolean, text:string}|null}
 */
export function resolveRetryExamScore(exam) {
  const total = Array.isArray(exam?.question_ids) ? exam.question_ids.length : (Number(exam?.total_count) || 0)
  if (!total) return null
  const correct = Number(exam?.correct_count) || 0
  const wrong = Number(exam?.wrong_count) || 0
  const rest = Math.max(total - correct - wrong, 0)
  const allCorrect = correct === total
  const text = allCorrect
    ? `${total} 题全对`
    : [`${correct} 正确`, `${wrong} 错误`, ...(rest > 0 ? [`${rest} 未判定`] : [])].join(' · ')
  return { total, correct, wrong, rest, allCorrect, text }
}
