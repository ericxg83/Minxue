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
 * OCR 模型有时把老师红笔批语（"计算错误""正确""×"…）当成"标准答案"抄进 answer 字段。
 * 这类值不是答案，是批改痕迹。写库前用它判定，命中就当脏答案丢弃、交给 AI 重解。
 * 判断题(judge)的"正确/错误/√/×"是合法答案，白名单排除，不误伤。
 */
const GRADING_COMMENT_WORDS = ['计算错误', '解答错误', '错误', '正确', '对', '错', '×', 'x', 'X', '√', '✓', '略', '过程略', '见解析', '不唯一']
export function isGradingCommentAnswer(answer, questionType) {
  const raw = String(answer ?? '').trim()
  if (raw === '') return false // 空值交给下游生成，不在此判
  if (!GRADING_COMMENT_WORDS.includes(raw)) return false
  const qt = String(questionType || '').toLowerCase()
  const isJudge = qt === 'judge' || qt.includes('判断')
  if (isJudge && ['正确', '错误', '对', '√', '×'].includes(raw)) return false
  return true
}

/**
 * 判题域硬规则的第一道闸门：识别"无法自动核对"的参考答案。
 *
 * isGradingCommentAnswer 只拦整串就是批改痕迹的脏答案（answer === '略'），
 * 但真实答案里这类内容多半是嵌在正常答案中间的：
 *   · "(1)证明略；(2)70°"          —— 第 1 小题无从核对
 *   · "$\frac{31}{15}$ (答案不唯一)" —— 参考值只是其中一个合法解
 *   · "证明：∠BDC=∠BDE…；, 8"      —— 证明过程 + 一个数值混在一串里
 * 这些答案拿去逐串比对，结论既可能假错（学生写了另一个合法解）也可能假对
 * （学生只碰巧命中了后半段的数值）。判不出就必须判不出，不能落 true/false：
 * false 会把题送进错题本与掌握度，true 会让真错题从复核视野里消失。
 *
 * @returns {string|null} 命中时返回原因码（见 UNJUDGED_REASONS），否则 null
 */
const UNVERIFIABLE_REFERENCE_PATTERNS = [
  /(?:过程|证明|解答|步骤|作图|画图|推导|说明|计算)略/,
  /^\s*略\s*[。.；;]?\s*$/,
  /见(?:解析|答案|课本|详解|教材|上文|下文)/,
  /不唯一/,
  /^\s*证明[:：]/,
  /[；;，,]\s*证明[:：]/
]

export function detectUnverifiableReference(referenceAnswer) {
  const raw = String(referenceAnswer ?? '').trim()
  if (!raw) return null
  return UNVERIFIABLE_REFERENCE_PATTERNS.some(re => re.test(raw))
    ? 'unverifiable_reference'
    : null
}

/**
 * "AI 未判定"的原因码与展示文案。写入 questions.answer_exception_reason，
 * 直接给老师看，因此存的是可读中文而不是裸码。
 *
 * 这些原因只是判题域的可观测标注，不构成第二套判定依据 ——
 * 错题本、掌握度、诊断一律只看 is_correct，不得读原因反推正误。
 */
export const UNJUDGED_REASONS = Object.freeze({
  no_reference_answer: '缺少参考答案，无法自动判定',
  unverifiable_reference: '参考答案无法自动核对（含略/见解析/答案不唯一）',
  subjective: '主观题需人工判定',
  low_confidence: '识别置信度不足，需人工确认'
})

/**
 * 扫描一批"标准答案"里的脏值，供所有"把答案提升为可信答案源"的入口共用。
 * 答案源一旦盖章 teacher_verified，会去判全班同类题，脏答案将放大成成片误判。
 * rows 兼容 questions(question_number/question_type) 与 resource_answers(question_no/answer_type)。
 */
export function findDirtyAnswers(rows) {
  const dirty = []
  for (const row of rows || []) {
    const raw = (row.answer ?? '').toString().trim()
    const type = row.question_type ?? row.answer_type
    let reason = null
    if (raw === '') reason = '空答案'
    else if (isGradingCommentAnswer(raw, type)) reason = '疑似批改文字'
    else if (/=\s*$/.test(raw)) reason = '答案疑似被截断'
    if (reason) {
      dirty.push({ question_no: row.question_no ?? row.question_number ?? null, answer: raw, reason })
    }
  }
  return dirty
}

export function normalizeQuestionType(rawType, options = []) {
  const type = String(rawType || '').trim().toLowerCase()
  if (['choice', 'select', 'multiple_choice', 'single_choice', '\u9009\u62e9', '\u9009\u62e9\u9898', '\u5355\u9009', '\u5355\u9009\u9898', '\u591a\u9009', '\u591a\u9009\u9898'].includes(type)) return 'choice'
  if (['judge', '\u5224\u65ad', '\u5224\u65ad\u9898', 'true_false', 'true/false'].includes(type)) return 'judge'
  if (['fill', 'blank', '\u586b\u7a7a', '\u586b\u7a7a\u9898'].includes(type)) return 'fill'
  if (['answer', 'solution', '\u89e3\u7b54', '\u89e3\u7b54\u9898', '\u8ba1\u7b97', '\u8ba1\u7b97\u9898'].includes(type)) return 'answer'
  if (Array.isArray(options) && options.length >= 2) return 'choice'
  return type || 'answer'
}

