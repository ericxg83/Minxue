import test from 'node:test'
import assert from 'node:assert/strict'
import { placeLabel, outwardPref, vertexPref } from '../server/utils/geom/labelPlace.js'
import {
  resolveNumberAxisLabels,
  resolveCoordAxisLabels,
  detectCoordAxes,
  normalizeStructure,
  detectNumberAxis
} from '../server/utils/geom/structure.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'
import { executeDsl } from '../server/utils/geom/dsl/executor.js'
import { detectNonGeometryFigure } from '../server/utils/geometryContentGate.js'

/**
 * 2026-09-19 老师第二轮反馈（四个问题，本文件逐条锁死）：
 *   1. "字母不要压到线上"——△ABC 里 N 是 AB 上的点，字母 N 被按在 AB 线上。
 *      根因：旧 `labelOffset` 只让字母"远离所有点质心"，**完全不看线段**。
 *   2. "字母偏移了很多，而且字母的位置应该和数字同一水平"——数轴上正方形边 AB 落在轴上，
 *      A/B 是**真顶点**（被线段引用），被 resolveNumberAxisLabels 跳过 ⇒ 走通用算法，
 *      距轴 10.8px/6.7px 参差；而刻度数字 -1/0 是孤立点、距轴统一 20px。
 *   3. "图里面需要有中文汉字 / 里面是数字"（数值转换器、输入输出表格）——
 *      这类图不适用几何重绘，加内容闸门保留原图。
 *   4. "原图中对称轴用的是虚线，而且所标的数字被压到了"——
 *      命令集此前没有虚线命令（模型只能画实线）；数字 1 压在对称轴线上。
 */

// ─────────────────────────────────────────────────────────────
// 1. 避让打分器：字母不压线
// ─────────────────────────────────────────────────────────────

test('placeLabel：端点在某条线段上时，选出的位置必须离开该线段', () => {
  // N 落在 A→B 这条斜线上（与真题同形：N 是 MN∥AC 与 AB 的交点）
  const node = { x: 87, y: 148 }
  const segs = [{ a: { x: 100, y: 180 }, b: { x: 35, y: 20 } }]
  const pos = placeLabel({
    node,
    points: [node, { x: 100, y: 180 }, { x: 35, y: 20 }],
    segments: segs,
    prefer: outwardPref(node, [{ x: 100, y: 180 }, { x: 35, y: 20 }, node]),
    dist: 16,
    box: { w: 10, h: 16 },
  })
  // 文字中心到该线段的最短距离必须大于文字框半宽（横向 5px）
  const c = { x: node.x + pos.dx, y: node.y + pos.dy }
  const a = segs[0].a
  const b = segs[0].b
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy)))
  const d = Math.hypot(c.x - (a.x + t * dx), c.y - (a.y + t * dy))
  assert.ok(d > 5, `文字中心距线段 ${d.toFixed(1)}px，压在线上`)
})

test('placeLabel：远离线段的候选优先于"贴近质心外侧"', () => {
  // 一条竖线穿过点附近，偏好方向恰好指向该竖线 —— 打分器应改选另一侧
  const node = { x: 0, y: 0 }
  const segs = [{ a: { x: 18, y: -40 }, b: { x: 18, y: 40 } }] // 右侧 18px 处一条竖线
  const pos = placeLabel({
    node, points: [node], segments: segs, prefer: { x: 1, y: 0 }, dist: 16, box: { w: 10, h: 16 },
  })
  assert.notEqual(pos.dir, 'right', `仍选了朝线的方向 ${pos.dir}`)
})

test('placeLabel：与已放置文字重叠的候选会被淘汰', () => {
  const node = { x: 0, y: 0 }
  // 右侧已被占满，且偏好方向也是右侧
  const placed = [{ x: 16, y: 0, w: 10, h: 16 }]
  const pos = placeLabel({ node, points: [node], segments: [], placed, prefer: { x: 1, y: 0 }, dist: 16, box: { w: 10, h: 16 } })
  assert.notEqual(pos.dir, 'right', '重叠的右侧候选不该被选中')
})

// ─────────────────────────────────────────────────────────────
// 2. 数轴上的真顶点：文字与刻度数字同一水平
// ─────────────────────────────────────────────────────────────

