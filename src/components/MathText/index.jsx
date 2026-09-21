/**
 * MathText — renders text with embedded LaTeX math.
 *
 * Smart plain-text conversion (auto, default enabled):
 *   -4/m          →  \frac{-4}{m}
 *   (x+y)/(a-b)   →  \frac{x+y}{a-b}
 *   x^2           →  x^{2}
 *   x_1           →  x_{1}
 *   × ÷ ≥ ≤ ≠ ∠ ° →  KaTeX 命令
 *
 * Delimiter support (when plainText=false):
 *   $$...$$   display math (block, centered)
 *   \(...\)   inline math
 *   $...$     inline math (single dollar)
 *
 * Usage:
 *   <MathText content="已知 AB // CD，∠C=90°，x^2 + y/2 = 0" />
 *
 * 核心策略：将中文文本和 LaTeX 数学公式拆分为独立片段，
 *          中文交给 React 直接渲染，数学交给 KaTeX 渲染。
 */

import { useMemo } from 'react'
import katex from 'katex'

// ── 智能 plain-text → LaTeX 转换器 ──

/**
 * 将普通数学文本拆分为 [纯文本, 纯LaTeX] 片段数组
 * 每个片段: { text: string, isMath: boolean }
 *
 * 转换规则:
 *   a/b         →  \frac{a}{b}
 *   x^2         →  x^{2}
 *   x_1         →  x_{1}
 *   特殊符号     →  对应 KaTeX 命令
 *
 * 关键: 中文和标点保留在 isMath:false 片段中
 *       KaTeX 片段只包含纯数学 LaTeX 命令
 */
function convertPlainTextToSegments(text) {
  if (!text || typeof text !== 'string') return [{ text: text || '', isMath: false }]

  // Step 1: 预处理 — 将纯文本数学表达式转为 LaTeX
  let processed = preprocessMath(text)

  // Step 2: 将处理后的字符串拆分为 [纯文本, 纯LaTeX] 片段
  return splitToSegments(processed)
}

/**
 * 预处理: 将纯文本数学表达式转为 LaTeX 格式
 */
