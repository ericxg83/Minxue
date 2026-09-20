import test from 'node:test'
import assert from 'node:assert/strict'
import { executeDsl } from '../server/utils/geom/dsl/executor.js'
import { evalExpr, parseFunctionExpr } from '../server/utils/geom/dsl/expr.js'
import { splitCurveRuns, isTickNumberLabel } from '../server/utils/geom/structure.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { renderGeometryTikZ } from '../server/utils/geometryTikZ.js'
import { buildDslPrompts } from '../server/utils/geom/dsl/reactLoop.js'
import { commandReference } from '../server/utils/geom/dsl/commands.js'

/**
 * 2026-09-19 事故：老师发来三张重绘图——
 *   ① 数轴上的刻度数字全挤在轴线上（本该在数轴下方）；
 *   ② 一条抛物线**整条消失**（原图里的抛物线是主角）；
 *   ③ 另一条抛物线是「弯的」——底部有个折角。
 *
 * 根因是同一个：**DSL 命令集里根本没有画曲线的命令**。
 *   函数图象题的解析式常常只在图里/需要先解系数，`functionGraph` 通道（从题干文本解析）
 *   会整题拒绝，于是落到 DSL 通道；而 DSL 只能 point+segment 手搓折线 ⇒ 折角（③），
 *   或者模型干脆放弃画曲线 ⇒ 缺失（②）。刻度数字（①）则是提示词从未约定过该放哪一侧。
 *
 * 修复分三处，本测试逐条锁死：
 *   1) 新命令 `curve`（commands.js + executor.js + toStructure 导出 curves）
 *   2) 两个渲染器把采样点画成**平滑贝塞尔**（geometrySvg.js / geometryTikZ.js）
 *   3) 提示词契约：curve 必须在命令表与硬性规则里、刻度数字规则必须在
 */

// ── 1. 表达式层：变量与隐式乘法 ──

test('表达式支持变量 x（只在显式绑定时生效）', () => {
  assert.equal(evalExpr('x^2', { x: 3 }), 9)
  assert.equal(evalExpr('x^2'), null, '不传 vars 时 x 仍必须是未定义 → null')
  assert.equal(evalExpr('A', { x: 1 }), null, '对象名永远不是变量')
})

test('表达式支持隐式乘法，且不破坏角度单位后缀', () => {
  const near = (a, b) => a != null && Math.abs(a - b) < 1e-9
  assert.equal(evalExpr('2x', { x: 3 }), 6)
  assert.equal(evalExpr('2*x', { x: 3 }), 6)
  assert.equal(evalExpr('-2x^2+4x', { x: 1 }), 2)
  assert.equal(evalExpr('(x+1)(x-1)', { x: 3 }), 8)
  assert.ok(near(evalExpr('2pi'), Math.PI * 2))
  // 单位后缀不是被乘数：`30deg` 是「30 度」
  assert.ok(near(evalExpr('100*sin(30deg)'), 50), `实际 ${evalExpr('100*sin(30deg)')}`)
  assert.ok(near(evalExpr('sin(pi/2 rad)'), 1), `实际 ${evalExpr('sin(pi/2 rad)')}`)
})

test('函数表达式判据：必须有独立变量 x 且可求值', () => {
  assert.equal(parseFunctionExpr('x^2-2x-3')?.kind, 'f')
  assert.equal(parseFunctionExpr('1/x')?.kind, 'f')
  assert.equal(parseFunctionExpr('max(1,2)'), null, '函数名里的 x 不算变量')
  assert.equal(parseFunctionExpr('100'), null)
  assert.equal(parseFunctionExpr('A'), null)
})

// ── 2. curve 命令 ──

const curveDsl = (expr, x1, x2) => [
  'point : 0 0 -> O',
  `curve : ${expr} ${x1} ${x2} -> k1`
].join('\n')

test('curve：按解析式确定性采样，顶点精确落在采样点上', () => {
  const r = executeDsl(curveDsl('x^2-2x-3', -1, 4))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.stats.curves, 1)
  const pts = r.structure.curves[0].points
  assert.ok(pts.length > 50, '采样点要够密')
  const at = pts.find(p => Math.abs(p[0] - 1) < 1e-6)
  assert.deepEqual(at, [1, -4], '顶点 (1,-4) 必须在采样点上')
  assert.deepEqual(pts[0], [-1, 0])
  assert.deepEqual(pts[pts.length - 1], [4, 5])
})

test('curve：支持隐式乘法书写（模型常写 -2x^2+4x）', () => {
  const r = executeDsl(curveDsl('-2x^2+4x', -0.5, 2.5))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const pts = r.structure.curves[0].points
  const vertex = pts.find(p => Math.abs(p[0] - 1) < 1e-6)
  assert.deepEqual(vertex, [1, 2])
})

