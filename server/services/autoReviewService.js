/**
 * 批改完即自动复核（worker 侧，取代「老师点进去才触发」）
 *
 * ── 为什么要有这个文件（2026-09-24）──
 * 自动复核判据 `src/domain/paperReviewDecision.js` 早就写好了，但它的**唯一调用方**
 * 是前端 reviewStore.selectTask 末尾的 maybeAutoCompleteReview —— 只有老师点开那份卷才跑。
 * 结果：批改完就满足条件（零人工项）的卷仍躺在 status='done'，直到老师亲自点一下。
 * 本服务把触发点前移到「批改收尾」，语义上与老师点「完成复核」对齐。
 *
 * ── 口径（负责人 2026-09-24 拍板，不可越过）──
 *   1. 【保守】**任何**未入册错题都拦卷。不做 wrongGateTier 分层、不自动写
 *      wrong_no_book —— 那等于替老师决定「这题不用进错题本」，留人工。
 *   2. 整卷不允许有「未判出」题（is_correct=null 且非 blank 且老师未处理）；
 *      低置信但 AI 已给出正误的题**照常放行**（已判出就是已判出）。
 *   3. 重练卷（wrong_retry）纳入：题目按 generated_exams.question_ids 取
 *      （与 server/index.js recalculate-stats 同源），不再因 questions.task_id
 *      查不到行而排除。实测当前 4 份待复核重练卷 100% 满足。
 *
 * ── 重练卷不额外动掌握度 ──
 * paper 模式「完成复核」= gradeGeneratedExam（掌握度结算）+ 卷 status→reviewed。
 * 但 processSlimGrading（worker.js:2851）批完时就已按同一把 settlement_key
 * (`generated_exam:{id}:final`) 结算过，且结算本身幂等 ⇒ 本服务不重复结算，
 * 只翻状态牌。实测佐证：4 份样本 exam.status 全为 graded、幂等键命中 16/16、8/8、10/10、23/30。
 *
 * ── 刻意不等于手动路径的一处 ──
 * PUT /api/tasks/:id 在 status→reviewed 时会把关联 exam 资源升 teacher_verified
 * （server/index.js:847 自动发布）。自动复核**故意不走这一步**：老师没看过就替他
 * 发布答案库，越过「v4 自动发布」的设计前提。需要发布时老师仍可在复核后手动留底。
 *
 * 开关：AUTO_REVIEW_ENABLED=false 可整体关停（紧急止血用，无需改码）。
 */
import { TABLES } from '../config/neon.js'
import { query } from '../config/neon.js'
import { isJudgedForPaperAutoComplete } from '../../src/domain/paperReviewDecision.js'
import { needsWrongBookDecision } from '../../src/utils/reviewDecision.js'

// tasks.result 里的标记字段（JSONB，不建列、不改表）
export const AUTO_REVIEW_FLAG = 'autoReviewed'

const enabled = () => process.env.AUTO_REVIEW_ENABLED !== 'false'

/**
 * 取本卷题目行的唯一口径。
 * 重练答卷（wrong_retry / 带 generated_exam_id）在 questions 表里**没有本卷题行** ——
 * 题行是与原作业共用的（task_id 指向原作业），必须按 generated_exams.question_ids 回查。
 * 照抄 server/index.js`/api/tasks/:taskId/recalculate-stats` 的既有写法，保持两端同源。
 */
