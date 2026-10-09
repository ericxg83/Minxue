/**
 * pendingReviewService · 「还有几份卷子等老师复核」的服务端计数（2026-10-09）
 *
 * 背景：首页 KPI「待复核」原先直接读 `/api/tasks/summary` 的 `pendingReview`，
 * 那是**未读通知数**（`notification_read_at IS NULL`），点一次铃铛就归零，
 * 与批改中心「待人工复核」的卡片数对不上（首页 1 vs 批改中心 7）。
 * 详见 `src/workbench/utils/pendingReviewCaliber.js` 文件头。
 *
 * 本服务只做一件事：把数据库里的原始行取出来，交给**前后端共用的唯一口径**去数。
 * ⛔ 判据一律在 `src/workbench/utils/pendingReviewCaliber.js`，这里不重写任何一条。
 */
import { query, TABLES } from '../config/neon.js'
import { describeAutoRetry } from '../pendingTaskRecovery.js'
import { summarizeQuestionResults } from '../utils/questionResultCaliber.js'
import { countPendingReviewPapers } from '../../src/workbench/utils/pendingReviewCaliber.js'

/**
 * 取「待人工复核卷数」。
 * 三条查询：全部未删任务 / 全部重练卷 / 重练卷涉及题目的判定结果。
 * （与 `/api/generated-exams/student/:id` 的统计同源，走 questionResultCaliber。）
 *
 * @returns {Promise<number>}
 */
export async function getPendingReviewPaperCount() {
  const [taskRes, examRes] = await Promise.all([
    query(
      `SELECT id, student_id, status, task_type, generated_exam_id,
              last_error, retry_count, created_at, updated_at
       FROM ${TABLES.TASKS} WHERE deleted_at IS NULL`
    ),
    query(
      `SELECT id, student_id, status, question_ids FROM ${TABLES.GENERATED_EXAMS}`
    )
  ])

  // 「系统还会不会自己救回来」由服务端唯一实现 describeAutoRetry 判定，
  // 随行下发（与 /api/tasks/student/:id 的 auto_retry 完全同一口径）。
  const tasks = taskRes.rows.map((row) => ({ ...row, auto_retry: describeAutoRetry(row) }))
  const exams = examRes.rows

  // 未判定题数：口径 = server/utils/questionResultCaliber.js（人工复核优先），
  // 与移动端分数、批改中心 retry() 用的 exam.not_answered_count 同源。
  const unjudgedByExam = new Map()
  const qIds = [...new Set(exams.flatMap((e) => e.question_ids || []))]
  if (qIds.length > 0) {
    const placeholders = qIds.map((_, i) => `$${i + 1}`).join(',')
    const { rows: qRows } = await query(
      `SELECT id, is_correct, answer_source, review_status
       FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
      qIds
    )
    const byId = new Map(qRows.map((q) => [q.id, q]))
    for (const exam of exams) {
      const summary = summarizeQuestionResults((exam.question_ids || []).map((id) => byId.get(id)))
      unjudgedByExam.set(exam.id, summary.unjudged)
    }
  }

  return countPendingReviewPapers({ tasks, exams, unjudgedByExam })
}
