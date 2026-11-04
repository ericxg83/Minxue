/**
 * questionListOrder.js — 题目列表按「题单顺序」归一（2026-11-04）
 *
 * 【为什么必须有】
 * `/api/questions/batch` 是 `WHERE id = ANY($1)`，PostgreSQL **不保证返回顺序**。
 * 而重练卷的卷面编号靠 `buildRetryPaperOrder` 的「同组相邻 ⇒ 连排共号」判定，
 * 判题侧 `alignRetryAnswers` 又按题单原序做位置兜底 —— 一旦批量接口把同组小问
 * 打散，卷面会把 (1)(3)(2) 印成三个独立题号，判题也随之错位。
 *
 * 所以「按 id 列表拿到题」之后，必须过一次本函数再交给渲染/排卷。
 * 纯函数，无副作用；未知 id（取不到行）排到末尾，保持原相对顺序。
 */
export function orderQuestionsByIds(questions, ids) {
  const list = Array.isArray(questions) ? questions.filter(Boolean) : []
  if (list.length <= 1) return list
  const rank = new Map()
  for (const [i, id] of (Array.isArray(ids) ? ids : []).entries()) {
    const key = String(id)
    if (!rank.has(key)) rank.set(key, i)
  }
  if (rank.size === 0) return list
  return list
    .map((q, i) => ({ q, i, r: rank.has(String(q.id)) ? rank.get(String(q.id)) : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.q)
}
