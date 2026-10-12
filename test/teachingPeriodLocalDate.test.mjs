/**
 * r151 回归锁：`server/routes/teaching.js`（单生备课建议）的 period.start / period.end
 * 必须按**本地日历日**印，不能按 UTC 印。
 *
 * 真缺陷（实测取证，非推测）：teaching.js:67-68 原写法
 *   `periodStart.toISOString().split('T')[0]` / `periodEnd.toISOString().split('T')[0]`
 * toISOString 是 UTC，而周期边界由 `server/utils/period.js` 的 parsePeriod/getWeekRange
 * 用 `new Date(y, m, d)` 按**本地时区**算。UTC+8 的本地 00:00 换算成 UTC 会退到**前一天**：
 *   周模式：周一 10/05 印成周日 10/04（与工作台/移动端 dayjs isoWeek 算出的「10/05 ~ 10/11」自相矛盾）。
 * 生产容器 TZ=UTC 时新旧写法**恰好同值**（所以这个雷一直不炸），只有该端点跑在 UTC+8
 * 环境（本地/自建机）才会退回 r148 那个「差一天」缺陷 —— 这正是 r150 把它标成
 * 「潜在地雷」的原因，本轮按 A 级行为保持型缺陷修掉。
 * 修法与 `server/routes/weeklyReport.js`（r148 已修）完全同口径：
 *   start: toLocalYmd(periodStart)
 *   end:   exclusiveEndYmd(periodEnd)   // end 是排他边界，对外说「最后一天」
 *
 * r266 更新（2026-10-12）：旧「end = toLocalYmd(边界 − 1ms)」在 TZ=UTC 的生产容器上被
 *   +8h 格式化**抵消**（边界是 UTC 零点，减 1ms 后加 8 小时仍落在边界的上海日历日），
 *   会把下周一印进「学习周期」——r151 锁里「必须 −1ms」的判据因此**反转为禁止项**，
 *   end 必须走 period.js 的 exclusiveEndYmd（两种服务器时区下输出一致）。
 *
 * 判据同样分两层：① 真跑 toLocalYmd 的行为断言；② 源码锁住 teaching.js 不得回退。
 * ⛔ 行为断言一律用**带显式 +08:00 偏移**的日期构造 —— 若用 getWeekRange() 现算再断言，
 * 跑在 UTC 机器上旧写法也会「碰巧」判绿 = 空锁（r148 锁里已踩过这个坑）。
 * ⛔ 反向自检禁止 spawnSync 调 git（Windows EBUSY），改成在临时目录内联合成「修复前」坏样本。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { toLocalYmd, exclusiveEndYmd, getWeekRange } from '../server/utils/period.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 旧写法（= 本次修掉的 bug），只用于反向自检与「说明它为什么错」，生产代码不得再用 */
const oldUtcFmt = (d) => d.toISOString().split('T')[0]

/** 把 YYYY-MM-DD 当纯日历日问星期几（用 UTC 解析 ⇒ 与运行机器时区无关） */
const weekdayOf = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay()

// ─────────────────────────── ① 行为判据 ───────────────────────────

test('本地日历日格式化：UTC+8 的本地 00:00 不得被印成前一天', () => {
  const localMondayMidnight = new Date('2026-10-05T00:00:00+08:00') // 周一
  assert.equal(toLocalYmd(localMondayMidnight), '2026-10-05')
  assert.equal(oldUtcFmt(localMondayMidnight), '2026-10-04', '旧 UTC 写法应少一天（这就是 bug 本身）')
})

test('周期起点印出来必须是周一、终点必须落在本周期内（周模式，跨时区不变）', () => {
  const week = getWeekRange(0)
  // r266 起 teaching.js 与 weeklyReport 同口径走 exclusiveEndYmd
  const start = toLocalYmd(week.periodStart)
  const end = exclusiveEndYmd(week.periodEnd)
  assert.equal(weekdayOf(start), 1, '周模式周期起点必须是周一')
  assert.equal(weekdayOf(end), 0, '周模式周期最后一天（排他边界的上海日减一天）必须是周日')
  assert.notEqual(start, end, '起止不得印成同一天')
})

test('排他边界的上海日减一天仍落在本周期（UTC 服务器与 +8 机器都对）', () => {
  const exclusiveEnd = new Date('2026-10-12T00:00:00+08:00') // 下周一 00:00（+8 机器算出的边界）
  assert.equal(exclusiveEndYmd(exclusiveEnd), '2026-10-11')
  assert.equal(oldUtcFmt(exclusiveEnd), '2026-10-11', '旧 UTC 日写法会印成 10/11（r148 的反面证据）')

  // r266 反面证据（UTC 服务器口径）：同一条排他边界若按 UTC 零点出现（Render 容器），
  // 旧「−1ms」写法被 +8h 格式化抵消、把下周一本身印出来；exclusiveEndYmd 不受影响。
  const utcBoundary = new Date('2026-10-12T00:00:00Z')
  assert.equal(toLocalYmd(new Date(utcBoundary.getTime() - 1)), '2026-10-12', '旧 −1ms 写法在 UTC 服务器上把下周一印出来（r266 修掉的 bug 本身）')
  assert.equal(exclusiveEndYmd(utcBoundary), '2026-10-11', '新写法印周期最后一天')
})

// ─────────────────────────── ② 源码锁（接线不得回退） ───────────────────────────

