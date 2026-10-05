/**
 * 回归锁：重练卷抬头/文件名里的日期必须是「本地日历日」（r155，2026-10-05）
 *
 * 家长与老师都看得见这个名字，一处三用：
 *   ① generated_exams.name —— 老师工作台错题中心直接看到
 *   ② PDF 抬头 .title      —— 打给孩子/交给家长的那一页卷子
 *   ③ 下载文件名 xxx.pdf
 *
 * ⛔ 起因（r148 时区类的最后一处漏网）：
 *   旧实现 `new Date().toISOString().slice(0, 10)` 印的是 **UTC 日**。
 *   生产容器跑在 UTC+8，本地 00:00~08:00 这段时间里 UTC 还是**前一天**，
 *   于是早上导出的重练卷抬头会写昨天 —— 孩子、家长、老师三边看到的都是错的。
 *
 * 判据设计（防「假绿」）：
 *   - **真跑**，不 grep 源码：`buildRetryExamName` 是纯函数，直接喂注入时刻断言字符串。
 *   - 用两个**与本机时区无关**的时刻做判别（下面 SH_INSTANT_* 由人工手算）：
 *     · 2026-10-04T17:00:00Z = 上海 2026-10-05 01:00 ⇒ 期望 2026-10-05（UTC 会给 10-04）
 *     · 2026-10-05T16:00:00Z = 上海 2026-10-06 00:00 ⇒ 期望 2026-10-06（UTC 会给 10-05）
 *     只要改回旧写法，这两条立刻判红，与跑测试的机器时区无关。
 *   - **反向自检**：同一套判据喂旧实现（内联 legacy 函数）必须判红；
 *     并且额外校验「新旧输出确实不同」，避免判据自始至终都碰巧相等。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildRetryExamName } = await import('../server/services/wrongRetryPdfService.js')

/** 人工手算的判别时刻：UTC 日 ≠ 上海日历日 */
const SH_INSTANT_MORNING = new Date('2026-10-04T17:00:00Z') // 上海 10-05 01:00，UTC 日 = 10-04
const SH_INSTANT_MIDNIGHT = new Date('2026-10-05T16:00:00Z') // 上海 10-06 00:00，UTC 日 = 10-05
const SAME_DAY_INSTANT = new Date('2026-10-08T02:00:00Z') // 上海 10-08 10:00，两边同日（防误伤用）

/** 旧实现的等价写法（r155 之前的代码），只用于反向自检 */
const legacyExamName = (studentName, at) => `${studentName}错题重练-${at.toISOString().slice(0, 10)}`

test('重练卷抬头按上海日历日印日期，早上导出不会写成昨天', () => {
  assert.equal(buildRetryExamName('虞晨熙', SH_INSTANT_MORNING), '虞晨熙错题重练-2026-10-05')
  assert.equal(buildRetryExamName('虞晨熙', SH_INSTANT_MIDNIGHT), '虞晨熙错题重练-2026-10-06')
})

test('日期与 UTC 日一致的时刻不受影响（不误伤正确情况）', () => {
  assert.equal(buildRetryExamName('虞晨熙', SAME_DAY_INSTANT), '虞晨熙错题重练-2026-10-08')
})

test('返回形状稳定：学生名 + 错题重练 + YYYY-MM-DD，不做额外装饰', () => {
  const name = buildRetryExamName('陆晨曦', SH_INSTANT_MORNING)
  assert.match(name, /^陆晨曦错题重练-\d{4}-\d{2}-\d{2}$/)
  // 末尾日期必须是完整日历日，不能是 "2026-10" 之类被截断的串
  assert.ok(name.endsWith('-05'), `期望以 2026-10-05 结尾，实际 ${name}`)
})

test('反向自检：旧实现（UTC 日）在同样的判别时刻必判红', () => {
  assert.notEqual(legacyExamName('虞晨熙', SH_INSTANT_MORNING), '虞晨熙错题重练-2026-10-05')
  assert.notEqual(legacyExamName('虞晨熙', SH_INSTANT_MIDNIGHT), '虞晨熙错题重练-2026-10-06')
})

test('反向自检：新旧实现确实能区分（判据不是自始至终碰巧相等）', () => {
  const oldNames = [SH_INSTANT_MORNING, SH_INSTANT_MIDNIGHT, SAME_DAY_INSTANT]
    .map((at) => legacyExamName('虞晨熙', at))
  const newNames = [SH_INSTANT_MORNING, SH_INSTANT_MIDNIGHT, SAME_DAY_INSTANT]
    .map((at) => buildRetryExamName('虞晨熙', at))
  assert.equal(new Set(newNames).size, 3, '三个时刻的新输出应各不相同')
  assert.notDeepEqual(newNames, oldNames)
})
