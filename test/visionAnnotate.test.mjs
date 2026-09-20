/**
 * 函数图象视觉标注增强 —— mergeVisionLabels 坐标映射测试。
 *
 * 背景（2026-09-18）：函数图象确定性通道"读字不读图"，题干没写坐标的字母被丢。
 * V2 方案：确定性骨架 + 视觉模型看原图识别全部标注 → 数学坐标映射合并。
 * 本测试锁定合并逻辑的正确性（不依赖真实视觉调用，直接喂模拟识别结果）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeVisionLabels } from '../server/utils/functionGraph/visionAnnotate.js'
import { specToGeometryStructure } from '../server/utils/functionGraph/buildStructure.js'
import { parseFunctionGraphSpec } from '../server/utils/functionGraph/parseSpec.js'

const TEXT = '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；'
const spec = parseFunctionGraphSpec('', TEXT)
assert.ok(spec, 'spec 应能解析')

/** 模拟视觉识别：理想情况 A/B/C/D/O 全部命中且位置合理 */
const IDEAL_VISION = [
  { label: 'A', rx: 10, ry: 65 },
  { label: 'B', rx: 75, ry: 65 },
  { label: 'C', rx: 20, ry: 30 },
  { label: 'D', rx: 65, ry: 35 },
  { label: 'O', rx: 35, ry: 75 }
]

test('合并：A/B/C/D/O 全部保留，坐标数学正确', () => {
  const base = specToGeometryStructure(spec)
  const merged = mergeVisionLabels(base, IDEAL_VISION, spec, TEXT)
  const m = new Map(merged.points.map(p => [p.label, p]))
  assert.ok(m.has('A') && m.has('B') && m.has('C') && m.has('D') && m.has('O'), '五个标注全在')
  assert.ok(Math.abs(m.get('A').x - -1) < 0.3 && Math.abs(m.get('A').y) < 0.3, 'A≈(-1,0)')
  assert.ok(Math.abs(m.get('B').x - 3) < 0.3 && Math.abs(m.get('B').y) < 0.3, 'B≈(3,0)')
  assert.ok(Math.abs(m.get('C').x) < 0.3 && Math.abs(m.get('C').y - 3) < 0.3, 'C≈(0,3)')
  // D 吸附到曲线：y = -1*(x-1)²+4
  const d = m.get('D')
  const pred = -1 * (d.x - 1) * (d.x - 1) + 4
  assert.ok(Math.abs(pred - d.y) < 0.05, `D 应在曲线上 (${d.x},${d.y}) 预测 y=${pred}`)
})

test('合并：视觉漏报字母时仍保留确定性骨架的点（不因视觉失败丢字母）', () => {
  const base = specToGeometryStructure(spec)
  const merged = mergeVisionLabels(base, [{ label: 'C', rx: 20, ry: 30 }], spec, TEXT)
  const m = new Map(merged.points.map(p => [p.label, p]))
  // 骨架里 xInterceptLabels 已把 A/B 配对、symbolicCurveLabels 已给 D 示意位置
  assert.ok(m.has('A') && m.has('B') && m.has('C') && m.has('D'), '骨架点全在，不因视觉漏报丢失')
})

test('合并：视觉识别的新字母（题干也提到）补进结构', () => {
  // 假设原图还有一个题干提到的 E（如"点E在抛物线上"但骨架没算到）
  const base = specToGeometryStructure(spec)
  const vision = [...IDEAL_VISION, { label: 'E', rx: 50, ry: 20 }]
  const merged = mergeVisionLabels(base, vision, spec, TEXT + '点E(3,4)是抛物线上一点')
  const m = new Map(merged.points.map(p => [p.label, p]))
  assert.ok(m.has('E'), '题干提到的 E 应补进结构')
})

test('合并：题干没提到的字母（插图噪声）不补', () => {
  const base = specToGeometryStructure(spec)
  const vision = [...IDEAL_VISION, { label: 'Z', rx: 90, ry: 90 }]
  const merged = mergeVisionLabels(base, vision, spec, TEXT) // TEXT 里没有 Z
  const m = new Map(merged.points.map(p => [p.label, p]))
  assert.ok(!m.has('Z'), '题干未提到的 Z 不应被补进')
})

test('合并：视觉位置严重偏离时不破坏确定性点', () => {
  // 视觉给出的 A/B 位置明显错误（全挤在一起），但数学锚点校验仍把 A/B 放在根上
  const base = specToGeometryStructure(spec)
  const vision = [
    { label: 'A', rx: 50, ry: 50 },
    { label: 'B', rx: 52, ry: 50 },
    { label: 'O', rx: 50, ry: 50 },
    { label: 'C', rx: 50, ry: 50 }
  ]
  const merged = mergeVisionLabels(base, vision, spec, TEXT)
  const m = new Map(merged.points.map(p => [p.label, p]))
  // 骨架（数学精确）优先：A/B 仍在根上
  assert.ok(m.has('A') && Math.abs(m.get('A').x - -1) < 0.3, 'A 仍应在 x=-1（骨架优先）')
  assert.ok(m.has('B') && Math.abs(m.get('B').x - 3) < 0.3, 'B 仍应在 x=3（骨架优先）')
})

test('合并：无视觉标注时原样返回', () => {
  const base = specToGeometryStructure(spec)
  const merged = mergeVisionLabels(base, [], spec, TEXT)
  assert.equal(merged, base, '空视觉标注不改动结构')
})