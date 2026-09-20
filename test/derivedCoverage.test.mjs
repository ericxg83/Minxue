/**
 * 派生点确定度判据 + 入库合成裁决的回归测试。
 *
 * 背景：geometryWorker 原先对含派生点（垂足/中点/交点）的结构一律早退
 * （derived_deferred）。那道闸是约束求解器接入前的临时保护，代价是视觉额度
 * 已经花掉、结果却被整条丢弃。放宽它必须补上安全网，本文件锁定该安全网的语义：
 *
 *   1. 求解器收敛 ≠ 图可信 —— 题干关系被漏抽时，派生点会停在模型目测的位置。
 *   2. 只有「回灌修正成功」且「每个派生点被已抽取约束确定（自由度亏损 ≥ 2）」
 *      才允许入库；缺任一 → 回退裁剪原图。
 *
 * 纪律：判据偏保守。放宽判据（例如把 on_segment 算作已确定）必须同时改这里的
 * 断言，并说明为什么不会让错图进学生视野。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DERIVED_DOF_DEFICIT,
  DETERMINED_THRESHOLD,
  derivedLabels,
  dofLedger,
  derivedPointCoverage,
  assessDerivedReadiness,
  canPublishDerivedFigure
} from '../server/utils/geom/derivedCoverage.js'
import { normalizeStructure } from '../server/utils/geom/structure.js'
import { correctGeometryFigure } from '../server/utils/geom/correctedRender.js'
import { makeConstraint } from '../server/utils/geom/constraintSchema.js'

const S = (points, segments = []) => normalizeStructure({
  points, segments, circles: [], constraints: [],
  figure_type: 'geometry', coordinate_system: { exists: false }
})

// ── 判据表本身 ──

test('垂足/中点/交点/对称/旋转/三心 记为完全确定（亏损 2）', () => {
  for (const t of ['midpoint', 'foot', 'line_intersect', 'reflect', 'rotate', 'centroid', 'incenter', 'circumcenter']) {
    assert.equal(DERIVED_DOF_DEFICIT[t], 2, `${t} 应记 2`)
  }
})

test('在线上/在圆上/在射线上 只记 1（还剩一个自由度）', () => {
  for (const t of ['on_segment', 'on_line', 'on_circle', 'angle_bisector']) {
    assert.equal(DERIVED_DOF_DEFICIT[t], 1, `${t} 应记 1`)
  }
})

test('circle_center 是空约束，记 0', () => {
  // 题干抽取器生成 { point: O, circle: O }，残差 dist(O,O) ≡ 0，钉不住任何点
  assert.equal(DERIVED_DOF_DEFICIT.circle_center, 0)
})

test('确定阈值为 2（平面点两个自由度）', () => {
  assert.equal(DETERMINED_THRESHOLD, 2)
})

// ── derivedLabels ──

test('只挑出带 derived 的点', () => {
  const s = S([
    { label: 'A', x: 0, y: 0 },
    { label: 'D', x: 1, y: 1, derived: { midpoint: ['A', 'B'] } }
  ])
  assert.deepEqual(derivedLabels(s), ['D'])
})

test('derived 为空对象不算派生点（与 hasDerivedPoints 口径一致）', () => {
  const s = S([
    { label: 'A', x: 0, y: 0 },
    { label: 'D', x: 1, y: 1, derived: {} }
  ])
  assert.deepEqual(derivedLabels(s), [])
})

// ── dofLedger ──

test('angle_bisector 的受约束点在 ray[1] 而非 args.point', () => {
  const c = makeConstraint('angle_bisector', { ray: ['A', 'D'], of: { vertex: 'A', from: 'B', to: 'C' } }, 'text', '')
  const ledger = dofLedger([c])
  assert.equal(ledger.get('D').deficit, 1)
  assert.equal(ledger.has('A'), false)
})

test('on_circle 只钉住圆上的点，不给圆心加分', () => {
  // 单条 on_circle 时 r ≡ |P−O|，残差恒为 0，给圆心加分会让判据失去保守性
  const c = makeConstraint('on_circle', { point: 'A', circle: 'O' }, 'text', '')
  const ledger = dofLedger([c])
  assert.equal(ledger.get('A').deficit, 1)
  assert.equal(ledger.has('O'), false)
})

test('关系型约束（equal_length/angle_value/perpendicular）不钉点', () => {
  const cs = [
    makeConstraint('equal_length', { segs: [['A', 'B'], ['C', 'D']] }, 'text', ''),
    makeConstraint('angle_value', { vertex: 'A', from: 'B', to: 'C', deg: 60 }, 'text', ''),
    makeConstraint('perpendicular', { l1: ['A', 'B'], l2: ['C', 'D'] }, 'text', '')
  ]
  assert.equal(dofLedger(cs).size, 0)
})

// ── derivedPointCoverage ──

test('中点/垂足 判为已确定', () => {
  const s = S([
    { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 },
    { label: 'D', x: 5, y: 0, derived: { midpoint: ['A', 'B'] } }
  ])
  const cov = derivedPointCoverage(s, [makeConstraint('midpoint', { point: 'D', of: ['A', 'B'] }, 'text', '')])
  assert.equal(cov.allDetermined, true)
  assert.deepEqual(cov.uncovered, [])
  assert.equal(cov.points[0].deficit, 2)
})

test('只声明"在边上"的派生点判为未确定（会沿线滑动）', () => {
  const s = S([
    { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 },
    { label: 'D', x: 3, y: 0, derived: { on_segment: 'AB' } }
  ])
  const cov = derivedPointCoverage(s, [makeConstraint('on_segment', { point: 'D', of: ['A', 'B'] }, 'model_derived', '')])
  assert.equal(cov.allDetermined, false)
  assert.deepEqual(cov.uncovered, ['D'])
  assert.equal(cov.points[0].deficit, 1)
})

test('角平分线 + 落边 两条 1 亏损约束联合判为已确定', () => {
  const s = S([
    { label: 'A', x: 0, y: 0 }, { label: 'D', x: 1, y: 1, derived: { on_segment: 'BC' } }
  ])
  const cs = [
    makeConstraint('on_segment', { point: 'D', of: ['B', 'C'] }, 'model_derived', ''),
    makeConstraint('angle_bisector', { ray: ['A', 'D'], of: { vertex: 'A', from: 'B', to: 'C' } }, 'text', '')
  ]
  const cov = derivedPointCoverage(s, cs)
  assert.equal(cov.points[0].deficit, 2)
  assert.equal(cov.allDetermined, true)
})

test('无派生点时不受本判据影响（不误伤普通几何题）', () => {
  const s = S([{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }])
  const cov = derivedPointCoverage(s, [])
  assert.equal(cov.allDetermined, true)
  assert.deepEqual(cov.points, [])
})

// ── assessDerivedReadiness（走真实题干抽取） ──

test('题干"CD⊥AB于点D"能把 D 确定', () => {
  const s = S([
    { label: 'A', x: 10, y: 80 }, { label: 'B', x: 90, y: 80 }, { label: 'C', x: 40, y: 20 },
    { label: 'D', x: 40, y: 80, derived: { foot: { from: 'C', on_line: ['A', 'B'] } } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' }])
  const r = assessDerivedReadiness(s, '如图，在△ABC中，CD⊥AB于点D。')
  assert.equal(r.allDetermined, true)
  assert.equal(r.points[0].sources.some(x => x.includes('text')), true)
})

test('题干只说"点D在边AB上"时 D 判为未确定', () => {
  const s = S([
    { label: 'A', x: 10, y: 80 }, { label: 'B', x: 90, y: 80 }, { label: 'C', x: 45, y: 15 },
    { label: 'D', x: 30, y: 62, derived: { on_segment: 'AB' } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' }])
  const r = assessDerivedReadiness(s, '如图，在△ABC中，点D在边AB上，连接CD。')
  assert.equal(r.allDetermined, false)
  assert.deepEqual(r.uncovered, ['D'])
})

test('模型幻觉派生点（题干从未出现该字母）被防溢出校验丢弃 → 未确定', () => {
  const s = S([
    { label: 'A', x: 10, y: 80 }, { label: 'B', x: 90, y: 80 }, { label: 'C', x: 45, y: 15 },
    { label: 'D', x: 47, y: 79, derived: { midpoint: ['A', 'B'] } },
    { label: 'E', x: 50, y: 79, derived: { midpoint: ['A', 'B'] } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' }])
  const r = assessDerivedReadiness(s, '如图，在△ABC中，D是边AB的中点，连接CD。')
  assert.equal(r.allDetermined, false)
  assert.deepEqual(r.uncovered, ['E'])
  assert.ok(r.dropped.some(x => x.includes('letter_not_in_both')), 'E 的约束应被丢弃')
})

test('折叠：题干给出折痕时 B′ 被确定（reflect 已接入题干抽取）', () => {
  const s = S([
    { label: 'A', x: 10, y: 80 }, { label: 'B', x: 40, y: 20 }, { label: 'C', x: 90, y: 80 },
    { label: 'B′', x: 62, y: 74, derived: { reflect: { source: 'B', axis: ['A', 'C'] } } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'A', to: 'B′' }])
  const r = assessDerivedReadiness(s, '如图，在△ABC中，将△ABC沿AC折叠，点B落在点B′处，连接AB′。')
  assert.equal(r.allDetermined, true)
  assert.equal(r.points[0].deficit, 2, 'reflect 完全确定平面点')
})

test('重心：题干给出三心句式时 G 被确定', () => {
  const s = S([
    { label: 'A', x: 20, y: 70 }, { label: 'B', x: 80, y: 70 }, { label: 'C', x: 50, y: 20 },
    { label: 'G', x: 50, y: 53, derived: { centroid: ['A', 'B', 'C'] } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'A', to: 'G' }])
  const r = assessDerivedReadiness(s, '如图，在△ABC中，点G是△ABC的重心，连接AG。')
  assert.equal(r.allDetermined, true)
  assert.equal(r.points[0].deficit, 2, 'centroid 完全确定平面点')
})

test('折叠但题干没给折痕 → 仍未确定（绝不猜轴）', () => {
  const s = S([
    { label: 'A', x: 10, y: 80 }, { label: 'B', x: 40, y: 20 }, { label: 'C', x: 90, y: 80 },
    { label: 'B′', x: 62, y: 74, derived: { reflect: { source: 'B' } } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'A', to: 'B′' }])
  const r = assessDerivedReadiness(s, '如图，将△ABC折叠，点B落在点B′处。')
  assert.equal(r.allDetermined, false)
  assert.deepEqual(r.uncovered, ['B′'])
})

// ── canPublishDerivedFigure（两道闸合成） ──

const MIDPOINT_CASE = () => ({
  structure: S([
    { label: 'A', x: 10, y: 80 }, { label: 'B', x: 90, y: 80 }, { label: 'C', x: 45, y: 15 },
    { label: 'D', x: 47, y: 79, derived: { midpoint: ['A', 'B'] } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' }]),
  content: '如图，在△ABC中，D是边AB的中点，连接CD。'
})

test('两道闸都过 → 允许入库', () => {
  const { structure, content } = MIDPOINT_CASE()
  const corr = correctGeometryFigure(structure, content)
  assert.equal(corr.ok, true, '良构中点题求解器应通过')
  const d = canPublishDerivedFigure(structure, content, { ...corr.solved, svg: corr.svg })
  assert.equal(d.ok, true)
  assert.deepEqual(d.uncovered, [])
})

test('求解器没过 → 拒绝（即便派生点被确定）', () => {
  const { structure, content } = MIDPOINT_CASE()
  const d = canPublishDerivedFigure(structure, content, { skipped: true, reason: 'inconsistent' })
  assert.equal(d.ok, false)
  assert.equal(d.reason, 'solver:inconsistent')
})

test('求解器过了但派生点未被确定 → 拒绝', () => {
  const s = S([
    { label: 'A', x: 10, y: 80 }, { label: 'B', x: 90, y: 80 }, { label: 'C', x: 45, y: 15 },
    { label: 'D', x: 30, y: 62, derived: { on_segment: 'AB' } }
  ], [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }, { from: 'C', to: 'D' }])
  const content = '如图，在△ABC中，点D在边AB上，连接CD。'
  const corr = correctGeometryFigure(s, content)
  assert.equal(corr.ok, true, '求解器本身能收敛')
  const d = canPublishDerivedFigure(s, content, corr.solved)
  assert.equal(d.ok, false, '但派生点未被确定，仍须回退')
  assert.equal(d.reason, 'undetermined:D')
})

test('structure.solved 缺失 / 形状不完整 / skipped 一律拒绝（fail-closed）', () => {
  const { structure, content } = MIDPOINT_CASE()
  const cases = [
    [undefined, 'missing'],
    [null, 'missing'],
    [{}, 'evidence_incomplete'],
    [{ converged: true }, 'evidence_incomplete'],
    [{ converged: true, pass: true }, 'evidence_incomplete'],
    [{ skipped: true, reason: 'no_constraints' }, 'no_constraints'],
    [{ converged: false, pass: true, degenerate: false }, 'evidence_incomplete'],
    [{ converged: true, pass: false, degenerate: false }, 'evidence_incomplete'],
    [{ converged: true, pass: true, degenerate: true }, 'evidence_incomplete']
  ]
  for (const [solved, why] of cases) {
    const d = canPublishDerivedFigure(structure, content, solved)
    assert.equal(d.ok, false, `${JSON.stringify(solved)} 应拒绝`)
    assert.equal(d.reason, `solver:${why}`, `${JSON.stringify(solved)} 的原因应为 ${why}`)
  }
})

test('求解器结果必须是"收敛 + 闸门通过 + 非退化"三项正面证据齐备', () => {
  const { structure, content } = MIDPOINT_CASE()
  const d = canPublishDerivedFigure(structure, content, { converged: true, pass: true, degenerate: false })
  assert.equal(d.ok, true)
})
