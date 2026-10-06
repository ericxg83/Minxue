/**
 * 回归锁：家长分享卡的「周期用词」必须随 mode 走（r211，2026-10-06）
 *
 * 起因（实测，非推理）：`shareCardTemplate.js` 里只有一行
 *   const periodWord = mode === 'month' ? '本月' : '本周'
 * 第三个分支把 **'all'（成长总览，跨数月）也当成了周** ——
 * 客观证据：PC 工作台「学习诊断」的 周/月/全部 三档切换（WeeklyReportWorkbench.vue:
 * 450-454）会把 periodMode 直接透传给 GrowthCardButton 的 :mode，
 * 而分享卡是老师**唯一转发给家长**的输出物。
 * 实测渲染结果：徽章写「成长总览」、学习周期印着 01/01 ~ 10/06，
 * 老师寄语却是「**本周**作业完成情况尚可，仍有提升空间」，
 * 知识点空态也是「**本周**暂无薄弱知识点，继续保持」——家长读起来自相矛盾。
 *
 * 判据：
 *   - 模板是纯函数 ⇒ **真跑渲染、断言输出的 HTML**，不是源码 grep。
 *   - 「成长总览」是长周期 ⇒ 出现「本周/本月」即判红（窄口径说在长周期上是错的）。
 *   - 未知 mode 仍兜底「本周」（偏窄但不说错），与改动前行为一致。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
readFileSync(resolve(ROOT, 'server/services/shareCardTemplate.js'), 'utf8')

const { buildShareCardHTML } = await import('../server/services/shareCardTemplate.js')

/** 有数据样本（照抄真实 payload 形状：完成率 / 正确率 / 薄弱知识点都非空） */
const sample = (mode, extraPeriod = {}) => ({
  student: { name: '陆晨曦', grade: '六年级' },
  period: {
    start: '2026-01-01', end: '2026-10-06',
    offset: 0,
    mode,
    ...extraPeriod
  },
  stats: {
    totalTasks: 4, completedTasks: 3,
    totalQuestions: 120, correctCount: 74, wrongCount: 46,
    accuracy: 61.7, newWrongCount: 46,
    masteredCount: 30, basicMasteredCount: 16, notStartedCount: 14,
    practicedCount: 3, repeatWrongCount: 0, pendingCount: 0
  },
  subjectDiagnosis: [
    { subject: '数学', accuracy: 63, topTags: [{ tag: '一元二次方程', wrongCount: 9, totalCount: 20, masteryLabel: '待加强' }] }
  ],
  dailyTrend: [],
  prev: null, retryProgress: null, hasEverGraded: true
})

/** 抽「老师寄语」正文 */
function commentOf(html) {
  const m = html.match(/class="comment-d">([^<]*)<\/div>/)
  return m ? m[1].trim() : ''
}

/** 抽「重点关注知识点」块的空态文案 */
function kpEmptyOf(html) {
  const m = html.match(/class="kp-empty">([^<]*)</)
  return m ? m[1].trim() : ''
}

/** 抽出全部块标题（用于断言「学科正确率（X）」跟着周期词走） */
function blockTitlesOf(html) {
  return [...html.matchAll(/<div class="block-title">([^<]*)<\/div>/g)].map((m) => m[1])
}

test('✅ 周模式仍说「本周」（防改动回退到一律本周）', () => {
  const c = commentOf(buildShareCardHTML(sample('week'), {}))
  assert.ok(c.includes('本周'), `实际寄语：「${c}」`)
})

test('✅ 月模式说「本月」且不说「本周」', () => {
  const html = buildShareCardHTML(sample('month'), {})
  const c = commentOf(html)
  assert.ok(c.includes('本月'), `实际寄语：「${c}」`)
  assert.equal(c.includes('本周'), false, `月模式寄语混进了「本周」→「${c}」`)
})

test('⛔ 成长总览（all）不说「本周」——长周期套窄口径是错的话', () => {
  const html = buildShareCardHTML(sample('all'), {})
  const c = commentOf(html)
  assert.equal(c.includes('本周'), false, `「成长总览」卡片还在说「本周」→「${c}」`)
  // 徽章本身允许保留「成长总览」，但整张卡片不得再出现周/月这种短周期词
  assert.equal(/\u672c\u5468/.test(html), false, 'all 模式渲染出的 HTML 里仍有「本周」')
  assert.equal(/\u672c\u6708/.test(html), false, 'all 模式渲染出的 HTML 里仍有「本月」')
})

test('✅ 成长总览（all）说人话：「这段时间」', () => {
  const c = commentOf(buildShareCardHTML(sample('all'), {}))
  assert.ok(c.includes('这段时间'), `实际寄语：「${c}」`)
  assert.ok(c.includes('作业完成情况尚可'), `实际寄语：「${c}」`)
})

