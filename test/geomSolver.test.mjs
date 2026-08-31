import test from 'node:test'
import assert from 'node:assert/strict'
import { makeConstraint } from '../server/utils/geom/constraintSchema.js'
import { solveGeometry } from '../server/utils/geom/solver.js'
import { residualGate, checkDegeneracy, evaluateResiduals } from '../server/utils/geom/residual.js'
import { extractConstraints } from '../server/utils/geom/constraintExtract.js'

const pm = (...pts) => Object.fromEntries(pts.map(([l, x, y]) => [l, { x, y }]))
const pts = (...pts) => pts.map(([l, x, y]) => ({ label: l, x, y }))

test('已满足的垂直角：闸门通过，位移≈0', () => {
  const P = pts(['A', 0, 0], ['B', 4, 0], ['C', 0, 3])
  const perp = makeConstraint('perpendicular', { l1: ['A', 'B'], l2: ['A', 'C'] }, 'text')
  const g = residualGate(pm(['A', 0, 0], ['B', 4, 0], ['C', 0, 3]), [perp])
  assert.ok(g.pass, '直角已满足，应过闸门')
  const sol = solveGeometry(P, [perp])
  assert.ok(sol.converged)
  assert.ok(sol.displacement < 1e-2, '已满足时几乎不移动')
})

test('违反的垂直角：原图闸门失败，求解器修正后通过且产生位移', () => {
  const P = pts(['A', 0, 0], ['B', 4, 0], ['C', 1, 3])
  const perp = makeConstraint('perpendicular', { l1: ['A', 'B'], l2: ['A', 'C'] }, 'text')
  const raw = residualGate(pm(['A', 0, 0], ['B', 4, 0], ['C', 1, 3]), [perp])
  assert.ok(!raw.pass, 'C 偏离 y 轴，原图不自洽')
  assert.ok(raw.maxNorm > 1, '违反幅度应超出容差')
  const sol = solveGeometry(P, [perp])
  assert.ok(sol.converged)
  assert.ok(sol.displacement > 0.05, '求解应修正原图')
  assert.ok(sol.perConstraint[0].pass, '解后垂直角应满足')
  const g2 = residualGate(sol.points, [perp])
  assert.ok(g2.pass, '解后闸门应通过')
})

test('等长（等边三角形）：已满足则通过', () => {
  const s = makeConstraint('equal_length', { segs: [['A', 'B'], ['B', 'C'], ['C', 'A']] }, 'text')
  const P = pts(['A', 0, 0], ['B', 2, 0], ['C', 1, Math.sqrt(3)])
  const g = residualGate(pm(['A', 0, 0], ['B', 2, 0], ['C', 1, Math.sqrt(3)]), [s])
  assert.ok(g.pass, '等边三角形满足等长')
  const sol = solveGeometry(P, [s])
  assert.ok(sol.perConstraint[0].pass)
})

test('角度值：已满足通过；违反被求解器修正', () => {
  const ang = makeConstraint('angle_value', { vertex: 'B', from: 'A', to: 'C', deg: 60 }, 'text')
  const sat = pm(['A', -1, 0], ['B', 0, 0], ['C', -0.5, Math.sqrt(3) / 2])
  // B 为顶点，BA 水平向右，BC 与 BA 成 60°
  const g = residualGate(sat, [ang])
  assert.ok(g.pass, '60° 已满足')
  const vio = pts(['A', -1, 0], ['B', 0, 0], ['C', 1, 0.4])
  const sol = solveGeometry(vio, [ang])
  assert.ok(sol.converged)
  assert.ok(sol.perConstraint[0].pass, '违反的 60° 应被修正')
})

