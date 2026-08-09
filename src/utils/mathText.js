/**
 * 数学文本规范化的共享纯函数。
 * 供 pdfGenerator.js（PDF 渲染，经 auto-render）与 MathRender.vue（界面预览，经 renderToString）
 * 共同使用，保证两条渲染路径输出一致的标准 LaTeX。
 *
 * 规则：
 * - Unicode 上标整体合并：²⁰²¹ → ^{2021}（严禁拆成 ^{2}^{0}^{2}^{1}）
 * - √x、√(x)、√2 1/2、√17(a²+b²) → \sqrt{...}
 * - 斜杠 a/b、3/5 → \frac{a}{b}（禁止裸斜杠）
 * - × ÷ ≥ ≤ ≠ ± → \times \div \ge \le \ne \pm
 * - x² → x^{2}，x^2 → x^{2}，x_1 → x_{1}
 * - renderContent 将数学片段用严格 $...$（行内）/ $$...$$（独立）包裹
 */

const SYMBOL_MAP = {
  '∠': '\\angle ',
  '△': '\\triangle ',
  '°': '^{\\circ}',
  '≈': '\\approx ',
  '∞': '\\infty ',
  'π': '\\pi ',
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'δ': '\\delta ',
  'θ': '\\theta ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'σ': '\\sigma ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊃': '\\supset ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '→': '\\rightarrow ',
  '←': '\\leftarrow ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '×': '\\times ',
  '÷': '\\div ',
  '±': '\\pm ',
  '·': '\\cdot ',
  '≥': '\\ge ',
  '≤': '\\le ',
  '≠': '\\ne ',
}

const SUP_BASE = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-',
}

function preprocessMath(text) {
  let s = String(text || '')

  // 0. 规范化已有 LaTeX 命令
  s = s.replace(/\\left/g, '').replace(/\\right/g, '')
  s = s.replace(/\\(?:dfrac|tfrac|cfrac)/g, '\\frac')
  s = s.replace(/\$\$?/g, '')
  s = s.replace(/\\\(/g, '').replace(/\\\)/g, '')
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}')

  // 0.5 Unicode 上标 → 单个整体指数（²⁰²¹ → ^{2021}，严禁拆成 ^{2}^{0}^{2}^{1}）
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (run) => {
    let inner = ''
    for (const ch of run) inner += SUP_BASE[ch] || ch
    return '^{' + inner + '}'
  })

  // 0.6 填空线：连续下划线 ____ → \underline{\quad}（禁止裸 _，否则 KaTeX 当作下标报错）
  // 单个 _ 保留（可能用于下标，如 x_1；x_1 会在步骤 5 转 x_{1}）
  s = s.replace(/_{2,}/g, '\\underline{\\quad}')

  // 1. √ → \sqrt{...}
  s = convertSqrt(s)

  // 2. 混合数：1 1/3 → 1\frac{1}{3}
  s = s.replace(/(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/g, (m, whole, num, den) =>
    parseInt(num, 10) < parseInt(den, 10) ? `${whole}\\frac{${num}}{${den}}` : m
  )

  // 3. 斜杠除法 a/b → \frac{a}{b}（多轮处理嵌套）
  let prev
  let guard = 0
  do {
    prev = s
    s = s.replace(
      /(\([^()]*\)|\\sqrt\{[^{}]*\}|[a-zA-Z0-9]+(?:\.[0-9]+)?)\s*\/\s*(\([^()]*\)|\\sqrt\{[^{}]*\}|[a-zA-Z0-9]+(?:\.[0-9]+)?)/g,
      '\\frac{$1}{$2}'
    )
    guard++
    if (guard > 20) break
  } while (s !== prev)

  // 4. 清理分数多余括号：\frac{(a)}{(b)} → \frac{a}{b}；(a/b) → a/b
  s = s.replace(/\\frac\{\(([^{}]*)\)\}\{\(([^{}]*)\)\}/g, '\\frac{$1}{$2}')
  s = s.replace(/\(\\frac\{([^{}]*)\}\{([^{}]*)\}\)/g, '\\frac{$1}{$2}')

  // 5. 指数/下标：x^2 → x^{2}
  s = s.replace(/([a-zA-Z0-9])\^([a-zA-Z0-9]+)/g, '$1^{$2}')
  s = s.replace(/([a-zA-Z])_([a-zA-Z0-9]+)/g, '$1_{$2}')

  // 6. Unicode 数学符号 → LaTeX 命令
  for (const [ch, latex] of Object.entries(SYMBOL_MAP)) {
    if (s.includes(ch)) s = s.split(ch).join(latex)
  }

  return s
}

