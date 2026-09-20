/**
 * 折线兜底 + 内容闸门辅助点豁免 的回归测试（2026-09-19 三修）。
 *
 * 起因（老师第四轮反馈）：
 *   ① `1dac908f` 的抛物线**不是平滑曲线**，底部有折角 —— 模型没用 `curve` 命令，
 *      而是目测了 23 个 `_c0…_c22` 点再用 22 条 `segment` 直连；
 *   ② "C/D 的位置依旧很奇怪" —— 直角顶点被外角平分线摆成 45° 斜插；
 *   ③ 顺带挖出**潜伏炸弹**：内容闸门把 `_` 前缀的辅助点/辅助线段当成"题干没引用"
 *      全量报错，而提示词恰恰要求用 `_` 点画刻度线/曲线 ⇒ 生产端每一张图都会
 *      content_mismatch 被永久拒稿（`geometry_structure_json` 至今 0 条，从未端到端跑到）。
 *
 * 三处的判据各自锁在这里，防止回退。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeSampledCurveChains, normalizeStructure } from '../server/utils/geom/structure.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'
import { validateStructureAgainstContent } from '../server/utils/geometryContentGate.js'

/** 造一条「辅助点密采样 + segment 直连」的抛物线链（复刻 1dac908f 的模型输出形态） */
function parabolaChain(n = 23, jitter = 0) {
  const points = []
  for (let i = 0; i < n; i++) {
    const x = -2 + (4 * i) / (n - 1)
    const noise = jitter && i > 1 && i < n - 2 ? (i % 2 ? jitter : -jitter) : 0
    points.push({ label: `_c${i}`, x, y: x * x + noise })
  }
  const segments = points.slice(1).map((p, i) => ({ from: points[i].label, to: p.label }))
  return { points, segments }
}

const build = (o) => normalizeStructure({ figure_type: 'geometry', ...o })

test('折线兜底：辅助点密采样链被识别成曲线，线段被摘除', () => {
  const s = build(parabolaChain(23))
  assert.equal(s.curves.length, 1, '应识别出 1 条曲线')
  assert.equal(s.curves[0].points.length, 23, '曲线点数应与原链一致')
  assert.equal(s.segments.length, 0, '原折线线段应被摘除')
})

test('折线兜底：保曲率去噪——抖动能量下降，整体形状与顶点不被削平', () => {
  // 直接用真实样本 1dac908f 的模型采样点（目测出来的，肩部有两处 ±5 抖动）：
  // 这是唯一一个"模型没用 curve 命令"的实测样本，作为兜底路径的基准最忠实。
  const xs = [67, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 173]
  const ys = [166, 150, 125, 100, 78, 59, 44, 40, 29, 24, 21, 20, 21, 24, 29, 40, 44, 59, 78, 100, 125, 150, 166]
  const points = xs.map((x, i) => ({ label: `_c${i}`, x, y: ys[i] }))
  const segments = points.slice(1).map((p, i) => ({ from: points[i].label, to: p.label }))
  const s = build({ points, segments })
  assert.equal(s.curves.length, 1, '真实样本的折线应被兜底成曲线')

  const wiggle = (v) => {
    let t = 0
    for (let i = 1; i < v.length - 1; i++) t += Math.abs(v[i + 1] - 2 * v[i] + v[i - 1])
    return t
  }
  const before = wiggle(ys)
  const after = wiggle(s.curves[0].points.map(p => p[1]))
  assert.ok(after < before * 0.85, `抖动没被压下去：${before} → ${after.toFixed(1)}`)

  // 二次曲率必须保住：顶点（第 11 点）不许被削平，两侧仍对称
  const p = s.curves[0].points
  assert.ok(Math.abs(p[11][1] - 20) <= 1.5, `顶点被挪动了：y=${p[11][1]}`)
  assert.ok(Math.abs((p[11][1] - p[10][1]) - (p[11][1] - p[12][1])) < 1.5, '顶点两侧应大致对称')
  // 端点原样落回（曲线必须还在原图的左右端点上）
  assert.deepEqual(p[0], [67, 166])
  assert.deepEqual(p[22], [173, 166])
})

test('折线兜底：闭合环（多边形/阴影）不许被掰成曲线', () => {
  const pts = []
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8
    pts.push({ label: `_p${i}`, x: Math.cos(a) * 50, y: Math.sin(a) * 50 })
  }
  const segments = pts.map((p, i) => ({ from: p.label, to: pts[(i + 1) % pts.length].label }))
  const s = build({ points: pts, segments })
  assert.equal(s.curves.length, 0, '闭合环不该被当成曲线')
  assert.equal(s.segments.length, 8, '线段应原样保留')
})

