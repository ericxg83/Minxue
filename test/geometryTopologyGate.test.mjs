/**
 * 回归锁：回灌修正渲染必须保持目测布局的拓扑（上下/左右关系不得被求解器反转）。
 *
 * 事故（2026-10-03 第 74 轮方向二批次，负责人肉眼复核指出「严重画错」）：
 * 两道同题干题（asset 73506ed1 / 0e235860，题干「AB/AD = AC/AE = BC/DE，求证 AB·CE=AC·BD」）
 * 的 **raw_svg（模型闭环确认过的目测布局）是对的**——A 上、E 右上、D 在形内、B/C 在底；
 * 但 P5「回灌修正渲染」为满足题干比例约束，在无派生点（不冻结）的路径上把真实顶点整体搬动
 * displacement=51.7 / 41.1，结果 **C 与 D 的上下关系被反转**（D 被搬到 BC 之下），
 * 线段互相穿插，成了一张拓扑错误的图。而既有安全闸门只看约束残差（maxNorm≈0 → pass:true），
 * **完全没有"是否保住原图相对位置"这一维**，于是错图照常入库并标 completed。
 *
 * 修复方向（只加闸不放宽）：求解后新增拓扑保真闸——任意两点若在目测布局里有明确的
 * 垂直/水平关系（|Δ| ≥ 阈值），而解后关系反向且同样明确，即判定拓扑反转并**拒绝回灌**，
 * 保留模型闭环确认过的 raw 布局（宁可少修正，绝不画错）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { correctGeometryFigure, findTopologyInversions } from '../server/utils/geom/correctedRender.js'

const pts = (...p) => p.map(([label, x, y]) => ({ label, x, y }))
const segs = (...s) => s.map(([from, to]) => ({ from, to, style: 'solid', relation: 'normal', extend: false }))
const asMap = (list) => Object.fromEntries(list.map(p => [p.label, { x: p.x, y: p.y }]))

// ── 生产真实数据（从 question_assets.tikz_json.points 原样导出）──
const CONTENT = '如图，已知：AB/AD = AC/AE = BC/DE，求证：AB·CE=AC·BD'
const CASE1 = {
  points: pts(['A', 75, 145], ['B', 20, 30], ['C', 180, 30], ['D', 92, 78], ['E', 155, 148]),
  segments: segs(['A', 'B'], ['B', 'C'], ['C', 'A'], ['A', 'E'], ['E', 'C'], ['A', 'D'], ['B', 'D'], ['D', 'E']),
  circles: []
}
const CASE1_SOLVED = asMap(pts(['A', 72.33, 152.94], ['B', 38.60, 30.23], ['C', 136.25, 57.47], ['D', 101.20, 41.73], ['E', 173.62, 148.63]))
const CASE2 = {
  points: pts(['A', 55, 90], ['B', 0, 0], ['C', 140, 0], ['D', 70, 34], ['E', 123, 91]),
  segments: segs(['A', 'B'], ['B', 'C'], ['C', 'A'], ['A', 'D'], ['B', 'D'], ['D', 'E'], ['A', 'E'], ['C', 'E']),
  circles: []
}
const CASE2_SOLVED = asMap(pts(['A', 50.15, 96.42], ['B', 16.72, 0.12], ['C', 104.16, 20.22], ['D', 77.24, 7.03], ['E', 139.73, 91.21]))

test('拓扑反转探针：实测事故数据必须报出 C/D 的上下关系被反转', () => {
  const inv = findTopologyInversions(CASE1.points, CASE1_SOLVED)
  assert.ok(inv.length > 0, '73506ed1 的求解结果必须被判定为拓扑反转')
  const cd = inv.find(i => i.pair === 'C/D' || i.pair === 'D/C')
  assert.ok(cd, `应包含 C/D 这一对，实际：${JSON.stringify(inv)}`)
  assert.equal(cd.axis, 'y')
  assert.ok(cd.rawDelta < 0 && cd.solvedDelta > 0, `目测 C 在 D 之下(Δy<0)、解后反成 C 在上(Δy>0)，实际 ${cd.rawDelta}→${cd.solvedDelta}`)

  const inv2 = findTopologyInversions(CASE2.points, CASE2_SOLVED)
  assert.ok(inv2.length > 0, '0e235860 的求解结果必须被判定为拓扑反转')
})

test('回灌修正渲染：拓扑反转的解必须被拒绝（保留目测布局），不得发布错图', () => {
  for (const [name, structure] of [['73506ed1', CASE1], ['0e235860', CASE2]]) {
    const r = correctGeometryFigure(structure, CONTENT)
    assert.equal(r.ok, false, `${name}：曾把 D 搬到 BC 之下造成线段穿插，必须拒绝回灌（实际 ok=${r.ok} reason=${r.reason}）`)
    assert.equal(r.reason, 'topology_inverted', `${name}：拒绝原因必须是拓扑反转，实际 ${r.reason}`)
    assert.ok(Array.isArray(r.inversions) && r.inversions.length > 0, `${name}：必须回传反转明细供排查`)
  }
})

test('不误伤：小幅挪动且不改变相对位置的解仍应放行（只加闸不放宽）', () => {
  // C 偏离 y 轴 → 求解把它推回 (0,3)：只挪 1px 量级，A/B/C 的上下左右关系全部保持
  const structure = {
    points: pts(['A', 0, 0], ['B', 4, 0], ['C', 1, 3]),
    segments: segs(['A', 'B'], ['B', 'C'], ['C', 'A']),
    circles: []
  }
  const r = correctGeometryFigure(structure, '如图，在△ABC中，∠BAC=90°，AB⊥AC。')
  assert.ok(r.ok, `不该误伤正常修正，实际 reason=${r.reason}`)
  assert.ok(findTopologyInversions(structure.points, r.solved.points).length === 0, '放行时探针必须零反转（自证一致）')
})

test('不误伤：共线/同高的点对（关系不明确）不参与判定', () => {
  // B、C 同高（Δy=0）→ 解后被拉开也不该算反转；A 始终在最上方
  const points = pts(['A', 50, 100], ['B', 0, 0], ['C', 100, 0])
  const solved = asMap(pts(['A', 50, 100], ['B', 0, 0], ['C', 100, 6]))
  assert.equal(findTopologyInversions(points, solved).length, 0, 'Δy=0 的点对关系不明确，不得判反转')
})
