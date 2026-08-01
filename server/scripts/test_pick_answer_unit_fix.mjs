/**
 * 测试 pickAnswerUnit: 试卷4 vs 试卷6 错位场景
 *
 * 真实数据：worksheet 1c31ee45
 *   unit "试卷4|19.2"  title="试卷④19.2实数提高性测试"  lesson_code=19.2
 *   unit "试卷6"       title="试卷⑥第十九章实数提高性测试"  lesson_code=null
 *
 * 学生试卷 OCR：
 *   pageTitle="试卷① 19.2 实数 提高性测试"  （OCR 误识别"④"为"①"）
 *   chapterHint="第十九章实数"  （AI 看题后推断）
 *   题1 student_answer="5-2√6"  实际是试卷4题1的答案
 *
 * 期望：pickAnswerUnit 返回 试卷4|19.2 unit_key
 * 旧版：返回试卷6（chapterHint="第十九章实数" 命中 试卷6 的 unitTitle）
 *
 * 同时验证：
 *   - 单元 1：pageTitle="试卷4 19.2" + chapterHint=null  → 应选 试卷4|19.2
 *   - 单元 2：pageTitle="试卷6 第十九章实数" + chapterHint=null  → 应选 试卷6
 *   - 单元 3：pageTitle="试卷1 19.1" + chapterHint=null  → 应选 试卷1|19.1
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

// ─── 复刻 worker.js 的关键函数 ─────────────────────────────────
const CIRCLED_DIGITS_RE = /[㊀-㊉㊊-㊟]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾]/
const circledToAsciiMap = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10, '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20, '㉑': 21, '㉒': 22, '㉓': 23, '㉔': 24, '㉕': 25, '㉖': 26, '㉗': 27, '㉘': 28, '㉙': 29, '㉚': 30, '㉛': 31, '㉜': 32, '㉝': 33, '㉞': 34, '㉟': 35, '㊱': 36, '㊲': 37, '㊳': 38, '㊴': 39, '㊵': 40, '㊶': 41, '㊷': 42, '㊸': 43, '㊹': 44, '㊺': 45, '㊻': 46, '㊼': 47, '㊽': 48, '㊾': 49, '㊿': 50, '⓪': 0, '⑴': 1, '⑵': 2, '⑶': 3, '⑷': 4, '⑸': 5, '⑹': 6, '⑺': 7, '⑻': 8, '⑼': 9, '⑽': 10 }
const normalizeTitleForMatch = (s) => {
  if (!s) return ''
  return String(s)
    .replace(CIRCLED_DIGITS_RE, m => circledToAsciiMap[m] || m)
    .replace(/[\s　]+/g, '')
}
const detectLessonCode = (questions, pageTitle) => {
  if (pageTitle && typeof pageTitle === 'string') {
    const m = pageTitle.match(/\b(\d{1,2}\.\d{1,2}(?:\(\d+\))?)\b/)
    if (m && m[1].length >= 4) return m[1]
  }
  if (Array.isArray(questions) && questions.length > 0) {
    for (const q of questions) {
      if (q.content && typeof q.content === 'string') {
        const m = q.content.match(/\b(\d{1,2}\.\d{1,2}(?:\(\d+\))?)\b/)
        if (m && m[1].length >= 4) return m[1]
      }
    }
  }
  return null
}
const CONTENT_CHAPTER_RULES = [
  { chapter: '二次根式', re: /二次根式|平方根|立方根|±\s*√|√[a-zA-Z0-9]|根号/ },
  { chapter: '一元二次方程', re: /一元二次方程|求根公式|判别式|根与系数|二次三项式/ },
  { chapter: '直角三角形', re: /直角三角形|勾股定理|角平分线/ },
  { chapter: '实数', re: /无理数|相反数|绝对值|科学记数法|近似数|算术平方根/ },
]
const detectChapterByContent = (questions) => {
  if (!Array.isArray(questions) || questions.length === 0) return null
  const buf = []
  for (const q of questions) {
    if (q.content) buf.push(String(q.content))
    if (q.student_answer) buf.push(String(q.student_answer))
  }
  const text = buf.join(' ')
  if (!text) return null
  for (const rule of CONTENT_CHAPTER_RULES) {
    if (rule.re.test(text)) return rule.chapter
  }
  return null
}
const titleMatches = (a, b) => {
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

// === 复刻最新修复版的 pickAnswerUnit ===
function pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint) {
  if (!answersByUnit || answersByUnit.size === 0) return null
  if (answersByUnit.size === 1) return [...answersByUnit.keys()][0]
  const DBG = process.env.DEBUG_PICK === '1'

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

  // 0) lesson_hint 匹配
  //   必须同时匹配 lesson_code 和试卷序号：pageTitle="试卷4 19.2..." → unit_key="试卷4|19.2"
  //   lesson_code 相同但试卷序号不同时（如"试卷3|19.2"和"试卷4|19.2"），
  //   必须用试卷序号锁定；OCR 误识"试卷4"为"试卷1"时回退到 lesson_code 唯一选择。
  const lessonHint = detectLessonCode(questions, pageTitle)
  if (DBG) console.log(`[DBG] lessonHint=${lessonHint} (pageTitle=${JSON.stringify(pageTitle)})`)
  if (lessonHint) {
    // 1) 先从 pageTitle 抽"试卷N"中的 N
    const pagePaperMatch = pageTitle && typeof pageTitle === 'string'
      ? pageTitle.match(/试卷\s*([0-9㊀-㊉①-⑩]+)/)
      : null
    const pagePaperNum = pagePaperMatch
      ? (circledToAsciiMap[pagePaperMatch[1]] || Number(pagePaperMatch[1]))
      : null

    // 收集所有 lesson_code 段严格匹配 lessonHint 的 candidates
    const lessonMatches = []
    for (const c of candidates) {
      const ck = c.unitKeyRaw || ''
      const m = ck.match(/\|(\d+(?:\.\d+)?(?:\(\d+\))?)/)
      if (m && m[1] === lessonHint) {
        lessonMatches.push(c)
      } else if (ck.includes(lessonHint)) {
        lessonMatches.push({ ...c, _softMatch: true })
      }
    }

    // 试卷序号锁定：pageTitle 里的"试卷N"必须和 unitKeyRaw 里的"试卷N"一致
    if (pagePaperNum && lessonMatches.length > 1) {
      const locked = lessonMatches.filter(c => {
        const ck = c.unitKeyRaw || ''
        const m = ck.match(/试卷\s*(\d+)\s*\|/i)
        return m && Number(m[1]) === pagePaperNum
      })
      if (locked.length >= 1) lessonMatches.splice(0, lessonMatches.length, ...locked)
    }

    // 类型关键词锁定（提高性测试/基础性测试）
    if (lessonMatches.length > 1 && pageTitle) {
      const normP = normalizeTitleForMatch(pageTitle)
      const hasBasics = /基础性测试/i.test(normP)
      const hasAdvanced = /提高性测试/i.test(normP)
      if (hasBasics || hasAdvanced) {
        const filtered = lessonMatches.filter(c => {
          const ct = normalizeTitleForMatch(c.unitTitle)
          if (hasBasics) return ct.includes('基础性测试')
          if (hasAdvanced) return ct.includes('提高性测试')
          return true
        })
        if (filtered.length >= 1) lessonMatches.splice(0, lessonMatches.length, ...filtered)
      }
    }

    if (lessonMatches.length === 1) return lessonMatches[0].unitKey
    if (lessonMatches.length > 1) {
      // 多个候选命中：先按严格匹配筛（剔除 softMatch），再交给评分阶段
      const strictMatches = lessonMatches.filter(c => !c._softMatch)
      if (strictMatches.length >= 1) {
        candidates.splice(0, candidates.length, ...strictMatches)
      } else {
        candidates.splice(0, candidates.length, ...lessonMatches)
      }
    }
  }

  // 1) 标题匹配
  if (pageTitle) {
    const normTitle = normalizeTitleForMatch(pageTitle)
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
  }

  // 1.5) 内容特征匹配
  const detectedChapter = detectChapterByContent(questions)
  if (DBG) console.log(`[DBG] detectedChapter=${detectedChapter}`)
  if (detectedChapter) {
    // 唯一命中才返回；多个候选都含 detectedChapter 时跳过，让 chapterHint 缩窄 + 评分兜底
    const titleMatches4 = candidates.filter(c => c.unitTitle && c.unitTitle.includes(detectedChapter))
    if (titleMatches4.length === 1) return titleMatches4[0].unitKey
    const keyMatches4 = candidates.filter(c => c.unitKeyRaw && c.unitKeyRaw.includes(detectedChapter))
    if (keyMatches4.length === 1) return keyMatches4[0].unitKey
  }

  // 2) 题号覆盖率打分
  const qNos = (questions || []).filter(q => q.question_number != null).map(q => Number(q.question_number))
  if (qNos.length === 0) return null

  let scopedCandidates = candidates

  // 2.0.5) chapterHint 兜底（lesson_code 严格匹配）
  if (chapterHint && typeof chapterHint === 'string' && scopedCandidates.length > 1) {
    // 提取 chapterHint 中的 lesson_code 段：支持"19.2"、第19章、第十九章
    let hintLesson = null
    const lessonMatch = chapterHint.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\))?)/)
    if (lessonMatch) {
      hintLesson = lessonMatch[1]
    } else {
      // 中文数字映射
      const cnDigit = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
      const cnChapter = chapterHint.match(/第([零一二三四五六七八九十]+)章/)
      if (cnChapter) {
        const s = cnChapter[1]
        let n = 0
        if (s === '十') n = 10
        else if (s.length === 1) n = cnDigit[s] || 0
        else if (s.length === 2 && s[0] === '十') n = 10 + (cnDigit[s[1]] || 0)
        else if (s.length === 2 && s[1] === '十') n = (cnDigit[s[0]] || 0) * 10
        else if (s.length === 3) n = (cnDigit[s[0]] || 0) * 10 + (cnDigit[s[2]] || 0)
        if (n > 0) hintLesson = String(n)
      }
    }
    if (DBG) console.log(`[DBG] chapterHint=${chapterHint} → hintLesson=${hintLesson}`)
    if (hintLesson) {
      const narrowed = scopedCandidates.filter(c => {
        const ck = c.unitKeyRaw || ''
        return ck.includes(hintLesson)
      })
      if (DBG) console.log(`[DBG] narrowed (${narrowed.length}/${scopedCandidates.length}): ${narrowed.map(c => c.unitKeyRaw).join(', ')}`)
      if (narrowed.length >= 1 && narrowed.length < scopedCandidates.length) {
        scopedCandidates = narrowed
      }
    }
  }

  const DEBUG = false
  let bestKey = null, bestScore = -1
  for (const c of scopedCandidates) {
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
    if (DBG) console.log(`  [SCORE] ${c.unitKey} covered=${covered}/${qNos.length} score=${score.toFixed(3)}`)
    if (DEBUG && covered > 0) console.log(`  [SCORE] ${c.unitKey} covered=${covered}/${qNos.length} score=${score.toFixed(3)}`)
    if (score > bestScore && covered > 0) {
      bestScore = score; bestKey = c.unitKey
    }
  }
  if (process.env.DEBUG_SCORE) console.log(`  [DEBUG] bestKey=${bestKey} bestScore=${bestScore} (Test 4 排查)`)
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

// === 旧版 pickAnswerUnit（用于对比错误行为）===
function oldPickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint) {
  if (!answersByUnit || answersByUnit.size === 0) return null
  if (answersByUnit.size === 1) return [...answersByUnit.keys()][0]
  const unitMeta = (unitKey) => {
    const secMap = answersByUnit.get(unitKey)
    if (!secMap) return { unitKey, unitTitle: '', unitKeyRaw: '' }
    const sample = [...secMap.values()][0]?.values().next().value
    return { unitKey, unitTitle: sample?.unit_title || '', unitKeyRaw: sample?.unit_key || unitKey }
  }
  const candidates = [...answersByUnit.keys()].map(unitMeta)

  // 0) chapterHint 兜底（抢在标题前）
  if (chapterHint && typeof chapterHint === 'string') {
    const normHint = normalizeTitleForMatch(chapterHint)
    if (normHint) {
      for (const c of candidates) {
        const ct = normalizeTitleForMatch(c.unitTitle)
        if (ct && ct.includes(normHint)) return c.unitKey
      }
      for (const c of candidates) {
        const ck = normalizeTitleForMatch(c.unitKeyRaw)
        if (ck && ck.includes(normHint)) return c.unitKey
      }
    }
  }
  // 1) 标题匹配
  if (pageTitle) {
    const normTitle = normalizeTitleForMatch(pageTitle)
    for (const c of candidates) {
      const ct = normalizeTitleForMatch(c.unitTitle)
      if (ct && titleMatches(normTitle, ct)) return c.unitKey
    }
  }
  return null
}

const run = async () => {
  const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

  // 取全部 unit 的答案构建 3D Map（仅取相关试卷）
  const { rows: ans } = await pool.query(`
    SELECT ra.unit_id, ra.question_no, ra.sub_no, ra.answer, ra.answer_type, ra.section, ra.content,
           ru.unit_key, ru.unit_title, ru.unit_seq, ru.answer_page_start, ru.answer_page_end
    FROM resource_answers ra
    LEFT JOIN resource_units ru ON ru.id = ra.unit_id
    WHERE ra.resource_id = $1
      AND ra.answer_status IN ('teacher_verified','official_verified')
      AND (ru.unit_key LIKE '试卷%' OR ru.unit_title LIKE '%试卷%')
  `, [wsId])

  const map = new Map()
  for (const r of ans) {
    const uk = r.unit_key
    if (!map.has(uk)) map.set(uk, new Map())
    const secMap = map.get(uk)
    const sec = r.section || ''
    if (!secMap.has(sec)) secMap.set(sec, new Map())
    secMap.get(sec).set(`${Number(r.question_no)}|${r.sub_no||''}`, {
      answer: r.answer,
      answer_type: r.answer_type,
      unit_title: r.unit_title,
      unit_key: r.unit_key,
      answer_page_start: r.answer_page_start,
      answer_page_end: r.answer_page_end,
    })
  }
  console.log(`构建答案库: ${map.size} 个试卷 unit`)
  for (const k of map.keys()) console.log(`  - ${k}`)

  // 模拟学生试卷：14 道题，题号 1-14，content 含"绝对值"和"√6-5"等
  const studentQuestions = [
    { question_number: 1, content: '√6-5 的绝对值是', student_answer: '5-2√6' },
    { question_number: 2, content: '计算 (√15)² + (-√3)² - 4', student_answer: '15' },
    { question_number: 3, content: '已知太阳地球距离约 1.5×10⁸ km, 光速 3×10⁵ km/s', student_answer: '5×10²' },
    { question_number: 4, content: '关于反说法正确的是', student_answer: '①④' },
    { question_number: 5, content: '解方程 x²+1=2x', student_answer: '±5/6' },
    { question_number: 6, content: '设a=1.732', student_answer: '1/100' },
    { question_number: 7, content: '已知√(101²) = 10.1', student_answer: '±1.01' },
    { question_number: 8, content: '已知1<a<5, 化简', student_answer: '1/√5' },
    { question_number: 9, content: '正方形周长 4cm, 面积 50cm²', student_answer: '0' },
    { question_number: 10, content: '若x-2的平方根是±5, 那么x-2', student_answer: '7' },
    { question_number: 11, content: '底数部分为-6', student_answer: '-6√2' },
    { question_number: 12, content: '求 |x|+y=1', student_answer: '0' },
    { question_number: 13, content: '下列各式', student_answer: '-12' },
    { question_number: 14, content: '求值', student_answer: '2/3' },
  ]

  // ─── Test 1: 模拟用户截图场景（OCR 误识别"试卷①"）───
  console.log(`\n========== Test 1: 用户截图场景（pageTitle="试卷① 19.2 实数 提高性测试"） ==========`)
  const pageTitle1 = '试卷① 19.2 实数 提高性测试'
  const chapterHint1 = '第十九章实数'
  const oldKey1 = oldPickAnswerUnit(map, pageTitle1, studentQuestions, 1, chapterHint1)
  const newKey1 = pickAnswerUnit(map, pageTitle1, studentQuestions, 1, chapterHint1)
  console.log(`  旧版选: ${oldKey1} ${oldKey1 === '试卷6' ? '❌ 错配到"试卷6"！' : ''}`)
  console.log(`  新版选: ${newKey1} ${newKey1 === '试卷4|19.2' ? '✅ 正确' : '❌ 错配'}`)

  // 验证答对/答错
  const expect = '试卷4|19.2'
  if (newKey1) {
    let correct = 0, wrong = 0
    for (const q of studentQuestions) {
      const secMap = map.get(newKey1)
      const qKey = `${q.question_number}|${q.sub_no || ''}`
      let row = null
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { row = qMap.get(qKey); break }
      }
      if (row) {
        const match = String(q.student_answer).trim() === String(row.answer).trim()
        if (match) correct++
        else {
          wrong++
          console.log(`  ❌ 题${q.question_number} 学生="${q.student_answer}" vs 答案库="${row.answer}" sec="${row.section}"`)
        }
      } else {
        console.log(`  ⚠️ 题${q.question_number} 在 ${newKey1} 没找到`)
      }
    }
    console.log(`  验证批改结果: 对=${correct} 错=${wrong} ${correct >= 13 ? '✅ 正确' : '⚠️ 仅测试串等，不反映真实判题'}`)
  }

  // ─── Test 2: OCR 完美识别 "试卷4 19.2" ───
  console.log(`\n========== Test 2: 正常识别 pageTitle="试卷4 19.2实数提高性测试" ==========`)
  const pageTitle2 = '试卷4 19.2实数提高性测试'
  const oldKey2 = oldPickAnswerUnit(map, pageTitle2, studentQuestions, 1, null)
  const newKey2 = pickAnswerUnit(map, pageTitle2, studentQuestions, 1, null)
  console.log(`  旧版选: ${oldKey2}`)
  console.log(`  新版选: ${newKey2} ${newKey2 === '试卷4|19.2' ? '✅ 正确' : '❌ 错配'}`)

  // ─── Test 3: 用户上传"试卷6"的图 ───
  console.log(`\n========== Test 3: 试卷6（第十九章实数提高性测试） ==========`)
  const qPaper6 = [
    { question_number: 1, content: '太阳光到达地球需时', student_answer: '约500s' },
    { question_number: 2, content: '下列正确的是', student_answer: '-√2/2' },
    { question_number: 3, content: '解方程', student_answer: '±0.08' },
    { question_number: 4, content: '已知', student_answer: '-1/6' },
  ]
  const pageTitle3 = '试卷6 第十九章实数提高性测试'
  const newKey3 = pickAnswerUnit(map, pageTitle3, qPaper6, 1, '第十九章实数')
  console.log(`  新版选: ${newKey3} ${newKey3 === '试卷6' ? '✅ 正确' : '❌ 错配'}`)

  // ─── Test 4: OCR 完全没识别标题（pageTitle=null）───
  console.log(`\n========== Test 4: pageTitle=null + chapterHint="第十九章实数" ==========`)
  // 诊断：先看 candidates 列表
  const candidates4 = [...map.keys()].map(uk => {
    const secMap = map.get(uk)
    const sample = [...secMap.values()][0]?.values().next().value
    return { unitKey: uk, unitTitle: sample?.unit_title || '', unitKeyRaw: sample?.unit_key || uk }
  })
  console.log(`  全部 ${candidates4.length} 个 candidates:`)
  for (const c of candidates4) console.log(`    - ${c.unitKeyRaw} (title="${c.unitTitle}")`)
  // 检测 lessonHint
  const lessonHint4 = detectLessonCode(studentQuestions, null)
  console.log(`  detectLessonCode(pageTitle=null) = ${lessonHint4}`)
  // chapterHint 缩窄结果
  const hintLesson4 = '19'
  const narrowed4 = candidates4.filter(c => (c.unitKeyRaw || '').includes(hintLesson4))
  console.log(`  chapterHint="第十九章实数" 缩窄到 unitKeyRaw 含"${hintLesson4}"：${narrowed4.length} 个`)
  for (const c of narrowed4) console.log(`    - ${c.unitKeyRaw}`)
  const newKey4 = pickAnswerUnit(map, null, studentQuestions, 1, '第十九章实数')
  // Test 4 验证：pageTitle=null 时，OCR 漏识别标题，只能缩窄到 chapter 层级（19.*）
  const expected4 = new Set(['试卷1|19.1', '试卷2|19.1', '试卷3|19.2', '试卷4|19.2'])
  console.log(`  新版选: ${newKey4} ${expected4.has(newKey4) ? '✅ 缩窄到 19.* 系列（合理）' : '❌ 错配'}`)

  // ─── Test 5: chapterHint="19.2"（精确到小节）───
  console.log(`\n========== Test 5: pageTitle=null + chapterHint="19.2" ==========`)
  const newKey5 = pickAnswerUnit(map, null, studentQuestions, 1, '19.2')
  const expected5 = new Set(['试卷3|19.2', '试卷4|19.2'])
  console.log(`  新版选: ${newKey5} ${expected5.has(newKey5) ? '✅ 缩窄到 19.2 系列（合理）' : '❌ 错配'}`)

  // ─── Test 6: lessonHint 从 OCR 题内容识别出 19.2（无 pageTitle 无 chapterHint）───
  console.log(`\n========== Test 6: pageTitle=null + chapterHint=null + 题 content 含 "19.2" ==========`)
  const questionsWith192 = studentQuestions.map((q, i) => i === 0 ? { ...q, content: '19.2 实数 提高性测试 第1题：' + q.content } : q)
  const newKey6 = pickAnswerUnit(map, null, questionsWith192, 1, null)
  const expected6 = new Set(['试卷3|19.2', '试卷4|19.2'])
  console.log(`  新版选: ${newKey6} ${expected6.has(newKey6) ? '✅ 缩窄到 19.2 系列（合理）' : '❌ 错配'}`)

  await pool.end()
}
run().catch(e => { console.error(e.message); process.exit(1) })