/** 判据集合：给定仓库根，返回违规列表（可套合成坏样本，见反向自检） */
export function collectFailures(root) {
  const fails = []
  const p = join(root, 'server/routes/teaching.js')
  if (!existsSync(p)) return ['teaching.js 不见了']
  // 先把整行注释剔掉：注释里会引用旧写法当反面教材，不能把「说明文字」当成违规代码
  const src = readFileSync(p, 'utf8').replace(/^[ \t]*\/\/.*$/gm, '')

  // 1) 不得再用 UTC 日印周期边界（本端点无 all 哨兵值，一处都不许留）
  const utcHits = src.match(/period(Start|End)\.toISOString\(\)\.split\('T'\)\[0\]/g) || []
  if (utcHits.length > 0) {
    fails.push(`teaching: 仍有 ${utcHits.length} 处按 UTC 印周期边界（必须走 toLocalYmd）`)
  }

  // 2) 必须真的接了本地日历日格式化（start 走 toLocalYmd；end 走 r266 的 exclusiveEndYmd）
  const startHits = src.match(/toLocalYmd\(periodStart\)/g) || []
  const endHits = src.match(/exclusiveEndYmd\(periodEnd\)/g) || []
  if (startHits.length < 1) fails.push('teaching: period.start 未走 toLocalYmd(periodStart)')
  if (endHits.length < 1) fails.push('teaching: period.end 未走 exclusiveEndYmd(periodEnd)')

  // 2b) 旧「−1ms」写法一处都不许留（r266 修掉的 bug：UTC 服务器上被 +8h 格式化抵消）
  const minusOneHits = src.match(/toLocalYmd\(new Date\(periodEnd\.getTime\(\) - 1\)\)/g) || []
  if (minusOneHits.length > 0) {
    fails.push(`teaching: 仍有 ${minusOneHits.length} 处旧「减 1ms」写法（UTC 服务器上会把下周一印进去，必须走 exclusiveEndYmd）`)
  }

  // 3) import 必须带上（防「函数不存在」这类静默失败）
  if (!/import\s*\{[^}]*toLocalYmd[^}]*\}\s*from\s*'\.\.\/utils\/period\.js'/.test(src)) {
    fails.push('teaching: 未从 utils/period.js 导入 toLocalYmd')
  }
  if (!/import\s*\{[^}]*exclusiveEndYmd[^}]*\}\s*from\s*'\.\.\/utils\/period\.js'/.test(src)) {
    fails.push('teaching: 未从 utils/period.js 导入 exclusiveEndYmd')
  }
  return fails
}

test('⛔ teaching 周期格式化（当前树必须零违规）', () => {
  const fails = collectFailures(ROOT)
  assert.deepEqual(fails, [], `\n发现 ${fails.length} 处违规：\n` + fails.map((f) => `  - ${f}`).join('\n'))
})

test('锁健全性：判据套修复前的 UTC 坏样本必须判红（防空锁，不依赖 git）', () => {
  const base = join(ROOT, '_r151_teaching_period_bad')
  const q = join(base, 'server/routes/teaching.js')
  mkdirSync(dirname(q), { recursive: true })
  // 内联合成「修复前」的 teaching.js（旧的 UTC 写法 + 没有 import toLocalYmd）
  writeFileSync(q, `
import { parsePeriod } from '../utils/period.js'
const period = {
  start: periodStart.toISOString().split('T')[0],
  end: periodEnd.toISOString().split('T')[0],
  mode,
}
`, 'utf8')
  const probe = collectFailures(base)
  // 精确比对「五条判据逐条命中 + 命中顺序」，不只是数条数：
  // 只数条数的话，判据写错位置（比如写到 start 分支里）也会「碰巧」凑够条数 = 假通过。
  assert.deepEqual(probe, [
    'teaching: 仍有 2 处按 UTC 印周期边界（必须走 toLocalYmd）',
    'teaching: period.start 未走 toLocalYmd(periodStart)',
    'teaching: period.end 未走 exclusiveEndYmd(periodEnd)',
    'teaching: 未从 utils/period.js 导入 toLocalYmd',
    'teaching: 未从 utils/period.js 导入 exclusiveEndYmd',
  ], '判据套坏样本必须逐条命中，不能空锁 / 不能错命中')
  assert.ok(probe.length >= 5, `判据套坏样本应报 ≥5 处，实际 ${probe.length} —— 锁可能是空锁`)
})

test('锁健全性②：套「旧 −1ms 写法」坏样本必须逐条判红（r266 反转判据不空转）', () => {
  const base = join(ROOT, '_r266_teaching_minusone')
  const q = join(base, 'server/routes/teaching.js')
  mkdirSync(dirname(q), { recursive: true })
  // 内联合成「r266 之前」的写法：start 走 toLocalYmd、end 走 −1ms（+8 开发机上看起来全对）
  writeFileSync(q, `
import { parsePeriod, toLocalYmd } from '../utils/period.js'
const period = {
  start: toLocalYmd(periodStart),
  end: toLocalYmd(new Date(periodEnd.getTime() - 1)),
  mode,
}
`, 'utf8')
  const probe = collectFailures(base)
  assert.deepEqual(probe, [
    'teaching: period.end 未走 exclusiveEndYmd(periodEnd)',
    'teaching: 仍有 1 处旧「减 1ms」写法（UTC 服务器上会把下周一印进去，必须走 exclusiveEndYmd）',
    'teaching: 未从 utils/period.js 导入 exclusiveEndYmd',
  ], '旧 −1ms 写法在 r266 判据下必须逐条命中，不能空锁 / 不能错命中')
})
