/**
 * 答案引擎「缺配图预判闸」（2026-09-24）
 *
 * ── 要解决的问题（用户 2026-09-24 明确要求）──
 * 「如果题目说有图，但缺图，那应该停止解析，纯属浪费 token 和时间。」
 *
 * ── 实测依据（2026-09-24 全库 2586 题）──
 * `answer` 为空且 `analysis` 非空的 128 条里，120 条的解析结论是
 * 「待人工补充 / 无法唯一确定」。其中 25 条是「题干明示引图（如图①②③ / 数轴 /
 * 统计图 / 函数图象）但 `geometry_image_url` 为空」——答案引擎只拿到文字题干，
 * 实测 100% 答「待人工补充」：既拿不到答案，又白耗额度与 10~150s 等待。
 *
 * ── 判据（两个条件同时成立才拦）──
 *   ① `hasFigureReference(q)` —— 与 `checkQuestionCompleteness` 规则1 **同源**
 *      （`utils/questionCompleteness.js`，判定文本含 `parent_stem`，绝不自写正则）；
 *   ② 本题确实没有配图（`geometry_image_url` 为空）。
 *
 * ── 安全性 ──
 * · 只跳过 AI 解析，**不写 answer**（保持为空，与「宁可留空不猜」口径一致）；
 * · 必须写 `answer_exception_reason` 说明原因，避免「静默空」不可归因（见 MEMORY §7）；
 * · **不是终态**：补上配图后（补裁脚本 / `PUT /api/questions/:id` / 重跑批改）会重新求解；
 * · 开关 `ANSWER_FIGURE_PREFLIGHT_SKIP=0` 可整体关闭本闸（回退用）。
 */
import { hasFigureReference } from './questionCompleteness.js'

export const MISSING_FIGURE_SKIP_REASON =
  '题干要求配图但本题未采集到配图，已跳过 AI 解析（补图后可重算）'

/** 开关：默认开启，显式设 0 关闭 */
export function isFigurePreflightSkipEnabled() {
  return String(process.env.ANSWER_FIGURE_PREFLIGHT_SKIP ?? '1') !== '0'
}

/**
 * @param {Object} q 题目对象（需含 parent_stem / content）
 * @param {string|null|undefined} geometryImageUrl 本题真实配图 URL（由调用方从 DB 取，避免依赖内存字段）
 * @returns {{ skip: boolean, reason?: string }}
 */
export function shouldSkipForMissingFigure(q, geometryImageUrl) {
  if (!q) return { skip: false }
  if (!isFigurePreflightSkipEnabled()) return { skip: false }
  // 配图已存在 → 正常解析
  if (geometryImageUrl && String(geometryImageUrl).trim()) return { skip: false }
  // 题面不引图 → 正常解析（纯文字题可能靠文字解出）
  if (!hasFigureReference(q)) return { skip: false }
  return { skip: true, reason: MISSING_FIGURE_SKIP_REASON }
}
