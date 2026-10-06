/**
 * weekendHandoutSubGroupCollision.test.mjs — 跨页题号撞车（小问版）回归
 *
 * 事故（r213，2026-10-06 负责人报障）：周末讲题白板第 1 题凭空多出两条「求证」小问
 *   ——「求证：AF·AC=AG·AE.」「求证：2DF·OE=OA·CE.」，原试卷上根本没有。
 *
 * 病根：`buildCompleteQuestion` 的同题小问分组键是 `${task_id}#${question_number}`，
 *   不含 page_number。同一份卷（数学作业 09/24，task=ebdc7067）第 2 页与第 4 页各有一道
 *   「第 13 题」，各带 2 个小问行，于是四行落进同一组被拼成一道题。
 *   既有护栏（2026-09-21 白板第125题）只看「整题行 ≥2 条且内容互不相同」，
 *   覆盖不到「组内全是小问行」的情况 —— 本事故正是这种。
 *
 * 修法：组内出现 ≥2 个互不相同的非空 parent_stem ⇒ 判定撞车，只保留与错题行 rep
 *   同 parent_stem 的行（rep 无 parent_stem 时按同页收窄），并禁用同大题配图兜底。
 *
 * buildCompleteQuestion 是闭包内私有函数，无法直接 import。这里沿用本仓既有做法
 * （见 weekendAnswerMerge.test.mjs）：以「行为等价复刻」固化判据 + 对库源码做
 * fail-closed 断言，库内判据一改本测试就红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LIB_SRC = readFileSync(join(__dirname, '..', 'server', 'lib', 'weekendHandout.js'), 'utf8')
const CLI_SRC = readFileSync(join(__dirname, '..', 'server', 'scripts', 'weekend-handout.mjs'), 'utf8')

/** 与库内 buildCompleteQuestion 新增护栏等价的行为复刻 */
function narrowGroup(group, rep) {
  const normPs = (v) => String(v || '').replace(/\s+/g, '')
  const stems = [...new Set(group.map(x => normPs(x.parent_stem)).filter(Boolean))]
  if (stems.length <= 1) return { group, collided: false }
  const repStem = normPs(rep.parent_stem)
  const repPage = rep.page_number ?? null
  const kept = group.filter(x => {
    const s = normPs(x.parent_stem)
    if (repStem) return s === repStem
    return (x.page_number ?? null) === repPage
  })
  if (kept.length === 0 || kept.length === group.length) return { group, collided: false }
  return { group: kept, collided: true }
}

// ── 线上真实数据（task=ebdc7067 第 13 题，两页各一道）──
const GRID_STEM = '如图，在正方形网格中，小正方形的边长均为1. 如图（1），在4x4的正方形网格中，△ABC的顶点都在格点上.'
const PROOF_STEM = '如图，已知：在△ABC中，BC=BA，在△ADE中，DE=DA，D是边BC上一点，∠EDC=∠BAD，AC与DE交于点O，F、G分别是边DE、BC上的中点.'
const REAL_GROUP = [
  { id: 'd8bd0cff', sub_no: '1', page_number: 2, parent_stem: GRID_STEM, content: '填空：BC/AC=____，∠BCA=____' },
  { id: 'cc027178', sub_no: '2', page_number: 2, parent_stem: GRID_STEM, content: '请在图（2）的两个3x3的正方形网格中分别画出与△ABC不全等的△A₁B₁C₁和△A₂B₂C₂' },
  { id: '39f453df', sub_no: '1', page_number: 4, parent_stem: PROOF_STEM, content: '求证：AF·AC=AG·AE.' },
  { id: '0c68d199', sub_no: '2', page_number: 4, parent_stem: PROOF_STEM, content: '求证：2DF·OE=OA·CE.' },
]

test('① 线上事故复现：错题行在网格题（p2）时，只保留网格题的 2 个小问，不混入证明题小问', () => {
  const rep = REAL_GROUP[0]
  const { group, collided } = narrowGroup(REAL_GROUP, rep)
  assert.equal(collided, true, '两页各一道「第13题」必须被判为撞车')
  assert.equal(group.length, 2)
  assert.deepEqual(group.map(x => x.id), ['d8bd0cff', 'cc027178'])
  const stem = group.map(x => `(${x.sub_no})${x.content}`).join('')
  assert.ok(!stem.includes('求证'), `收窄后题干不得出现「求证」：${stem}`)
  assert.ok(!stem.includes('2DF'), '收窄后题干不得出现 2DF·OE')
})

