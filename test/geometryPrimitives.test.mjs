import test from 'node:test'
import assert from 'node:assert/strict'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'
import {
  normalizeStructure,
  isEmptyStructure,
  isRawEmptyStructure
} from '../server/utils/geom/structure.js'

// 2026-09-18 阶段 1：渲染器补「面 / 弧 / 角标记」三类能力。
// 背景：旧渲染器只有 line / circle / 直角折线，教材里的阴影区域、扇形弧、
// 角标记一概画不出来。补齐后仍必须满足一条硬约束——
// 结构里没有新元素时，输出必须与旧版逐字节一致（由 geometryRenderSnapshot 锁定）。

const SQUARE = {
  figure_type: 'geometry',
  points: [
    { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 },
    { label: 'C', x: 10, y: 10 }, { label: 'D', x: 0, y: 10 }
  ],
  segments: [
    { from: 'A', to: 'B' }, { from: 'B', to: 'C' },
    { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
  ]
}

/** 取出 SVG 里第一条 path 的 d 串 */
const firstPathD = (svg) => svg?.match(/<path d="([^"]+)"/)?.[1] ?? null
/** 取出 SVG 里的 polygon 元素串 */
const polygons = (svg) => svg?.match(/<polygon[^>]*>/g) ?? []

// ── 多边形填充 ────────────────────────────────────────────────────────────

test('阴影多边形：顶点齐备且各边已在 segments 中 → 上色', () => {
  const svg = renderGeometrySvg({ ...SQUARE, polygons: [{ points: ['A', 'B', 'C', 'D'], fill: true }] })
  assert.ok(svg.includes('fill="#d9d9d9"'), '应有浅灰填充组')
  const pg = polygons(svg)
  assert.equal(pg.length, 1)
  assert.ok(pg[0].includes('points="'), '多边形应输出顶点串')
})

test('多边形某条边不在 segments 里 → 不上色（边界未经闸门核对）', () => {
  // 去掉 CD 边：ABCD 不再闭合，说明"这个区域"没有经过内容闸门核对，宁可不上色
  const structure = {
    ...SQUARE,
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'D', to: 'A' }],
    polygons: [{ points: ['A', 'B', 'C', 'D'], fill: true }]
  }
  const svg = renderGeometrySvg(structure)
  assert.equal(polygons(svg).length, 0, '边不齐时不应上色')
  assert.ok(!svg.includes('fill="#d9d9d9"'))
})

test('多边形引用了不存在的顶点 → 不上色', () => {
  const svg = renderGeometrySvg({ ...SQUARE, polygons: [{ points: ['A', 'B', 'C', 'E'], fill: true }] })
  assert.equal(polygons(svg).length, 0)
})

test('fill=false 的多边形不渲染（轮廓由 segments 表达，避免重复描边）', () => {
  const svg = renderGeometrySvg({ ...SQUARE, polygons: [{ points: ['A', 'B', 'C', 'D'], fill: false }] })
  assert.equal(polygons(svg).length, 0)
  assert.ok(!svg.includes('fill="#d9d9d9"'))
})

// ── 圆弧 ──────────────────────────────────────────────────────────────────

const SECTOR = {
  figure_type: 'geometry',
  points: [
    { label: 'O', x: 0, y: 0 },
    { label: 'A', x: 10, y: 0 },   // 数学角 0°
    { label: 'B', x: 0, y: 10 }    // 数学角 90°
  ],
  segments: [{ from: 'O', to: 'A' }, { from: 'O', to: 'B' }]
}

test('圆弧：逆时针扫角小于 180° → large-arc-flag = 0', () => {
  const svg = renderGeometrySvg({ ...SECTOR, arcs: [{ center: 'O', from: 'A', to: 'B' }] })
  const d = firstPathD(svg)
  assert.ok(d, '应输出 path')
  // d 形如 M x y A r r 0 <largeArc> 1 x y
  assert.match(d, /^M [\d.-]+ [\d.-]+ A [\d.-]+ [\d.-]+ 0 0 1 [\d.-]+ [\d.-]+$/)
})

test('圆弧：逆时针扫角大于 180° → large-arc-flag = 1（优弧）', () => {
  // B 放到 270°（数学坐标 (0,-10)）：从 0° 逆时针到 270° = 270° > 180°
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: 'O', x: 0, y: 0 },
      { label: 'A', x: 10, y: 0 },
      { label: 'B', x: 0, y: -10 }
    ],
    segments: [{ from: 'O', to: 'A' }, { from: 'O', to: 'B' }],
    arcs: [{ center: 'O', from: 'A', to: 'B' }]
  }
  const d = firstPathD(renderGeometrySvg(structure))
  assert.match(d, /^M [\d.-]+ [\d.-]+ A [\d.-]+ [\d.-]+ 0 1 1 [\d.-]+ [\d.-]+$/)
})

test('圆弧：center 或端点不存在 → 不输出 path', () => {
  const svg = renderGeometrySvg({ ...SECTOR, arcs: [{ center: 'O', from: 'A', to: 'Z' }] })
  assert.equal(firstPathD(svg), null)
})

