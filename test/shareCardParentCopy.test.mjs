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


// ── 趋势块：数据稀疏时不该画一张只剩一个点的空网格 ──────────────────────
// 2026-10-04 亲眼看渲染图发现：整周只有 1 天批改过时（实测确有此数据：
// 7 天里 6 天 count=0），仍画完整 7 天网格 + 坐标轴，图上只剩孤零零一个点，
// 家长看着像"图坏了"。改为分三态：0 天占位 / 1 天一行实话 / ≥2 天完整图表。
const ST = {
  totalTasks: 1, completedTasks: 0, totalQuestions: 30, correctCount: 19,
  wrongCount: 11, accuracy: 63.3, newWrongCount: 11, masteredCount: 0, pendingCount: 11,
}
const withTrend = (dailyTrend) => ({
  student: { name: '测试', grade: '初二' },
  period: { start: '2026-09-27', end: '2026-10-04', mode: 'week', offset: 0 },
  stats: ST, dailyTrend,
})
const trendKind = (dailyTrend) => {
  const html = buildShareCardHTML(withTrend(dailyTrend), { maskName: false })
  // ⚠️ 判据必须看真实元素，不能用 includes('trend-single') —— 那会命中 CSS 样式定义（永远都在）。
  //    2026-10-04 我就是被这个坑了一次，误以为四种情况都渲染成同一形态。
  if (html.includes('<div class="trend-single">')) return 'single'
  if (html.includes('<div class="trend-empty">')) return 'empty'
  if (html.includes('<svg')) return 'chart'
  return 'none'
}

test('趋势块三态：0 天占位 / 1 天一行实话 / ≥2 天完整图表', () => {
  assert.equal(trendKind([{ date: '09-28', accuracy: null, count: 0 }]), 'empty', '0 天该是占位文案')
  assert.equal(
    trendKind([{ date: '09-28', accuracy: null, count: 0 }, { date: '10-02', accuracy: 63.3, count: 30 }, { date: '10-03', accuracy: null, count: 0 }]),
    'single', '只有 1 天有数据时不该再画完整网格')
  assert.equal(
    trendKind([{ date: '09-28', accuracy: 50, count: 10 }, { date: '10-02', accuracy: 63.3, count: 30 }]),
    'chart', '2 天有数据就该画趋势线')
})

test('一行实话要说清：哪天、几题、正确率多少', () => {
  const html = buildShareCardHTML(withTrend([{ date: '10-02', accuracy: 63.3, count: 30 }]), { maskName: false })
  const txt = (html.match(/<div class="trend-single">([\s\S]*?)<\/div>/) || [])[1] || ''
  assert.match(txt.replace(/<[^>]+>/g, ''), /10-02/, '必须写出是哪一天')
  assert.match(txt.replace(/<[^>]+>/g, ''), /30/, '必须写出批改了几题')
  assert.match(txt.replace(/<[^>]+>/g, ''), /63\.3/, '必须写出正确率')
})

test('该天无正确率时不得显示 undefined/NaN', () => {
  const html = buildShareCardHTML(withTrend([{ date: '10-02', accuracy: null, count: 30 }]), { maskName: false })
  const txt = ((html.match(/<div class="trend-single">([\s\S]*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, '')
  assert.doesNotMatch(txt, /undefined|NaN/, '无正确率时不能把空值渲染出来')
  assert.match(txt, /30/, '仍应说清批改了几题')
})

test('标题随内容自适应：≤1 天不写「趋势」，避免家长以为漏图', () => {
  const titleOf = (dt) => (buildShareCardHTML(withTrend(dt), { maskName: false })
    .match(/block-title">([^<]*)</) || [])[1] || ''
  assert.match(titleOf([{ date: '10-02', accuracy: 63.3, count: 30 }]), /批改记录/,
    '1 天数据时标题不该叫「正确率趋势」')
  assert.match(titleOf([{ date: '09-28', accuracy: null, count: 0 }]), /批改记录/,
    '0 天数据时标题也不该叫「正确率趋势」')
  assert.match(titleOf([{ date: '09-28', accuracy: 50, count: 10 }, { date: '10-02', accuracy: 63.3, count: 30 }]),
    /正确率趋势/, '≥2 天确实是趋势，标题应保持「正确率趋势」')
})
