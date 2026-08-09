// ── Answer comparison utilities ──

/**
 * 收窄过程型答案到最终结果，避免 "=√4=2" 与 "2" 直接比对失败。
 * 优先级：最右 = 右侧 → 分号末段 → 逗号末段。
 */
function narrowToFinalAnswer(s) {
  if (s == null) return ''
  let str = String(s).trim()
  // Full-width ＝ → half-width = (before = check)
  str = str.replace(/＝/g, '=')
  if (str.includes('=')) str = str.slice(str.lastIndexOf('=') + 1).trim()
  else if (str.includes(';') || str.includes('；')) str = str.split(/[;；]/).pop().trim()
  else if (str.includes(',') || str.includes('，')) str = str.split(/[,，]/).pop().trim()
  // "答:" (answer marker) 之后才是最终答案，取其后内容
  // e.g. "4/9 答:占全班4/9。" → "占全班4/9。"
  const ansIdx = str.search(/答[:：]/)
  if (ansIdx >= 0) {
    const beforeAns = str.slice(0, ansIdx).trim()
    const afterAns = str.slice(ansIdx + 1).replace(/^[:：]/, '').trim()
    // 当 "答:" 后是短叙述残句（无分数、≤6 字符，如 "还剩1元。"，学生笔误留下的
    // 中间过程残句），而 "=" 已收窄出含数字的完整结果（如 "35(元)"）时，
    // 真实答案在收窄结果里，保留收窄结果，避免把正确过程答案误判为错。
    // 反之 "答:" 后是完整答案（如 "多看12页，少看1/16。"）时保留 "答:" 内容。
    const isNarrativeResidue = afterAns.length <= 6 && !afterAns.includes('/')
    if (isNarrativeResidue && /\d/.test(beforeAns)) str = beforeAns
    else str = afterAns
  }
  return str
}

/**
 * Normalize answer string for comparison with tolerance for units, case, and formatting.
 */
function normalizeAnswer(str) {
  if (str === null || str === undefined) return ''
  let s = String(str)

  // Full-width to half-width
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  s = s.replace(/　/g, ' ')

  s = s.trim()
  s = s.toUpperCase()

  // Remove parentheses around units: "4.8(时)" → "4.8时" (before trailing punct strip)
  s = s.replace(/[（(]([^）)]+)[）)]/g, '$1')

  // Strip trailing common punctuation
  s = s.replace(/[.,;:!?，。；：！？、）)\]}>"'《》「」『』]+$/g, '')

  // Unit synonym replacement (order matters: longer units first)
  const unitPairs = [
    ['小时', 'H'], ['小時', 'H'],
    ['分钟', 'MIN'], ['分鐘', 'MIN'],
    ['秒钟', 'S'], ['秒鐘', 'S'],
    ['厘米', 'CM'], ['毫米', 'MM'],
    ['千米', 'KM'], ['公里', 'KM'],
    ['千克', 'KG'], ['公斤', 'KG'],
    ['毫升', 'ML'],
    ['时', 'H'], ['時', 'H'],
    ['分', 'MIN'],
    ['秒', 'S'],
    ['米', 'M'],
    ['升', 'L'],
    ['度', '°'],
    ['克', 'G'],
  ]
  for (const [cn, sym] of unitPairs) {
    s = s.replace(new RegExp(cn, 'g'), sym)
  }

  // Unicode fraction symbols → /n form (must run BEFORE mixed-fraction rules)
  // Insert space before Unicode fraction when preceded by digit (so "218¾" → "218 ¾")
  s = s.replace(/(\d)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])/g, '$1 $2')
  const unicodeFracs = {
    '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
    '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
    '⅙': '1/6', '⅚': '5/6', '⅐': '1/7',
    '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
    '⅑': '1/9', '⅒': '1/10',
  }
  for (const [sym, frac] of Object.entries(unicodeFracs)) {
    s = s.replace(new RegExp(sym, 'g'), frac)
  }

  // LaTeX 运算符: \div → /, \times → *, \cdot → *
  s = s.replace(/\\div/gi, '/')
  s = s.replace(/\\times/gi, '*')
  s = s.replace(/\\cdot/gi, '*')
  // LaTeX display markers $ $ \( \) → 移除
  s = s.replace(/\$|\\[()]/g, '')
  // LaTeX fraction: \FRAC{n}{d} → n/d (must run AFTER toUpperCase)
  // IMPORTANT: must add spaces so mixed number rule can match "36 5/14"
  s = s.replace(/\\FRAC\{([^}]+)\}\{([^}]+)\}/gi, ' $1/$2 ')

  // Mixed number with space: "146 3/4" → "146+3/4" (before whitespace removal)
  s = s.replace(/(\d+)\s+(\d+\/\d+)/g, '$1+$2')

  // Convert Chinese mixed fraction to standard format: "12又1/3" → "12+1/3"
  s = s.replace(/(\d+)又([+-]?\d+\/\d+)/g, '$1+$2')

  // Remove all whitespace
  s = s.replace(/\s+/g, '')

  return s
}

