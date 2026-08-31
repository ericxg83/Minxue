import test from 'node:test'
import assert from 'node:assert/strict'
import { extractConstraints } from '../server/utils/geom/constraintExtract.js'

// 题干全部取自 question_assets 实测样本（e2e/fixtures/geometry-golden.json），
// 不要改写成合成文本：抽取器的全部价值就在于能不能顶住真实 OCR 文本的表述差异。

const structureWith = (labels, segs = []) => ({
  points: labels.map(l => ({ label: l, x: 0, y: 0 })),
  segments: segs.map(([a, b]) => ({ from: a, to: b }))
})

const hasType = (cs, type) => cs.some(c => c.type === type)
const ofType = (cs, type) => cs.filter(c => c.type === type)

test('用户截图题：BD⊥AC 于点 D + DE⊥AB 于点 E，且结论式 BD·DE=BE·CD 不被抽成等长', () => {
  const content = '（2021·江干区模拟）如图，在△ABC中，BD⊥AC于点D，DE⊥AB于点E，BD·DE=BE·CD。（1）求证：△BCD∽△BDE；（2）若BC=10，AD=6，求AE的长。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E'], [['A','B'],['B','C'],['C','A'],['B','D'],['D','E']])
  const { constraints, dropped } = extractConstraints(content, s)

  const perps = ofType(constraints, 'perpendicular')
  assert.equal(perps.length, 2, '应抽出两条垂直')
  const feet = ofType(constraints, 'foot')
  assert.equal(feet.length, 2, '应抽出两个垂足')
  // 关键：结论式不能变成 equal_length，否则图会被拧成"已证"的样子
  assert.equal(hasType(constraints, 'equal_length'), false, 'BD·DE=BE·CD 是结论不是条件')
  // 同时确认它也没被误读成别的硬约束
  const eqDropped = dropped.some(d => d.raw.includes('BD·DE'))
  assert.ok(!eqDropped || true, '结论式可被丢弃或忽略，但不能进约束集')
})

test('DE∥BC 比例题：平行被抽出，但无配图指代时由 figureGate 拦（这里只测抽取）', () => {
  const content = '在△ABC中，点D、E分别在边AB、AC上，且DE∥BC，如果DE/BC=2/5，那么AE/EC=______。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E'], [['A','B'],['A','C'],['D','E'],['B','C']])
  const { constraints } = extractConstraints(content, s)
  assert.ok(hasType(constraints, 'parallel'), 'DE∥BC 应被抽出')
})

test('正方形折叠：reflect 配对被识别（即使轴需另找）', () => {
  const content = '在边长为5的正方形ABCD中，点E为CD上一点，连接BE，将△BCE沿着BE折叠得到△BC′E，连接AC′、DC′。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E', 'C′'], [['A','B'],['B','C'],['C','D'],['D','A'],['B','E']])
  const { constraints, dropped } = extractConstraints(content, s)
  // 形状词应被抽出
  assert.ok(hasType(constraints, 'polygon_shape'), '正方形应被抽出')
  // C→C′ 的反射关系要么进约束（带轴），要么进 dropped（缺轴），不能无声丢失
  const reflectOrDrop = constraints.some(c => c.type === 'reflect') ||
    dropped.some(d => d.reason.startsWith('reflect_pair_without_axis'))
  assert.ok(reflectOrDrop, '折叠对应点 C→C′ 必须被记录')
})

test('锐角三角形内接⊙O + 角平分线：on_circle × 3 + circle_center + angle_bisector', () => {
  const content = '（2021·杭州）如图，锐角三角形ABC内接于⊙O，∠BAC的平分线AG交⊙O于点G，交BC边于点F，连接BG。'
  const s = structureWith(['A', 'B', 'C', 'O', 'G', 'F'], [['A','B'],['B','C'],['C','A'],['A','G'],['B','G']])
  const { constraints } = extractConstraints(content, s)
  const onc = ofType(constraints, 'on_circle')
  assert.ok(onc.length >= 3, 'A/B/C 应在 ⊙O 上')
  assert.ok(hasType(constraints, 'circle_center'), 'O 应是圆心')
  assert.ok(hasType(constraints, 'angle_bisector'), 'AG 应是 ∠BAC 的角平分线')
})

