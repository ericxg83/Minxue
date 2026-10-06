/**
 * 周期词（r212）——「这份材料讲的是哪段时间」的唯一口径。
 *
 * 为什么单独成一个模块：周报 PDF（`weeklyReportGenerator.js`）与移动端周报页
 * （`pages/WeeklyReport/index.jsx`）各自抄了一份同样的文案函数，**两处都要跟着 mode 走**。
 * 抄成两份的结果就是——改一处漏一处。这里只放一个纯函数，两边都 import 它。
 *
 * ⛔ 旧写法（两处一样）：
 *     const periodWord = mode === 'month' ? '本月' : '本周'
 *   —— 第三个分支把 `'all'`（全部时间）也当成了周。于是选「全部」时：
 *   封面印「学习周期：全部记录」、正文却到处写「本周」，同一份给家长的材料自相矛盾。
 *   （家长分享卡的同款缺陷已由 r211 在服务端修掉，这里是它的另一半。）
 *
 * 与 `server/services/shareCardTemplate.js` 的口径保持一致：
 *   month → 本月 ／ all → 这段时间 ／ 其他（week / 未知）→ 本周
 * 未知 mode 仍兜底「本周」：说窄了不算说错，与改动前的行为一致。
 *
 * @param {'week'|'month'|'all'|string} [mode]
 * @returns {string}
 */
export function periodWord(mode) {
  return mode === 'month' ? '本月' : mode === 'all' ? '这段时间' : '本周'
}
