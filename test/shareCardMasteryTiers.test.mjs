/**
 * 回归锁：家长分享卡「掌握度三态」口径（r132，2026-10-05）
 *
 * 起因（r130 遗留、本轮实测复现）：
 *   学习诊断页（r130/r133）把「基本掌握」拆出来了，但**家长分享卡没跟**。
 *   分享卡是老师唯一转发给家长的输出物，实测渲染结果是：
 *       「完全掌握 2 题」/「待提升错题 72 题」（旧模板只认 masteredCount 一个字段）
 *   而后端 fetchStudentWeeklyReport 早就把 basicMasteredCount / notStartedCount
 *   一起返回了 —— 模板直接忽略，答对过一次的 14 道被并进「待提升」。
 *   ⇒ 家长被告知孩子 74 道里只记住 2 道，实际记住 16 道（低估 8 倍）。
 *
 * 判据设计：
 *   - buildShareCardHTML 是**纯函数**（不连库），因此这里**真跑渲染**再断言输出 HTML，
 *     不是源码 grep —— 改错了会立刻红，改对了才绿。
 *   - 反向自检用**内联合成坏样本**（legacy 卡片 HTML），不依赖 git 历史
 *     （r113q 教训：旧树每轮从 HEAD 重导会让历史修复合入后误报 0 红）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

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

/**
 * 从渲染出的 HTML 里抽出三态大格（tri-tile）的 {value, label}。
 * 真卡片与坏样本共用同一个解析器 —— 保证判据对两者一视同仁。
 */
function triTiles(html) {
  return html.split('<div class="tri"').slice(1).map((p) => {
    const v = (p.match(/tri-v"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''
    const l = (p.match(/tri-l"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || ''
    return { value: String(v).replace(/<small>[\s\S]*/, '').trim(), label: String(l).trim() }
  })
}

const findTile = (tiles, label) => tiles.find((t) => t.label === label)

test('⛔ 分享卡必须显示「已记住」= 完全+基本，且数值是 16 不是 2', () => {
  const tiles = triTiles(buildShareCardHTML(SAMPLE, {}))
  const secured = findTile(tiles, '已记住')
  assert.ok(secured, `卡片三态大格里没有「已记住」（实际标签：${tiles.map((t) => t.label).join('/')}）`)
  assert.equal(secured.value, '16', '已记住必须 = 完全掌握 2 + 基本掌握 14 = 16')
})

test('⛔ 分享卡第三格必须是「还在攻克」（只数还没答对过的），不是把基本掌握吞进去的「待提升错题」', () => {
  const tiles = triTiles(buildShareCardHTML(SAMPLE, {}))
  const ns = findTile(tiles, '还在攻克')
  assert.ok(ns, `卡片三态大格里没有「还在攻克」（实际：${tiles.map((t) => t.label).join('/')}）`)
  assert.equal(ns.value, '58', '还在攻克必须 = 待复习 58，不能是 pendingCount 72')
  // 旧口径残留：这两个文案出现即视为缺陷复发
  for (const legacy of ['完全掌握', '待提升错题']) {
    for (const t of tiles) {
      assert.notEqual(t.label, legacy, `「${legacy}」是 r132 已修的旧口径，不得回到卡片上`)
    }
  }
})

test('⛔ 已记住 + 还在攻克 必须等于新增错题（不得凭空多算/漏算）', () => {
  const tiles = triTiles(buildShareCardHTML(SAMPLE, {}))
  const secured = Number(findTile(tiles, '已记住').value)
  const ns = Number(findTile(tiles, '还在攻克').value)
  assert.equal(secured + ns, 74, `已记住 ${secured} + 还在攻克 ${ns} 必须等于新增错题 74`)
  // 上周期口径里 pendingCount=72 是「基本+待复习」，本轮它不再单独出格 ——
  // 若有人把它改回三格，和就会变成 74+16+58+72 那种凭空翻倍的假账。
  assert.equal(tiles.length, 3, `三态大格应恰好 3 格（新增错题/已记住/还在攻克），实测 ${tiles.length} 格`)
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
  assert.equal(findTile(triTiles(html), '已记住')?.value, '3', '无基本掌握时已记住 = 完全掌握 3')
  assert.equal(findTile(triTiles(html), '还在攻克')?.value, '0')
})

// ── 反向自检：合成旧口径坏样本，喂进同一套判据必须判红 ──
// ⚠️ 这是本锁的关键：证明判据真的会红，而不是写了永不触发的空断言。
test('⛔ 反向自检：把旧口径卡片喂进来，判据必须判红（证明锁不空转）', () => {
  const LEGACY_HTML = `<div class="card"><div class="tri-row">
    <div class="tri" style="background:#FBF4E8"><div class="tri-v" style="color:#A66A24">74<small> 题</small></div><div class="tri-l" style="color:#A66A24">新增错题</div></div>
    <div class="tri" style="background:#EAF6EA"><div class="tri-v" style="color:#4CAF50">2<small> 题</small></div><div class="tri-l" style="color:#4CAF50">完全掌握</div></div>
    <div class="tri" style="background:#EEF7F5"><div class="tri-v" style="color:#0A5052">72<small> 题</small></div><div class="tri-l" style="color:#0A5052">待提升错题</div></div>
  </div></div>`

  const tiles = triTiles(LEGACY_HTML)
  // 判据 1：旧卡片根本不存在「已记住」这格
  assert.equal(findTile(tiles, '已记住'), undefined, '旧口径卡片确实没有「已记住」→ 缺陷本身，锁必须能抓到')
  // 判据 2：旧卡片有「完全掌握 2」—— 这正是被低估的那个数
  assert.equal(findTile(tiles, '完全掌握')?.value, '2')
  assert.equal(findTile(tiles, '待提升错题')?.value, '72')
  // 判据 3：新模板的渲染结果必须与旧卡片**不同** → 说明修复真的动了行为
  const fresh = triTiles(buildShareCardHTML(SAMPLE, {}))
  assert.notDeepEqual(fresh, tiles, '修复后的卡片不得与旧口径卡片同形')
  // 判据 4：坏样本里「已记住」缺 ⇒ 用新树的判据去验坏样本必然为假
  assert.equal(findTile(fresh, '已记住')?.value === findTile(tiles, '已记住')?.value, false)
})
