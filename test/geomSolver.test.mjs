import test from 'node:test'
import assert from 'node:assert/strict'
import { makeConstraint } from '../server/utils/geom/constraintSchema.js'
import { solveGeometry } from '../server/utils/geom/solver.js'
import { residualGate, checkDegeneracy, evaluateResiduals } from '../server/utils/geom/residual.js'
import { extractConstraints } from '../server/utils/geom/constraintExtract.js'
import { correctGeometryFigure } from '../server/utils/geom/correctedRender.js'

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

// ── 冻结点（fixedPoints） ──
//
// 背景：含派生点的结构里，真实顶点是**从图上读出来的观测值**，派生点是**推出来的**。
// 不冻结时 LM 的最小范数步会把修正平摊到所有点上（实测折叠题真实顶点 C 被挪 21.8px），
// 等于"把三角形掰歪"换取派生点就位。所以真实顶点必须冻结、修正只由派生点承担。

test('冻结点：真实顶点零位移，派生点承担全部修正', () => {
  // A(10,80) C(90,80) 是水平折痕，B(40,20) 关于 AC 的镜像应为 (40,140)
  const P = pts(['A', 10, 80], ['B', 40, 20], ['C', 90, 80], ['B′', 62, 74])
  const ref = makeConstraint('reflect', { point: 'B′', source: 'B', axis: ['A', 'C'] }, 'text')
  const sol = solveGeometry(P, [ref], { fixedPoints: ['A', 'B', 'C'] })
  assert.ok(sol.converged)
  assert.ok(sol.perConstraint[0].pass, '镜像约束应被满足')
  for (const l of ['A', 'B', 'C']) {
    assert.ok(Math.hypot(sol.points[l].x - P.find(p => p.label === l).x,
      sol.points[l].y - P.find(p => p.label === l).y) < 1e-9, `${l} 必须完全不动`)
  }
  // 残差容差是相对量（LEN_TOL_REL × scale），这里放到 0.01px 足以判定"落点正确"
  assert.ok(Math.hypot(sol.points['B′'].x - 40, sol.points['B′'].y - 140) < 0.01,
    `B′ 应落到 B 关于 AC 的镜像 (40,140)，实际 (${sol.points['B′'].x.toFixed(3)},${sol.points['B′'].y.toFixed(3)})`)
})

test('冻结点：不传 fixedPoints 时照旧平摊修正（锁定"必须显式冻结"）', () => {
  const P = pts(['A', 10, 80], ['B', 40, 20], ['C', 90, 80], ['B′', 62, 74])
  const ref = makeConstraint('reflect', { point: 'B′', source: 'B', axis: ['A', 'C'] }, 'text')
  const sol = solveGeometry(P, [ref])
  assert.ok(sol.perConstraint[0].pass)
  // 不冻结时真实顶点会被挪动（这是 correctedRender 必须传 fixedPoints 的原因）
  const movedC = Math.hypot(sol.points.C.x - 90, sol.points.C.y - 80)
  assert.ok(movedC > 1, `不冻结时真实顶点 C 会被挪动（实测 ${movedC.toFixed(1)}px）`)
})

test('冻结点：correctionRender 对含派生点的结构自动冻结', () => {
  const structure = {
    points: [
      { label: 'A', x: 10, y: 80 }, { label: 'B', x: 40, y: 20 }, { label: 'C', x: 90, y: 80 },
      { label: 'B′', x: 62, y: 74, derived: { reflect: { source: 'B', axis: ['A', 'C'] } } }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'A', to: 'B′' }],
    circles: []
  }
  const r = correctGeometryFigure(structure, '如图，在△ABC中，将△ABC沿AC折叠，点B落在点B′处，连接AB′。')
  assert.ok(r.ok, `应通过回灌修正，实际: ${r.reason}`)
  assert.equal(r.solved.nFixed, 3, '三个真实顶点应被冻结')
  assert.ok(r.solved.shiftFixed < 1e-9, `真实顶点必须零位移，实际 ${r.solved.shiftFixed}`)
  assert.ok(r.solved.shiftDerived > 1, '修正应由派生点承担')
})

test('冻结点：无派生点的结构不冻结（照旧靠微调自洽）', () => {
  const structure = {
    points: [{ label: 'A', x: 10, y: 80 }, { label: 'B', x: 90, y: 80 }, { label: 'C', x: 30, y: 30 }],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
    circles: []
  }
  const r = correctGeometryFigure(structure, '如图，在△ABC中，∠ACB=90°。')
  assert.ok(r.ok, `应通过回灌修正，实际: ${r.reason}`)
  assert.equal(r.solved.nFixed, 0, '无派生点时不应冻结任何点')
  assert.ok(r.solved.shiftFixed > 1, '无派生点时顶点应照旧被修正')
})

test('冻结点：冻结解不开时退回不冻结（覆盖率不丢，改造是单调改进）', () => {
  // 故意造矛盾：三角形非等腰，却给了 AB=AC —— 不动真实顶点就无解。
  const structure = {
    points: [
      { label: 'A', x: 10, y: 80 }, { label: 'B', x: 40, y: 20 }, { label: 'C', x: 90, y: 80 },
      { label: 'B′', x: 62, y: 74, derived: { reflect: { source: 'B', axis: ['A', 'C'] } } }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'A', to: 'B′' }],
    circles: []
  }
  const content = '如图，在△ABC中，AB=AC，将△ABC沿AC折叠，点B落在点B′处，连接AB′。'
  const r = correctGeometryFigure(structure, content)
  assert.ok(r.ok, `冻结失败后应退回不冻结并成功，实际: ${r.reason}`)
  assert.equal(r.solved.frozeVertices, false, '应标记为走了退回路径')
  assert.equal(r.solved.nFixed, 0)
  assert.ok(r.solved.shiftFixed > 1, '退回路径下真实顶点会被挪动（= 改造前行为）')
})

test('冻结点：冻结能解时绝不走退回路径（图不被扭曲）', () => {
  const structure = {
    points: [
      { label: 'A', x: 10, y: 80 }, { label: 'B', x: 40, y: 20 }, { label: 'C', x: 90, y: 80 },
      { label: 'B′', x: 62, y: 74, derived: { reflect: { source: 'B', axis: ['A', 'C'] } } }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'A', to: 'B′' }],
    circles: []
  }
  const r = correctGeometryFigure(structure, '如图，在△ABC中，将△ABC沿AC折叠，点B落在点B′处，连接AB′。')
  assert.ok(r.ok)
  assert.equal(r.solved.frozeVertices, true, '能冻结就必须冻结（退回路径会把三角形掰歪）')
  assert.ok(r.solved.shiftFixed < 1e-9)
})
