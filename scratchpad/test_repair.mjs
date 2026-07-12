import { repairAIJson } from '../server/worker.js'

// 用 String.raw 构造真实畸形 JSON（含 \angle 单反斜杠、\\frac 双反斜杠、字面 \n）
const case1 = String.raw`{
  "answer": "12",
  "analysis": "1. **分析**：\n   - 菱形 $ABCD$ 面积36。\n   - $BE = \\frac{1}{2}AB$。\n   - $\\triangle BEF$ 面积6。\n   设边长 $a$，$\angle B = \\theta$。则 $S = a^2 \\sin\theta$。$\triangle$ 结论。",
  "subject": "数学"
}`

// case2: 含 \circ 单反斜杠、以及裸引号场景
const case2 = String.raw`{
  "answer": "2\\sqrt{6}-2\\sqrt{2}",
  "analysis": "设 $\angle E'BG' = 90^\circ$，$E'(2\cos\theta, 2\sin\theta)$。旋转 $90$ 度。",
  "subject": "数学"
}`

// case3: 字符串内真实换行（裸控制字符）
const case3 = '{\n  "answer": "x=1",\n  "analysis": "第一行\n第二行 \\frac{1}{2}"\n}'

for (const [name, raw] of [['case1', case1], ['case2', case2], ['case3', case3]]) {
  console.log(`\n===== ${name} =====`)
  let ok = false
  try { JSON.parse(raw); console.log('原始直接可解析（意外）'); ok = true } catch (e) { console.log('原始解析失败:', e.message) }
  if (!ok) {
    const repaired = repairAIJson(raw)
    try {
      const obj = JSON.parse(repaired)
      console.log('✅ 修复后可解析')
      console.log('   answer =', JSON.stringify(obj.answer))
      const a = String(obj.analysis)
      console.log('   analysis 含 \\triangle?', a.includes('\\triangle'))
      console.log('   analysis 含 \\theta?', a.includes('\\theta'))
      console.log('   analysis 含 \\frac?', a.includes('\\frac'))
      console.log('   analysis 含 \\angle?', a.includes('\\angle'))
      console.log('   analysis 含 \\circ?', a.includes('\\circ'))
      console.log('   analysis 含裸TAB?', /\t/.test(a), ' 裸FF?', /\f/.test(a))
      console.log('   analysis 前60字 =', a.slice(0, 60).replace(/\n/g, '⏎'))
    } catch (e) {
      console.log('❌ 修复后仍失败:', e.message)
      console.log('   修复输出前200:', repaired.slice(0, 200))
    }
  }
}
