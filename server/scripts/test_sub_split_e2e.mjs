/**
 * 端到端测试：parseSubAnswers 修复后，真实 OCR 输出的 sub 拆分匹配
 * 覆盖：
 * 1) 有 (1)(2) 标记（旧场景）
 * 2) 无标记，只有 ；分隔（新场景）
 * 3) 数学括号干扰（关键修复）
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

const run = async () => {
  // 1) 加载答案库
  const { rows: units } = await pool.query(`
    SELECT ru.id, ru.unit_key, ru.unit_title
    FROM resource_units ru
    WHERE ru.id IN (SELECT DISTINCT unit_id FROM worksheet_answers WHERE worksheet_id = $1)
  `, [wsId])
  const unitMetaMap = new Map(units.map(u => [u.id, u]))

  const { rows } = await pool.query(`
    SELECT ru.unit_key, ru.unit_title, wa.section, wa.question_no, wa.sub_no,
           wa.answer, wa.answer_type, wa.content, ru.id as unit_id
    FROM worksheet_answers wa
    JOIN resource_units ru ON ru.id = wa.unit_id
    WHERE wa.worksheet_id = $1
  `, [wsId])

  const answersByUnit = new Map()
  for (const r of rows) {
    if (!answersByUnit.has(r.unit_key)) {
      answersByUnit.set(r.unit_key, new Map())
    }
    const secMap = answersByUnit.get(r.unit_key)
    const sectionKey = r.section || ''
    if (!secMap.has(sectionKey)) secMap.set(sectionKey, new Map())
    const qKey = `${r.question_no}|${r.sub_no || ''}`
    const meta = unitMetaMap.get(r.unit_id) || {}
    secMap.get(sectionKey).set(qKey, {
      ...r,
      ...meta,
      unit_title: meta.unit_title || r.unit_title,
      unit_key: meta.unit_key || r.unit_key,
    })
  }

  // 2) 复刻 worker.js 的 parseSubAnswers + splitBySemicolon（含修复）
  const parseSubAnswers = (s) => {
    if (!s) return []
    // 基础模式：匹配 (N) 或 （N），N 为 1-2 位数字
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

  const splitBySemicolon = (s, subCount) => {
    if (!s || subCount < 2) return []
    const parts = s.split(/[;；]/).map(p => p.trim()).filter(p => p)
    if (parts.length < subCount) return []  // 段数不够，无法匹配
    // 段数 ≥ subCount 时，前 subCount-1 段各取一段，剩余全部合并到末段
    const result = []
    for (let i = 0; i < subCount; i++) {
      let val = i < subCount - 1 ? parts[i] : parts.slice(i).join('; ')
      if (val.includes('=')) val = val.slice(val.lastIndexOf('=') + 1)
      val = val.split(/[,，]/).pop().trim()
      if (val) result.push({ sub: String(i + 1), val })
    }
    return result.filter(Boolean)
  }

  // 答案指纹简化版（与 worker.js 一致）
  const calcSim = (s, r) => {
    if (!s || !r) return 0
    const raw = (a) => String(a).trim().replace(/\\sqrt\s*\{?/g, '√').replace(/根号/g, '√').replace(/[{}]/g, '').replace(/[，；。（）]/g, m => ({'，':',','；':';','。':'.','（':'(','）':')'}[m])).toLowerCase()
    if (s.trim() === r.trim()) return 1.0
    const sN = raw(s), rN = raw(r)
    if (!sN || !rN) return 0
    if (sN === rN) return 0.95
    if (sN.includes(rN) || rN.includes(sN)) {
      const shorter = Math.min(sN.length, rN.length)
      const longer = Math.max(sN.length, rN.length)
      if (shorter >= 2 && longer / shorter <= 1.5) return 0.85
    }
    const sNums = (sN.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
    const rNums = (rN.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
    if (sNums && sNums === rNums && sNums.length >= 2) return 0.7
    return 0
  }

  // 3) 测试用例：真实 OCR 输出
  const testCases = [
    {
      name: 'q21 旧场景（有 (1)(2) 标记）',
      question_number: 21,
      student_answer: '（1）√14；2 （2）2√10；√10',
      expected: [{ sub: '1', val: '2' }, { sub: '2', val: '√10' }],
    },
    {
      name: 'q21 新场景（无标记，数学括号干扰）',
      question_number: 21,
      student_answer: '√(12×1/3)=√4=2；2√(5/0.5)=2√10',
      expected: [{ sub: '1', val: '2' }, { sub: '2', val: '2√10' }],
    },
    {
      name: 'q22 新场景（无标记，数学括号干扰）',
      question_number: 22,
      student_answer: '(3√2-2)(3√2+2)=9×2-4=18-4=14；(2√2+3)(2√2-3)=8-9=-1',
      expected: [{ sub: '1', val: '14' }, { sub: '2', val: '-1' }],
    },
    {
      name: 'q22 旧场景（有 (1)(2) 标记）',
      question_number: 22,
      student_answer: '（1）(3√2-2)(3√2+2)；9×4=36 （2）2√2×2√2=8；8-9=-1',
      expected: [{ sub: '1', val: '36' }, { sub: '2', val: '-1' }],
    },
  ]

  // 选试卷3|19.2
  const unitAnswers = answersByUnit.get('试卷3|19.2')

  const findSubRowsForQuestion = (qNo) => {
    if (!unitAnswers) return []
    const out = []
    for (const qMap of unitAnswers.values()) {
      for (const [qKey, row] of qMap) {
        const [qnStr, subStr] = qKey.split('|')
        if (Number(qnStr) === Number(qNo) && subStr) {
          out.push({ sub: subStr, row })
        }
      }
    }
    return out
  }

  console.log('=== 端到端测试：parseSubAnswers 修复后 ===\n')

  let allPassed = true
  for (const tc of testCases) {
    console.log(`\n--- ${tc.name} ---`)
    console.log(`  student="${tc.student_answer}"`)

    const subRows = findSubRowsForQuestion(tc.question_number)
    console.log(`  答案库 sub: ${subRows.map(s => s.sub + '=' + s.row.answer).join(', ')}`)

    // 优先用 parseSubAnswers（有 (1)(2) 标记时更准确，能按标记正确拆分）
    let parsed = parseSubAnswers(tc.student_answer)
    // 兜底：无 (1)(2) 标记或数学括号干扰时，用 splitBySemicolon（按 ；切分）
    if (parsed.length < 1) {
      parsed = splitBySemicolon(tc.student_answer, subRows.length)
    }

    // 验证拆分结果
    const expectedStr = JSON.stringify(tc.expected)
    const parsedStr = JSON.stringify(parsed)
    const splitOk = parsedStr === expectedStr

    // judge 每个 sub
    let allCorrect = true
    let anyMatched = false
    for (const seg of parsed) {
      const aligned = subRows.find(s => s.sub === seg.sub)
      if (aligned) {
        const sim = calcSim(seg.val, aligned.row.answer)
        let correct
        if (sim >= 0.7) correct = '✓'
        else if (sim < 0.5) correct = '✗'
        else correct = '?待审'
        console.log(`  sub(${seg.sub}) student="${seg.val}" vs ref="${aligned.row.answer}" sim=${sim.toFixed(2)} ${correct}`)
        anyMatched = true
        if (correct === '✗') allCorrect = false
      }
    }

    const verdict = anyMatched ? (allCorrect ? '✓ 对' : '✗ 错') : '? 待审'
    console.log(`  整题判分: ${verdict}`)

    if (!splitOk) {
      console.log(`  ❌ 拆分结果不匹配！expected=${expectedStr} got=${parsedStr}`)
      allPassed = false
    } else {
      console.log(`  ✅ 拆分结果正确`)
    }
  }

  console.log('\n' + '='.repeat(50))
  console.log(allPassed ? '✅ 全部测试通过' : '❌ 有测试失败')

  await pool.end()
  process.exit(allPassed ? 0 : 1)
}
run().catch(console.error)
