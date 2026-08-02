/**
 * Pure judgment functions for comparing student answers against reference answers.
 * Extracted from worker.js so both the worker and the rejudge endpoint can share them.
 */

/**
 * 收窄过程型答案到最终结果，避免 "=√4=2" 与 "2" 直接比对失败。
 * 优先级：最右 = 右侧 → 分号末段 → 逗号末段。
 */
function narrowToFinalAnswer(s) {
  if (s == null) return ''
  let str = String(s).trim()
  if (str.includes('=')) str = str.slice(str.lastIndexOf('=') + 1).trim()
  else if (str.includes(';') || str.includes('；')) str = str.split(/[;；]/).pop().trim()
  else if (str.includes(',') || str.includes('，')) str = str.split(/[,，]/).pop().trim()
  return str
}

function normalizeAnswer(str) {
  if (str === null || str === undefined) return ''
  let s = String(str)

  // Full-width to half-width (includes letters, digits, punctuation)
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))

  // Chinese comma（、→ ,）
  s = s.replace(/、/g, ',')

  // Full-width space to regular space
  s = s.replace(/　/g, ' ')

  // Trim
  s = s.trim()

  // Case normalization (letters only)
  s = s.toUpperCase()

  // Strip trailing common punctuation
  s = s.replace(/[.,;:!?，。；：！？、）)\]}"'《》「」『』]+$/g, '')

  // Unit synonym replacement (Chinese → symbolic); longer patterns first
  const unitPairs = [
    ['小时', 'H'], ['時', 'H'],
    ['分钟', 'MIN'], ['分鐘', 'MIN'],
    ['秒钟', 'S'], ['秒鐘', 'S'],
    ['厘米', 'CM'], ['毫米', 'MM'],
    ['千克', 'KG'], ['公里', 'KM'],
    ['毫升', 'ML'],
    ['度', '°'],
    ['米', 'M'], ['时', 'H'], ['時', 'H'],
    ['分', 'MIN'], ['秒', 'S'],
    ['克', 'G'], ['升', 'L'],
  ]
  for (const [cn, sym] of unitPairs) {
    s = s.replace(new RegExp(cn, 'g'), sym)
  }

  // Remove all whitespace
  s = s.replace(/\s+/g, '')

  return s
}

/** Normalize judge (true/false) answer to a canonical form: 'T' or 'F' */
function normalizeJudgeAnswer(str) {
  if (!str) return ''
  const s = String(str).trim()
  // Correct/True indicators
  if (/^[✓√✔vV]$/.test(s)) return 'T'       // checkmark variants
  if (/^(正确|对|是|true|yes|T)$/i.test(s)) return 'T'
  // Wrong/False indicators
  if (/^[✗✘×xX]$/.test(s)) return 'F'       // cross variants
  if (/^(错误|错|否|false|no|F)$/i.test(s)) return 'F'
  return s.toUpperCase()
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
    const testVals = [0, 1, 2, -1, 0.5, 3, -2, 5, 0.25, 10]
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
        if (Math.abs(fn1() - fn2()) > 1e-9) return false
      } catch {
        continue // skip test values that cause math errors (e.g. division by zero)
      }
    }
    return true
  } catch {
    return false
  }
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
    // No reference answer: mark as pending for manual review instead of assuming correct
    return { isCorrect: null, unrecognized: true }
  }

  if (questionType === 'choice') {
    // Choice: 严格字母匹配，case-insensitive，并去掉包裹的括号/全角括号
    //   学生答题 OCR 常把选项识别为 "(C)"/"（C）"/" C "(带括号)，参考答案常是裸 "C"。
    //   之前未去括号 → "(C)" !== "C" → 选对但判错（用户截图实例：题 17 学生选 C 判错）。
    //   修复后：(C) / （C） / C / c 都归一为 "C" 严格相等。
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
  // 先收窄过程型答案（如 "=√4=2" → "2"），再与参考答案比对
  const narrowedStudent = narrowToFinalAnswer(studentAnswer)
  const normStudent = normalizeAnswer(narrowedStudent)
  const normRef = normalizeAnswer(referenceAnswer)

  // String-level match
  if (normStudent === normRef) {
    return { isCorrect: true, unrecognized: false }
  }

  // String mismatch — try mathematical equivalence
  // (handles cases like "2x-4" vs "2(x-2)" which are the same but differ textually)
  if (isMathEquivalent(narrowedStudent, referenceAnswer)) {
    return { isCorrect: true, unrecognized: false }
  }

  // Fallback: if both answers contain the same set of numbers (integers or decimals),
  // consider them equivalent. This handles cases where the AI generates a verbose
  // reference answer (e.g. "奇数是1,3,5,7,9；素数是2,3,5,7") while the student
  // gives a concise answer (e.g. "1,3,5,7,9；2,3,5,7").
  const studentNums = (normStudent.match(/\d+(\.\d+)?/g) || []).sort().join(',')
  const refNums = (normRef.match(/\d+(\.\d+)?/g) || []).sort().join(',')
  if (studentNums && refNums && studentNums === refNums) {
    return { isCorrect: true, unrecognized: false }
  }

  // Fallback: detect judge-like answers even when question_type is not 'judge'
  // (e.g. AI classified a judge question as "fill"). If student wrote √/×/✓/✗
  // and reference contains 正确/错误/对/错, try judge normalization.
  const rawStudent = String(studentAnswer || '').trim()
  const rawRef = String(referenceAnswer || '').trim()
  const isJudgeLikeStudent = /^[✓√✔✗✘×vVxX]$/.test(rawStudent) ||
    /^(正确|错误|对|错|true|false|yes|no|T|F)$/i.test(rawStudent)
  const isJudgeLikeRef = /(正确|错误|对|错|true|false|T|F)/i.test(rawRef)
  if (isJudgeLikeStudent && isJudgeLikeRef) {
    const jNorm = normalizeJudgeAnswer(rawStudent)
    const jRef = normalizeJudgeAnswer(rawRef)
    if (jNorm && jRef && jNorm === jRef) {
      return { isCorrect: true, unrecognized: false }
    }
  }

  return { isCorrect: false, unrecognized: false }
}
