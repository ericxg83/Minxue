/**
 * P2-7 程序化图元回归测试（2026-09-26）
 *
 * 覆盖两条图元通道：
 *   ① 网格/格点图元：normalizeGrid 归一、SVG/TikZ 双渲染器底图、DSL grid 命令、
 *      格点图放行口径 shouldSkipRedraw（生成侧与发布侧同一函数）；
 *   ② 数轴确定性生成通道：题面写明数值/解集 → 服务端精确布局，解析不出 → null 回退。
 *
 * 纪律：本文件只锁「图元画得对 + 不该出图时坚决不出」，不允许通过放宽断言放行。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeStructure, detectNumberAxis, isTickNumberLabel, isVertexSymbolLabel } from '../server/utils/geom/structure.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'
import { executeDsl, buildStructureFromDsl } from '../server/utils/geom/dsl/index.js'
import { detectNonGeometryFigure, shouldSkipRedraw } from '../server/utils/geometryContentGate.js'
import { parseAxisNumber, parseNumberAxisSpec, specToNumberAxisStructure } from '../server/utils/numberAxis/parseSpec.js'
import { buildNumberAxisSvg } from '../server/utils/numberAxis/index.js'

// ───────────────────────────── ① 网格图元 ─────────────────────────────

const GRID_STEM = '如图，每个小正方形的边长均为1，图中三角形的顶点都在格点上'

test('normalizeGrid：合法参数归一，非法一律判无网格（不猜）', () => {
  const ok = normalizeStructure({ figure_type: 'geometry', grid: { x: 0, y: 0, unit: 1, cols: 6, rows: 4 }, points: [{ label: 'A', x: 1, y: 1 }] })
  assert.deepEqual(ok.grid, { x: 0, y: 0, unit: 1, cols: 6, rows: 4 })
  for (const bad of [undefined, null, {}, { x: 0, y: 0, unit: 0, cols: 6, rows: 4 }, { x: 0, y: 0, unit: 1, cols: 2.5, rows: 4 }, { x: 0, y: 0, unit: 1, cols: 999, rows: 4 }]) {
    const s = normalizeStructure({ figure_type: 'geometry', grid: bad, points: [{ label: 'A', x: 1, y: 1 }] })
    assert.equal(s.grid, undefined, `非法 grid 必须被丢弃: ${JSON.stringify(bad)}`)
  }
})

test('SVG 渲染器：grid 画成底层格线，数量=（列+1）+（行+1），且存量结构不受影响', () => {
  const svg = renderGeometrySvg({ figure_type: 'geometry', grid: { x: 0, y: 0, unit: 20, cols: 4, rows: 3 }, points: [{ label: 'A', x: 20, y: 20 }, { label: 'B', x: 80, y: 20 }] , segments: [{ from: 'A', to: 'B' }] })
  assert.ok(svg)
  const g = /<g stroke="#c9c9c9"[^>]*>([\s\S]*?)<\/g>/.exec(svg)
  assert.ok(g, '应输出网格底图层')
  assert.equal([...g[1].matchAll(/<line /g)].length, (4 + 1) + (3 + 1), '格线数量 = 竖(列+1) + 横(行+1)')
  assert.ok(svg.indexOf('#c9c9c9') < svg.indexOf('stroke="#111111"'), '网格必须在主图形之前（底层）')
  // 存量无 grid 结构：不出现底图层
  const plain = renderGeometrySvg({ figure_type: 'geometry', points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 50, y: 50 }], segments: [{ from: 'A', to: 'B' }] })
  assert.ok(!plain.includes('#c9c9c9'), '无 grid 字段的存量结构输出不得变化')
})

test('TikZ 渲染器：grid 输出 black!25 格线，与 SVG 同一存在性', () => {
  const tikz = renderGeometryTikZ({ figure_type: 'geometry', grid: { x: 0, y: 0, unit: 1, cols: 4, rows: 3 }, points: [{ label: 'A', x: 1, y: 1 }, { label: 'B', x: 4, y: 1 }], segments: [{ from: 'A', to: 'B' }] })
  assert.ok(tikz)
  assert.equal([...tikz.matchAll(/black!25/g)].length, (4 + 1) + (3 + 1))
  const plain = renderGeometryTikZ({ figure_type: 'geometry', points: [{ label: 'A', x: 0, y: 0 }], segments: [] })
  assert.ok(!plain || !plain.includes('black!25'), '无 grid 不得出现格线')
})

test('DSL grid 命令：执行合法并导出结构 grid 字段；非法参数报错不产出', () => {
  const r = buildStructureFromDsl('grid : 0 0 1 6 4 -> g1\npoint : 1 1 -> A\npoint : 5 1 -> B\nsegment : A B -> AB')
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.deepEqual(r.structure.grid, { x: 0, y: 0, unit: 1, cols: 6, rows: 4 })
  const bad = executeDsl('grid : 0 0 1 30 30 -> g1') // 900 格 > 100
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some(e => e.message === 'GRID_TOO_BIG'))
  const bad2 = executeDsl('grid : 0 0 -1 4 4 -> g1')
  assert.equal(bad2.ok, false)
  assert.ok(bad2.errors.some(e => e.message === 'BAD_GRID_UNIT'))
})

test('格点图放行口径：判据仍 skip，但 DSL 通道 + 产物带 grid 才放行（两侧同一函数）', () => {
  const pref = detectNonGeometryFigure(GRID_STEM)
  assert.equal(pref.skip, true)
  assert.equal(pref.kind, 'grid_figure')
  // 产物无网格 = 当年拦它的残图，照旧不放行
  assert.equal(shouldSkipRedraw(pref, { points: [] }), true, '无 grid 产物的格点图仍不得发布')
  // 产物真带网格底图 → 放行
  assert.equal(shouldSkipRedraw(pref, { grid: { x: 0, y: 0, unit: 1, cols: 4, rows: 3 } }), false)
  // 其它 skip 类别不受影响（流程图/表格绝不因结构字段放行）
  const flow = detectNonGeometryFigure('有一个数值转换器，原理如图：当输入x的值为64时，输出y的值是______.')
  assert.equal(shouldSkipRedraw(flow, { grid: { x: 0, y: 0, unit: 1, cols: 4, rows: 3 } }), true)
})

test('普通几何题不受 grid 影响（防误伤）', () => {
  const s = normalizeStructure({ figure_type: 'geometry', points: [{ label: 'A', x: 0, y: 0 }, { label: 'B', x: 10, y: 0 }, { label: 'C', x: 5, y: 8 }], segments: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A' }] })
  assert.equal(s.grid, undefined)
})

// ──────────────────────── ② 数轴确定性生成通道 ────────────────────────

test('parseAxisNumber：整数/小数/负号变体/根式/分数；带运算的表达式一律拒', () => {
  assert.equal(parseAxisNumber('-2'), -2)
  assert.equal(parseAxisNumber('−3.5'), -3.5) // 全角负号
  assert.equal(Math.abs(parseAxisNumber('√2') - Math.SQRT2) < 1e-12, true)
  assert.equal(Math.abs(parseAxisNumber('-√3') + Math.sqrt(3)) < 1e-12, true)
  assert.equal(Math.abs(parseAxisNumber('2√5') - 2 * Math.sqrt(5)) < 1e-12, true)
  // 分数刻度是精确值，2026-09-27 起放行（d0ccaf00「点A表示的数是-2/3」真题曾因此不出图）
  assert.equal(parseAxisNumber('1/2'), 0.5)
  assert.equal(parseAxisNumber('-2/3'), -2 / 3)
  assert.equal(parseAxisNumber('1/0'), null, '分母为 0 仍拒')
  for (const bad of ['-√2+2', '1/2x', 'x', '', 'a', '√']) assert.equal(parseAxisNumber(bad), null, `应拒: ${bad}`)
})

test('根式刻度进入标签白名单（文字刻度不配圆点）', () => {
  assert.equal(isTickNumberLabel('-√2'), true)
  assert.equal(isTickNumberLabel('√5'), true)
  assert.equal(isTickNumberLabel('2√'), false)
  assert.equal(isVertexSymbolLabel('-√2'), true)
  assert.equal(isVertexSymbolLabel('-√2+1'), false)
})

test('分数刻度同白名单口径：1/2 与 0.5 是同一个数（要上屏、不配圆点）', () => {
  // 2026-09-27：分数刻度与根式同一可信级（题干明写的精确数，不是目测的几何事实）。
  // 修复前 `1/2` 既不是刻度数字也不是可上屏符号 ⇒ 标注被整条丢掉，画面上只剩一颗没有读数的点。
  assert.equal(isTickNumberLabel('1/2'), true)
  assert.equal(isVertexSymbolLabel('1/2'), true)
  assert.equal(isTickNumberLabel('-2/3'), true)
  assert.equal(isVertexSymbolLabel('-2/3'), true)
  assert.equal(isTickNumberLabel('1/0'), false, '分母为 0 不成数，仍拒')
  assert.equal(isVertexSymbolLabel('1/0'), false, '分母为 0 不成数，仍拒')
  assert.equal(isTickNumberLabel('x/2'), false, '含变量不是刻度')
  assert.equal(isTickNumberLabel('1/2/3'), false, '连除不是刻度')
})

test('数轴通道：点值明示 → 出图且布局精确（刻度间距相等、点名吸附在整数值上）', () => {
  const b = buildNumberAxisSvg('', '如图，在数轴上，点A表示的数是-2，点B表示的数是3，则AB的长为____.', renderGeometrySvg)
  assert.ok(b, '题面写明两点值 → 必须确定性出图')
  const axis = detectNumberAxis(b.structure.points, b.structure.segments, {})
  assert.ok(axis, '产物必须被识别为数轴（渲染器吸附通道的前提）')
  const texts = [...b.svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="middle">([-\d√]+)<\/text>/g)].map(m => ({ x: +m[1], t: m[3] }))
  const nums = ['-3', '-2', '-1', '0', '1', '2', '3'].map(t => texts.find(v => v.t === t)).filter(Boolean)
  assert.equal(nums.length, 7, '整数刻度数字全上屏')
  const gaps = nums.slice(1).map((v, i) => v.x - nums[i].x)
  const base = gaps[0]
  assert.ok(gaps.every(gp => Math.abs(gp - base) < 0.5), `刻度间距必须相等（亚像素容差）: ${gaps.join(',')}`)

  // ── 摆位：点名在轴上方、刻度数字在轴下方（2026-09-27）──
  // 修复前点名与刻度数字同写 y=-9 ⇒ 整数值点的字母与刻度数字**逐位重叠**（"A" 压在 "-2" 上），
  // 学生根本读不出题面点名。这里锁死「异侧 + 不重叠」两条。
  const allTexts = [...b.svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map(m => ({ x: +m[1], y: +m[2], t: m[3] }))
  const letterA = allTexts.find(v => v.t === 'A')
  const numMinus2 = allTexts.find(v => v.t === '-2')
  assert.ok(letterA && numMinus2, '点 A 与刻度数字 -2 都必须上屏')
  assert.ok(letterA.y < numMinus2.y, `点名必须在轴上方、刻度数字在轴下方（实测 A.y=${letterA.y} / -2.y=${numMinus2.y}）`)
  const seenPos = new Set()
  for (const v of allTexts) {
    const key = `${v.x}|${v.y}`
    assert.ok(!seenPos.has(key), `两个标注坐标完全相同（叠死）: ${v.t} @ ${key}`)
    seenPos.add(key)
  }
  // 圆点吸附在轴上（字母点的 y=+9 只是排版意图，不是悬空的点）
  const dots = [...b.svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g)].map(m => ({ x: +m[1], y: +m[2] }))
  assert.equal(dots.length, 2, 'A、B 两颗圆点都要上屏')
  assert.equal(dots[0].y, dots[1].y, '两颗圆点必须同在轴线上')
  assert.ok(dots[0].y > letterA.y && dots[0].y < numMinus2.y, '圆点在轴上：位于字母行与数字行之间')
})

test('数轴通道：解集 x>2 → 空心端点+右向解线；x≤−1 → 实心端点+左向解线', () => {
  const gt = buildNumberAxisSvg('', '不等式的解集为 x>2，请在数轴上表示出来.', renderGeometrySvg)
  assert.ok(gt)
  const dotGt = gt.structure.points.find(p => p.label.startsWith('sd_'))
  assert.equal(dotGt.type, 'origin', '严格不等 → 空心圆点')
  // 载体不能是 `_` 辅助点：辅助点渲染器既不画圆点也不画文字，严格/含等的唯一视觉区分就没了
  assert.ok(!dotGt.label.startsWith('_'), '端点圆点载体不得为 `_` 辅助点（否则圆点整颗丢失）')
  assert.match(gt.svg, /<circle[^>]*r="3"[^>]*fill="none"/, '严格不等必须真的画出空心圆点')
  const rayEndGt = gt.structure.points.find(p => p.label === '_se>')
  assert.ok(rayEndGt.x > dotGt.x, 'x>2 解线朝右')

  const le = buildNumberAxisSvg('', '不等式 2x+4≤2 的解集为 x≤−1，在数轴上表示该解集.', renderGeometrySvg)
  assert.ok(le, '全角负号必须能解析')
  const dotLe = le.structure.points.find(p => p.label.startsWith('sd_'))
  assert.equal(dotLe.type, 'vertex', '含等号 → 实心圆点')
  assert.match(le.svg, /<circle[^>]*r="2\.4"/, '含等必须真的画出实心圆点')
  assert.ok(!/<circle[^>]*fill="none"/.test(le.svg), '含等不能出现空心圆点')
  const rayEndLe = le.structure.points.find(p => p.label === '_se<')
  assert.ok(rayEndLe.x < dotLe.x, 'x≤−1 解线朝左')
})

test('数轴通道：分数刻度（-2/3 点值 / x>1/2 端点）位置精确且读数上屏', () => {
  // 点值：旧口径 parseAxisNumber 拒分数 ⇒ d0ccaf00「点A表示的数是-2/3」整题不出图
  const b = buildNumberAxisSvg('', '如图，在数轴上，点A表示的数是-2/3，点B表示的数是1/2，则AB的长为____.', renderGeometrySvg)
  assert.ok(b, '分数点值必须能出图')
  const texts = [...b.svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map(m => ({ x: +m[1], t: m[3] }))
  const xOf = (t) => texts.find(v => v.t === t)?.x
  assert.ok(xOf('A') > xOf('-1') && xOf('A') < xOf('0'), '-2/3 必须精确落在 -1 与 0 之间（不是 -2 刻度上）')
  assert.ok(xOf('B') > xOf('0') && xOf('B') < xOf('1'), '1/2 必须精确落在 0 与 1 之间')

  // 解集端点：分数端点值必须上屏（否则只剩一颗没有读数的点）
  const gt = buildNumberAxisSvg('', '不等式的解集为 x>1/2，请在数轴上表示出来.', renderGeometrySvg)
  assert.ok(gt, '分数解集端点必须能出图')
  assert.match(gt.svg, /<circle[^>]*r="3"[^>]*fill="none"/, '严格不等端点仍是空心圆点')
  assert.ok([...gt.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].some(m => m[1] === '1/2'), '分数端点值 1/2 必须上屏')
})

test('数轴通道：位置只在图里/含其它构造/点缺值 → 坚决不出图（回退描摹/目测闭环）', () => {
  const refuses = [
    '(数形结合)在数轴上表示有理数a、b、c、d,如图所示,则正确的结论是',
    '如图，在数轴上点A表示的数是1，以A为圆心，2为半径画圆交数轴于点B，点B表示的数是____.',
    '如图，一只蚂蚁从点 A 沿数轴向右爬行了 2 个单位长度到达点 B，点 A 表示 -√2，设点 B 所表示的数为____.',
    '如图，数轴上点M表示的数是-3.5，点N表示的数是0.5，则线段MN的中点表示的数是____.',
  ]
  for (const c of refuses) {
    assert.equal(buildNumberAxisSvg('', c, renderGeometrySvg), null, `不该出图: ${c.slice(0, 24)}`)
  }
})

test('数轴通道：解集线引线用 extend 豁免刻度纠偏（产物仍识别为数轴、形态不被改写）', () => {
  const b = buildNumberAxisSvg('', '不等式的解集为 x>2，请在数轴上表示出来.', renderGeometrySvg)
  const lead = b.structure.segments.find(s => s.from.startsWith('sd_'))
  assert.equal(lead.extend, true, '引线必须标 extend（否则会被 normalizeTickMarks 当刻度改写）')
  const e1 = b.structure.points.find(p => p.label === '_sl>')
  assert.ok(e1.y > 0, '解线必须抬到轴上方（与轴同高会重合，学生看不出解）')
})

// ── 2026-09-27 枚举式点值（b6b1112e 实题回归）────────────────────────────
test('parseNumberAxisSpec 枚举模式：字母串+数值串一一对应', async () => {
  const { parseNumberAxisSpec } = await import('../server/utils/numberAxis/parseSpec.js')
  const spec = parseNumberAxisSpec('如图，数轴上有 O、A、B、C、D 五个点，分别表示数 0、2、3、4、5，则表示数 \sqrt{2}\times\sqrt{12}-2 的点会落在（ ）')
  assert.deepEqual(spec.points.map(p => [p.label, p.value]), [['O', 0], ['A', 2], ['B', 3], ['C', 4], ['D', 5]])
  // 字母数与数值数不匹配 → 整题放弃（位置可能只在图里，宁缺毋错）
  const bad = parseNumberAxisSpec('数轴上有 A、B、C 三个点，分别表示数 1、2')
  assert.equal(bad, null)
  // 位置只在图里（无数值）→ 不出图
  assert.equal(parseNumberAxisSpec('实数a、b在数轴上对应的点的位置如图所示'), null)
})

// ── 2026-09-27 物理量因变量归一（c1619a2e 实题回归）──────────────────────
test('parseFunctionGraphSpec 归一 fallback：h=20t-5t² → y=20x-5x^2', async () => {
  const { parseFunctionGraphSpec } = await import('../server/utils/functionGraph/parseSpec.js')
  const spec = parseFunctionGraphSpec('', '小球的飞行高度h(米)与飞行时间t(秒)之间满足函数关系h=20t-5t².则小球从飞出到落地瞬间所需要的时间为')
  assert.equal(spec.kind, 'parabola')
  assert.equal(spec.opens, 'down')
  assert.deepEqual(spec.vertex, { x: 2, y: 20 })
  // 常规 y=… 路径零回归
  const plain = parseFunctionGraphSpec('', '如图，抛物线 y=x²-2x-3 与 x 轴交于点A、B')
  assert.equal(plain.kind, 'parabola')
})
