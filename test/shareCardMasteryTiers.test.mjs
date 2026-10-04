/**
 * 回归锁：家长可见产出物「掌握度三态」口径（r132，2026-10-05）
 *
 * 守护**两处**家长转发物（老师只把这两个发给家长看）：
 *   ① 家长分享卡        server/services/shareCardTemplate.js
 *   ② 学习诊断 PDF 报告 src/utils/weeklyReportGenerator.js
 *
 * 起因：r130 已把「基本掌握」从 pendingCount 里拆出来（splitMasteryStates），
 * 但两个家长可见出口没跟 —— 它们只认 masteredCount / pendingCount 一个字段，
 * 答对过一次的题全被并进「待提升错题」。
 * 实测：74 道错题里孩子**已记住 16 道**（完全 2 + 基本 14），卡片/PDF 却写着「完全掌握 2、
 * 待提升 72」—— 把已经会了的当不会，家长看到的是「孩子几乎什么都没记住」。
 *
 * 判据设计：
 *   - 两个模板都是**纯函数 / 纯模板**，不连库 ⇒ **真跑渲染、断言输出的 HTML**，
 *     不是源码 grep（改错了立刻红，改对了才绿）。
 *   - 反向自检用**内联合成坏样本**（legacy 卡片 + 旧口径 PDF 片段），不依赖 git 历史
 *     （r113q 教训：旧树每轮从 HEAD 重导会让历史修复合入后误报 0 红）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const { buildShareCardHTML } = await import('../server/services/shareCardTemplate.js')

/** 三态样本：完全掌握 2 / 基本掌握 14 / 还没答对过 58（合计 74） */
const SAMPLE = {
  student: { name: '测试同学', grade: '八年级' },
  period: { mode: 'week', offset: 0, start: '2026-09-27', end: '2026-10-04' },
  stats: {
    totalTasks: 5, completedTasks: 5, totalQuestions: 300, correctCount: 200,
    wrongCount: 100, accuracy: 66.7, newWrongCount: 74,
    masteredCount: 2, basicMasteredCount: 14, notStartedCount: 58,
    practicedCount: 20, repeatWrongCount: 5, pendingCount: 72
  },
  subjectDiagnosis: [], dailyTrend: [], prev: null, retryProgress: null,
  knowledgeDiagnosis: []
}

/** 从渲染出的 HTML 里抽出「数字格」的 {value, label}（分享卡 .kpi 与旧三格 .tri 都能解析） */
function tiles(html) {
  return html.split(/<div class="(?:kpi|tri)"/).slice(1).map((p) => {
    const v = p.match(/kpi-v"[^>]*>([\s\S]*?)<\/div>/) || p.match(/tri-v"[^>]*>([\s\S]*?)<\/div>/)
    const l = p.match(/kpi-l"[^>]*>([\s\S]*?)<\/div>/) || p.match(/tri-l"[^>]*>([\s\S]*?)<\/div>/)
    // 数值只取开头的整数：模板里单位要么包在 <small> 要么是后面的 <span>，
    // 直接去标签会留下「16 题」这种带单位的串，断言就永远对不上。
    const raw = String(v ? v[1] : '').replace(/<[^>]+>/g, '').trim()
    return {
      value: raw.match(/^-?\d+/)?.[0] ?? raw,
      label: String(l ? l[1] : '').trim()
    }
  })
}
const find = (list, label) => list.find((t) => t.label === label)

test('⛔ 分享卡必须显示「已记住」= 完全+基本，且数值是 16 不是 2', () => {
  const html = buildShareCardHTML(SAMPLE, {})
  const t = find(tiles(html), '已记住')
  assert.ok(t, `分享卡上没有「已记住」（实际标签：${tiles(html).map((x) => x.label).join('/')}）`)
  assert.equal(t.value, '16', '已记住必须 = 完全掌握 2 + 基本掌握 14 = 16')
})