test('折线兜底：尖角折线（分段函数 y=|x|）不许被掰弯', () => {
  const xs = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
  const points = xs.map((x, i) => ({ label: `_v${i}`, x, y: Math.abs(x) }))
  const segments = points.slice(1).map((p, i) => ({ from: points[i].label, to: p.label }))
  const s = build({ points, segments })
  assert.equal(s.curves.length, 0, '顶点是 90° 尖角，必须保持折线')
  assert.equal(s.segments.length, 8, '线段应原样保留')
})

test('折线兜底：点太稀的折线不算密采样', () => {
  const points = [
    { label: '_a', x: 0, y: 0 }, { label: '_b', x: 40, y: 30 },
    { label: '_c', x: 80, y: 30 }, { label: '_d', x: 120, y: 0 }
  ]
  const segments = points.slice(1).map((p, i) => ({ from: points[i].label, to: p.label }))
  assert.equal(build({ points, segments }).curves.length, 0, '仅 4 个点不该触发兜底')
})

test('折线兜底：链上出现真实标注点时不许被样条穿过（在它两侧各自成段）', () => {
  const chain = parabolaChain(23)
  chain.points[11] = { label: 'M', x: -0.1, y: 0 } // 中间换成题面真顶点
  // 线段按改后的点重建（真实场景里模型就是照着这些点连线的）
  chain.segments = chain.points.slice(1).map((p, i) => ({ from: chain.points[i].label, to: p.label }))
  const s = build(chain)
  // 真实标注点是"硬边界"：它两侧各成一段，各自平滑，但 M 本身绝不被样条穿过
  assert.equal(s.curves.length, 2, '应以真实标注点为界切成两段')
  // 与 M 相连的那两条线段不属于任何一段（两端必须都是辅助点），原样保留
  assert.equal(s.segments.length, 2, `只该剩与 M 相连的两条线段，实际 ${s.segments.length}`)
  assert.deepEqual(
    s.segments.map(g => `${g.from}->${g.to}`).sort(),
    ['M->_c12', '_c10->M']
  )
  assert.equal(s.curves[0].points.length, 11)
  assert.equal(s.curves[1].points.length, 11)
})

test('折线兜底：按尖角切段——一个尖点不该把整条曲线拖回折线', () => {
  // 抛物线中段插一个明显的尖点（模拟噪声峰值）：尖角处断开，两侧照旧平滑
  const chain = parabolaChain(23)
  chain.points[8].y += 0.5
  const s = build(chain)
  assert.ok(s.curves.length >= 1, '带尖点的链仍应至少平滑一部分')
  const pts = s.curves.flatMap(c => c.points)
  assert.ok(pts.length >= 20, `大部分采样点应仍被平滑覆盖，实际 ${pts.length}/23`)
})

test('折线兜底：已有曲线不受影响，且不会被二次包装', () => {
  const s = { points: [], segments: [], curves: [{ points: [[0, 0], [1, 1], [2, 4]] }] }
  const m = mergeSampledCurveChains(s.points, s.segments, s.curves)
  assert.equal(m.merged, 0)
  assert.equal(m.curves.length, 1, '原有曲线应原样保留')
})

test('折线兜底端到端：渲染出的是贝塞尔曲线，不是一长串 <line>', () => {
  const s = build(parabolaChain(23))
  const svg = renderGeometrySvg(s)
  assert.match(svg, /<path[^>]*d="M[^"]*C/, '曲线应渲染成带 C 命令的 path')
  const lineCount = (svg.match(/<line\b/g) || []).length
  assert.ok(lineCount <= 1, `不该再有一条条折线，实际 <line> ${lineCount} 条`)

  const tikz = renderGeometryTikZ(s)
  assert.match(tikz, /\.\.\s*controls\s*\(/, 'TikZ 侧应输出 controls 平滑路径')
})

test('内容闸门：`_` 辅助点/辅助线段不参与题干核对（否则按规则画的图会被全量拒稿）', () => {
  // 提示词规则 11/13 要求数轴刻度线、曲线采样点等一律用 `_` 前缀命名；
  // 旧闸门把这些名字当成"题干中未出现的点/线段"逐条报错 ⇒ 每张图 content_mismatch。
  const s = build({
    points: [
      { label: '_ax0', x: 0, y: 0 }, { label: '_ax1', x: 200, y: 0 },
      { label: '_t1_t', x: 35, y: 3 }, { label: '_t1_b', x: 35, y: 0 }
    ],
    segments: [{ from: '_ax0', to: '_ax1' }, { from: '_t1_t', to: '_t1_b' }]
  })
  const g = validateStructureAgainstContent(s, '在数轴上表示下列各数：-1，0，2')
  assert.equal(g.ok, true, `辅助点/辅助线段被误杀：${g.reasons.join('；')}`)
})

