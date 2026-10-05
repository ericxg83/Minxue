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
 *   end:   toLocalYmd(new Date(periodEnd.getTime() - 1))   // end 是排他边界，对外说「最后一天」
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

import { toLocalYmd, getWeekRange } from '../server/utils/period.js'

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
  // teaching.js 实际用的两个表达式
  const start = toLocalYmd(week.periodStart)
  const end = toLocalYmd(new Date(week.periodEnd.getTime() - 1))
  assert.equal(weekdayOf(start), 1, '周模式周期起点必须是周一')
  assert.equal(weekdayOf(end), 0, '周模式周期最后一天（排他边界减 1ms）必须是周日')
  assert.notEqual(start, end, '起止不得印成同一天')
})

test('排他边界减 1ms 后仍落在同一天（custom 入参传整点也稳）', () => {
  const exclusiveEnd = new Date('2026-10-12T00:00:00+08:00') // 下周一 00:00
  assert.equal(toLocalYmd(new Date(exclusiveEnd.getTime() - 1)), '2026-10-11')
  // 旧写法在 UTC+8 下会把这个排他边界印成 10/11 —— 与「下周一」自相矛盾的反面证据
  assert.equal(oldUtcFmt(exclusiveEnd), '2026-10-11')
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

  // 2) 必须真的接了 toLocalYmd（start / end 各至少一处）
  const startHits = src.match(/toLocalYmd\(periodStart\)/g) || []
  const endHits = src.match(/toLocalYmd\(new Date\(periodEnd\.getTime\(\) - 1\)\)/g) || []
  if (startHits.length < 1) fails.push('teaching: period.start 未走 toLocalYmd(periodStart)')
  if (endHits.length < 1) fails.push('teaching: period.end 未走 toLocalYmd(new Date(periodEnd - 1))')

  // 3) import 必须带上（防「函数不存在」这类静默失败）
  if (!/import\s*\{[^}]*toLocalYmd[^}]*\}\s*from\s*'\.\.\/utils\/period\.js'/.test(src)) {
    fails.push('teaching: 未从 utils/period.js 导入 toLocalYmd')
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
  // 精确比对「四条判据逐条命中 + 命中顺序」，不只是数条数：
  // 只数条数的话，判据写错位置（比如写到 start 分支里）也会「碰巧」凑够条数 = 假通过。
  assert.deepEqual(probe, [
    'teaching: 仍有 2 处按 UTC 印周期边界（必须走 toLocalYmd）',
    'teaching: period.start 未走 toLocalYmd(periodStart)',
    'teaching: period.end 未走 toLocalYmd(new Date(periodEnd - 1))',
    'teaching: 未从 utils/period.js 导入 toLocalYmd',
  ], '判据套坏样本必须逐条命中，不能空锁 / 不能错命中')
  assert.ok(probe.length >= 4, `判据套坏样本应报 ≥4 处，实际 ${probe.length} —— 锁可能是空锁`)
})