function convertSqrt(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '√') {
      let j = i + 1
      while (j < s.length && (s[j] === ' ' || s[j] === '\u00A0')) j++

      // A. 括号形式：√(...) → \sqrt{...}（平衡括号）
      if (s[j] === '(') {
        let depth = 0
        let k = j
        let inner = ''
        while (k < s.length) {
          const ch = s[k]
          inner += ch
          if (ch === '(') depth++
          else if (ch === ')') {
            depth--
            if (depth === 0) { k++; break }
          }
          k++
        }
        out += '\\sqrt{' + inner + '}'
        i = k
        continue
      }

      // B. 混合数：√2 1/2 → \sqrt{2\frac{1}{2}}
      const mixed = s.slice(j).match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/)
      if (mixed) {
        out += '\\sqrt{' + mixed[1] + '\\frac{' + mixed[2] + '}{' + mixed[3] + '}}'
        i = j + mixed[0].length
        continue
      }

      // C. 数字/负号/小数/字母组合：√30、√-5a、√3.5、√17(a²+b²)、√2x
      const num = s.slice(j).match(/^(-?[0-9]+(?:\.[0-9]+)?[a-zA-Z]*(?:\([^()]*\))?)/)
      if (num && num[1].length > 0) {
        out += '\\sqrt{' + num[1] + '}'
        i = j + num[1].length
        continue
      }

      // D. 字母：√x
      if (/[a-zA-Z]/.test(s[j])) {
        out += '\\sqrt{' + s[j] + '}'
        i = j + 1
        continue
      }

      // E. 无法识别，保留原样
      out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

function splitToSegments(text) {
  const segments = []
  let mathBuffer = ''
  let textBuffer = ''

  function flushMath() {
    if (mathBuffer.trim()) segments.push({ text: mathBuffer.trim(), isMath: true })
    mathBuffer = ''
  }
  function flushText() {
    if (textBuffer) segments.push({ text: textBuffer, isMath: false })
    textBuffer = ''
  }

  let i = 0
  while (i < text.length) {
    const char = text[i]

    // 1. LaTeX 命令: \xxx{...}{...}
    if (char === '\\' && i + 1 < text.length && /[a-zA-Z]/.test(text[i + 1])) {
      flushText()
      let cmd = '\\'
      i++
      while (i < text.length && /[a-zA-Z]/.test(text[i])) {
        cmd += text[i]
        i++
      }
      while (i < text.length && text[i] === '{') {
        let depth = 0
        while (i < text.length) {
          cmd += text[i]
          if (text[i] === '{') depth++
          if (text[i] === '}') {
            depth--
            if (depth === 0) { i++; break }
          }
          i++
        }
      }
      mathBuffer += cmd
      continue
    }

    // 2. ^{...} 或 _{...} 结构
    if ((char === '^' || char === '_') && i + 1 < text.length && text[i + 1] === '{') {
      flushText()
      let expr = char + '{'
      i += 2
      let depth = 1
      while (i < text.length && depth > 0) {
        expr += text[i]
        if (text[i] === '{') depth++
        if (text[i] === '}') depth--
        i++
      }
      mathBuffer += expr
      continue
    }

    // 3. 单个 ^ 或 _（简单上标/下标）
    if ((char === '^' || char === '_') && /[a-zA-Z0-9]/.test(textBuffer.slice(-1))) {
      const lastChar = textBuffer.slice(-1)
      textBuffer = textBuffer.slice(0, -1)
      if (textBuffer) flushText()
      mathBuffer = lastChar + char
      i++
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) {
        mathBuffer += text[i]
        i++
      }
      flushMath()
      continue
    }

    // 4. 普通字符 — 判断是数学还是文本
    if (isMathChar(char)) {
      if (textBuffer) flushText()
      mathBuffer += char
      i++
    } else {
      if (mathBuffer) flushMath()
      textBuffer += char
      i++
    }
  }

  if (mathBuffer.trim()) flushMath()
  if (textBuffer) flushText()

  const merged = []
  for (const seg of segments) {
    if (!seg.text) continue
    if (merged.length > 0 && merged[merged.length - 1].isMath === seg.isMath) {
      merged[merged.length - 1].text += seg.text
    } else {
      merged.push({ ...seg })
    }
  }
  return merged.length > 0 ? merged : [{ text, isMath: false }]
}

function isMathChar(char) {
  if (/[a-zA-Z0-9.]/.test(char)) return true
  if ('+-*/=^_(){}[]<>|'.includes(char)) return true
  if ('αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'.includes(char)) return true
  if ('≥≤≈∞π∥⊥'.includes(char)) return true
  return false
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 渲染内容：中文保持纯文本，数学片段用严格 $...$（行内）/ $$...$$（独立）定界符包裹。
 * 返回可安全注入 DOM 的 HTML 字符串。
 */
function renderContent(text) {
  if (!text) return ''
  const processed = preprocessMath(String(text))
  const segments = splitToSegments(processed)
  const mathSegs = segments.filter(s => s.isMath && s.text)
  const hasRealText = segments.some(s => !s.isMath && s.text.trim().length > 0)
  const standalone = mathSegs.length === 1 && !hasRealText
  let html = ''
  for (const seg of segments) {
    if (seg.isMath && seg.text) {
      const dl = standalone ? '$$' : '$'
      html += dl + escapeHtml(seg.text) + dl
    } else {
      html += escapeHtml(seg.text)
    }
  }
  return html
}

export {
  preprocessMath,
  convertSqrt,
  splitToSegments,
  isMathChar,
  renderContent,
}
