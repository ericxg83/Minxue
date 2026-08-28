import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateStructureAgainstContent,
  extractReferencedPoints
} from '../server/utils/geometryContentGate.js'

// 2026-08-28 抽样实测的两条错图，题干为线上原文。闸门必须拦住它们。
test('折叠题：画成矩形加对角线，缺派生点 C′ 且多画 DB → 拦截', () => {
  const structure = {
    points: [
      { label: 'A', x: 10, y: 80 }, { label: 'B', x: 10, y: 10 },
      { label: 'C', x: 80, y: 10 }, { label: 'D', x: 80, y: 80 },
      { label: 'E', x: 80, y: 45 }
    ],
    segments: [
      { from: 'A', to: 'C' }, { from: 'C', to: 'D' },
      { from: 'D', to: 'B' }, { from: 'A', to: 'B' },
      { from: 'B', to: 'E' }, { from: 'E', to: 'D' }
    ]
  }
  const content = '在边长为5的正方形ABCD中，点E为CD上一点，连接BE，将△BCE沿着BE折叠得到△BC′E，连接AC′、DC′，若∠CDA′的度数'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(s => s.includes('C′')), '必须点出派生点丢失')
  assert.ok(
    r.reasons.some(s => s.includes('AC') || s.includes('BD')),
    '必须点出凭空画出的对角线'
  )
})

test('作图题：题干说垂足为E，模型把 D 画成 E 的错位 → 拦截', () => {
  const structure = {
    points: [{ label: 'C' }, { label: 'E' }, { label: 'B' }, { label: 'A' }],
    segments: [{ from: 'C', to: 'E' }, { from: 'E', to: 'B' }, { from: 'A', to: 'B' }]
  }
  const content = '作图，(1)过△ABC的顶点C作直线CD，使得CD//AB；(2)作点B到直线CD的垂线，垂足为点E'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, false)
})

test('正常梯形图 → 放行', () => {
  const structure = {
    points: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const content = '如图，在梯形ABCD中，AB//CD，∠C=90°，AB=√6，BC=√18，CD=√96，AD=√72'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('正确画出派生点的折叠图 → 放行', () => {
  const structure = {
    points: [{ label: 'C' }, { label: 'B' }, { label: 'E' }, { label: 'C′' }],
    segments: [
      { from: 'C', to: 'B' }, { from: 'B', to: 'E' }, { from: 'E', to: 'C′' }
    ]
  }
  const content = '将△BCE沿着BE折叠得到△BC′E，连接AC′'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('三角形公共边情形：△ABC 与 △DEF 共用题干的顶点都允许', () => {
  const structure = {
    points: [
      { label: 'A' }, { label: 'B' }, { label: 'C' },
      { label: 'D' }, { label: 'E' }, { label: 'F' }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' },
      { from: 'D', to: 'E' }, { from: 'E', to: 'F' }, { from: 'F', to: 'D' }
    ]
  }
  const content = '在△ABC和△DEF中，如果∠A=45°，AB=12cm，AC=15cm，∠D=45°，DE=16cm'
  const r = validateStructureAgainstContent(structure, content)
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('空题干不拦（无证据时不误杀）', () => {
  const structure = { points: [{ label: 'A' }], segments: [] }
  assert.equal(validateStructureAgainstContent(structure, '').ok, true)
  assert.equal(validateStructureAgainstContent(structure, null).ok, true)
})

test('题干说正方形却画成 2:1 矩形 → 拦截', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 40 }, { label: 'B', x: 0, y: 0 },
      { label: 'C', x: 80, y: 0 }, { label: 'D', x: 80, y: 40 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const r = validateStructureAgainstContent(structure, '在边长为5的正方形ABCD中，点E为CD上一点')
  assert.equal(r.ok, false)
  assert.ok(r.reasons.some(s => s.includes('正方形')), r.reasons.join('；'))
})

test('正方形画成正方形 → 放行', () => {
  const structure = {
    points: [
      { label: 'A', x: 0, y: 40 }, { label: 'B', x: 0, y: 0 },
      { label: 'C', x: 40, y: 0 }, { label: 'D', x: 40, y: 40 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
      { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const r = validateStructureAgainstContent(structure, '在正方形ABCD中，AC与BD交于点O')
  assert.equal(r.ok, true, r.reasons.join('；'))
})

test('Rt△/tan 等缩写不当作点', () => {
  const pts = extractReferencedPoints('在Rt△ABC中，tan∠BAC的值是')
  assert.ok(pts.has('A') && pts.has('B') && pts.has('C'))
  assert.ok(!pts.has('R') && !pts.has('T'), 'Rt 不该拆出点')
})
