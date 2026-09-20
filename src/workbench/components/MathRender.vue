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
  /**
   * 强制行内排版。
   *
   * renderContent 把「整段只有数学、没有中文」的内容标成 $$...$$（独立公式），
   * 这对 PDF 里独占一行的推导式是对的；但答案卡这类场景里，一个纯字母答案
   * （选择题答案 "A"、数值 "1/2"）会被渲染成居中放大的独立公式，
   * 既不像卷面也不好看。答案层传 forceInline 即可保持行内。
   */
  forceInline: {
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
function renderToHtml(text, forceInline = false) {
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
          htmlParts.push(katex.renderToString(decodeHtml(rawMath), { displayMode: !forceInline, throwOnError: false }))
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
 * Fallback rendering when KaTeX fails.
 *
 * 2026-09-18 白板第27题事故：`{\sqrt{y}₀}` 这种「半个花括号 + 半截命令」的片段送进
 * KaTeX 后报错，这里把源码以**红色 code 块**亮出来 —— 老师看到的就是满屏乱码。
 * OCR/打磨阶段产出的 LaTeX 不可能 100% 合法，兜底的目标是把数学当「文本」继续看，
 * 而不是把半成品 LaTeX 亮给人看。所以：
 *   - 剥掉残缺的定界符/开括号（扔掉必然报错的尾部开括号），保留可读的部分；
 *   - 不能确定成完整公式时，用普通文本呈现，不再染红。
 */
function fallbackErrorHtml(content) {
  let s = String(content || '')
    // 剥掉可能误入的 $ 定界符（rawMath 里本不该有，兜底防御）
    .replace(/\$/g, '')
    // KaTeX 报错几乎都来自「半截命令 + 未闭合花括号」，剥掉尾部孤立残留，
    // 保留可读的部分以文本呈现，不再染红（见函数头注释）
    .replace(/[{,]\s*$/g, '')
  return s.replace(/ /g, '\u00A0')
}

const renderedHtml = computed(() => renderToHtml(props.content, props.forceInline))
</script>