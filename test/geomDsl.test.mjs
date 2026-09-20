import test from 'node:test'
import assert from 'node:assert/strict'
import { evalExpr } from '../server/utils/geom/dsl/expr.js'
import { parseDsl } from '../server/utils/geom/dsl/parser.js'
import { buildStructureFromDsl } from '../server/utils/geom/dsl/index.js'
import { renderDslToSvg } from '../server/utils/geom/dsl/render.js'
import { renderGeometrySvg } from '../server/utils/geometrySvg.js'
import { validateStructureAgainstContent } from '../server/utils/geometryContentGate.js'
import { correctDslByVision, parseDslReply, buildDslPrompts } from '../server/utils/geom/dsl/reactLoop.js'

// ── 表达式求值 ──
// 角度默认度，与 GeoBuildBench 一致；rad 后缀切弧度。

test('表达式：基本算术与优先级', () => {
  assert.equal(evalExpr('1+2*3'), 7)
  assert.equal(evalExpr('(1+2)*3'), 9)
  assert.equal(evalExpr('-4+10'), 6)
  assert.equal(evalExpr('2^3'), 8)
  assert.equal(evalExpr('10/4'), 2.5)
})

test('表达式：三角函数默认按度，可显式写 ° / deg', () => {
  assert.ok(Math.abs(evalExpr('100*cos(60)') - 50) < 1e-9)
  assert.ok(Math.abs(evalExpr('100*cos(60°)') - 50) < 1e-9)
  assert.ok(Math.abs(evalExpr('100*sin(30deg)') - 50) < 1e-9)
  assert.ok(Math.abs(evalExpr('cos(0)') - 1) < 1e-9)
  assert.ok(Math.abs(evalExpr('cos(90)')) < 1e-9)
})

test('表达式：rad 后缀按弧度（pi/2 rad 就是 90°）', () => {
  assert.ok(Math.abs(evalExpr('cos(pi/2 rad)')) < 1e-9)
  assert.ok(Math.abs(evalExpr('sin(pi/2 rad)') - 1) < 1e-9)
})

test('表达式：常量与函数', () => {
  assert.ok(Math.abs(evalExpr('pi') - Math.PI) < 1e-12)
  assert.ok(Math.abs(evalExpr('sqrt(2)') - Math.SQRT2) < 1e-12)
  assert.equal(evalExpr('abs(-3)'), 3)
  assert.equal(evalExpr('max(2,5)'), 5)
  assert.equal(evalExpr('min(2,5)'), 2)
})

test('表达式：非法输入一律返回 null，绝不猜', () => {
  assert.equal(evalExpr(''), null)
  assert.equal(evalExpr('A'), null)            // 表达式里不认对象名
  assert.equal(evalExpr('1+'), null)
  assert.equal(evalExpr('(1+2'), null)
  assert.equal(evalExpr('1/0'), null)
  assert.equal(evalExpr('cos()'), null)        // 参数个数不对
  assert.equal(evalExpr('cos(1,2)'), null)
  assert.equal(evalExpr('1 $ 2'), null)        // 未识别字符
  assert.equal(evalExpr('1.2.3'), null)
})

// ── 解析器 ──

test('解析：基本命令、注释、空行、代码围栏', () => {
  const { commands, errors } = parseDsl([
    '```dsl',
    '# 这是一条注释',
    '',
    'point : 0 0 -> A',
    'point : 100 0 -> B',
    'segment : A B -> AB',
    '```'
  ].join('\n'))
  assert.equal(errors.length, 0)
  assert.equal(commands.length, 3)
  assert.deepEqual(commands[0], { line: 4, cmd: 'point', inputs: ['0', '0'], outputs: ['A'], raw: 'point : 0 0 -> A' })
  assert.deepEqual(commands[2].outputs, ['AB'])
})

