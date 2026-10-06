/**
 * 考法库 r218 回归锁：数据断层 + 信息架构
 *
 * 起因（负责人原话）：「我的考点库布局很奇怪，用的不顺手」。
 * 评审结论：**主因不是布局**，是一个写入参数断层 + 4 个平级模式并列。
 *
 * 本锁覆盖 6 条，缺一条就会静默退化（且都不报错、测试全绿）：
 *   1. autoOrganize 必须**显式**传 apply（铁律 9 的前端侧变体）
 *   2. 预演（apply=false）不得跳模式、不得弹「已更新」
 *   3. onMounted 不得静默跑 autoOrganize（白烧 AI 费用且写不了库）
 *   4. hot-kp 必须按**错题量**排序，不是题库量（否则默认落在泛代数词）
 *   5. kp-questions 必须回传 totalMatched/truncated（铁律 12：截断须显式说）
 *   6. 考点选择器只列有错题的节点 + 必须有 watch(route.query)（铁律 13）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VUE = readFileSync(
  resolve(ROOT, 'src/workbench/views/QuestionBankWorkbench.vue'), 'utf8')
const ROUTE = readFileSync(
  resolve(ROOT, 'server/routes/teachingQuestionTypes.js'), 'utf8')

//⛔ 判据只扫**代码**，不看注释：r218 的注释里故意留着 activeMode / autoOrganize 等旧名做说明，
//   若连注释一起匹配，改注释就会假红。逐行剥掉 // 与 /* */ 注释后再判。
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n')
const VUE_CODE = stripComments(VUE)
const ROUTE_CODE = stripComments(ROUTE)

// ── 1. apply 必须显式传（r218 修掉的真事故）──────────────────────────
test('考法库：调auto-organize 必须显式传 apply', () => {
  // 旧实现：body:JSON.stringify({days:14})—— 不带 apply ⇒ 后端 apply 默认 false
  //⇒ dryRun=true ⇒ AI 跑完丢弃、created=0，但前端弹「已更新」。
  assert.doesNotMatch(
    VUE_CODE,
    /JSON\.stringify\(\{\s*days:\s*14\s*\}\)/,
    '调 auto-organize 不能只传 {days:14}：不传 apply 时后端默认 dryRun=true，AI 跑完结果直接丢弃。必须显式写 apply。',
  )
  assert.match(
    VUE_CODE,
    /JSON\.stringify\(\{[^}]*apply:\s*false[^}]*\}\)/,
    '预演轮必须显式传 apply:false。',
  )
  assert.match(
    VUE,
    /JSON\.stringify\(\{[^}]*apply:\s*true[^}]*\}\)/,
    '写入轮必须显式传 apply:true，且必须由老师再点一次确认（不能默认就写）。',
  )
})

// ── 2. created=0 不许跳模式、不许假装成功 ─────────────────────────────
test('考法库：预演不得无条件切到待确认页', () => {
  // 旧实现：autoOrganize 里 `activeMode.value='recommended'` 是**无条件**的，
  //   哪怕 created=0 也跳过去，老师看到的是一个空列表 ⇒ 更确信「这功能没用」。
  assert.doesNotMatch(
    VUE_CODE,
    /function\s+runOrganize[\s\S]{0,900}?\n\s*activeMode\.value\s*=\s*'recommended'/,
    'runOrganize 里不得无条件切activeLine/subMode 到待确认页：created=0 时老师只会看到空列表。',
  )
  assert.match(
    VUE_CODE,
    /organizeReport/,
    '预演结果必须落进organizeReport 供抽屉展示（results/rejected/errors 不能像旧实现那样丢掉）。',
  )
  assert.match(
    VUE_CODE,
    /organizeReport\.applied\s*\?/,
    '抽屉必须区分「已写入」与「这是预演」两种状态，不能用同一句「已更新」糊过去。',
  )
})

