/**
 * 「补全即补入」执行器（2026-09-24）
 *
 * 判据在 server/utils/wrongGateRequeue.js（纯函数，唯一口径）；本文件只负责
 * 「读现况 → 判 → 入册」的 DB 编排，供两处调用：
 *   · server/index.js  PUT /api/questions/:id（老师补全元素保存后自动补入）
 *   · server/scripts/backfill-gate-wrong-book.mjs（存量一次性回填）
 *
 * 红线（与判据文件同源）：
 *   · 老师手动「本次不加入」绝不自动拉回 —— 判据要求 judgement.metadata 里
 *     同时有 skipReason='recognition_error' 与 gateAuto=true；
 *     存量记录（2026-09-24 前无 gateAuto）只能由回填脚本显式传 allowLegacySkip。
 *   · 置信度闸**不跳过**（不传 skipConfidence）—— 低置信题留老师拍板；
 *     本函数也不吞掉被闸挡下的题，而是把结果如实回传（status='skipped'）。
 *   · 写库失败上抛（铁律 #11），绝不 .catch(console.error) 静默。
 */
import { query, TABLES } from '../config/neon.js'
import { addWrongQuestions } from './neonService.js'
import {
  decideGateRequeue,
  GATE_REQUEUE_CODES
} from '../utils/wrongGateRequeue.js'

/** 结果码 → 给老师看的中文说明（只做展示，不参与判定） */
const CODE_MESSAGE = Object.freeze({
  [GATE_REQUEUE_CODES.MANUAL_SKIP]: '老师此前手动选择「本次不加入」，不自动补入',
  [GATE_REQUEUE_CODES.NOT_JUDGED_WRONG]: '该题最新判定为「正确」，不补入错题本',
  [GATE_REQUEUE_CODES.ALREADY_IN_BOOK]: '这道题已在错题本中',
  [GATE_REQUEUE_CODES.INCOMPLETE]: '题目元素仍不完整，未加入错题本',
  [GATE_REQUEUE_CODES.NOT_WRONG_NO_BOOK]: '该题不是「本次不加入」状态',
  [GATE_REQUEUE_CODES.NO_QUESTION]: '题目不存在'
})

/**
 * 读该题最新一条 judgement 的 metadata（skipReason / gateAuto 等）。
 * judgements.question_id 是 text 列，与 questions.id::text 对齐。
 */
const fetchLatestSkipMeta = async (questionId) => {
  const { rows } = await query(
    `SELECT metadata->>'skipReason' AS skip_reason,
            metadata->>'gateAuto'   AS gate_auto
       FROM ${TABLES.JUDGEMENTS}
      WHERE question_id = $1::text
      ORDER BY created_at DESC
      LIMIT 1`,
    [questionId]
  )
  if (rows.length === 0) return {}
  return {
    skipReason: rows[0].skip_reason ?? null,
    // 只有字面 'true' 才算 —— 手动路径写不出这个键
    gateAuto: rows[0].gate_auto === 'true'
  }
}

const isInWrongBook = async (studentId, questionId) => {
  if (!studentId) return false
  const { rows } = await query(
    `SELECT EXISTS (
       SELECT 1 FROM ${TABLES.WRONG_QUESTIONS}
        WHERE student_id = $1 AND question_id = $2
     ) AS in_book`,
    [studentId, questionId]
  )
  return rows[0]?.in_book === true
}

/**
 * 判定 + （满足时）补入错题本。
 *
 * @param {Object}  params
 * @param {Object}  params.question  题目现况（PUT 用 RETURNING * 的行；脚本用回读行）
 * @param {boolean} [params.allowLegacySkip] 存量记录退化判据（仅回填脚本传 true）
 * @param {string}  [params.logTag]  日志标注
 * @returns {Promise<{status:'added'|'already_exists'|'skipped', code:string,
 *                    reason:string|null, message:string, issues:string[]}>}
 */
export const requeueGateSkippedQuestion = async ({
  question,
  allowLegacySkip = false,
  logTag = 'gate_requeue'
} = {}) => {
  const skipped = (code, issues = []) => ({
    status: 'skipped',
    code,
    reason: code,
    message: CODE_MESSAGE[code] || '未满足自动补入条件',
    issues
  })

  if (!question?.id) return skipped(GATE_REQUEUE_CODES.NO_QUESTION)
  // 先做最便宜的状态短路：只有 wrong_no_book 才可能命中，避免每次 PUT 都查库
  if (question.review_status !== 'wrong_no_book') {
    return skipped(GATE_REQUEUE_CODES.NOT_WRONG_NO_BOOK)
  }

  const skipMeta = await fetchLatestSkipMeta(question.id)
  const inWrongBook = await isInWrongBook(question.student_id, question.id)
  const decision = decideGateRequeue({
    question,
    skipMeta,
    inWrongBook,
    allowLegacySkip
  })

  if (!decision.requeue) {
    if (decision.code === GATE_REQUEUE_CODES.ALREADY_IN_BOOK) {
      return {
        status: 'already_exists',
        code: decision.code,
        reason: null,
        message: CODE_MESSAGE[decision.code],
        issues: []
      }
    }
    return skipped(decision.code, decision.issues)
  }

  // 复用入册唯一口径：置信度闸（不传 skipConfidence）+ 完整性闸 + ON CONFLICT 幂等。
  // questionMap 必须传 —— 完整性闸与入册快照增强都依赖它（task_id/question_number/
  // page_number/content/question_type/block_coordinates）。
  // 写库失败不 catch：上抛给调用方（PUT 端点回 failed、脚本记 error 并计数）。
  const added = await addWrongQuestions(
    question.student_id,
    [question.id],
    new Map([[question.id, question.confidence]]),
    new Map([[question.id, question]])
  )

  if ((added?.length || 0) > 0) {
    console.log(
      `  ♻️ [${logTag}] 补全即补入 q=${String(question.id).slice(0, 8)} `
      + `student=${String(question.student_id).slice(0, 8)} 第${question.question_number ?? '-'}题`
    )
    return { status: 'added', code: GATE_REQUEUE_CODES.OK, reason: null, message: '', issues: [] }
  }

  // addWrongQuestions 返回空 = 被内部闸（置信度/完整性）挡下或已存在。
  // 完整性判据两处同源，走到这里最可能是**置信度闸**：低置信题按口径留老师拍板。
  return {
    status: 'skipped',
    code: 'confidence_gate',
    reason: 'low_confidence',
    message: `该题置信度 ${question.confidence ?? '空'} 低于阈值，按口径不自动补入，请老师复核后手动标错`,
    issues: []
  }
}

export default { requeueGateSkippedQuestion }