test('解析：中英文冒号与箭头都接受；行号前缀被剥掉', () => {
  const { commands, errors } = parseDsl('1. point：0 0 → A\n2) point : 1 1 -> B')
  assert.equal(errors.length, 0)
  assert.equal(commands.length, 2)
  assert.equal(commands[0].cmd, 'point')
  assert.equal(commands[1].cmd, 'point')
})

test('解析：缺箭头 / 缺冒号 / 缺输出名分别报错', () => {
  assert.equal(parseDsl('point 0 0 A').errors[0].message, 'MISSING_ARROW')
  assert.equal(parseDsl('point 0 0 -> A').errors[0].message, 'MISSING_COLON')
  assert.equal(parseDsl('point : 0 0 ->').errors[0].message, 'MISSING_OUTPUT')
})

test('解析：引号内的空格不切分（label 文字）', () => {
  const { commands, errors } = parseDsl('label : "8 cm" 10 20 -> L')
  assert.equal(errors.length, 0)
  assert.deepEqual(commands[0].inputs, ['"8 cm"', '10', '20'])
})

// ── 执行器 ──

test('执行：极坐标构造等边三角形（坐标由算式算出，不靠目测）', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> O
point : 100*cos(0) 100*sin(0) -> A
point : 100*cos(120) 100*sin(120) -> B
point : 100*cos(240) 100*sin(240) -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const p = Object.fromEntries(r.structure.points.map(x => [x.label, x]))
  assert.ok(Math.abs(p.A.x - 100) < 1e-9 && Math.abs(p.A.y) < 1e-9)
  assert.ok(Math.abs(p.B.x + 50) < 1e-9 && Math.abs(p.B.y - 86.6025403784) < 1e-6)
  assert.ok(Math.abs(p.C.x + 50) < 1e-9 && Math.abs(p.C.y + 86.6025403784) < 1e-6)
  assert.equal(r.structure.segments.length, 3)
})

test('执行：中点 / 垂足 / 交点 / 重心 / 对称像都被算准，并带上 derived 标签', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 0 100 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
midpoint : A B -> M
foot : C AB -> D
centroid : A B C -> G
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const p = Object.fromEntries(r.structure.points.map(x => [x.label, x]))
  assert.ok(Math.abs(p.M.x - 50) < 1e-9 && Math.abs(p.M.y) < 1e-9, 'AB 中点应为 (50,0)')
  assert.ok(Math.abs(p.D.x) < 1e-9 && Math.abs(p.D.y) < 1e-9, 'C 到 AB 的垂足应为 (0,0)')
  assert.ok(Math.abs(p.G.x - 100 / 3) < 1e-9 && Math.abs(p.G.y - 100 / 3) < 1e-9)
  assert.deepEqual(p.M.derived, { midpoint_of: 'AB' })
  assert.deepEqual(p.D.derived, { foot_of: 'C', perpendicular_to: 'AB' })
  assert.deepEqual(p.G.derived, { centroid_of: 'ABC' })
})

test('执行：折叠（mirror）算出精确镜像点，并带 reflect derived', () => {
  // A(0,0) C(100,0) 是水平折痕，B(50,60) 的镜像应为 (50,-60)
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 50 60 -> B
point : 100 0 -> C
segment : A C -> AC
mirror : B AC -> B2
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const p = Object.fromEntries(r.structure.points.map(x => [x.label, x]))
  assert.ok(Math.abs(p.B2.x - 50) < 1e-9 && Math.abs(p.B2.y + 60) < 1e-9)
  assert.deepEqual(p.B2.derived, { reflect_of: 'B', axis: 'AC' })
})

test('执行：直线与圆求交，输出名个数必须等于交点数', () => {
  // 用 line（无界），x=0 与半径 100 的圆交于 (0,±100) 两点
  const ok = buildStructureFromDsl(`
point : 0 0 -> O
point : 0 100 -> P
point : 100 0 -> A
line : O P -> l
circle : O A -> c
intersect : l c -> X Y
`)
  assert.ok(ok.ok, JSON.stringify(ok.errors))
  assert.equal(ok.structure.points.length, 5)

  const bad = buildStructureFromDsl(`
point : 0 0 -> O
point : 0 100 -> P
point : 100 0 -> A
line : O P -> l
circle : O A -> c
intersect : l c -> X
`)
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some(e => e.message === 'OUTPUT_COUNT_MISMATCH'))
})

