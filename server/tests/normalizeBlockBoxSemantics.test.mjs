import { normalizeBlockBoxSemantics } from '../worker.js'

const mk = (arr) => arr.map(b => ({ block_coordinates: { ...b } }))
const boxes = (qs) => qs.map(q => q.block_coordinates)

let pass = 0
let fail = 0
const check = (name, got, expect) => {
  const g = JSON.stringify(got)
  const e = JSON.stringify(expect)
  if (g === e) { pass++; console.log(`✅ ${name}`) }
  else { fail++; console.log(`❌ ${name}\n   期望 ${e}\n   实际 ${g}`) }
}

// 线上事故原始数据：任务 432a661d 第 1 页（每题 height 恰好等于下一题的 y）。
// 按宽高解读第 5 题会从 y=420 拉到 910，圈住第 6 题和网格配图。
const realPage = mk([
  { x: 70, y: 140, width: 730, height: 210 },
  { x: 70, y: 210, width: 730, height: 280 },
  { x: 70, y: 280, width: 730, height: 350 },
  { x: 70, y: 350, width: 730, height: 420 },
  { x: 70, y: 420, width: 730, height: 490 },
  { x: 70, y: 690, width: 730, height: 760 },
  { x: 70, y: 810, width: 550, height: 840 },
  { x: 70, y: 840, width: 680, height: 870 },
  { x: 70, y: 870, width: 680, height: 900 },
])
normalizeBlockBoxSemantics(realPage)
check('线上角点形态整页换算为宽高', boxes(realPage), [
  { x: 70, y: 140, width: 660, height: 70 },
  { x: 70, y: 210, width: 660, height: 70 },
  { x: 70, y: 280, width: 660, height: 70 },
  { x: 70, y: 350, width: 660, height: 70 },
  { x: 70, y: 420, width: 660, height: 70 },
  { x: 70, y: 690, width: 660, height: 70 },
  { x: 70, y: 810, width: 480, height: 30 },
  { x: 70, y: 840, width: 610, height: 30 },
  { x: 70, y: 870, width: 610, height: 30 },
])

// 幂等：换算后的宽高框再跑一次不能被改坏
const again = mk(boxes(realPage))
normalizeBlockBoxSemantics(again)
check('幂等（宽高框不再被换算）', boxes(again), boxes(realPage))

// 只有越界信号也要能识别（少量题目、无链式指纹）
const overflow = mk([
  { x: 100, y: 600, width: 800, height: 900 },
  { x: 100, y: 900, width: 800, height: 980 },
])
normalizeBlockBoxSemantics(overflow)
check('越界信号触发换算', boxes(overflow), [
  { x: 100, y: 600, width: 700, height: 300 },
  { x: 100, y: 900, width: 700, height: 80 },
])

// 正常宽高框：题目纵向堆叠但 height 不等于下一题 y，且不越界 → 原样保留
const normal = mk([
  { x: 50, y: 20, width: 900, height: 200 },
  { x: 50, y: 240, width: 900, height: 200 },
  { x: 50, y: 460, width: 900, height: 200 },
  { x: 50, y: 680, width: 900, height: 200 },
])
const normalBefore = JSON.parse(JSON.stringify(boxes(normal)))
normalizeBlockBoxSemantics(normal)
check('正常宽高整页保持不变', boxes(normal), normalBefore)

// 占位坐标（线上第 2 页：x=870,width=100 → 角点解读不成立）→ 原样保留
const placeholder = mk([
  { x: 870, y: 100, width: 100, height: 100 },
  { x: 870, y: 150, width: 100, height: 100 },
  { x: 870, y: 200, width: 100, height: 100 },
  { x: 870, y: 250, width: 100, height: 100 },
])
const placeholderBefore = JSON.parse(JSON.stringify(boxes(placeholder)))
normalizeBlockBoxSemantics(placeholder)
check('占位坐标不被换算', boxes(placeholder), placeholderBefore)

// 缺坐标/畸形值不能抛异常
const messy = [{ block_coordinates: null }, {}, { block_coordinates: { x: 'a', y: 1, width: 2, height: 3 } }, null]
normalizeBlockBoxSemantics(messy)
normalizeBlockBoxSemantics([])
normalizeBlockBoxSemantics(null)
pass++
console.log('✅ 空/畸形输入不抛异常')

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
