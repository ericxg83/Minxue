/**
 * 测试 sub 拆分匹配：OCR 输出 "(1) X (2) Y" 但 sub_no 缺失时，按 sub 拆分查答案
 * 模拟用户最新试卷（worksheet 1c31ee45）的填空题 21, 22
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

  // 2) 验证 parseSubAnswers 拆分逻辑
  console.log('=== parseSubAnswers 单元测试 ===\n')
  const parseSubAnswers = (s) => {
    if (!s) return []
    const markerRe = /[（(]\s*(\d+)\s*[)）]/g
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

  const subTests = [
    { input: '(1) 2 (2) 2√10' },
    { input: '（1）√14；2 （2）2√10；√10' },
    { input: '(1) 36 (2) -1' },
    { input: '（1）(3√2-2)(3√2+2)；9×4=36 （2）2√2×2√2=8；8-9=-1' },
    { input: 'D' },
    { input: '' },
  ]
  for (const t of subTests) {
    const got = parseSubAnswers(t.input)
    console.log(`input: "${t.input}"`)
    console.log(`  got: ${JSON.stringify(got)}`)
  }

  // 3) 模拟用户实际场景的填空题
  console.log('\n=== 用户最新试卷填空题 sub 拆分匹配 ===\n')

  // 用户最新任务 OCR 输出（来自 questions 表）
  const userFillQuestions = [
    { question_number: 21, sub_no: null, content: '计算：(1) √12 × √(1/3)；(2) 2√5 ÷ √0.5', student_answer: '（1）√14；2 （2）2√10；√10', question_type: 'fill' },
    { question_number: 22, sub_no: null, content: '计算：(1) (3√2-2)²；(2) (2√2+3)(2√2-3)', student_answer: '（1）(3√2-2)(3√2+2)；9×4=36 （2）2√2×2√2=8；8-9=-1', question_type: 'fill' },
  ]

  // 选试卷3|19.2
  const unitAnswers = answersByUnit.get('试卷3|19.2')

  // 复刻 processAnswerBankGrading 的 sub 拆分逻辑
  const lookupRow = (qNo, subNo) => {
    if (!unitAnswers) return null
    const qKey = `${Number(qNo)}|${subNo || ''}`
    let best = null
    for (const qMap of unitAnswers.values()) {
      const row = qMap.get(qKey)
      if (row) best = row
    }
    return best
  }
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

  for (const q of userFillQuestions) {
    console.log(`\n题${q.question_number}: student="${q.student_answer}"`)
    const direct = lookupRow(q.question_number, q.sub_no)
    console.log(`  直接查 q${q.question_number}|${q.sub_no || ''} → ${direct ? '✓' : '✗'}`)

    const subRows = findSubRowsForQuestion(q.question_number)
    console.log(`  答案库 sub 列表: ${subRows.map(s => s.sub + '=' + s.row.answer).join(', ')}`)

    const parsed = parseSubAnswers(q.student_answer)
    console.log(`  拆分: ${JSON.stringify(parsed)}`)

    // judge 每个 sub (用答案指纹 sim)
    for (const seg of parsed) {
      const aligned = subRows.find(s => s.sub === seg.sub)
      if (aligned) {
        // 模拟 calculateAnswerSimilarity
        const sim = calcSim(seg.val, aligned.row.answer)
        let correct
        if (sim >= 0.7) correct = '✓'
        else if (sim < 0.5) correct = '✗'
        else correct = '?待审'
        console.log(`  sub(${seg.sub}) student="${seg.val}" vs ref="${aligned.row.answer}" sim=${sim.toFixed(2)} ${correct}`)
      }
    }
  }

  await pool.end()
  process.exit(0)
}
run().catch(console.error)