test('⛔ 分享卡要把只答对过的算「已记住」，不能并进「还在攻克」', () => {
  const html = buildShareCardHTML(SAMPLE, {})
  const t = find(tiles(html), '还在攻克')
  assert.ok(t, '分享卡上没有「还在攻克」')
  assert.equal(t.value, '58', '还在攻克必须 = 待复习 58，不能是 pendingCount 72')
  for (const legacy of ['完全掌握', '待提升错题']) {
    assert.equal(find(tiles(html), legacy), undefined,
      `「${legacy}」是 r132 已修的旧口径，不得回到卡片上`)
  }
})

test('⛔ 已记住 + 还在攻克 必须等于新增错题（不得凭空多算/漏算）', () => {
  const t = tiles(buildShareCardHTML(SAMPLE, {}))
  assert.equal(Number(find(t, '已记住').value) + Number(find(t, '还在攻克').value), 74)
})

test('⛔ 分享卡上每个数字只能出现一次（顶部与三格大格已合并去重，不许上下重复）', () => {
  const t = tiles(buildShareCardHTML(SAMPLE, {}))
  const labels = t.map((x) => x.label)
  const dup = labels.filter((l, i) => labels.indexOf(l) !== i)
  assert.deepEqual(dup, [], `同一张卡片上重复出现的数字：${[...new Set(dup)].join('、')} —— r132 已把 tri-row 并入顶部 kpi-row3`)
  assert.equal(t.length, 5, `去重后应恰好 5 个数字格（完成作业/批改题量/新增错题/已记住/还在攻克），实测 ${t.length}`)
})