test('② 错题行在证明题（p4）时，保留证明题的 2 个小问，不混入网格题小问', () => {
  const rep = REAL_GROUP[2]
  const { group, collided } = narrowGroup(REAL_GROUP, rep)
  assert.equal(collided, true)
  assert.deepEqual(group.map(x => x.id), ['39f453df', '0c68d199'])
  const stem = group.map(x => `(${x.sub_no})${x.content}`).join('')
  assert.ok(stem.includes('AF·AC') && stem.includes('2DF·OE'))
  assert.ok(!stem.includes('网格'), '收窄后题干不得混入网格题')
})

test('③ 合法多小问（同一 parent_stem 跨页排版）不受影响：不判撞车、不丢小问', () => {
  const group = [
    { id: 'a', sub_no: '1', page_number: 2, parent_stem: '同一道题的公共题干', content: '(1) 求 x' },
    { id: 'b', sub_no: '2', page_number: 3, parent_stem: '同一道题的公共题干', content: '(2) 求 y' },
  ]
  const { group: kept, collided } = narrowGroup(group, group[0])
  assert.equal(collided, false, '同一 parent_stem 跨页是合法合并，不得判撞车')
  assert.equal(kept.length, 2)
})

test('④ rep 无 parent_stem 时按同页收窄（仍然只保留一页的小问）', () => {
  const group = [
    { id: 'a', sub_no: '1', page_number: 2, parent_stem: '甲题', content: '(1) 甲' },
    { id: 'b', sub_no: '1', page_number: 4, parent_stem: '乙题', content: '(1) 乙' },
  ]
  const { group: kept, collided } = narrowGroup(group, { parent_stem: '', page_number: 4 })
  assert.equal(collided, true)
  assert.deepEqual(kept.map(x => x.id), ['b'])
})

test('⑤ 组内只有 1 个 parent_stem（或全空）→ 空操作，保持原行为', () => {
  const one = [
    { id: 'a', sub_no: '1', page_number: 2, parent_stem: '同一题', content: '(1) a' },
    { id: 'b', sub_no: '2', page_number: 2, parent_stem: '同一题', content: '(2) b' },
  ]
  assert.equal(narrowGroup(one, one[0]).collided, false)
  const empty = [
    { id: 'a', sub_no: '1', page_number: 2, parent_stem: '', content: '(1) a' },
    { id: 'b', sub_no: '2', page_number: 2, parent_stem: '', content: '(2) b' },
  ]
  assert.equal(narrowGroup(empty, empty[0]).collided, false, 'parent_stem 全空时不得凭 page 误判')
})

test('⑥ 源码锁（fail-closed）：lib 与 CLI 都实现了同一护栏，且收窄后禁用配图兜底', () => {
  for (const [label, SRC] of [['lib', LIB_SRC], ['CLI', CLI_SRC]]) {
    assert.ok(SRC.includes('pageStemCollision'), `${label} 必须产出 pageStemCollision 标记`)
    assert.ok(SRC.includes('stemsInGroup'), `${label} 必须按组内 parent_stem 去重判撞车`)
    assert.ok(SRC.includes('跨页题号撞车'), `${label} 必须有撞车护栏的说明/日志`)
    assert.ok(SRC.includes('合并收窄'), `${label} 必须记录收窄日志`)
    // 收窄后同样走 numberCollision 分支 → 禁用同大题配图兜底（figureByQGroup 用同一个撞车键）
    assert.ok(
      SRC.includes('numberCollision: pageStemCollision'),
      `${label} 收窄后必须把 numberCollision 置为 true，否则配图仍会取到邻题的图`
    )
  }
  // 收窄必须发生在「整题行撞车」护栏之前，且 group 必须可重赋值（let）
  assert.ok(LIB_SRC.includes('let group = gKey ? (subRowsByQGroup.get(gKey) || null) : null'), 'lib group 必须是 let')
  assert.ok(CLI_SRC.includes('let group = gKey ? (subRowsByQGroup.get(gKey) || null) : null'), 'CLI group 必须是 let')
})