/** 3e47df1c 的形状：正方形 ABCD 的边 AB 落在数轴上，另有两个刻度数字 */
const SQUARE_ON_AXIS = {
  figure_type: 'geometry',
  points: [
    { label: '_ax0', x: 0, y: 0 },
    { label: '_ax1', x: 200, y: 0 },
    { label: '_t1_t', x: 35, y: 3 }, { label: '_t1_b', x: 35, y: 0 },
    { label: '_t2_t', x: 70, y: 3 }, { label: '_t2_b', x: 70, y: 0 },
    { label: 'B', x: 105, y: 0 }, { label: 'A', x: 155, y: 0 },
    { label: 'C', x: 105, y: 50 }, { label: 'D', x: 155, y: 50 },
    { label: '-1', x: 35, y: -9 }, { label: '0', x: 70, y: -9 },
  ],
  segments: [
    { from: '_ax0', to: '_ax1' },
    { from: '_t1_t', to: '_t1_b' },
    { from: '_t2_t', to: '_t2_b' },
    { from: 'B', to: 'C' }, { from: 'C', to: 'D' }, { from: 'D', to: 'A' }, { from: 'A', to: 'B' },
  ],
}

test('落在轴上的真顶点也纳入统一摆位（snap=false，圆点不吸附）', () => {
  const s = normalizeStructure(SQUARE_ON_AXIS)
  const map = resolveNumberAxisLabels(s)
  assert.ok(map.has('B'), 'B 是轴上的真顶点，应纳入统一摆位')
  assert.ok(map.has('A'), 'A 同上')
  assert.equal(map.get('B').snap, false, '真顶点不该吸附（它本来就在轴上）')
  assert.equal(map.get('B').side, map.get('-1').side, '应与刻度数字同侧')
  assert.equal(map.get('-1').snap, true, '刻度数字仍按"排版意图"吸附')
  // 轴外的真顶点（C/D）不得被纳入
  assert.ok(!map.has('C') && !map.has('D'), '轴外的真顶点不能纳入')
})

test('渲染结果：轴上的字母与刻度数字 y 完全相同（同一水平）', () => {
  const svg = renderGeometrySvg(SQUARE_ON_AXIS)
  const textY = {}
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const y = (m[1].match(/(?:^|\s)y="([^"]*)"/) || [])[1]
    textY[m[2]] = Number(y)
  }
  const ys = ['B', 'A', '-1', '0'].map(k => textY[k])
  assert.ok(ys.every(Number.isFinite), `缺标签: ${JSON.stringify(textY)}`)
  assert.equal(new Set(ys).size, 1, `字母与数字不在同一水平: ${JSON.stringify(textY)}`)
})

test('渲染结果：TikZ 侧同样把轴上的字母与数字摆在同一水平', () => {
  const tikz = renderGeometryTikZ(SQUARE_ON_AXIS)
  const lineOf = (label) => tikz.split('\n').find(l => l.includes(`{$${label}$}`))
  for (const k of ['B', 'A', '-1', '0']) assert.ok(lineOf(k), `TikZ 缺 ${k}`)
  // 四个标签的 y 坐标应一致（below=<gap> 让 TikZ 自己下推，故比较 at (x, y) 的 y）
  const yOf = (label) => Number((lineOf(label).match(/at \(([-\d.]+), ([-\d.]+)\)/) || [])[2])
  const ys = ['B', 'A', '-1', '0'].map(yOf)
  assert.equal(new Set(ys).size, 1, `TikZ 字母与数字不在同一水平: ${JSON.stringify(ys)}`)
})

test('数轴判据不受影响：非数轴图仍返回空 Map', () => {
  const tri = normalizeStructure({
    figure_type: 'geometry',
    points: [{ label: 'A', x: 50, y: 80 }, { label: 'B', x: 0, y: 0 }, { label: 'C', x: 100, y: 0 }],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }],
  })
  assert.equal(detectNumberAxis(tri.points, tri.segments), null)
  assert.equal(resolveNumberAxisLabels(tri).size, 0)
})

// ─────────────────────────────────────────────────────────────
// 3. 流程图/数值转换器：内容闸门
// ─────────────────────────────────────────────────────────────

test('内容闸门：数值转换器（框内是中文）判定为不重绘', () => {
  const r = detectNonGeometryFigure('有一个数值转换器，原理如图：当输入x的值为64时，输出y的值是______.')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'flowchart')
})

