// 题库列表「同一道题的多个小问之间怎么显示」的判据（2026-11-06）
//
// 背景：`resource_questions` 里同一道题的每个小问都是**独立一行**，每行都要能单独组卷，
// 所以 parent_stem 逐行冗余、配图也逐行存。列表按行渲染就必然出现「同一段材料印 N 遍、
// 同一张图贴 N 张」。负责人两次报障（徐汇一模 20 的「三张表格」、嘉定一模 22(2) 的
// 「正文当配图」）都出在这个形态上。
//
// 三种去重都只比**紧邻的上一行**：
//   · 筛选/搜索把同组打散时，每组第一条仍然完整显示（不会被隔空隐藏）；
//   · 不同题的行永远互不影响。
//
// ⛔ 判据只能放在这里（前后端口径唯一），页面里禁止再写一份。

const normText = (s) => String(s || '').replace(/\s+/g, '')

// 同一道题：同卷 + 同题号。小问号不参与比较（同一道题的 (1)(2) 就是一组）。
export function sameQuestionGroup(a, b) {
  if (!a || !b) return false
  return String(a.resource_id) === String(b.resource_id) && String(a.question_no) === String(b.question_no)
}

// 题干：同一道题只在**第一条**显示。
// 题干不同的（不同题/不同材料）一律照显。
export function showStem(rows, i) {
  const q = rows[i]
  if (!q || !q.parent_stem) return false
  const prev = i > 0 ? rows[i - 1] : null
  if (!prev || prev.parent_stem !== q.parent_stem) return true
  return !sameQuestionGroup(prev, q)
}

// 正文：整题行的 content 常常是 parent_stem 又抄了一遍（OCR 行为，嘉定一模 22 实测），
// 卡片上就变成同一段材料印两遍。逐字相同（忽略空白）时只留题干，不显示正文。
export function bodyText(q) {
  const c = String(q?.content || '')
  if (!c || !q?.parent_stem) return c
  return normText(c) === normText(q.parent_stem) ? '' : c
}

// 配图：同一道题的多个小问裁出来常常是**字节完全相同**的一张图，各自上传成不同 URL。
// 服务端已改成「同一份字节只上传一次」⇒ 同组多行共用同一个 image_url；
// 页面据此只显示一次，避免同一幅图连贴 N 张。
// ⛔ 只按 image_url 逐字比较：URL 不同就当不同的图（宁可多显示，不能把真图藏掉）。
export function showFigure(rows, i) {
  const q = rows[i]
  if (!q || !q.image_url) return false
  const prev = i > 0 ? rows[i - 1] : null
  if (!prev || !prev.image_url) return true
  if (prev.image_url !== q.image_url) return true
  return !sameQuestionGroup(prev, q)
}
