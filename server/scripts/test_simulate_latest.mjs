/**
 * 模拟测试：用最新 OCR 输出验证 sub 拆分逻辑
 */

// 复刻 worker.js 的 parseSubAnswers（基础模式，无负向断言）
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

// 复刻 splitBySemicolon
const splitBySemicolon = (s, subCount) => {
  if (!s || subCount < 2) return []
  const parts = s.split(/[;；]/).map(p => p.trim()).filter(p => p)
  if (parts.length < subCount) return []
  const result = []
  for (let i = 0; i < subCount; i++) {
    let val = i < subCount - 1 ? parts[i] : parts.slice(i).join('; ')
    if (val.includes('=')) val = val.slice(val.lastIndexOf('=') + 1)
    val = val.split(/[,，]/).pop().trim()
    if (val) result.push({ sub: String(i + 1), val })
  }
  return result.filter(Boolean)
}

// 模拟答案库
const answerBank = {
  21: { subCount: 2, answers: { '1': '2', '2': '2√10' } },
  22: { subCount: 2, answers: { '1': '22-12√2', '2': '-1' } },
}

// 模拟 OCR 输出（用户最新任务）
const ocrOutput = [
  { q: 21, student: '√(12×1/3)=√4=2；2√(5/0.5)=2√10' },
  { q: 22, student: '(3√2-2)(3√2+2)=9×2-4=18-4=14；(2√2+3)(2√2-3)=8-9=-1' },
]

console.log('=== 模拟测试：sub 拆分逻辑 ===\n')

for (const { q, student } of ocrOutput) {
  console.log(`\n题${q}: student="${student}"`)
  const subInfo = answerBank[q]
  console.log(`  答案库 sub 数：${subInfo.subCount}`)
  console.log(`  答案库答案：${Object.entries(subInfo.answers).map(([k, v]) => `${k}=${v}`).join(', ')}`)

  // 优先用 splitBySemicolon
  let parsed = splitBySemicolon(student, subInfo.subCount)
  console.log(`  splitBySemicolon: ${JSON.stringify(parsed)}`)

  // 兜底：parseSubAnswers
  if (parsed.length < 1) {
    parsed = parseSubAnswers(student)
    console.log(`  parseSubAnswers 兜底：${JSON.stringify(parsed)}`)
  }

  // 匹配答案
  if (parsed.length >= 1) {
    console.log(`  匹配结果：`)
    for (const seg of parsed) {
      const ref = subInfo.answers[seg.sub]
      console.log(`    sub(${seg.sub}) student="${seg.val}" vs ref="${ref}"`)
    }
  } else {
    console.log(`  ❌ 拆分失败，无法匹配`)
  }
}