test('内容闸门：输入→运算→输出表格题判定为不重绘', () => {
  const r = detectNonGeometryFigure('输入：______, \\frac{9}{35}, \\frac{22}{35}；运算：+ \\frac{1}{7}；输出：\\frac{1}{3}, \\frac{2}{5}')
  assert.equal(r.skip, true)
  assert.equal(r.kind, 'io_table')
})

test('内容闸门不误伤普通几何题', () => {
  const cases = [
    '如图，已知在△ABC中，AB=AC,AD⊥BC，垂足为D，点M在AD上',
    '如图，抛物线的对称轴为直线x=1，与x轴交于点A(-1,0)，则另一交点的坐标是',
    '在如图所示的数轴上，下列四个点中最可能表示实数√7的是',
  ]
  for (const c of cases) assert.equal(detectNonGeometryFigure(c).skip, false, `误伤: ${c}`)
})

// ─────────────────────────────────────────────────────────────
// 4. 虚线：对称轴等辅助线必须是虚线
// ─────────────────────────────────────────────────────────────

test('dashed_segment 命令产出 style=dashed，且 executor 不把它改回 solid', () => {
  const src = ['point : 0 0 -> A', 'point : 0 5 -> B', 'dashed_segment : A B -> ds1'].join('\n')
  const res = executeDsl(src)
  assert.ok(res.ok, `DSL 执行失败: ${res.error}`)
  const seg = res.structure.segments.find(s => (s.from === 'A' && s.to === 'B'))
  assert.ok(seg, '未产出线段')
  assert.equal(seg.style, 'dashed', 'style 被覆盖成了 solid')
})

test('渲染：虚线段输出 stroke-dasharray（SVG）', () => {
  const svg = renderGeometrySvg({
    figure_type: 'geometry',
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 0, y: 5 }],
    segments: [{ from: 'A', to: 'B', style: 'dashed' }],
  })
  assert.match(svg, /stroke-dasharray="6,4"/)
})

test('渲染：虚线段输出虚线样式（TikZ）', () => {
  const tikz = renderGeometryTikZ({
    figure_type: 'geometry',
    points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 0, y: 5 }],
    segments: [{ from: 'A', to: 'B', style: 'dashed' }],
  })
  assert.match(tikz, /dashed/)
})

test('提示词包含虚线规则与命令名（防"提示词字段↔解析字段↔消费方"三处脱节）', async () => {
  const { commandReference } = await import('../server/utils/geom/dsl/commands.js')
  const ref = commandReference()
  assert.match(ref, /dashed_segment/, '命令表未暴露 dashed_segment')
})

// ─────────────────────────────────────────────────────────────
// 5. 第三轮反馈（2026-09-19 二修）：
//    · "A 点应该是在 x 轴上、0 代表原点应是 x 轴和 y 轴交点，但目前全部偏移"
//    · "C 和 D 应该是正方形的 4 个顶点，目前也有所偏移"
//    两个根因：① 压线判据把"贴着自己顶点（=线段端点）"也算压线 ⇒ 字母被顶到 24px 外；
//              ② 偏好方向用"远离所有点质心"，在共线/对称图形上退化 ⇒ 左上角 C 朝正上、
//                 右上角 D 朝右上，两个本该镜像的角摆得不一样。
// ─────────────────────────────────────────────────────────────

// ⚠️ 下面的坐标一律遵守 labelPlace 的约定：**y 向上为正**（SVG 调用方会把 y 取负后再传进来）。
test('placeLabel：贴着自己顶点（线段端点）摆放不该被罚，字母应更贴近顶点', () => {
  // 正方形顶角 C（y 向上）：两条边从 C 出发（向右的 CD、向下的 CB）。
  const node = { x: 208, y: -102 }
  const segs = [
    { a: { x: 208, y: -102 }, b: { x: 290, y: -102 } }, // 上边 CD
    { a: { x: 208, y: -102 }, b: { x: 208, y: -184 } } // 左边 CB
  ]
  const pos = placeLabel({
    node, points: [node], segments: segs,
    prefer: { x: -0.7071, y: 0.7071 }, dist: 16, box: { w: 11, h: 16 }
  })
  const r = Math.hypot(pos.dx, pos.dy)
  assert.ok(r <= 17, `字母被推远了：${pos.dir} r=${r}`)
  // 仍不许横跨边本体：位置不能落在 CD 上（y 与边齐平且横向偏出去）
  assert.ok(!(Math.abs(pos.dy) < 6 && Math.abs(pos.dx) > 10), '字母压到了边 CD 上')
})

