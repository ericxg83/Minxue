/**
 * 回归锁：家长分享卡「成长总览（all）」周期行必须说人话（r259，2026-10-10）
 *
 * 起因（实测，非推理）：把 buildShareCardHTML 在 Node 里真渲染出来读 HTML 文本，
 *   发现 all 模式（成长总览）的周期行印成「学习周期 01/01 ~ 12/31」
 *   （start/end 是 weeklyReport.js 给 all 模式硬编码的 2000 / 2099 UTC 哨兵值）。
 *   家长读起来像"某一年的 1 月 1 日 ~ 12 月 31 日"，而卡片徽章明明写着「成长总览」
 *   （全部历史累计），自相矛盾。
 *   周/月模式才是真实日期区间，必须保持原样；all 改成「全部学习记录」。
 *
 * 判据：模板是纯函数 ⇒ 真跑渲染、断言 HTML，不是源码 grep。
 *   ① all 模式 HTML 必须含「学习周期 全部学习记录」且不得出现 '01/01' / '12/31' 日期区间；
 *   ② 周模式周期行仍须是真实日期区间（行为保持，防过度改动）；
 *   ③ 月模式同理；
 *   ④ 页脚（periodLine || badge）在 all 模式也不得漏出日期数字。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildShareCardHTML } = await import('../server/services/shareCardTemplate.js')

const base = (mode, period = {}) => ({
  student: { name: '陆晨曦', grade: '初三' },
  period: { start: '2026-10-05', end: '2026-10-11', offset: 0, mode, weekNum: mode === 'week' ? 41 : null, ...period },
  stats: {
    totalTasks: 10, completedTasks: 9, totalQuestions: 176, correctCount: 120, wrongCount: 56,
    accuracy: 68.2, newWrongCount: 56, masteredCount: 2, basicMasteredCount: 14,
    notStartedCount: 40, pendingCount: 54, wrongQuestionIds: []
  },
  subjectDiagnosis: [{ subject: '数学', accuracy: 68.2, topTags: [{ tag: '二次函数', wrongCount: 12, totalCount: 20, masteryLabel: '待加强' }] }],
  dailyTrend: [{ date: '10-05', accuracy: 70, count: 30 }],
  prev: { stats: { accuracy: 61.2, newWrongCount: 60, notStartedCount: 45, totalQuestions: 170 } },
  retryProgress: { examCount: 2, retriedCount: 30, retryAccuracy: 75, pushedToBasic: 5 },
  hasEverGraded: true
})

test('⛔ 成长总览（all）周期行必须说人话，不得露出日期区间', () => {
  const html = buildShareCardHTML(base('all', { start: '2000-01-01', end: '2099-12-31' }), {})
  assert.ok(html.includes('学习周期 全部学习记录'), `all 模式周期行未改人话 →「${html.match(/学习周期[^<]*/)?.[0] ?? ''}」`)
  assert.equal(html.includes('01/01'), false, 'all 模式仍漏出 startDate 区间')
  assert.equal(html.includes('12/31'), false, 'all 模式仍漏出 endDate 区间')
})

test('✅ 周模式周期行保持真实日期区间（行为保持）', () => {
  const html = buildShareCardHTML(base('week', { start: '2026-10-05', end: '2026-10-11' }), {})
  assert.ok(html.includes('学习周期 10/05 ~ 10/11'), `周模式周期行异常 →「${html.match(/学习周期[^<]*/)?.[0] ?? ''}」`)
})

test('✅ 月模式周期行保持真实日期区间（行为保持）', () => {
  const html = buildShareCardHTML(base('month', { start: '2026-10-01', end: '2026-11-01' }), {})
  assert.ok(html.includes('学习周期 10/01 ~ 11/01'), `月模式周期行异常 →「${html.match(/学习周期[^<]*/)?.[0] ?? ''}」`)
})

test('✅ 成长总览页脚（periodLine || badge）不得漏出日期数字', () => {
  const html = buildShareCardHTML(base('all', { start: '2000-01-01', end: '2099-12-31' }), {})
  // 页脚第二项是 periodLine || badge，all 模式下 periodLine='全部学习记录'
  const foot = html.match(/class="foot">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/body>/)?.[0] ?? html.slice(-400)
  assert.equal(/12\/31|01\/01/.test(foot), false, `all 模式页脚漏出日期 →「${foot}」`)
})
