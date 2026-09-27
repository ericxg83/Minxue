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
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'
import {
  decideGateRequeue,
  GATE_REQUEUE_CODES,
  isGateAutoSkippedRow,
} from '../utils/wrongGateRequeue.js'
import { WRONG_GATE_AUTO_SKIP_REASON } from '../../src/domain/wrongGateTier.js'

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

// ── 「补全即补入」兜底清扫（2026-09-27 修盲区）────────────────────
//
// 盲区根因：补入原本只挂在 PUT /api/questions/:id（老师手动编辑保存）上。
// 但补图/补答案还会经批量脚本（recrop-*/backfill*/repair*）直接 UPDATE
// questions 写库，绕过 PUT ⇒ 元素已齐却永不入册（实测 3 条 gateAuto 留痕题
// 元素已完整、仍未入）。逐个脚本去接补入 = 8+ 处调用点，必然漏、必然漂移。
//
// 本清扫按「以库现况为准」扫描所有 gateAuto 自动放行、仍未入册、且元素已完整的
// 题，逐条走 requeueGateSkippedQuestion（内部仍过置信度闸 + 完整性闸 + 幂等）。
// 与写库通道彻底解耦：无论哪条路径补的元素，都会被它兜住。
// 红线不破：低置信题被置信度闸挡下（skipped），绝不自动入册。
const SWEEP_SELECT = `
  SELECT q.id, q.student_id, q.task_id, q.question_number, q.page_number,
         q.review_status, q.is_correct, q.answer_source, q.confidence,
         q.content, q.parent_stem, q.options, q.answer, q.question_type,
         q.geometry_image_url, q.block_coordinates,
         gs.skip_reason AS _gate_skip_reason, gs.gate_auto AS _gate_auto,
         EXISTS (SELECT 1 FROM ${TABLES.WRONG_QUESTIONS} wq WHERE wq.question_id = q.id) AS in_wrong_book
    FROM ${TABLES.QUESTIONS} q
    LEFT JOIN LATERAL (
      SELECT metadata->>'skipReason' AS skip_reason,
             metadata->>'gateAuto'   AS gate_auto
        FROM ${TABLES.JUDGEMENTS} j
       WHERE j.question_id = q.id::text
       ORDER BY j.created_at DESC LIMIT 1
    ) gs ON TRUE
   WHERE q.review_status = 'wrong_no_book'
     AND q.deleted_at IS NULL
     AND gs.skip_reason = $1
     AND gs.gate_auto = 'true'
     AND NOT EXISTS (SELECT 1 FROM ${TABLES.WRONG_QUESTIONS} wq WHERE wq.question_id = q.id)
   LIMIT 500`

let _sweepRunning = false

/**
 * 执行一次兜底清扫。
 * @param {{logTag?:string, dryRun?:boolean}} [opts]
 * @returns {Promise<{scanned:number, complete:number, added:number, skipped:number, ids:string[], skippedRun?:boolean}>}
 */
export const sweepGateRequeue = async ({ logTag = 'gate_requeue_sweep', dryRun = false } = {}) => {
  if (_sweepRunning) return { scanned: 0, complete: 0, added: 0, skipped: 0, ids: [], skippedRun: true }
  _sweepRunning = true
  try {
    const { rows } = await query(SWEEP_SELECT, [WRONG_GATE_AUTO_SKIP_REASON])
    // 谓词二次校验（与 GET 待补清单同源 isGateAutoSkippedRow），防 SQL 与 JS 判据漂移
    const gateRows = rows.filter(r => isGateAutoSkippedRow(r))
    let complete = 0, added = 0, skipped = 0
    const ids = []
    for (const row of gateRows) {
      const { codes } = checkQuestionCompleteness(row)
      if (codes.length > 0) continue // 元素仍不全：留给下次（不浪费一次入册调用）
      complete++
      if (dryRun) { ids.push(row.id); continue }
      // requeueGateSkippedQuestion 内部再过置信度闸/完整性闸/幂等，绝不绕过红线
      const res = await requeueGateSkippedQuestion({ question: row, logTag })
      if (res.status === 'added') { added++; ids.push(row.id) }
      else skipped++
    }
    if (added > 0 || complete > 0) {
      console.log(`  ♻️ [${logTag}] 兜底清扫：命中 ${gateRows.length} 条自动放行未入册，元素已齐 ${complete}，补入 ${added}，被闸挡 ${skipped}`)
    }
    return { scanned: gateRows.length, complete, added, skipped, ids }
  } finally {
    _sweepRunning = false
  }
}

/**
 * 排程：启动后先扫一次（补上服务未运行期间脚本写的库），此后每 SWEEP_INTERVAL_HOURS 扫一次。
 * 开关 GATE_REQUEUE_SWEEP_ENABLED=false 可整体关停（默认开）。
 */
export function scheduleGateRequeueSweep() {
  if (/^(0|false|off)$/i.test(String(process.env.GATE_REQUEUE_SWEEP_ENABLED || ''))) {
    console.log('♻️ 补入兜底清扫：已通过 GATE_REQUEUE_SWEEP_ENABLED 关闭')
    return
  }
  const hours = Number(process.env.GATE_REQUEUE_SWEEP_INTERVAL_HOURS) || 6
  const run = async (trigger) => {
    try { await sweepGateRequeue({ logTag: `gate_requeue_sweep:${trigger}` }) }
    catch (e) { console.error(`[补入兜底清扫] (${trigger}) 异常:`, e.message) }
  }
  // 启动后延迟 90s 扫一次（避开启动迁移/健康检查高峰），随后周期化
  setTimeout(() => run('startup'), 90_000).unref?.()
  const timer = setInterval(() => run('interval'), hours * 3600_000)
  timer.unref?.()
  console.log(`♻️ 补入兜底清扫：已排程（启动后 90s 首扫，之后每 ${hours}h）`)
}
