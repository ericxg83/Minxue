/**
 * questionResultCaliber · 单题结果归类口径（服务端统计场景）
 *
 * 唯一真相是 `src/utils/reviewDecision.js` 的 `effectiveIsCorrect`（**人工复核优先**，
 * 结算 `gradeGeneratedExam` 也用同一套）。本文件是它在「按卷统计正确/错误/未判定」
 * 这一场景的对应实现，`test/retryExamScoreCaliber.test.mjs` 用同一批用例锁死两者不漂移。
 *
 * 背景（2026-09-14 全库对账实测）：
 *   `/generated-exams/student/:id` 的 correct_count / wrong_count 原先只数
 *   `questions.is_correct`，**完全无视 `review_status`** ⇒ 老师在 PC 复核台改判的结果
 *   不会体现在家长看到的分数上。7 份已批改的卷实测 **6 份两套口径不一致**
 *   （余晨瑞 10对/3错 vs 12对/5错；范梓琪 8对/2错 vs 4对/8错；朱思诺 2对/6错 vs 3对/8错）。
 *   典型分歧行：`is_correct=true` + `review_status='wrong'`（老师翻案判错，家长仍看到"对"）。
 *
 * 与前端**完全同源**，无例外：
 *   归类结果与 `effectiveIsCorrect` 一一对应（true→correct / false→wrong / null→unjudged），
 *   `test/retryExamScoreCaliber.test.mjs` 对 30 种组合逐项断言相等。
 *   注意：学生未作答（`answer_source='blank'`）在这里算**错**，不算"未判定" ——
 *   「未作答等同不会」是本项目既定统计口径（weeklyReport 的 wrong 计数直接含 blank，
 *   结算也按判错推进错题本）。展示层如需区分，用 6 态（blank 是独立终态），不要在这里打折。
 */

export const RESULT_BUCKET = Object.freeze({
  CORRECT: 'correct',
  WRONG: 'wrong',
  UNJUDGED: 'unjudged',
})

/**
 * SQL 侧的同源表达式（供 weeklyReport 等无法走 JS 归类的聚合查询使用）。
 * **与 classifyQuestionResult 的分支一一对应**，改动任一侧必须同步另一侧并跑
 * `test/retryExamScoreCaliber.test.mjs`（该测试会做源码级断言，防止 SQL 悄悄退回只看 is_correct）。
 * 表达式自带括号，可直接嵌进 `COUNT(*) FILTER (WHERE …)` 等需要布尔值的上下文。
 *
 * @param {string} alias 列前缀（如 'q.'），裸查询传 ''
 * @returns {string} 已加括号的布尔 SQL 片段
 */
const resultExpr = (kind, alias) => {
  const p = alias ? String(alias).replace(/\.$/, '') + '.' : ''
  if (kind === 'correct') {
    return `((${p}review_status = 'correct') OR (${p}review_status IS NULL AND ${p}is_correct IS TRUE))`
  }
  if (kind === 'wrong') {
    return `((${p}review_status IN ('wrong', 'wrong_no_book')) OR (${p}review_status IS NULL AND ${p}is_correct IS FALSE))`
  }
  // unjudged = 排除 或（无人工结论且 AI 也没结论）
  return `((${p}review_status = 'exclude') OR (${p}review_status IS NULL AND ${p}is_correct IS NULL))`
}

/** SQL：算"正确"的布尔片段（人工复核优先） */
export const sqlCorrectExpr = (alias = '') => resultExpr('correct', alias)
/** SQL：算"错误"的布尔片段（人工复核优先；未作答等同不会，见文件头） */
export const sqlWrongExpr = (alias = '') => resultExpr('wrong', alias)
/** SQL：算"未判定"的布尔片段 */
export const sqlUnjudgedExpr = (alias = '') => resultExpr('unjudged', alias)

/**
 * 单题归类：人工复核结论 > AI 判定 > 未判定
 * @param {{review_status?:string|null, is_correct?:boolean|null, answer_source?:string|null}} q
 * @returns {'correct'|'wrong'|'unjudged'}
 */
export function classifyQuestionResult(q) {
  if (!q) return RESULT_BUCKET.UNJUDGED

  // ① 人工复核结论优先（与 effectiveIsCorrect 一致）
  if (q.review_status === 'correct') return RESULT_BUCKET.CORRECT
  if (q.review_status === 'wrong' || q.review_status === 'wrong_no_book') return RESULT_BUCKET.WRONG
  if (q.review_status === 'exclude') return RESULT_BUCKET.UNJUDGED

  // ② 无人工结论：看 AI 判定（未作答 is_correct=false 也算错，见文件头口径说明）
  if (q.is_correct === true) return RESULT_BUCKET.CORRECT
  if (q.is_correct === false) return RESULT_BUCKET.WRONG
  return RESULT_BUCKET.UNJUDGED
}

/**
 * 汇总一卷的题目行。
 * 注意 `unjudged` **包含** `excluded`（排除题既不进正确也不进错误，但单独计数留痕）。
 */
export function summarizeQuestionResults(list) {
  const counts = { correct: 0, wrong: 0, unjudged: 0, excluded: 0 }
  const rows = Array.isArray(list) ? list : []
  for (const q of rows) {
    if (q?.review_status === 'exclude') counts.excluded++
    counts[classifyQuestionResult(q)]++
  }
  return { total: rows.length, ...counts }
}