test('执行：线段与圆求交要做范围过滤（线段不够长就没有交点）', () => {
  // 圆半径 100，线段只有 50 长，够不到圆
  const r = buildStructureFromDsl(`
point : 0 0 -> O
point : 50 0 -> A
circle : O 100 -> c
segment : O A -> s
intersect : s c -> X
`)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.message === 'NO_INTERSECTION'))
})

test('执行：正交/平行/垂直平分线/角平分线都算准方向', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
segment : A B -> AB
orthogonal_line : C AB -> perp
parallel_line : C AB -> para
line_bisector : A B -> bis
angular_bisector : A B C -> ang
intersect : perp AB -> F
intersect : para AB -> never
`)
  // para ∥ AB，永不与 AB 相交 → 必须报 NO_INTERSECTION，而不是随便给个点
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.message === 'NO_INTERSECTION'), JSON.stringify(r.errors))
})

test('执行：平行线确实平行、垂线确实垂直', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
segment : A B -> AB
orthogonal_line : C AB -> perp
intersect : perp AB -> F
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const F = r.structure.points.find(p => p.label === 'F')
  assert.ok(Math.abs(F.x - 50) < 1e-9 && Math.abs(F.y) < 1e-9, 'C 到 AB 的垂线应落在 (50,0)')

  // 垂直平分线应过 AB 中点且垂直于 AB；与 AB 交于 (50,0)
  const r2 = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
line_bisector : A B -> bis
segment : A B -> AB
intersect : bis AB -> M
`)
  assert.ok(r2.ok, JSON.stringify(r2.errors))
  const M = r2.structure.points.find(p => p.label === 'M')
  assert.ok(Math.abs(M.x - 50) < 1e-9 && Math.abs(M.y) < 1e-9, '垂直平分线应过 AB 中点')

  // 角平分线：等腰三角形顶点处的平分线应竖直，与底边交于中点
  const r3 = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
