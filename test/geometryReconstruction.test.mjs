import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSymbolLabel,
  isEmptyStructure,
  isRawEmptyStructure,
  hasDerivedPoints,
  parseGeometryStructure,
  renderGeometrySvg
} from '../server/utils/geometrySvg.js'

// 线上真实故障：视觉模型把 points 输出成纯标签数组，顶点没有坐标，
// 但 segments 非空使旧版 isEmptyStructure 判为"有结构"，最终渲染出 null
// 并被标成不可重试的 failed，45 条资产永久卡在 failed 且扫不回来。
test('顶点无坐标时判为不可渲染，而非有效结构', () => {
  const structure = parseGeometryStructure(JSON.stringify({
    figure_type: 'geometry',
    points: ['A', 'B', 'C'],
    segments: [{ start: 'A', end: 'B' }, { start: 'B', end: 'C' }],
    circles: []
  }))
  assert.equal(structure.points.length, 0)
  assert.equal(isEmptyStructure(structure), true)
  assert.equal(isRawEmptyStructure(structure), false)
})

test('模型答"没有几何图"与"格式不合格"可区分', () => {
  const none = parseGeometryStructure(JSON.stringify({ points: [], segments: [], circles: [] }))
  assert.equal(isRawEmptyStructure(none), true)
  assert.equal(isEmptyStructure(none), true)

  const malformed = parseGeometryStructure(JSON.stringify({
    points: [],
    segments: [{ start: 'A', end: 'B' }]
  }))
  assert.equal(isRawEmptyStructure(malformed), false)
  assert.equal(isEmptyStructure(malformed), true)
})

// 教材插图本身通常不带数字，图旁的 4 / 5/2 / √18 多是学生手写的已知条件与答案。
// 抄进重绘图会让学生算出的结果伪装成题设，比残留笔迹更危险。
test('数字与带单位的标注一律不进图', () => {
  for (const text of ['4', '5/2', '2', '√18', '96', '90°', '30', '6cm', '第11题', '3.5', 'x=2']) {
    assert.equal(isSymbolLabel(text), false, `${text} 不该被收录`)
  }
})

test('角名线名等符号标注保留', () => {
  for (const text of ['α', 'β', 'θ', 'l', 'm']) {
    assert.equal(isSymbolLabel(text), true, `${text} 应被收录`)
  }
})

test('渲染结果不含数字标注但含符号标注', () => {
  const svg = renderGeometrySvg({
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 20, y: 30 },
      { label: 'B', x: 20, y: 10 },
      { label: 'C', x: 60, y: 10 }
    ],
    segments: [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' }
    ],
    labels: [
      { text: '√18', x: 40, y: 8 },
      { text: '90°', x: 55, y: 16 },
      { text: 'α', x: 25, y: 25 }
    ]
  })
  assert.ok(svg)
  assert.ok(!svg.includes('√18'))
  assert.ok(!svg.includes('90'))
  assert.ok(svg.includes('>α<'))
})

test('派生点被识别出来以便降级', () => {
  const withDerived = parseGeometryStructure(JSON.stringify({
    points: [
      { label: 'A', x: 0, y: 100 },
      { label: 'B', x: 100, y: 0 },
      { label: 'D', x: 45, y: 50, derived: { on_segment: 'AB' } }
    ],
    segments: [{ from: 'A', to: 'B' }]
  }))
  assert.equal(hasDerivedPoints(withDerived), true)

  const freeOnly = parseGeometryStructure(JSON.stringify({
    points: [{ label: 'A', x: 0, y: 100 }, { label: 'B', x: 100, y: 0 }],
    segments: [{ from: 'A', to: 'B' }]
  }))
  assert.equal(hasDerivedPoints(freeOnly), false)
})