// ── 角标记 ────────────────────────────────────────────────────────────────

test('角标记：顶点处输出固定半径 14px 的小圆弧', () => {
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }, { label: 'C', x: 0, y: 10 }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }],
    angleMarks: [{ vertex: 'A', from: 'B', to: 'C' }]
  }
  const d = firstPathD(renderGeometrySvg(structure))
  assert.ok(d, '应输出角标记 path')
  assert.ok(d.includes('A 14 14 '), '角标记半径应固定为 14px')
})

test('角标记：顶点或边端点不存在 → 不输出 path', () => {
  const structure = {
    figure_type: 'geometry',
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }],
    segments: [{ from: 'A', to: 'B' }],
    angleMarks: [{ vertex: 'A', from: 'B', to: 'C' }]
  }
  assert.equal(firstPathD(renderGeometrySvg(structure)), null)
})

// ── 向后兼容：没有新元素时输出不含 path / polygon ─────────────────────────

test('旧结构（无新元素）的输出里不出现 path / polygon', () => {
  const svg = renderGeometrySvg(SQUARE)
  assert.ok(!svg.includes('<path'), '旧结构不应凭空多出 path')
  assert.ok(!svg.includes('<polygon'), '旧结构不应凭空多出 polygon')
  assert.ok(!svg.includes('#d9d9d9'), '旧结构不应凭空多出填充色')
})

// ── 结构规范化 ────────────────────────────────────────────────────────────

test('polygons 支持 vertices 别名，少于 3 个顶点丢弃', () => {
  const s = normalizeStructure({ polygons: [{ vertices: ['A', 'B', 'C'] }, { points: ['A', 'B'] }] })
  assert.equal(s.polygons.length, 1)
  assert.deepEqual(s.polygons[0].points, ['A', 'B', 'C'])
  assert.equal(s.polygons[0].fill, false, 'fill 默认 false')
})

test('arcs / angleMarks 缺字段时丢弃', () => {
  const s = normalizeStructure({
    arcs: [{ center: 'O', from: 'A', to: 'B' }, { center: 'O' }],
    angleMarks: [{ vertex: 'A', from: 'B', to: 'C' }, { vertex: 'A' }]
  })
  assert.equal(s.arcs.length, 1)
  assert.equal(s.angleMarks.length, 1)
})

test('规范化默认产出空的 polygons / arcs / angleMarks（旧结构兼容）', () => {
  const s = normalizeStructure({ points: [{ label: 'A', x: 0, y: 0 }] })
  assert.deepEqual(s.polygons, [])
  assert.deepEqual(s.arcs, [])
  assert.deepEqual(s.angleMarks, [])
})

test('只有多边形（无线段无圆）时不算空结构', () => {
  const s = normalizeStructure({
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }, { label: 'C', x: 0, y: 10 }
    ],
    polygons: [{ points: ['A', 'B', 'C'], fill: true }]
  })
  assert.equal(isEmptyStructure(s), false)
  assert.equal(isRawEmptyStructure(s), false)
})

test('多边形顶点全不存在时仍判为空结构', () => {
  const s = normalizeStructure({ polygons: [{ points: ['X', 'Y', 'Z'], fill: true }] })
  assert.equal(isEmptyStructure(s), true)
})

// ── TikZ 渲染器同步 ───────────────────────────────────────────────────────

test('TikZ 同步支持多边形填充 / 圆弧 / 角标记', () => {
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: 'O', x: 0, y: 0 }, { label: 'A', x: 10, y: 0 },
      { label: 'B', x: 0, y: 10 }, { label: 'C', x: 10, y: 10 }
    ],
    segments: [
      { from: 'O', to: 'A' }, { from: 'A', to: 'C' },
      { from: 'C', to: 'B' }, { from: 'B', to: 'O' },
      { from: 'O', to: 'C' }
    ],
    polygons: [{ points: ['O', 'A', 'C', 'B'], fill: true }],
    arcs: [{ center: 'O', from: 'A', to: 'B' }],
    angleMarks: [{ vertex: 'O', from: 'A', to: 'B' }]
  }
  const tikz = renderGeometryTikZ(structure)
  assert.ok(tikz.startsWith('\\begin{tikzpicture}'))
  assert.ok(tikz.includes('fill=black!12'), '多边形应有填充选项')
  assert.ok(tikz.includes('-- cycle'), '多边形应闭合')
  assert.ok(tikz.includes('arc[start angle='), '应输出圆弧')
  assert.ok(tikz.includes('radius=0.4'), '角标记半径应为 0.4 单位')
})

test('TikZ 与 SVG 对同一条边不闭合的多边形都不上色', () => {
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 },
      { label: 'C', x: 10, y: 10 }, { label: 'D', x: 0, y: 10 }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }],
    polygons: [{ points: ['A', 'B', 'C', 'D'], fill: true }]
  }
  assert.ok(!renderGeometryTikZ(structure).includes('fill=black!12'))
  assert.equal(polygons(renderGeometrySvg(structure)).length, 0)
})