segment : A B -> AB
angular_bisector : A C B -> ang
intersect : ang AB -> T
`)
  assert.ok(r3.ok, JSON.stringify(r3.errors))
  const T = r3.structure.points.find(p => p.label === 'T')
  assert.ok(Math.abs(T.x - 50) < 1e-9 && Math.abs(T.y) < 1e-9, '∠ACB 的平分线应交 AB 于中点')
})

test('执行：外接圆/内切圆圆心与半径正确', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 0 100 -> C
circumcircle : A B C -> oc
circumcenter : A B C -> O
incircle : A B C -> ic
incenter : A B C -> I
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const O = r.structure.points.find(p => p.label === 'O')
  // 直角三角形外心 = 斜边中点 = (50,50)
  assert.ok(Math.abs(O.x - 50) < 1e-9 && Math.abs(O.y - 50) < 1e-9)
  const oc = r.structure.circles.find(c => c.label === 'oc')
  assert.ok(Math.abs(oc.r - Math.sqrt(5000)) < 1e-6)
  const I = r.structure.points.find(p => p.label === 'I')
  // 直角三角形内心到两直角边距离相等 = r = (a+b-c)/2 = (100+100-141.42)/2 = 29.29
  assert.ok(Math.abs(I.x - 29.2893218813) < 1e-6 && Math.abs(I.y - 29.2893218813) < 1e-6)
})

test('执行：多边形自动登记边界线段（阴影用）', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
shade : A B C -> sh
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.equal(r.structure.polygons.length, 1)
  assert.equal(r.structure.polygons[0].fill, true)
  assert.deepEqual(r.structure.polygons[0].points, ['A', 'B', 'C'])
  assert.equal(r.structure.segments.length, 3, '三条边应被自动登记')
})

test('执行：直角标记 / 角标记 / 文字标注', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 0 100 -> C
segment : A B -> AB
segment : A C -> AC
right_angle : B A C -> r1
angle_mark : B A C -> a1
label : "α" 50 -10 -> L1
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.equal(r.structure.rightAngles.length, 1)
  assert.deepEqual(r.structure.rightAngles[0], { vertex: 'A', from: 'B', to: 'C' })
  assert.equal(r.structure.angleMarks.length, 1)
  assert.equal(r.structure.labels.length, 1)
  assert.equal(r.structure.labels[0].text, 'α')
})

test('执行：数字/长度/角度类文字标注会被下游安全过滤丢掉（防手写答案伪装成题设）', () => {
  // isSymbolLabel 的既定纪律：学生把算出的答案写在图旁，模型会抄成 labels，
  // 重绘成整齐字体后答案就伪装成了题设。所以数字型 label 必须被剔除。
  // 这条测试锁的是"DSL 不能绕过该纪律"——label 命令只对符号型文字（α/β/l）有效。
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
segment : A B -> AB
label : "8cm" 50 -10 -> L1
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.equal(r.structure.labels.length, 0, '数字型标注应被过滤掉')
})

test('执行：圆弧', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> O
point : 100 0 -> A
point : 0 100 -> B
arc : O A B -> arc1
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.deepEqual(r.structure.arcs[0], { center: 'O', from: 'A', to: 'B', style: 'solid', arrow: false })
})

// ── 错误必须报准，且绝不产出半成品 ──

test('执行：引用未定义对象 / 未知命令 / 重复定义 / 参数个数不符，各自报对错误', () => {
  const cases = [
    ['point : 0 0 -> A\nsegment : A Z -> s', 'UNDEFINED_ELEMENT:Z'],
    ['frobnicate : A B -> c', 'UNKNOWN_COMMAND:frobnicate'],
    ['point : 0 0 -> A\npoint : 1 1 -> A', 'DUPLICATE_LABEL:A'],
    ['midpoint : A -> M', 'ARG_COUNT_MISMATCH']
  ]
  for (const [dsl, expect] of cases) {
    const r = buildStructureFromDsl(dsl)
    assert.equal(r.ok, false, `应失败: ${dsl}`)
    assert.ok(r.errors.some(e => e.message === expect),
      `期望错误 ${expect}，实际 ${JSON.stringify(r.errors.map(e => e.message))}`)
    assert.equal(r.structure, null, '有错误时绝不能产出结构')
  }
})

test('执行：参数类型不符要报错并给出用法', () => {
  const r = buildStructureFromDsl('point : 0 0 -> A\nmidpoint : A 50 -> M')
  assert.equal(r.ok, false)
  const e = r.errors.find(x => x.message.startsWith('ARG_TYPE_MISMATCH'))
  assert.ok(e, JSON.stringify(r.errors))
  assert.ok(e.hint.includes('midpoint'), '应带上该命令的用法')
})

test('执行：平行线求交不唯一，判为无交点而不是随便给一个', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 0 50 -> C
point : 100 50 -> D
line : A B -> l1
line : C D -> l2
intersect : l1 l2 -> X
`)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.message === 'NO_INTERSECTION'))
})

// ── 与既有下游的衔接 ──

test('衔接：DSL 产出的结构能直接被渲染器画出来', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
midpoint : A B -> M
segment : C M -> CM
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const svg = renderDslToSvg(r.structure)
  assert.ok(svg && svg.startsWith('<svg'), '应渲染出 SVG')
  assert.ok(svg.includes('>A<') && svg.includes('>M<'), '顶点字母应出现在 SVG 里')
})

test('衔接：DSL 产出的结构能过内容闸门（结构与题干引用一致）', () => {
  const content = '如图，在△ABC中，D是边AB的中点，连接CD。'
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
midpoint : A B -> D
segment : C D -> CD
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const v = validateStructureAgainstContent(r.structure, content)
  assert.ok(v.ok, `内容闸门应放行，实际: ${JSON.stringify(v)}`)
})