// ── 3. onMounted 不得静默跑整理（r145 加的autoOrganize(true) 已移除）──
test('考法库：onMounted 不得静默调runOrganize', () => {
  const mount = VUE_CODE.slice(VUE_CODE.indexOf('onMounted(async()=>'))
  assert.doesNotMatch(
    mount,
    /runOrganize\(\)/,
    'onMounted 不得触发整理：它每次开页面都白跑一次 AI 归纳（5 考点 × 27-48s、还要花钱），且预演结果没人看。',
  )
})

// ── 4. hot-kp 按错题量排序（r218 换判据）─────────────────────────────
test('考法库：hot-kp 必须按错题量排序，不是题库量', () => {
  const hot = ROUTE_CODE.slice(ROUTE_CODE.indexOf("router.get('/hot-kp'"))
  const end = hot.indexOf('})', hot.indexOf('res.json'))
  const body = hot.slice(0, end)
  assert.match(
    body,
    /wrong_questions/,
    'hot-kp 必须 join wrong_questions 取真实错题量。',
  )
  assert.match(
    body,
    /ORDER BY\s+wrong_count\s+DESC/,
    'hot-kp 必须按错题量排序。旧判据按题库量排序会落「实数」(475题)，而它的 8 个共现邻居实测全是泛代数词。',
  )
  assert.match(
    body,
    /HAVING\s+COUNT\(DISTINCT\s+wq\.id\)\s*>\s*0/,
    'hot-kp 必须排除零错题考点，否则会落到从没考过的泛节点上。',
  )
})

// ── 5. 拉题截断必须显式（铁律 12）────────────────────────────────────
test('考法库：kp-questions 必须回传 totalMatched 与 truncated', () => {
  const route = ROUTE_CODE.slice(ROUTE_CODE.indexOf("router.get('/kp-questions'"))
  assert.match(
    route,
    /total_matched/,
    'kp-questions 必须统计命中总数 total_matched，否则前端无法提示截断（实测「实数」435 道只返回 120）。',
  )
  assert.match(
    route,
    /truncated:\s*totalMatched\s*>\s*rows\.length/,
    'scope 必须回传 truncated，供 UI 显式提示「还有 N 道未显示」。',
  )
  assert.match(
    VUE_CODE,
    /kpScope\?\.truncated/,
    '前端必须按 truncated 显示截断提示，不能静默丢题。',
  )
  assert.match(
    VUE_CODE,
    /还有\s*<strong>\{\{[^}]*\}\}<\/strong>\s*道未显示/,
    '截断提示必须说清「还有多少道未显示」，不能只说「已截断」。',
  )
})

// ⛔ 防回归：totalMatched 必须在 onlyWrong 过滤**之后**统计。
//   r218 实测踩过：最初把 totals 建在 filtered 之前，
//   导致 onlyWrong=0 与 =1 都返回 435（等于没筛）。
test('考法库：totalMatched 必须在 onlyWrong/days 过滤之后统计', () => {
  const route = ROUTE_CODE.slice(ROUTE_CODE.indexOf("router.get('/kp-questions'"))
  const filteredAt = route.indexOf('filtered AS (')
  const totalsAt = route.indexOf('totals AS (')
  const filteredUsesOnlyWrong = route.indexOf('$4::boolean', filteredAt)
  assert.ok(filteredAt > -1, '必须有 filtered CTE 先应用 onlyWrong/days。')
  assert.ok(totalsAt > filteredAt, 'totals 必须在 filtered 之后。')
  assert.ok(
    filteredUsesOnlyWrong > filteredAt && filteredUsesOnlyWrong < totalsAt,
    'filtered 必须真的用上$4（onlyWrong），否则 totalMatched 不过滤、等于没筛。',
  )
})

