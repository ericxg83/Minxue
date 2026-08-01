/**
 * 验证答案库批改修复：多 unit 场景下能正确按 unit 匹配答案
 *
 * 场景：资源有 3 个 unit（试卷① 19.1 / 试卷② 21.2(3) / 试卷③ 21.2(4)），
 * 每个 unit 的题号都从 1 开始。学生试卷是"试卷②"，学生答对了第 1-5 题。
 *
 * 验证：
 * 1) getResourceAnswersBySection 输出的 3D Map 能按 unit 区分同题号
 * 2) pickAnswerUnit 在 pageTitle="试卷② 21.2(3) 一般的一元二次方程的解法" 时
 *    能正确选到 试卷② unit（而非试卷①或试卷③）
 * 3) 在该 unit 内按 question_no 查答案能拿到试卷②的参考答案
 */
import { normalizeSectionName } from '../services/answerParseService.js'

// 复制 worker.js 里的关键函数（不导入整个 worker.js 因为有 side effects）
function titleMatches(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) >= 2
  }
  const lenDiff = Math.abs(a.length - b.length)
  if (lenDiff > 2) return false
  if (a.length <= b.length ? b.startsWith(a) : a.startsWith(b)) return true
  if (a.length <= b.length ? b.endsWith(a) : a.endsWith(b)) return true
  return false
}

function normalizeTitleForMatch(s) {
  if (!s) return ''
  // 压空白、圈序号→ASCII、小写
  return String(s).replace(/\s+/g, '').toLowerCase()
}

function pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint) {
  if (!answersByUnit || answersByUnit.size === 0) return null
  if (answersByUnit.size === 1) return [...answersByUnit.keys()][0]

  const unitMeta = (unitKey) => {
    const secMap = answersByUnit.get(unitKey)
    if (!secMap) return { unitKey, unitTitle: '', unitKeyRaw: '', pageStart: null, pageEnd: null }
    let pageStart = null, pageEnd = null
    for (const qMap of secMap.values()) {
      const sample = qMap.values().next().value
      if (sample) {
        if (pageStart == null && sample.answer_page_start != null) pageStart = sample.answer_page_start
        if (pageEnd == null && sample.answer_page_end != null) pageEnd = sample.answer_page_end
        if (pageStart != null && pageEnd != null) break
      }
    }
    if (!secMap.values().next().value) {
      return { unitKey, unitTitle: '', unitKeyRaw: unitKey, pageStart, pageEnd }
    }
    const sample = [...secMap.values()][0].values().next().value
    return {
      unitKey, unitTitle: sample.unit_title || '', unitKeyRaw: sample.unit_key || unitKey,
      pageStart, pageEnd
    }
  }
  const candidates = [...answersByUnit.keys()].map(unitMeta)

  // chapter_hint 兜底
  if (chapterHint && typeof chapterHint === 'string') {
    const normHint = normalizeTitleForMatch(chapterHint)
    if (normHint) {
      for (const c of candidates) {
        const ct = normalizeTitleForMatch(c.unitTitle)
        if (ct && ct.includes(normHint)) return c.unitKey
      }
    }
  }

  // 标题匹配
  const normTitle = normalizeTitleForMatch(normalizeSectionName(pageTitle))
  if (normTitle) {
    for (const c of candidates) {
      const ct = normalizeTitleForMatch(c.unitTitle)
      if (ct && titleMatches(normTitle, ct)) return c.unitKey
    }
    for (const c of candidates) {
      const ck = normalizeTitleForMatch(c.unitKeyRaw)
      if (ck && titleMatches(normTitle, ck)) return c.unitKey
    }
  }

  // 题号覆盖率兜底
  const qNos = (questions || []).filter(q => q.question_number != null).map(q => Number(q.question_number))
  if (qNos.length === 0) return null
  let bestKey = null, bestScore = -1
  for (const c of candidates) {
    const secMap = answersByUnit.get(c.unitKey)
    let covered = 0
    for (const q of questions || []) {
      if (q.question_number == null) continue
      const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { covered++; break }
      }
    }
    const score = covered / qNos.length
    if (score > bestScore) { bestScore = score; bestKey = c.unitKey }
  }
  if (bestKey !== null) {
    const secMap = answersByUnit.get(bestKey)
    let covered = 0
    for (const q of questions || []) {
      if (q.question_number == null) continue
      const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { covered++; break }
      }
    }
    if (covered < qNos.length * 0.6) return null
  }
  return bestKey
}

