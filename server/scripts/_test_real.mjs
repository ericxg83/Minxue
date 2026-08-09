// 用真实错题数据测试 KaTeX 渲染：严格 $...$ / $$...$$ 定界符包裹，逐个解析验证
import katex from 'katex'

const SYMBOL_MAP = {
  '∠': '\\angle ', '△': '\\triangle ', '°': '^{\\circ}', '≈': '\\approx ',
  '∞': '\\infty ', 'π': '\\pi ', 'α': '\\alpha ', 'β': '\\beta ',
  'γ': '\\gamma ', 'δ': '\\delta ', 'θ': '\\theta ', 'λ': '\\lambda ',
  'μ': '\\mu ', 'σ': '\\sigma ', '∈': '\\in ', '∉': '\\notin ',
  '⊂': '\\subset ', '⊃': '\\supset ', '∪': '\\cup ', '∩': '\\cap ',
  '→': '\\rightarrow ', '←': '\\leftarrow ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ',
  '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '·': '\\cdot ',
  '≥': '\\ge ', '≤': '\\le ', '≠': '\\ne ',
}

const SUP_MAP = {
  '⁰': '^{0}', '¹': '^{1}', '²': '^{2}', '³': '^{3}', '⁴': '^{4}',
  '⁵': '^{5}', '⁶': '^{6}', '⁷': '^{7}', '⁸': '^{8}', '⁹': '^{9}',
  '⁺': '^{+}', '⁻': '^{-}',
}

function convertSqrt(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '√') {
      let j = i + 1
      while (j < s.length && (s[j] === ' ' || s[j] === '\u00A0')) j++
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
      const mixed = s.slice(j).match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/)
      if (mixed) {
        out += '\\sqrt{' + mixed[1] + '\\frac{' + mixed[2] + '}{' + mixed[3] + '}}'
        i = j + mixed[0].length
        continue
      }
      const num = s.slice(j).match(/^(-?[0-9]+(?:\.[0-9]+)?[a-zA-Z]*(?:\([^()]*\))?)/)
      if (num && num[1].length > 0) {
        out += '\\sqrt{' + num[1] + '}'
        i = j + num[1].length
        continue
      }
      if (/[a-zA-Z]/.test(s[j])) {
        out += '\\sqrt{' + s[j] + '}'
        i = j + 1
        continue
      }
      out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

function preprocessMath(text) {
  let s = String(text || '')
  s = s.replace(/\\left/g, '').replace(/\\right/g, '')
  s = s.replace(/\\(?:dfrac|tfrac|cfrac)/g, '\\frac')
  s = s.replace(/\$\$?/g, '')
  s = s.replace(/\\\(/g, '').replace(/\\\)/g, '')
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}')
  for (const [ch, rep] of Object.entries(SUP_MAP)) {
    if (s.includes(ch)) s = s.split(ch).join(rep)
  }
  s = convertSqrt(s)
  s = s.replace(/(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/g, (m, whole, num, den) =>
    parseInt(num, 10) < parseInt(den, 10) ? `${whole}\\frac{${num}}{${den}}` : m
  )
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
  s = s.replace(/\\frac\{\(([^{}]*)\)\}\{\(([^{}]*)\)\}/g, '\\frac{$1}{$2}')
  s = s.replace(/\(\\frac\{([^{}]*)\}\{([^{}]*)\}\)/g, '\\frac{$1}{$2}')
  s = s.replace(/([a-zA-Z0-9])\^([a-zA-Z0-9]+)/g, '$1^{$2}')
  s = s.replace(/([a-zA-Z])_([a-zA-Z0-9]+)/g, '$1_{$2}')
  for (const [ch, latex] of Object.entries(SYMBOL_MAP)) {
    if (s.includes(ch)) s = s.split(ch).join(latex)
  }
  return s
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
    if (char === '\\' && i + 1 < text.length && /[a-zA-Z]/.test(text[i + 1])) {
      flushText()
      let cmd = '\\'
      i++
      while (i < text.length && /[a-zA-Z]/.test(text[i])) { cmd += text[i]; i++ }
      while (i < text.length && text[i] === '{') {
        let depth = 0
        while (i < text.length) {
          cmd += text[i]
          if (text[i] === '{') depth++
          if (text[i] === '}') { depth--; if (depth === 0) { i++; break } }
          i++
        }
      }
      mathBuffer += cmd
      continue
    }
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
    if ((char === '^' || char === '_') && /[a-zA-Z0-9]/.test(textBuffer.slice(-1))) {
      const lastChar = textBuffer.slice(-1)
      textBuffer = textBuffer.slice(0, -1)
      if (textBuffer) flushText()
      mathBuffer = lastChar + char
      i++
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) { mathBuffer += text[i]; i++ }
      flushMath()
      continue
    }
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

// 从渲染后的 HTML 中取出所有 $...$ / $$...$$ 包裹的数学片段，逐个用 KaTeX 验证可解析
function extractMathSegments(html) {
  const segs = []
  const regex = /(\$\$[^$]+\$\$|\$[^$]+\$)/g
  let m
  while ((m = regex.exec(html))) {
    const raw = m[1]
    const display = raw.startsWith('$$')
    const inner = raw.replace(/^\$\$?/, '').replace(/\$\$?$/, '')
    segs.push({ inner, display })
  }
  return segs
}

const tests = [
  '使(3-x)⁰+1/√x-1有意义的x的取值范围是 .',
  '计算：√(3x²+6x+3) ÷ √((5(x+1)²)/2)',
  '(2) √(9a/16b) (b>0);',
  '√(12/(5x²y³)) (x>0,y>0);',
  '如果 a=1/(2√2+3), b=1/(2√2-3), 那么 a+b= ; ab=',
  '二次根式√-5a、√30、√2 1/2、√17(a²+b²)中,最简二次根式有 .',
  '3. 5\\div\\frac{2}{3}= \\times\\frac{14}{21}, 5\\times\\frac{2}{3}= \\div\\frac{14}{21}.',
  '用递等式计算.(2)16/3÷4/5-1/3×3/5.',
  '用递等式计算.(1)2.5×(2/5-1/3)+2;',
  '小明在做分数计算题时，把一个数“÷3/4”错看成“-3/4”，得到的计算结果为2 5/8，这道题的正确答案应该是多少？',
]

let failTotal = 0
for (const t of tests) {
  console.log('INPUT: ', t)
  const html = renderContent(t)
  const segs = extractMathSegments(html)
  const fails = []
  for (const { inner, display } of segs) {
    try {
      katex.renderToString(inner, { throwOnError: false, displayMode: display, maxSize: 10, maxExpand: 20, strict: false })
    } catch (e) {
      fails.push(inner)
    }
  }
  console.log('FAILS:', fails.length ? JSON.stringify(fails) : '无')
  if (fails.length) failTotal++
  console.log('OUTPUT:', html.slice(0, 300))
  console.log('---')
}
console.log(failTotal === 0 ? '全部成功' : `${failTotal} 题存在 KaTeX 解析失败`)
