/**
 * 回归锁：周期「排他边界 → 对外展示的最后一天」必须用时区安全算法（r266，2026-10-12）
 *
 * 起因（生产实测，非推理）：GET /api/weekly-report/:id?mode=week（2026-10-12 周一）返回
 *   period = { start: "2026-10-12", end: "2026-10-19" } —— 把下周一也印了进去。
 *   家长分享卡 / 周报 / PDF 全部消费这个字段（「学习周期 10/12 ~ 10/19」）。
 *
 * 根因：周期边界由 getWeekRange/getPeriodRange 的 `new Date(y, m, d)` 按**服务器本地时区**
 *   算（Render 容器 TZ=UTC ⇒ 边界是 UTC 零点），而 toLocalYmd 固定按 Asia/Shanghai(+8)
 *   格式化 ⇒ 旧写法 `toLocalYmd(new Date(periodEnd.getTime() - 1))` 的「减 1ms」在 UTC
 *   服务器上被 +8h 格式化完全抵消（10/18 23:59:59.999 UTC + 8h = 10/19 07:59 上海）。
 *   旧写法只在 UTC+8 的开发机上碰巧正确。
 *
 * 修法：exclusiveEndYmd() —— 先取边界的上海日历日，再在日历日字符串上减一天。
 *   UTC 服务器与 +8 开发机输出逐字一致且都正确。
 *
 * 判据纪律：
 *   - 全部用**绝对时刻**当输入（Intl 固定 Shanghai，与跑测试的机器时区无关）；
 *     ⛔ 不用 `new Date(y, m, d)` 造输入 —— 那会随机器时区变，测试在 UTC CI 上会翻车。
 *   - 反向自检内嵌在测试里：同一边界时刻，旧写法必须印出错值 —— 谁把调用点改回旧写法，
 *     这里的「旧写法」断言虽绿，但 exclusiveEndYmd 断言会红（helper 被删时 import 直接炸）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
readFileSync(resolve(ROOT, 'server/utils/period.js'), 'utf8')

const { shiftYmd, exclusiveEndYmd, toLocalYmd } = await import('../server/utils/period.js')

/** 旧写法（r266 之前的实现），只在本测试里当「坏基线」用 */
const oldExclusiveEndYmd = (boundary) => toLocalYmd(new Date(boundary.getTime() - 1))

test('✅ shiftYmd 同月平移', () => {
  assert.equal(shiftYmd('2026-10-19', -1), '2026-10-18')
  assert.equal(shiftYmd('2026-10-01', -1), '2026-09-30')
})

test('✅ shiftYmd 跨年与闰年 2 月', () => {
  assert.equal(shiftYmd('2027-01-01', -1), '2026-12-31')
  assert.equal(shiftYmd('2024-03-01', -1), '2024-02-29') // 闰年
  assert.equal(shiftYmd('2026-03-01', -1), '2026-02-28') // 平年
})

test('✅ shiftYmd 非法输入原样返回（不抛错）', () => {
  assert.equal(shiftYmd('', -1), '')
  assert.equal(shiftYmd(null, -1), '')
  assert.equal(shiftYmd('2099-12-31(哨兵)', -1), '2099-12-31(哨兵)')
})

test('⛔ Render 场景（UTC 零点边界）：周模式必须印「最后一天」而不是下周一', () => {
  // 生产实测日：2026-10-12（周一），排他边界 = 2026-10-19T00:00:00Z（UTC 容器算出的零点）
  const boundary = new Date('2026-10-19T00:00:00Z')
  assert.equal(exclusiveEndYmd(boundary), '2026-10-18', '新算法必须印周期最后一天 10/18')
  assert.equal(oldExclusiveEndYmd(boundary), '2026-10-19', '旧写法在同一边界上确实印成下周一（坏基线锚点）')
})

test('⛔ Render 场景：月模式必须印 10/31 而不是 11/01', () => {
  const boundary = new Date('2026-11-01T00:00:00Z')
  assert.equal(exclusiveEndYmd(boundary), '2026-10-31')
  assert.equal(oldExclusiveEndYmd(boundary), '2026-11-01')
})

test('✅ 行为保持：+8 机器（上海零点边界）上新旧写法逐字一致', () => {
  // 开发机 TZ=Asia/Shanghai 时 getWeekRange 造出的边界是上海零点 ⇒ 作为绝对时刻即 16:00Z
  const boundaryOnPlus8 = new Date('2026-10-19T00:00:00+08:00')
  assert.equal(exclusiveEndYmd(boundaryOnPlus8), '2026-10-18')
  assert.equal(
    exclusiveEndYmd(boundaryOnPlus8),
    oldExclusiveEndYmd(boundaryOnPlus8),
    '新算法在 +8 环境必须与旧写法同值（本次修复只改 UTC 服务器的错值，不动开发机行为）'
  )
})

test('✅ 周报调用点确实换用了 exclusiveEndYmd（防只加 helper 不接线）', () => {
  const wr = readFileSync(resolve(ROOT, 'server/routes/weeklyReport.js'), 'utf8')
  const teaching = readFileSync(resolve(ROOT, 'server/routes/teaching.js'), 'utf8')
  assert.equal((wr.match(/exclusiveEndYmd\(periodEnd\)/g) || []).length, 3, 'weeklyReport.js 应有 3 处调用')
  assert.equal((teaching.match(/exclusiveEndYmd\(periodEnd\)/g) || []).length, 1, 'teaching.js 应有 1 处调用')
  // 去掉 // 注释行再查旧写法 —— 注释里引用旧写法作解释是允许的，代码里残留才是红
  const stripComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  assert.equal(
    /toLocalYmd\(new Date\(periodEnd\.getTime\(\) - 1\)\)/.test(stripComments(wr) + stripComments(teaching)),
    false,
    '旧「减 1ms」写法必须从两个路由的代码里清干净'
  )
})
