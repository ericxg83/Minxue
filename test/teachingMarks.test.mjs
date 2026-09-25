import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')

const MIGRATION_SRC = read('server/migrations/060_teaching_marks.js')
const ROUTE_SRC = read('server/routes/teachingMarks.js')
const LIB_SRC = read('server/lib/weekendHandout.js')
const INDEX_SRC = read('server/index.js')
const BOARD_SRC = read('src/workbench/views/WeekendBoard.vue')
const MARKS_SRC = read('src/workbench/views/useTeachingMarks.js')

/**
 * 白板「讲题状态」（2026-09-25）
 *
 * 背景：周末班白板此前是**无状态**的 —— 笔迹只落浏览器本机，题目上没有任何
 * 「讲过没有」的记录；取数只排除 lifecycle_status='mastered'，于是「讲过但学生
 * 还没被重练卷刷掉」的题每次打开都原样重现，老师只能靠脑子记，重复讲是机制性必然。
 *
 * 本测试锁定四条不变量（细节见 _周末班白板-讲题状态-产品评审-20260925.md）：
 *  1. 锚点稳定：标记与笔迹都挂 topicKey，绝不用运行时段内的 seq
 *  2. 零点击：判定只读「翻页 / 笔迹 / 看答案」三个客观信号，不要求老师点按钮
 *  3. 红线：只写 teaching_marks，不碰掌握度与判分字段
 *  4. 宁可不标：中间态不写标记，且自动判定不覆盖既有状态
 */

// ── 1. 迁移与注册 ────────────────────────────────────────────────

test('迁移060 必须注册进启动迁移链（否则线上建不出表，接口 503）', () => {
  assert.ok(
    INDEX_SRC.includes("from './migrations/060_teaching_marks.js'"),
    '必须 import migrateTeachingMarks'
  )
  assert.ok(
    INDEX_SRC.includes("['migrateTeachingMarks', migrateTeachingMarks]"),
    '必须注册进 runMigrations 清单'
  )
})

test('迁移060 是纯加法：只建表加索引，不改任何既有业务表', () => {
  assert.ok(MIGRATION_SRC.includes('CREATE TABLE IF NOT EXISTS teaching_marks'), '必须建表')
  assert.ok(MIGRATION_SRC.includes('CREATE UNIQUE INDEX IF NOT EXISTS uq_teaching_marks_anchor'), '必须有锚点唯一索引（upsert 冲突目标）')
  for (const t of ['wrong_questions', 'questions', 'students', 'knowledge_mastery']) {
    const re = new RegExp(`\\b(?:UPDATE|DELETE\\s+FROM|ALTER\\s+TABLE)\\s+${t}\\b`, 'i')
    assert.ok(!re.test(MIGRATION_SRC), `迁移不得改既有表 ${t}`)
  }
  // 状态枚举必须与前端四色一致
  assert.ok(
    MIGRATION_SRC.includes("CHECK (status IN ('new', 'done', 'rework', 'skip'))"),
    'status 枚举必须是 new/done/rework/skip（与前端四色一一对应）'
  )
})

// ── 2. 稳定锚点 ─────────────────────────────────────────────────

test('slide 必须下发稳定锚点，且锚点来自 topicKey 而不是 index', () => {
  assert.ok(LIB_SRC.includes('const anchorKey = t.key'), '锚点必须复用 topicKey（t.key）')
  assert.ok(LIB_SRC.includes('const anchorKeyAlt = mergeKeyOf(t)'), '必须下发完整题干兜底键')
  assert.ok(LIB_SRC.includes('anchorKey,'), 'slide 必须把 anchorKey 下发出去')
  // 防回归：index 是本次聚合内 seq++ 的顺序号，拿它当锚点会把标记挂到别的题上
  assert.ok(!/anchorKey:\s*(?:seq|t\.index|index)\b/.test(LIB_SRC), '锚点绝不能用 index/seq')
  assert.ok(LIB_SRC.includes('index: seq,'), 'index 本身要保留（前端 selected 仍按它传参）')
})

