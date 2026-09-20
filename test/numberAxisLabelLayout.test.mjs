import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectNumberAxis,
  resolveNumberAxisLabels,
  normalizeStructure
} from '../server/utils/geom/structure.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'

/**
 * 2026-09-19 事故：数轴上的数值标注画歪了。
 *
 * 老师原话："字母太下面了，而且这个小圆点应该是在数轴上。"
 *
 * 根因不是模型：数轴上的数值标注（a/b/c、-2/0/1…）在 DSL 里只能用 `point` 承载坐标
 * （命令集没有"只画文字"的等价物），渲染器却把它当几何顶点——
 *   ① 圆点画在模型写的坐标上，而模型为了"文字放轴下方"把 y 写成 -9 → 圆点浮在轴外；
 *   ② 字母走 labelOffset「远离所有点质心」摆放，数轴题的点**全部共线**，质心方向退化，
 *      字母被推散到左右两侧，恰在质心正上方的那个（刻度 0）被垂直推得最远
 *      （实测距轴 35.7px vs 其他 21px）——同图标签距轴距离参差不齐。
 *
 * 修复：`resolveNumberAxisLabels` 作为 SVG / TikZ 两个渲染器的**唯一口径**，
 * 把标签圆点吸附回轴上、文字统一摆到正下/正上方居中。
 *
 * 本测试锁死五件事：正向识别、穿越轴刻度的识别、误伤防护、真顶点不被吸附、两渲染器一致。
 */

// ── 测试用结构 ──

/** 数轴 + 6 条朝上刻度 + 孤立数值标签（复刻 1860792d 的真实坐标） */
const NUM_AXIS = {
  figure_type: 'geometry',
  points: [
    { label: '_ax0', x: 5, y: 0 }, { label: '_ax1', x: 205, y: 0 },
    { label: '_arr_t', x: 197, y: 3 }, { label: '_arr_b', x: 197, y: -3 },
    { label: '_tk1_b', x: 20, y: 0 }, { label: '_tk1_t', x: 20, y: 5 },
    { label: '_tk2_b', x: 80, y: 0 }, { label: '_tk2_t', x: 80, y: 5 },
    { label: '_tk3_b', x: 140, y: 0 }, { label: '_tk3_t', x: 140, y: 5 },
    { label: 'c', x: 20, y: -9 }, { label: 'b', x: 80, y: -9 }, { label: 'a', x: 140, y: -9 }
  ],
  segments: [
    { from: '_ax0', to: '_ax1' },
    { from: '_arr_t', to: '_ax1' }, { from: '_arr_b', to: '_ax1' },
    { from: '_tk1_b', to: '_tk1_t' }, { from: '_tk2_b', to: '_tk2_t' }, { from: '_tk3_b', to: '_tk3_t' }
  ]
}

/** 数轴（刻度穿过轴，复刻 1cb0d196）+ 数字在下、点名在上 */
const CROSS_TICK_AXIS = {
  figure_type: 'geometry',
  points: [
    { label: '_ax0', x: 10, y: 0 }, { label: '_ax1', x: 165, y: 0 },
    { label: '_arr_t', x: 159, y: 3 }, { label: '_arr_b', x: 159, y: -3 },
    { label: '_t1b', x: 20, y: -2 }, { label: '_t1t', x: 20, y: 3 },
    { label: '_t2b', x: 50, y: -2 }, { label: '_t2t', x: 50, y: 3 },
    { label: '0', x: 20, y: -9 }, { label: '1', x: 50, y: -9 },
    { label: 'P', x: 35, y: 9 }, { label: 'Q', x: 65, y: 9 }
  ],
  segments: [
    { from: '_ax0', to: '_ax1' },
    { from: '_arr_t', to: '_ax1' }, { from: '_arr_b', to: '_ax1' },
    { from: '_t1b', to: '_t1t' }, { from: '_t2b', to: '_t2t' }
  ]
}

// ── SVG / TikZ 解析小工具 ──