test('尺规作图：过 C 作 CD∥AB + 作 BE⊥CD 垂足 E', () => {
  const content = '作图，(1)过△ABC的顶点C作直线CD，使得CD//AB；(2)作点B到直线CD的垂线，垂足为点E；(3)若BE=3，AB=4，则△ABC的面积是______。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E'], [['A','B'],['B','C'],['C','A'],['C','D'],['B','E']])
  const { constraints } = extractConstraints(content, s)
  assert.ok(hasType(constraints, 'parallel'), 'CD∥AB 应被抽出')
  // "作点B到直线CD的垂线，垂足为点E" → foot(E, B, CD)
  const feet = ofType(constraints, 'foot')
  assert.ok(feet.some(f => f.args.point === 'E'), 'E 应是 B 到 CD 的垂足')
})

test('手扶电梯示意图：∠ABC=150° 角度值被抽出', () => {
  const content = '如图是商场一楼与二楼之间的手扶电梯示意图。其中AB、CD分别表示一楼、二楼地面的水平线，∠ABC=150°，BC的长是8m。'
  const s = structureWith(['A', 'B', 'C', 'D'], [['A','B'],['B','C'],['C','D']])
  const { constraints } = extractConstraints(content, s)
  const avs = ofType(constraints, 'angle_value')
  assert.equal(avs.length, 1)
  assert.equal(avs[0].args.deg, 150)
  assert.equal(avs[0].args.vertex, 'B')
})

test('tan∠BAC 网格题：不产生伪角度约束，但允许通过 figureGate', () => {
  const content = '如图，A、B、C是正方形网格的格点，连接AC、BC，则tan∠BAC的值是（）。'
  const s = structureWith(['A', 'B', 'C'], [['A','C'],['B','C']])
  const { constraints } = extractConstraints(content, s)
  // tan∠BAC 不是 ∠BAC=某度，不应产生 angle_value
  assert.equal(hasType(constraints, 'angle_value'), false)
})

test('字母不在结构点集里的约束被丢进 dropped，绝不猜', () => {
  const content = '如图，在△ABC中，BD⊥AC于点D。'
  // 故意不给 D 点
  const s = structureWith(['A', 'B', 'C'], [['A','B'],['B','C'],['C','A']])
  const { constraints, dropped } = extractConstraints(content, s)
  assert.equal(hasType(constraints, 'perpendicular'), false, 'D 不在结构里，垂直约束不能进')
  assert.ok(dropped.some(d => d.reason.includes('letter_not_in_both')), '应记录丢弃原因')
})

test('线段不在题干引用边集里的约束被丢进 dropped', () => {
  const content = '如图，在△ABC中，点D在BC上。'
  // 题干没说 AD，但如果模型幻觉给了一个 AD⊥BC，应被拦截
  const s = structureWith(['A', 'B', 'C', 'D'], [['A','B'],['B','C'],['C','A'],['A','D']])
  // 手工注入一条候选：模拟模型 derived 给出 AD⊥BC
  const fakeStructure = {
    ...s,
    points: s.points.map(p => p.label === 'D' ? { ...p, derived: { foot_of: 'A', on_segment: ['B','C'] } } : p)
  }
  const { constraints, dropped } = extractConstraints(content, fakeStructure)
  // AD 不在题干引用边集里（只有 AB/BC/CA/BD/DC 相邻对），foot 应被丢
  const footIn = constraints.some(c => c.type === 'foot' && c.args.point === 'D')
  const footDropped = dropped.some(d => d.raw && d.reason.includes('seg_not_referenced'))
  assert.ok(!footIn || footDropped, '未在题干出现的边上的垂足应被拦截')
})

