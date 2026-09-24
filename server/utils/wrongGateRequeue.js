/**
 * 「补全即补入」判据 —— 唯一口径（纯函数，供 PUT 端点与回填脚本共用）
 *
 * ── 要解决的问题（2026-09-24）──
 * P2 门禁分层（2026-09-23）把「系统侧缺项」的错题自动记成
 * `review_status='wrong_no_book'`（留痕「本次不加入」）以换取不拦卷。
 * 但 `wrong_no_book` 在 src/utils/reviewDecision.js 里是**终态**：
 * 一旦落下就被 needsWrongBookDecision 永久排除，且后端没有任何
 * 「补全元素后自动补入」的机制 ⇒ 老师补完配图/答案，题永远进不了错题本。
 * 实测近 14 天 8 道（探针 server/_diag_wrongnobook.mjs）：8/8 元素已完整、
 * 8/8 仍未入册。
 *
 * ── 判据（五条全部满足才补入）──
 *   1. review_status === 'wrong_no_book'         之前被记「本次不加入」
 *   2. 该 skip 来自**系统自动放行**，不是老师手动点（见 isAutoGateSkip）
 *   3. is_correct === false 或 answer_source === 'blank'  仍判错
 *   4. 不在 wrong_questions
 *   5. checkQuestionCompleteness().isComplete    老师已补全元素
 *
 * ── 红线 ──
 * 「老师手动点的本次不加入」**绝不自动拉回**（老师明确否决过）。
 * ⚠️ 只认 skipReason 是**不够**的：手动弹窗的「不加入原因」下拉
 *    （src/utils/reviewDecision.js 的 WRONG_BOOK_SKIP_REASONS）里同样有
 *    `recognition_error`（label 'OCR 或题目识别错误'），老师选它写出的
 *    judgement 与自动放行**完全同形**。
 *    因此 2026-09-24 起自动放行额外写入 `gateAuto: true` 显式标记
 *    （见 src/domain/wrongGateTier.js 的 WRONG_GATE_AUTO_FLAG），
 *    线上判据要求 skipReason 与 gateAuto **同时**成立。
 *    `allowLegacySkip` 只给存量回填脚本用：2026-09-24 之前落的记录没有
 *    gateAuto 标记，只能退化为「只看 skipReason」，且必须逐条人工核对证据。
 */
import { checkQuestionCompleteness } from './questionCompleteness.js'
import {
  WRONG_GATE_AUTO_SKIP_REASON,
  WRONG_GATE_AUTO_FLAG
} from '../../src/domain/wrongGateTier.js'

export const REVIEW_STATUS_WRONG_NO_BOOK = 'wrong_no_book'

/** 判定结果码（稳定标识，调用方/测试按 code 分支，不要按中文文案） */
export const GATE_REQUEUE_CODES = Object.freeze({
  OK: 'ok',
  NO_QUESTION: 'no_question',
  NOT_WRONG_NO_BOOK: 'not_wrong_no_book',
  MANUAL_SKIP: 'manual_skip',
  NOT_JUDGED_WRONG: 'not_judged_wrong',
  ALREADY_IN_BOOK: 'already_in_book',
  INCOMPLETE: 'incomplete'
})

/**
 * 「仍判错」口径 —— 与 server/services/wrongBookCompensation.js 的 isJudgedWrong、
 * server/utils/wrongBookRisks.js 的 isWrongish 逐字同源，不另立一套。
 *
 * blank（未作答）含在内：批改管线对空题写 is_correct=false，且「未作答等同不会」
 * 是本仓既定口径（addWrongQuestions 显式把 blank 排除在置信度闸外）。
 * 这里不额外写 `|| blank` 分支会与上面两处漂移，故保持一致；
 * 且 blank 题本来就进不了门禁（needsWrongBookDecision 要求 isWrongResult），
 * 该分支是防御性的，不构成行为放宽。
 */
export const isJudgedWrongForWrongBook = (q) =>
  q?.is_correct === false || q?.answer_source === 'blank'

/**
 * 该 skip 是否来自「门禁系统侧自动放行」。
 *
 * @param {{skipReason?: string|null, gateAuto?: any}} meta judgement.metadata 的现况
 * @param {{allowLegacy?: boolean}} [opts] allowLegacy=true 时退化为「只看 skipReason」
 *        （仅供存量回填，线上路径禁用）
 */
export const isAutoGateSkip = (meta, { allowLegacy = false } = {}) => {
  if (meta?.skipReason !== WRONG_GATE_AUTO_SKIP_REASON) return false
  if (allowLegacy) return true
  return meta?.[WRONG_GATE_AUTO_FLAG] === true
}

/**
 * 「补全即补入」判定。
 *
 * @param {Object} params
 * @param {Object} params.question        题目对象（须带 content/parent_stem/options/answer/
 *                                        question_type/geometry_image_url/review_status/is_correct）
 * @param {Object} [params.skipMeta]      最新一条 judgement 的 metadata（skipReason / gateAuto）
 * @param {boolean} [params.inWrongBook]  该题是否已在 wrong_questions
 * @param {boolean} [params.allowLegacySkip] 存量记录退化判据（仅回填脚本传 true）
 * @returns {{ requeue: boolean, code: string, issues: string[] }}
 */
export const decideGateRequeue = ({
  question,
  skipMeta = {},
  inWrongBook = false,
  allowLegacySkip = false
} = {}) => {
  const fail = (code, issues = []) => ({ requeue: false, code, issues })

  if (!question?.id) return fail(GATE_REQUEUE_CODES.NO_QUESTION)
  if (question.review_status !== REVIEW_STATUS_WRONG_NO_BOOK) {
    return fail(GATE_REQUEUE_CODES.NOT_WRONG_NO_BOOK)
  }
  if (!isAutoGateSkip(skipMeta, { allowLegacy: allowLegacySkip })) {
    return fail(GATE_REQUEUE_CODES.MANUAL_SKIP)
  }
  if (inWrongBook) return fail(GATE_REQUEUE_CODES.ALREADY_IN_BOOK)
  if (!isJudgedWrongForWrongBook(question)) {
    return fail(GATE_REQUEUE_CODES.NOT_JUDGED_WRONG)
  }
  const { isComplete, issues } = checkQuestionCompleteness(question)
  if (!isComplete) return fail(GATE_REQUEUE_CODES.INCOMPLETE, issues)

  return { requeue: true, code: GATE_REQUEUE_CODES.OK, issues: [] }
}

export default { decideGateRequeue, isAutoGateSkip, isJudgedWrongForWrongBook, GATE_REQUEUE_CODES }