const svgAxisY = (svg) => {
  const m = svg.match(/<line x1="[-\d.]+" y1="([-\d.]+)"/)
  return m ? Number(m[1]) : null
}
const svgDots = (svg) =>
  [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g)].map(m => ({ cx: Number(m[1]), cy: Number(m[2]) }))
const svgTexts = (svg) =>
  [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="(\w+)">([^<]*)<\/text>/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), anchor: m[3], t: m[4] }))
const textOf = (svg, t) => svgTexts(svg).find(x => x.t === t)

// ── 1. 正向识别 ──

test('识别数轴：水平轴 + 同侧短刻度（两端均为 _ 辅助点）', () => {
  const s = normalizeStructure(NUM_AXIS)
  const axis = detectNumberAxis(s.points, s.segments)
  assert.ok(axis, '应识别为数轴')
  assert.equal(axis.y, 0)
  assert.equal(axis.x0, 5)
  assert.equal(axis.x1, 205)
})

test('识别数轴：刻度穿过轴线（上下都有）同样成立', () => {
  const s = normalizeStructure(CROSS_TICK_AXIS)
  const axis = detectNumberAxis(s.points, s.segments)
  assert.ok(axis, '穿越轴的刻度也是教材合法画法，必须识别')
  assert.equal(axis.y, 0)
})

test('孤立数值标签被吸附到轴上、统一摆到轴下方', () => {
  const s = normalizeStructure(NUM_AXIS)
  const map = resolveNumberAxisLabels(s)
  assert.deepEqual([...map.keys()].sort(), ['a', 'b', 'c'])
  for (const [, v] of map) {
    assert.equal(v.axisY, 0)
    assert.equal(v.side, 'below', '模型写 y=-9（下方）→ 文字应在轴下方')
  }
})

test('数值标签的圆点落在轴上（不再浮在轴外）', () => {
  const svg = renderGeometrySvg(NUM_AXIS)
  const ay = svgAxisY(svg)
  const dots = svgDots(svg)
  assert.equal(dots.length, 3, 'c/b/a 三个标签点各有一个圆点')
  for (const d of dots) {
    assert.equal(d.cy, ay, `圆点 cy=${d.cy} 应等于轴线 y=${ay}`)
  }
})

test('数值标签文字：距轴等距、居中于该点、一律在轴下方', () => {
  const svg = renderGeometrySvg(NUM_AXIS)
  const ay = svgAxisY(svg)
  const ys = ['c', 'b', 'a'].map(t => {
    const n = textOf(svg, t)
    assert.ok(n, `${t} 标注应上屏`)
    assert.equal(n.anchor, 'middle', `${t} 应居中于点位（不再按质心方向左右推开）`)
    assert.ok(n.y > ay, `${t} 应在轴下方`)
    return n.y
  })
  assert.equal(new Set(ys).size, 1, `同图所有数值标签必须距轴等距，实际 y=${ys.join(',')}`)
})

test('点位与刻度线对齐（文字 x 落在刻度线所在列）', () => {
  const svg = renderGeometrySvg(NUM_AXIS)
  // 刻度线 x 坐标
  const tickXs = [...svg.matchAll(/<line x1="([-\d.]+)" y1="[-\d.]+" x2="\1"/g)].map(m => Number(m[1]))
  for (const t of ['c', 'b', 'a']) {
    const n = textOf(svg, t)
    assert.ok(tickXs.includes(n.x), `${t} 的文字 x=${n.x} 应与某条刻度线对齐，刻度列=${tickXs.join(',')}`)
  }
})

// ── 2. 侧向：数字在下、点名在上 ──

test('轴上的点（大写字母）摆轴上方，刻度数字摆轴下方', () => {
  const st = {
    ...CROSS_TICK_AXIS,
    points: [
      ...CROSS_TICK_AXIS.points,
      { label: 'A', x: 80, y: 0 }, { label: 'B', x: 120, y: 0 }
    ]
  }
  const map = resolveNumberAxisLabels(normalizeStructure(st))
  assert.equal(map.get('A').side, 'above', '在轴上的点 A 按教材惯例摆上方')
  assert.equal(map.get('B').side, 'above')
  assert.equal(map.get('0').side, 'below')
  assert.equal(map.get('P').side, 'above', '模型写 y=9（上方）→ 文字在上方')

  const svg = renderGeometrySvg(st)
  const ay = svgAxisY(svg)
  assert.ok(textOf(svg, 'A').y < ay, 'A 应在轴上方')
  assert.ok(textOf(svg, '0').y > ay, '0 应在轴下方')
})