test('内容闸门：豁免辅助点之后，真实字母的幻觉照样拦得住', () => {
  const s = build({
    points: [
      { label: '_ax0', x: 0, y: 0 }, { label: '_ax1', x: 200, y: 0 },
      { label: 'A', x: 60, y: 0 }, { label: 'Z', x: 120, y: 40 }
    ],
    segments: [{ from: '_ax0', to: '_ax1' }, { from: 'A', to: 'Z' }]
  })
  const g = validateStructureAgainstContent(s, '在数轴上表示下列各数：-1，0，2')
  assert.equal(g.ok, false, '凭空多出的边 AZ 与点 Z 必须仍被拦住')
})

// ── 渲染家具：刻度数字 / 轴上字母 / 下标归一（2026-09-19 三修，第二批） ──

test('内容闸门：刻度数字是插图家具，不是幻觉点（规则 13 要求这么画）', () => {
  const s = build({
    points: [
      { label: '_ax0', x: 0, y: 0 }, { label: '_ax1', x: 200, y: 0 },
      { label: '_t1_t', x: 35, y: 3 }, { label: '_t1_b', x: 35, y: 0 },
      { label: '-1', x: 35, y: -9 }, { label: '0', x: 70, y: -9 }
    ],
    segments: [{ from: '_ax0', to: '_ax1' }, { from: '_t1_t', to: '_t1_b' }]
  })
  const g = validateStructureAgainstContent(s, '在数轴上表示下列各数，并把它们从小到大排列：-1，0')
  assert.equal(g.ok, true, `刻度数字被当成幻觉点：${g.reasons.join('；')}`)
})

test('内容闸门：识别出轴系后，原点 O 与轴名 X/Y 是插图标配', () => {
  // 关键：`normalizeStructure` 对 figure_type='geometry' 会强制清空 coordinate_system，
  // 所以不能只看那个标志位——必须用渲染器同一套轴判据重新认一遍。
  const s = build({
    points: [
      { label: '_xmin', x: -2, y: 0 }, { label: '_xmax', x: 4, y: 0 },
      { label: '_ymin', x: 0, y: -3 }, { label: '_ymax', x: 0, y: 3.8 },
      { label: 'O', x: 0, y: 0 }, { label: 'A', x: 1, y: 4 }
    ],
    segments: [{ from: '_xmin', to: '_xmax' }, { from: '_ymin', to: '_ymax' }],
    labels: [{ text: 'x', x: 3.7, y: -0.5 }, { text: 'y', x: -0.4, y: 3.6 }]
  })
  const g = validateStructureAgainstContent(s, '如图，点 A 在抛物线图象上，求 OA 的长')
  assert.equal(g.ok, true, `原点/轴名被当成幻觉点：${g.reasons.join('；')}`)
})

test('内容闸门：没有轴的纯几何题里，O 仍按普通点参与核对（豁免不许外溢）', () => {
  const s = build({
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 },
      { label: 'O', x: 5, y: 6 }, { label: 'C', x: 5, y: 12 }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'O' }, { from: 'O', to: 'C' }]
  })
  const g = validateStructureAgainstContent(s, '如图，在△ABC中，求 AB 的长')
  assert.equal(g.ok, false, '无轴图形里的 O 不该被豁免')
  assert.ok(g.reasons.some(r => r.includes('O')), `应点名 O，实际：${g.reasons.join('；')}`)
})

test('内容闸门：下标写法归一（题干 C₁ ≡ 结构 C1），且小写独立字母算点名', () => {
  const s = build({
    points: [
      { label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }, { label: 'C1', x: 5, y: 8 },
      { label: 'a', x: 2, y: 2 }, { label: 'b', x: 8, y: 2 }
    ],
    segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C1' }]
  })
  const g = validateStructureAgainstContent(s, '如图，将△ABC沿BC₁翻折得点C1，求线段AC1与a、b的关系')
  assert.equal(g.ok, true, `下标/小写点名被漏读：${g.reasons.join('；')}`)
})

test('内容闸门：小写提取不吞英文缩写（tan 里的字母不算点名）', () => {
  const s = build({
    points: [{ label: 'n', x: 0, y: 0 }, { label: 'm', x: 10, y: 0 }],
    segments: [{ from: 'n', to: 'm' }]
  })
  // 题干只有英文缩写 tan/sin，没有独立的小写点名 ⇒ n、m 应被判幻觉
  const g = validateStructureAgainstContent(s, '已知 tanA = 1，求 nm 的取值')
  assert.equal(g.ok, false, 'tin/tan 里的字母不该被当成点名而放行 n、m')
})
