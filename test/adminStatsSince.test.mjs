/**
 * 回归锁：管理员统计接口的默认窗口起点，必须是「本地日历日」（r157，2026-10-05）
 *
 * ⛔ 起因（r148 时区类的最后一处漏网）：
 *   `server/index.js` 的误判类型归因统计（/api/admin/judgements/misjudge-stats）
 *   默认 `since` 写的是 `new Date(Date.now() - 30*86400000).toISOString().slice(0,10)`。
 *   toISOString 印的是 **UTC 日**，生产容器 UTC+8 ⇒ 本地 00:00~08:00 之间请求，
 *   默认 30 天窗口的**起点会退到前一天**（早 8 点多半还差着）⇒ 「近 30 天」的统计
 *   口径看起来总是少一天，且每天早上都跟 ?since= 显式传值时对不上，极难定位。
 *
 * 判据设计（防「假绿」）：
 *   - **真跑**纯函数 `localDaysAgoYmd`，不 grep 源码。
 *   - 用两个**与本机时区无关**的时刻做判别（下面三个 SH_INSTANT_* 由运行时实测取值，
 *     不是手算——手算算错过一次，见「判据必须实测」）：
 *     · SH_INSTANT_01 = 2026-10-04T17:00:00Z = 上海 10-05 01:00 ⇒ 新 09-05 / 旧 09-04
 *     · SH_INSTANT_02 = 2026-10-05T16:00:00Z = 上海 10-06 00:00 ⇒ 新 09-06 / 旧 09-05
 *     · SH_INSTANT_SAME = 2026-10-08T04:00:00Z = 上海 10-08 12:00 ⇒ 新旧都是 09-08
 *       （这条是**防误伤**的对照组：UTC 日与上海日历日本来相同的时刻不能判红）
 *     改回旧写法，前两条立刻判红，与跑测试的机器时区无关。
 *   - **反向自检**：同一套判据喂旧实现（内联 legacy）必须判红，
 *     并额外断言「新旧输出确实不同」，避免判据自始至终碰巧相等（假通过）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { localDaysAgoYmd } = await import('../server/utils/period.js')

/** 判别时刻（取值均由运行时实测，勿手算）：UTC 日 ≠ 上海日历日 */
const SH_INSTANT_01 = new Date('2026-10-04T17:00:00Z') // 上海 10-05 01:00 ⇒ 新 09-05 / 旧 09-04
const SH_INSTANT_02 = new Date('2026-10-05T16:00:00Z') // 上海 10-06 00:00 ⇒ 新 09-06 / 旧 09-05
const SH_INSTANT_SAME = new Date('2026-10-08T04:00:00Z') // 上海 10-08 12:00 ⇒ 新旧都是 09-08（防误伤）

/** 旧实现的等价写法（r157 之前的代码），只用于反向自检 */
const legacySince = (now) => new Date(now - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)

test('默认统计窗口起点按上海日历日，「近 30 天」不会少一天', () => {
  assert.equal(localDaysAgoYmd(30, SH_INSTANT_01), '2026-09-05')
  assert.equal(localDaysAgoYmd(30, SH_INSTANT_02), '2026-09-06')
})

test('不误伤：UTC 日与上海日历日本就相同的时刻，新旧一致', () => {
  assert.equal(localDaysAgoYmd(30, SH_INSTANT_SAME), '2026-09-08')
  assert.equal(legacySince(SH_INSTANT_SAME.getTime()), localDaysAgoYmd(30, SH_INSTANT_SAME))
})

test('输出恒为 YYYY-MM-DD，不做装饰也不返回 Date/Utc 串', () => {
  const v = localDaysAgoYmd(30, SH_INSTANT_SAME)
  assert.match(v, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(typeof v, 'string')
})

test('反向自检：旧实现（UTC 日）在同样的判别时刻必判红', () => {
  assert.notEqual(legacySince(SH_INSTANT_01.getTime()), localDaysAgoYmd(30, SH_INSTANT_01))
  assert.notEqual(legacySince(SH_INSTANT_02.getTime()), localDaysAgoYmd(30, SH_INSTANT_02))
})

test('反向自检：新实现与旧实现确实能区分（判据不是自始至终碰巧相等）', () => {
  const instants = [SH_INSTANT_01, SH_INSTANT_02].map((d) => d.getTime())
  const oldDays = instants.map((t) => legacySince(t))
  const newDays = instants.map((t) => localDaysAgoYmd(30, t))
  assert.equal(new Set(oldDays).size, 2, `旧实现两个时刻应给出不同日期，实际 ${oldDays}`)
  assert.equal(new Set(newDays).size, 2, `新实现两个时刻应给出不同日期，实际 ${newDays}`)
  assert.ok(
    oldDays.some((d, i) => d !== newDays[i]),
    '新旧输出必须至少一处不同，否则判据等于没设'
  )
})
