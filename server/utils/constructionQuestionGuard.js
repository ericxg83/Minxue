/**
 * 作图题「跳过视觉求解」预判闸（2026-09-25 修正定稿）
 *
 * ── 演进（诚实记录一次纠偏）──
 * 2026-09-24 首版把「证明/作图/主观题」一起拦，理由是「无唯一可自动核对答案」。
 * 2026-09-25 用户指出：证明题也能拿到答案 —— 一语中的。原理由混淆了两件事：
 *   · 判对错（自动判分）：证明/作文确实判不了，必须人工 —— 但这条由 judgeAnswer
 *     对「证明：…/整段解答」自动返回 null 兜住，与是否生成参考答案无关；
 *   · 生成参考答案：模型**能**写出证明过程 / 范文作为可参考的解答文本，对老师有价值。
 * 「不能自动判分」≠「不该生成参考答案」。⇒ 证明 / 作文 / 解答类**一律放行**走视觉。
 *
 * ── 只保留：纯作图题 ──
 * 唯一仍拦的是「作图题」：题面常写「保留作图痕迹，不写作法」，答案本质是**画在纸面上的
 * 一张图形**（如「用无刻度直尺作线段 BC 的三等分点」），AI 给不出可核对的文字参考，
 * 视觉读图实测也是长时间推理后回「待人工补充」（单题 ~147s），白烧超时预算与额度。
 *
 * ── 判据（高精准，宁可漏拦不误伤可算题）──
 *   ① 题型 = drawing → 直接判作图题；
 *   ② answer 型：题干命中作图强特征词（保留作图痕迹 / 不写作法 / 无刻度 / 尺规作图 /
 *      作出…平分线/垂线/对称图形 / 在图中画出），且**不含**可核对计算小问 → 判作图题；
 *      含可算小问的混合题（如「求 m=__ 并画图」）放行，让视觉尝试可算部分。
 *
 * ── 安全性 ──
 * · 只在**带配图**（会走视觉）时由调用方触发，纯文字题行为零变化；
 * · 跳过时不写 answer（保持为空），但写 answer_exception_reason 说明原因，避免「静默空」；
 * · **非终态**：老师仍可人工判定；开关 `ANSWER_CONSTRUCTION_SKIP=0` 可整体关闭本闸。
 */

// 明确「答案是一张画出来的图」的题型
const CONSTRUCTION_TYPES = new Set(['drawing'])

// 作图题强特征词：这些几乎只出现在「画在图上、不写作法」类题里，不会误伤证明/计算题
const CONSTRUCTION_RE =
  /保留作图痕迹|不写作法|无刻度|尺规作图|请作图|作出.{0,8}(平分线|垂直平分线|垂线|对称图形|高线|中线)|在图中画出/

// 含可核对计算小问的信号：命中 = 至少部分可算 → 按「宁可漏拦不误伤」放行
const COMPUTABLE_HINT_RE = /_{2,}|求(?!证)|计算|直接写出|填空|填一填|[＝=]\s*[_？?]/

export const CONSTRUCTION_MANUAL_REASON =
  '本题为作图题，答案是画在图中的图形，AI 无法给出可核对的文字参考答案，需人工判定'

/** 开关：默认开启，显式设 0 关闭本闸（回退用） */
export function isConstructionSkipEnabled() {
  return String(process.env.ANSWER_CONSTRUCTION_SKIP ?? '1') !== '0'
}

/**
 * 是否为「答案是画在图上的一张图形、AI 给不出可核对文字参考」的作图题。
 * ⚠️ 证明 / 作文 / 解答类**不算**（它们能产出可参考的解答文本，应放行走视觉）。
 * @param {Object} q 题目对象（需含 question_type / parent_stem / content）
 * @returns {boolean}
 */
export function isConstructionQuestion(q) {
  if (!q) return false
  if (!isConstructionSkipEnabled()) return false
  const type = String(q.question_type || '').toLowerCase()
  if (CONSTRUCTION_TYPES.has(type)) return true
  // 只对 answer（解答题）混合桶看题干；其余题型（choice/fill/judge…）不拦
  if (type !== 'answer') return false
  const stem = `${q.parent_stem || ''}\n${q.content || ''}`
  if (!CONSTRUCTION_RE.test(stem)) return false
  // 混合题：题干含可核对的计算小问 → 不拦，让视觉尝试可算部分
  if (COMPUTABLE_HINT_RE.test(stem)) return false
  return true
}
