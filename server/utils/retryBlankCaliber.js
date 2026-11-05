/**
 * retryBlankCaliber · 重练卷空题「落库判定」唯一口径（2026-11-05）
 *
 * 事故背景：负责人 11-05 报「陈昊煜重练卷很多题空着没做，批改中心还是显示 AI 判定为错误」。
 *   11-04 的新口径（e5a1ae5）只改了**结算层**：notAttempted ⇒ skip（不计 error_count、
 *   不动档位、留册）。但重练卷 slim 判题管线（worker.js processSlimGrading）的
 *   「学生未作答」分支仍然 `results.push({ isCorrect: false, reason:'blank' })`，
 *   落库时把 questions.is_correct 写成 false。于是同一行同时带着两个互斥信号：
 *     answer_source='blank'（未作答）+ is_correct=false（AI 判错）。
 *   6 态虽然 blank 优先显示「未作答」，但批改中心卷面定位框（PaperViewerPanel）
 *   直接读 is_correct===false 画红叉，isWrongResult / 错题门禁也把空题当判错。
 *   11-04 12:1x 的全局脚本只清了历史 184 条**存量**，14:16 这份卷重新批改又把
 *   19 条写了回来 —— 只清数据不修源头，红叉会反复再生。
 *
 * 与主 OCR 管线对齐：judgeAnswer 对学生答案为空返回 `isCorrect: null`
 * （server/services/judgeService.js），主作业的空题从来不写 false。
 * 「未作答」只由 answer_source='blank' 表达，is_correct 必须是 null（零信号）。
 *
 * ⚠️ 结算与落库是两件事，不要混：
 *   · 结算：空题仍以 `isCorrect:false + notAttempted:true` 进 finalize，
 *     由 decideRetrySettlementItem 判 skip('blank_not_attempted') 并留审计；
 *   · 落库：questions.is_correct 一律 null，供所有展示/统计/门禁链路读取。
 *   本模块管的是**落库值**，结算语义在 retrySettlementDecision.js。
 */

/** slim 判题管线里「学生未作答」结果的唯一 reason 值 */
export const RETRY_BLANK_REASON = 'blank'

/** 这条判定结果是不是「重练卷空题」 */
export const isRetryBlankResult = (result) => result?.reason === RETRY_BLANK_REASON

/**
 * 判定结果 → 写进 questions.is_correct 的值。
 * 空题恒为 null（未判定/零信号）；其余结果原样透传，判不出也归一为 null。
 * @param {{isCorrect?:boolean|null, reason?:string}|null} result
 * @returns {boolean|null}
 */
export function resolveRetryStoreIsCorrect(result) {
  if (isRetryBlankResult(result)) return null
  return result?.isCorrect ?? null
}