test('衔接：DSL 多画了题干没有的点时，内容闸门要拦下来', () => {
  const content = '如图，在△ABC中，D是边AB的中点，连接CD。'
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
point : 10 10 -> X
segment : A B -> AB
segment : B C -> BC
segment : C A -> CA
midpoint : A B -> D
segment : C D -> CD
segment : A X -> AX
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const v = validateStructureAgainstContent(r.structure, content)
  assert.equal(v.ok, false, '多画了题干没有的点 X，应被内容闸门拦下')
})

test('衔接：normalizeStructure 保留 derived 标签（求解器/判据要用）', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
midpoint : A B -> M
`)
  assert.ok(r.ok)
  const M = r.structure.points.find(p => p.label === 'M')
  assert.deepEqual(M.derived, { midpoint_of: 'AB' })
})

// ── 方向别名：无向对象两种写法要能互相解析 ──

test('别名：segment : C A -> CA 定义后，引用 AC 也能解析（无向对象）', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
segment : C A -> CA
mirror : B AC -> B2
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const p = Object.fromEntries(r.structure.points.map(x => [x.label, x]))
  // 反射保距：B2 到轴上任意一点（A、C）的距离必须等于 B 到该点的距离
  const dA = Math.hypot(p.B2.x - 0, p.B2.y - 0)
  const dB = Math.hypot(p.B.x - 0, p.B.y - 0)
  assert.ok(Math.abs(dA - dB) < 1e-6, '|B2A| 应等于 |BA|')
  const dC = Math.hypot(p.B2.x - 50, p.B2.y - 80)
  const dCC = Math.hypot(p.B.x - 50, p.B.y - 80)
  assert.ok(Math.abs(dC - dCC) < 1e-6, '|B2C| 应等于 |BC|')
})

test('别名：反向定义不算重复定义，且不会画出两条重复的线段', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
segment : A B -> AB
segment : B A -> BA
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.equal(r.structure.segments.length, 1, '同一线段两种写法应合并为一条')
})

test('别名：多边形自动边可以被引用（polygon 之后不必再显式写边）', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
polygon : A B C -> tri
  `)
  assert.ok(r.ok, JSON.stringify(r.errors))
  // 多边形自动边的 label 形如 s_AB，同时登记反向别名 BA
  const r2 = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 50 80 -> C