export function normalizeChoiceAnswer(value) {
  let answer = String(value ?? '').trim()
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toUpperCase()
    .replace(/^[\s\uFF08(\[\u3010\u300C\u300E]+|[\s\uFF09)\]\u3011\u300D\u300F]+$/g, '')
    .replace(/[.\uFF0E\u3001,\uFF0C;\uFF1B:\uFF1A\s]+/g, '')

  const prefixes = ['ANSWER', 'SELECT', 'OPTION', '\u7B54\u6848', '\u9009\u62E9', '\u9009', '\u4E3A', '\u662F']
  let changed = true
  while (changed) {
    changed = false
    for (const prefix of prefixes) {
      if (answer.startsWith(prefix)) {
        answer = answer.slice(prefix.length).replace(/^[?:]/, '')
        changed = true
        break
      }
    }
  }
  if (!/^[A-H]+$/.test(answer)) return ''
  return [...new Set(answer)].sort().join('')
}

/**
 * 选择题选项字母的宽松提取。
 *
 * 参考答案里的选项字母被各种噪声包着，两个来源都脏：
 *  · 答案库（AI 解析答案页）："A（21/2）**" / "(D) 2√5/5" / "**B**" / "B选项"
 *  · AI 现场生成答案（答案库没命中时）："选项 C" / "为选项D" / "sin∠CAB = 3/5，选(B)"
 * normalizeChoiceAnswer 对这些一律返回空串，于是退化成整串字面比较——
 * 学生写 "D"、参考答案存成 "为选项D"，选对了却判错。
 *
 * 五级降级：严格归一 → 去 markdown 后严格归一 → 取开头的选项字母 →
 * 找"选/答案为"这类选项标记词后面的字母 → 全串只有一个被括号括起来的字母。
 * 每级都要求字母不与其它字母数字相连，"AC = 8" 这类填空答案不会被误读成选项。
 */
