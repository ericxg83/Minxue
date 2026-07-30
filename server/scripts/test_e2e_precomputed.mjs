// 预埋答案（precomputed answers）端到端测试
//
// 链路：
//   1) 调用方 POST /worksheets/:id/parse-pdf，formData.precomputed_answers = JSON
//   2) route 解析 → 归一化 → 写入 resource_answers + resource_units
//   3) 学生上传作业 → worker 端 processWorkbookGrading：
//      - OCR 提取 page_title + 每题 question_number
//      - pickAnswerUnit(answersByUnit, pageTitle, questions) → unitKey
//      - 在该 unit 索引里查找 row，按 judgeAnswer 判定对错
//
// 此测试不依赖真实 DB/AI，复刻 route 的归一化逻辑 + worker 的 pickAnswerUnit 路径，
// 验证：1) 预埋答案正确归一化（unit_key / unit_title / lesson_code 完整）
//      2) 学生 OCR 标题（圈序号 / 阿拉伯数字 / 多空白）能命中预埋答案的单元
//      3) 题号 + 题型能正确匹配，judgeAnswer 结果对得上
//
// 用法：node server/scripts/test_e2e_precomputed.mjs

import { parseAnswerText, normalizeSectionName, parseUnitHeader, normLesson } from '../services/answerParseService.js'
import { judgeAnswer } from '../services/judgeService.js'

let pass = 0, fail = 0
const eq = (a, e, label) => {
  const ja = JSON.stringify(a), je = JSON.stringify(e)
  if (ja === je) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.error(`  ✗ ${label}\n    expect: ${je}\n    actual: ${ja}`) }
}

console.log('==== [1/4] 预埋答案归一化（route 入口的逻辑）====')

// ── 复刻 worksheets.js 中 precomputedAnswers.map(...) 的归一化逻辑 ──
const JUDGE_SYMBOL_RE = /^[✓√✔✗✘×]$/
function normalizePrecomputed(raw) {
  return raw.filter(a =>
    a && typeof a.question_no !== 'undefined' && typeof a.answer !== 'undefined'
  ).map(a => {
    let unitKey = a.unit_key ? String(a.unit_key).trim() : null
    let unitTitle = a.unit_title ? normalizeSectionName(a.unit_title) : null
    let lessonCode = a.lesson_code ? normLesson(a.lesson_code) : null
    let ordinal = null

    if (!unitKey || !unitTitle) {
      const headerSrc = a.unit || a.unit_title
      if (headerSrc) {
        const parsed2 = parseUnitHeader(String(headerSrc))
        if (parsed2) {
          if (!unitKey) unitKey = parsed2.unit_key
          if (!unitTitle) unitTitle = parsed2.unit_title
          if (!lessonCode && parsed2.lesson_code) lessonCode = parsed2.lesson_code
          ordinal = parsed2.ordinal ?? null
        }
      }
    }

    const ans = String(a.answer).trim()
    return {
      question_no: parseInt(a.question_no, 10),
      answer: String(a.answer),
      // answer_type 缺省时按答案形态推断：A-D → choice，√× → judge，其它 → answer
      answer_type: a.answer_type || (JUDGE_SYMBOL_RE.test(ans)
        ? 'judge'
        : (/^[A-Da-d]$/.test(ans) ? 'choice' : 'answer')),
      section: normalizeSectionName(a.section),
      content: (a.content != null && String(a.content).trim()) ? String(a.content).trim() : null,
      unit_key: unitKey || null,
      unit_title: unitTitle || null,
      lesson_code: lessonCode || null,
      ordinal: ordinal,
      sub_no: a.sub_no != null ? String(a.sub_no) : '',
      confidence: 1.0,
    }
  })
}

// ── 场景 A：调用方直接给 unit_key + unit_title + lesson_code ──
const inputA = [
  { question_no: 1, answer: '2017', answer_type: 'answer', section: '一、填空题',
    unit_key: '堂堂练1|19.1(1)', unit_title: '堂堂练① 19.1(1) 算术平方根', lesson_code: '19.1(1)' },
  { question_no: 13, answer: 'D', answer_type: 'choice', section: '二、选择题',
    unit_key: '堂堂练1|19.1(1)', unit_title: '堂堂练① 19.1(1) 算术平方根', lesson_code: '19.1(1)' },
]
const outA = normalizePrecomputed(inputA)
eq(outA.length, 2, 'A: 直传 unit_key 两条原样输出')
eq(outA[0].unit_key, '堂堂练1|19.1(1)', 'A: unit_key 直传保留')
eq(outA[0].lesson_code, '19.1(1)', 'A: lesson_code 直传保留')
eq(outA[0].unit_title, '堂堂练①19.1(1)算术平方根', 'A: unit_title 归一化（去空白）')
eq(outA[0].section, '一、填空题', 'A: section 归一化（去空白）')
eq(outA[0].confidence, 1.0, 'A: 预埋答案 confidence=1.0')