test('placeLabel：横跨线段本体仍然重罚（第一轮"字母压线"不许回退）', () => {
  const node = { x: 87, y: 148 }
  const segs = [{ a: { x: 100, y: 180 }, b: { x: 35, y: 20 } }]
  const pos = placeLabel({
    node, points: [node], segments: segs,
    prefer: { x: 1, y: 0 }, dist: 16, box: { w: 11, h: 16 }
  })
  assert.ok(pos.score < 200, `贴线位置没被罚下去：score=${pos.score} dir=${pos.dir}`)
})

test('vertexPref：直角的两个顶角都取正上方（左右严格镜像，不许 1 ULP 分叉）', () => {
  // y 向上为正：上边 y=-102（更大），下边 y=-184
  const segs = [
    { a: { x: 208, y: -102 }, b: { x: 290, y: -102 } },
    { a: { x: 290, y: -102 }, b: { x: 290, y: -184 } },
    { a: { x: 290, y: -184 }, b: { x: 208, y: -184 } },
    { a: { x: 208, y: -184 }, b: { x: 208, y: -102 } }
  ]
  const c = vertexPref({ x: 208, y: -102 }, segs, { x: 0, y: 1 })
  const d = vertexPref({ x: 290, y: -102 }, segs, { x: 0, y: 1 })
  // 2026-09-19 三修：直角扇区的 45° 平分线一律量化到正上/正下——
  // 原卷上正方形顶角 C 的字母是**正上方**（竖边正对字母底部），斜插看起来就是"飘出去"。
  assert.deepEqual(c, { x: 0, y: 1 }, `C 应朝正上，实际 (${c.x},${c.y})`)
  assert.deepEqual(d, { x: 0, y: 1 }, `D 应朝正上，实际 (${d.x},${d.y})`)

  // 底角同理朝正下（矩形底边两角、数轴上的 B/A 都是这个摆法）
  const bl = vertexPref({ x: 208, y: -184 }, segs, { x: 0, y: -1 })
  assert.deepEqual(bl, { x: 0, y: -1 }, `底角应朝正下，实际 (${bl.x},${bl.y})`)
})

test('vertexPref：胜出扇区是直角就量化（该点汇了 3 条边时同样成立）', () => {
  // 实测样本 3b05e732：B 处汇了 AB（向左）、BC（斜上）、BE（向上）三条边，
  // 空档最大的是"向右下"那个 270° 扇区，其两条边界边 AB⊥BE ⇒ 仍应走竖直。
  const segs = [
    { a: { x: 30, y: 20 }, b: { x: 75, y: 20 } }, // AB
    { a: { x: 75, y: 20 }, b: { x: 40, y: 65 } }, // BC
    { a: { x: 75, y: 20 }, b: { x: 75, y: 65 } } // BE
  ]
  const b = vertexPref({ x: 75, y: -20 }, segs, { x: 0, y: -1 })
  assert.deepEqual(b, { x: 0, y: -1 }, `B 应朝正下，实际 (${b.x.toFixed(3)},${b.y.toFixed(3)})`)
})

test('vertexPref：非直角扇区仍走外角平分线（三角形底角不许被拉成竖直）', () => {
  // 底角约 63° 的等腰三角形：底边水平，外侧扇区约 297°，平分线斜向外下——不该量化。
  // （注意坐标系：segments 与 node 必须同一套；这里用数学坐标 y 向上）
  const segs = [
    { a: { x: 100, y: 200 }, b: { x: 20, y: 40 } },
    { a: { x: 100, y: 200 }, b: { x: 180, y: 40 } },
    { a: { x: 20, y: 40 }, b: { x: 180, y: 40 } }
  ]
  const left = vertexPref({ x: 20, y: 40 }, segs, { x: 0, y: -1 })
  assert.ok(Math.abs(left.x) > 0.2, `底角应斜向外侧，实际 (${left.x.toFixed(3)},${left.y.toFixed(3)})`)
  assert.ok(left.y < 0, '底角应朝下侧')
})