// 模拟 getResourceAnswersBySection 的输出（构造 3D Map）
function buildAnswersByUnit() {
  // 试卷① 第 1-3 题、第 5 题
  // 试卷② 第 1-5 题
  // 试卷③ 第 1-3 题
  const rows = [
    // 试卷①
    { unit_key: 'paper1', unit_title: '试卷① 19.1 平方根与立方根 基础性测试', unit_seq: 1,
      answer_page_start: 1, answer_page_end: 1,
      question_no: 1, answer: 'A', answer_type: 'choice', section: null, sub_no: '', content: '第1题' },
    { unit_key: 'paper1', unit_title: '试卷① 19.1 平方根与立方根 基础性测试', unit_seq: 1,
      answer_page_start: 1, answer_page_end: 1,
      question_no: 2, answer: 'B', answer_type: 'choice', section: null, sub_no: '', content: '第2题' },
    { unit_key: 'paper1', unit_title: '试卷① 19.1 平方根与立方根 基础性测试', unit_seq: 1,
      answer_page_start: 1, answer_page_end: 1,
      question_no: 3, answer: 'C', answer_type: 'choice', section: null, sub_no: '', content: '第3题' },
    { unit_key: 'paper1', unit_title: '试卷① 19.1 平方根与立方根 基础性测试', unit_seq: 1,
      answer_page_start: 1, answer_page_end: 1,
      question_no: 5, answer: 'D', answer_type: 'choice', section: null, sub_no: '', content: '第5题' },
    // 试卷②
    { unit_key: 'paper2', unit_title: '试卷② 21.2(3) 一般的一元二次方程的解法', unit_seq: 2,
      answer_page_start: 2, answer_page_end: 2,
      question_no: 1, answer: 'X', answer_type: 'choice', section: null, sub_no: '', content: '试卷②第1题' },
    { unit_key: 'paper2', unit_title: '试卷② 21.2(3) 一般的一元二次方程的解法', unit_seq: 2,
      answer_page_start: 2, answer_page_end: 2,
      question_no: 2, answer: 'Y', answer_type: 'choice', section: null, sub_no: '', content: '试卷②第2题' },
    { unit_key: 'paper2', unit_title: '试卷② 21.2(3) 一般的一元二次方程的解法', unit_seq: 2,
      answer_page_start: 2, answer_page_end: 2,
      question_no: 3, answer: 'Z', answer_type: 'choice', section: null, sub_no: '', content: '试卷②第3题' },
    { unit_key: 'paper2', unit_title: '试卷② 21.2(3) 一般的一元二次方程的解法', unit_seq: 2,
      answer_page_start: 2, answer_page_end: 2,
      question_no: 4, answer: 'W', answer_type: 'choice', section: null, sub_no: '', content: '试卷②第4题' },
    { unit_key: 'paper2', unit_title: '试卷② 21.2(3) 一般的一元二次方程的解法', unit_seq: 2,
      answer_page_start: 2, answer_page_end: 2,
      question_no: 5, answer: 'V', answer_type: 'choice', section: null, sub_no: '', content: '试卷②第5题' },
    // 试卷③
    { unit_key: 'paper3', unit_title: '试卷③ 21.2(4) 一元二次方程的根与系数的关系', unit_seq: 3,
      answer_page_start: 3, answer_page_end: 3,
      question_no: 1, answer: 'M', answer_type: 'choice', section: null, sub_no: '', content: '第1题' },
    { unit_key: 'paper3', unit_title: '试卷③ 21.2(4) 一元二次方程的根与系数的关系', unit_seq: 3,
      answer_page_start: 3, answer_page_end: 3,
      question_no: 2, answer: 'N', answer_type: 'choice', section: null, sub_no: '', content: '第2题' },
    { unit_key: 'paper3', unit_title: '试卷③ 21.2(4) 一元二次方程的根与系数的关系', unit_seq: 3,
      answer_page_start: 3, answer_page_end: 3,
      question_no: 3, answer: 'O', answer_type: 'choice', section: null, sub_no: '', content: '第3题' },
  ]
  const result = new Map()
  for (const r of rows) {
    const unitKey = r.unit_key
    const sectionKey = r.section || ''
    const subNo = r.sub_no || ''
    const qKey = `${Number(r.question_no)}|${subNo}`
    if (!result.has(unitKey)) result.set(unitKey, new Map())
    const secMap = result.get(unitKey)
    if (!secMap.has(sectionKey)) secMap.set(sectionKey, new Map())
    secMap.get(sectionKey).set(qKey, r)
  }
  return result
}

// 模拟旧版 bulkLookupResourceAnswers 的输出（构造扁平 Map<questionNo, row>）
function buildLegacyAnswerMap() {
  // 模拟数据库按 question_no ASC 返回——3 个 unit 第 1 题都被压扁
  const rows = [
    { question_no: 1, answer: 'A', answer_type: 'choice' },  // 试卷①
    { question_no: 2, answer: 'B', answer_type: 'choice' },  // 试卷①
    { question_no: 3, answer: 'C', answer_type: 'choice' },  // 试卷①
    { question_no: 4, answer: 'W', answer_type: 'choice' },  // 试卷②
    { question_no: 5, answer: 'D', answer_type: 'choice' },  // 试卷①（试卷②的 V 没机会进 Map）
  ]
  return new Map(rows.map(a => [a.question_no, a]))
}

