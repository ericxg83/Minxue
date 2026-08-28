<template>
  <component :is="tag" :class="className" :style="tagStyle" v-html="renderedHtml"></component>
</template>

<script setup>
import { computed } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { renderContent } from '../../utils/mathText'

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
 * Parse text containing inline $...$ and display $$...$$ LaTeX delimiters,
 * rendering each math segment with KaTeX.
 * The raw content is first normalized via renderContent (shared with PDF path),
 * which converts Unicode √/²⁰²¹/a/b etc. into strict standard LaTeX and wraps
 * each math segment in $...$ / $$...$$ delimiters.
 * Returns a single HTML string safe for v-html.
 */
function renderToHtml(text) {
  if (!text || typeof text !== 'string') {
    return text || ''
  }

  // 统一规范化：Unicode 上标整体合并、√→\sqrt、a/b→\frac、$...$ 包裹
  const normalized = renderContent(text)
  const htmlParts = []
  let remaining = normalized

  while (remaining.length > 0) {
    // --- $$ ... $$ (display / block math) ---
    const displayMatch = remaining.match(/^\$\$([\s\S]*?)\$\$/)
    if (displayMatch) {
      const rawMath = displayMatch[1].trim()
      if (rawMath) {
        try {
          htmlParts.push(katex.renderToString(decodeHtml(rawMath), { displayMode: true, throwOnError: false }))
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
        try {
          htmlParts.push(katex.renderToString(decodeHtml(rawMath), { displayMode: false, throwOnError: false }))
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
    // renderContent 已对文本段做过 HTML 转义，这里必须原样输出。
    // 再转一次会把 &quot; 变成 &amp;quot;，页面上就出现 `{&quot;x₁ = a + 1&quot;}` 这种字面实体。
    const nextDollar = remaining.indexOf('$')
    if (nextDollar === -1) {
      htmlParts.push(remaining)
      remaining = ''
    } else if (nextDollar > 0) {
      htmlParts.push(remaining.slice(0, nextDollar))
      remaining = remaining.slice(nextDollar)
    } else {
      htmlParts.push('$')
      remaining = remaining.slice(1)
    }
  }

  return htmlParts.join('')
}

/**
 * 还原 HTML 实体（仅用于从数学片段中取回原始 LaTeX 字符，如 &gt; → >）。
 * 数学段在 renderContent 里被 escapeHtml 转义，KaTeX 需要原始字符。
 */
function decodeHtml(str) {
  if (!str) return str
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

/**
 * Fallback rendering when KaTeX fails. content 来自已转义的 normalized 串，直接内联。
 */
function fallbackErrorHtml(content) {
  return '<code style="background:#FEE2E2;padding:1px 4px;border-radius: var(--wb-radius-xs);font-size:0.9em;color:#DC2626">'
    + content
    + '</code>'
}

const renderedHtml = computed(() => renderToHtml(props.content))
</script>