// ── 3. 误伤防护：这些必须**不**走数轴通道 ──

test('防护：真坐标系（coordinate_system.exists）不判为数轴', () => {
  // 注意 figure_type 必须是 'coordinate'：normalizeStructure 对 'geometry' 会强制
  // 清空 coordinate_system（"纯几何示意图绝不画坐标轴"），数轴题本身也走 geometry。
  const st = {
    ...NUM_AXIS,
    figure_type: 'coordinate',
    coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true }
  }
  const s = normalizeStructure(st)
  assert.equal(s.coordinate_system.exists, true, 'coordinate 类型应保留坐标系信息')
  assert.equal(detectNumberAxis(s.points, s.segments, { coordinateSystem: true }), null)
  assert.equal(resolveNumberAxisLabels(s).size, 0, '坐标轴题的点绝不能被吸附到 x 轴')
})

test('防护：存在竖直长线段（y 轴）不判为数轴', () => {
  const st = {
    ...NUM_AXIS,
    points: [...NUM_AXIS.points, { label: '_y0', x: 5, y: -60 }, { label: '_y1', x: 5, y: 60 }],
    segments: [...NUM_AXIS.segments, { from: '_y0', to: '_y1' }]
  }
  const s = normalizeStructure(st)
  assert.equal(detectNumberAxis(s.points, s.segments), null)
})

test('防护：矩形不做数轴（竖直边由真顶点构成，不是 _ 刻度）', () => {
  const st = {
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 100, y: 0 },
      { label: 'C', x: 100, y: 6 }, { label: 'D', x: 0, y: 6 }
    ],
    segments: [
      { from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' }
    ]
  }
  const s = normalizeStructure(st)
  assert.equal(detectNumberAxis(s.points, s.segments), null)
  assert.equal(resolveNumberAxisLabels(s).size, 0)
})

test('防护：无刻度的水平边（三角形底边）不做数轴', () => {
  const st = {
    figure_type: 'geometry',
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }, { label: 'C', x: 4, y: 7 }],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }]
  }
  const s = normalizeStructure(st)
  assert.equal(detectNumberAxis(s.points, s.segments), null)
})

test('防护：真顶点（被线段引用）永不被吸附，即使它落在轴线附近', () => {
  const st = {
    ...NUM_AXIS,
    points: [...NUM_AXIS.points, { label: 'P', x: 120, y: 9 }],
    segments: [...NUM_AXIS.segments, { from: 'P', to: '_tk3_t' }]
  }
  const map = resolveNumberAxisLabels(normalizeStructure(st))
  assert.equal(map.has('P'), false, 'P 参与了线段构造，是真顶点，不该被当成数值标签')

  const svg = renderGeometrySvg(st)
  const ay = svgAxisY(svg)
  const dots = svgDots(svg)
  assert.equal(dots.length, 4, 'c/b/a 三个标签点 + 真顶点 P')
  const pdot = dots.find(d => Math.abs(d.cy - ay) > 1)
  assert.ok(pdot, 'P 的圆点必须留在它自己的坐标上（轴外），不被吸附')
})

test('防护：三角形三顶点圆点齐全，标注仍走 labelOffset', () => {
  const st = {
    figure_type: 'geometry',
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 8, y: 0 }, { label: 'C', x: 4, y: 7 }],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }]
  }
  assert.equal(resolveNumberAxisLabels(normalizeStructure(st)).size, 0)
  const svg = renderGeometrySvg(st)
  assert.equal(svgDots(svg).length, 3, 'A/B/C 三个顶点圆点都要画')
  assert.equal(svgTexts(svg).length, 3)
})