// ── 场景 B：调用方只给 unit_title，由 parseUnitHeader 推导 unit_key ──
const inputB = [
  { question_no: 1, answer: '63', section: '一、填空题',
    unit_title: '堂堂练② 19.1(2) 平方根' },
  { question_no: 13, answer: 'A', section: '二、选择题',
    unit_title: '堂堂练② 19.1(2) 平方根' },
]
const outB = normalizePrecomputed(inputB)
eq(outB[0].unit_key, '堂堂练2|19.1(2)', 'B: 由 unit_title 推 unit_key（圈序号②→2）')
eq(outB[0].unit_title, '堂堂练②19.1(2)平方根', 'B: unit_title 归一化（去空白）')
eq(outB[0].lesson_code, '19.1(2)', 'B: 由 unit_title 推 lesson_code')
eq(outB[0].ordinal, 2, 'B: ordinal 从圈序号推得')

// ── 场景 C：调用方给"第N课时"格式 ──
const inputC = [
  { question_no: 5, answer: '√2', section: '一、填空题',
    unit: '第3课时 二次根式的加减' },
]
const outC = normalizePrecomputed(inputC)
eq(outC[0].unit_key?.startsWith('第3课时'), true, 'C: 第N课时格式推 unit_key')
eq(outC[0].lesson_code === '19.3(1)' || outC[0].lesson_code === null, true, 'C: 接受 lesson_code 为 null')

// ── 场景 D：调用方完全不给单元信息 → 单元字段应全为 null，不抛错 ──
const inputD = [
  { question_no: 1, answer: 'A', section: '一、选择题' },
]
const outD = normalizePrecomputed(inputD)
eq(outD[0].unit_key, null, 'D: 无单元信息时 unit_key=null')
eq(outD[0].unit_title, null, 'D: 无单元信息时 unit_title=null')
eq(outD[0].section, '一、选择题', 'D: section 仍归一化')

// ── 场景 E：多空题（子题）通过 sub_no 拆分 ──
const inputE = [
  { question_no: 2, answer: '7/2', sub_no: '1', section: '一、填空题',
    unit_key: '堂堂练1|19.1(1)', unit_title: '堂堂练① 19.1(1) 算术平方根', lesson_code: '19.1(1)' },
  { question_no: 2, answer: '4/3', sub_no: '2', section: '一、填空题',
    unit_key: '堂堂练1|19.1(1)', unit_title: '堂堂练① 19.1(1) 算术平方根', lesson_code: '19.1(1)' },
]
const outE = normalizePrecomputed(inputE)
eq(outE.length, 2, 'E: 同题号多 sub_no 不合并')
eq(outE[0].sub_no, '1', 'E: sub_no 1 落对')
eq(outE[1].sub_no, '2', 'E: sub_no 2 落对')

// ── 场景 F：题号非数字 / 缺 answer 字段应被过滤掉 ──
// route 的 filter 实际只挡 "a 本身为 null/undefined"、"缺 question_no"、"缺 answer" 三类。
// 非数字 question_no（如 'foo'）会通过 filter，但 parseInt 后变 NaN，存到 DB 是无效行；
// 这种属于"由调用方负责保证题号为数字"，route 端不再做额外检查。
const inputF = [
  { question_no: 1, answer: 'A' },     // 合法
  { question_no: 'foo', answer: 'B' },  // 题号非数字（route 不过滤，存为 NaN）
  { question_no: 2 },                   // 缺 answer
  null,                                 // null 项
  { answer: 'C' },                      // 缺 question_no
]
const outF = normalizePrecomputed(inputF)
eq(outF.length, 2, 'F: 过滤掉 null/缺 question_no/缺 answer（非数字题号保留）')
eq(outF.find(a => a.question_no === 1)?.answer, 'A', 'F: 合法数字题号保留')

console.log('\n==== [2/4] 归一化结果构建 3D 答案库（getWorksheetAnswersBySection 结构）====')

