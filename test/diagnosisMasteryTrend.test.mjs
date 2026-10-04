/**
 * 回归锁：学习诊断「掌握度三态 + 周期趋势折线图」（r130，2026-10-04）
 *
 * 起因（负责人截图质疑）：
 *   ① 「完全掌握 2」对不对？基本掌握是不是没计入？
 *      实测陆晨曦 74 道错题 = 完全掌握 2 + 基本掌握 14 + 待复习 58，
 *      旧页面只显示「完全掌握 2 / 待提升 72」——「基本掌握」这层在页面上没有出口。
 *   ② 页面没有折线图。实测比「没有」更糟：旧代码读 point.day / point.total，
 *      后端返回 {date, accuracy, count}，字段名对不上，趋势图恒为 4% 空柱。
 *
 * 判据设计说明：
 *   - 三态函数用**内联合成样本**断言，不连库（CI 无 DB）。
 *   - 反向自检不依赖 git 历史（旧树每轮从 HEAD 重导会让历史修复合入后误报 0 红），
 *     改为把「坏样本」直接喂进被测函数，判定它必须判错。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const SERVER = read('server/routes/weeklyReport.js')
const VIEW = read('src/workbench/views/WeeklyReportWorkbench.vue')
const TROPHY = read('src/workbench/components/diagnosis/TrophyBar.vue')
const LINE = read('src/workbench/components/diagnosis/TrendLineChart.vue')

// ── ① 三态拆分纯函数：行为锁定（真跑，不靠正则）──
const { splitMasteryStates } = await import('../server/routes/weeklyReport.js')

test('⛔ 基本掌握（review_1）必须有独立出口，不能并进「完全掌握」或消失', () => {
  const r = splitMasteryStates([
    { lifecycle_status: 'mastered', count: 2 },
    { lifecycle_status: 'review_1', count: 14 },
    { lifecycle_status: 'new', count: 58 }
  ])
  assert.equal(r.masteredCount, 2, '完全掌握只数 mastered')
  assert.equal(r.basicMasteredCount, 14, '基本掌握 14 道必须被单独拆出来')
  assert.equal(r.notStartedCount, 58, '待复习 58 道（一次都没对过）')
  // 关键不变量：旧字段语义一字未动，老消费方（移动端 PDF / 分享卡）零影响
  assert.equal(r.pendingCount, 72, 'pendingCount 仍 = 基本 + 待复习 = 14+58')
  assert.equal(
    r.masteredCount + r.pendingCount,
    74,
    '三态之和必须等于错题总数，不得凭空多算或漏算'
  )
})

test('⛔ review_2（历史残留枚举）按基本掌握语义计入，不得当完全掌握', () => {
  const r = splitMasteryStates([
    { lifecycle_status: 'mastered', count: 1 },
    { lifecycle_status: 'review_2', count: 3 },
    { lifecycle_status: null, count: 2 }
  ])
  assert.equal(r.masteredCount, 1, 'review_2 不得冒充完全掌握')
  assert.equal(r.basicMasteredCount, 3, 'review_2 计入基本掌握')
  assert.equal(r.notStartedCount, 2, 'NULL（历史无状态）算待复习')
  assert.equal(r.pendingCount, 5)
})

test('⛔ 空输入 / 缺字段不得抛异常（三态图是空态渲染路径）', () => {
  // 逐个喂边界样本：空数组 / null / undefined / 缺 lifecycle_status 的行
  for (const input of [[], null, undefined, [{ count: 3 }]]) {
    const r = splitMasteryStates(input)
    for (const key of ['masteredCount', 'basicMasteredCount', 'notStartedCount', 'pendingCount']) {
      assert.equal(typeof r[key], 'number', `${key} 必须是数字（输入 ${JSON.stringify(input)}）`)
    }
    // 恒等式：完全掌握 + 基本 + 待复习 === pendingCount + masteredCount
    assert.equal(
      r.masteredCount + r.basicMasteredCount + r.notStartedCount,
      r.pendingCount,
      `三态之和必须等于 pendingCount + masteredCount（输入 ${JSON.stringify(input)}）`
    )
  }
  assert.deepEqual(splitMasteryStates([]), {
    masteredCount: 0, basicMasteredCount: 0, notStartedCount: 0, pendingCount: 0
  })
  // 缺 lifecycle_status 的行归入「待复习」，不凭空变成已掌握
  assert.equal(splitMasteryStates([{ count: 3 }]).notStartedCount, 3)
})

test('⛔ 后端三处调用点必须全用 splitMasteryStates（防新增调用点漏改）', () => {
  const uses = SERVER.match(/splitMasteryStates\(/g) || []
  // 1 次定义 + 3 次调用（fetchStudentWeeklyReport / 汇总列表 / fetchPeriodCompare）
  assert.ok(uses.length >= 4, `只找到 ${uses.length} 处，期望 ≥4（1 定义 + 3 调用）`)
  // 旧的「只判 mastered、else 全并 pendingCount」写法必须已消失。
  // splitMasteryStates 自身内部有且仅有一处合法判定，故先切掉函数体再扫。
  // ⚠️ 切边界必须用正则匹配「行首的 }」而不是 indexOf('\n}\n')——
  //    本仓 .vue/.js 可能是 CRLF 行尾（实测 weeklyReport.js 就是），
  //    '\n}\n' 匹配不到会返回 -1，fnEnd 变成 2 ⇒ 切出来的「函数外」
  //    反而包含了整个函数体 ⇒ 锁永远误报 1 处残留。r136 实测踩过。
  const fnStart = SERVER.indexOf('export function splitMasteryStates')
  assert.ok(fnStart > 0, '找不到 splitMasteryStates 定义')
  const rest = SERVER.slice(fnStart)
  const closer = rest.search(/\r?\n\}\r?\n/)   // 行首的 } （兼容 CRLF）
  assert.ok(closer > 0, '找不到 splitMasteryStates 的结束花括号')
  const outside = SERVER.slice(0, fnStart) + rest.slice(closer)
  const legacy = outside.match(/lifecycle_status\s*===\s*'mastered'/g) || []
  assert.equal(legacy.length, 0, `函数体之外仍有 ${legacy.length} 处旧口径残留`)
})

test('⛔ stats 必须同时给出三态字段（前端与分享卡都靠它）', () => {
  for (const field of ['masteredCount', 'basicMasteredCount', 'notStartedCount', 'pendingCount']) {
    assert.ok(SERVER.includes(`${field},`), `stats 缺字段 ${field}`)
  }
  assert.ok(SERVER.includes('periodTrend'), '必须返回 periodTrend 供折线图消费')
})

// ── ② 趋势图：字段名对不对齐（这正是旧版的真缺陷）──
// r132 更新：数据源从 periodTrend 扩到 dailyAccuracy/weeklyAccuracy（按天/按周切换），
// 但**过滤口径的判据不变** —— 必须按 count 过滤、不得回退到 point.total / point.day。
test('⛔ 折线图必须消费后端真实字段 date/count（不是 day/total）', () => {
  assert.ok(SERVER.includes('date: k') || SERVER.includes('date:'), '后端趋势点必须有 date')
  // 前端按 count 过滤有效点（变量名随粒度切换改过，判据锚在 filter 本身）
  assert.match(VIEW, /filter\(point => point[\s\S]{0,40}point\.count > 0/,
    '前端仍按 point.count 过滤 —— 若这里写回 point.total 就是旧缺陷复发')
  // 旧字段名不得再出现在**模板/脚本**里（注释里允许提及，那是缺陷说明）
  const codeOnly = VIEW
    .replace(/<!--[\s\S]*?-->/g, '')   // 去模板注释
    .replace(/^\s*\/\/.*$/gm, '')      // 去整行 JS 注释
    .replace(/\/\*[\s\S]*?\*\//g, '')  // 去块注释
  assert.doesNotMatch(codeOnly, /point\.total/, 'point.total 是旧缺陷字段名，代码里必须清除')
  assert.doesNotMatch(codeOnly, /point\.day\b/, 'point.day 也是旧缺陷字段名，代码里必须清除')
})

// ── ②b r132：按天 / 按周粒度切换 ──
test('⛔ 必须同时提供按天与按周两套序列（页面切换不能靠重新请求）', () => {
  assert.match(SERVER, /dailyAccuracy/, '后端必须返回 dailyAccuracy')
  assert.match(SERVER, /weeklyAccuracy/, '后端必须返回 weeklyAccuracy')
  // 两套都要含 correct（折线图 tooltip 要显示「答对/总题」）
  assert.match(SERVER, /correct: r\.correct/, '趋势点必须带 correct 字段供 tooltip 显示分数')
})

test('⛔ 不许补空日：当天没批改不是「全错」，补 0 会让家长误读', () => {
  // 正确做法：SQL 只 GROUP BY 实际有数据的日期，空日自然不出现
  assert.match(SERVER, /AT TIME ZONE 'Asia\/Shanghai'\)::date/, '按天必须按本地时区切自然日')
  assert.doesNotMatch(SERVER, /generate_series[\s\S]{0,200}LEFT JOIN/, '不得用日历表补空日')
  // 前端过滤时也必须剔掉 count=0 / accuracy=null
  assert.match(VIEW, /point && point\.count > 0 && point\.accuracy != null/, '前端必须同时过滤 count=0 与 accuracy=null')
})

test('⛔ 粒度切换默认「按天」（按周会把单日崩盘抹平）', () => {
  assert.match(VIEW, /trendGranularity = ref\('day'\)/, '默认必须是按天')
  assert.match(VIEW, /trend-switch__btn/, '必须有粒度切换按钮')
  // 按天不得报「涨跌」—— 单日样本量小（曾见某天只做 2 题对 1 道 = 50%），
  // 拿它讲「下降 X%」是误导。只报区间。
  assert.match(VIEW, /const isDay = trendGranularity\.value === 'day'/, '按天与按周的 summary 口径必须区分')
  assert.match(VIEW, /最高 \$\{highest\.accuracy\}%/, '按天应报最高/最低而非涨跌')
})

test('⛔ 旧字段 periodTrend / dailyTrend 不得删除（PDF 侧仍在消费）', () => {
  assert.match(SERVER, /periodTrend,/, 'periodTrend 必须保留（向后兼容）')
  assert.match(SERVER, /dailyTrend,/, 'dailyTrend 必须保留（PDF 折线图数据源）')
  // 但前端不再以 dailyTrend 为首选（它的字段名曾与前端错配）
  assert.match(VIEW, /detail\.dailyAccuracy \|\| \[\]/, '前端应优先用 r132 的 dailyAccuracy')
})

test('⛔ 折线图在周/月/全部三档都要出图，不得只渲染周模式', () => {
  // 旧版整块包在 v-if="periodMode === 'week'" 里，月/全部无图
  assert.doesNotMatch(LINE, /periodMode/, '图表组件内不该再按 mode 门禁')
  assert.match(VIEW, /trend-line-card/, '单生页必须有折线图卡片')
  // 后端 periodTrend 不得再按 isWeekMode 短路成空数组
  assert.match(SERVER, /periodTrend\s*=\s*buildPeriodTrend|periodTrend = buildDailyTrend/,
    'periodTrend 必须真的有赋值分支')
  assert.doesNotMatch(SERVER, /const dailyTrend = isWeekMode \? buildDailyTrend\(trendRows, periodStart\) : \[\]\s*\n\s*\n?.*periodTrend: \[\]/,
    'periodTrend 不能是空数组常量')
})

test('⛔ 折线图不许伪造数据：无题量的点不画、单点不画假趋势', () => {
  assert.match(LINE, /Number\(p\.count\) > 0/, '必须过滤掉没有题量的桶')
  assert.match(LINE, /p\.accuracy != null/, 'accuracy 为 null 的点必须排除，不得插值补齐')
  assert.match(LINE, /coords\.length === 1/, '单点必须有独立说人话的分支，不能画成一条假折线')
  // 纵轴固定 0-100%，不得自适应放大差异
  assert.match(LINE, /1 - Math\.max\(0, Math\.min\(100, acc\)\) \/ 100/, '纵轴必须锁 0-100%')
})

// ── ③ 页面信心口径（r133 更新：按负责人决策改口径 + 组件更名）──
// r133 口径决策：主数字 = **已记住**（答对 1 次），「完全掌握」（答对 2 次）降级为徽章。
//   现实里没时间让每道题都做两次；答对一次就是记住了，
//   拿「完全掌握 2 道」当主数字会严重低估孩子、也让家长看不到信心。
//   组件同步更名：MasteryBar → TrophyBar（不只是改名，是重写了「已练口径」）。
test('⛔ 页面主数字必须是「已记住」= 完全 + 基本（不能退回只显示完全掌握）', () => {
  assert.match(VIEW, /securedCount: mastered \+ basic/, '单生 hero 必须有 securedCount')
  assert.match(VIEW, /securedCount: totals\.mastered \+ totals\.basic/, '全班概览必须有 securedCount')
  assert.ok(VIEW.includes('已记住'), '页面必须出现「已记住」这个口径')
  assert.ok(VIEW.includes('还在攻克'), '第三个 KPI 必须是「还在攻克」而不是「待复习」（语义更准）')
  // 战果条组件必须在（r133 已从 MasteryBar 改名 TrophyBar）
  assert.match(VIEW, /<TrophyBar/, 'hero 必须挂战果条')
  assert.match(TROPHY, /已拿下/, '战果条要说清「已拿下 N 道」')
  assert.match(TROPHY, /道彻底掌握/, '彻底掌握作为小徽章存在，不是主数字')
  // 已练口径：不能只给「74 道里拿下 16 道 = 22%」那种被稀释的口径
  assert.match(TROPHY, /练过/, '战果条必须给出已练口径（练过 N 道 · 拿下 M 道）')
})

test('⛔ 战果条三段都要有（缺一段就退回成两格老样子）', () => {
  for (const seg of ['彻底掌握', '已记住', '还在攻克']) {
    assert.ok(TROPHY.includes(seg), `战果条缺「${seg}」段`)
  }
})

// ── ④ 回归锁自身：反向自检（内联合成坏样本，不依赖 git）──
test('⛔ 反向自检：把坏样本喂进判据必须判红（证明锁真的会红）', () => {
  // 坏样本 1：把基本掌握并回 pendingCount 的旧口径
  const legacySplit = (rows) => {
    let masteredCount = 0, pendingCount = 0
    for (const r of rows) {
      if (r.lifecycle_status === 'mastered') masteredCount += r.count
      else pendingCount += r.count
    }
    return { masteredCount, basicMasteredCount: 0, notStartedCount: pendingCount, pendingCount }
  }
  const rows = [
    { lifecycle_status: 'mastered', count: 2 },
    { lifecycle_status: 'review_1', count: 14 },
    { lifecycle_status: 'new', count: 58 }
  ]
  assert.equal(legacySplit(rows).basicMasteredCount, 0, '旧口径下「基本掌握」确实为 0（这就是缺陷本身）')
  assert.notDeepEqual(legacySplit(rows), splitMasteryStates(rows), '新口径必须与旧口径不同 → 说明这次修复真的动了行为')

  // 坏样本 2：把 null 当成「答对过」也算错——必须归到待复习
  assert.equal(splitMasteryStates([{ lifecycle_status: null, count: 5 }]).notStartedCount, 5)

  // 坏样本 3：全 mastered 时不能凭空调出基本掌握
  assert.equal(splitMasteryStates([{ lifecycle_status: 'mastered', count: 9 }]).basicMasteredCount, 0)
})