test('防护：模型占位符标签不进数轴通道', () => {
  const st = {
    ...NUM_AXIS,
    points: [...NUM_AXIS.points, { label: 'P_left', x: 60, y: -9 }, { label: 'X_min', x: 100, y: -9 }]
  }
  const map = resolveNumberAxisLabels(normalizeStructure(st))
  assert.equal(map.has('P_left'), false)
  assert.equal(map.has('X_min'), false)
})

// ── 4. 两个渲染器同判据 ──

test('TikZ 渲染器与 SVG 同判据：数值标签居中贴轴，圆点吸附到轴', () => {
  const tikz = renderGeometryTikZ(NUM_AXIS)
  assert.ok(tikz, 'TikZ 不应返回 null')
  // 三个数值标签都用 below 锚点、落在轴 y=0 上
  const belowNodes = [...tikz.matchAll(/\\node\[below=[^\]]+\] at \(([-\d.]+), ([-\d.]+)\) \{\$([^$]+)\$\}/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }))
  assert.deepEqual(belowNodes.map(n => n.t).sort(), ['a', 'b', 'c'])
  for (const n of belowNodes) assert.equal(n.y, 0, '节点锚在轴线上，由 TikZ 自行下推固定距离')

  // 三个标签圆点吸附到 y=0
  const ticks = [...tikz.matchAll(/\\fill \(([-\d.]+),([-\d.]+)\) circle/g)].map(m => Number(m[2]))
  assert.equal(ticks.length, 3)
  for (const y of ticks) assert.equal(y, 0)
})

test('非数轴题的两个渲染器行为不变（回归保护）', () => {
  const tri = {
    figure_type: 'geometry',
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 8, y: 0 }, { label: 'C', x: 4, y: 7 }],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }]
  }
  const svg = renderGeometrySvg(tri)
  const tikz = renderGeometryTikZ(tri)
  // A 在质心左下方 → 老逻辑给 end + 左偏
  assert.equal(textOf(svg, 'A').anchor, 'end')
  assert.ok(/\\node\[(left|below|right|above)\]/.test(tikz), 'TikZ 仍用方向锚点')
})

// ── 5. 刻度小竖线形态：站在轴上、不穿轴（2026-09-20 五修，推翻四修）──
//
// 老师原话："数轴的刻度都在下面，常规的理解是刻度在直线上，数字在直线下方，对吗？"
//
// 提示词规则 13 只约定过"数值标注写哪一侧"，**从未约定刻度小竖线怎么画**，
// 模型于是自由发挥出三种画法：穿过轴 [-3,3]、只挂上方 [0,4]、只挂下方 [-4,0]。
// 原卷（教材扫描件 5cac1e12 / 1cb0d196 / 2bd35d49）的画法是：
//   **刻度线站在数轴上、朝数字的反侧（数字在下方 ⇒ 朝上）伸出一小截，不穿过数轴**。
// 修复：结构层 `normalizeTickMarks` 把三种画法都归一成原卷画法（长度取较长一侧），
// 两个渲染器自动一致。
//
// ⚠️ 2026-09-20 的教训：这里一度按"以轴为中线、上下等长"实现（只凭老师的一句文字描述），
//    核对原卷后推翻。凡是"原卷怎么画"的问题，**先去原卷量，别靠文字描述推**。

/** 轴 + 两条「只挂轴上方」的刻度（复刻 2bd35d49 的 [0,4] 画法） */
const TICK_ABOVE = {
  figure_type: 'geometry',
  points: [
    { label: '_ax0', x: 5, y: 0 }, { label: '_ax1', x: 205, y: 0 },
    { label: '_arr_t', x: 197, y: 4 }, { label: '_arr_b', x: 197, y: -4 },
    { label: '_k1', x: 20, y: 0 }, { label: '_k1t', x: 20, y: 4 },
    { label: '_k2', x: 80, y: 0 }, { label: '_k2t', x: 80, y: 4 },
    { label: '0', x: 20, y: -9 }, { label: '1', x: 80, y: -9 }
  ],
  segments: [
    { from: '_ax0', to: '_ax1' },
    { from: '_arr_t', to: '_ax1' }, { from: '_arr_b', to: '_ax1' },
    { from: '_k1', to: '_k1t' }, { from: '_k2', to: '_k2t' }
  ]
}