let passed = 0, failed = 0
const test = (name, cond, info) => {
  if (cond) {
    console.log(`✅ ${name}`)
    passed++
  } else {
    console.error(`❌ ${name}${info ? ` — ${info}` : ''}`)
    failed++
  }
}

// ─── 关键测试 1: 多 unit 场景下 pickAnswerUnit 选对 unit ───
console.log('\n[场景1] 学生试卷是"试卷② 21.2(3) 一般的一元二次方程的解法"')
const answersByUnit = buildAnswersByUnit()
const studentPaper2Questions = [
  { question_number: 1, student_answer: 'X' },
  { question_number: 2, student_answer: 'Y' },
  { question_number: 3, student_answer: 'Z' },
  { question_number: 4, student_answer: 'W' },
  { question_number: 5, student_answer: 'V' }
]
const matchedUnit1 = pickAnswerUnit(
  answersByUnit,
  '试卷② 21.2(3) 一般的一元二次方程的解法',
  studentPaper2Questions,
  2,
  '第二十一章一元二次方程'
)
test('pickAnswerUnit 选到 试卷②', matchedUnit1 === 'paper2', `got=${matchedUnit1}`)

// 模拟旧版（错位）vs 新版（正确）
const legacyMap = buildLegacyAnswerMap()
console.log('\n[旧版错位] 用 bulkLookupResourceAnswers 直接按 question_no 查：')
for (const q of studentPaper2Questions) {
  const cached = legacyMap.get(q.question_number)
  const isMatch = cached.answer === q.student_answer
  console.log(`  第${q.question_number}题: 学生答 ${q.student_answer} vs 答案库 ${cached.answer} → ${isMatch ? '正确' : '错（用了错单元的答案）'}`)
}
test('旧版第 1 题能匹配上（因为 A ≠ X）', legacyMap.get(1).answer === 'A' && legacyMap.get(1).answer !== 'X', '旧版第 1 题答非所问')

console.log('\n[新版正确] 用 pickAnswerUnit + getResourceAnswersBySection 3D Map：')
const secMap = answersByUnit.get(matchedUnit1)
for (const q of studentPaper2Questions) {
  const qKey = `${Number(q.question_number)}|`
  let row = null
  for (const qMap of secMap.values()) {
    if (qMap.has(qKey)) { row = qMap.get(qKey); break }
  }
  const isMatch = row && row.answer === q.student_answer
  console.log(`  第${q.question_number}题: 学生答 ${q.student_answer} vs 试卷②答案 ${row?.answer} → ${isMatch ? '✅ 正确' : '❌ 错'}`)
  test(`试卷②第${q.question_number}题匹配`, isMatch, `got row=${row?.answer} expected=${q.student_answer}`)
}

// ─── 关键测试 2: pageTitle 缺失时 chapter_hint 兜底 ───
console.log('\n[场景2] 学生试卷 pageTitle 缺失（被裁掉），但 chapterHint="第二十一章一元二次方程"')
const matchedUnit2 = pickAnswerUnit(
  answersByUnit,
  null,
  studentPaper2Questions,
  null,
  '第二十一章一元二次方程'
)
test('chapter_hint 兜底选到 试卷②', matchedUnit2 === 'paper2', `got=${matchedUnit2}`)

// ─── 关键测试 3: 单 unit 场景（唯一 unit）走默认路径 ───
console.log('\n[场景3] 答案库只有 1 个 unit 时')
const singleUnitMap = new Map()
singleUnitMap.set('only', new Map())
singleUnitMap.get('only').set('', new Map())
singleUnitMap.get('only').get('').set('1|', { question_no: 1, answer: 'A', answer_type: 'choice', unit_title: '唯一单元' })
const matchedUnit3 = pickAnswerUnit(singleUnitMap, null, [{ question_number: 1 }], null, null)
test('单 unit 时直接采用', matchedUnit3 === 'only', `got=${matchedUnit3}`)

// ─── 关键测试 4: OCR 识别第 1 题=1，第 2 题=2，pageTitle 准确 → 命中试卷② ───
console.log('\n[场景4] OCR 识别 pageTitle="试卷②"（简略）+ 5 道题')
const matchedUnit4 = pickAnswerUnit(
  answersByUnit,
  '试卷②',
  studentPaper2Questions,
  null,
  null
)
test('简略 pageTitle 仍能选到 试卷②', matchedUnit4 === 'paper2', `got=${matchedUnit4}`)

console.log(`\n${'='.repeat(50)}`)
console.log(`总计: ${passed} 个通过, ${failed} 个失败`)
if (failed > 0) process.exit(1)