// ── 6. 考点选择器 + 铁律 13 ──────────────────────────────────────────
test('考法库：考点选择器默认只列有错题的考点', () => {
  assert.match(
    VUE_CODE,
    /kpRank\.value\.filter\(k\s*=>\s*k\.wrong_count\s*>\s*0\)/,
    '默认必须过滤成只显示有错题的考点（实测 521 个节点里只有 151 个有错题，其余 370 个是死选项）。',
  )
  assert.match(
    VUE_CODE,
    /kpStats\.deadOptions/,
    '必须如实告诉老师有多少个考点暂未涉及，不能假装全部都有内容。',
  )
  assert.match(
    ROUTE_CODE,
    /ORDER BY\s+wrong_count\s+DESC[\s\S]{0,400}?kp\.sort_order/,
    'kp-ranking 必须按错题量 DESC 排序：老师要的是「我错过的地方」，不是「题库最大的地方」。',
  )
})

test('考法库：必须有 watch(route.query)（铁律 13）', () => {
  assert.match(
    VUE_CODE,
    /watch\(\(\)\s*=>\s*\[route\.query\./,
    '入口参数必须 mount + watch 双路（铁律 13）：hash 路由同页改 query 时 onMounted 不再跑，缺 watch 会让参数静默失效。',
  )
  assert.match(
    VUE_CODE,
    /function\s+applyRouteQuery/,
    'route.query 的读取必须收敛到一个函数，供 mount 与 watch 共用（同一件事只准一个实现）。',
  )
})

// ── 7. 信息架构：4 个平级模式已并成 2 条业务线 ──────────────────────
test('考法库：4 个平级模式必须并成 2 条业务线', () => {
  assert.doesNotMatch(
    VUE_CODE,
    /activeMode/,
    'activeMode 四值（graph/recommended/library/knowledge）已废除：它把 2 条业务线压成 4 个平级视图。',
  )
  assert.doesNotMatch(
    VUE_CODE,
    /setMode\(/,
    'setMode 已被 setLine / setSubMode 取代。',
  )
  assert.match(VUE_CODE, /activeLine/, '改为 activeLine（kp / kaofa）两条业务线。')
  assert.match(VUE_CODE, /class="line-switch"/, '必须有业务线切换导航。')
})

test('考法库：共现图不得有两套重复实现', () => {
  // 旧结构里 graph-workspace 与 library-workspace 各有一套 cooccur-body / cooccur-peer CSS，
  // 图 option 完全相同、k pQuestions 完全相同 —— 纯重复，且是「布局很奇怪」的直接来源。
  assert.doesNotMatch(
    VUE_CODE,
    /class="graph-body"/,
    'graph-body 已删除：关系图与按考点选题合并成一个工作台，不保留第二套图布局。',
  )
  assert.doesNotMatch(
    VUE_CODE,
    /\.graph-peers|\.graph-peer\b/,
    'graph-peers / graph-peer 样式已删除（共现邻居只有一套 cooccur-peer）。',
  )
  const peerLists = (VUE_CODE.match(/cooccurPeers/g) || []).length
  assert.ok(peerLists >= 2, 'cooccurPeers 必须同时驱动图与邻居列表（同一份数据）。')
})

test('考法库：出口必须常驻主区，不能只藏在详情里', () => {
  assert.match(
    VUE_CODE,
    /class="kp-actions-bar"/,
    '「送进周末班课件」必须常驻主区底部：旧实现藏在详情面板里，老师要点两层才找到唯一的出口。',
  )
  // 删掉考点面板里的三个「查看全部」深层跳转
  assert.doesNotMatch(
    VUE_CODE,
    /查看全部/,
    '「查看全部」深层跳转已删除：它从考点面板跳到另一个模式，是「不顺手」的主要来源。',
  )
})

test('考法库：统计块为 0 时不显示孤零零的 0', () => {
  assert.match(
    VUE_CODE,
    /summary\.recommendation_count\s*\|\|\s*'暂无'/,
    '统计值为 0 时写「暂无」而不是「0」——库里一条考法都没有时，三个 0 只会让老师以为功能坏了。',
  )
})