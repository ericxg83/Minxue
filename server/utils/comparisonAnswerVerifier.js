/**
 * 比较大小题型的确定性校验（2026-09-21 √7>3 事故修复）
 *
 * 事故：答案引擎（弱兜底模型）把"比较大小：√7 ___ 3"的参考答案算反，
 * analysis 写"√7≈2.64575，因为2.64575大于3，所以填'>'"，落库 answer='>'，
 * 判学生（填'<'，正确）为错。
 * describeReferenceAnswerRisk 只查"算式算错+答案等于错误等式右边"，对这种
 * 自然语言反差不敏感，没拦住。
 *
 * 修复思路：比较大小是**确定性**题型，不依赖模型——
 * 自己用数值库求两个表达式的大小，与模型答案比对。
 *   · 一致 → 正常落库；
 *   · 不一致 → 返回 risk 文案（调用方清空 answer + 转人工，不写错答案）。
 *   · 无法提取/无法求值 → 返回 null（不适用，交由既有链路，绝不误伤）。
 *
 * 安全：自带受限求值器，表达式先过字符白名单（仅数字/运算符/括号/sqrt/PI/点/指数）
 * 再用 Function 求值，挡住注入。不引入第三方求值库。
 */

// ── 受限数值求值：支持 数字、+ - * / ( ) ^ √ π、上标指数，浮点近似 ──
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const SUP_SIGNS = { '⁻': '-', '⁺': '+' }

function safeEval(expr) {
  if (!expr || typeof expr !== 'string') return null
  let code = String(expr)
    // 各类 Unicode 减号 → ASCII '-（OCR/印刷体常见 −–—﹣）
    .replace(/[−–—﹣]/g, '-')
    // LaTeX / 印刷体根号统一 → Math.sqrt(...)（放在最前，避免去空格破坏方法调用）
    // 注意：捕获组必须用贪婪 [^}]*，且 \}? 保留可选——惰性 ([^}]*?) 会让 \{ 与可选 \}?
    // 直接配对成功、捕获为空，把根号内数字甩到括号外（实测 \sqrt{7} → Math.sqrt()7) 崩错）
    .replace(/\\sqrt\s*\{?([^}]*)\}?/g, 'Math.sqrt($1)')
    .replace(/√\s*(\([^()]*\)|\d+(?:\.\d+)?)/g, 'Math.sqrt($1)')
    .replace(/π/g, ' Math.PI ')
    .replace(/[×✕·]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[（【]/g, '(')
    .replace(/[）】]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\^/g, '**')
    .replace(/[⁺⁻]/g, (m) => (m === '⁻' ? '-' : '+'))
  // Unicode 上标数字 → **(n)
  code = code.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => {
    let e = ''
    for (const c of m) e += String(SUP_DIGITS.indexOf(c))
    return '**(' + e + ')'
  })
  // 数字紧邻 √ / Math.sqrt / ( 时补乘号（4√3 → 4*√3，2(3+1) → 2*(3+1)）
  code = code.replace(/(\d)\s*(?=√|Math\.sqrt|\()/g, '$1*')
  code = code.replace(/\s+/g, '')
  // 白名单：只放行数值运算字符。Math.sqrt / Math.PI 归一后只剩 M a t h s q r t P I 字母。
  if (!/^[\d+\-*/().**MathsqrtPI]*$/.test(code)) return null
  try {
    // eslint-disable-next-line no-new-func
    const v = Function('return (' + code + ')')()
    if (typeof v !== 'number' || !isFinite(v)) return null
    return v
  } catch {
    return null
  }
}

// 从题面提取被比较的两个表达式（仅"比较大小"句型适用）
function extractComparisonOperands(content) {
  const text = String(content || '')
  const m = text.match(/比较大小[：:]\s*([\s\S]*?)(?:[。.．]|$)/)
  if (!m) return null
  let body = m[1]
  // 去括号及括号内提示语（如（填"<"或">"））
  body = body.replace(/[（(][^（）()\n]*?[）)]/g, ' ')
  // 填空线 / 长破折号 → 空格
  body = body.replace(/___+|__+|—+|─+/g, '  ')
  body = body.replace(/\s+/g, ' ').trim()
  if (!body) return null
  // 按"与/和/及/比/逗号/空格"拆分
  let parts = body.split(/\s+(?:与|和|及)\s+/)
  if (parts.length !== 2) parts = body.split(/\s+/)
  parts = parts
    .map((s) => s.replace(/[。.．,，]$/, '').trim())
    .filter(Boolean)
  if (parts.length === 2) return parts
  return null
}

function fmt(n) {
  if (n === null || n === undefined) return '?'
  return Math.abs(n) >= 1e-4 && Math.abs(n) < 1e6 ? String(Number(n.toFixed(5))) : n.toExponential(3)
}

/**
 * @param {string} content 题面（拼接 parent_stem 后的完整题干）
 * @param {string} answer  模型给出的参考答案（可能含 < > ≤ ≥ =）
 * @returns {null | {ok:true} | {ok:false, expected:string, actual:string, reason:string}}
 *   null = 不适用（不是比较大小题 / 无法提取 / 无法求值）
 */
export function verifyComparisonAnswer(content, answer) {
  const ops = extractComparisonOperands(content)
  if (!ops) return null
  const [aRaw, bRaw] = ops
  const a = safeEval(aRaw)
  const b = safeEval(bRaw)
  if (a === null || b === null) return null // 无法求值 → 不适用，不误伤

  const eps = 1e-6
  let expected
  if (Math.abs(a - b) < eps) expected = '='
  else expected = a < b ? '<' : '>'

  // 归一模型答案里的符号
  const raw = String(answer ?? '').replace(/[＜]/g, '<').replace(/[＞]/g, '>')
  const firstSym = (raw.match(/[<>=≤≥]/) || [''])[0]
  if (!firstSym) return null // 答案不是比较符号 → 不适用

  // 宽容匹配：≤ 视为包含 <，≥ 视为包含 >；相等只认 =
  const ok =
    expected === firstSym ||
    (expected === '<' && firstSym === '≤') ||
    (expected === '>' && firstSym === '≥')

  if (ok) return { ok: true }
  return {
    ok: false,
    expected,
    actual: firstSym,
    reason: `比较大小确定性校验未通过：应填「${expected}」（${aRaw}≈${fmt(a)}，${bRaw}≈${fmt(b)}），但参考答案写「${firstSym}」。疑似答案引擎把大小关系算反，已转人工复核，未写入错误答案。`,
  }
}