test('笔迹键必须从「时段+index」改为稳定锚点，并保留旧键一次性迁移', () => {
  assert.ok(BOARD_SRC.includes('wb_strokes_v2_'), '笔迹键必须换到 v2（锚点版）')
  assert.ok(BOARD_SRC.includes('legacyStrokesKey'), '必须保留旧键计算，供一次性迁移兜底')
  assert.ok(BOARD_SRC.includes("c.anchorKey"), '笔迹键必须取当前题的 anchorKey')
  // 旧键仍带 index，只能是 legacy 分支
  const legacyBlock = BOARD_SRC.match(/const legacyStrokesKey = computed\(\(\) => \{[\s\S]*?\n\}\)/)
  assert.ok(legacyBlock, '找到 legacyStrokesKey')
  assert.ok(legacyBlock[0].includes('_q${current.value.index}'), 'legacy 键仍是旧的 index 形式')
})

// ── 3. 红线：只写 teaching_marks ─────────────────────────────────

test('写入接口只写 teaching_marks，不得触碰掌握度与判分字段', () => {
  for (const t of ['wrong_questions', 'questions', 'students', 'knowledge_mastery', 'judgements']) {
    const re = new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${t}\\b`, 'i')
    assert.ok(!re.test(ROUTE_SRC), `写入接口不得写 ${t}（老师标记「讲过」≠ 学生会了）`)
  }
  assert.ok(ROUTE_SRC.includes('INSERT INTO teaching_marks'), '必须写 teaching_marks')
  assert.ok(ROUTE_SRC.includes('ON CONFLICT (anchor_key, scope_key) DO UPDATE'), '必须是幂等 upsert')
})

test('读侧把标记挂在 slide 上（不新增读接口，白板打开一次就拿全）', () => {
  assert.ok(LIB_SRC.includes('FROM teaching_marks'), 'buildHandout 必须读 teaching_marks')
  assert.ok(LIB_SRC.includes('markByAnchor'), '必须按锚点在内存 join')
  assert.ok(LIB_SRC.includes('reworkDue'), '必须下发「讲完还错」提示位')
  // 表未建 / 库抖动时不能阻断课件生成
  const start = LIB_SRC.indexOf('const markByAnchor = new Map()')
  const end = LIB_SRC.indexOf('// ── slides（PPT 渲染输入）──')
  assert.ok(start > 0 && end > start, '找到标记读取块')
  const block = LIB_SRC.slice(start, end)
  assert.ok(block.includes('catch'), '读标记失败必须降级为「全部未讲」而不是抛错')
})

// ── 4. 零点击判定 ───────────────────────────────────────────────

test('零点击：切题入口必须同时埋「离开结算」与「进入计时」', () => {
  const goto = BOARD_SRC.match(/function gotoQuestion\(i, dir\) \{[\s\S]*?\n\}/)
  assert.ok(goto, '找到 gotoQuestion')
  assert.ok(goto[0].includes('marks.leaveQuestion('), '切题时必须结算上一题（自动判定）')
  assert.ok(goto[0].includes('marks.enterQuestion('), '切题后必须开始计这一题的停留')
  // 结算必须发生在 currentIndex 变更之前，否则 saveStrokes 会存到错误的键上
  assert.ok(
    goto[0].indexOf('saveStrokes()') < goto[0].indexOf('marks.leaveQuestion('),
    '必须先 saveStrokes（依赖旧 current 算键）再结算'
  )
})

test('判定不得把「全屏讲题模式」当硬门槛', () => {
  // 勘察事实：WeekendHandout 的 openBoard() 从不传 fs=1，白板也从不读 fs，
  // 全屏必须老师手动点。若把它当门槛，不点全屏时自动判定会全军覆没。
  assert.ok(
    !/if\s*\(\s*!\s*immersive\(\)\s*\)\s*(?:\{\s*)?return/.test(MARKS_SRC),
    'immersive 只能用来选阈值，不能提前 return 掉判定'
  )
  assert.ok(
    MARKS_SRC.includes('immersive() ? JUDGE_RULES.immersiveDwellMs : JUDGE_RULES.normalDwellMs'),
    '全屏/非全屏只影响停留阈值'
  )
})

test('三个客观信号齐备，且阈值常量存在', () => {
  assert.ok(MARKS_SRC.includes('immersiveDwellMs: 20_000'), '全屏停留阈值 20s')
  assert.ok(MARKS_SRC.includes('normalDwellMs: 45_000'), '非全屏停留阈值 45s（抬高，防浏览误标）')
  assert.ok(MARKS_SRC.includes('skimDwellMs: 8_000'), '掠过阈值 8s')
  // 笔迹信号：用 points 长度判「写过字」
  assert.ok(BOARD_SRC.includes('s?.points?.length'), '必须按笔迹点判断有没有写过字')
  // 看答案信号
  assert.ok(BOARD_SRC.includes('marks.noteAnswerViewed('), '点开参考答案要记信号')
  assert.ok(MARKS_SRC.includes('noteStrokes('), '写板书要记信号')
  // 页面不可见时停表，避免「人离开电脑」被算成讲解
  assert.ok(MARKS_SRC.includes('visibilitychange'), '必须监听可见性，切后台停表')
})

test('判定用单次最长停留而不是累计停留（防反复回看凑够阈值）', () => {
  assert.ok(MARKS_SRC.includes('maxDwellMs'), '必须有 maxDwellMs')
  assert.ok(MARKS_SRC.includes('const dwell = s.maxDwellMs'), '判定必须用 maxDwellMs')
})

test('宁可不标：中间态不写标记，且自动判定不覆盖既有状态', () => {
  const judge = MARKS_SRC.match(/function judge\(s\) \{[\s\S]*?\n  \}/)
  assert.ok(judge, '找到 judge')
  // 已有状态（含手动 skip）不被自动判定推翻
  assert.ok(
    judge[0].includes("if (s.status === 'done' || s.status === 'rework' || s.status === 'skip') return"),
    '已讲 / 已跳过不被自动判定覆盖（否则 taught_at 被反复刷新，回炉信号永不触发）'
  )
  // 中间态直接 return，不落任何标记
  assert.ok(judge[0].includes('其余中间态'), '必须显式说明中间态不标')
  // 自动判定只写 done，不写 rework（回炉由服务端 reworkDue 提示 + 老师手动决定）
  assert.ok(judge[0].includes("s.status = 'done'"), '自动判定只写 done')
  assert.ok(!judge[0].includes("s.status = 'rework'"), '自动判定不得擅自写 rework')
})

test('服务端同守「自动不覆盖既有状态」，且手动永远生效', () => {
  assert.ok(
    ROUTE_SRC.includes("WHEN EXCLUDED.source = 'manual' THEN EXCLUDED.status"),
    '手动标记必须永远生效（含手动重置回 new）'
  )
  assert.ok(
    ROUTE_SRC.includes("WHEN teaching_marks.status = 'new' THEN EXCLUDED.status"),
    '自动判定只允许在既有状态为 new 时写入'
  )
})

// ── 5. UI ───────────────────────────────────────────────────────

test('底栏小圆点承载四色状态，且当前题用描边圈不改填充色', () => {
  for (const s of ['new', 'done', 'rework', 'skip']) {
    assert.ok(BOARD_SRC.includes(`.fb-dot--${s} {`), `必须有 .fb-dot--${s} 样式`)
  }
  // 防回归：原来 .fb-dot.current 直接改 background，会把状态色盖掉
  const cur = BOARD_SRC.match(/\.fb-dot\.current \{[^}]*\}/)
  assert.ok(cur, '找到 .fb-dot.current')
  assert.ok(cur[0].includes('border'), '当前题必须用描边圈表示')
  assert.ok(!cur[0].includes('background'), '当前题不得覆盖状态填充色')
})

test('「只看未讲 / 续讲」两个开关存在，且过滤用快照不实时收缩', () => {
  assert.ok(BOARD_SRC.includes('toggleUnTaughtOnly'), '必须有「只看未讲」')
  assert.ok(BOARD_SRC.includes('resumeLecture'), '必须有「续讲」')
  assert.ok(BOARD_SRC.includes('viewSnapshot'), '过滤必须走快照')
  // 正在讲的题不能因为刚被自动标成「已讲」就从列表里当场消失
  assert.ok(
    /viewSnapshot\.value \|\| questions\.value/.test(BOARD_SRC),
    '可见题单 = 快照 或 全量'
  )
})

test('长按改判：触屏长按 + PC 右键，且鼠标不做长按（慢单击不该被误判）', () => {
  assert.ok(BOARD_SRC.includes('onDotPointerDown'), '必须支持长按')
  assert.ok(BOARD_SRC.includes('onDotContextMenu'), '必须支持右键（PC 投屏）')
  assert.ok(BOARD_SRC.includes("ev?.pointerType === 'mouse'"), '鼠标走右键，不做长按')
  assert.ok(BOARD_SRC.includes('-webkit-touch-callout'), '必须屏蔽 iOS 长按 callout，否则菜单弹不出来')
  // 改判菜单不能 teleport 到 body：原生全屏时会被整块盖住（el-dialog 已踩过这个坑）
  assert.ok(BOARD_SRC.includes('class="fb-menu"'), '改判菜单必须是页内自己实现的浮层')
  assert.ok(!/<el-popover/.test(BOARD_SRC), '改判菜单不得用会 teleport 的浮层组件')
})

test('长按弹出的 click 必须被吞掉，否则会顺手跳题', () => {
  assert.ok(BOARD_SRC.includes('suppressDotClick'), '必须有 click 抑制标记')
  const click = BOARD_SRC.match(/function onDotClick\(i\) \{[\s\S]*?\n\}/)
  assert.ok(click, '找到 onDotClick')
  assert.ok(click[0].includes('suppressDotClick'), '单击处理必须检查抑制标记')
})

// ── 6. 锚点唯一性（2026-09-25 修复）───────────────────────────────
//
// 白板的讲题标记与手写板书都挂在 anchorKey 上，**两个不同的题共用一个锚点**
// 会让「标记一道题 = 标记另一道题」「写在一题上的板书出现在另一题上」。
// 线上实测（初三 20 天窗口 158 张 slide）曾出现 2 组撞锚点，根因两个：
//   A. topicKey 的 self: 兜底退化成 `#<题号>#` —— 与题目内容无关
//   B. 合并键（含小问）与身份键（不含小问）两套口径不一致，同题出两条
// 功能层面的验证在 server/_verify_teaching_marks.mjs（连真实库跑 buildHandout）。

test('self: 兜底不得用 worksheet#题号#题面 这种组合当身份（会退化成 #8# 乱并）', () => {
  const tk = LIB_SRC.slice(LIB_SRC.indexOf('function topicKey(r)'))
  const selfBlock = tk.slice(tk.indexOf('const own ='))
  assert.ok(
    !/\$\{r\.worksheet_id \|\| ''\}#\$\{r\.question_no/.test(LIB_SRC),
    '不得再用 `${worksheet_id}#${question_no}#${content}` 当 self: 身份'
  )
  // 必须是「题目身份 → 任务内题号 → 行主键」三级降级
  assert.ok(
    /r\.question_id\s*\n?\s*\|\|/.test(selfBlock),
    'self: 兜底第一优先级必须是 question_id'
  )
  assert.ok(
    selfBlock.includes('r.last_wrong_task_id && r.question_no != null'),
    'question_id 缺失时必须退到「任务内题号」（同一份提交里同题号 = 同一道题，能把小问合回一道）'
  )
  assert.ok(
    selfBlock.includes('|| r.wq_id'),
    '最后必须退到 wq_id（错题行主键，必然唯一）—— 宁可拆细，不可错并'
  )
})

test('跨天去重必须按「题目身份键」兜底合并，否则同题出两条且共享锚点', () => {
  // dedupeTopics 必须同时维护 合并键索引 与 题目身份键(t.key)索引
  const dt = LIB_SRC.match(/function dedupeTopics\(topics, keyOf\) \{[\s\S]*?\n  \}/)
  assert.ok(dt, '找到 dedupeTopics')
  assert.ok(dt[0].includes('aliasMap'), 'dedupeTopics 必须维护题目身份键索引')
  assert.ok(
    dt[0].includes('mergeTopicInto(completeMap, t, keyOf, aliasMap)'),
    '必须把 aliasMap 传给 mergeTopicInto'
  )
  // mergeTopicInto 必须在合并键未命中时按 t.key 再找一次
  const mt = LIB_SRC.match(/function mergeTopicInto\(map, t, keyOf, aliasMap\) \{[\s\S]*?\n  \}/)
  assert.ok(mt, '找到 mergeTopicInto')
  assert.ok(
    mt[0].includes('aliasMap.get(t.key)'),
    '合并键未命中时必须按题目身份键兜底查找'
  )
  assert.ok(
    mt[0].includes('aliasMap.set(t.key,'),
    '新条目与合并后的条目都必须登记进 aliasMap，否则后续同题仍找不到'
  )
})

test('锚点唯一性的功能验证必须有探针兜住（离线断言只能防源码回退）', () => {
  const probe = read('server/_verify_teaching_marks.mjs')
  assert.ok(
    probe.includes('锚点在题单内唯一'),
    '探针必须断言题单内锚点唯一'
  )
  assert.ok(
    probe.includes('锚点重复：'),
    '探针必须量化输出撞锚点组数，否则回归时会静默通过'
  )
})