test('⛔ 周期对比里的「还在攻克」也必须走三态字段（不是 pendingCount）', () => {
  const prev = { stats: { ...SAMPLE.stats, masteredCount: 1, basicMasteredCount: 10, notStartedCount: 69, pendingCount: 79 } }
  const html = buildShareCardHTML({ ...SAMPLE, prev }, {})
  assert.match(html, /cmp-l">还在攻克</, '对比四宫格必须改用「还在攻克」')
  assert.doesNotMatch(html, /cmp-l">待提升错题</, '「待提升错题」不得回到对比里')
  assert.match(html, /cmp-l">还在攻克<\/div><div class="cmp-v">58/, '本期还在攻克必须显示 58')
})

test('⛔ 历史数据缺 basicMasteredCount/notStartedCount 时按 0 兜底，不得渲染出 NaN/undefined', () => {
  const html = buildShareCardHTML({
    ...SAMPLE,
    stats: { totalQuestions: 10, accuracy: 0, newWrongCount: 10, masteredCount: 3, pendingCount: 7 }
  }, {})
  assert.doesNotMatch(html, /NaN/, '缺字段不得渲染 NaN')
  assert.doesNotMatch(html, /undefined/, '缺字段不得渲染 undefined')
  assert.equal(find(tiles(html), '已记住')?.value, '3', '无基本掌握时已记住 = 完全掌握 3')
  assert.equal(find(tiles(html), '还在攻克')?.value, '0')
})

// ── ② 学习诊断 PDF（另一份家长转发物）：口径必须和分享卡一致 ──
// 注：weeklyReportGenerator.js 属移动端赛道，本锁只读不写，只守口径不被静默改回去。
const PDF = read('src/utils/weeklyReportGenerator.js')
// 注释里允许提旧口径（那是缺陷说明），判据只扫**代码**。
const PDF_CODE = PDF
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

test('⛔ PDF 第三格必须是「还在攻克」且走 notStartedCount（与分享卡同一口径）', () => {
  assert.match(PDF_CODE, /tri-l"[^>]*>还在攻克</, 'PDF 第三格标签必须是「还在攻克」')
  assert.match(PDF_CODE, /tri-v"[^>]*">\$\{stats\.notStartedCount/,
    'PDF 第三格数值必须走 notStartedCount —— 用 pendingCount 会把已记住的题重复算一遍')
  assert.doesNotMatch(PDF_CODE, /待提升错题/, '「待提升错题」不得回到 PDF')
  assert.doesNotMatch(PDF_CODE, /tri-l"[^>]*>完全掌握</, '「完全掌握」不得作为 PDF 三格标签')
})

test('⛔ PDF 的「已记住」格必须用 mastered+basic（不能退回只算 mastered）', () => {
  assert.match(PDF_CODE, /tri-l"[^>]*>已记住的错题</, 'PDF 必须有「已记住的错题」格')
  assert.match(PDF_CODE, /\$\{\(stats\.masteredCount \|\| 0\) \+ \(stats\.basicMasteredCount \|\| 0\)\}/,
    'PDF 已记住格必须含 basicMasteredCount')
})

// ── ③ 反向自检：合成旧口径坏样本，喂进同一套判据必须判红 ──
// ⚠️ 本锁的关键：证明判据真的会红，而不是写了永不触发的空断言。
test('⛔ 反向自检：旧口径产出物喂进来，判据必须判红（证明锁不空转）', () => {
  // 坏样本 1：旧分享卡 —— 只有「完全掌握 2 / 待提升错题 72」，且数字上下重复出现
  const LEGACY_CARD = [
    '<div class="kpi-row2">',
    '<div class="kpi"><div class="kpi-v" style="color:#A66A24">10<small> 题</small></div><div class="kpi-l">新增错题</div></div>',
    '<div class="kpi"><div class="kpi-v" style="color:#4CAF50">2<small> 题</small></div><div class="kpi-l">完全掌握</div></div>',
    '</div>',
    '<div class="tri"><div class="tri-v" style="color:#4CAF50">2<small> 题</small></div><div class="tri-l" style="color:#4CAF50">完全掌握</div></div>',
    '<div class="tri"><div class="tri-v" style="color:#0A5052">72<small> 题</small></div><div class="tri-l" style="color:#0A5052">待提升错题</div></div>'
  ].join('')
  const lt = tiles(LEGACY_CARD)
  assert.equal(find(lt, '已记住'), undefined, '旧卡片确实没有「已记住」→ 缺陷本身，锁必须能抓到')
  assert.equal(find(lt, '完全掌握')?.value, '2', '旧卡片的「完全掌握」就是被低估的那个数')
  const dupLabels = lt.map((x) => x.label).filter((l, i, a) => a.indexOf(l) !== i)
  assert.ok(dupLabels.length > 0, '旧卡片确实存在上下重复的数字 → 去重判据必须能抓到')

  // 同一套判据跑新渲染结果：三态齐全且无重复
  const fresh = tiles(buildShareCardHTML(SAMPLE, {}))
  assert.equal(fresh.length, 5, '新卡片恰好 5 格')
  assert.equal(find(fresh, '已记住')?.value, '16')
  assert.equal(find(fresh, '还在攻克')?.value, '58')

  // 坏样本 2：旧口径 PDF 第三格 —— pendingCount + 「待提升错题」
  const LEGACY_PDF_TILE = '<div class="tri"><div class="tri-v" style="color:#0F6B6D">${stats.pendingCount}<span> 题</span></div><div class="tri-l" style="color:#0A5052">待提升错题</div></div>'
  assert.doesNotMatch(LEGACY_PDF_TILE, /tri-l"[^>]*>还在攻克</, '旧 PDF 片段没有「还在攻克」→ 锁必须能抓到')
  assert.match(LEGACY_PDF_TILE, /tri-l"[^>]*>待提升错题</, '旧 PDF 片段确实写着「待提升错题」→ 锁必须能抓到')
  assert.doesNotMatch(LEGACY_PDF_TILE, /tri-v"[^>]*">\$\{stats\.notStartedCount/, '旧 PDF 片段不走 notStartedCount → 锁必须能抓到')

  // 同样的判据套在新 PDF 上必须全过（证明注入真的生效，不是判据恒假）
  assert.match(PDF_CODE, /tri-l"[^>]*>还在攻克</)
  assert.match(PDF_CODE, /tri-v"[^>]*">\$\{stats\.notStartedCount/)
})