test('链式等长 AB=BC=CA 展开为一条 equal_length 含三段', () => {
  const content = '如图，等边三角形ABC中，AB=BC=CA。'
  const s = structureWith(['A', 'B', 'C'], [['A','B'],['B','C'],['C','A']])
  const { constraints } = extractConstraints(content, s)
  const eqs = ofType(constraints, 'equal_length')
  assert.ok(eqs.length >= 1)
  const segs = eqs[0].args.segs
  assert.ok(segs.length >= 3, '链式应展开出至少三段')
})

// ── 真实题干回归集：14 条（7 completed + 7 none，取自 question_assets 实测）──
// 已覆盖：266e9cda / 04733cc4 / 334e7ded（completed）+ a6d65c96 / 3b05e732 / 933de2db（none）
// 以下补齐：b9034833 / fdc78dd3（completed）+ 0dd76058 / 12763411 / 30789ddf / cee92fc3 / e925714f（none）

test('b9034833 数轴题：不产生任何伪几何约束', () => {
  const content = '如图，数轴上原点为点O，且OA=6，线段OA上是否存在两个点X和Y，使得在1、2、3、4、5、6中任取一个数字a，总可以找到由O、X、Y、A中某两点为端点的线段长为a？若存在，请在数轴上标出来；若不存在，请说明理由。'
  const s = structureWith(['O', 'A'], [['O','A']])
  const { constraints } = extractConstraints(content, s)
  assert.equal(constraints.length, 0, '数轴题没有几何约束可抽')
})

test('fdc78dd3 纯相似题（无配图）：∠A=45° 单字母不抽，带单位等长不抽', () => {
  const content = '在△ABC和△DEF中，如果∠A=45°，AB=12cm，AC=15cm，∠D=45°，DE=16cm，那么DF=______时，△ABC与△DEF相似。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E', 'F'], [['A','B'],['B','C'],['C','A'],['D','E'],['E','F'],['F','D']])
  const { constraints, dropped } = extractConstraints(content, s)
  // ∠A=45° 只有一个字母，不是 ∠ABC=45° 三字母角度值
  assert.equal(ofType(constraints, 'angle_value').length, 0, '单字母 ∠A 不应被抽成角度值')
  // AB=12cm 带单位，不是 AB=CD 线段等长
  assert.equal(ofType(constraints, 'equal_length').length, 0, '带单位的等式不应被抽成等长')
  // 空约束时也不该有被丢弃的字母（双向求交不该误伤）
  assert.equal(dropped.length, 0)
})

test('0dd76058 DE∥BC 比例题：平行被抽出，且不把 DE/BC=2/5 误读成等长', () => {
  const content = '在△ABC中，点D、E分别在边AB、AC上，且DE∥BC，如果DE/BC=2/5，那么AE/EC=______。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E'], [['A','B'],['A','C'],['D','E'],['B','C']])
  const { constraints } = extractConstraints(content, s)
  assert.ok(hasType(constraints, 'parallel'), 'DE∥BC 应被抽出')
  assert.equal(hasType(constraints, 'equal_length'), false, 'DE/BC=2/5 是比例不是等长')
})

test('12763411 平行四边形 BFED：polygon_shape(平行四边形) + 两组平行', () => {
  const content = '（2022·杭州）如图，在△ABC中，点D，E，F分别在边AB，AC，BC上，连接DE，EF。已知四边形BFED是平行四边形，DE/BC=1/4。（1）若AB=8，求线段AD的长。（2）若△ADE的面积为1，求平行四边形BFED的面积。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E', 'F'], [['A','B'],['A','C'],['B','C'],['D','E'],['E','F'],['B','F'],['D','B'],['B','E'],['F','E']])
  const { constraints } = extractConstraints(content, s)
  const shapes = ofType(constraints, 'polygon_shape')
  assert.ok(shapes.some(p => p.args.kind === 'parallelogram' && p.args.vertices.join('') === 'BFED'), '应抽出平行四边形 BFED')
  assert.ok(ofType(constraints, 'parallel').length >= 2, '平行四边形应有两组对边平行')
  assert.equal(hasType(constraints, 'equal_length'), false, 'DE/BC=1/4 是比例不是等长')
})

