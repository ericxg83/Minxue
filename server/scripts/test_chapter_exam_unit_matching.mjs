/**
 * 测试 pickAnswerUnit：章级测试卷（第X章评价测试卷）vs 课时测试卷（试卷N）区分
 *
 * 真实场景：worksheet 含章级单元"第二章评价测试卷"和多个课时试卷单元"试卷1|1.1"等。
 * 学生上传第4张图，pageTitle="第二章评价测试卷"，题号8答案应为比较符号">,<"。
 * 旧版 bug：标题含"测试卷"被误判为"试卷N"系列，过滤掉真正章级单元，
 *          整页答案错挂到"试卷X"单元（题号同样从1开始，覆盖率>60%即错配）。
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') })

// ─── 复刻 worker.js 的关键常量/函数（与生产代码保持一致）─────────────────
const CIRCLED_DIGITS_RE = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿]/g
const circledToAsciiMap = {
  '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
  '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
}
const normalizeTitleForMatch = (s) => {
  if (!s) return ''
  return String(s)
    .replace(CIRCLED_DIGITS_RE, m => circledToAsciiMap[m] || m)
    .replace(/[\s　]+/g, '')
}
const normalizeSectionName = (raw) => {
  if (!raw) return null
  return String(raw).replace(/[：:].*$/, '').replace(/[\s　]+/g, '').trim() || null
}
const titleMatches = (a, b) => {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) {
    if (Math.abs(a.length - b.length) > 2) return false
    return Math.min(a.length, b.length) >= 2
  }
  const lenDiff = Math.abs(a.length - b.length)
  if (lenDiff > 2) return false
  if (a.length <= b.length ? b.startsWith(a) : a.startsWith(b)) return true
  if (a.length <= b.length ? b.endsWith(a) : a.endsWith(b)) return true
  return false
}
const detectLessonCode = (questions, pageTitle) => {
  if (pageTitle && typeof pageTitle === 'string') {
    const m1 = pageTitle.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\)))/)
    if (m1 && m1[1].length >= 4) return m1[1]
    const m2 = pageTitle.match(/\b(\d{1,2}\.\d{1,2})\b/)
    if (m2 && m2[1].length >= 4) return m2[1]
  }
  if (Array.isArray(questions) && questions.length > 0) {
    for (const q of questions) {
      if (q.content && typeof q.content === 'string') {
        const m1 = q.content.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\)))/)
        if (m1 && m1[1].length >= 4) return m1[1]
        const m2 = q.content.match(/\b(\d{1,2}\.\d{1,2})\b/)
        if (m2 && m2[1].length >= 4) return m2[1]
      }
    }
  }
  return null
}
const CONTENT_CHAPTER_RULES = [
  { chapter: '一元二次方程', re: /一元二次方程|求根公式|判别式|根与系数|二次三项式/ },
  { chapter: '直角三角形', re: /直角三角形|勾股定理|角平分线/ },
  { chapter: '二次根式', re: /二次根式|根号下|√[a-zA-Z]\s*[+\-×÷]\s*√/ },
  { chapter: '实数', re: /无理数|相反数|绝对值|科学记数法|近似数|平方根|立方根|算术平方根/ },
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

// ═══ 复刻生产环境最新版 pickAnswerUnit ═══
function pickAnswerUnit(answersByUnit, pageTitle, questions, pageNumber, chapterHint) {
  if (!answersByUnit || answersByUnit.size === 0) return null
  if (answersByUnit.size === 1) return [...answersByUnit.keys()][0]

  const unitMeta = (unitKey) => {
    const secMap = answersByUnit.get(unitKey)
    if (!secMap) return { unitKey, unitTitle: '', unitKeyRaw: '', pageStart: null, pageEnd: null }
    let pageStart = null
    let pageEnd = null
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
      unitKey,
      unitTitle: sample.unit_title || '',
      unitKeyRaw: sample.unit_key || unitKey,
      pageStart,
      pageEnd,
    }
  }
  const candidates = [...answersByUnit.keys()].map(unitMeta)

  const normPageTitle = normalizeTitleForMatch(pageTitle)
  const hasTanglian = /堂堂练|课时练|练习题/.test(normPageTitle)
  const hasShijuanNumber = /试卷\s*[0-9①-⑩一二三四五六七八九十]+/.test(normPageTitle)
  const isChapterLevelTest = /第[一二三四五六七八九十\d]+[章节单元].*?(测试卷|评价测试|阶段测试|综合测试|综合练习)|单元测试卷|期中测试卷|期末测试卷|月考卷/.test(normPageTitle)

  if (hasTanglian && !hasShijuanNumber) {
    const practiceOnly = candidates.filter(c => /^堂堂练|^课时练/.test(c.unitKeyRaw || c.unitKey || ''))
    if (practiceOnly.length >= 1) {
      candidates.splice(0, candidates.length, ...practiceOnly)
    }
  } else if (hasShijuanNumber && !isChapterLevelTest) {
    const paperOnlyCandidates = candidates.filter(c => /^试卷/.test(c.unitKeyRaw || c.unitKey || ''))
    if (paperOnlyCandidates.length >= 1) {
      candidates.splice(0, candidates.length, ...paperOnlyCandidates)
    }
  } else if (isChapterLevelTest) {
    const chapterMatch = normPageTitle.match(/^(第[一二三四五六七八九十\d]+[章节单元])/)
    if (chapterMatch) {
      const chapterCore = chapterMatch[1]
      const chapterUnits = candidates.filter(c => {
        const ck = c.unitKeyRaw || c.unitKey || ''
        const ct = c.unitTitle || ''
        return new RegExp(`^${chapterCore}`).test(ck) || new RegExp(`^${chapterCore}`).test(ct)
      })
      if (chapterUnits.length >= 1) {
        candidates.splice(0, candidates.length, ...chapterUnits)
      }
    }
  } else if (/^第[一二三四五六七八九十\d]+[章节单元]$/.test(normPageTitle)) {
    // bare 章节核心（如"第二章"），不要预过滤成试卷类
  } else {
    const paperOnlyCandidates = candidates.filter(c => /^试卷/.test(c.unitKeyRaw || c.unitKey || ''))
    if (paperOnlyCandidates.length >= 1) {
      candidates.splice(0, candidates.length, ...paperOnlyCandidates)
    }
  }

  const lessonHint = detectLessonCode(questions, pageTitle)
  if (lessonHint) {
    const pagePaperMatch = pageTitle && typeof pageTitle === 'string'
      ? pageTitle.match(/试卷\s*([0-9㊀-㊉①-⑩]+)/)
      : null
    const pagePaperNum = pagePaperMatch
      ? (circledToAsciiMap[pagePaperMatch[1]] || Number(pagePaperMatch[1]))
      : null

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

    if (pagePaperNum && lessonMatches.length > 1) {
      const locked = lessonMatches.filter(c => {
        const ck = c.unitKeyRaw || ''
        const m = ck.match(/试卷\s*(\d+)\s*\|/i)
        return m && Number(m[1]) === pagePaperNum
      })
      if (locked.length >= 1) lessonMatches.splice(0, lessonMatches.length, ...locked)
    }

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
      const strictMatches = lessonMatches.filter(c => !c._softMatch)
      if (strictMatches.length >= 1) {
        candidates.splice(0, candidates.length, ...strictMatches)
      } else {
        candidates.splice(0, candidates.length, ...lessonMatches)
      }
    }
  }

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

    const chapterCoreMatch = normTitle.match(/^(第[一二三四五六七八九十\d]+[章节单元])/)
    if (chapterCoreMatch) {
      const core = chapterCoreMatch[1]
      for (const c of candidates) {
        const ck = normalizeTitleForMatch(c.unitKeyRaw)
        const ct = normalizeTitleForMatch(c.unitTitle)
        const matchCore = ck === core || ct === core || ck.startsWith(core) || ct.startsWith(core)
        if (matchCore && !/^试卷/.test(ck)) return c.unitKey
      }
      for (const c of candidates) {
        const ck = normalizeTitleForMatch(c.unitKeyRaw)
        const ct = normalizeTitleForMatch(c.unitTitle)
        if (ck === core || ct === core || ck.startsWith(core) || ct.startsWith(core)) {
          return c.unitKey
        }
      }
    }
  }

  const detectedChapter = detectChapterByContent(questions)
  if (detectedChapter) {
    const titleMatches4 = candidates.filter(c => c.unitTitle && c.unitTitle.includes(detectedChapter))
    if (titleMatches4.length === 1) return titleMatches4[0].unitKey
    const keyMatches4 = candidates.filter(c => c.unitKeyRaw && c.unitKeyRaw.includes(detectedChapter))
    if (keyMatches4.length === 1) return keyMatches4[0].unitKey
    if (titleMatches4.length > 1) {
      candidates.splice(0, candidates.length, ...titleMatches4)
    } else if (keyMatches4.length > 1) {
      candidates.splice(0, candidates.length, ...keyMatches4)
    }
  }

  const qNos = (questions || []).filter(q => q.question_number != null).map(q => Number(q.question_number))
  if (qNos.length === 0) return null

  let scopedCandidates = candidates
  if (pageNumber != null && Number.isFinite(Number(pageNumber))) {
    const page = Number(pageNumber)
    const inRange = candidates.filter(c =>
      c.pageStart != null && c.pageEnd != null &&
      page >= Number(c.pageStart) && page <= Number(c.pageEnd)
    )
    if (inRange.length === 1) {
      const secMap = answersByUnit.get(inRange[0].unitKey)
      let covered = 0
      for (const q of questions || []) {
        if (q.question_number == null) continue
        const qKey = `${Number(q.question_number)}|${q.sub_no || ''}`
        for (const qMap of secMap.values()) {
          if (qMap.has(qKey)) { covered++; break }
        }
      }
      if (covered > 0) return inRange[0].unitKey
    } else if (inRange.length > 1) {
      scopedCandidates = inRange
    }
  }

  if (chapterHint && typeof chapterHint === 'string' && scopedCandidates.length > 1) {
    let hintLesson = null
    const lessonMatch = chapterHint.match(/(\d{1,2}\.\d{1,2}(?:\(\d+\))?)/)
    if (lessonMatch) {
      hintLesson = lessonMatch[1]
    } else {
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
    if (hintLesson) {
      const narrowed = scopedCandidates.filter(c => {
        const ck = c.unitKeyRaw || ''
        return ck.includes(hintLesson)
      })
      if (narrowed.length >= 1 && narrowed.length < scopedCandidates.length) {
        scopedCandidates = narrowed
      }
    }
    if (scopedCandidates.length > 1) {
      const CHAPTER_KEYWORDS = [
        { kw: '二次根式', mustInTitle: /二次根式|根号下/ },
        { kw: '一元二次方程', mustInTitle: /一元二次方程/ },
        { kw: '直角三角形', mustInTitle: /直角三角形|勾股|角平分线/ },
        { kw: '实数', mustInTitle: /实数/ },
      ]
      const hintNorm = String(chapterHint).replace(/[\s　]+/g, '')
      for (const { kw, mustInTitle } of CHAPTER_KEYWORDS) {
        if (hintNorm.includes(kw)) {
          const kwNarrowed = scopedCandidates.filter(c => {
            const ct = c.unitTitle || ''
            return mustInTitle.test(ct)
          })
          if (kwNarrowed.length >= 1 && kwNarrowed.length < scopedCandidates.length) {
            scopedCandidates = kwNarrowed
            break
          }
        }
      }
    }
  }

  let bestKey = null
  let bestScore = -1
  for (const c of scopedCandidates) {
    const secMap = answersByUnit.get(c.unitKey)
    let covered = 0
    let typeMatch = 0
    for (const q of questions || []) {
      if (q.question_number == null) continue
      const qNo = Number(q.question_number)
      const subNo = q.sub_no || ''
      const qKey = `${qNo}|${subNo}`
      let row = null
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { row = qMap.get(qKey); break }
      }
      if (!row) continue
      covered++
      const ocrIsChoice = q.question_type === 'choice' || /^[A-Da-d]$/.test(String(q.student_answer || '').trim())
      const refIsChoice = row.answer_type === 'choice'
      if (ocrIsChoice === refIsChoice) typeMatch++
    }
    const score = covered / qNos.length + (covered > 0 ? (typeMatch / covered) * 0.5 : 0)
    if (score > bestScore && covered > 0) {
      bestScore = score
      bestKey = c.unitKey
    }
  }

  if (bestKey !== null) {
    const secMap = answersByUnit.get(bestKey)
    let covered = 0
    for (const q of questions || []) {
      if (q.question_number == null) continue
      const qNo = Number(q.question_number)
      const subNo = q.sub_no || ''
      const qKey = `${qNo}|${subNo}`
      for (const qMap of secMap.values()) {
        if (qMap.has(qKey)) { covered++; break }
      }
    }
    if (covered < qNos.length * 0.6) return null
  }
  return bestKey
}

// ═══ 构造模拟答案库 ═══
const buildAnswersByUnit = () => {
  const map = new Map()

  // 章级单元：第二章评价测试卷
  const chapterUnit = new Map()
  const chapterSection = new Map()
  for (let i = 1; i <= 12; i++) {
    chapterSection.set(`${i}|`, {
      answer: i === 8 ? '>,<;<' : `第${i}题答案`,
      answer_type: i === 8 ? 'fill' : 'answer',
      unit_title: '第二章评价测试卷',
      unit_key: '第二章评价测试卷',
      section: i <= 6 ? '一、填空题' : (i <= 10 ? '二、选择题' : '三、解答题'),
    })
  }
  chapterUnit.set('一、填空题', chapterSection)
  map.set('第二章评价测试卷', chapterUnit)

  // 课时试卷单元：试卷1|1.1
  const paper1 = new Map()
  paper1.set('一、填空题', new Map())
  for (let i = 1; i <= 15; i++) {
    paper1.get('一、填空题').set(`${i}|`, {
      answer: `7/20`, // 与截图类似的错误答案
      answer_type: 'answer',
      unit_title: '试卷① 1.1 分数比较 基础性测试',
      unit_key: '试卷1|1.1',
      section: '一、填空题',
    })
  }
  map.set('试卷1|1.1', paper1)

  // 课时试卷单元：试卷2|1.2
  const paper2 = new Map()
  paper2.set('一、填空题', new Map())
  for (let i = 1; i <= 15; i++) {
    paper2.get('一、填空题').set(`${i}|`, {
      answer: `1/${i}`,
      answer_type: 'answer',
      unit_title: '试卷② 1.2 小数运算 提高性测试',
      unit_key: '试卷2|1.2',
      section: '一、填空题',
    })
  }
  map.set('试卷2|1.2', paper2)

  return map
}

const answersByUnit = buildAnswersByUnit()

// 模拟学生试卷 OCR 结果（第8题是截图中的比较大小题）
const studentQuestions = []
for (let i = 1; i <= 12; i++) {
  studentQuestions.push({
    question_number: i,
    content: i === 8 ? '比较大小: 2 7/18 ___ 2 10/27; 3.14 ___ 22/7' : `第${i}题题干`,
    student_answer: i === 8 ? '>,<;<' : `学生答案${i}`,
    question_type: i === 8 ? 'fill' : 'answer',
  })
}

console.log('\n========== 章级测试卷匹配测试 ==========')
console.log('答案库单元:', [...answersByUnit.keys()].join(', '))

// 测试1：pageTitle 完整识别为"第二章评价测试卷"
const pageTitle1 = '第二章评价测试卷'
const picked1 = pickAnswerUnit(answersByUnit, pageTitle1, studentQuestions, 4, null)
console.log(`\nTest 1: pageTitle="${pageTitle1}"`)
console.log(`  选中单元: ${picked1}`)
console.log(`  期望: 第二章评价测试卷`)
console.log(`  结果: ${picked1 === '第二章评价测试卷' ? '✅ 正确' : '❌ 错配'}`)

// 测试2：pageTitle 被 AI 简化为"第二章"
const pageTitle2 = '第二章'
const picked2 = pickAnswerUnit(answersByUnit, pageTitle2, studentQuestions, 4, null)
console.log(`\nTest 2: pageTitle="${pageTitle2}"`)
console.log(`  选中单元: ${picked2}`)
console.log(`  期望: 第二章评价测试卷`)
console.log(`  结果: ${picked2 === '第二章评价测试卷' ? '✅ 正确' : '❌ 错配'}`)

// 测试3：验证题号8能匹配到正确答案">,<;<'
const picked = picked1 || picked2
if (picked === '第二章评价测试卷') {
  const secMap = answersByUnit.get('第二章评价测试卷')
  let found = null
  for (const qMap of secMap.values()) {
    if (qMap.has('8|')) {
      found = qMap.get('8|')
      break
    }
  }
  console.log(`\nTest 3: 题号8答案匹配`)
  console.log(`  答案库答案: ${found?.answer}`)
  console.log(`  期望: >,<;<`)
  console.log(`  结果: ${found?.answer === '>,<;<' ? '✅ 正确' : '❌ 错配'}`)
}

// 测试4：对比旧行为（章级标题被误判为试卷）
// 旧行为：hasShijuan=true → 只保留 /^试卷/ 单元 → 选中"试卷1|1.1"或"试卷2|1.2"
const oldBehaviorPicked = (() => {
  const normPageTitle = normalizeTitleForMatch(pageTitle1)
  const hasShijuan = /试卷|测试卷/.test(normPageTitle)
  const cands = [...answersByUnit.keys()].map(k => {
    const secMap = answersByUnit.get(k)
    const sample = [...secMap.values()][0]?.values().next().value
    return { unitKey: k, unitKeyRaw: sample?.unit_key || k }
  })
  const filtered = hasShijuan ? cands.filter(c => /^试卷/.test(c.unitKeyRaw)) : cands
  return filtered[0]?.unitKey || null
})()
console.log(`\nTest 4: 旧行为模拟（标题含"测试卷"即过滤到试卷类）`)
console.log(`  旧版会选中: ${oldBehaviorPicked}`)
console.log(`  结果: ${oldBehaviorPicked !== '第二章评价测试卷' ? '✅ 确认旧版会错配' : '⚠️ 旧版未复现错配'}`)

const allOk = picked1 === '第二章评价测试卷' && picked2 === '第二章评价测试卷' && oldBehaviorPicked !== '第二章评价测试卷'
console.log(`\n${allOk ? '✅ 全部测试通过' : '❌ 存在失败用例'}`)
process.exit(allOk ? 0 : 1)
