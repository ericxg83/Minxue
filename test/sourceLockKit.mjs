/**
 * 源码级回归锁的「防静默失效」工具（r167）
 *
 * 为什么需要它（本仓真实踩过的坑）：
 *   源码锁最常见的写法是先找锚点再断言：
 *     const i = src.indexOf('xxx')
 *     if (i >= 0 && !src.slice(i, i + 300).includes('Toast.show')) fails.push('...')
 *   一旦锚点字符串被改名 / 移动 / 删除，`i` 变成 -1，`i >= 0 &&` 直接短路 ⇒
 *   **不报错**。也就是说：**把代码改坏的那次重构，会顺手把盯着它的锁一起关掉**，
 *   门禁变成「看着是绿的，其实什么都没查」。
 *
 * 用法（fail-closed）：
 *   const seg = anchoredSlice(app, "console.error('初始化失败:', error)", 300, LABEL, fails)
 *   if (seg !== null && !seg.includes('Toast.show')) fails.push(LABEL)
 *   —— 锚点不在时 anchoredSlice 已经往 fails 里记了一条，调用方不必再兜。
 *
 * 元判据：`test/sourceLockFailClosed.test.mjs` 会扫描 test/ 全量，
 * 禁止「indexOf 派生变量被 >= 0 / .length > 0 守卫」这种会静默失效的写法。
 */

/** 锚点不在时的统一失败文案：把「为什么红」写清楚，别让人误以为产品坏了。 */
function missing(label, needle, kind) {
  return `${label}：${kind}锚点不在（${JSON.stringify(needle)}）——源码改过请先同步本锁，别让它静默失效`
}

/**
 * 从 `needle` 起切 `span` 个字符。锚点不在 ⇒ 记一条失败并返回 null（fail-closed）。
 * @returns {string|null} 片段；null 表示锚点缺失（已记失败）
 */
export function anchoredSlice(src, needle, span, label, fails) {
  const i = src.indexOf(needle)
  if (i < 0) {
    fails.push(missing(label, needle, ''))
    return null
  }
  return src.slice(i, i + span)
}

/**
 * 切 `fromNeedle` .. `toNeedle` 之间的区间（左闭右开）。任一锚点不在或顺序颠倒
 * ⇒ 记失败并返回 null（fail-closed）。用于替代
 * `src.slice(src.indexOf(a), src.indexOf(b))` —— 后者在 a 缺失时会切出
 * 一段无意义的文本（甚至把后半篇都算进来），断言照样可能通过。
 * @returns {string|null}
 */
export function anchoredRange(src, fromNeedle, toNeedle, label, fails) {
  const a = src.indexOf(fromNeedle)
  if (a < 0) {
    fails.push(missing(label, fromNeedle, '起点'))
    return null
  }
  const b = src.indexOf(toNeedle)
  if (b < 0) {
    fails.push(missing(label, toNeedle, '终点'))
    return null
  }
  if (b <= a) {
    fails.push(`${label}：终点锚点（${JSON.stringify(toNeedle)}）不在起点（${JSON.stringify(fromNeedle)}）之后——锁的切片窗口已失效`)
    return null
  }
  return src.slice(a, b)
}