test('形状软约束（正方形）永不挡闸门；但硬约束违反仍失败', () => {
  const square = makeConstraint('polygon_shape', { kind: 'square', vertices: ['A', 'B', 'C', 'D'] }, 'text')
  const perp = makeConstraint('perpendicular', { l1: ['A', 'B'], l2: ['B', 'C'] }, 'text')
  // 正方形 + 一个满足的直角
  const P = pts(['A', 0, 0], ['B', 1, 0], ['C', 1, 1], ['D', 0, 1])
  const M = pm(['A', 0, 0], ['B', 1, 0], ['C', 1, 1], ['D', 0, 1])
  const g = residualGate(M, [square, perp])
  assert.ok(g.pass, '正方形(软) + 直角(硬) 应通过')
  const squareItem = g.items.find((i) => i.type === 'polygon_shape')
  assert.ok(squareItem && squareItem.soft, '正方形应为软约束')
  // 硬直角违反（C 不在 (1,1)），正方形略不齐 → 硬失败，软不挡
  const M2 = pm(['A', 0, 0], ['B', 1, 0], ['C', 1.5, 0.5], ['D', 0, 1])
  const g2 = residualGate(M2, [square, perp])
  assert.ok(!g2.pass, '硬直角违反应失败')
  assert.ok(g2.items.find((i) => i.type === 'polygon_shape').soft)
})

test('垂足约束：已满足通过', () => {
  const foot = makeConstraint('foot', { point: 'E', from: 'B', onLine: ['A', 'C'] }, 'text')
  const M = pm(['A', 0, 0], ['C', 4, 0], ['B', 1, 3], ['E', 1, 0])
  const g = residualGate(M, [foot])
  assert.ok(g.pass, 'E 是 B 到 AC 的垂足')
})

test('退化：重叠点应触发闸门失败并标注 overlap', () => {
  const perp = makeConstraint('perpendicular', { l1: ['A', 'B'], l2: ['A', 'C'] }, 'text')
  const M = pm(['A', 0, 0], ['B', 4, 0], ['C', 0, 3], ['D', 0.0001, 0.0001])
  const deg = checkDegeneracy(M, [perp])
  assert.ok(deg.degenerate, '存在重叠点')
  assert.ok(deg.reasons.includes('overlap'))
  const g = residualGate(M, [perp])
  assert.ok(!g.pass, '退化图形不应通过闸门')
  assert.ok(g.degenerate)
})

test('多约束图形：求解收敛且硬约束全部满足', () => {
  const perp = makeConstraint('perpendicular', { l1: ['A', 'B'], l2: ['A', 'C'] }, 'text')
  const foot = makeConstraint('foot', { point: 'D', from: 'C', onLine: ['A', 'B'] }, 'text')
  const P = pts(['A', 0, 0], ['B', 5, 0], ['C', 2, 4], ['D', 2, 0])
  const sol = solveGeometry(P, [perp, foot])
  assert.ok(sol.converged)
  assert.equal(sol.perConstraint.length, 2)
  assert.ok(sol.perConstraint.every((c) => c.pass), '两条硬约束都应满足')
})

test('无约束：求解器原样返回点群', () => {
  const P = pts(['A', 1, 2], ['B', 3, 4])
  const sol = solveGeometry(P, [])
  assert.ok(sol.displacement < 1e-9)
  assert.deepEqual(sol.points.A, { x: 1, y: 2 })
})

test('集成（Phase2→3）：真实题干抽取出的约束能被求解器消费并过闸门', () => {
  const content = '在一楼和二楼之间的手扶电梯示意图中，AB、CD 分别表示一楼、二楼地面的水平线，∠ABC=150°，BC 的长是 3m。'
  const structure = {
    points: [
      { label: 'A', x: -1, y: 0 },
      { label: 'B', x: 0, y: 0 },
      { label: 'C', x: 2.598, y: 1.5 },
      { label: 'D', x: 0, y: 1.5 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }
    ]
  }
  const { constraints, dropped } = extractConstraints(content, structure)
  const ang = constraints.find((c) => c.type === 'angle_value')
  assert.ok(ang, '应抽出处 ∠ABC=150°')
  assert.equal(ang.args.deg, 150)
  const M = Object.fromEntries(structure.points.map((p) => [p.label, { x: p.x, y: p.y }]))
  const g = residualGate(M, constraints)
  assert.ok(g.pass, '符合题设坐标应过闸门')
  const sol = solveGeometry(structure.points, constraints)
  assert.ok(sol.converged)
  assert.ok(sol.displacement < 1e-2, '已满足时不应移动')
})
