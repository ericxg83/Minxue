/**
 * 错题入册对账补入（self-healing）
 *
 * 背景（2026-09-11 复核页「让加入又说已在」二次排查）：
 *   「已判错 + 参考答案已就绪」的题却没进错题本，实测两类成因：
 *     ① 答案是异步补齐的：OCR 阶段先判题，参考答案后到；判错那一刻 answer 为空，
 *        finalizeGradingBatch 的 wrongIds 过滤 `answer && answer.trim()` 直接排除，
 *        等答案补齐时结算早已幂等跳过（settlement_key = task:{id}:final），无人再补一次。
 *     ② finalizeGradingBatch 是 fire-and-forget：入册那一步抛错（DB 抖动等）会连带
 *        后面的 judgement / 掌握度一起中断，且没有重试。
 *
 * 本模块提供一次「以数据库现况为准」的对账补入：
 *   · 只补「已判错 + 答案条件满足 + 无终态复核决定 + 不在错题本」的题；
 *   · 答案条件对 blank 豁免（blank 按设计无参考答案，见 meetsAnswerRequirement）；
 *   · 置信度闸 / 完整性闸 / 空答语义全部复用 addWrongQuestions，不在本模块另写口径，
 *     也绝不跳过置信度闸（低置信题等老师复核拍板，不自动入册）；
 *   · 幂等：靠 wrong_questions 的唯一键去重，重复调用不产生重复行；
 *   · 只读一次题目现况 + 只读一次已入册集合，额外开销 = 1~2 次 SELECT。
 */

import { query, TABLES } from '../config/neon.js'
import { addWrongQuestions } from './neonService.js'

/** 老师已给出终态复核结论的状态：不得再被自动补入 */
const TERMINAL_REVIEW_STATUS = new Set(['correct', 'exclude', 'wrong_no_book'])

/** 占位答案不算「参考答案可用」 */
const PLACEHOLDER_ANSWERS = new Set(['待人工补充', '此为主观题，无唯一标准答案'])

const EMPTY_RESULT = { candidates: 0, added: 0, skipped: 0, ids: [] }

const isJudgedWrong = (q) => q.is_correct === false || q.answer_source === 'blank'

const hasUsableAnswer = (q) => {
  const answer = q.answer
  return !!answer && String(answer).trim() !== '' && !PLACEHOLDER_ANSWERS.has(answer)
}

/**
 * 是否满足「入册所需的答案条件」。
 *
 * ⚠️ 2026-09-23 修正：原实现直接用 hasUsableAnswer 过滤，把未作答(blank)题**整体挡掉**。
 *    blank 题按设计**没有参考答案**（卷面留空、无学生作答内容可判），
 *    而「未作答等同不会」是本仓既定口径（weeklyReport 的 wrong 计数直接含
 *    answer_source='blank'；addWrongQuestions 也显式把 blank 排除在置信度闸外，
 *    见 neonService.js 注释「blank 不放进 Map…按口径该入」）。
 *    原过滤与上述口径自相矛盾，实测 2/2 blank 题被挡，且非 blank 判错题 100/100
 *    都有答案 ⇒ 该闸**只误伤 blank**。
 *
 *    修正后：blank 豁免答案闸；非 blank 仍必须答案可用
 *    （保留原意：捕捉"判题时答案为空、随后才异步补齐"的漏网）。
 *
 *    完整性闸 / 置信度闸不受影响，仍在 addWrongQuestions 内正常生效。
 */
const meetsAnswerRequirement = (q) =>
  q.answer_source === 'blank' ? true : hasUsableAnswer(q)

const hasTerminalReview = (q) => TERMINAL_REVIEW_STATUS.has(q.review_status)

const QUESTION_COLUMNS = `q.id, q.student_id, q.answer, q.answer_source, q.is_correct, q.review_status,
         q.content, q.parent_stem, q.geometry_image_url, q.question_type, q.options, q.confidence,
         q.task_id, q.question_number, q.page_number, q.block_coordinates`

/**
 * 通用题错题入册对账补入（question_id 定位模型）
 *
 * 判定口径与 finalizeGradingBatch 完全一致，只是多了一次「已在错题本? 不在就补」的对账。
 *
 * @param {Object}   params
 * @param {string}   params.studentId   学生 ID（必填）
 * @param {Object[]} [params.questions]  权威题目对象（推荐：调用方手里已有最新 is_correct / answer）。
 *                                       传入时不再回读 questions 表，避免读到本批次尚未回写的旧 is_correct。
 * @param {string[]} [params.questionIds] 只给 id 时从 questions 表读现况（适合回填脚本/定时对账，
 *                                       能捕捉异步补齐的参考答案）
 * @param {string}   [params.reason]     日志用来源标注
 * @returns {Promise<{candidates:number, added:number, skipped:number, ids:string[]}>}
 */
export const compensateWrongBook = async ({
  studentId,
  questions = null,
  questionIds = null,
  reason = 'compensate'
} = {}) => {
  if (!studentId) return EMPTY_RESULT

  let rows = Array.isArray(questions) ? questions.filter(q => q?.id) : null
  if (!rows) {
    const ids = (questionIds || []).filter(Boolean)
    if (ids.length === 0) return EMPTY_RESULT
    // 以数据库现况为准：能捕捉到「判题时答案为空、之后才异步补齐」的题。
    // 同时排除所属 task 已软删的题（旧版本重复 task，补入会制造重复错题）。
    const res = await query(
      `SELECT ${QUESTION_COLUMNS}
         FROM ${TABLES.QUESTIONS} q
         LEFT JOIN ${TABLES.TASKS} t ON t.id = q.task_id
        WHERE q.id = ANY($1::uuid[])
          AND q.student_id = $2
          AND q.deleted_at IS NULL
          AND (t.id IS NULL OR t.deleted_at IS NULL)`,
      [ids, studentId]
    )
    rows = res.rows
  }
  if (rows.length === 0) return EMPTY_RESULT

  const candidates = rows.filter(q =>
    isJudgedWrong(q) && meetsAnswerRequirement(q) && !hasTerminalReview(q)
  )
  if (candidates.length === 0) return EMPTY_RESULT

  const { rows: existing } = await query(
    `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS}
      WHERE student_id = $1 AND question_id = ANY($2::uuid[])`,
    [studentId, candidates.map(q => q.id)]
  )
  const inBook = new Set(existing.map(row => row.question_id))
  const missing = candidates.filter(q => !inBook.has(q.id))

  if (missing.length === 0) {
    return { candidates: candidates.length, added: 0, skipped: candidates.length, ids: [] }
  }

  const added = await addWrongQuestions(
    studentId,
    missing.map(q => q.id),
    new Map(missing.map(q => [q.id, q.confidence])),
    new Map(missing.map(q => [q.id, q]))
  )

  if (added.length > 0) {
    console.log(`  ♻️ [WrongBook] 对账补入 ${added.length}/${missing.length} 题 (${reason})`)
  }

  return {
    candidates: candidates.length,
    added: added.length,
    skipped: missing.length - added.length,
    ids: added.map(row => row.question_id)
  }
}

/**
 * 候选判据对外导出（供回归测试锁定口径，勿在别处复制实现）。
 * test/wrongBookCompensationCandidate.test.mjs 直接断言这组谓词。
 */
export const __candidateRules = {
  isJudgedWrong,
  hasUsableAnswer,
  meetsAnswerRequirement,
  hasTerminalReview,
  PLACEHOLDER_ANSWERS
}

export default { compensateWrongBook }