test('⛔ 成长总览的知识点空态不许写「本周暂无薄弱知识点」', () => {
  const html = buildShareCardHTML({
    ...sample('all'),
    stats: { ...sample('all').stats, totalQuestions: 0 },
    subjectDiagnosis: []
  }, {})
  const kp = kpEmptyOf(html)
  assert.ok(kp.length > 0, '没渲染出知识点空态')
  assert.equal(kp.includes('本周'), false, `all 模式空态仍是窄口径 →「${kp}」`)
  assert.ok(kp.includes('这段时间'), `实际空态：「${kp}」`)
})

test('✅ 成长总览的「学科正确率」块标题跟周期词一起变', () => {
  const allTitles = blockTitlesOf(buildShareCardHTML(sample('all'), {}))
  assert.ok(
    allTitles.includes('学科正确率（这段时间）'),
    `all 模式块标题里没有「学科正确率（这段时间）」：${allTitles.join(' / ')}`
  )

  const monthTitles = blockTitlesOf(buildShareCardHTML(sample('month'), {}))
  assert.ok(
    monthTitles.includes('学科正确率（本月）'),
    `month 模式块标题异常：${monthTitles.join(' / ')}`
  )

  const week = buildShareCardHTML(sample('week'), {})
  assert.equal(
    blockTitlesOf(week).some((t) => t.includes('学科正确率')),
    false,
    '周模式不该渲染「学科正确率」块（本周走趋势图）'
  )
})

test('✅ 成长总览的新学生空态文案不受影响（仍「学习记录刚起步」）', () => {
  const c = commentOf(buildShareCardHTML({
    ...sample('all'),
    stats: { ...sample('all').stats, totalQuestions: 0, totalTasks: 0, completedTasks: 0 },
    subjectDiagnosis: [],
    hasEverGraded: false
  }, {}))
  assert.ok(c.includes('学习记录刚起步'), `实际寄语：「${c}」`)
})

test('✅ 未知 mode 兜底成「本周」（偏窄不说错，与改动前一致）', () => {
  const c = commentOf(buildShareCardHTML(sample('weird怪'), {}))
  assert.ok(c.includes('本周'), `兜底分支丢了 →「${c}」`)
})

// ── r213 追加：低正确率分支（正确率 <60）的周期词 ───────────────────────────
// r211 只修了 periodWord 这个变量本身，漏了 99 行低正确率分支里的硬编码「本周」。
// 实测：21 名学生里 10 名「成长总览」正确率 <60（李哲瀚 47.2% / 丁嘉炜 21.9% / 汤一诺 37.5%…）
// ⇒ 这批孩子的成长总览卡会同时出现「成长总览 / 01/01~10/06」和「复习本周错题」。
/** 低正确率样本（<60 ⇒ 走「建议重点复习…错题」分支） */
const lowAccSample = (mode, acc = 47.2) => ({
  ...sample(mode),
  stats: { ...sample(mode).stats, accuracy: acc, totalQuestions: 123, correctCount: 58, wrongCount: 65 }
})

test('⛔ 成长总览低正确率不许说「本周错题」（r213 实测补漏）', () => {
  const html = buildShareCardHTML(lowAccSample('all'), {})
  const c = commentOf(html)
  assert.equal(c.includes('本周'), false, `all 模式低正确率寄语仍有窄口径 →「${c}」`)
  assert.ok(c.includes('这段时间错题'), `实际寄语：「${c}」`)
  assert.equal(/\u672c\u5468/.test(html), false, 'all 模式低正确率整卡仍有「本周」')
})

test('✅ 周低正确率仍逐字说「本周错题」（行为保持，防过度改动）', () => {
  const c = commentOf(buildShareCardHTML(lowAccSample('week'), {}))
  assert.equal(
    c,
    '本周作业完成情况尚可，仍有提升空间，整体正确率 47.2%，建议重点复习本周错题，夯实基础！',
    `实际寄语：「${c}」`
  )
})

test('✅ 月低正确率说「本月错题」', () => {
  const c = commentOf(buildShareCardHTML(lowAccSample('month'), {}))
  assert.ok(c.includes('本月错题'), `实际寄语：「${c}」`)
  assert.equal(c.includes('本周'), false, `月模式低正确率寄语混进「本周」→「${c}」`)
})

test('✅ 高/中正确率分支不受影响（不用补周期词的地方没被动到）', () => {
  const c = commentOf(buildShareCardHTML(sample('all'), {}))
  // 61.7 ≥60 ⇒ 走 98 行「仍需加强练习」分支，不出现「错题」
  assert.ok(c.includes('整体正确率 61.7%'), `实际寄语：「${c}」`)
  assert.equal(c.includes('错题'), false, `中正确率分支不该出现「错题」→「${c}」`)
})