test('vertexPref：三角形顶点朝正上方；共线点服从兜底方向', () => {
  const tri = [
    { a: { x: 100, y: 200 }, b: { x: 20, y: 40 } },
    { a: { x: 100, y: 200 }, b: { x: 180, y: 40 } },
    { a: { x: 20, y: 40 }, b: { x: 180, y: 40 } }
  ]
  const apex = vertexPref({ x: 100, y: 200 }, tri, { x: 0, y: 1 })
  assert.ok(apex.y > 0.99, `顶点应朝正上，实际 (${apex.x.toFixed(2)},${apex.y.toFixed(2)})`)
  // 点落在线段内部 → 两侧角度并列(180°/180°) → 用兜底方向决胜
  const mid = vertexPref({ x: 100, y: 40 }, [{ a: { x: 20, y: 40 }, b: { x: 180, y: 40 } }], { x: 0, y: -1 })
  assert.ok(mid.y < 0, `共线点应服从兜底方向（向下），实际 (${mid.x.toFixed(2)},${mid.y.toFixed(2)})`)
})

test('detectCoordAxes：两轴内部相交才算坐标系，数轴 + 立在轴上的竖边不算', () => {
  const axes = {
    points: [
      { label: '_x0', x: -2, y: 0 }, { label: '_x1', x: 4.2, y: 0 },
      { label: '_y0', x: 0, y: -1 }, { label: '_y1', x: 0, y: 4.2 },
      { label: 'O', x: 0, y: 0 }, { label: 'A', x: -1, y: 0 }
    ],
    segments: [{ from: '_x0', to: '_x1' }, { from: '_y0', to: '_y1' }],
    labels: [{ text: 'x', x: 4.2, y: -0.4 }, { text: 'y', x: -0.35, y: 4 }]
  }
  const cs = detectCoordAxes(axes.points, axes.segments, axes.labels)
  assert.ok(cs, '应识别为直角坐标系')
  assert.equal(cs.origin.x, 0)
  assert.equal(cs.origin.y, 0)

  // 数轴 + 立在轴上的正方形：竖边下端落在轴上（端点相交）⇒ 不是坐标系
  const numberAxis = {
    points: [
      { label: '_ax0', x: 0, y: 0 }, { label: '_ax1', x: 200, y: 0 },
      { label: 'B', x: 105, y: 0 }, { label: 'C', x: 105, y: 50 }
    ],
    segments: [{ from: '_ax0', to: '_ax1' }, { from: 'B', to: 'C' }],
    labels: []
  }
  assert.equal(detectCoordAxes(numberAxis.points, numberAxis.segments, numberAxis.labels), null)
})

test('resolveCoordAxisLabels：落轴点写在轴上方、刻度数字写在轴下方、原点认出来', () => {
  const s = normalizeStructure({
    figure_type: 'geometry',
    points: [
      { label: '_x0', x: -2, y: 0 }, { label: '_x1', x: 4.2, y: 0 },
      { label: '_y0', x: 0, y: -1 }, { label: '_y1', x: 0, y: 4.2 },
      { label: 'O', x: 0, y: 0 }, { label: 'A', x: -1, y: 0 }, { label: '1', x: 1, y: -0.4 }
    ],
    segments: [{ from: '_x0', to: '_x1' }, { from: '_y0', to: '_y1' }],
    labels: [{ text: 'x', x: 4.2, y: -0.4 }, { text: 'y', x: -0.35, y: 4 }]
  })
  const m = resolveCoordAxisLabels(s)
  assert.equal(m.get('A').side, 'above', 'A 是函数图象与 x 轴的交点，字母写在轴上方')
  assert.equal(m.get('1').side, 'below', '刻度数字写在轴下方')
  assert.equal(m.get('O').origin, true, '原点标注要认出来')
  // 原点文字锚在**两轴交点**上（atX/atY），渲染器据此摆放，不复用模型写的坐标
  assert.equal(m.get('O').atX, 0, '原点文字要锚在交点 x 上')
  assert.equal(m.get('O').atY, 0, '原点文字要锚在交点 y 上')
})