// 合并归一化后的答案，模拟数据库读出后构建的 3D Map
const allPrecomputed = [...outA, ...outB, ...outE]
function buildAnswersByUnit(answers) {
  const NO_UNIT = '__no_unit__'
  const result = new Map()
  for (const a of answers) {
    const uKey = a.unit_key || NO_UNIT
    const sKey = a.section || ''
    const qKey = `${Number(a.question_no)}|${a.sub_no || ''}`
    if (!result.has(uKey)) result.set(uKey, new Map())
    const sec = result.get(uKey)
    if (!sec.has(sKey)) sec.set(sKey, new Map())
    sec.get(sKey).set(qKey, {
      answer: a.answer,
      answer_type: a.answer_type,
      content: a.content || null,
      unit_id: null,
      unit_key: a.unit_key,
      unit_title: a.unit_title,
      unit_seq: null,
      section: a.section,
      sub_no: a.sub_no || '',
    })
  }
  return result
}
const answersByUnit = buildAnswersByUnit(allPrecomputed)
eq(answersByUnit.size, 2, '3D Map 应有 2 个单元（堂堂练1、堂堂练2）')
const u1 = answersByUnit.get('堂堂练1|19.1(1)')
const u2 = answersByUnit.get('堂堂练2|19.1(2)')
eq(!!u1, true, '堂堂练1|19.1(1) 单元存在')
eq(!!u2, true, '堂堂练2|19.1(2) 单元存在')
eq(u1.get('一、填空题').get('1|').answer, '2017', '堂堂练1 第1题答案=2017')
eq(u1.get('一、填空题').get('2|1').answer, '7/2', '堂堂练1 第2题 sub=1 答案=7/2')
eq(u1.get('一、填空题').get('2|2').answer, '4/3', '堂堂练1 第2题 sub=2 答案=4/3')
eq(u2.get('一、填空题').get('1|').answer, '63', '堂堂练2 第1题答案=63')

console.log('\n==== [3/4] 学生 OCR 标题 → pickAnswerUnit 匹配 ====')

const { pickAnswerUnit } = await import('../worker.js').catch(() => ({}))

if (!pickAnswerUnit) {
  console.error('  ✗ pickAnswerUnit 不可用，worker.js 加载失败')
  fail += 10
} else {
  // 学生页 1：标题里有圈序号 ①（与预埋的"堂堂练1|19.1(1)"对应）
  const m1 = pickAnswerUnit(
    answersByUnit,
    '堂堂练① 19.1(1) 算术平方根',
    [{ question_number: 1 }, { question_number: 13 }]
  )
  eq(m1, '堂堂练1|19.1(1)', '学生页① → 单元 1')

  // 学生页 1 变体：标题里被 OCR 误识别为阿拉伯 1（不是圈序号）
  const m1b = pickAnswerUnit(
    answersByUnit,
    '堂堂练1  19.1(1)  算术平方根',
    [{ question_number: 1 }, { question_number: 13 }]
  )
  eq(m1b, '堂堂练1|19.1(1)', '学生页（圈序号误识为阿拉伯 1）→ 单元 1')

  // 学生页 1 变体：标题里有额外空白
  const m1c = pickAnswerUnit(
    answersByUnit,
    '  堂堂练①  19.1(1)  算术平方根  ',
    [{ question_number: 1 }, { question_number: 13 }]
  )
  eq(m1c, '堂堂练1|19.1(1)', '学生页（带边缘空白）→ 单元 1')

  // 学生页 2：堂堂练②
  const m2 = pickAnswerUnit(
    answersByUnit,
    '堂堂练② 19.1(2) 平方根',
    [{ question_number: 1 }, { question_number: 13 }]
  )
  eq(m2, '堂堂练2|19.1(2)', '学生页② → 单元 2')

  // 学生页 2 变体：圈序号 ⑩（不在预埋范围，但应通过覆盖率兜底或返回 null）
  // 预埋单元里 1/13/16 都命中单元 1、单元 2，60% 门槛会乱挂 —— 这是已知缺陷，此处仅验证不抛错
  const mWeird = pickAnswerUnit(
    answersByUnit,
    '堂堂练⑩ 21.2(3)',
    [{ question_number: 1 }, { question_number: 13 }]
  )
  console.log(`  ℹ 圈序号⑩（预埋未含）→ ${mWeird}（可能是错的，60% 门槛兜底）`)

  // 学生页：唯一单元（只剩单元 1）应直接命中
  const onlyU1 = new Map([['堂堂练1|19.1(1)', u1]])
  const mOnly = pickAnswerUnit(onlyU1, null, [{ question_number: 1 }])
  eq(mOnly, '堂堂练1|19.1(1)', '唯一单元时无标题也直接命中')
}

console.log('\n==== [4/4] 学生答案 vs 预埋答案：judgeAnswer 判定 ====')

// ── 选择题：字母一致 → 正确；不一致 → 错 ──
eq(judgeAnswer('D', 'D', 'choice').isCorrect, true, '选择题 D=D → 正确')
eq(judgeAnswer('A', 'D', 'choice').isCorrect, false, '选择题 A≠D → 错')
eq(judgeAnswer('A', 'A', 'choice').isCorrect, true, '选择题 A=A → 正确')

