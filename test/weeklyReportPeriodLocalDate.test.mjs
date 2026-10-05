/**
 * r148 回归锁：家长可见产出物的「学习周期」必须按**本地日历日**印，不能按 UTC 印。
 *
 * 真缺陷（实测取证，非推测）：`server/routes/weeklyReport.js` 里 period.start/end 由
 *   `periodStart.toISOString().split('T')[0]` 生成 —— toISOString 是 UTC，而周期边界是
 *   `server/utils/period.js` 用 `new Date(y, m, d)` 按**本地时区**算的。UTC+8 的本地 00:00
 *   换算成 UTC 就退到**前一天**，于是：
 *     · 周模式：周一 10/05 印成周日 10/04（家长拿到的「学习周期」比屏幕上早一天，
 *       且与工作台/移动端页面用 dayjs isoWeek 算出的「10/05 ~ 10/11」自相矛盾）；
 *     · 月模式：10 月周期的 start 印成 09-30 ⇒ PDF 封面月徽章
 *       `dayjs(period.start).format('M月')` 直接写成「9月」（每份月报都错，不是边界偶发）；
 *       `shareCardTemplate.js` 的 `_monthLabel` 同理。
 *   `fetchStudentWeeklyReport` 是「学习诊断 PDF」与「家长分享卡」两个产出物共用的取数口，
 *   所以这一处格式化错，两个家长可见产出物一起错。
 *   本文件共 **3 个**响应体犯同一个错（单学生版、全班版、`fetchPeriodCompare` 上一周期版——
 *   最后这个印在 PDF 对比页「上周 09/21 ~ 09/27」）。
 *
 * 实测（node，Asia/Shanghai）：
 *   week : 真实边界 Mon 10/05 00:00 → 旧印 2026-10-04(周日) ~ 2026-10-11(周日)
 *   month: 真实边界 Oct 01 00:00   → 旧印 2026-09-30(周三) ~ 2026-10-31(周六)，月徽章「9月」
 *
 * 判据分两层：① 真跑 toLocalYmd 的行为断言（不依赖源码文本）；② 源码锁住 weeklyReport.js
 * 不得回退成 UTC 写法。⛔ 行为断言一律用**带显式 +08:00 偏移**的日期构造，保证换机器/换时区
 * 都判得一样（若用 `getWeekRange()` 现算再断言，跑在 UTC 机器上旧写法也会「碰巧」判绿 = 空锁）。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { toLocalYmd, getWeekRange, getPeriodRange } from '../server/utils/period.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 旧写法（= 本次修掉的 bug），只用于反向自检与「说明它为什么错」，生产代码不得再用 */
const oldUtcFmt = (d) => d.toISOString().split('T')[0]

/** 把 YYYY-MM-DD 当纯日历日问星期几（用 UTC 解析 ⇒ 与运行机器时区无关） */
const weekdayOf = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay()

// ─────────────────────────── ① 行为判据 ───────────────────────────

test('本地日历日格式化：UTC+8 的本地 00:00 不得被印成前一天', () => {
  const localMondayMidnight = new Date('2026-10-05T00:00:00+08:00') // 周一
  assert.equal(toLocalYmd(localMondayMidnight), '2026-10-05')
  // 这条断言把「为什么错」钉在测试里：旧写法在同一个 Date 上必然少一天
  assert.equal(oldUtcFmt(localMondayMidnight), '2026-10-04', '旧 UTC 写法应少一天（这就是 bug 本身）')
})

test('周期起点印出来必须是周一（周报周期以周一为起点）', () => {
  const weekStart = new Date('2026-10-05T00:00:00+08:00')
  assert.equal(weekdayOf(toLocalYmd(weekStart)), 1, '周模式周期起点必须是周一，不能印成周日')
  assert.equal(weekdayOf(oldUtcFmt(weekStart)), 0, '旧写法会印成周日（反向证据）')
})

test('月周期起点印出来必须是当月 1 日（月徽章「M月」的前提）', () => {
  const monthStart = new Date('2026-10-01T00:00:00+08:00')
  const printed = toLocalYmd(monthStart)
  assert.equal(printed, '2026-10-01')
  assert.equal(printed.slice(5, 7), '10', '10 月报告不得印成 9 月')
  assert.equal(oldUtcFmt(monthStart).slice(5, 7), '09', '旧写法印成 09（= 月徽章显示「9月」的根因）')
})