test('curve：报错语义明确（不猜、不半成品入库）', () => {
  const noVar = executeDsl(curveDsl('100', 0, 1))
  assert.equal(noVar.ok, false)
  assert.equal(noVar.errors[0].message, 'BAD_FUNCTION_EXPR')

  const badDomain = executeDsl(curveDsl('x^2', 4, 1))
  assert.equal(badDomain.ok, false)
  assert.equal(badDomain.errors[0].message, 'BAD_DOMAIN')

  const notFn = executeDsl(curveDsl('1/0', 0, 1))
  assert.equal(notFn.ok, false)
})

test('curve：发散函数（1/x）不把图压成一条缝', () => {
  const r = executeDsl(curveDsl('1/x', -3, 3))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const pts = r.structure.curves[0].points
  const maxAbsY = Math.max(...pts.map(p => Math.abs(p[1])))
  assert.ok(maxAbsY < 1e3, `离群点应被裁掉，实际 maxAbsY=${maxAbsY}`)
})

// ── 3. 缺口切分 ──

test('splitCurveRuns：显式断点把曲线切成两段，不连成横穿直线', () => {
  const pts = []
  for (let x = -3; x < -0.05; x += 0.1) pts.push([x, 1 / x])
  const cutAt = pts.length
  for (let x = 0.05; x <= 3; x += 0.1) pts.push([x, 1 / x])
  const runs = splitCurveRuns(pts, [cutAt])
  assert.equal(runs.length, 2, '应切成左右两支')
  assert.ok(runs[0].every(p => p[0] < 0) && runs[1].every(p => p[0] > 0))
})

test('splitCurveRuns：无显式断点时按间距启发式（历史数据）', () => {
  const pts = [[0, 0], [0.1, 1], [0.2, 2], [1.0, 3], [1.1, 4], [1.2, 5]]
  assert.equal(splitCurveRuns(pts).length, 2, '中间 0.8 的跳变应判为缺口')
})

test('splitCurveRuns：均匀采样（正常抛物线）不被误切', () => {
  const pts = []
  for (let i = 0; i <= 100; i++) pts.push([-1 + (5 * i) / 100, 0])
  assert.equal(splitCurveRuns(pts).length, 1)
})

test('curve 端到端：1/x 的断点被记录，渲染成两条独立 path（不横穿）', () => {
  const r = executeDsl(curveDsl('1/x', -3, 3))
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const c = r.structure.curves[0]
  assert.ok(Array.isArray(c.breaks) && c.breaks.length >= 1, '应记录断点下标')
  const svg = renderGeometrySvg(r.structure)
  const d = svg.match(/<path d="([^"]+)"/)[1]
  assert.equal((d.match(/M /g) || []).length, 2, '两支应各自以 M 起头')
})

// ── 4. 渲染：平滑而非折角 ──

const renderCurve = (pts) => renderGeometrySvg({
  figure_type: 'geometry',
  points: [{ label: '_k0', x: pts[0][0], y: pts[0][1] }],
  curves: [{ points: pts }]
})

test('SVG：曲线渲染成平滑贝塞尔，不出折角', () => {
  const svg = renderGeometrySvg(executeDsl(curveDsl('x^2-2x-3', -1, 4)).structure)
  assert.ok(svg)
  const d = svg.match(/<path d="([^"]+)"/)[1]
  assert.ok(/ C /.test(d), '应含三次贝塞尔段')
  assert.equal(/ L /.test(d), false, '不应有折线段（除两点直线外）')
})

test('SVG：稀疏采样（历史数据只有 10 个点）同样平滑', () => {
  const pts = []
  for (let i = 0; i <= 10; i++) {
    const x = -2 + (4 * i) / 10
    pts.push([x, x * x])
  }
  const d = renderCurve(pts).match(/<path d="([^"]+)"/)[1]
  assert.ok(/ C /.test(d), '10 个点也必须是贝塞尔')
  assert.equal((d.match(/ C /g) || []).length, 10, '11 点 ⇒ 10 段')
})

test('SVG：曲线**精确经过**每个采样点（顶点不会被插值挪走）', () => {
  const pts = [[0, 0], [1, -1], [2, 0], [3, 3]]
  const d = renderCurve(pts).match(/<path d="([^"]+)"/)[1]
  // 取出 M 点 + 每段 C 的终点 = 全部采样点的 SVG 坐标
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number)
  const endPts = []
  const m = d.match(/^M (-?[\d.]+) (-?[\d.]+)/)
  endPts.push([Number(m[1]), Number(m[2])])
  for (const cm of d.matchAll(/C (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/g)) {
    endPts.push([Number(cm[5]), Number(cm[6])])
  }
  assert.equal(endPts.length, pts.length, '端点个数必须等于采样点个数')

  // 渲染是仿射变换：把 SVG y 归一化后应与数学 y 归一化**逐个相等**（顺序都一致）
  const norm = (arr) => {
    const lo = Math.min(...arr)
    const hi = Math.max(...arr)
    return arr.map(v => (hi - lo < 1e-9 ? 0 : Math.round(((v - lo) / (hi - lo)) * 1e6) / 1e6))
  }
  const svgY = endPts.map(p => p[1])
  const mathY = pts.map(p => p[1])
  assert.deepEqual(norm(svgY), norm(mathY).map(v => 1 - v), 'SVG y 轴向下 ⇒ 归一化后应上下翻转相等')
  assert.ok(nums.length > 0 && d.includes('C'))
})