/** 轴 + 两条「只挂轴下方」的刻度（复刻 893190ff 的 [-4,0] 画法） */
const TICK_BELOW = {
  ...TICK_ABOVE,
  points: TICK_ABOVE.points.map(p =>
    p.label === '_k1' ? { ...p, y: -4 } : p.label === '_k1t' ? { ...p, y: 0 }
      : p.label === '_k2' ? { ...p, y: -4 } : p.label === '_k2t' ? { ...p, y: 0 } : p)
}

/** 轴 + 两条「穿轴但上下不等长」的刻度（复刻 1cb0d196 的 [-2,3]） */
const TICK_LOPSIDED = {
  ...TICK_ABOVE,
  points: TICK_ABOVE.points.map(p =>
    p.label === '_k1' ? { ...p, y: -2 } : p.label === '_k1t' ? { ...p, y: 3 }
      : p.label === '_k2' ? { ...p, y: -2 } : p.label === '_k2t' ? { ...p, y: 3 } : p)
}

const tickSpan = (s, lo, hi) => {
  const p = (l) => s.points.find(x => x.label === l)
  return { y0: Math.min(p(lo).y, p(hi).y), y1: Math.max(p(lo).y, p(hi).y), x: p(lo).x }
}

test('刻度只挂轴上方（原卷画法：数字在下方）→ 保持不动', () => {
  const s = normalizeStructure(TICK_ABOVE)
  assert.deepEqual(tickSpan(s, '_k1', '_k1t'), { y0: 0, y1: 4, x: 20 }, '站在轴上、朝上 4，已是原卷画法')
  assert.deepEqual(tickSpan(s, '_k2', '_k2t'), { y0: 0, y1: 4, x: 80 }, '同图每条刻度线一致')
  // 斜的箭头线（x 不相等）不能被动
  assert.equal(s.points.find(p => p.label === '_arr_t').y, 4, '箭头端点是斜线，不是刻度线')
  assert.equal(s.points.find(p => p.label === '_ax1').y, 0)
})

test('刻度只挂轴下方 → 翻到数字的反侧（轴上方），不再"全在下面"', () => {
  const s = normalizeStructure(TICK_BELOW)
  assert.deepEqual(tickSpan(s, '_k1', '_k1t'), { y0: 0, y1: 4, x: 20 }, '改到轴上方')
  assert.deepEqual(tickSpan(s, '_k2', '_k2t'), { y0: 0, y1: 4, x: 80 })
})

test('穿轴但上下不等长 → 取较长一侧、裁掉穿到另一侧的那截（绝不穿轴）', () => {
  const s = normalizeStructure(TICK_LOPSIDED)
  assert.deepEqual(tickSpan(s, '_k1', '_k1t'), { y0: 0, y1: 3, x: 20 }, '保轴上方 3、去掉轴下方 2')
})

test('幂等：再跑一次结果完全一致（含需要翻转的那张）', () => {
  for (const src of [TICK_ABOVE, TICK_BELOW, TICK_LOPSIDED]) {
    const once = normalizeStructure(src)
    const twice = normalizeStructure(once)
    assert.deepEqual(twice.points, once.points, '再跑一次结果必须完全一致')
    assert.deepEqual(twice.segments, once.segments)
  }
})

test('防护：虚线刻度（对称轴/辅助线）不参与改形', () => {
  const st = {
    ...TICK_BELOW,
    segments: TICK_BELOW.segments.map(g =>
      g.from === '_k1' || g.from === '_k2' ? { ...g, style: 'dashed' } : g)
  }
  const s = normalizeStructure(st)
  assert.deepEqual(tickSpan(s, '_k1', '_k1t'), { y0: -4, y1: 0, x: 20 }, '虚线保持原样')
})