function preprocessMath(text) {
  const latexSymbols = {
    '∠': '\\angle ',
    '△': '\\triangle ',
    '°': '^{\\circ}',
    '≈': '\\approx',
    '∞': '\\infty',
    'π': '\\pi',
    'α': '\\alpha',
    'β': '\\beta',
    'γ': '\\gamma',
    'δ': '\\delta',
    'θ': '\\theta',
    'λ': '\\lambda',
    'μ': '\\mu',
    'σ': '\\sigma',
    '∈': '\\in',
    '∉': '\\notin',
    '⊂': '\\subset',
    '⊃': '\\supset',
    '∪': '\\cup',
    '∩': '\\cap',
    '→': '\\rightarrow',
    '←': '\\leftarrow',
    '⇒': '\\Rightarrow',
    '⇔': '\\Leftrightarrow',
  }

  let result = text

  // === 0. 循环小数标记：组合上点 U+0307 / 组合上划线 U+0305 → \dot{} / \bar{} ===
  // 与 src/utils/mathText.js 步骤 0.7 同源同码（两份渲染实现必须同步，见
  // test/mathTextRender.test.mjs 的「两份渲染实现同构」用例）。
  // 组合字符若留在文本段，KaTeX 独占排版的数学段里它附着不到前一个字形上 ——
  // 预览/打印就会把「2.6̇」显示成「2.6」，题目从无限循环小数变成有限小数，
  // 学生照着印出来的题作答必然被判错（2026-09-14 错题再测-0911 事故：5 个学生答 18）。
  // 保真转换、不推断循环节范围（OCR 有点在首尾、有点在每个数字上，猜错就把 318 循环排成 38 循环）。
  result = result.replace(/([0-9A-Za-z])([\u0305\u0307])/g, (_m, base, mark) =>
    mark === '\u0307' ? `\\dot{${base}}` : `\\bar{${base}}`
  )

  // === 0. 核心修复: 将不规范的 LaTeX 命令直接替换为 Unicode 符号 ===
  // 数据库中存储的题干包含 \leq 等命令但没有 $ 包裹，
  // KaTeX 无法正确解析 \leq2 这种连写形式。
  // 直接替换为 Unicode 符号，前端当作普通数学字符渲染。
  result = result.replace(/\\leq/g, '≤')
  result = result.replace(/\\geq/g, '≥')
  result = result.replace(/\\neq/g, '≠')
  result = result.replace(/\\times/g, '×')
  result = result.replace(/\\div/g, '÷')
  result = result.replace(/\\pm/g, '±')
  result = result.replace(/\\perp/g, '\u22A5')
  result = result.replace(/\\parallel/g, '\u2225')

  // === 1. 除法表达式: a/b → \frac{a}{b} ===
  result = result.replace(/(\([^)]+\))\s*\/\s*(\([^)]+\))/g, '\\frac{$1}{$2}')
  result = result.replace(/(\([^)]+\))\s*\/\s*([a-zA-Z0-9]+)/g, '\\frac{$1}{$2}')
  result = result.replace(/([a-zA-Z0-9]+)\s*\/\s*(\([^)]+\))/g, '\\frac{$1}{$2}')
  result = result.replace(/([a-zA-Z0-9°]+)\s*\/\s*([a-zA-Z0-9]+)/g, '\\frac{$1}{$2}')
  result = result.replace(/(-[0-9]+)\s*\/\s*([a-zA-Z0-9]+)/g, '\\frac{$1}{$2}')

  // === 1.5 混合数: 数字 空格 分数 → 数字\frac{分子}{分母} (e.g., 1 1/6 → 1\frac{1}{6}) ===
  result = result.replace(/(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/g, (match, whole, num, den) => {
    if (parseInt(num, 10) < parseInt(den, 10)) {
      return `${whole}\\frac{${num}}{${den}}`
    }
    return match
  })

  // === 2. 指数: x^2 → x^{2} ===
  result = result.replace(/([a-zA-Z0-9])\^([a-zA-Z0-9]+)/g, '$1^{$2}')
  result = result.replace(/([a-zA-Z0-9])\^([0-9])/g, '$1^{$2}')

  // === 3. 下标: x_1 → x_{1} ===
  result = result.replace(/([a-zA-Z])_([a-zA-Z0-9]+)/g, '$1_{$2}')
  result = result.replace(/([a-zA-Z])_([0-9])/g, '$1_{$2}')

  // === 4. Unicode特殊符号替换 (将 Unicode 转为 LaTeX 命令) ===
  for (const [ch, latex] of Object.entries(latexSymbols)) {
    if (result.includes(ch)) {
      const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(escaped, 'g'), latex)
    }
  }

  return result
}

/**
 * 将处理后的字符串拆分为 [纯文本, 纯LaTeX] 片段
 *
 * 字符分类:
 *   - 数学字符: 拉丁字母、数字、运算符、括号等
 *   - 文本字符: 中文、中文标点、全角标点、空格
 *   - LaTeX命令: 以反斜杠开头的命令
 */
