/**
 * 回归锁：P1「聚焦网状图」的共现折叠逻辑（2026-10-05）
 *
 * 起因：负责人在产品评审里选了「直接上 P1 聚焦网状图」。
 *   背后的判断依据（全量实测）：共现有 1553 边 / 294 节点，平均度 21.9 ——
 *   整张网摊开就是毛线球。所以只展开「选中的考点 + 共现最强的 8 个邻居」= 9 个点。
 *
 * 守护四件事：
 *   ① 有向边 → 无向边必须去重。(A,B) 与 (B,A) 合成一条、权重相加，
 *      否则共现数直接翻倍（实测有向 3106 / 无向 1553，正好一半）。
 *   ② 同一个 peer 被 scope 内多个节点连到时要合并成一条边（peer_count 记几次）。
 *   ③ 邻居按共现强度降序，且**只取 limit 个** —— 9 个点才是可读的量级。
 *   ④ self 必须在 nodes[0] 且标 is_center；图上中心点不可点（点它没意义）。
 *
 * 只测纯函数 buildCooccurGraph，不连库（SQL 口径由 _diag_cooccur_sql_1005.mjs 真库验）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCooccurGraph } from '../server/routes/teachingQuestionTypes.js'

const CENTER = 'kp-center'
const self = { id: CENTER, name: '勾股定理', level: 2, own_count: 312 }
const row = (kpId, name, cooccur, own = 0, inScope = false, level = 2) =>
  ({ kp_id: kpId, name, level, cooccur, own_count: own, in_scope: inScope })

test('共现图：中心点自己必须在首位且标 is_center', () => {
  const g = buildCooccurGraph(CENTER, self, [row('kp-a', '相似三角形', 64, 198)])
  assert.equal(g.nodes[0].id, CENTER)
  assert.equal(g.nodes[0].is_center, true)
  assert.equal(g.nodes[0].own_count, 312)
  assert.equal(g.nodes.length, 2)
})

test('共现图：links 从中心指向每个邻居，权重 =共现数', () => {
  const g = buildCooccurGraph(CENTER, self, [row('kp-a', '相似三角形', 64, 198), row('kp-b', '实数', 12, 304)])
  assert.equal(g.links.length, 2)
  for (const l of g.links) assert.equal(l.source, CENTER, 'source 必须是中心考点')
  const byTarget = Object.fromEntries(g.links.map(l => [l.target, l.value]))
  assert.equal(byTarget['kp-a'], 64)
  assert.equal(byTarget['kp-b'], 12)
})

test('共现图：同一 peer 被多个 scope 节点连到 → 合并一条边、权重相加、peer_count 记数', () => {
  // 「函数」是父节点，它自己以及它的子孙「二次函数」都可能与「相似三角形」共现
  const g = buildCooccurGraph(CENTER, self, [
    row('kp-a', '相似三角形', 40, 198, true),
    row('kp-a', '相似三角形', 24, 198, true),
  ])
  assert.equal(g.nodes.filter(n => n.id === 'kp-a').length, 1, '同一个 peer 只能出一个节点')
  assert.equal(g.links.length, 1, '不能出两条平行边')
  const peer = g.nodes.find(n => n.id === 'kp-a')
  assert.equal(peer.cooccur, 64, '权重必须相加 40+24=64')
  assert.equal(peer.peer_count, 2)
})

test('共现图：邻居按共现强度降序（不是按 id 或名字排）', () => {
  const g = buildCooccurGraph(CENTER, self, [
    row('kp-low', '弱', 3, 10),
    row('kp-high', '强', 300, 20),
    row('kp-mid', '中', 50, 15),
  ])
  assert.deepEqual(g.nodes.slice(1).map(n => n.id), ['kp-high', 'kp-mid', 'kp-low'])
})

test('共现图：共现相同时按自身题数降序（大题库优先，导航更有用）', () => {
  const g = buildCooccurGraph(CENTER, self, [
    row('kp-a', 'A', 10, 5),
    row('kp-b', 'B', 10, 500),
  ])
  assert.deepEqual(g.nodes.slice(1).map(n => n.id), ['kp-b', 'kp-a'])
})

test('共现图：无邻居（这个考点还没跟别的考点同题共现）不炸，nodes 只剩中心', () => {
  const g = buildCooccurGraph(CENTER, self, [])
  assert.equal(g.nodes.length, 1)
  assert.equal(g.links.length, 0)
})

test('共现图：self 为 null（考点不存在/被删）不炸，返回空图', () => {
  const g = buildCooccurGraph('no-such', null, [row('kp-a', 'A', 5)])
  assert.equal(g.nodes.length, 1)
  assert.equal(g.nodes[0].is_center, false, '没有 self 时不该凭空造一个中心点')
  assert.equal(g.links.length, 1, 'links 仍按传入行生成，前端拿不到中心点时自行忽略')
})

test('共现图：in_scope 透传（前端用它区分「在选中子树内」与「子树外的强邻居」）', () => {
  const g = buildCooccurGraph(CENTER, self, [
    row('kp-in', '树内', 10, 20, true),
    row('kp-out', '树外', 30, 20, false),
  ])
  assert.equal(g.nodes.find(n => n.id === 'kp-in').in_scope, true)
  assert.equal(g.nodes.find(n => n.id === 'kp-out').in_scope, false)
})

test('共现图：前端拿 limit=8 时必须是 1+8=9 个点（可读量级的硬约定）', () => {
  const many = Array.from({ length: 20 }, (_, i) => row(`kp-${i}`, `考点${i}`, 100 - i, 10))
  const g = buildCooccurGraph(CENTER, self, many.slice(0, 8))
  assert.equal(g.nodes.length, 9, '中心 + 8 邻居 = 9 个点')
  assert.equal(g.links.length, 8)
})