test('防护：过长的短竖线不是刻度线（护栏按轴长 10% 封顶）', () => {
  const st = {
    ...TICK_ABOVE,
    points: TICK_ABOVE.points.map(p => (p.label === '_k1t' ? { ...p, y: 30 } : p))
  }
  const s = normalizeStructure(st)
  assert.deepEqual(tickSpan(s, '_k1', '_k1t'), { y0: 0, y1: 30, x: 20 }, '超长竖线不动')
})

test('防护：直角坐标系（存在 y 轴长线段）不受刻度对称化影响', () => {
  const coord = {
    figure_type: 'geometry',
    points: [
      { label: '_ox', x: 0, y: 0 }, { label: '_xx', x: 100, y: 0 },
      { label: '_oy', x: 0, y: 0 }, { label: '_yy', x: 0, y: 80 },
      { label: '_c1', x: 30, y: 0 }, { label: '_c1b', x: 30, y: -4 },
      { label: '_c2', x: 60, y: 0 }, { label: '_c2b', x: 60, y: -4 },
      { label: 'O', x: 0, y: 0 }
    ],
    segments: [
      { from: '_ox', to: '_xx' }, { from: '_oy', to: '_yy' },
      { from: '_c1', to: '_c1b' }, { from: '_c2', to: '_c2b' }
    ]
  }
  const s = normalizeStructure(coord)
  assert.deepEqual(tickSpan(s, '_c1', '_c1b'), { y0: -4, y1: 0, x: 30 }, '坐标系刻度本就画在轴一侧，不动')
})

test('防护：几何图形（矩形竖直边由真顶点构成）不被当成刻度线', () => {
  const rect = {
    figure_type: 'geometry',
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 },
      { label: 'C', x: 10, y: 6 }, { label: 'D', x: 0, y: 6 }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' }]
  }
  const before = rect.points.map(p => [p.x, p.y])
  const s = normalizeStructure(rect)
  assert.deepEqual(s.points.map(p => [p.x, p.y]), before, '矩形四顶点坐标逐字节不变')
})

test('端到端：SVG 里刻度线站在轴上、不穿过轴（原本"全在下面"的那张）', () => {
  const svg = renderGeometrySvg(TICK_BELOW)
  const all = [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)]
    .map(m => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) }))
  const main = all.filter(l => Math.abs(l.y1 - l.y2) < 0.5)
    .sort((a, b) => Math.abs(b.x2 - b.x1) - Math.abs(a.x2 - a.x1))[0]
  assert.ok(main, '要找到主轴线')
  const verts = all.filter(l => Math.abs(l.x1 - l.x2) < 0.5)
  assert.equal(verts.length, 2, '两条刻度线（箭头是斜线，不算）')
  for (const v of verts) {
    const top = Math.min(v.y1, v.y2)
    const bottom = Math.max(v.y1, v.y2)
    // SVG 的 y 向下为正：拓扑上"轴上方"= y 更小
    assert.ok(Math.abs(bottom - main.y1) < 0.06, `刻度线下端要压在轴线上（bottom=${bottom} 轴=${main.y1}）`)
    assert.ok(main.y1 - top > 1, '轴上方必须有可见的一段')
    assert.ok(bottom <= main.y1 + 0.06, '刻度线不得穿到轴下方')
  }
})

test('端到端：TikZ 与 SVG 同判据（刻度线自轴向上伸出）', () => {
  const tikz = renderGeometryTikZ(TICK_BELOW)
  const verts = [...tikz.matchAll(/\\draw (?:\[[^\]]*\])?\((-?[\d.]+),(-?[\d.]+)\) -- \((-?[\d.]+),(-?[\d.]+)\);/g)]
    .map(m => ({ x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) }))
    .filter(l => Math.abs(l.x1 - l.x2) < 1e-9)
  assert.equal(verts.length, 2)
  for (const v of verts) {
    assert.equal(Math.min(v.y1, v.y2), 0, '下端落在轴上')
    assert.equal(Math.max(v.y1, v.y2), 4, '上端伸出 4')
  }
})