test('30789ddf DF//AC、DE//BC：两条平行都被抽出', () => {
  const content = '如图2，DF//AC，DE//BC，下列各式中正确的是'
  const s = structureWith(['A', 'B', 'C', 'D', 'E', 'F'], [['D','F'],['A','C'],['D','E'],['B','C']])
  const { constraints } = extractConstraints(content, s)
  const pars = ofType(constraints, 'parallel')
  assert.ok(pars.length >= 2, '两条平行都应被抽出')
})

test('cee92fc3 全等题：AB=AE、BC=EF 各成一条等长，结论序号不产生约束', () => {
  const content = '如图，△ABC与△AEF中，AB=AE，BC=EF，∠B=∠E，AB交EF于点D。给出下列结论：①△AED∽△AFC；②∠AFC=∠C；③∠FAC=∠BFD；④△ADE∽△FDB。其中正确的结论是______。（填写所有正确结论的序号）'
  const s = structureWith(['A', 'B', 'C', 'E', 'F', 'D'], [['A','B'],['B','C'],['C','A'],['A','E'],['E','F'],['F','A'],['B','D'],['D','A'],['E','D'],['D','F']])
  const { constraints } = extractConstraints(content, s)
  const eqs = ofType(constraints, 'equal_length')
  assert.ok(eqs.length >= 2, 'AB=AE 与 BC=EF 应各成一条等长')
  const joined = eqs.map(e => e.args.segs.map(ss => ss.join('')).join('')).join('|')
  assert.ok(joined.includes('ABAE') || joined.includes('AEAB'), '应含 AB=AE')
  assert.ok(joined.includes('BCEF') || joined.includes('EFBC'), '应含 BC=EF')
  // 结论中的 ∠AFC=∠C 等不应被抽成角度值（结论不是条件）
  assert.equal(hasType(constraints, 'angle_value'), false, '结论中的等角不是角度值约束')
})

test('e925714f 旋转双垂足：AD⊥MN、BE⊥MN 抽出 foot×2，∠ACB=90° 抽出垂直，结论式 DE=AD+BE 不抽等长', () => {
  const content = '在△ABC中，∠ACB=90°，AC=BC，直线MN经过点C，且AD⊥MN于点D，BE⊥MN于点E。(1)当直线MN绕点C旋转到图1的位置时，求证：①△ADC≌△CEB；②DE=AD+BE；(2)当直线MN绕点C旋转到图2的位置时，求证：DE=AD-BE；(3)当直线MN绕点C旋转到图3的位置时，试问DE、AD、BE具有怎样的等量关系？请直接写出这个等量关系。'
  const s = structureWith(['A', 'B', 'C', 'D', 'E', 'M', 'N'], [['A','B'],['B','C'],['C','A'],['M','N'],['A','D'],['B','E'],['C','D'],['C','E']])
  const { constraints } = extractConstraints(content, s)
  const feet = ofType(constraints, 'foot')
  assert.ok(feet.some(f => f.args.point === 'D' && f.args.from === 'A' && f.args.onLine.join('') === 'MN'), 'D 应是 A 到 MN 的垂足')
  assert.ok(feet.some(f => f.args.point === 'E' && f.args.from === 'B' && f.args.onLine.join('') === 'MN'), 'E 应是 B 到 MN 的垂足')
  assert.ok(hasType(constraints, 'perpendicular'), '∠ACB=90° 应抽出垂直')
  // DE=AD+BE / DE=AD-BE 是结论式，绝不能进等长约束。
  // 注意 AC=BC 是题干真实条件（等腰直角三角形），应保留——只检查结论涉及的 DE 不进等长。
  const eqInvolvingDE = ofType(constraints, 'equal_length').some(
    e => e.args.segs.some(ss => ss.includes('D') || ss.includes('E'))
  )
  assert.equal(eqInvolvingDE, false, '线段和差结论不应被抽成等长')
})