/**
 * 单位换算基准表：时间→秒，长度→米，重量→克，容量→毫升，角度→度。
 */
const UNIT_BASE = {
  H: 3600, MIN: 60, S: 1,
  KM: 1000, M: 1, CM: 0.01, MM: 0.001,
  KG: 1000, G: 1,
  L: 1000, ML: 1,
  '°': 1,
}

/**
 * 把"数值+单位"解析为换算到基准后的纯数值；失败返回 null。
 */
function parseValueWithUnit(s) {
  const m = String(s).match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Z°]+)$/)
  if (m && UNIT_BASE[m[2]]) {
    return parseFloat(m[1]) * UNIT_BASE[m[2]]
  }
  let expr = String(s).replace(/[^0-9+\-*/().]/g, '')
  if (!expr) return null
  expr = expr.replace(/^[+\-*/]+|[+\-*/]+$/g, '')
  if (!expr) return null
  try {
    const v = eval(expr)
    return isFinite(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Try numeric equivalence with unit tolerance:
 * "1/2" vs "0.5", "12+1/3" vs "37/3", "120S" vs "2MIN", "3KM" vs "3000M"
 */
function isNumericEquivalent(a, b) {
  const numA = parseValueWithUnit(a)
  const numB = parseValueWithUnit(b)
  if (numA == null || numB == null) return false
  return Math.abs(numA - numB) < 1e-9
}

/**
 * Check if two math expressions are numerically equivalent
 * by substituting test values for variables and comparing results.
 * Handles implicit multiplication, ^ exponentiation, and equation prefix.
 */
function isMathEquivalent(expr1, expr2) {
  if (!expr1 || !expr2) return false

  try {
    // Prepare expression for JS evaluation
    const prep = (s) => {
      // Strip equation prefix: "y = 2x - 4" → "2x - 4", "f(x)=..." → "..."
      const eqIdx = s.indexOf('=')
      if (eqIdx > 0) s = s.substring(eqIdx + 1)
      s = s.trim()
      // ^ → **  (exponentiation)
      s = s.replace(/\^/g, '**')
      // √ 开方 → **0.5：√4 → (4)**0.5，√(1/3) → ((1/3))**0.5
      // 用 **0.5 而非 Math.sqrt，避免后续 toLowerCase 把 Math 变成 math 导致 ReferenceError。
      // 先处理括号形式（内容可含运算符），再处理纯数字。
      s = s.replace(/√\(([^()]*)\)/g, '(($1))**0.5')
      s = s.replace(/√([0-9]+(?:\.[0-9]+)?)/g, '(($1))**0.5')
      // Insert * for implicit multiplication: "2x" → "2*x", "2(" → "2*(", ")(" → ")*("
      s = s.replace(/(\d)([a-zA-Z(])/g, '$1*$2')
      s = s.replace(/([a-zA-Z)])(\d)/g, '$1*$2')
      s = s.replace(/\)\(/g, ')*(')
      return s
    }

    let e1 = prep(expr1).toLowerCase()
    let e2 = prep(expr2).toLowerCase()

    // Extract single-letter variables (not adjacent to another letter, exclude e/pi)
    const allText = e1 + ' ' + e2
    const varSet = new Set()
    const varRe = /(?<![a-z])([a-df-z])(?![a-z])/gi
    let m
    while ((m = varRe.exec(allText)) !== null) {
      varSet.add(m[1].toLowerCase())
    }
    // Remove common function-name letters that slip through
    const funcLetters = new Set(['s', 'i', 'n', 'c', 'o', 't', 'a', 'g', 'l', 'e', 'x', 'p', 'r', 'm', 'u', 'v'])
    for (const fl of funcLetters) {
      if (varSet.has(fl)) {
        // Only remove if the letter ONLY appears in function words, not as standalone variable
        // Keep if it appears as standalone
        const standaloneRe = new RegExp(`(?<![a-z])${fl}(?![a-z])`, 'g')
        const inE1 = (e1.match(standaloneRe) || []).length
        const inE2 = (e2.match(standaloneRe) || []).length
        if (inE1 === 0 && inE2 === 0) varSet.delete(fl)
      }
    }

    if (varSet.size === 0) {
      // No variables — compare as literal numbers
      const fn1 = new Function(`"use strict"; return (${e1})`)
      const fn2 = new Function(`"use strict"; return (${e2})`)
      return Math.abs(fn1() - fn2()) < 1e-9
    }

    // Test with diverse values; all must match
    // 注意：若所有测试点都因表达式非法而跳过（continue），说明两边根本不是可评估的
    // 数学表达式，此时应判"不等"而非"相等"，否则会把含中文/乱字符的答案误判为对。
    const testVals = [0, 1, 2, -1, 0.5, 3, -2, 5, 0.25, 10]
    let evaluatedCount = 0
    for (const v of testVals) {
      let s1 = e1; let s2 = e2
      for (const vn of varSet) {
        const re = new RegExp(`(?<![a-z])(${vn})(?![a-z])`, 'g')
        s1 = s1.replace(re, `(${v})`)
        s2 = s2.replace(re, `(${v})`)
      }
      try {
        const fn1 = new Function(`"use strict"; return (${s1})`)
        const fn2 = new Function(`"use strict"; return (${s2})`)
        evaluatedCount++
        if (Math.abs(fn1() - fn2()) > 1e-9) return false
      } catch {
        continue // skip test values that cause math errors (e.g. division by zero)
      }
    }
    return evaluatedCount > 0
  } catch {
    return false
  }
}

/** Normalize judge (true/false) answer to a canonical form: 'T' or 'F' */
function normalizeJudgeAnswer(str) {
  if (!str) return ''
  const s = String(str).trim()
  if (/^[✓√✔vV]$/.test(s)) return 'T'
  if (/^(正确|对|是|true|yes|T)$/i.test(s)) return 'T'
  if (/^[✗✘×xX]$/.test(s)) return 'F'
  if (/^(错误|错|否|false|no|F)$/i.test(s)) return 'F'
  return s.toUpperCase()
}

/**
 * Compare student answer against reference answer with tolerance.
 * Returns { isCorrect: boolean, unrecognized: boolean }
 */
export function judgeAnswer(studentAnswer, referenceAnswer, questionType) {
  const rawAnswer = String(studentAnswer || '').trim()
  const hasAnswer = rawAnswer !== '' && rawAnswer !== '未作答'

  if (!hasAnswer) {
    return { isCorrect: null, unrecognized: true }
  }

  if (!referenceAnswer) {
    return { isCorrect: true, unrecognized: false }
  }

  if (questionType === 'choice') {
    // 去包裹的括号/全角括号："(C)" / "（C）" / " C " 统一为 "C" 再比较
    const cleanChoice = (s) => String(s || '').trim().toUpperCase().replace(/^[（(]|[)）]$/g, '')
    return { isCorrect: cleanChoice(studentAnswer) === cleanChoice(referenceAnswer), unrecognized: false }
  }

  if (questionType === 'judge') {
    // Judge: 同样去括号/全角括号（"（√）" / "(×)" → "√" / "×"），再走 T/F 归一化
    const cleanJudge = (s) => String(s || '').trim().replace(/^[（(]|[)）]$/g, '')
    const normStudent = normalizeJudgeAnswer(cleanJudge(studentAnswer))
    const normRef = normalizeJudgeAnswer(cleanJudge(referenceAnswer))
    return { isCorrect: normStudent === normRef, unrecognized: false }
  }

  // Fill / answer / other: normalized comparison with tolerance

  // Helper: 单个答案片段的归一化比较
  const normalizeAndCompare = (sAns, rAns) => {
    const narrowed = narrowToFinalAnswer(sAns)
    const normS = normalizeAnswer(narrowed)
    const normR = normalizeAnswer(rAns)
    if (normS === normR) return true
    if (isNumericEquivalent(normS, normR)) return true
    if (isMathEquivalent(narrowed, rAns)) return true
    return false
  }

  // Helper: 单个答案片段的数值提取比较
  const extractAndCompare = (rawS, rawR) => {
    const extractNumericValues = (raw) => {
      let s = String(raw || '')
      s = s.replace(/\\div/gi, '/')
      s = s.replace(/\\times/gi, '*')
      s = s.replace(/\\cdot/gi, '*')
      s = s.replace(/\$|\\[()]/g, '')
      s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))

      const vals = []

      // LaTeX 带分数：数字 + \frac{分子}{分母}
      s = s.replace(/(\d+(?:\.\d+)?)\\frac\{([^}]+)\}\{([^}]+)\}/gi, (match, whole, num, den) => {
        const wholeNum = parseFloat(whole)
        const numNum = parseInt(num, 10)
        const denNum = parseInt(den, 10)
        if (numNum < denNum) {
          vals.push(wholeNum + numNum / denNum)
          return ' '.repeat(match.length)
        }
        return match
      })

      // 普通 \frac{n}{d} → n/d
      s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/gi, '($1/$2)')

      // 真混合数
      const mixedRe = /(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/g
      let cleaned = s.replace(mixedRe, (match, whole, num, den) => {
        if (parseInt(num, 10) < parseInt(den, 10)) {
          vals.push(parseFloat(whole) + parseInt(num, 10) / parseInt(den, 10))
          return ' '.repeat(match.length)
        }
        return match
      })
      // 分数
      cleaned = cleaned.replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, (match, n, d) => {
        vals.push(parseFloat(n) / parseFloat(d))
        return ' '.repeat(match.length)
      })
      // 数字
      const numRe = /\d+(?:\.\d+)?/g
      let nm
      while ((nm = numRe.exec(cleaned)) !== null) {
        vals.push(parseFloat(nm[0]))
      }
      return vals.filter(v => isFinite(v)).sort((a, b) => a - b)
    }
    const sNums = extractNumericValues(rawS)
    const rNums = extractNumericValues(rawR)
    return sNums.length > 0 && rNums.length > 0 && sNums.length === rNums.length &&
      sNums.every((v, i) => Math.abs(v - rNums[i]) < 1e-9)
  }

  // 检测逗号/分号分隔的多答案
  const splitAnswers = (s) => {
    const str = String(s || '').trim()
    if (str.includes(',') || str.includes('，') || str.includes(';') || str.includes('；')) {
      return str.split(/[,，;；]/).map(a => a.trim()).filter(a => a)
    }
    return [str]
  }

  // 按空格分割（用于比较符号等非数值多答案场景）
  const splitBySpace = (s) => {
    const str = String(s || '').trim()
    return str.split(/\s+/).map(a => a.trim()).filter(a => a)
  }

  const studentParts = splitAnswers(studentAnswer)
  const refParts = splitAnswers(referenceAnswer)

  // 多答案场景：逗号/分号分隔，逐个比较
  if (refParts.length > 1 && studentParts.length > 1) {
    if (studentParts.length === refParts.length) {
      const allCorrect = studentParts.every((sp, i) => {
        const rp = refParts[i]
        return normalizeAndCompare(sp, rp) || extractAndCompare(sp, rp)
      })
      if (allCorrect) return { isCorrect: true, unrecognized: false }
    }
  }

  // 多答案场景：一方有逗号，整体数值比较
  if (refParts.length > 1 || studentParts.length > 1) {
    if (extractAndCompare(studentAnswer, referenceAnswer)) {
      return { isCorrect: true, unrecognized: false }
    }
  }

  // 多答案场景：空格分隔的比较符号/简单答案（如 "> , <" vs "> <"）
  const studentSpaceParts = splitBySpace(studentAnswer)
  const refSpaceParts = splitBySpace(referenceAnswer)
  if (refSpaceParts.length > 1 && studentSpaceParts.length > 1 &&
      studentSpaceParts.length === refSpaceParts.length) {
    const allCorrect = studentSpaceParts.every((sp, i) => {
      const rp = refSpaceParts[i]
      return normalizeAndCompare(sp, rp) || extractAndCompare(sp, rp)
    })
    if (allCorrect) return { isCorrect: true, unrecognized: false }
  }

  // 多答案场景：逗号学生 vs 空格标准（如 "> , <" vs "> <"）
  if (studentParts.length > 1 && refSpaceParts.length > 1 &&
      studentParts.length === refSpaceParts.length) {
    const allCorrect = studentParts.every((sp, i) => {
      const rp = refSpaceParts[i]
      return normalizeAndCompare(sp, rp) || extractAndCompare(sp, rp)
    })
    if (allCorrect) return { isCorrect: true, unrecognized: false }
  }

  // 单答案场景：标准比较流程
  const narrowedStudent = narrowToFinalAnswer(studentAnswer)
  const normStudent = normalizeAnswer(narrowedStudent)
  const normRef = normalizeAnswer(referenceAnswer)

  if (normStudent === normRef) {
    return { isCorrect: true, unrecognized: false }
  }

  if (isNumericEquivalent(normStudent, normRef)) {
    return { isCorrect: true, unrecognized: false }
  }

  if (isMathEquivalent(narrowedStudent, referenceAnswer)) {
    return { isCorrect: true, unrecognized: false }
  }

  if (extractAndCompare(studentAnswer, referenceAnswer)) {
    return { isCorrect: true, unrecognized: false }
  }

  return { isCorrect: false, unrecognized: false }
}
