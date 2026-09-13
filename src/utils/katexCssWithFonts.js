/**
 * katexCssWithFonts.js — 把 KaTeX CSS 的 20 个 woff2 字体内联成 base64 data-URL
 *
 * 【为什么必须内联】
 * katex.min.css 里字体是相对路径 url(fonts/KaTeX_*.woff2)。以下渲染上下文都解析不到这个相对路径，
 * 字体必然加载失败，KaTeX 回退到系统字体 → 数学符号渲染成方块（如 \neq 的斜线覆盖层字形）、
 * 字母变成系统斜体（与教材标准数学字体完全不同）：
 *   - serverPdfExporter 序列化 HTML 后 POST 给后端 Chromium（base = about:blank）
 *   - browserPrint / 浏览器打印的隐藏 iframe（src = about:blank）
 *   - PrintPreview 的 shadow DOM（?inline CSS 里的相对路径对站点根 404）
 *   - 生产环境此前用 fetch('/node_modules/katex/dist/fonts/...') 内联，线上根本没这个路径 → 404
 *
 * 【实现】
 *   - CSS 用 ?raw 导入：拿到 katex.min.css 原文，url(fonts/...) 形态在 dev/build 完全一致，
 *     可被下方正则稳定替换。（不用 ?inline —— Vite 5 会把 url() 重写成 /assets/ 哈希路径，
 *     在 about:blank 上下文同样解析不到。）
 *   - 字体 data-URL 由 vite.config.js 的 katexFontInlinePlugin 虚拟模块生成（dev/build 一致）。
 */

import katexCssRaw from 'katex/dist/katex.min.css?raw'
import { KATEX_FONTS_DATA } from 'virtual:katex-fonts-data'

function inlineFonts(css) {
  return css.replace(/url\(fonts\/(KaTeX_[A-Za-z0-9_-]+\.woff2)\)/g, (matched, name) => {
    const dataUrl = KATEX_FONTS_DATA[name]
    if (!dataUrl) {
      console.warn(`[katexCssWithFonts] 未找到字体映射: ${name}，保留原样`)
      return matched
    }
    return `url(${dataUrl})`
  })
}

/** 字体已内联的 KaTeX CSS，可直接用于 iframe / 序列化 HTML / shadow DOM */
export const KATEX_CSS_WITH_FONTS = inlineFonts(katexCssRaw)
