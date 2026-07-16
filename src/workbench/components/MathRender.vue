<template>
  <component :is="tag" :class="className" :style="tagStyle" v-html="renderedHtml"></component>
</template>

<script setup>
import { computed } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const props = defineProps({
  content: {
    type: String,
    default: ''
  },
  className: {
    type: String,
    default: ''
  },
  autoDetect: {
    type: Boolean,
    default: false
  },
  tag: {
    type: String,
    default: 'div'
  }
})

const tagStyle = computed(() => {
  const base = { whiteSpace: 'pre-wrap' }
  if (props.tag === 'span') {
    base.display = 'inline'
    base.lineHeight = 'inherit'
  } else {
    base.lineHeight = '1.8'
  }
  return base
})

/**
 * Clean raw LaTeX string before passing to KaTeX.
 * Converts non-standard Unicode notations into standard LaTeX.
 */
function cleanLatex(latex) {
  if (!latex) return latex

  let s = latex

  // --- 0. Unicode normalization (NFC) to fix OCR garbled encoding ---
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFC')
  }

  // --- 1. Unicode superscripts -> ^N (e.g. x² -> x^2, y³ -> y^3) ---
  const superscriptMap = {
    '\u2070': '^0', '\u00B9': '^1', '\u00B2': '^2', '\u00B3': '^3',
    '\u2074': '^4', '\u2075': '^5', '\u2076': '^6', '\u2077': '^7',
    '\u2078': '^8', '\u2079': '^9',
    '\u207A': '^+', '\u207B': '^-',
  }
  for (const [char, replacement] of Object.entries(superscriptMap)) {
    s = s.split(char).join(replacement)
  }

  // --- 2. Unicode subscripts -> _{N} (e.g. x2 -> x_{2}) ---
  const subscriptMap = {
    '\u2080': '_{0}', '\u2081': '_{1}', '\u2082': '_{2}', '\u2083': '_{3}',
    '\u2084': '_{4}', '\u2085': '_{5}', '\u2086': '_{6}', '\u2087': '_{7}',
    '\u2088': '_{8}', '\u2089': '_{9}',
  }
  for (const [char, replacement] of Object.entries(subscriptMap)) {
    s = s.split(char).join(replacement)
  }

  // --- 3. Common Unicode math operators -> LaTeX commands ---
  const operatorMap = {
    '\u00D7': '\\times ',   // x
    '\u00F7': '\\div ',     // /
    '\u00B1': '\\pm ',      // +-
    '\u2248': '\\approx ',  // ~~
    '\u2260': '\\neq ',     // !=
    '\u2264': '\\le ',      // <=
    '\u2265': '\\ge ',      // >=
    '\u221A': '\\sqrt{}',   // sqrt
    '\u221E': '\\infty ',   // inf
    '\u03B1': '\\alpha ',   // alpha
    '\u03B2': '\\beta ',    // beta
    '\u03C0': '\\pi ',      // pi
  }
  for (const [char, replacement] of Object.entries(operatorMap)) {
    s = s.split(char).join(replacement)
  }

  // --- 4. Inline fractions a/b -> \frac{a}{b} ---
  // Match digit(s)/digit(s) NOT preceded by ^ (already exponent),
  // to avoid breaking existing LaTeX like x^{-1/2}
  s = s.replace(/(?<!\^)(?<!\\)(\d+)\/(\d+)/g, '\\frac{$1}{$2}')

  return s
}

/**
 * Parse text containing inline $...$ and display $$...$$ LaTeX delimiters,
 * cleaning and rendering each math segment with KaTeX.
 * Returns a single HTML string safe for v-html.
 */
function renderToHtml(text) {
  if (!text || typeof text !== 'string') {
    return text || ''
  }

  // Unicode normalization to fix OCR garbled encoding
  if (typeof text.normalize === 'function') {
    text = text.normalize('NFC')
  }

  // autoDetect: 若没有 $ 定界符但包含已知 LaTeX 命令，将全文视为行内数学
  if (props.autoDetect && text.indexOf('$') === -1 && /^\s*\\[a-zA-Z]/.test(text) && /\\[a-zA-Z]{2,}/.test(text)) {
    try {
      return katex.renderToString(cleanLatex(text), { displayMode: false, throwOnError: false })
    } catch (e) {
      // 渲染失败则降级到普通文本处理
    }
  }

  const htmlParts = []
  let remaining = text

  while (remaining.length > 0) {
    // --- $$ ... $$ (display / block math) ---
    const displayMatch = remaining.match(/^\$\$([\s\S]*?)\$\$/)
    if (displayMatch) {
      const rawMath = displayMatch[1].trim()
      if (rawMath) {
        const cleaned = cleanLatex(rawMath)
        try {
          htmlParts.push(katex.renderToString(cleaned, { displayMode: true, throwOnError: false }))
        } catch (e) {
          htmlParts.push(fallbackErrorHtml('$$' + rawMath + '$$'))
        }
      } else {
        htmlParts.push('$$$$')
      }
      remaining = remaining.slice(displayMatch[0].length)
      continue
    }

    // --- $ ... $ (inline math) ---
    const inlineMatch = remaining.match(/^\$([\s\S]*?)\$/)
    if (inlineMatch) {
      const rawMath = inlineMatch[1].trim()
      if (rawMath) {
        const cleaned = cleanLatex(rawMath)
        try {
          htmlParts.push(katex.renderToString(cleaned, { displayMode: false, throwOnError: false }))
        } catch (e) {
          htmlParts.push(fallbackErrorHtml('$' + rawMath + '$'))
        }
      } else {
        htmlParts.push('$$')
      }
      remaining = remaining.slice(inlineMatch[0].length)
      continue
    }

    // --- Plain text (no $ found or text before next $) ---
    const nextDollar = remaining.indexOf('$')
    if (nextDollar === -1) {
      htmlParts.push(escapeHtml(remaining))
      remaining = ''
    } else if (nextDollar > 0) {
      htmlParts.push(escapeHtml(remaining.slice(0, nextDollar)))
      remaining = remaining.slice(nextDollar)
    } else {
      htmlParts.push('$')
      remaining = remaining.slice(1)
    }
  }

  return htmlParts.join('')
}

/**
 * Escape HTML special characters for safe text rendering.
 * Only called on plain text fragments - NEVER on KaTeX output.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Fallback rendering when KaTeX fails.
 */
function fallbackErrorHtml(content) {
  return '<code style="background:#FEE2E2;padding:1px 4px;border-radius:4px;font-size:0.9em;color:#DC2626">'
    + escapeHtml(content)
    + '</code>'
}

const renderedHtml = computed(() => renderToHtml(props.content))
</script>