polygon : A B C -> tri
orthogonal_line : A BC -> perp
segment : A C -> AC
segment : A B -> AB
midpoint : A B -> M
`)
  assert.ok(r2.ok, JSON.stringify(r2.errors))
})

// ── 撇号归一化：A' 与 A′ 必须视为同一个点 ──

test('撇号：ASCII 撇与排版撇是同一个 label', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 50 60 -> B
point : 100 0 -> C
segment : C A -> CA
mirror : B CA -> B'
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const labels = r.structure.points.map(p => p.label)
  assert.ok(labels.includes('B′'), 'ASCII 撇应被归一化成 B′')
  assert.equal(labels.filter(l => l.includes('′')).length, 1, '不能产生 B′ 和 B\' 两个点')
})

// ── ReAct 闭环（纯函数部分，不调视觉） ──

test('parseDslReply：VERDICT + DSL 代码块都被抽出来', () => {
  const r = parseDslReply('VERDICT: FIX\n```dsl\npoint : 0 0 -> A\n```\n')
  assert.equal(r.verdict, 'FIX')
  assert.equal(r.dsl, 'point : 0 0 -> A')
})

test('parseDslReply：没写 VERDICT 但有 DSL → 宽容按 FIX 处理', () => {
  const r = parseDslReply('抱歉改一下：\n```dsl\npoint : 1 1 -> X\n```')
  assert.equal(r.verdict, 'FIX')
  assert.equal(r.dsl, 'point : 1 1 -> X')
})

test('parseDslReply：只有 VERDICT OK、没有 DSL 也可解析', () => {
  const r = parseDslReply('VERDICT: OK')
  assert.equal(r.verdict, 'OK')
  assert.equal(r.dsl, null)
})

test('correctDslByVision：从空 DSL 生成 → 模型修一版 → 确认通过（两轮闭环）', async () => {
  let calls = 0
  const callVision = async ({ systemPrompt, userText, imageDataURL }) => {
    calls++
    assert.ok(systemPrompt.includes('可用命令'), 'system prompt 应包含命令参考')
    if (calls === 1) {
      assert.ok(userText.includes('从零生成'), '第一轮应要求生成 DSL')
      return 'VERDICT: FIX\n```dsl\npoint : 0 0 -> A\npoint : 100 0 -> B\nmidpoint : A B -> M\n```'
    }
    assert.ok(userText.includes('上一版 DSL'), '第二轮应要求核对')
    return 'VERDICT: OK'
  }
  const r = await correctDslByVision({
    content: '如图，AB=10，M是AB的中点。',
    dsl: null,
    originalImageDataUrl: null,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.ok, true, JSON.stringify(r.history))
  assert.equal(r.rounds, 2)
  assert.equal(calls, 2)
  const M = r.structure.points.find(p => p.label === 'M')
  assert.ok(Math.abs(M.x - 50) < 1e-9, '中点应被算准')
})

test('correctDslByVision：模型重复给同一版 DSL → 判卡住终止（不无限循环）', async () => {
  const callVision = async () => 'VERDICT: FIX\n```dsl\npoint : 0 0 -> A\n```'
  const r = await correctDslByVision({
    content: '如图。',
    dsl: 'point : 0 0 -> A',
    callVision,
    maxRounds: 5
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'dsl_unchanged')
  assert.ok(r.rounds <= 4, '必须在第 3 轮就卡住终止，不能跑满 5 轮')
})

test('correctDslByVision：VERDICT OK 但 DSL 执行不通 → 不信，判失败', async () => {
  const callVision = async () => 'VERDICT: OK'
  const r = await correctDslByVision({
    content: '如图。',
    dsl: 'point : 0 0 -> A\nsegment : A Z -> s',
    callVision,
    maxRounds: 2
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'verdict_ok_without_dsl')
})

test('correctDslByVision：生成轮模型自报 OK 不可信，必须过一遍目检轮', async () => {
  // 第 1 轮（生成）：模型给了 DSL 并附 VERDICT: OK —— 不许当场信，
  // 必须渲染出来给它看（第 2 轮）再确认。
  const callVision = async ({ userText }) => {
    if (userText.includes('从零生成')) {
      return '```dsl\npoint : 0 0 -> A\npoint : 100 0 -> B\nmidpoint : A B -> M\n```\n\nVERDICT: OK'
    }
    return 'VERDICT: OK'
  }
  const r = await correctDslByVision({
    content: '如图，M是AB的中点。',
    dsl: null,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.ok, true, JSON.stringify(r.history))
  assert.equal(r.rounds, 2, '生成轮自报 OK 后仍应进入目检轮')
})

// ── M4 补充用例（几何DSL构造命令规范 §12） ──

test('执行：circle 半径为零/负 → BAD_RADIUS', () => {
  const r = buildStructureFromDsl(`
point : 10 10 -> O
circle : O 0 -> c
`)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.message === 'BAD_RADIUS'), JSON.stringify(r.errors))
})

test('容错：合并成一条命令的多个元素自动拆分（point/segment 一行定义多个）', () => {
  // 模型常把两条命令合并：point : 0 0 100 100 -> X Y 语义确定 = 两个点，应等价于两行
  const r = buildStructureFromDsl(`
point : 0 0 100 100 -> X Y
point : 50 80 -> C
segment : X C Y C -> s1 s2
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const pts = Object.fromEntries(r.structure.points.map(p => [p.label, p]))
  assert.ok(Math.abs(pts.X.x - 0) < 1e-9 && Math.abs(pts.Y.x - 100) < 1e-9, 'X/Y 应分别按组计算坐标')
  assert.equal(r.structure.segments.length, 2, '两条 segment 应分别注册')
})

