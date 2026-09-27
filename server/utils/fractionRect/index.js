/**
 * 分数乘法面积模型确定性构造（2026-09-27）。
 *
 * 题型：「如图，如果长方形代表整体1，试利用这个长方形表示 (2/3)×(1/2) 的意义。」
 * 教材标准画法：长方形先按第一个分数**竖直分列**（a/b → b 列，浅灰涂 a 列），
 * 再按第二个分数**水平分行**（c/d → d 行），浅灰列与涂色行的交集（乘积区域）深灰。
 * 交集面积 = (a/b)×(c/d)，这就是乘法意义的图示。
 *
 * 为什么直接产 SVG 而不走 renderGeometrySvg：需要两级灰度（浅=第一个分数、
 * 深=乘积），结构版 polygons 只有单一 #d9d9d9；且本图形没有点/线段语义，
 * 走几何结构反而要造一堆 _ 辅助点。
 *
 * 安全原则：题干没有「长方形 + 整体1」、或两个分数解析不出 → null（回退裁片）。
 * 图上**零文字标注**——含义由涂色层次表达，不引入任何可能与题干冲突的字符。
 *
 * @module utils/fractionRect
 */

/** 解析 \frac{a}{b}（支持 $...$ / \(...\) 包裹），返回 [a,b] 或 null */
function parseFrac(s) {
  const m = /\\frac\s*\{(\d{1,3})\}\s*\{(\d{1,3})\}/.exec(s)
  if (!m) return null
  const num = Number(m[1])
  const den = Number(m[2])
  if (!Number.isInteger(num) || !Number.isInteger(den) || den === 0 || num === 0) return null
  return [num, den]
}

/**
 * 题干 → 分数长方形 SVG。
 * @returns {{ svg: string, spec: { f1:[number,number], f2:[number,number] } }|null}
 */
export function buildFractionRectSvg(parentStem, content) {
  const text = [String(parentStem ?? ''), String(content ?? '')].join('\n').replace(/\s+/g, ' ')
  if (!/长方形/.test(text) || !/整体\s*1/.test(text)) return null
  if (!/\\frac/.test(text) || !/\\times/.test(text)) return null
  // 只吃「\frac×\frac」紧邻形态；分数间夹其它内容（加减/三个分数）→ 放弃
  const m = /\\frac\s*\{(\d{1,3})\}\s*\{(\d{1,3})\}\s*\\times\s*\\frac\s*\{(\d{1,3})\}\s*\{(\d{1,3})\}/.exec(text)
  if (!m) return null
  const f1 = [Number(m[1]), Number(m[2])]
  const f2 = [Number(m[3]), Number(m[4])]
  for (const [n, d] of [f1, f2]) {
    if (n <= 0 || d <= 0 || n > d) return null // 真分数才画（假分数/带分数形态不同）
  }
  // 网格上限：b×d ≤ 96 且各向 ≤ 16，否则格子小到不清晰 → 放弃
  if (f1[1] > 16 || f2[1] > 16 || f1[1] * f2[1] > 96) return null

  const W = 460
  const H = 300
  const rectW = 360
  let rectH = Math.round(rectW * (f2[1] / f1[1]) * 0.72) // 高宽比随行数自适应，保持格子近方形
  if (rectH < 90) rectH = 90
  if (rectH > 220) rectH = 220
  const x0 = (W - rectW) / 2
  const y0 = (H - rectH) / 2
  const colW = rectW / f1[1]
  const rowH = rectH / f2[1]
  const darkW = f1[0] * colW // 浅灰区宽度（前 a 列）
  const darkH = f2[0] * rowH // 深灰区高度（顶部 c 行）

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`)
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`)
  // 浅灰：第一个分数涂色列（左侧 a 列）
  parts.push(`<rect x="${x0}" y="${y0}" width="${darkW}" height="${rectH}" fill="#d9d9d9"/>`)
  // 深灰：乘积交集（浅灰列 ∩ 顶部 c 行）
  parts.push(`<rect x="${x0}" y="${y0}" width="${darkW}" height="${darkH}" fill="#8c8c8c"/>`)
  // 分隔线：竖 b-1 条、横 d-1 条，外框加粗
  parts.push(`<g stroke="#111111" stroke-width="1.1" fill="none">`)
  for (let i = 1; i < f1[1]; i++) {
    const x = x0 + i * colW
    parts.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + rectH}"/>`)
  }
  for (let j = 1; j < f2[1]; j++) {
    const y = y0 + j * rowH
    parts.push(`<line x1="${x0}" y1="${y}" x2="${x0 + rectW}" y2="${y}"/>`)
  }
  parts.push(`</g>`)
  parts.push(`<rect x="${x0}" y="${y0}" width="${rectW}" height="${rectH}" fill="none" stroke="#111111" stroke-width="2.2"/>`)
  parts.push(`</svg>`)

  return { svg: parts.join(''), spec: { f1, f2 } }
}