export function extractChoiceLetters(value) {
  const strict = normalizeChoiceAnswer(value)
  if (strict) return strict

  const cleaned = String(value ?? '')
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[*_`~]/g, '')
    .trim()
  const relaxed = normalizeChoiceAnswer(cleaned)
  if (relaxed) return relaxed

  const upper = cleaned.toUpperCase()

  // "……，选(B)" / "答案为 D" / "应选 C 项"：标记词后面紧跟的字母
  const marked = upper.match(
    /(?:正确答案|答案|应选|故选|选项|选)\s*(?:为|是)?\s*[:：]?\s*[(\[【]?\s*([A-H])\s*[)\]】]?(?![A-Z0-9])/)
  if (marked) return marked[1]

  // 选择题 AI 解析答案的综述形态："B正确；C错误；D错误" / "B 正确，D 正确，C 错误"。
  // 必须在 headMatch 之前：综述串以某个答案字母开头时（如 "B正确，D正确"），
  // headMatch 会"巧合命中"首字母就 return，漏掉 D 等其他正确答案字母。
  // "字母 + 错误"不算答案；字母要求不与其它字母/数字相连，避免误伤"运算正确"/"C1正确"。
  const correctLetters = [
    ...upper.matchAll(/(?<![A-Z0-9])([A-H])\s*(?:正确|是对的?|√|✓)(?![A-Z0-9])/gi)
  ].map(m => m[1])
  if (correctLetters.length > 0) {
    return [...new Set(correctLetters)].sort().join('')
  }

  const head = upper.replace(/^(?:ANSWER|正确答案|答案|答|选择|选项|选|为|是)\s*[:：]?\s*/, '')
  const headMatch = head.match(/^[(\[【]?\s*([A-H])\s*[)\]】]?/)
  if (headMatch && !/^[A-Z0-9]/.test(head.slice(headMatch[0].length))) return headMatch[1]

  // 全串只有一个被括号括起来的字母："(A) 12米"
  const bracketed = [...upper.matchAll(/[(\[【]\s*([A-H])\s*[)\]】]/g)].map(m => m[1])
  const uniq = [...new Set(bracketed)]
  if (uniq.length === 1) return uniq[0]

  return ''
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

  // Remove parentheses around units: "4.8(时)" → "4.8时"
  // (must run BEFORE trailing punctuation strip, otherwise the closing paren is
  //  stripped first and the unit inside is lost, e.g. "4.8(时)" → "4.8(H")
  s = s.replace(/[（(]([^）)]+)[）)]/g, '$1')

  // Strip trailing common punctuation
  s = s.replace(/[.,;:!?，。；：！？、）)\]}>"'《》「」『』]+$/g, '')

  // LaTeX fraction MUST run AFTER toUpperCase (because toUpperCase changes \frac to \FRAC)
  // Convert LaTeX fraction back to standard form: \FRAC{n}{d} → n/d (after toUpperCase)
  // IMPORTANT: must add spaces around the fraction so mixed number rule can match "36 5/14"
  s = s.replace(/\\FRAC\{([^}]+)\}\{([^}]+)\}/gi, ' $1/$2 ')

  // Unit synonym replacement (Chinese → symbolic); longer patterns first
  const unitPairs = [
    ['小时', 'H'], ['小時', 'H'],
    ['分钟', 'MIN'], ['分鐘', 'MIN'],
    ['秒钟', 'S'], ['秒鐘', 'S'],
    ['厘米', 'CM'], ['毫米', 'MM'],
    ['千米', 'KM'], ['公里', 'KM'],
    ['千克', 'KG'], ['公斤', 'KG'],
    ['毫升', 'ML'],
    ['度', '°'],
    ['时', 'H'], ['時', 'H'],
    ['米', 'M'],
    ['分', 'MIN'], ['秒', 'S'],
    ['克', 'G'], ['升', 'L'],
  ]
  for (const [cn, sym] of unitPairs) {
    s = s.replace(new RegExp(cn, 'g'), sym)
  }

  // 上/下标数字分数（OCR 对手写分数的实际输出形态）：¹⁴/₁₅ → 14/15、1¹¹/₁₂ → 1 11/12、
  // 5¹/₅₀ → 5 1/50。此前只认 ½¼¾ 这类单字符分数，导致学生用上下标写对了也判错。
  // 只在出现上标或下标数字时改写，纯 ASCII 分数交给下面既有规则；
  // 且要求必须带分数线，避免误伤 "2³"、"x²" 这类指数（把 2³ 变成 23 会造成假判对）。
  const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
  const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉'
  s = s.replace(
    /(\d*)\s*([⁰¹²³⁴⁵⁶⁷⁸⁹]+|\d+)\s*[/⁄]\s*([₀₁₂₃₄₅₆₇₈₉]+|\d+)/g,
    (matched, whole, num, den) => {
      const hasSpecial = [...num].some(c => SUP_DIGITS.includes(c)) || [...den].some(c => SUB_DIGITS.includes(c))
      if (!hasSpecial) return matched
      const n = [...num].map(c => (SUP_DIGITS.includes(c) ? SUP_DIGITS.indexOf(c) : c)).join('')
      const d = [...den].map(c => (SUB_DIGITS.includes(c) ? SUB_DIGITS.indexOf(c) : c)).join('')
      return whole ? ` ${whole} ${n}/${d} ` : ` ${n}/${d} `
    }
  )

  // Unicode fraction symbols → /n form (must run BEFORE mixed-fraction rules)
  // ½→1/2, ⅓→1/3, ⅔→2/3, ¼→1/4, ¾→3/4, ⅕→1/5, ⅖→2/5, ⅗→3/5, ⅘→4/5,
  // ⅙→1/6, ⅚→5/6, ⅐→1/7, ⅛→1/8, ⅜→3/8, ⅝→5/8, ⅞→7/8, ⅑→1/9, ⅒→1/10
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
  // Unicode 乘除符号统一：×/✕/✖ → *（乘），÷ → /
  // OCR/模型常把乘号输出成 ×/✕/✖，统一为 * 便于与 LaTeX \times 一致比较。
  s = s.replace(/[×✕✖]/g, '*')
  s = s.replace(/÷/g, '/')
  // LaTeX display markers $ $ \( \) → 移除
  s = s.replace(/\$|\\[()]/g, '')

  // Mixed number with space: "146 3/4" → "146+3/4" (before whitespace removal)
  s = s.replace(/(\d+)\s+(\d+\/\d+)/g, '$1+$2')

  // Convert Chinese mixed fraction to standard form: "12又1/3" → "12+1/3"
  s = s.replace(/(\d+)又([+-]?\d+\/\d+)/g, '$1+$2')

  // Remove all whitespace
  s = s.replace(/\s+/g, '')

  return s
}

/**
 * 单位换算基准表：把常见单位统一换算到基准值。
 * 时间→秒，长度→米，重量→克，容量→毫升，角度→度。
 * 用于 "120秒" vs "2分钟"、"3千米" vs "3000米" 这类跨单位等值判定。
 */
const UNIT_BASE = {
  H: 3600, MIN: 60, S: 1,
  KM: 1000, M: 1, CM: 0.01, MM: 0.001,
  KG: 1000, G: 1,
  L: 1000, ML: 1,
  '°': 1,
}

/**
 * 把"数值+单位"解析为换算到基准后的纯数值；解析失败返回 null。
 * @param {string} s 已 normalize 的字符串（大写、无空白）
 */
function parseValueWithUnit(s) {
  const m = String(s).match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Z°]+)$/)
  if (m && UNIT_BASE[m[2]]) {
    return parseFloat(m[1]) * UNIT_BASE[m[2]]
  }
  // 纯表达式（可能含 +-*/() 与分数），剥离非数字/运算符字符
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
 * Pure numeric equivalence check that strips units/letters and compares values.
 * Handles "37/3km" vs "12+1/3KM", "1/2" vs "0.5", "4.8H" vs "4.8小时",
 * and cross-unit equivalents like "120秒" vs "2分钟" / "3千米" vs "3000米".
 * Uses a sanitizing regex (no eval of arbitrary code, no variables).
 */
function isNumericEquivalent(a, b) {
  const numA = parseValueWithUnit(a)
  const numB = parseValueWithUnit(b)
  if (numA == null || numB == null) return false
  return Math.abs(numA - numB) < 1e-9
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
 * √ → **0.5。支持嵌套括号：√(7(a-b)) → ((7*(a-b)))**0.5。
 * 原先用 /√\(([^()]*)\)/ 只能吃不含括号的内容，√(7(a-b)) 整个留着 √ 字符，
 * eval 必然抛错 → 判"不等"，学生把二次根式化简对了也算错。
 * 语义保持不变：√ 后面不带括号时只吃数字（"√2m" 仍是 √2·m，不是 √(2m)）。
 */
function convertSqrtToPower(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] !== '√') { out += s[i]; i++; continue }
    let j = i + 1
    while (j < s.length && /\s/.test(s[j])) j++
    if (s[j] === '(') {
      let depth = 0
      let k = j
      for (; k < s.length; k++) {
        if (s[k] === '(') depth++
        else if (s[k] === ')' && --depth === 0) break
      }
      if (k < s.length) {
        out += '((' + convertSqrtToPower(s.slice(j + 1, k)) + '))**0.5'
        i = k + 1
        continue
      }
    }
    const num = /^[0-9]+(?:\.[0-9]+)?/.exec(s.slice(j))
    if (num) {
      out += '((' + num[0] + '))**0.5'
      i = j + num[0].length
      continue
    }
    out += s[i]
    i++
  }
  return out
}

/**
 * 把数学表达式改写成可被 JS eval 的形式（去等式左边、^→**、√→**0.5、补隐式乘号）。
 */
function prepareMathExpr(input) {
  let s = String(input ?? '')
  // Strip equation prefix: "y = 2x - 4" → "2x - 4", "f(x)=..." → "..."
  const eqIdx = s.indexOf('=')
  if (eqIdx > 0) s = s.substring(eqIdx + 1)
  s = s.trim()
  // ^ → **  (exponentiation)
  s = s.replace(/\^/g, '**')
  // Unicode 上标数字 → **N（OCR 常见 x² y³ 这类手写形态；否则 ² 不是合法 JS 标识符 → eval 抛错 → 数学等价失败）
  // 2026-09-01 用户截图：题#11 答案含 "x²" 上标，原 prepareMathExpr 不处理，
  //   isMathEquivalent 走 eval 抛错 → 整个数学等价分支 false。
  s = s.replace(/([a-zA-Z\)])[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (_, base) => {
    const supMap = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' }
    let n = ''
    for (const c of _.slice(1)) n += supMap[c] || c
    return `${base}**${n}`
  })
  // 用 **0.5 而非 Math.sqrt，避免后续 toLowerCase 把 Math 变成 math 导致 ReferenceError。
  s = convertSqrtToPower(s)
  // Insert * for implicit multiplication: "2x" → "2*x", "2(" → "2*(", ")(" → ")*("
  // 先处理"数字 空格 ( " 的形式（"2 √5"→"2 ((5))**0.5" 后是 "2 ("）：必须在 (\d)([a-zA-Z(]) 之前，
  // 否则 "2 (" 因中间有空格而漏插 *，生成 "2 ((" 的非法 JS → eval 抛错 → 误判不等。
  s = s.replace(/(\d)\s+\(/g, '$1*(')
  s = s.replace(/(\d)([a-zA-Z(])/g, '$1*$2')
  s = s.replace(/([a-zA-Z)])(\d)/g, '$1*$2')
  s = s.replace(/\)\(/g, ')*(')
  return s
}

/**
 * Check if two math expressions are numerically equivalent
 * by substituting test values for variables and comparing results.
 * Handles implicit multiplication, ^ exponentiation, and equation prefix.
 */
function isMathEquivalent(expr1, expr2) {
  if (!expr1 || !expr2) return false

  // 两个"单字母"答案（如 "B" vs "D"）不应判为数学等价。
  // 变量赋值逻辑会对两边代入相同测试值 → 不同字母也会恒等，导致误判相等。
  // 这类通常是选择题/判断题的选项字母，靠严格匹配，数学等价不该接手。
  const singleLetter = (s) => /^[a-zA-Z]$/.test(String(s).trim())
  if (singleLetter(expr1) && singleLetter(expr2) && String(expr1).trim().toUpperCase() !== String(expr2).trim().toUpperCase()) {
    return false
  }

  try {
    let e1 = prepareMathExpr(expr1).toLowerCase()
    let e2 = prepareMathExpr(expr2).toLowerCase()

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

/**
 * 求表达式的数值；含变量或求不出来返回 null。
 */
function evalMathValue(input) {
  const expr = prepareMathExpr(input).toLowerCase()
  if (!expr) return null
  // 只接受纯数值表达式：留有字母说明含变量/函数名，比例判定不该猜
  if (/[a-z]/.test(expr.replace(/\*\*/g, ''))) return null
  try {
    const v = new Function(`"use strict"; return (${expr})`)()
    return typeof v === 'number' && isFinite(v) ? v : null
  } catch {
    return null
  }
}

/**
 * 把 "√3:√2" 这类比例逐段求值；段数不足或有一段求不出数值返回 null。
 */
function parseRatioValues(input) {
  const parts = String(input ?? '').split(/[:：]/).map(x => x.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const vals = parts.map(evalMathValue)
  return vals.some(v => v == null) ? null : vals
}

/**
 * 比例答案的等值判定："√6:2" 与 "√3:√2" 是同一个比。
 * 逐段求值后按首项归一再比，段数必须相等且都能求出数值。
 * 之前这类答案只能整串字面比较，学生把比化简成另一种等价写法就判错。
 */
function isRatioEquivalent(a, b) {
  const va = parseRatioValues(a)
  const vb = parseRatioValues(b)
  if (!va || !vb || va.length !== vb.length || !va[0] || !vb[0]) return false
  return va.every((v, i) => Math.abs(v / va[0] - vb[i] / vb[0]) < 1e-9)
}

/**
 * 剥掉参考答案里的空位叙述壳："第一空为 (7√(2m))/4" → "(7√(2m))/4"。
 * AI 生成多空填空题答案时爱加这层前缀，逐项比对时它会让每一项都对不上。
 */
const BLANK_LABEL_RE = /^第\s*[一二三四五六七八九十百\d]+\s*(?:个)?\s*(?:空格|空|题|问)\s*(?:为|是|填|应填)?\s*[:：]?\s*/
function stripBlankLabel(value) {
  return String(value ?? '').trim().replace(BLANK_LABEL_RE, '').trim()
}

/**
 * 剥掉多空答案前的序号壳："(1) ="/"（2）<"/"1) "/"② "/"一、"。
 * AI 解析多空填空题（"用 > < = 填空"的两个空）常写成 "(1) =; (2) <"，
 * 学生端直接填 "=, <" —— 序号壳不剥掉，逐项比对必失败，且符号答案
 * 没数字给 extractAndCompare 兜底，整题直接判错。
 * 与 stripBlankLabel 互补：前者剥"第N空为"叙述壳，本函数剥"(N)"序号壳。
 */
const SEQUENCE_LABEL_RE = /^\s*(?:[（(\[【]\s*)?(?:[①-⑨]|[一二三四五六七八九十]|\d+)\s*[)）\]】.,。、]\s*/
function stripSequenceLabel(value) {
  return String(value ?? '').replace(SEQUENCE_LABEL_RE, '').trim()
}

// 答案开头的叙述性脚手架："答案为"/"答:"/"解："/"结果是" 等，AI 现场生成填空/解答答案时爱加。
// 只吃「行首」的闭集词 —— "底角的余弦值等于 3/4" 这类把"等于"用在句中的真答案不受影响（正则锚定 ^）。
const ANSWER_SCAFFOLD_RE = /^\s*(?:正确答案|标准答案|答案|答|解|结果)\s*(?:为|是|应为|应该是|等于)?\s*[:：]?\s*/
// 裸引导词（"为 512/125"、"即 √6/2"）：仅当其后紧跟数学形态字符时才剥，避免误伤"为难"这类正文。
const BARE_LEAD_RE = /^\s*(?:为|即|应为|故得|故|所以)\s+?(?=[\d\-+.（(√\\a-zA-Z])/
// 剥完必须仍含数字/字母/数学符号，否则视为纯叙述答案（如"答案是对的"），原样返回不动。
const HAS_MEANINGFUL_RE = /[\d a-zA-Z√\\/^_(){}.]/

/**
 * 剥掉 AI 生成答案开头的叙述脚手架，只保留答案本体。保守策略：
 *   · 只吃行首闭集词，句中同形词不动（"底角的余弦值等于 3/4 或 1/3" 保持原样）；
 *   · 裸引导词需其后紧跟数学字符才剥；
 *   · 结果为空或不含任何数学/字母内容时，判定为纯叙述答案，原样返回。
 * 仅用于写入端（normalizeGeneratedAnswer），不改动存量答案。
 */
export function stripAnswerScaffolding(value) {
  const original = String(value ?? '').trim()
  if (!original) return original
  let out = original.replace(ANSWER_SCAFFOLD_RE, '')
  if (out === original) out = original.replace(BARE_LEAD_RE, '')
  out = out.trim()
  if (!out || !HAS_MEANINGFUL_RE.test(out)) return original
  return out
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

  // 参考答案本身无法自动核对（"证明略""见解析""答案不唯一"…）→ 判不出，交人工。
  // 必须在任何比对之前拦下：往下走只会得到一个没有依据的 true/false。
  if (detectUnverifiableReference(referenceAnswer)) {
    return { isCorrect: null, unrecognized: true }
  }

  const normalizedType = normalizeQuestionType(questionType)
  const studentChoice = normalizeChoiceAnswer(studentAnswer)
  const referenceChoice = normalizeChoiceAnswer(referenceAnswer)
  if (studentChoice && referenceChoice) {
    return { isCorrect: studentChoice === referenceChoice, unrecognized: false }
  }

  if (normalizedType === 'choice') {
    // Choice: 严格字母匹配，case-insensitive，并去掉包裹的括号/全角括号
    //   学生答题 OCR 常把选项识别为 "(C)"/"（C）"/" C "(带括号)，参考答案常是裸 "C"。
    //   之前未去括号 → "(C)" !== "C" → 选对但判错（用户截图实例：题 17 学生选 C 判错）。
    //   修复后：(C) / （C） / C / c 都归一为 "C" 严格相等。
    // 参考答案带选项内容/markdown 残留时（"A（21/2）**"）先提取选项字母再比，
    // 否则 "A" vs "A（21/2）**" 会把选对判成错。
    const studentLetters = extractChoiceLetters(studentAnswer)
    const referenceLetters = extractChoiceLetters(referenceAnswer)
    if (studentLetters && referenceLetters) {
      return { isCorrect: studentLetters === referenceLetters, unrecognized: false }
    }
    const cleanChoice = (s) => String(s || '').trim().toUpperCase().replace(/^[（(]|[)）]$/g, '')
    return { isCorrect: cleanChoice(studentAnswer) === cleanChoice(referenceAnswer), unrecognized: false }
  }

  if (normalizedType === 'judge') {
    // Judge: 同样去括号/全角括号（"（√）" / "(×)" → "√" / "×"），再走 T/F 归一化
    const cleanJudge = (s) => String(s || '').trim().replace(/^[（(]|[)）]$/g, '')
    const normStudent = normalizeJudgeAnswer(cleanJudge(studentAnswer))
    const normRef = normalizeJudgeAnswer(cleanJudge(referenceAnswer))
    return { isCorrect: normStudent === normRef, unrecognized: false }
  }

  // Fill / answer / other: normalized comparison with tolerance
  // 先收窄过程型答案（如 "=√4=2" → "2"），再与参考答案比对

  // 学生答案与参考答案归一化后字面完全一致 → 必然正确，必须在任何收窄之前判。
  // narrowToFinalAnswer 只作用于学生侧（取最后一个 "=" 右侧），参考答案不收窄，
  // 于是 "x = -m ± √n" 与一模一样的参考答案会被比成 "-m±√n" vs "x=-m±√n" 而判错
  // （用户截图实例：填空题"(x+m)²=n 的解为"，学生与标准逐字符相同却报"AI 判定错误"）。
  // ± 这类符号无法数值化，下游 isMathEquivalent / extractAndCompare 也救不回来。
  // 归一化后为空串的不算（"。" 与 "，" 都会被 strip 成空串，不能因此判对）。
  const normStudentWhole = normalizeAnswer(studentAnswer)
  if (normStudentWhole && normStudentWhole === normalizeAnswer(referenceAnswer)) {
    return { isCorrect: true, unrecognized: false }
  }

  // Helper: 单个答案片段的归一化比较
  const normalizeAndCompare = (sAns, rAns) => {
    const sClean = stripSequenceLabel(stripBlankLabel(sAns))
    const rClean = stripSequenceLabel(stripBlankLabel(rAns))
    // 收窄后为空（片段本身就是 "=" 或以 "=" 结尾）时退回原片段，
    // 否则空格分片比较里的 "=" 片段永远与参考侧的 "=" 不等，整题被拖成错。
    const narrowed = narrowToFinalAnswer(sClean) || sClean
    const normS = normalizeAnswer(narrowed)
    const normR = normalizeAnswer(rClean)
    if (normS === normR) return true
    if (isNumericEquivalent(normS, normR)) return true
    if (isMathEquivalent(narrowed, rClean)) return true
    if (isRatioEquivalent(narrowed, rClean)) return true
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
    if (sNums.length === 0 || rNums.length === 0) return false

    // 快速路径：严格长度匹配（保留原行为，避免误判）
    if (sNums.length === rNums.length &&
        sNums.every((v, i) => Math.abs(v - rNums[i]) < 1e-9)) {
      return true
    }

    // 集合语义兜底：解决"学生答 4.8 vs 参考 24/5 小时（即 4.8）"被误判为错的问题。
    // 参考答案常同时给出"分数+小数"两种等价写法（如 24/5 和 4.8 同一道题），
    // 提取后 rNums 会有重复值，sNums 只有 1 个，长度不一致判错。
    // 兜底条件（必须同时满足，避免误判）：
    //   1) 去重后学生答案的每个数字都在参考答案里
    //   2) 参考答案去重后种类数不超过学生答案种类数 + 1
    //      （允许参考答案多 1 个"换算小尾巴"，如 4.8 小时 = 4.8×60=288 分钟，
    //      阻挡"3" vs "2,3,4,5" 这种全枚举的误判）
    const key = (v) => Math.round(v * 1e6) / 1e6
    const sSet = new Set(sNums.map(key))
    const rSet = new Set(rNums.map(key))
    if (sSet.size > 0 && rSet.size > 0 &&
        [...sSet].every(v => rSet.has(v)) &&
        rSet.size <= sSet.size + 1) {
      return true
    }
    return false
  }

  // 检测逗号/分号分隔的多答案
  const splitAnswers = (s) => {
    const str = String(s || '').trim()
    if (str.includes(',') || str.includes('，') || str.includes(';') || str.includes('；')) {
      return str.split(/[,，;；]/).map(a => a.trim()).filter(a => a)
    }
    return [str]
  }

  // 宽松切分：把"和/与/及"也当分隔符。
  // AI 生成的多空答案常写成 "5√3 和 (5√6)/2"，学生写成 "5√3, (5/2)√6"——
  // 标点切分只能把参考答案切成 1 段，逐项比对根本进不去，整题判错。
  // 只在标准切分全部失败后当额外一轮，且要求两边段数相等、每段都等价，避免"和为12"这类被切坏。
  const splitAnswersLoose = (s) => String(s || '').trim()
    .split(/[,，;；]|和|与|及/).map(a => a.trim()).filter(a => a)

  // 按空格分割（用于比较符号等非数值多答案场景）
  const splitBySpace = (s) => {
    const str = String(s || '').trim()
    return str.split(/\s+/).map(a => a.trim()).filter(a => a)
  }

  // 解答题"列点作答"型：学生答案写成 "当x=0时, y=3; 当x=-1时, y=0" 这种
  // 键值叙述形态，参考却是裸数字列表 "3, 0"。
  // 按 ; 拆组，每组找所有 key=value（key 是字母/汉字），取最后一个 value 作为
  // 该组的结果（通常 y=xxx 是结果），组成 value 序列。
  // 必须 ≥2 组才触发，避免误伤学生只是顺手写了 "x=2" 的单点题。
  const extractKvGroupLastValues = (s) => {
    const groups = String(s || '').split(/[;；]/)
    const values = []
    for (const g of groups) {
      const trimmed = g.trim()
      if (!trimmed) continue
      const matches = [...trimmed.matchAll(/([a-zA-Z一-龥])\s*=\s*([^=;,，;；]+)/g)]
      if (matches.length === 0) continue
      values.push(matches[matches.length - 1][2].trim())
    }
    return values
  }

  // 键值叙述桥接：必须在 splitAnswers 多空分支之前插入——
  // "当x=0时, y=3; 当x=-1时, y=0" 走 splitAnswers 按 ,; 会切成 4 段
  // ("当x=0时", "y=3", "当x=-1时", "y=0")，参考 "3, 0" 是 2 段，
  // 段数不等直接跳过逐项比对 + 数字集合兜底多出 -1、x=… 等数字 → 全错。
  const studentKvValues = extractKvGroupLastValues(studentAnswer)
  const refKvValues = extractKvGroupLastValues(referenceAnswer)

  // 两边都是键值叙述 → 按顺序比对 value
  if (studentKvValues.length >= 2 && refKvValues.length >= 2 &&
      studentKvValues.length === refKvValues.length) {
    let allMatch = true
    for (let i = 0; i < studentKvValues.length; i++) {
      const sV = studentKvValues[i]
      const rV = refKvValues[i]
      const ns = normalizeAnswer(sV)
      const nr = normalizeAnswer(rV)
      if (ns !== nr && !isNumericEquivalent(ns, nr) && !isMathEquivalent(sV, rV)) {
        allMatch = false
        break
      }
    }
    if (allMatch) return { isCorrect: true, unrecognized: false }
  }

  // 学生是键值叙述、参考是裸数字列表（最常见："3, 0"）
  if (studentKvValues.length >= 2 && refKvValues.length === 0) {
    const refSegments = splitAnswers(referenceAnswer)
    if (refSegments.length === studentKvValues.length) {
      let allMatch = true
      for (let i = 0; i < studentKvValues.length; i++) {
        const sV = studentKvValues[i]
        const rV = refSegments[i].trim()
        const ns = normalizeAnswer(sV)
        const nr = normalizeAnswer(rV)
        if (ns !== nr && !isNumericEquivalent(ns, nr) && !isMathEquivalent(sV, rV)) {
          allMatch = false
          break
        }
      }
      if (allMatch) return { isCorrect: true, unrecognized: false }
    }
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

  // 多答案场景：学生或标准只有一方有逗号，仍然尝试数值整体比较
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

  // 多答案场景：学生用空格分隔、参考用 ; 或 , 分隔（如 "= <" vs "(1) =; (2) <"）。
  // splitBySpace 拆参考会把 "(1) =; (2) <" 拆成 5 段，与学生 2 段对不上；
  // splitAnswers 拆学生空格答案只出 1 段，与参考 2 段也对不上——两边互换才能命中。
  if (studentSpaceParts.length > 1 && refParts.length > 1 &&
      studentSpaceParts.length === refParts.length) {
    const allCorrect = studentSpaceParts.every((sp, i) => {
      const rp = refParts[i]
      return normalizeAndCompare(sp, rp) || extractAndCompare(sp, rp)
    })
    if (allCorrect) return { isCorrect: true, unrecognized: false }
  }

  // 多答案场景：一侧用"和/与/及"连接（"5√3 和 (5√6)/2" vs "5√3, (5/2)√6"）。
  // 只用 normalizeAndCompare 逐项比，不接 extractAndCompare 的数字集合兜底——
  // 切分本身已经放宽了，再叠一层宽松兜底会把答错的题判对。
  const studentLooseParts = splitAnswersLoose(studentAnswer)
  const refLooseParts = splitAnswersLoose(referenceAnswer)
  if (refLooseParts.length > 1 && studentLooseParts.length === refLooseParts.length) {
    if (studentLooseParts.every((sp, i) => normalizeAndCompare(sp, refLooseParts[i]))) {
      return { isCorrect: true, unrecognized: false }
    }
  }

  // 单答案场景：标准比较流程
  // 双侧收窄：参考答案也走 narrowToFinalAnswer，去掉"a = ..., y = ..."这种过程噪声
  // 仅收窄到最后一个 "=" 右侧；收窄后为空时退回原串，避免误伤。
  // 2026-09-01 用户截图：题#11 学生"代入得 -1/4 = a, ∴函数表达式为 y = -1/4 x²"
  // 与参考"a = -1/4, y = -1/4 x²" 收窄到同段 "-1/4 x²" 才能字面相等判对。
  //
  // 键值叙述保护：学生答案是"列点作答"形态（"当x=0时, y=3; 当x=-1时, y=0"）
  // 时不要收窄，会把所有点压到最后 `=` 之后那个值，与参考答案按 "," 取末段
  // 偶然相等造成假判对（如 y=4 vs 3, 0 → 都收窄到 "0" → 字面相等判对）。
  // kv bridge 已经在 splitAnswers 之前尝试匹配过，未命中说明答错，直接判错更安全。
  const isKvNarrative = studentKvValues.length >= 2
  const narrowedStudent = isKvNarrative ? studentAnswer : narrowToFinalAnswer(studentAnswer)
  const narrowedRef = narrowToFinalAnswer(referenceAnswer) || referenceAnswer
  const normStudent = normalizeAnswer(narrowedStudent)
  const normRef = normalizeAnswer(narrowedRef)

  // String-level match（两边归一化后都为空不算命中：学生只写了标点/括号时
  // normalizeAnswer 会 strip 成空串，和同样被 strip 成空串的参考答案"相等"而误判为对）
  if (normStudent && normStudent === normRef) {
    return { isCorrect: true, unrecognized: false }
  }

  // Pure numeric equivalence with unit tolerance
  if (isNumericEquivalent(normStudent, normRef)) {
    return { isCorrect: true, unrecognized: false }
  }

  // String mismatch — try mathematical equivalence
  if (isMathEquivalent(narrowedStudent, referenceAnswer)) {
    return { isCorrect: true, unrecognized: false }
  }

  // 比例答案（"√6:2" vs "√3:√2"）：整串是一个比，比里各项的顺序有意义，
  // 两边都能逐段求出数值时以比例判定为最终结果——不能落到下面
  // extractAndCompare 的"排序后数字集合"兜底，那会把 2:3 和 3:2 判成对。
  if (parseRatioValues(studentAnswer) && parseRatioValues(referenceAnswer)) {
    return {
      isCorrect: isRatioEquivalent(studentAnswer, referenceAnswer),
      unrecognized: false
    }
  }

  // Fallback: compare numeric values from original input
  if (extractAndCompare(studentAnswer, referenceAnswer)) {
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
