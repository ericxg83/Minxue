/**
 * 测试：OCR 拆分映射 + 相似度兜底 + sub 拆分匹配 + 整题 fallback
 *
 * 复刻 worker.js 中 processAnswerBankGrading 的核心匹配逻辑（2.0.0 ~ 2.0.2），
 * 用模拟答案库数据验证 5 个关键场景：
 *   1) OCR 拆分映射：同题号多条记录 → 按出现顺序映射 sub
 *   2) 相似度兜底（单条记录）：主路径查不到 → 按 qNo 找最相似行
 *   3) sub 拆分匹配：student_answer 含 (1)(2) 标记 → 拆分按段匹配
 *   4) 整题 fallback：主路径查不到 + q.sub_no 非空 → fallback 整题行
 *   5) 相似度兜底（多候选行）：过程型答案 → 收窄后匹配
 */
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 复刻 worker.js 的 normalizeAnswerFingerprint ──
function normalizeAnswerFingerprint(s) {
  if (s == null) return ''
  return String(s)
    .replace(/\s+/g, '')
    .replace(/\\sqrt\s*\{?/g, '√')
    .replace(/根号/g, '√')
    .replace(/[{}]/g, '')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/。/g, '.')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .toLowerCase()
    .trim()
}

// ── 复刻 worker.js 的 calculateAnswerSimilarity（含收窄修复）──
function calculateAnswerSimilarity(studentAns, refAns) {
  if (!studentAns || !refAns) return 0
  // ★ 收窄 student 到最终答案（与 worker.js 修复后一致）
  let sRaw = String(studentAns).trim()
  if (sRaw.includes('=')) sRaw = sRaw.slice(sRaw.lastIndexOf('=') + 1).trim()
  if (sRaw.includes(';') || sRaw.includes('；')) sRaw = sRaw.split(/[;；]/).pop().trim()
  if (sRaw.includes(',') || sRaw.includes('，')) sRaw = sRaw.split(/[,，]/).pop().trim()
  const rRaw = String(refAns).trim()
  if (sRaw === rRaw) return 1.0
  const sNorm = normalizeAnswerFingerprint(sRaw)
  const rNorm = normalizeAnswerFingerprint(rRaw)
  if (!sNorm || !rNorm) return 0
  if (sNorm === rNorm) return 0.95
  if (sNorm.includes(rNorm) || rNorm.includes(sNorm)) {
    const shorter = Math.min(sNorm.length, rNorm.length)
    const longer = Math.max(sNorm.length, rNorm.length)
    if (shorter >= 2 && longer / shorter <= 1.5) return 0.85
  }
  const sNums = (sNorm.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
  const rNums = (rNorm.match(/-?\d+(?:\.\d+)?/g) || []).join(',')
  if (sNums && sNums === rNums && sNums.length >= 2) return 0.7
  return 0
}

// ── 复刻 worker.js 的 parseSubAnswers（2.0-pre2）──
function parseSubAnswers(s) {
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

// ── 复刻 worker.js 的 splitBySemicolon（2.0-pre3）──
function splitBySemicolon(s, subCount) {
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

// ── 复刻 answerParseService.js 的 splitSubAnswers（用于 2.0.2 整题 fallback）──
const CIRCLED_DIGITS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function pickStrictSequence(marks) {
  if (!marks || marks.length < 2) return null
  if (marks[0].no !== 1) return null
  if (marks[0].start > 2) return null
  const picked = [marks[0]]
  for (const k of marks) {
    if (k.no === picked[picked.length - 1].no + 1) picked.push(k)
  }
  return picked.length >= 2 ? picked : null
}
function buildSegments(text, picked) {
  const segs = picked.map((k, i) => ({
    sub_no: String(k.no),
    answer: text.slice(k.end, i + 1 < picked.length ? picked[i + 1].start : text.length).trim(),
  }))
  if (segs.some(s => !s.answer || s.answer.length > 80)) return null
  return segs
}
function splitSubAnswersRef(ans) {
  const text = String(ans || '').trim()
  if (!text) return null
  const re1 = /[（(]\s*(\d{1,2})\s*[）)]/g
  const marks1 = []
  let m
  while ((m = re1.exec(text)) !== null) {
    marks1.push({ no: parseInt(m[1], 10), start: m.index, end: re1.lastIndex })
  }
  let picked = pickStrictSequence(marks1)
  if (picked) return buildSegments(text, picked)
  const re2 = new RegExp(`([${CIRCLED_DIGITS}])`, 'g')
  const marks2 = []
  while ((m = re2.exec(text)) !== null) {
    const ord = CIRCLED_DIGITS.indexOf(m[1]) + 1
    if (ord > 0) marks2.push({ no: ord, start: m.index, end: re2.lastIndex })
  }
  picked = pickStrictSequence(marks2)
  if (picked) return buildSegments(text, picked)
  return null
}

// ═══════════════════════════════════════════════════════════════
// 模拟答案库（unit = "试卷3|19.2"）
//   结构: Map(sectionKey → Map(qKey → row))
//   qKey = "qNo|subNo"（subNo 为空字符串表示整题）
// ═══════════════════════════════════════════════════════════════
function buildAnswerBank(rows) {
  // rows: [{ qNo, subNo, answer, answer_type }]
  const secMap = new Map()
  const qMap = new Map()
  for (const r of rows) {
    const qKey = `${r.qNo}|${r.subNo || ''}`
    qMap.set(qKey, { answer: r.answer, answer_type: r.answer_type || 'fill', unit_title: '试卷3|19.2' })
  }
  secMap.set('', qMap)
  return secMap  // unitAnswers
}

// ── 复刻 worker.js 的 lookupRow ──
function lookupRow(unitAnswers, qNo, subNo) {
  if (!unitAnswers) return null
  const qKey = `${Number(qNo)}|${subNo || ''}`
  let best = null
  for (const qMap of unitAnswers.values()) {
    const row = qMap.get(qKey)
    if (row) best = row
  }
  return best
}

// ── 复刻 worker.js 的 findSubRowsForQuestion ──
function findSubRowsForQuestion(unitAnswers, qNo) {
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

// ── 复刻 worker.js 的 findAllRowsForQuestion ──
function findAllRowsForQuestion(unitAnswers, qNo, usedQKeys) {
  if (!unitAnswers) return []
  const out = []
  for (const qMap of unitAnswers.values()) {
    for (const [qKey, row] of qMap) {
      const [qnStr, subStr] = qKey.split('|')
      if (Number(qnStr) === Number(qNo)) {
        const qKeyFull = `${Number(qNo)}|${subStr || ''}`
        if (!usedQKeys.has(qKeyFull)) {
          out.push({ sub: subStr || '', row, qKey: qKeyFull })
        }
      }
    }
  }
  return out
}

// ═══════════════════════════════════════════════════════════════
// 核心模拟：复刻 worker.js 2.0.0 ~ 2.0.2 的匹配逻辑
//   输入: questions = [{ question_number, sub_no, student_answer }]
//   输出: [{ qNo, subNo, matchedRow, isCorrect, sim, matchPath, subBreakdown }]
// ═══════════════════════════════════════════════════════════════
function simulateGrading(unitAnswers, questions) {
  const usedQKeys = new Set()

  // 2.0-pre3a) 预扫描同题号记录
  const qNoIndicesMap = new Map()
  for (let qi = 0; qi < questions.length; qi++) {
    if (questions[qi].question_number == null) continue
    const qNo = Number(questions[qi].question_number)
    if (!qNoIndicesMap.has(qNo)) qNoIndicesMap.set(qNo, [])
    qNoIndicesMap.get(qNo).push(qi)
  }

  const results = []

  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]
    if (q.question_number == null) continue

    const studentAnswer = (q.student_answer || '').toString().trim()
    const isEmpty = !studentAnswer

    let answerRow = null
    let subBreakdown = null
    let matchPath = 'none'

    // 主路径
    answerRow = lookupRow(unitAnswers, q.question_number, q.sub_no)
    if (answerRow) matchPath = 'main'

    // 2.0.0) OCR 拆分映射
    if (!answerRow && !isEmpty) {
      const qNo = Number(q.question_number)
      const indices = qNoIndicesMap.get(qNo) || []
      if (indices.length >= 2) {
        const occ = indices.indexOf(qi) + 1
        const subRow = lookupRow(unitAnswers, qNo, String(occ))
        if (subRow) {
          answerRow = subRow
          const sim = calculateAnswerSimilarity(studentAnswer, subRow.answer)
          let correct = null
          if (sim >= 0.7) correct = true
          else if (sim < 0.5) correct = false
          subBreakdown = [{ sub: String(occ), row: subRow, studentPart: studentAnswer, refPart: subRow.answer, correct, sim }]
          matchPath = 'ocr-split-map'
        }
      }
    }

    // 2.0.1) sub 拆分匹配（优先于相似度兜底，避免提前消费答案行）
    if (!answerRow && !q.sub_no && !isEmpty) {
      const subRows = findSubRowsForQuestion(unitAnswers, q.question_number)
      if (subRows.length >= 1) {
        let parsed = parseSubAnswers(studentAnswer)
        if (parsed.length < 1) parsed = splitBySemicolon(studentAnswer, subRows.length)
        if (parsed.length >= 1) {
          subBreakdown = []
          let refParts = []
          let allCorrect = true
          let anyMatched = false
          for (const { sub, val } of parsed) {
            const sr = subRows.find(s => s.sub === sub)
            if (!sr) continue
            const sim = calculateAnswerSimilarity(val, sr.row.answer)
            let correct = null
            if (sim >= 0.7) correct = true
            else if (sim < 0.5) correct = false
            subBreakdown.push({ sub, row: sr.row, studentPart: val, refPart: sr.row.answer, correct, sim })
            refParts.push(sr.row.answer)
            anyMatched = true
            if (correct === false) allCorrect = false
          }
          if (anyMatched) {
            answerRow = { ...subRows[0].row, answer: refParts.join('; ') }
            matchPath = 'sub-split'
          }
        }
      }
    }

    // 2.0.0b) 相似度兜底（在 sub 拆分之后，避免提前消费答案行）
    if (!answerRow && !isEmpty) {
      const allRows = findAllRowsForQuestion(unitAnswers, q.question_number, usedQKeys)
      if (allRows.length >= 1) {
        let bestRow = null, bestSim = 0, bestSub = '', bestQKey = ''
        for (const { sub, row, qKey } of allRows) {
          const sim = calculateAnswerSimilarity(studentAnswer, row.answer)
          if (sim > bestSim) {
            bestSim = sim
            bestRow = row
            bestSub = sub
            bestQKey = qKey
          }
        }
        if (bestRow && bestSim >= 0.3) {
          answerRow = bestRow
          usedQKeys.add(bestQKey)
          if (bestSub) {
            let correct = null
            if (bestSim >= 0.7) correct = true
            else if (bestSim < 0.5) correct = false
            subBreakdown = [{ sub: bestSub, row: bestRow, studentPart: studentAnswer, refPart: bestRow.answer, correct, sim: bestSim }]
          }
          matchPath = 'sim-fallback'
        }
      }
    }

    // 2.0.2) 整题 fallback
    if (!answerRow && q.sub_no && !isEmpty) {
      const wholeRow = lookupRow(unitAnswers, q.question_number, '')
      if (wholeRow && wholeRow.answer) {
        const subSegs = splitSubAnswersRef(wholeRow.answer)
        if (subSegs && subSegs.length >= 2) {
          const seg = subSegs.find(s => String(s.sub_no) === String(q.sub_no))
          if (seg) {
            const sim = calculateAnswerSimilarity(studentAnswer, seg.answer)
            let correct = null
            if (sim >= 0.7) correct = true
            else if (sim < 0.5) correct = false
            subBreakdown = [{ sub: String(q.sub_no), row: { ...wholeRow, answer: seg.answer }, studentPart: studentAnswer, refPart: seg.answer, correct, sim }]
            answerRow = { ...wholeRow, answer: seg.answer }
            matchPath = 'whole-fallback'
          }
        }
        if (!answerRow) {
          const sim = calculateAnswerSimilarity(studentAnswer, wholeRow.answer)
          if (sim >= 0.5) {
            answerRow = wholeRow
            matchPath = 'whole-fallback-raw'
          }
        }
      }
    }

    // 判分
    let isCorrect = null
    const refAnswer = answerRow ? answerRow.answer : null

    if (subBreakdown && subBreakdown.length >= 1) {
      let allOk = true
      let anyJudged = false
      for (const seg of subBreakdown) {
        if (seg.correct === true) { anyJudged = true; continue }
        if (seg.correct === false) { allOk = false; anyJudged = true }
      }
      isCorrect = anyJudged ? allOk : null
    } else if (answerRow && !isEmpty) {
      // 简化：用 calculateAnswerSimilarity 判分（实际 worker 用 judgeAnswer）
      const sim = calculateAnswerSimilarity(studentAnswer, refAnswer)
      if (sim >= 0.7) isCorrect = true
      else if (sim < 0.5) isCorrect = false
    } else if (isEmpty) {
      isCorrect = null
    }

    // 标记占用
    if (subBreakdown && subBreakdown.length >= 1) {
      for (const seg of subBreakdown) {
        usedQKeys.add(`${Number(q.question_number)}|${seg.sub}`)
      }
    } else if (answerRow) {
      usedQKeys.add(`${Number(q.question_number)}|${q.sub_no || ''}`)
    }

    results.push({
      qi,
      qNo: q.question_number,
      subNo: q.sub_no || null,
      studentAnswer,
      matchedRef: answerRow ? answerRow.answer : null,
      isCorrect,
      matchPath,
      subBreakdown,
    })
  }

  return results
}

// ═══════════════════════════════════════════════════════════════
// 测试场景
// ═══════════════════════════════════════════════════════════════
const scenarios = [
  {
    name: '场景1: OCR 拆分映射 - 过程型答案（同题号多条记录）',
    bank: [
      { qNo: 21, subNo: '1', answer: '2', answer_type: 'fill' },
      { qNo: 21, subNo: '2', answer: '2√10', answer_type: 'fill' },
    ],
    questions: [
      { question_number: 21, sub_no: null, student_answer: '√(12/3)=√4=2' },
      { question_number: 21, sub_no: null, student_answer: '2√(5÷0.5)=2√10' },
    ],
    expect: [
      { matchPath: 'ocr-split-map', isCorrect: true, ref: '2' },
      { matchPath: 'ocr-split-map', isCorrect: true, ref: '2√10' },
    ],
  },
  {
    name: '场景2: 相似度兜底 - 单条记录（不触发拆分映射）',
    bank: [
      { qNo: 21, subNo: '1', answer: '2', answer_type: 'fill' },
      { qNo: 21, subNo: '2', answer: '2√10', answer_type: 'fill' },
    ],
    questions: [
      { question_number: 21, sub_no: null, student_answer: '2√10' },
    ],
    expect: [
      { matchPath: 'sim-fallback', isCorrect: true, ref: '2√10' },
    ],
  },
  {
    name: '场景3: sub 拆分匹配 - student_answer 含 (1)(2) 标记',
    bank: [
      { qNo: 21, subNo: '1', answer: '2', answer_type: 'fill' },
      { qNo: 21, subNo: '2', answer: '2√10', answer_type: 'fill' },
    ],
    questions: [
      { question_number: 21, sub_no: null, student_answer: '(1) 2 (2) 2√10' },
    ],
    expect: [
      { matchPath: 'sub-split', isCorrect: true },
    ],
  },
  {
    name: '场景3b: sub 拆分匹配 - 含 (1)(2) 标记 + ；分隔符（parseSubAnswers 优先）',
    bank: [
      { qNo: 21, subNo: '1', answer: '2', answer_type: 'fill' },
      { qNo: 21, subNo: '2', answer: '√10', answer_type: 'fill' },
    ],
    questions: [
      { question_number: 21, sub_no: null, student_answer: '（1）√14；2 （2）2√10；√10' },
    ],
    expect: [
      { matchPath: 'sub-split', isCorrect: true },
    ],
  },
  {
    name: '场景4: 整题 fallback - 答案库只有整题行',
    bank: [
      { qNo: 22, subNo: '', answer: '(1)14 (2)-1', answer_type: 'fill' },
    ],
    questions: [
      { question_number: 22, sub_no: '1', student_answer: '14' },
      { question_number: 22, sub_no: '2', student_answer: '-1' },
    ],
    expect: [
      { matchPath: 'whole-fallback', isCorrect: true, ref: '14' },
      { matchPath: 'whole-fallback', isCorrect: true, ref: '-1' },
    ],
  },
  {
    name: '场景5: 相似度兜底 - 过程型答案收窄后匹配',
    bank: [
      { qNo: 23, subNo: '1', answer: '36', answer_type: 'fill' },
      { qNo: 23, subNo: '2', answer: '-1', answer_type: 'fill' },
    ],
    questions: [
      { question_number: 23, sub_no: null, student_answer: '8-9=-1' },
    ],
    expect: [
      { matchPath: 'sim-fallback', isCorrect: true, ref: '-1' },
    ],
  },
]

// ── 运行测试 ──
console.log('═══════════════════════════════════════════════════')
console.log('  OCR 拆分映射 + 相似度兜底 测试（含收窄修复）')
console.log('═══════════════════════════════════════════════════\n')

let allPassed = true

for (const sc of scenarios) {
  console.log(`\n── ${sc.name} ──`)
  const unitAnswers = buildAnswerBank(sc.bank)
  const results = simulateGrading(unitAnswers, JSON.parse(JSON.stringify(sc.questions)))
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const exp = sc.expect[i]
    const pathOk = r.matchPath === exp.matchPath
    const correctOk = r.isCorrect === exp.isCorrect
    const refOk = !exp.ref || r.matchedRef === exp.ref
    const ok = pathOk && correctOk && refOk
    console.log(`  q${r.qNo} sub=${r.subNo} ans="${r.studentAnswer.slice(0, 35)}" → path=${r.matchPath} ref="${r.matchedRef}" correct=${r.isCorrect} ${ok ? '✅' : '❌ 期望 path=' + exp.matchPath + ' correct=' + exp.isCorrect + (exp.ref ? ' ref=' + exp.ref : '')}`)
    if (!ok) allPassed = false
  }
}

console.log('\n═══════════════════════════════════════════════════')
console.log(allPassed ? '✅ 全部测试通过（收窄修复后）' : '❌ 有测试失败')
console.log('═══════════════════════════════════════════════════')

process.exit(allPassed ? 0 : 1)
