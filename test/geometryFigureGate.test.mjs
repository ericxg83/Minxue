import test from 'node:test'
import assert from 'node:assert/strict'
import { checkFigureReference, hasFigureReference } from '../server/utils/geometryFigureGate.js'

// 题干取自库内真实数据（question_assets 实测样本），不要改写成合成文本：
// 这道闸门的全部价值就在于能不能顶住真实 OCR 文本的表述差异。

test('题干无任何配图指代时拦下，避免凭空画出幻觉图', () => {
  // 实测这条曾被画出 6 点 6 段的图，题干里根本没有「如图」
  const r = checkFigureReference(
    '在△ABC和△DEF中，如果∠A=45°，AB=12cm，AC=15cm，∠D=45°，DE=16cm，那么DF=______时，△ABC与△DEF相似。'
  )
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no_figure_reference')
})

test('纯文字的相似比例题不出图', () => {
  const r = checkFigureReference(
    '在△ABC中，点D、E分别在边AB、AC上，且DE∥BC，如果DE/BC=2/5，那么AE/EC=______。'
  )
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no_figure_reference')
})

test('数轴题即使写了「如图」也不走几何渲染', () => {
  // 数轴用点线渲染器画出来是一条无意义线段，实测被画成 2 点 1 线
  const r = checkFigureReference(
    '如图，数轴上原点为点O，且OA=6，线段OA上是否存在两个点X和Y，使得在1、2、3、4、5、6中任取一个数字a，总可以找到由O、X、Y、A中某两点为端点的线段长为a？'
  )
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'number_line')
})

test('明确写了「如图」的几何题放行', () => {
  assert.equal(hasFigureReference(
    '（2021·江干区模拟）如图，在△ABC中，BD⊥AC于点D，DE⊥AB于点E，BD·DE=BE·CD。'
  ), true)
  assert.equal(hasFigureReference(
    '（2021·杭州）如图，锐角三角形ABC内接于⊙O，∠BAC的平分线AG交⊙O于点G，交BC边于点F。'
  ), true)
})

test('以「图1」「图2」指代分图的题放行', () => {
  assert.equal(hasFigureReference(
    '在△ABC中，∠ACB=90°，AC=BC，直线MN经过点C，且AD⊥MN于点D，BE⊥MN于点E。(1)当直线MN绕点C旋转到图1的位置时，求证：'
  ), true)
})

test('折叠题与作图题没写「如图」也放行——这类题几乎必然带图', () => {
  assert.equal(hasFigureReference(
    '在边长为5的正方形ABCD中，点E为CD上一点，连接BE，将△BCE沿着BE折叠得到△BC′E。'
  ), true)
  assert.equal(hasFigureReference(
    '作图，(1)过△ABC的顶点C作直线CD，使得CD//AB；(2)作点B到直线CD的垂线，垂足为点E。'
  ), true)
})

test('网格题放行（需要网格背景，属于配图）', () => {
  assert.equal(hasFigureReference('如图，A、B、C是正方形网格的格点，连接AC、BC，则tan∠BAC的值是（）。'), true)
})

test('空题干不出图', () => {
  assert.equal(hasFigureReference(''), false)
  assert.equal(hasFigureReference(null), false)
  assert.equal(hasFigureReference(undefined), false)
})

// ── 函数图象排除（2026-09-18）──────────────────────────────────────────────
// 背景：renderGeometrySvg() 只能输出线段/圆/直角标记，没有曲线能力。
// 实测 74 张待重画资产里 44 张是函数图象题，全部 0 成功——不拦就是持续制造假失败。
// 这类题应走独立的函数图象渲染通道。

test('函数图象题不进几何重画——渲染器没有曲线能力', () => {
  const r = checkFigureReference(
    '如图，抛物线 y=ax²+1(a<0) 与过点 (0,-3) 且平行于 x 轴的直线相交于点 A、B，与 y 轴交于点 C，若∠ACB 为直角，则 a=______．'
  )
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'function_graph')
})

test('二次函数 / 反比例函数 / 一次函数题同样拦下', () => {
  assert.equal(
    checkFigureReference('二次函数 y = a(x + m)² 的大致图像如图所示，其中 a、m 均为常数，那么 a、m 的取值范围为').reason,
    'function_graph'
  )
  assert.equal(
    checkFigureReference('如图，反比例函数 y=k/x 的图象经过点 A(1,2)，求 k 的值').reason,
    'function_graph'
  )
  assert.equal(
    checkFigureReference('如图，一次函数 y=kx+b 的图象与坐标轴交于 A、B 两点').reason,
    'function_graph'
  )
})

test('坐标系里的多边形仍放行——渲染器支持坐标轴，与曲线题区分开', () => {
  assert.equal(
    hasFigureReference('如图，在平面直角坐标系中，△ABC的三个顶点为A(1,2)、B(4,1)、C(3,5)，求△ABC的面积。'),
    true
  )
})

test('函数图象排除优先于「如图」放行——写了如图也不进队列', () => {
  const r = checkFigureReference('如图所示，抛物线 y=x²+bx+c 的顶点为 P')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'function_graph')
})

// ── parent_stem 口径（与 checkQuestionCompleteness 规则1 同源）──────────────
// 多小问大题拆行后「如图」只留在 parent_stem，子题 content 只有「(1)…」。
// 漏判会把该重画的题标成 none。

test('判定必须含 parent_stem：引图词只在公共题干里时不能漏判', () => {
  const stem = '如图，在△ABC中，AB=AC，点D在BC边上，DE⊥AB于点E。'
  assert.equal(checkFigureReference('(1)求证：△ABD≌△ACD；', stem).ok, true)
  assert.equal(checkFigureReference('(1)求证：△ABD≌△ACD；').ok, false, '只看子题正文应判无图')
})

test('判定必须含 parent_stem：排除项在公共题干里时同样生效', () => {
  const stem = '如图，抛物线 y=ax²+1(a≠0)与直线 y=-3x+3 交于点(-1,b).'
  assert.equal(checkFigureReference('(1)求 a、b 的值；', stem).reason, 'function_graph')
})

test('parent_stem 与 content 都为空的题不出图', () => {
  assert.equal(hasFigureReference('', ''), false)
  assert.equal(hasFigureReference(null, null), false)
})
