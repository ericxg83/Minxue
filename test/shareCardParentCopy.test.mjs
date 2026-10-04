// 家长分享卡：文案必须是家长看得懂的人话（第 19 轮）
//
// 起因（2026-10-04 亲眼看渲染图发现）：
//   卡片右上角徽章此前对周模式显示英文「WEEK 40」——那是内部口径（ISO 周数），
//   家长看不懂"第 40 周"指哪几天；而且卡片下方本来就用中文写着
//   「学习周期 09/27 ~ 10/04」，属于又难懂又重复。
//   月模式是「9月」、全部模式是「成长总览」，只有周模式是英文，口径不一致。
//
// 本锁同时守住一个容易漏的点：老师**也能翻看往期**（offset > 0），
// 所以徽章必须按 offset 区分（本周/上周/N 周前），一律写"本周"会误导。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildShareCardHTML } from '../server/services/shareCardTemplate.js'

const base = (period) => ({
  student: { name: '测试', grade: '初二' },
  period,
  stats: {
    totalTasks: 1, completedTasks: 1, totalQuestions: 10, correctCount: 8,
    wrongCount: 2, accuracy: 80, newWrongCount: 1, masteredCount: 0, pendingCount: 1,
  },
})
const badgeOf = (period) => {
  const html = buildShareCardHTML(base(period), { maskName: false })
  const m = html.match(/class="badge">([^<]*)</)
  assert.ok(m, '未在 HTML 里找到周期徽章')
  return m[1]
}

test('周模式徽章说人话，不出现英文周数', () => {
  assert.equal(badgeOf({ start: '2026-09-27', end: '2026-10-04', mode: 'week', offset: 0, weekNum: 40 }), '本周')
  assert.doesNotMatch(badgeOf({ start: '2026-09-27', end: '2026-10-04', mode: 'week', offset: 0, weekNum: 40 }),
    /WEEK/i, '家长可见的卡片里不许再出现英文周数')
})

test('周模式必须按 offset 区分（老师会翻看往期）', () => {
  assert.equal(badgeOf({ start: '2026-09-20', end: '2026-09-27', mode: 'week', offset: 1, weekNum: 39 }), '上周')
  assert.equal(badgeOf({ start: '2026-09-06', end: '2026-09-13', mode: 'week', offset: 3, weekNum: 37 }), '3 周前')
})

test('缺 offset 时按本周处理（不得渲染出 NaN / undefined）', () => {
  const b = badgeOf({ start: '2026-09-27', end: '2026-10-04', mode: 'week' })
  assert.equal(b, '本周')
  assert.doesNotMatch(b, /NaN|undefined/)
})

test('月模式与全部模式仍是人话，且不受影响', () => {
  assert.equal(badgeOf({ start: '2026-09-01', end: '2026-10-01', mode: 'month', offset: 0 }), '本月')
  assert.equal(badgeOf({ start: '2026-08-01', end: '2026-09-01', mode: 'month', offset: 1 }), '上月')
  assert.equal(badgeOf({ start: '2026-08-01', end: '2026-09-01', mode: 'month', offset: 2 }), '8月')
  assert.equal(badgeOf({ mode: 'all', offset: 0 }), '成长总览')
})

test('源码不得依赖 weekNum（内部 ISO 周数不该出现在家长文案里）', () => {
  const src = readFileSync(new URL('../server/services/shareCardTemplate.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /badge\s*=.*weekNum/,
    '徽章又用回 weekNum 了 ⇒ 家长又会看到「WEEK 40」这种内部口径')
  assert.match(src, /_off\s*===\s*0\s*\?\s*'本周'/,
    '缺「按 offset 说人话」的判断，翻看往期时会一律显示本周')
})

test('整张卡片不得出现英文残留（WEEK/MONTH 等口径词）', () => {
  for (const p of [
    { start: '2026-09-27', end: '2026-10-04', mode: 'week', offset: 0, weekNum: 40 },
    { start: '2026-09-20', end: '2026-09-27', mode: 'week', offset: 1, weekNum: 39 },
    { start: '2026-09-01', end: '2026-10-01', mode: 'month', offset: 0 },
  ]) {
    const html = buildShareCardHTML(base(p), { maskName: false })
    // 只查家长可见文案区，排除 CSS/字体名等英文技术内容
    const visible = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/font-family:[^;]*/g, '')
    assert.doesNotMatch(visible, /\bWEEK\b|\bMONTH\b|\bNaN\b|undefined/,
      `家长可见区域出现了英文口径或脏值：${p.mode}/${p.offset}`)
  }
})