test('容错：输入个数不是整数倍时合并写法不拆分、照常报错', () => {
  const r = buildStructureFromDsl(`
point : 0 0 100 -> A B
`)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.message.startsWith('ARG_COUNT_MISMATCH')), JSON.stringify(r.errors))
})

test('执行：圆×圆相离 → NO_INTERSECTION（不相交就是不相交）', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 300 0 -> B
circle : A 100 -> c1
circle : B 100 -> c2
intersect : c1 c2 -> X
`)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.message === 'NO_INTERSECTION'), JSON.stringify(r.errors))
})

test('撇号：镜像构造的带撇点可被后续命令正常引用（跨命令归一化）', () => {
  const r = buildStructureFromDsl(`
point : 0 0 -> A
point : 50 60 -> B
point : 100 0 -> C
segment : C A -> CA
mirror : B CA -> B'
segment : C B' -> CB2
`)
  assert.ok(r.ok, JSON.stringify(r.errors))
  const labels = r.structure.points.map(p => p.label)
  assert.ok(labels.includes('B′'), 'ASCII 撇应归一化成 B′')
  assert.equal(r.structure.segments.length, 2)
  // 用 ASCII 撇与排版撇引用同一对象：两种写法都应解析成功
  const r2 = buildStructureFromDsl(`
point : 0 0 -> A
point : 50 60 -> B
point : 100 0 -> C
segment : C A -> CA
mirror : B CA -> B′
segment : C B' -> CB2
`)
  assert.ok(r2.ok, JSON.stringify(r2.errors))
})

test('label：isSymbolLabel 规则回归——α 放行，∠α / 数字 / 角度过滤', () => {
  const ok = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
point : 0 100 -> C
label : "α" 50 -10 -> L1
label : "l" 60 20 -> L2
`)
  assert.ok(ok.ok, JSON.stringify(ok.errors))
  assert.equal(ok.structure.labels.length, 2, '符号型文字应放行')

  const filtered = buildStructureFromDsl(`
point : 0 0 -> A
point : 100 0 -> B
label : "∠α" 50 -10 -> L1
label : "3cm" 40 10 -> L2
label : "60°" 30 5 -> L3
`)
  assert.ok(filtered.ok, JSON.stringify(filtered.errors))
  assert.equal(filtered.structure.labels.length, 0,
    '非字母开头 / 数字 / 角度文字应被 isSymbolLabel 全部过滤（防手写答案伪装题设）')
})