export const loadTaskQuestionRows = async ({ taskId, generatedExamId }) => {
  if (generatedExamId) {
    const { rows: examRows } = await query(
      `SELECT question_ids FROM ${TABLES.GENERATED_EXAMS} WHERE id = $1`,
      [generatedExamId]
    )
    const raw = examRows[0]?.question_ids
    const ids = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw || '[]') : [])
    if (ids.length === 0) return []
    const { rows } = await query(
      `SELECT id, is_correct, answer_source, review_status, confidence
       FROM ${TABLES.QUESTIONS}
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids]
    )
    return rows
  }
  const { rows } = await query(
    `SELECT id, is_correct, answer_source, review_status, confidence
     FROM ${TABLES.QUESTIONS}
     WHERE task_id = $1 AND deleted_at IS NULL`,
    [taskId]
  )
  return rows
}

/**
 * 自动复核闸（纯函数，供 worker / 脚本 / 回归测试复用）。
 *
 * @param {Array} questions 本卷全部题目（已含 is_correct / answer_source / review_status）
 * @param {Set|Array} wrongQuestionIds 该生错题本里已存在的 question_id 集合
 * @returns {{ canAuto: boolean, reasons: string[], unjudgedCount: number, unresolvedWrongCount: number }}
 */
export const resolveAutoReviewDecision = ({ questions = [], wrongQuestionIds }) => {
  const list = Array.isArray(questions) ? questions : []
  const inBook = wrongQuestionIds instanceof Set
    ? wrongQuestionIds
    : new Set(Array.isArray(wrongQuestionIds) ? wrongQuestionIds : [])
  const reasons = []

  if (list.length === 0) reasons.push('题目列表为空')

  const unjudged = list.filter(q => !isJudgedForPaperAutoComplete(q))
  if (unjudged.length > 0) reasons.push(`${unjudged.length} 题未判出（AI未判定/处理中），留人工`)

  // 保守口径：不做 wrongGateTier 分层 —— 有任何一道仍未入册的错题就留给老师拍板。
  const unresolvedWrong = list.filter(q => needsWrongBookDecision(q, inBook.has(q.id)))
  if (unresolvedWrong.length > 0) {
    reasons.push(`${unresolvedWrong.length} 题待老师拍板是否入错题本`)
  }

  return {
    canAuto: reasons.length === 0,
    reasons,
    unjudgedCount: unjudged.length,
    unresolvedWrongCount: unresolvedWrong.length
  }
}

/**
 * worker 批改收尾调用：满足条件则把 tasks.status 从 done 推进到 reviewed。
 *
 * 失败语义（铁律 #11）：内部 try-catch 只在这里做一层「不拖垮批改」的兜底，
 * **但必须打 error 日志**；自动复核失败不影响已批出的结果，卷仍在待复核列表里，
 * 老师点进去照常处理 —— 这与「静默丢弃」不同，是安全降级。
 *
 * @param {{ taskId: string, studentId?: string, generatedExamId?: string|null }} params
 * @returns {Promise<{ autoReviewed: boolean, reasons?: string[] }>}
 */
export const maybeAutoReviewTask = async ({ taskId, generatedExamId = null }) => {
  if (!taskId || !enabled()) return { autoReviewed: false, reasons: ['已关闭'] }

  try {
    const { rows: taskRows } = await query(
      `SELECT id, status, student_id, generated_exam_id, result
       FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const task = taskRows[0]
    if (!task) return { autoReviewed: false, reasons: ['任务不存在'] }
    // 只接管「结果已出、老师未点」的卷：其余状态（failed/processing/reviewed）一律不动
    if (task.status !== 'done') return { autoReviewed: false, reasons: [`status=${task.status} 不接管`] }

    const examId = generatedExamId || task.generated_exam_id || null
    const questions = await loadTaskQuestionRows({ taskId, generatedExamId: examId })
    if (questions.length === 0) return { autoReviewed: false, reasons: ['无题目行'] }

    const { rows: wqRows } = await query(
      `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS}
       WHERE student_id = $1 AND question_id = ANY($2::uuid[])`,
      [task.student_id, questions.map(q => q.id)]
    )
    const decision = resolveAutoReviewDecision({
      questions,
      wrongQuestionIds: new Set(wqRows.map(r => r.question_id))
    })
    if (!decision.canAuto) return { autoReviewed: false, reasons: decision.reasons }

    // 与老师点「完成复核」等价的最小写入：只翻状态 + 打自动复核标记。
    // 统计（questionCount/wrongCount/...）在上一步 DONE 时刚按同源口径写过，无需重算。
    await query(
      `UPDATE ${TABLES.TASKS}
       SET status = 'reviewed',
           result = COALESCE(result, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2 AND status = 'done'`,
      [JSON.stringify({
        [AUTO_REVIEW_FLAG]: true,
        autoReviewedAt: new Date().toISOString()
      }), taskId]
    )
    console.log(
      `🤖 [AutoReview] 零人工项，已自动完成复核: task=${String(taskId).slice(0, 8)} ` +
      `题${questions.length} exam=${examId ? String(examId).slice(0, 8) : '-'}`
    )
    return { autoReviewed: true, reasons: [] }
  } catch (e) {
    console.error(`🤖 [AutoReview] 自动复核失败（卷仍在待复核列表，老师可正常处理）: task=${String(taskId).slice(0, 8)}`, e.message)
    return { autoReviewed: false, reasons: [e.message] }
  }
}
