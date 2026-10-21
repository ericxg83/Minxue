/**
 * r326 回归锁：家长 PDF 封面「学习周期」对「全部」模式的判定。
 *
 * 背景（真缺陷类，非推测）：`src/utils/weeklyReportGenerator.js` 的 `periodLabelText`
 * 此前靠**魔数字符串匹配**判断「全部」模式 —— 取 period.start/end 的前 4 位，遇到
 * `'2000'` 或 `'2099'` 就认定是「全部」模式、输出「学习周期：全部记录」。
 * 这两个字符串是 `server/utils/period.js` 给 all 模式打的**哨兵**
 * （periodStart = 2000-01-01T00:00:00Z / periodEnd = 2099-12-31T23:59:59Z），
 * 全靠「字符串恰好是 2000/2099」这个脆弱耦合：一旦 period.js 改哨兵值，
 * 匹配静默失效 ⇒ 家长 PDF 封面印出「学习周期：2000-01-01 ~ 2099-12-31」这种荒谬文案，
 * 且没有任何报错（铁律：错答案/错文案静默上屏）。
 *
 * r326 修：改成按 `period.mode === 'all'` 分支（period 对象始终带 mode，weeklyReport.js
 * 三个 period 都写进去了），与哨兵字符串脱钩。本文件锁两件事：
 *   ① periodLabelText 必须按 mode 分支，不得回退到魔数字符串匹配（源码锁）；
 *   ② period.js 的 all 模式必须仍返回 2000/2099 哨兵（契约锁，含 +8 跨午夜 rollover 说明）。
 *
 * 反向自检：合成「魔数字符串版」坏样本套判据必须判红（防空锁，不依赖 git）。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import os from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'

import { getPeriodRange, toLocalYmd } from '../server/utils/period.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 去掉注释：源码锁不能把「说明文字」当成违规代码（本文件各锁的通用手法） */
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

/** 抠出 periodLabelText 函数体（从函数声明到下一个列 0 的 `}`） */
function extractPeriodLabelText(src) {
  const i = src.indexOf('function periodLabelText(')
  if (i < 0) return null
  const end = src.indexOf('\n}', i) + 2
  return src.slice(i, end)
}

/** 给定仓库根，返回 periodLabelText 的违规列表（可套合成坏样本，见反向自检） */
export function collectFailures(root) {
  const fails = []
  const p = join(root, 'src/utils/weeklyReportGenerator.js')
  if (!existsSync(p)) return ['weeklyReportGenerator.js 不见了']
  const fn = extractPeriodLabelText(stripComments(readFileSync(p, 'utf8')))
  if (!fn) { fails.push('periodLabelText 函数不见了'); return fails }

  // 1) 必须按 mode 分支（这是 r326 修掉魔数字符串匹配的落点）
  if (!/period\.mode\s*===\s*'all'/.test(fn)) {
    fails.push("periodLabelText 必须按 period.mode === 'all' 分支（不要回退到魔数字符串哨兵匹配）")
  }
  // 2) 不得再用魔数字符串匹配哨兵（哨兵一旦改动会静默失效）
  if (/===\s*'2000'/.test(fn) || /===\s*'2099'/.test(fn)) {
    fails.push('periodLabelText 仍用 2000/2099 魔数字符串匹配哨兵（哨兵改动会静默失效）')
  }
  if (/String\(period\.(start|end)/.test(fn)) {
    fails.push('periodLabelText 仍从 period.start/end 切片年份做哨兵判定')
  }
  return fails
}

test('⛔ 家长 PDF 封面「全部记录」判定：必须按 mode 分支，不得依赖 2000/2099 魔数字符串', () => {
  const fails = collectFailures(ROOT)
  assert.deepEqual(fails, [], '\n发现 ' + fails.length + ' 处违规：\n' + fails.map((f) => '  - ' + f).join('\n'))
})

test('锁健全性：判据套「魔数字符串版本」坏样本必须判红（防空锁，不依赖 git）', () => {
  const base = join(os.tmpdir(), '_r326_allmode_bad')
  const put = (rel, content) => {
    const q = join(base, rel)
    mkdirSync(dirname(q), { recursive: true })
    writeFileSync(q, content, 'utf8')
  }
  // 内联合成「修复前」的 periodLabelText（魔数字符串匹配哨兵）
  put('src/utils/weeklyReportGenerator.js', `
function periodLabelText(period) {
  if (!period) return ''
  const y1 = String(period.start || '').slice(0, 4)
  const y2 = String(period.end || '').slice(0, 4)
  if (y1 === '2000' || y2 === '2099') return '学习周期：全部记录'
  return \`学习周期：\${period.start} ~ \${period.end}\`
}
`)
  const probe = collectFailures(base)
  assert.ok(probe.length >= 2, `判据套魔数字符串坏样本应报 ≥2 处，实际 ${probe.length} —— 锁可能空转`)
})

test('契约：period.js 的 all 模式必须返回 2000/2099 哨兵（封面借此区分「全部记录」）', () => {
  const { periodStart, periodEnd } = getPeriodRange('all')
  // all 分支的哨兵是「显式 UTC」刻意保留：toISOString 才是 UTC 日历日，印出来恰好是 2000-01-01 / 2099-12-31
  assert.equal(periodStart.toISOString().slice(0, 10), '2000-01-01')
  assert.equal(periodEnd.toISOString().slice(0, 10), '2099-12-31')
})

test('契约健全性：all 哨兵边界在 +8 下会跨午夜（说明为什么 all 分支必须保留 toISOString 而非 toLocalYmd）', () => {
  // 2099-12-31T23:59:59Z + 8h = 2100-01-01T07:59:59+08 ⇒ 上海日历日变成 2100-01-01。
  // 若谁把 weeklyReport.js 的 all 分支「顺手」改成 toLocalYmd（r148 周/月的修法），
  // period.end 会从 2099-12-31 变成 2100-01-01，破坏哨兵检测、家长封面印出 2000 ~ 2100。
  const { periodEnd } = getPeriodRange('all')
  assert.equal(toLocalYmd(periodEnd), '2100-01-01', '基准事实：2099-12-31T23:59:59Z 在 +8 下是 2100-01-01；all 分支必须保留 toISOString 哨兵')
})