// ── 填空题：精确比对（含去空白 + 大小写不敏感）──
eq(judgeAnswer('2017', '2017', 'answer').isCorrect, true, '填空 2017=2017 → 正确')
eq(judgeAnswer('2018', '2017', 'answer').isCorrect, false, '填空 2018≠2017 → 错')
eq(judgeAnswer('7/2', '7/2', 'answer').isCorrect, true, '子题 7/2=7/2 → 正确')
eq(judgeAnswer('  7/2  ', '7/2', 'answer').isCorrect, true, '子题去空白后命中')

// ── 判断题：√× ──
eq(judgeAnswer('√', '√', 'judge').isCorrect, true, '判断 √=√ → 正确')
eq(judgeAnswer('×', '×', 'judge').isCorrect, true, '判断 ×=× → 正确')
eq(judgeAnswer('√', '×', 'judge').isCorrect, false, '判断 √≠× → 错')

// ── 模拟 processWorkbookGrading 的逐题匹配循环 ──
console.log('\n==== [5/4] 完整链路模拟：学生页 → 选单元 → 查答案 → 判定 ====')

function simulatePage(answersByUnit, pageTitle, ocrQuestions) {
  // 与 worker.js 里的 processWorkbookGrading 完全一致：pickAnswerUnit → lookupRow → judgeAnswer
  const matchedUnit = pickAnswerUnit(answersByUnit, pageTitle, ocrQuestions)
  const unitAnswers = matchedUnit != null ? answersByUnit.get(matchedUnit) : null
  const results = []
  for (const q of ocrQuestions) {
    if (q.question_number == null) continue
    let row = null
    if (unitAnswers) {
      const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
      for (const qMap of unitAnswers.values()) {
        if (qMap.has(qKey)) { row = qMap.get(qKey); break }
      }
    }
    if (!row) { results.push({ ...q, is_correct: null, reason: 'no_match' }); continue }
    const j = judgeAnswer(q.student_answer, row.answer, row.answer_type)
    results.push({ ...q, answer: row.answer, is_correct: j.isCorrect, matched_unit: matchedUnit })
  }
  return results
}

// 学生做完单元 1：第 1 题答错、第 13 题答对、第 2(1) 答对、第 2(2) 答错
const page1Results = simulatePage(answersByUnit,
  '堂堂练① 19.1(1) 算术平方根',
  [
    { question_number: 1, question_type: 'answer', student_answer: '2018' },
    { question_number: 13, question_type: 'choice', student_answer: 'D' },
    { question_number: 2, sub_no: '1', question_type: 'answer', student_answer: '7/2' },
    { question_number: 2, sub_no: '2', question_type: 'answer', student_answer: '4/4' },
  ]
)
eq(page1Results.length, 4, '学生页 1 共 4 题')
eq(page1Results[0].is_correct, false, '学生页 1 第 1 题（2018 vs 2017）→ 错')
eq(page1Results[1].is_correct, true,  '学生页 1 第 13 题（D vs D）→ 对')
eq(page1Results[2].is_correct, true,  '学生页 1 第 2(1) 题（7/2 vs 7/2）→ 对')
eq(page1Results[3].is_correct, false, '学生页 1 第 2(2) 题（4/4 vs 4/3）→ 错')
eq(page1Results.every(r => r.matched_unit === '堂堂练1|19.1(1)'), true, '所有题均挂在单元 1 下')

// 学生做完单元 2：第 1 题答对、第 13 题答错
const page2Results = simulatePage(answersByUnit,
  '堂堂练② 19.1(2) 平方根',
  [
    { question_number: 1, question_type: 'answer', student_answer: '63' },
    { question_number: 13, question_type: 'choice', student_answer: 'B' },
  ]
)
eq(page2Results[0].is_correct, true,  '学生页 2 第 1 题（63 vs 63）→ 对')
eq(page2Results[1].is_correct, false, '学生页 2 第 13 题（B vs A）→ 错')
eq(page2Results.every(r => r.matched_unit === '堂堂练2|19.1(2)'), true, '所有题均挂在单元 2 下')

// 学生页 1 的题号 1 若 OCR 成 1 但学生填单元 2 的答案 → 应被判错（因为匹配的是单元 1 答案库）
const pageCrossTest = simulatePage(answersByUnit,
  '堂堂练① 19.1(1) 算术平方根',  // 标题属于单元 1
  [
    { question_number: 1, question_type: 'answer', student_answer: '63' },  // 但学生写了单元 2 的答案
  ]
)
eq(pageCrossTest[0].is_correct, false, '跨单元内容不会误判：学生答 63、单元 1 答案 2017 → 错')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