function splitToSegments(text, opts = {}) {
  // glueInnerSpaces=true 用于渲染分段（公式内部空格不切断，保证 \sqrt{a} + \sqrt{b} 整体交给 KaTeX）；
  // 设为 false 用于"独立公式判定"的保守口径（详见 src/utils/mathText.js renderContent 注释）。
  const glueInnerSpaces = opts.glueInnerSpaces !== false
  const segments = []
  let mathBuffer = ''
  let textBuffer = ''

  function flushMath() {
    if (!mathBuffer.trim()) {
      mathBuffer = ''
      return
    }
    // 数学段末尾的句读标点必须留在文本段（与 src/utils/mathText.js 同步：
    // 2026-09-21 白板第2题，`(2) $\sqrt{...}$.` 的句点因 `.`∈isMathChar 被吸进数学段，
    // 既在 KaTeX 数学模式里排出"悬空的点"，又把"公式+句号"算成纯数学 ⇒ 居中独立公式）。
    // 句读是句子层标点，应由正文字体排。
    let math = mathBuffer
    let tail = ''
    const punct = math.match(TRAILING_SENTENCE_PUNCT)
    if (punct) {
      tail = punct[0]
      math = math.slice(0, -punct[0].length)
    }
    if (math.trim()) segments.push({ text: math.trim(), isMath: true })
    if (tail) textBuffer += tail
    mathBuffer = ''
  }

  function flushText() {
    if (textBuffer) {
      segments.push({ text: textBuffer, isMath: false })
    }
    textBuffer = ''
  }

  let i = 0
  while (i < text.length) {
    const char = text[i]

    // 1. 检测 LaTeX 命令: \xxx{...}{...}
    if (char === '\\' && i + 1 < text.length && /[a-zA-Z]/.test(text[i + 1])) {
      flushText()
      let cmd = '\\'
      i++
      // 收集命令名
      while (i < text.length && /[a-zA-Z]/.test(text[i])) {
        cmd += text[i]
        i++
      }
      // 收集大括号参数
      while (i < text.length && text[i] === '{') {
        let depth = 0
        while (i < text.length) {
          cmd += text[i]
          if (text[i] === '{') depth++
          if (text[i] === '}') {
            depth--
            if (depth === 0) {
              i++
              break
            }
          }
          i++
        }
      }
      mathBuffer += cmd
      continue
    }

    // 2. 检测 ^{...} 或 _{...} 结构
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

    // 3. 检测单个 ^ 或 _ (简单上标/下标)
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

    // 4. 公式内部空格：两侧都是数学记号、且至少一侧是运算符/结构符 ⇒ 属于同一公式，不切断
    //    （`\sqrt{3-x} + \sqrt{x-3}` 必须整体交给 KaTeX，否则被切成三段各排各的、二元运算符间距丢失）
    if (glueInnerSpaces && isMathInnerSpace(text, i, mathBuffer)) {
      mathBuffer += char
      i++
      continue
    }

    // 5. 普通字符 — 判断是数学还是文本
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

  // 合并相邻同类型片段
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

/**
 * 判断单个字符是否为数学字符
 */
function isMathChar(char) {
  // 拉丁字母、数字
  if (/[a-zA-Z0-9]/.test(char)) return true
  // 运算符和结构符
  if ('+-*/=^_(){}[]<>|'.includes(char)) return true
  // 希腊字母和其他数学符号
  if ('αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'.includes(char)) return true
  // 数学关系符
  if ('≥≤≈∞π∥⊥'.includes(char)) return true
  return false
}

/**
 * 句子级句读：这些字符跟在数学段末尾时属于「句子标点」，不是公式的一部分。
 * 与 src/utils/mathText.js 同源（两份渲染实现必须同步，见 test/mathTextRender.test.mjs）。
 */
const TRAILING_SENTENCE_PUNCT = /[.,;:!?。，、；：！？．…]+$/

/** 运算符/结构符：出现它说明这一侧是"公式内部"，而不是并列的独立符号 */
const MATH_STRUCT_CHAR = /[+\-*/=<>^_{}()\[\]|]/

/** 该位置是不是一个数学记号（\cmd 也算，因为 \ 不在 isMathChar 里） */
function isMathTokenAt(text, index) {
  if (index < 0 || index >= text.length) return false
  const c = text[index]
  if (isMathChar(c)) return true
  return c === '\\' && /[a-zA-Z]/.test(text[index + 1] || '')
}

/**
 * 空格是否处在公式内部（应当并入数学段，不切断）。保守边界：
 * 必须 ① 当前已在数学段内；② 空格两侧都是数学记号；
 * ③ 至少一侧是运算符/结构符。反例 `a 1` 不并（那种空格是排版间隔）。
 */
function isMathInnerSpace(text, index, mathBuffer) {
  const c = text[index]
  if (c !== ' ' && c !== '\u00A0') return false
  if (!mathBuffer) return false
  const prev = text[index - 1] || ''
  const next = text[index + 1] || ''
  if (!isMathTokenAt(text, index - 1) || !isMathTokenAt(text, index + 1)) return false
  return MATH_STRUCT_CHAR.test(prev) || MATH_STRUCT_CHAR.test(next)
}

// ── MathText 组件 ─

const MathText = ({ content, className = '', plainText = true }) => {
  const segments = useMemo(() => {
    if (!content) return null
    const text = String(content)
    if (text.length === 0) return null

    // plainText 模式: 智能转换普通数学文本
    if (plainText) {
      const converted = convertPlainTextToSegments(text)
      // 如果转换后没有产生任何数学片段，直接返回纯文本
      if (!converted.some(s => s.isMath)) {
        return null
      }
      return converted
    }

    // 非 plainText 模式: 按 $$...$$ 和 \(...\) 分割
    const parts = []
    let remaining = text
    let hasMath = false

    while (remaining.length > 0) {
      const displayMatch = remaining.match(/^\$\$([\s\S]*?)\$\$/)
      if (displayMatch) {
        parts.push({ type: 'display', content: displayMatch[1].trim() })
        remaining = remaining.slice(displayMatch[0].length)
        hasMath = true
        continue
      }

      const inlineMatch = remaining.match(/^\\\(([\s\S]*?)\\\)/)
      if (inlineMatch) {
        parts.push({ type: 'inline', content: inlineMatch[1].trim() })
        remaining = remaining.slice(inlineMatch[0].length)
        hasMath = true
        continue
      }

      if (remaining.startsWith('$') && !remaining.startsWith('$$')) {
        const singleMatch = remaining.match(/^\$([\s\S]*?)\$/)
        if (singleMatch && singleMatch[1].length > 0) {
          parts.push({ type: 'inline', content: singleMatch[1].trim() })
          remaining = remaining.slice(singleMatch[0].length)
          hasMath = true
          continue
        }
      }

      const nextDisplay = remaining.indexOf('$$')
      const nextInline = remaining.indexOf('\\(')
      const nextSingleDollar = remaining.indexOf('$')

      const candidates = []
      if (nextDisplay !== -1) candidates.push(nextDisplay)
      if (nextInline !== -1) candidates.push(nextInline)
      if (nextSingleDollar !== -1) candidates.push(nextSingleDollar)

      if (candidates.length === 0) {
        parts.push({ type: 'text', content: remaining })
        remaining = ''
      } else {
        const boundary = Math.min(...candidates)
        if (boundary > 0) {
          parts.push({ type: 'text', content: remaining.slice(0, boundary) })
          remaining = remaining.slice(boundary)
        } else {
          parts.push({ type: 'text', content: remaining[0] })
          remaining = remaining.slice(1)
        }
      }
    }

    return hasMath ? parts : null
  }, [content, plainText])

  // 没有数学内容，直接返回纯文本
  if (!segments) {
    return (
      <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {content}
      </span>
    )
  }

  return (
    <span className={className} style={{ whiteSpace: 'pre-wrap' }}>
      {segments.map((seg, i) => {
        // plainText 模式: segments 是 { text, isMath }
        if (plainText && 'isMath' in seg) {
          if (seg.isMath) {
            try {
              const html = katex.renderToString(seg.text, {
                throwOnError: false,
                displayMode: false,
                maxSize: 10,
                maxExpand: 20,
                strict: false
              })
              return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
            } catch (e) {
              return <span key={i}>{seg.text}</span>
            }
          }
          return <span key={i}>{seg.text}</span>
        }

        // 非 plainText 模式: segments 是 { type, content }
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>
        }

        try {
          const html = katex.renderToString(seg.content, {
            throwOnError: false,
            displayMode: seg.type === 'display',
            maxSize: 10,
            maxExpand: 20,
            strict: false
          })
          if (seg.type === 'display') {
            return (
              <span
                key={i}
                dangerouslySetInnerHTML={{ __html: html }}
                style={{ display: 'block', textAlign: 'center', margin: '4px 0' }}
              />
            )
          }
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
        } catch (e) {
          return (
            <code
              key={i}
              style={{
                background: 'var(--danger-soft)',
                padding: '1px 4px',
                borderRadius: 'var(--radius-4)',
                fontSize: '0.9em',
                color: 'var(--danger)'
              }}
            >
              {seg.type === 'display' ? `$$${seg.content}$$` : `\\(${seg.content}\\)`}
            </code>
          )
        }
      })}
    </span>
  )
}

export default MathText