test('resolveCoordAxisLabels：y 轴自己的刻度数字不能被当成 x 轴刻度', () => {
  // 真实踩坑样本 1696dca2：y 轴刻度 1 写在 (-0.35, 1)，到 x 轴的垂距 1 个单位，
  // 只按"到 x 轴距离 ≤ 轴长 15%"判会把它当 x 轴刻度、推到 x 轴下方 20px。
  const s = normalizeStructure({
    figure_type: 'geometry',
    points: [
      { label: '_xmin', x: -4.5, y: 0 }, { label: '_xmax', x: 4, y: 0 },
      { label: '_ymin', x: 0, y: -3 }, { label: '_ymax', x: 0, y: 3.8 },
      { label: '_t1_l', x: -0.12, y: 1 }, { label: '_t1_r', x: 0.12, y: 1 },
      { label: '1', x: -0.35, y: 1 },
      { label: '-3', x: -3, y: -0.45 },
      { label: 'O', x: -0.4, y: -0.45 }
    ],
    segments: [
      { from: '_xmin', to: '_xmax' }, { from: '_ymin', to: '_ymax' }, { from: '_t1_l', to: '_t1_r' }
    ],
    labels: [{ text: 'x', x: 3.75, y: -0.5 }]
  })
  const m = resolveCoordAxisLabels(s)
  assert.equal(m.has('1'), false, 'y 轴刻度 1 被误当成 x 轴刻度')
  assert.equal(m.get('-3').side, 'below', 'x 轴刻度 -3 应在轴下方')
  assert.equal(m.get('O').origin, true, '写在交点左下方的 O 仍应认作原点')
})

test('resolveCoordAxisLabels：写在文字通道里的 O 也要锚到两轴交点（样本 7aee54e1）', () => {
  // 2026-09-19 老师三次反馈："这个 0 点标的太下面了。这个 0 应该是 x 轴和 y 轴的交点。"
  // 模型把 O 写成 labels[] 的自由标注（坐标 (0.3,-0.35)）——这条通道既不画圆点、也不参与
  // 任何吸附，文字就停在模型给的位置上：渲染出来偏交点 (22px, 26px)。
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: '_xmin', x: -2.6, y: 0 }, { label: '_xmax', x: 1.8, y: 0 },
      { label: '_ymin', x: 0, y: -2.6 }, { label: '_ymax', x: 0, y: 0.5 }
    ],
    segments: [{ from: '_xmin', to: '_xmax' }, { from: '_ymin', to: '_ymax' }],
    labels: [{ text: 'O', x: 0.3, y: -0.35 }, { text: 'x', x: 1.7, y: -0.3 }]
  }
  const s = normalizeStructure(structure)
  const o = resolveCoordAxisLabels(s).get('O')
  assert.ok(o, '文字通道里的 O 要认作原点')
  assert.equal(o.origin, true)
  assert.equal(o.fromLabel, true, '来源是文字通道，不是 point')
  assert.equal(o.atX, 0)
  assert.equal(o.atY, 0)

  const svg = renderGeometrySvg(structure)
  const lines = [...svg.matchAll(/<line x1="([-0-9.]+)" y1="([-0-9.]+)" x2="([-0-9.]+)" y2="([-0-9.]+)"/g)]
    .map(z => z.slice(1).map(Number))
  const xAxis = lines.find(l => l[1] === l[3]) // 水平轴线（y1 === y2）
  const yAxis = lines.find(l => l[0] === l[2]) // 竖直轴线
  assert.ok(xAxis && yAxis, '两条轴线都要在 SVG 里')
  const tm = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].find(z => z[2] === 'O')
  assert.ok(tm, 'SVG 里要有 O')
  const oPx = { x: +/x="([-0-9.]+)"/.exec(tm[1])[1], y: +/y="([-0-9.]+)"/.exec(tm[1])[1] }

  // ① 锚在「交点 + (9, 17)」上，与 point 通道的原点摆位逐字一致
  assert.ok(Math.abs(oPx.x - (yAxis[0] + 9)) < 0.02, `O 的 x 应为交点右 9px，实际 ${oPx.x}`)
  assert.ok(Math.abs(oPx.y - (xAxis[1] + 17)) < 0.02, `O 的 y 应为交点下 17px，实际 ${oPx.y}`)

  // ② 不能沿用模型写的坐标：按 (0.3,-0.35) 换算，横向会偏 22px、纵向会偏 26px
  const scale = (xAxis[2] - xAxis[0]) / 4.4 // x 轴数据跨度 -2.6 → 1.8
  const modelX = xAxis[0] + (0.3 - -2.6) * scale
  const modelY = xAxis[1] + 0.35 * scale
  assert.ok(Math.abs(oPx.x - (modelX + 9)) > 15, 'O 仍在沿用模型写的 x')
  assert.ok(oPx.y < modelY - 5, 'O 仍在沿用模型写的 y（会偏到交点下方 26px）')

  const tikz = renderGeometryTikZ(structure)
  assert.match(tikz, /\\node\[below=[^\]]*, xshift=[^\]]*\] at \(0, 0\) \{\$O\$\}/, 'TikZ 里 O 也锚在交点')
  assert.doesNotMatch(tikz, /\\node at \(0\.3,-0\.35\)/, 'TikZ 不该再按模型坐标摆 O')
})

