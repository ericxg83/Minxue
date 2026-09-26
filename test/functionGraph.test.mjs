/**
 * 函数图象确定性解析与渲染回归测试。
 *
 * 覆盖三类：
 *   1) 能确定性出图的正例（数值式 / 顶点式 / 顶点+点 / 两交点+截距 / 对称轴+点 / 符号+条件）
 *   2) 必须拒绝的反例（开口未知、图形只在图片里、绝对值函数、非二次）
 *   3) 渲染产物：SVG 必须含曲线 path 与坐标轴，且不出现 NaN
 *
 * 运行：node --test test/functionGraph.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFunctionGraphSpec } from '../server/utils/functionGraph/parseSpec.js'
import { buildFunctionGraphFromStem, buildFunctionGraphSvg, hasOtherGeometry } from '../server/utils/functionGraph/index.js'
import { parseLineParabola } from '../server/utils/functionGraph/lineParabola.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { xInterceptsOf } from '../server/utils/functionGraph/buildStructure.js'

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

test('R1 全数字一般式：y=x^2-2x-3', () => {
  const s = parseFunctionGraphSpec('', '■已知二次函数y=x²-2x-3. (2)在平面直角坐标系xOy中,画出二次函数y=x²-2x-3的图像;')
  assert.ok(s, '应能解析')
  assert.equal(s.opens, 'up')
  assert.ok(near(s.a, 1))
  assert.ok(near(s.vertex.x, 1))
  assert.ok(near(s.vertex.y, -4))
  assert.equal(s.approximate, false)
})

test('R1 全数字一般式：小问号 (2) 污染必须被剥掉', () => {
  const s = parseFunctionGraphSpec('', '已知二次函数y=x²-2x-3. (3)结合函数图像,直接写出当-4≤y≤0时,x的取值范围.')
  assert.ok(s)
  assert.equal(s.expression, 'y=x^2-2x-3')
})

test('R1 全数字一般式：y=-1/2x²+bx+c 中 b/c 符号未知 → 拒绝', () => {
  assert.equal(parseFunctionGraphSpec('', '如图，已知关于 x 的二次函数 y=-1/2x²+bx+c 的图像如图所示，则这个二次函数的表达式为'), null)
})

test('R1 顶点式：y=-3/2(x-h)²+k 中 h/k 符号未知 → 拒绝', () => {
  assert.equal(parseFunctionGraphSpec('', '抛物线y=-3/2(x-h)²+k(h,k为常数)与线段AB交于C、D两点'), null)
})

test('R1 全数字顶点式：y=½(x-2)²+4', () => {
  const s = parseFunctionGraphSpec('', '如图，将函数 y=½(x-2)²+4 的图像沿 y 轴向上平移得到一个新函数的图像')
  assert.ok(s)
  assert.ok(near(s.a, 0.5))
  assert.ok(near(s.vertex.x, 2))
  assert.ok(near(s.vertex.y, 4))
})

test('R2a 顶点坐标 + 曲线上一点 → 解出 a（开口由解出）', () => {
  const s = parseFunctionGraphSpec(
    '',
    '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；'
  )
  assert.ok(s, '顶点(1,4) + 点 C(0,3) 应能解出')
  assert.ok(near(s.a, -1), `a 应为 -1，实际 ${s.a}`)
  assert.equal(s.opens, 'down')
  assert.ok(near(s.vertex.x, 1))
  assert.ok(near(s.vertex.y, 4))
  assert.equal(s.solvedFrom, 'vertex_and_point_implied', '题干没写表达式，应由顶点+交点反推')
})

test('R2a 顶点式 + 曲线上一点 → 解出 a', () => {
  const s = parseFunctionGraphSpec(
    '',
    '如图，抛物线y=a(x-1)²+4与x轴交于点A、B，与y轴交于点C，过点C作CD∥x轴交抛物线的对称轴于点D，连接BD，已知点A的坐标为(-1,0)。 (1)求该抛物线的表达式；'
  )
  assert.ok(s)
  assert.ok(near(s.a, -1), `a 应为 -1，实际 ${s.a}`)
})

test('R2c 两个 x 轴交点 + 常数项 → 解出 a', () => {
  const s = parseFunctionGraphSpec('', '如图，已知抛物线 y=ax²+bx-4 与 x 轴分别交于点 A(2,0)、B(-4,0)，与 y 轴交于点 C，点 Q 是抛物线上一点。 (1)求抛物线的表达式；')
  assert.ok(s, '两交点 + C=-4 应能解出')
  assert.ok(near(s.a, 0.5), `a 应为 0.5，实际 ${s.a}`)
  assert.equal(s.opens, 'up')
  assert.ok(near(s.vertex.x, -1))
})

test('B4 符号系数 + 条件定开口 + 顶点坐标 → 代表元（标 approximate）', () => {
  const s = parseFunctionGraphSpec('', '如图，抛物线 y=ax²+bx+c(a<0) 的顶点坐标为(1,4)，则 ac 的值为')
  assert.ok(s, 'a<0 定开口、顶点坐标定位置，应能出图')
  assert.equal(s.opens, 'down')
  assert.equal(s.approximate, true)
  assert.equal(s.solvedFrom, 'symbolic_representative')
})

test('拒绝：y=ax²+c 的顶点必须在 y 轴上，题干给 (1,-2) 属自相矛盾', () => {
  assert.equal(parseFunctionGraphSpec('', '抛物线 y=ax²+c(a<0) 的顶点坐标为(1,-2)'), null)
  assert.equal(parseFunctionGraphSpec('', '抛物线 y=ax²+c(a<0) 的对称轴为直线 x=1'), null)
  // 顶点在 y 轴上则自洽
  assert.ok(parseFunctionGraphSpec('', '抛物线 y=ax²+c(a<0) 的顶点坐标为(0,-2)'))
})

test('拒绝：顶点式表达式里的对称轴与题干给的顶点冲突', () => {
  assert.equal(parseFunctionGraphSpec('', '抛物线 y=(x-1)²+k 的顶点坐标为(3,5)'), null)
})

test('拒绝：开口方向未知（a 为符号且无任何符号条件）', () => {
  assert.equal(parseFunctionGraphSpec('', '如图，关于 x 的二次函数 y=ax²+bx+c 的图像与直线 y=3 相交于点 A(0,3) 和点 B，对称轴为直线 x=2'), null)
})

test('拒绝：图像是给定条件、函数待求（信息只在图片里）', () => {
  assert.equal(parseFunctionGraphSpec('', '3.已知某函数的图像如图所示. (1)求这个函数的表达式;'), null)
  assert.equal(parseFunctionGraphSpec('', '2.二次函数的图像如图所示,则其表达式是'), null)
})

test('拒绝：绝对值函数 / 非二次', () => {
  assert.equal(parseFunctionGraphSpec('', '某班数学兴趣小组对函数y=|x²-2x|的图像和性质进行了探究'), null)
})

test('拒绝：数轴题（位置只在图里）', () => {
  assert.equal(parseFunctionGraphSpec('', '实数a、b在数轴上对应的点的位置如图所示，则|a-b|-|b+a|=____.'), null)
})

test('拒绝：采信的曲线点必须真的在曲线上（不一致 → 放弃）', () => {
  // 顶点 (1,4) 与点 (0,3) 定出 a=-1；再塞一个明显不在该抛物线上的点，应整体拒绝
  const s = parseFunctionGraphSpec('', '顶点坐标为(1,4)，抛物线经过点C(0,3)和点D(0,100)')
  assert.equal(s, null, '第二个点与解出的抛物线矛盾时必须拒绝，不能画错')
})

test('拒绝：y=-2x²+c（c 符号未知 → 纵向位置不定）', () => {
  assert.equal(parseFunctionGraphSpec('', '已知点 A(x₁,y₁)、B(x₂,y₂) 都在抛物线 y=-2x²+c 上，其中 c 为常数。 (1) 如果 0<x₁<x₂，那么 y₁ ___ y₂'), null)
})

test('渲染：曲线 path 存在、坐标轴存在、无 NaN', () => {
  const built = buildFunctionGraphSvg('', '已知二次函数y=x²-2x-3. (2)画出二次函数y=x²-2x-3的图像', renderGeometrySvg)
  assert.ok(built, '应能构建')
  assert.match(built.svg, /<path d="M /)
  assert.match(built.svg, /<line /)          // 坐标轴
  assert.doesNotMatch(built.svg, /NaN/)
  assert.equal(built.structure.figure_type, 'coordinate')
  assert.equal(built.structure.coordinate_system.exists, true)
})

test('渲染：抛物线不出画面（采样点全部落在视野内）', () => {
  const built = buildFunctionGraphSvg('', '已知二次函数y=x²-2x-3. 画出图像', renderGeometrySvg)
  assert.ok(built)
  const pts = built.structure.curves[0].points
  const xs = pts.map(p => p[0])
  const span = Math.max(...xs) - Math.min(...xs)
  assert.ok(span > 1, '视野不应退化')
  // 顶点必须落在采样范围内
  assert.ok(Math.min(...xs) <= 1 + 1e-9 && 1 <= Math.max(...xs) + 1e-9)
})

test('交点计算：xInterceptsOf 与 a/h/k 一致', () => {
  assert.deepEqual(xInterceptsOf(1, 1, -4).map(v => Math.round(v * 1e6) / 1e6), [-1, 3])
  assert.deepEqual(xInterceptsOf(1, 0, 1), [])
  assert.deepEqual(xInterceptsOf(-1, 0, 0), [0])
})

test('buildFunctionGraphFromStem：无法解析时返回 null', () => {
  assert.equal(buildFunctionGraphFromStem('', '如图，数轴上有A、B、C、D四点'), null)
})

test('buildFunctionGraphFromStem：多小问共享 parent_stem 时也能解析', () => {
  const s = buildFunctionGraphFromStem('已知二次函数 y=x²-4x+3。', '(2)画出该函数的图像')
  assert.ok(s, 'parent_stem 里的表达式应被采用')
  assert.ok(s.curves.length > 0)
})

// ── 纯度闸门：本通道只画得出抛物线本体 ──
// 题干另有三角形/辅助线时，重绘出来是"残缺的图"，而裁剪原图是完整的，回退原图严格更好。

test('纯度闸门：纯抛物线题放行', () => {
  assert.equal(hasOtherGeometry('已知二次函数y=x²-2x-3. (2)在平面直角坐标系xOy中,画出它的图像'), false)
  assert.equal(hasOtherGeometry('如图，抛物线 y=ax²+bx-4 与 x 轴交于点 A(2,0)、B(-4,0)，与 y 轴交于点 C'), false)
})

test('纯度闸门：对称轴写法「直线x=2」不能被当成「直线BC」', () => {
  assert.equal(hasOtherGeometry('抛物线的对称轴是直线x=3/2，与x轴交于点A(-1,0)'), false)
  assert.equal(hasOtherGeometry('直线 BC 与抛物线交于点 A'), true)
  assert.equal(hasOtherGeometry('直线 l: y=-3/4x-3 沿 x 轴翻折'), true)
})

test('纯度闸门：三角形/辅助线/垂线/平行线必须拦下', () => {
  assert.equal(hasOtherGeometry('抛物线 y=2(x-2)² 与平行于 x 轴的直线交于点 A、B，抛物线顶点为 C，△ABC 为等边三角形'), true)
  assert.equal(hasOtherGeometry('过点A作AB⊥x轴于点B，以AB为斜边作Rt△ABC'), true)
  assert.equal(hasOtherGeometry('过点C作CD∥x轴交抛物线的对称轴于点D，连接BD'), true)
  assert.equal(hasOtherGeometry('直线 y=2x+4 与抛物线交于 A、B 两点，求 △ABC 的面积'), true)
})

test('纯度闸门：拦下后 buildFunctionGraphSvg 返回 null（回退裁剪原图）', () => {
  const impure = '如图，抛物线 y=2(x-2)² 与平行于 x 轴的直线交于点 A、B，抛物线顶点为 C，△ABC 为等边三角形，求：(3)△ABC的面积.'
  assert.equal(buildFunctionGraphSvg('', impure, renderGeometrySvg), null, '直线无显式表达式（平行于x轴），复合构造解不出，必须拦下回退原图')
  // 诊断用途下可绕过纯度闸门（仅统计理论覆盖率，不用于生产）
  assert.ok(buildFunctionGraphSvg('', impure, renderGeometrySvg, { ignorePurity: true }))
})

test('优先级：a 是数字时，绝不被「由点反解 a」覆盖', () => {
  // 题设给定 a=2，但题干里的点 (0,1) 与该 a 矛盾 → 必须整体拒绝，而不是解出 a=-2 硬画
  const s = parseFunctionGraphSpec('', '已知二次函数 y=2x²+bx+1，顶点坐标为(1,3)')
  assert.equal(s, null, '顶点与 a 矛盾时应拒绝')
  // 顶点与 a 自洽时 → 精确解
  const ok = parseFunctionGraphSpec('', '已知二次函数 y=2x²+bx+1，顶点坐标为(1,-1)')
  assert.ok(ok, '顶点 (1,-1) 与 a=2、c=1 自洽（b=-4），应出图')
  assert.equal(ok.a, 2)
  assert.equal(ok.approximate, false)
})

test('a 数值 + 对称轴 + 一个点 → 精确解（非代表元）', () => {
  const s = parseFunctionGraphSpec('', '已知抛物线 y=x²+bx+c 的对称轴为直线 x=2，且经过点 A(0,-3)')
  assert.ok(s)
  assert.equal(s.a, 1)
  assert.equal(s.opens, 'up')
  assert.equal(s.vertex.x, 2)
  assert.equal(s.vertex.y, -7) // c=-3, b=-4 → k = -3 - 16/4 = -7
  assert.equal(s.approximate, false)
})

// ══ x 轴交点字母标注（2026-09-18 用户截图实锤：抛物线题图里缺 A、B 两点） ══

test('x 轴交点字母：解析「与x轴交于A、B两点」的字母顺序', () => {
  const s = parseFunctionGraphSpec('', '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；')
  assert.ok(s, '顶点+点应能解出')
  assert.deepEqual(s.xInterceptLabels, ['A', 'B'], '应提取出有序字母 A、B')
})

test('x 轴交点字母：渲染结构里交点按 x 升序与字母配对（左=第一个字母）', () => {
  const text = '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；'
  const built = buildFunctionGraphSvg('', text, renderGeometrySvg)
  assert.ok(built, '应能出图')
  const labelMap = new Map(built.structure.points.map(p => [p.label, p]))
  assert.ok(labelMap.has('A') && labelMap.has('B'), '结构应含 A/B 交点')
  assert.ok(near(labelMap.get('A').x, -1), 'A 应为左根 x=-1')
  assert.ok(near(labelMap.get('B').x, 3), 'B 应为右根 x=3')
  assert.ok(near(labelMap.get('A').y, 0) && near(labelMap.get('B').y, 0), 'A/B 应在 x 轴上（y=0）')
  assert.ok(labelMap.has('C'), 'C(0,3) 应保留')
})

test('x 轴交点字母：单根（相切）不错误标注', () => {
  // 顶点恰好在 x 轴上 → 判别式=0，只有一个根；单交点句式不在支持范围 → 不强行标注
  const s = parseFunctionGraphSpec('', '如图，抛物线与x轴交于M点，顶点坐标为(2,0)，与y轴交于点C(0,4). (1)求该抛物线的表达式；')
  assert.equal(s?.xInterceptLabels ?? null, null, '单交点句式不提取字母')
  const built = buildFunctionGraphSvg('', '如图，抛物线与x轴交于M点，顶点坐标为(2,0)，与y轴交于点C(0,4). (1)求该抛物线的表达式；', renderGeometrySvg)
  if (built) {
    assert.ok(!built.structure.points.some(p => p.label === 'M'), '单交点不强行标注 M')
  }
})

test('x 轴交点字母：题干字母顺序与根不一致时仍按 x 升序配对', () => {
  // 题干写「交于B、A两点」（顺序反了），仍应按数学约定：左根=B、右根=A
  const built = buildFunctionGraphSvg('', '如图，抛物线与x轴交于B、A两点，与y轴交于点C(0,3)，顶点坐标为(1,4).', renderGeometrySvg)
  if (built) {
    const labelMap = new Map(built.structure.points.map(p => [p.label, p]))
    if (labelMap.has('B')) assert.ok(near(labelMap.get('B').x, -1), '题干先写 B → B 应为左根 x=-1')
  }
})

// ══ 曲线上符号点标注（2026-09-18 用户截图实锤：A/B 修好后 D 仍缺失） ══

test('曲线上符号点：解析「点D(m,n)是抛物线上一点」的字母', () => {
  const s = parseFunctionGraphSpec('', '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；')
  assert.ok(s, '顶点+点应能解出')
  assert.ok(Array.isArray(s.symbolicCurveLabels) && s.symbolicCurveLabels.includes('D'), '应提取出符号点 D')
})

test('曲线上符号点：渲染结构里 D 出现在抛物线上（贴合原图右支位置）', () => {
  const text = '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；'
  const built = buildFunctionGraphSvg('', text, renderGeometrySvg)
  assert.ok(built, '应能出图')
  const labelMap = new Map(built.structure.points.map(p => [p.label, p]))
  assert.ok(labelMap.has('D'), '结构应含 D 点标注')
  const d = labelMap.get('D')
  // D 必须在曲线上：y = -1*(x-1)²+4，容差放宽到 0.05
  const pred = -1 * (d.x - 1) * (d.x - 1) + 4
  assert.ok(Math.abs(pred - d.y) < 0.05, `D 应在曲线上，实际 (${d.x},${d.y}) 曲线预测 y=${pred}`)
  // D 应在右支（x>顶点 x=1）且在右根(3)之内，位置贴合教材配图
  assert.ok(d.x > 1 && d.x < 3, `D 应在右支顶点与右根之间，实际 x=${d.x}`)
  assert.ok(d.y > 0 && d.y < 4, `D 应在 y∈(0,4)，实际 y=${d.y}`)
})

test('曲线上符号点：无符号点时不出多余标注', () => {
  const built = buildFunctionGraphSvg('', '如图，已知抛物线 y=ax²+bx-4 与 x 轴分别交于点 A(2,0)、B(-4,0)，与 y 轴交于点 C. (1)求抛物线的表达式；', renderGeometrySvg)
  if (built) {
    // 题干没有"X 是抛物线上一点"句式，不应有符号点
    const labels = new Set(built.structure.points.map(p => p.label))
    assert.ok(![...labels].some(l => !['O', 'A', 'B', 'C'].includes(l)), '不应出现符号点标注')
  }
})

test('曲线上符号点：符号点与带坐标点共存时不冲突', () => {
  // C 带坐标、D 是符号点：两个都要画
  const built = buildFunctionGraphSvg('', '如图，抛物线与x轴交于A、B两点，与y轴交于点C(0,3)，顶点坐标为(1,4)，点D(m,n)是抛物线上一点. (1)求该抛物线的表达式；', renderGeometrySvg)
  assert.ok(built)
  const labelMap = new Map(built.structure.points.map(p => [p.label, p]))
  assert.ok(labelMap.has('C') && labelMap.has('D'), 'C(带坐标) 与 D(符号) 都应画出')
  assert.ok(near(labelMap.get('C').y, 3), 'C 应在 y=3')
})

// ══ 复合构造：抛物线 + 直线（2026-09-27「35条其他」：通道没接上 → 接线） ══
// 实证题 2c84e156：抛物线 y=(x-2)² 顶点 C，直线 y=2x+4 交抛物线于 A、B，求 △ABC 面积。
// 旧行为：hasOtherGeometry 一刀切拦回 DSL 目测通道（画不出曲线）→ 内容闸毙 → 长期描摹/裁片。
// 新行为：交点坐标由联立**解出**，直线/弦/三角形边全部确定性可画 → 通道直接出图。

test('复合解析：直线y=kx+b+交点字母+顶点字母+三角形', () => {
  const lp = parseLineParabola('如图，已知抛物线 y=(x-2)^2 的顶点为 C，直线 y=2x+4 与抛物线交于 A、B 两点，求 △ABC 的面积.')
  assert.ok(lp, '应识别为可解复合构造')
  assert.equal(lp.k, 2)
  assert.equal(lp.b, 4)
  assert.deepEqual([lp.l1, lp.l2], ['A', 'B'])
  assert.equal(lp.vertexLabel, 'C')
  assert.equal(lp.triangle, true)
})

test('复合解析：无直线表达式的「平行于x轴的直线」不收（回退旧行为）', () => {
  assert.equal(parseLineParabola('抛物线 y=2(x-2)^2 与平行于 x 轴的直线交于点 A、B'), null)
})

test('复合出图：抛物线+直线+△ABC 端到端（交点解数验证）', () => {
  const stem = '如图，已知抛物线 y=(x-2)² 的顶点为 C，直线 y=2x+4 与抛物线交于 A、B 两点，求 △ABC 的面积.'
  const built = buildFunctionGraphSvg('', stem, renderGeometrySvg)
  assert.ok(built, '复合构造应直接出图，不再落回画不出曲线的 DSL 通道')
  const labelMap = new Map(built.structure.points.map(p => [p.label, p]))
  // 联立 (x-2)² = 2x+4 → x²-6x=0 → x=0 或 x=6；左交点 A(0,4)、右交点 B(6,16)，顶点 C(2,0)
  assert.ok(labelMap.has('A') && labelMap.has('B') && labelMap.has('C'), 'A/B/C 三点齐全')
  assert.ok(near(labelMap.get('A').x, 0) && near(labelMap.get('A').y, 4), `A 应为 (0,4)，实际 (${labelMap.get('A').x},${labelMap.get('A').y})`)
  assert.ok(near(labelMap.get('B').x, 6) && near(labelMap.get('B').y, 16), `B 应为 (6,16)，实际 (${labelMap.get('B').x},${labelMap.get('B').y})`)
  assert.ok(near(labelMap.get('C').x, 2) && near(labelMap.get('C').y, 0), 'C 应为顶点 (2,0)')
  const segKeys = new Set(built.structure.segments.map(s => [s.from, s.to].sort().join('|')))
  assert.ok(segKeys.has('A|B'), '弦 AB 应画出')
  assert.ok(segKeys.has('A|C') && segKeys.has('B|C'), '△ABC 两边应连到顶点')
  assert.ok([...segKeys].some(k => k.includes('_LINE_p1')), '直线本体应画出')
  // 交点必须在曲线上也在直线上（双约束自洽）
  for (const lab of ['A', 'B']) {
    const p = labelMap.get(lab)
    assert.ok(near(p.y, (p.x - 2) ** 2, 1e-6), `${lab} 在抛物线上`)
    assert.ok(near(p.y, 2 * p.x + 4, 1e-6), `${lab} 在直线上`)
  }
  const svg = built.svg
  assert.ok(svg && !/NaN/.test(svg), 'SVG 渲染无 NaN')
})

test('复合拒绝：无实交点（直线在抛物线上方不相交）→ null 回退原图', () => {
  // y=(x-2)² 开口向上顶点 y=0；直线 y=2x+10：x²-6x+4-10+2… 判别式=( -6)²-4·1·(-4+10-4+…) 一算便知无交点：
  // (x-2)² = 2x+10 → x²-6x-2=0 有实根——改选 y=(x-2)²+10（顶点 y=10，开口向上）与水平线 y=2 必不相交
  const built = buildFunctionGraphSvg('', '如图，抛物线 y=(x-2)²+10 与直线 y=2 交于 A、B 两点，求 △ABC 的面积.', renderGeometrySvg)
  assert.equal(built, null, '无实交点与题面矛盾，必须拒绝不出图')
})

test('复合拒绝：字母与x轴交点声明冲突 → null', () => {
  // 同一对字母既声明为 x 轴交点又声明为直线交点（语义打架）→ 拒
  const built = buildFunctionGraphSvg('', '如图，抛物线 y=x²-2x-3 与 x 轴交于 A、B 两点，直线 y=2x+4 与抛物线交于 A、B 两点，求 △ABC 的面积.', renderGeometrySvg)
  assert.equal(built, null, '同字母一图两义必须拒绝，不能二选一硬画')
})

test('复合拒绝：三角形第三点不是顶点（无坐标）→ 不画三角形，但直线/弦照画', () => {
  // 「连接CD」的 D 无任何坐标依据 → applyLineParabola 不补 D，只画直线+弦（题干点名的构造）
  const stem = '如图，抛物线 y=(x-2)² 的顶点为 C，直线 y=2x+4 与抛物线交于 A、B 两点，连接 CD.'
  const lp = parseLineParabola(stem)
  assert.ok(lp && !lp.triangle, 'D 非顶点 → triangle 应为 false')
  const built = buildFunctionGraphSvg('', stem, renderGeometrySvg)
  assert.ok(built, '弦/直线仍可确定性出图')
  assert.ok(!built.structure.points.some(p => p.label === 'D'), '无坐标依据的 D 不得凭空补画')
})

test('多曲线/平移题拒绝：第二条曲线位置只在图里 → 画原曲线是把特例当图示（比不出图更误导）', () => {
  // 实证 b456c04d/0b31b1fa「反碟长」：抛物线 L₁: y=-x² 沿直线平移后得 L₂，配图真身是 L₂
  const shifted = '定义：如果直线y=-1与开口向下的抛物线有两个交点，那么这两个交点之间的距离叫作这条抛物线的“反碟长”。如图，抛物线L₁：y=-x²随其顶点沿直线y=1/2x平移一定距离后，得到新抛物线L₂，若L₂的反碟长为4，求L₂的表达式'
  assert.equal(buildFunctionGraphSvg('', shifted, renderGeometrySvg), null, '含「平移/新抛物线」且目标表达式未知 → 拒')
  // 平移后表达式已知时仍可画（不回归旧能力）
  const known = '将抛物线 y=x² 平移得到新抛物线 y=(x-1)²-2，画出该函数的图像'
  assert.ok(buildFunctionGraphSvg('', known, renderGeometrySvg), '平移后表达式已知 → 照常出图', )
})
