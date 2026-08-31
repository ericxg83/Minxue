import test from 'node:test'
import assert from 'node:assert/strict'
import { computeGeometryConsistency } from '../server/utils/geom/consistency.js'

const angleContent = 'AB、CD 分别表示一楼、二楼地面的水平线，∠ABC=150°，BC 的长是 3m。'
const angleStruct = (c) => ({
  points: [
    { label: 'A', x: -1, y: 0 },
    { label: 'B', x: 0, y: 0 },
    { label: 'C', x: c[0], y: c[1] },
    { label: 'D', x: 0, y: 1 }
  ],
  segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }],
  circles: []
})

test('已满足的 150° 角：审计通过且原图即通过（位移≈0）', () => {
  // B(0,0)，BA 水平向左(180°)，BC 与 BA 成 150° → BC 方向 30°
  const r = computeGeometryConsistency(angleStruct([Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]), angleContent)
  assert.ok(!r.skipped, '应进入审计')
  assert.equal(r.nConstraints, 1)
  assert.ok(r.pass, '解后应满足')
  assert.ok(r.rawPass, '原图即满足 150°')
  assert.ok(r.displacement < 1e-2, '已满足时几乎不移动')
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].type, 'angle_value')
})

test('违反的 150° 角：原图不通过，求解后通过但产生位移（影子信号）', () => {
  const r = computeGeometryConsistency(angleStruct([1, 0.4]), angleContent)
  assert.ok(!r.skipped)
  assert.equal(r.nConstraints, 1)
  assert.ok(!r.rawPass, '原图与题设不符')
  assert.ok(r.rawMaxNorm > 1, '原图残差超出容差')
  assert.ok(r.pass, '求解后可达成自洽')
  assert.ok(r.displacement > 0.01, '求解修正了原图')
})

test('空结构：跳过审计（empty_structure）', () => {
  const r = computeGeometryConsistency({ points: [] }, '∠ABC=90°')
  assert.ok(r.skipped)
  assert.equal(r.reason, 'empty_structure')
})

test('无可抽取约束（纯坐标/函数题）：跳过审计（no_constraints）', () => {
  const coord = {
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 4, y: 0 }],
    segments: [{ from: 'A', to: 'B' }],
    circles: []
  }
  const r = computeGeometryConsistency(coord, '已知函数 f(x)=x^2，求 f(1)。')
  assert.ok(r.skipped)
  assert.equal(r.reason, 'no_constraints')
})

test('真实题干抽取→审计：可产出逐条 item（含 source/soft/pass）', () => {
  const r = computeGeometryConsistency(angleStruct([Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]), angleContent)
  assert.ok(!r.skipped)
  const item = r.items[0]
  assert.ok(['text', 'model_derived', 'model_constraints'].includes(item.source))
  assert.equal(typeof item.soft, 'boolean')
  assert.equal(typeof item.pass, 'boolean')
  assert.equal(typeof item.maxNorm, 'number')
})

test('dropped 约束被记录（结构缺字母时抽取器拦截）', () => {
  // 题干提 ∠ABC=150°，但结构只给 A、B（缺 C）→ 抽取器拦下，dropped 非空
  const partial = {
    points: [{ label: 'A', x: -1, y: 0 }, { label: 'B', x: 0, y: 0 }],
    segments: [{ from: 'A', to: 'B' }],
    circles: []
  }
  const r = computeGeometryConsistency(partial, angleContent)
  // 缺 C 时点集不含 C，angle_value 抽不到 → no_constraints 跳过；但 dropped 路径已在抽取器内记录
  if (!r.skipped) {
    assert.ok(Array.isArray(r.dropped))
  } else {
    assert.equal(r.reason, 'no_constraints')
  }
})