test('resolveCoordAxisLabels：point 通道的 O 写偏同样拉回交点；真顶点的圆点不挪', () => {
  const structure = {
    figure_type: 'geometry',
    points: [
      { label: '_xmin', x: -2, y: 0 }, { label: '_xmax', x: 4.2, y: 0 },
      { label: '_ymin', x: 0, y: -1 }, { label: '_ymax', x: 0, y: 4.2 },
      // 标签点：模型为"把文字放在交点左下方"而写的坐标，不是真有个点在这里
      { label: 'O', x: -0.3, y: -0.35 }
    ],
    segments: [{ from: '_xmin', to: '_xmax' }, { from: '_ymin', to: '_ymax' }],
    labels: []
  }
  const o = resolveCoordAxisLabels(normalizeStructure(structure)).get('O')
  assert.equal(o.atX, 0)
  assert.equal(o.atY, 0)
  assert.equal(o.snap, true, '标签点的圆点是虚构的 ⇒ 吸附到交点')

  // 真顶点（被线段引用）只对齐文字，圆点必须留在原位
  const vertex = normalizeStructure({
    figure_type: 'geometry',
    points: [
      { label: '_xmin', x: -2, y: 0 }, { label: '_xmax', x: 4.2, y: 0 },
      { label: '_ymin', x: 0, y: -1 }, { label: '_ymax', x: 0, y: 4.2 },
      { label: 'O', x: 0.02, y: -0.02 }, { label: 'A', x: 2, y: 2 }
    ],
    segments: [
      { from: '_xmin', to: '_xmax' }, { from: '_ymin', to: '_ymax' }, { from: 'O', to: 'A' }
    ],
    labels: []
  })
  const ov = resolveCoordAxisLabels(vertex).get('O')
  assert.equal(ov.origin, true, '落在交点附近的 O 仍是原点')
  assert.equal(ov.snap, false, '真顶点的圆点不能被挪')
})

test('端到端：坐标系图里 A 在轴上方、O 在交点右下、1 在轴下方（SVG 与 TikZ 同判据）', () => {  const structure = {
    figure_type: 'geometry',
    points: [
      { label: '_xmin', x: -2, y: 0 }, { label: '_xmax', x: 4.2, y: 0 },
      { label: '_ymin', x: 0, y: -1 }, { label: '_ymax', x: 0, y: 4.2 },
      { label: 'O', x: 0, y: 0 }, { label: 'A', x: -1, y: 0 }, { label: '1', x: 1, y: -0.4 }
    ],
    segments: [{ from: '_xmin', to: '_xmax' }, { from: '_ymin', to: '_ymax' }],
    labels: [{ text: 'x', x: 4.2, y: -0.4 }, { text: 'y', x: -0.35, y: 4 }]
  }
  const svg = renderGeometrySvg(structure)
  const at = (label) => {
    const m = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].find(z => z[2] === label)
    assert.ok(m, `未找到标注 ${label}`)
    return { x: +/x="([-0-9.]+)"/.exec(m[1])[1], y: +/y="([-0-9.]+)"/.exec(m[1])[1] }
  }
  const axisY = at('A').y + 10 // A 距轴 10px（above），据此反推轴线位置
  assert.ok(at('A').y < axisY - 4, `A 应在轴上方，实际 y=${at('A').y}`)
  assert.ok(at('1').y > axisY + 10, `刻度 1 应在轴下方，实际 y=${at('1').y}`)
  assert.ok(at('O').y > axisY + 5, `原点 O 应在轴下方，实际 y=${at('O').y}`)
  // O 还要右移，避开 y 轴往轴下方伸出的那一小截
  assert.ok(at('O').x > at('A').x, 'O 应在交点右侧')

  const tikz = renderGeometryTikZ(structure)
  assert.match(tikz, /\\node\[above=[^\]]*\] at \(-1, 0\) \{\$A\$\}/, 'TikZ 里 A 也应在轴上方')
  assert.match(tikz, /\\node\[below=[^\]]*\] at \(0, 0\) \{\$O\$\}/, 'TikZ 里 O 也应在轴下方')
})