test('周/月周期的「最后一天」口径：排他边界减 1ms 后落在本周期内', () => {
  // 与 server/lib/weekendHandout.js:1131 同一口径：end 是排他边界，对外说「最后一天」
  const week = getWeekRange(0)
  const weekEnd = toLocalYmd(new Date(week.periodEnd.getTime() - 1))
  assert.equal(weekdayOf(weekEnd), 0, '周周期的最后一天应是周日')

  const month = getPeriodRange('month', 0)
  const monthEnd = toLocalYmd(new Date(month.periodEnd.getTime() - 1))
  assert.equal(monthEnd.slice(5, 7), toLocalYmd(month.periodStart).slice(5, 7), '月周期起止必须同月')
})

// ─────────────────────────── ② 源码锁（接线不得回退） ───────────────────────────

/** 判据集合：给定仓库根，返回违规列表（可套合成坏样本，见反向自检） */
export function collectFailures(root) {
  const fails = []
  const p = join(root, 'server/routes/weeklyReport.js')
  if (!existsSync(p)) return ['weeklyReport.js 不见了']
  // 先把整行注释剔掉：注释里会引用旧写法当反面教材，不能把「说明文字」当成违规代码
  const src = readFileSync(p, 'utf8').replace(/^[ \t]*\/\/.*$/gm, '')

  // 1) 不得再用 UTC 日印周期边界；all 模式的哨兵值仍走 toISOString（显式 UTC），允许
  const utcHits = src.match(/period(Start|End)\.toISOString\(\)\.split\('T'\)\[0\]/g) || []
  const guarded = src.match(/mode === 'all' \? period(Start|End)\.toISOString\(\)\.split\('T'\)\[0\]/g) || []
  if (utcHits.length > guarded.length) {
    fails.push(`weeklyReport: 仍有未走本地日历日的 UTC 格式化（${utcHits.length - guarded.length} 处）`)
  }

  // 2) 必须真的接了 toLocalYmd，且三个响应体都要接
  //    （fetchStudentWeeklyReport 单学生版 + 全班版 + fetchPeriodCompare 上一周期版）
  const startHits = src.match(/toLocalYmd\(periodStart\)/g) || []
  const endHits = src.match(/toLocalYmd\(new Date\(periodEnd\.getTime\(\) - 1\)\)/g) || []
  if (startHits.length < 3) fails.push(`weeklyReport: period.start 走 toLocalYmd 的处数 ${startHits.length} < 3（三个响应体都要）`)
  if (endHits.length < 3) fails.push(`weeklyReport: period.end 走 toLocalYmd(...-1) 的处数 ${endHits.length} < 3`)

  // 3) import 必须带上（防「函数不存在」这类静默失败）
  if (!/import\s*\{[^}]*toLocalYmd[^}]*\}\s*from\s*'\.\.\/utils\/period\.js'/.test(src)) {
    fails.push('weeklyReport: 未从 utils/period.js 导入 toLocalYmd')
  }
  return fails
}

test('⛔ weeklyReport 周期格式化（当前树必须零违规）', () => {
  const fails = collectFailures(ROOT)
  assert.deepEqual(fails, [], `\n发现 ${fails.length} 处违规：\n` + fails.map((f) => `  - ${f}`).join('\n'))
})

test('锁健全性：判据套修复前的 UTC 坏样本必须判红（防空锁，不依赖 git）', () => {
  const base = join(ROOT, '_r148_periodlock_bad')
  const put = (rel, content) => {
    const q = join(base, rel)
    mkdirSync(dirname(q), { recursive: true })
    writeFileSync(q, content, 'utf8')
  }
  // 内联合成「修复前」的 weeklyReport.js（旧的 UTC 写法 + 没有 import toLocalYmd）
  put('server/routes/weeklyReport.js', `
import { parsePeriod, getIsoWeek, getPeriodRange } from '../utils/period.js'
const period = {
  start: periodStart.toISOString().split('T')[0],
  end: periodEnd.toISOString().split('T')[0],
}
const period2 = {
  start: periodStart.toISOString().split('T')[0],
  end: periodEnd.toISOString().split('T')[0],
}
`)
  const probe = collectFailures(base)
  // 期望：UTC 未走本地 2 处 + start 0<2 + end 0<2 + 缺 import = 4 条
  assert.ok(probe.length >= 4, `判据套坏样本应报 ≥4 处，实际 ${probe.length} —— 锁可能是空锁`)
})
