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
  '−': '-',      // U+2212 数学减号（OCR 高频）：不映射会落在文本段，用正文字体渲染、与相邻数学体割裂
  '⊥': '\\bot ',  // 垂直符号：KaTeX 对裸 Unicode 报 unknownSymbol，字形依赖兜底字体（乱码隐患）
  '∥': '\\parallel ', // 平行符号：同上
}

const SUP_BASE = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-',
  'ᵐ': 'm', 'ⁿ': 'n',
  '⁽': '(', '⁾': ')',
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
  //     含上标字母 ᵐⁿ 与上标括号 ⁽⁾（如 aᵐ⁽ⁿ⁾ → a^{m(n)}）
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ᵐⁿ⁽⁾]+/g, (run) => {
    let inner = ''
    for (const ch of run) inner += SUP_BASE[ch] || ch
    return '^{' + inner + '}'
  })

  // 0.6 填空线：连续下划线 ____ → \underline{\quad}（禁止裸 _，否则 KaTeX 当作下标报错）
  // 单个 _ 保留（可能用于下标，如 x_1；x_1 会在步骤 5 转 x_{1}）
  s = s.replace(/_{2,}/g, '\\underline{\\quad}')

  // 0.7 循环小数标记：组合上点 U+0307 / 组合上划线 U+0305 → \dot{} / \bar{}
  //
  // 为什么必须在这里转（2026-09-14 错题再测-0911 事故）：
  //   这两个是**组合附加符号**，语义上"贴在前一个数字上"。而数学段在两条渲染路径
  //   （pdfGenerator 的 auto-render、MathRender 的 renderToString）里都交给 KaTeX
  //   独占排版，KaTeX 的字形有自己的盒模型/定位 —— 落在文本段的孤立组合字符
  //   附着不到前一个字形上，于是打印出来「2.6̇」变成「2.6」，题目从无限循环小数
  //   变成有限小数，学生照着印出来的题作答必然被判定为错（事故里 5 个学生答 18、
  //   3 个学生按 3.12 作答，都是这个成因；全库 37 道题的题干含 72 个点）。
  //   转成 \dot{6} 后由 KaTeX 自己排版，预览与 PDF 都不会再丢。
  //
  // 保真转换、**不推断循环节范围**：OCR 有时只在循环节首尾加点（0.5̇03̇ = 503 循环），
  // 有时每个数字都带点（0.5̇0̇3̇）—— 两种是同一记法的不同来源。猜循环节会把
  // 0.3̇1̇8̇ 错排成 0.3̇8̇（318 循环 → 38 循环），语义就错了。
  s = s.replace(/([0-9A-Za-z])([\u0305\u0307])/g, (_m, base, mark) =>
    mark === '\u0307' ? `\\dot{${base}}` : `\\bar{${base}}`
  )

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
        // 递归处理 inner 里可能嵌套的 √：避免 √(2-√3) → \sqrt{(2-√3)}
        // 这种 inner 还含 Unicode 根号的半成品送进 KaTeX 后部分渲染失败，
        // 表现为"已知a=√√ ... 求b的值"这种散架（错题本 PDF 错乱根因之一）
        out += '\\sqrt{' + convertSqrt(inner) + '}'
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
        // 递归：num 内部可能含 √(...) 嵌套（如 √17(a²+b²) 的 num="17" 不嵌套，
        // 但 √(x²+1) 等含括号变体经 convertSqrt 走 A 路径之后内部不会再剩 √）
        out += '\\sqrt{' + convertSqrt(num[1]) + '}'
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

/**
 * 印刷/预览自检：循环小数标记有没有活着走到渲染产物里。
 *
 * 背景（2026-09-14 错题再测-0911 事故）：组合点丢过一次，而且**丢得悄无声息** ——
 * 页面上「2.6̇」变成「2.6」，题目从无限循环小数变成有限小数，没有任何报错，
 * 直到学生按印出来的题作答被判错才被发现。
 * 所以渲染前规范化之外，还要有一道"渲染后点数对得上"的自检：原文有几个点，
 * 产物里就该有几个 \dot/\bar，且**不允许有裸组合字符**残留在 KaTeX 之外。
 *
 * @param {string} text 题目原文（题干/选项/答案均可）
 * @param {string} [label] 定位用标签，如 `第3题题干`
 * @returns {null | {label:string, dots:number, bare:number, accents:number, text:string}}
 *          返回 null 表示无循环点或渲染完好；返回对象即为"丢点"证据
 */
function auditLoopDotRendering(text, label = '') {
  const src = String(text || '')
  const dots = (src.match(/[\u0305\u0307]/g) || []).length
  if (!dots) return null
  const rendered = renderContent(src)
  const bare = (rendered.match(/[\u0305\u0307]/g) || []).length
  const accents = (rendered.match(/\\dot\{|\\bar\{/g) || []).length
  if (bare === 0 && accents >= dots) return null
  return { label, dots, bare, accents, text: src.slice(0, 60) }
}

export {
  preprocessMath,
  convertSqrt,
  splitToSegments,
  isMathChar,
  renderContent,
  auditLoopDotRendering,
}