test('闭环：第 1 轮坏 DSL → 第 2 轮修正 → 第 3 轮确认 OK（多轮收敛过闸门）', async () => {
  let calls = 0
  const callVision = async () => {
    calls++
    if (calls === 1) {
      // 生成轮：给了引用未定义的坏 DSL + VERDICT FIX（模型自己也不确定）
      return 'VERDICT: FIX\n```dsl\npoint : 0 0 -> A\nsegment : A Z -> s\n```'
    }
    if (calls === 2) {
      // 核对轮：修正为完整三角形
      return '```dsl\npoint : 0 0 -> A\npoint : 100 0 -> B\npoint : 50 80 -> C\nsegment : A B -> AB\nsegment : B C -> BC\nsegment : C A -> CA\n```\n\nVERDICT: FIX'
    }
    // 第 3 轮：看过渲染图后确认一致
    return 'VERDICT: OK'
  }
  const content = '如图，在△ABC中。'
  const r = await correctDslByVision({
    content,
    dsl: null,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.ok, true, JSON.stringify(r.history.map(h => ({ round: h.round, verdict: h.verdict, note: h.note }))))
  assert.equal(r.rounds, 3, '坏 DSL → 修正 → OK 应用满 3 轮')
  assert.equal(calls, 3)
  // 收敛后的结构必须能过内容闸门（多轮收敛 ≠ 多轮乱画）
  const v = validateStructureAgainstContent(r.structure, content)
  assert.ok(v.ok, `收敛结构应过内容闸门: ${JSON.stringify(v)}`)
})

// ── 弱 OK 降级（2026-09-19 用户拍板：dsl_unchanged/轮数用尽 + 执行合法 + 过内容闸门 → 判成功） ──

test('弱OK：模型卡住但执行合法且过内容闸门 → 降级成功（weak_ok）', async () => {
  const TRI = 'point : 0 0 -> A\npoint : 100 0 -> B\npoint : 50 80 -> C\nsegment : A B -> AB\nsegment : B C -> BC\nsegment : C A -> CA\n'
  // 模型看过渲染图后仍重复同一版（认为自己已最优，但不敢说 OK）→ 卡住
  const callVision = async () => `VERDICT: FIX\n\`\`\`dsl\n${TRI}\`\`\``
  const r = await correctDslByVision({
    content: '如图，在△ABC中。',
    dsl: TRI,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.ok, true, '执行合法+过闸门应弱 OK 降级成功')
  assert.equal(r.weakOk, true)
  assert.equal(r.reason, 'weak_ok')
  assert.equal(r.structure.points.length, 3)
})

test('弱OK：执行不合法（引用未定义）→ 不降级，仍按 dsl_unchanged 失败', async () => {
  const BAD = 'point : 0 0 -> A\nsegment : A Z -> s'
  const callVision = async () => `VERDICT: FIX\n\`\`\`dsl\n${BAD}\`\`\``
  const r = await correctDslByVision({
    content: '如图，在△ABC中。',
    dsl: BAD,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.ok, false, '执行不合法不允许弱 OK')
  assert.equal(r.reason, 'dsl_unchanged')
})

test('弱OK：执行合法但多画题干没有的点（不过内容闸门）→ 不降级', async () => {
  const BAD = 'point : 0 0 -> A\npoint : 100 0 -> B\npoint : 50 80 -> C\npoint : 10 10 -> X\nsegment : A B -> AB\nsegment : C X -> CX\n'
  const callVision = async () => `VERDICT: FIX\n\`\`\`dsl\n${BAD}\`\`\``
  const r = await correctDslByVision({
    content: '如图，在△ABC中。',
    dsl: BAD,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.ok, false, '多画 X 过不了内容闸门，不允许弱 OK')
  assert.equal(r.reason, 'dsl_unchanged')
})

test('弱OK：轮数用尽但最后一版执行合法且过闸门 → weak_ok', async () => {
  // 模型每轮都换微小的新 DSL（避开 dsl_unchanged）但从不给 OK → 跑满 3 轮
  let n = 0
  const callVision = async () => {
    n++
    return `VERDICT: FIX\n\`\`\`dsl\npoint : ${n} 0 -> A\npoint : 100 0 -> B\npoint : 50 80 -> C\nsegment : A B -> AB\nsegment : B C -> BC\nsegment : C A -> CA\n\`\`\``
  }
  const r = await correctDslByVision({
    content: '如图，在△ABC中。',
    dsl: null,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.reason, 'weak_ok', `应弱 OK 而不是 max_rounds: ${r.reason}`)
  assert.equal(r.ok, true)
  assert.equal(r.weakOk, true)
})

test('弱OK：空结构（pts=0 segs=0）不得弱 OK——宁可失败回退原图', async () => {
  // gemini 批次发现：模型给了一个「渲染不出的空结构」且重复同版 → 弱 OK 若放行=白画
  const EMPTY = '# 只有注释，没有任何构造'
  const callVision = async () => `VERDICT: FIX\n\`\`\`dsl\n${EMPTY}\`\`\``
  const r = await correctDslByVision({
    content: '如图，在△ABC中。',
    dsl: EMPTY,
    callVision,
    maxRounds: 3
  })
  assert.equal(r.ok, false, '空结构不允许弱 OK')
  assert.equal(r.reason, 'dsl_unchanged')
})
