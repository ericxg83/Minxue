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
