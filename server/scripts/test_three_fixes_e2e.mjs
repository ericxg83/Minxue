/**
 * 端到端测试：3 个批改修复场景
 *
 * 1) 选择题去括号：student "(C)" / "（C）" / "C" / "c" 都应严格 == ref "C"
 * 2) 判断题去括号：student "（√）" / "(×)" / "√" / "×" 都应判对（按 ref）
 * 3) 圈数字 sub 拆分：student "①√12/3 ②2√10" → 按 (1)2 (2)2√10 拆 sub
 * 4) 主路径 fallback：q.sub_no='1' 查不到 (qNo, subNo) → fallback (qNo, '') 整题按段匹配
 *
 * 使用 worksheet 1c31ee45-0879-4d53-a54c-60af85ee15cc 的真实数据
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

// ── 工具：与 worker.js / answerParseService.js / judgeService.js 行为同步 ──
const judgeAnswer = (studentAns, refAns, qType) => {
  if (qType === 'choice') {
    const clean = (s) => String(s || '').trim().toUpperCase().replace(/^[（(]|[)）]$/g, '')
    return { isCorrect: clean(studentAns) === clean(refAns), unrecognized: false }
  }
  if (qType === 'judge') {
    const clean = (s) => String(s || '').trim().replace(/^[（(]|[)）]$/g, '')
    const norm = (s) => {
      const t = clean(s).replace(/[✓√✔]/g, 'T').replace(/[✗✘×xX]/g, 'F')
      return t
    }
    return { isCorrect: norm(studentAns) === norm(refAns), unrecognized: false }
  }
  // 简化的"答案指纹"（与 worker.js calculateAnswerSimilarity 行为一致）
  const sim = calcSim(studentAns, refAns)
  return { isCorrect: sim >= 0.7, unrecognized: false, sim }
}

const calcSim = (s, r) => {
  if (!s || !r) return 0
  const norm = (a) => String(a).trim().replace(/\\sqrt\s*\{?/g, '√').replace(/根号/g, '√')
    .replace(/[{}]/g, '').replace(/[，；。（）]/g, m => ({ '，': ',', '；': ';', '。': '.', '（': '(', '）': ')' }[m])).toLowerCase()
  if (s.trim() === r.trim()) return 1.0
  const sN = norm(s), rN = norm(r)
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

// 圈数字 → ASCII 数字
const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const splitSubAnswers = (ans) => {
  const text = String(ans || '').trim()
  if (!text) return null
  // 模式 1: 圆括号 / 全角括号
  const re1 = /[（(]\s*(\d{1,2})\s*[）)]/g
  const marks1 = []
  let m
  while ((m = re1.exec(text)) !== null) {
    marks1.push({ no: parseInt(m[1], 10), start: m.index, end: re1.lastIndex })
  }
  const pickStrict = (marks) => {
    if (!marks || marks.length < 2) return null
    if (marks[0].no !== 1) return null
    if (marks[0].start > 2) return null
    const picked = [marks[0]]
    for (const k of marks) {
      if (k.no === picked[picked.length - 1].no + 1) picked.push(k)
    }
    return picked.length >= 2 ? picked : null
  }
  let picked = pickStrict(marks1)
  if (picked) {
    return picked.map((k, i) => ({
      sub_no: String(k.no),
      answer: text.slice(k.end, i + 1 < picked.length ? picked[i + 1].start : text.length).trim(),
    }))
  }
  // 模式 2: 圈数字
  const re2 = new RegExp(`([${CIRCLED_DIGITS}])`, 'g')
  const marks2 = []
  while ((m = re2.exec(text)) !== null) {
    const ord = CIRCLED_DIGITS.indexOf(m[1]) + 1
    if (ord > 0) marks2.push({ no: ord, start: m.index, end: re2.lastIndex })
  }
  picked = pickStrict(marks2)
  if (picked) {
    return picked.map((k, i) => ({
      sub_no: String(k.no),
      answer: text.slice(k.end, i + 1 < picked.length ? picked[i + 1].start : text.length).trim(),
    }))
  }
  return null
}

const run = async () => {
  // ── 加载答案库 ──
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
    if (!answersByUnit.has(r.unit_key)) answersByUnit.set(r.unit_key, new Map())
    const secMap = answersByUnit.get(r.unit_key)
    const sectionKey = r.section || ''
    if (!secMap.has(sectionKey)) secMap.set(sectionKey, new Map())
    const qKey = `${r.question_no}|${r.sub_no || ''}`
    const meta = unitMetaMap.get(r.unit_id) || {}
    secMap.get(sectionKey).set(qKey, {
      ...r, ...meta,
      unit_title: meta.unit_title || r.unit_title,
      unit_key: meta.unit_key || r.unit_key,
    })
  }

  // 选试卷3|19.2
  const unitAnswers = answersByUnit.get('试卷3|19.2')
  if (!unitAnswers) {
    console.error('❌ 找不到 unit "试卷3|19.2"')
    process.exit(1)
  }

  // 取一个具体的 (qNo, subNo) 答案行作为用例数据
  const lookupRow = (qNo, subNo) => {
    const qKey = `${Number(qNo)}|${subNo || ''}`
    for (const qMap of unitAnswers.values()) {
      const row = qMap.get(qKey)
      if (row) return row
    }
    return null
  }

  console.log('=== 3 个批改修复场景端到端测试 ===\n')
  let allPassed = true
  const expect = (cond, msg) => {
    if (cond) {
      console.log(`  ✅ ${msg}`)
    } else {
      console.log(`  ❌ ${msg}`)
      allPassed = false
    }
  }

  // ── 场景 1: 选择题去括号 ──
  console.log('\n--- 场景 1: 选择题去括号 (C)/(C)/(C)/C/c 都应严格匹配 C ---')
  const choiceRef = 'C'
  expect(judgeAnswer('C', choiceRef, 'choice').isCorrect === true, '裸 C 判对')
  expect(judgeAnswer('c', choiceRef, 'choice').isCorrect === true, '小写 c 判对')
  expect(judgeAnswer('(C)', choiceRef, 'choice').isCorrect === true, '(C) 半角括号判对')
  expect(judgeAnswer('（C）', choiceRef, 'choice').isCorrect === true, '（C）全角括号判对')
  expect(judgeAnswer('A', choiceRef, 'choice').isCorrect === false, 'A 不等于 C 应判错')

  // ── 场景 2: 判断题去括号 ──
  console.log('\n--- 场景 2: 判断题去括号 (√)/(×)/√/× 都应严格匹配 ref ---')
  const judgeRef = '√'
  expect(judgeAnswer('√', judgeRef, 'judge').isCorrect === true, '裸 √ 判对')
  expect(judgeAnswer('(√)', judgeRef, 'judge').isCorrect === true, '(√) 半角括号判对')
  expect(judgeAnswer('（√）', judgeRef, 'judge').isCorrect === true, '（√）全角括号判对')
  expect(judgeAnswer('×', judgeRef, 'judge').isCorrect === false, '× 不等于 √ 应判错')

  // ── 场景 3: 圈数字 sub 拆分 ──
  console.log('\n--- 场景 3: 圈数字 sub 拆分 ①√12/3 ②2√10 → sub 段 ---')
  const circledAns = '①√12/3 ②2√10'
  const circledSubs = splitSubAnswers(circledAns)
  expect(Array.isArray(circledSubs) && circledSubs.length === 2, '圈数字拆出 2 段')
  if (circledSubs && circledSubs.length === 2) {
    expect(circledSubs[0].sub_no === '1' && circledSubs[0].answer === '√12/3', `sub(1)=√12/3 (got: ${circledSubs[0]?.sub_no}=${circledSubs[0]?.answer})`)
    expect(circledSubs[1].sub_no === '2' && circledSubs[1].answer === '2√10', `sub(2)=2√10 (got: ${circledSubs[1]?.sub_no}=${circledSubs[1]?.answer})`)
  }

  // 圆括号也能拆
  const parenAns = '（1）2 （2）2√10'
  const parenSubs = splitSubAnswers(parenAns)
  expect(Array.isArray(parenSubs) && parenSubs.length === 2, '圆括号拆出 2 段')
  if (parenSubs && parenSubs.length === 2) {
    expect(parenSubs[0].sub_no === '1' && parenSubs[0].answer === '2', `sub(1)=2`)
    expect(parenSubs[1].sub_no === '2' && parenSubs[1].answer === '2√10', `sub(2)=2√10`)
  }

  // ── 场景 4: 主路径 fallback ──
  console.log('\n--- 场景 4: 主路径 fallback (qNo, subNo) 查不到 → 整题 (qNo, \'\') 拆 sub 段 ---')
  // 找一道答案库按 sub 拆开存的题
  let demoQNo = null
  for (const qMap of unitAnswers.values()) {
    for (const [qKey, row] of qMap) {
      const [qn, sub] = qKey.split('|')
      if (sub) { demoQNo = Number(qn); break }
    }
    if (demoQNo != null) break
  }
  if (demoQNo == null) {
    console.log('  ⚠️ 答案库无 sub 拆分题，跳过场景 4')
  } else {
    console.log(`  使用题号 ${demoQNo} 作示例`)
    // 找它的 sub 行
    const subRows = []
    for (const qMap of unitAnswers.values()) {
      for (const [qKey, row] of qMap) {
        const [qn, sub] = qKey.split('|')
        if (Number(qn) === demoQNo && sub) subRows.push({ sub, row })
      }
    }
    subRows.sort((a, b) => Number(a.sub) - Number(b.sub))
    expect(subRows.length >= 2, `答案库该题有 ${subRows.length} 个 sub`)

    // 模拟：把 (qNo, '1') 查不到 → fallback 整题 (qNo, '') 找 row
    const wholeRow = lookupRow(demoQNo, '')
    if (wholeRow) {
      const subSegs = splitSubAnswers(wholeRow.answer)
      expect(subSegs && subSegs.length >= 2, `整题 row.answer 拆 sub: "${wholeRow.answer.slice(0, 50)}" → ${subSegs?.length || 0} 段`)
      if (subSegs && subSegs.length >= 2) {
        const seg1 = subSegs.find(s => s.sub_no === '1')
        const seg2 = subSegs.find(s => s.sub_no === '2')
        expect(seg1 && seg1.answer, `sub(1) 段存在: ${seg1?.answer}`)
        expect(seg2 && seg2.answer, `sub(2) 段存在: ${seg2?.answer}`)
      }
    } else {
      // 整题合并存储的场景
      console.log(`  (整题 (${demoQNo}, '') 查不到，用 sub 行做对比)`)
      // 验证 sub 拆分 judge：student "2" vs ref sub(1)='2' → 判对
      const sub1Row = subRows.find(s => s.sub === '1')
      const sub2Row = subRows.find(s => s.sub === '2')
      if (sub1Row) {
        const j1 = judgeAnswer('2', sub1Row.row.answer, sub1Row.row.answer_type || 'answer')
        expect(j1.isCorrect, `sub(1) "2" vs ref "${sub1Row.row.answer}"`)
      }
      if (sub2Row) {
        const j2 = judgeAnswer('2√10', sub2Row.row.answer, sub2Row.row.answer_type || 'answer')
        expect(j2.isCorrect, `sub(2) "2√10" vs ref "${sub2Row.row.answer}"`)
      }
    }
  }

  // ── 总结 ──
  console.log('\n' + '='.repeat(50))
  console.log(allPassed ? '✅ 全部测试通过' : '❌ 有测试失败')

  await pool.end()
  process.exit(allPassed ? 0 : 1)
}
run().catch(e => { console.error(e); process.exit(1) })
