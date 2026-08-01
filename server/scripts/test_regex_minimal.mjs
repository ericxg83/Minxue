/**
 * 最小化测试：只验证 parseSubAnswers 的 regex 逻辑
 */

// 基础模式（无负向断言）
const parseSubAnswers = (s) => {
  if (!s) return []
  const markerRe = /[（(]\s*(\d{1,2})\s*[)）]/g
  const markers = []
  let m
  while ((m = markerRe.exec(s)) !== null) {
    markers.push({ sub: String(parseInt(m[1], 10)), start: m.index, contentStart: m.index + m[0].length })
  }
  if (markers.length < 1) return []
  const parts = []
  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i]
    const end = i + 1 < markers.length ? markers[i + 1].start : s.length
    let val = s.slice(mk.contentStart, end)
    if (val.includes('=')) val = val.slice(val.lastIndexOf('=') + 1)
    val = val.split(/[;；]/).pop()
    val = val.split(/[,，]/).pop()
    val = val.trim()
    if (val) parts.push({ sub: mk.sub, val })
  }
  return parts
}

// 测试用例
const tests = [
  { input: '（1）√14；2 （2）2√10；√10', expected: [{sub:'1', val:'2'}, {sub:'2', val:'√10'}] },
  { input: '√(12×1/3)=√4=2；2√(5/0.5)=2√10', expected: [] },  // 无 (1)(2) 标记
  { input: '(3√2-2)(3√2+2)=9×2-4=18-4=14；(2√2+3)(2√2-3)=8-9=-1', expected: [] },  // 无 (1)(2) 标记
  { input: '（1）(3√2-2)(3√2+2)；9×4=36 （2）2√2×2√2=8；8-9=-1', expected: [{sub:'1', val:'36'}, {sub:'2', val:'-1'}] },
]

console.log('=== parseSubAnswers 最小化测试 ===\n')
let allPassed = true
for (const t of tests) {
  const got = parseSubAnswers(t.input)
  const passed = JSON.stringify(got) === JSON.stringify(t.expected)
  console.log(`input: "${t.input}"`)
  console.log(`  got:      ${JSON.stringify(got)}`)
  console.log(`  expected: ${JSON.stringify(t.expected)}`)
  console.log(`  ${passed ? '✅' : '❌'}\n`)
  if (!passed) allPassed = false
}

console.log(allPassed ? '✅ 全部通过' : '❌ 有失败')
process.exit(allPassed ? 0 : 1)