test('TikZ：与 SVG 同源同形（.. controls .. 且不依赖 smooth 库）', () => {
  const s = executeDsl(curveDsl('x^2-2x-3', -1, 4)).structure
  const tikz = renderGeometryTikZ(s)
  assert.ok(/\.\. controls /.test(tikz), '应是三次贝塞尔')
  assert.equal(/\bsmooth\b/.test(tikz), false, '不得使用需要 plothandlers 库的 smooth 选项')
  assert.equal(/\bplot\b/.test(tikz), false)
})

// ── 5. 刻度数字：只画文字、不画圆点 ──

test('isTickNumberLabel：认出刻度数字（含负号/小数/Unicode 负号）', () => {
  for (const t of ['0', '1', '-2', '1.5', '−3', '10']) {
    assert.equal(isTickNumberLabel(t), true, `${t} 应判为刻度数字`)
  }
  for (const t of ['A', 'x₁', '-1a', 'O', '', 'M2']) {
    assert.equal(isTickNumberLabel(t), false, `${t} 不该判为刻度数字`)
  }
})

test('渲染：刻度数字不画圆点，普通顶点照常画点', () => {
  const svg = renderGeometrySvg({
    figure_type: 'geometry',
    points: [
      { label: '0', x: 0, y: -8 },
      { label: '1', x: 10, y: -8 },
      { label: 'A', x: 20, y: 0 },
      { label: 'P', x: 30, y: 5 }
    ],
    segments: [{ from: '0', to: '1' }]
  })
  const dots = (svg.match(/<circle/g) || []).length
  assert.equal(dots, 2, `字母顶点各 1 个圆点、刻度数字 0 个，实际 ${dots}`)
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1])
  assert.deepEqual(texts.sort(), ['0', '1', 'A', 'P'])
})

test('TikZ：刻度数字同样不画圆点（两端一致）', () => {
  const tikz = renderGeometryTikZ({
    figure_type: 'geometry',
    points: [{ label: '0', x: 0, y: -8 }, { label: 'A', x: 20, y: 0 }],
    segments: []
  })
  assert.equal((tikz.match(/\\fill /g) || []).length, 1, '只有 A 应画实心点')
})

// ── 6. 提示词契约：源码级锁死，防止以后被删 ──

test('命令表里必须有 curve（prompt 由命令表自动生成）', () => {
  assert.ok(commandReference().includes('curve :'), '命令参考里缺少 curve')
})

test('提示词：函数图象必须用 curve、刻度数字必须在轴下方', () => {
  const { systemPrompt } = buildDslPrompts({
    content: '如图，抛物线 y=ax²+bx 交 x 轴正半轴于点 A', dsl: '', errors: [], round: 1
  })
  assert.ok(systemPrompt.includes('curve :'), '命令表应含 curve')
  assert.ok(/函数图象必须用\s*`curve`/.test(systemPrompt), '缺「函数图象必须用 curve」硬性规则')
  assert.ok(/curve : -2x\^2\+4x/.test(systemPrompt), '缺抛物线示例（模型最靠示例学写法）')
  assert.ok(/刻度数字/.test(systemPrompt) && /数轴\*\*下方\*\*/.test(systemPrompt), '缺刻度数字位置规则')
  assert.ok(/point : 40 0 -> P/.test(systemPrompt), '缺数轴示例（刻度数字在下方、点本身照原图放）')
})

test('核对指引：曲线形状不符必须判 FIX（否则形状错的曲线会被放过）', () => {
  const { userPrompt } = buildDslPrompts({
    content: 'x', dsl: 'point : 0 0 -> A', errors: [], round: 2
  })
  assert.ok(/原图有两支却只画了一支/.test(userPrompt), '缺"漏画一支"判据')
  assert.ok(/开口方向相反/.test(userPrompt), '缺"开口方向"判据')
  assert.ok(/形状是几何事实，不是画风/.test(userPrompt), '要与"不看画风"划清界限')
  assert.ok(/先看清左图画了几支/.test(userPrompt), '要提醒先读原图，避免误判')
})
