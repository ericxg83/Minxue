/**
 * 几何重建：结构化 JSON → 干净 SVG。
 *
 * 视觉模型输出的几何结构（点/线/圆/标注）在服务端确定性地渲染成 SVG。
 * 输出：白色背景、黑色线条、保留顶点字母/几何数字/角度标记，仅含几何元素。
 *
 * 坐标系：模型输出的是数学平面坐标（y 向上为正），本模块渲染时翻转 y。
 */

const SVG_W = 400
const SVG_H = 300
const MARGIN = 36

const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * 从模型返回的文本中解析出几何结构 JSON。
 * 兼容：纯 JSON、```json 代码块、前后夹带说明文字的情况。
 * @param {string} content
 * @returns {object|null}
 */
export function parseGeometryStructure(content) {
  if (!content || typeof content !== 'string') return null

  // 1. 尝试 ```json ... ``` 代码块
  const block = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const candidates = []
  if (block) candidates.push(block[1].trim())

  // 2. 尝试截取第一个 { 到最后一个 }
  const first = content.indexOf('{')
  const last = content.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    candidates.push(content.slice(first, last + 1))
  }

  // 3. 整段
  candidates.push(content.trim())

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c)
      if (obj && typeof obj === 'object') return normalizeStructure(obj)
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

/** 规范化结构：确保各字段为数组 */
function normalizeStructure(obj) {
  return {
    points: Array.isArray(obj.points) ? obj.points : [],
    segments: Array.isArray(obj.segments) ? obj.segments : [],
    circles: Array.isArray(obj.circles) ? obj.circles : [],
    labels: Array.isArray(obj.labels) ? obj.labels : [],
    rightAngles: Array.isArray(obj.rightAngles) ? obj.rightAngles : [],
  }
}

/** 结构是否为空（无任何可渲染几何元素） */
export function isEmptyStructure(s) {
  if (!s) return true
  return (
    (s.points?.length || 0) === 0 &&
    (s.segments?.length || 0) === 0 &&
    (s.circles?.length || 0) === 0
  )
}

const esc = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const fmt = (n) => Math.round(n * 100) / 100

const strokeDash = (style) => {
  if (style === 'dashed') return ' stroke-dasharray="6,4"'
  if (style === 'dotted') return ' stroke-dasharray="1.5,3"'
  return ''
}

/**
 * 把几何结构渲染成 SVG 字符串。
 * @param {object} structure - { points, segments, circles, labels, rightAngles }
 * @returns {string|null} SVG 源码，或 null（无有效元素）
 */
export function renderGeometrySvg(structure) {
  const s = normalizeStructure(structure || {})
  if (isEmptyStructure(s)) return null

  // 建立顶点查找表
  const pmap = {}
  for (const p of s.points) {
    if (p && p.label != null && isNum(p.x) && isNum(p.y)) pmap[p.label] = p
  }

  // 收集所有坐标计算包围盒
  const xs = []
  const ys = []
  for (const p of s.points) {
    if (isNum(p?.x) && isNum(p?.y)) { xs.push(p.x); ys.push(p.y) }
  }
  for (const c of s.circles) {
    if (isNum(c?.cx) && isNum(c?.cy) && isNum(c?.r)) {
      xs.push(c.cx - c.r, c.cx + c.r)
      ys.push(c.cy - c.r, c.cy + c.r)
    }
  }
  for (const l of s.labels) {
    if (isNum(l?.x) && isNum(l?.y)) { xs.push(l.x); ys.push(l.y) }
  }
  if (xs.length === 0 || ys.length === 0) return null

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const spanX = Math.max(maxX - minX, 0.001)
  const spanY = Math.max(maxY - minY, 0.001)

  const usableW = SVG_W - MARGIN * 2
  const usableH = SVG_H - MARGIN * 2
  const scale = Math.min(usableW / spanX, usableH / spanY)

  // 居中偏移
  const offsetX = (usableW - spanX * scale) / 2
  const offsetY = (usableH - spanY * scale) / 2

  // 数学坐标 → SVG 坐标（翻转 y）
  const toX = (x) => MARGIN + offsetX + (x - minX) * scale
  const toY = (y) => MARGIN + offsetY + (maxY - y) * scale

  const findCoord = (label) => {
    const p = pmap[label]
    if (!p) return null
    return { x: toX(p.x), y: toY(p.y), mx: p.x, my: p.y }
  }

  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">`
  )
  parts.push(`<rect x="0" y="0" width="${SVG_W}" height="${SVG_H}" fill="#ffffff"/>`)
  parts.push(`<g stroke="#111111" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round">`)

  // 圆
  for (const c of s.circles) {
    if (!isNum(c?.cx) || !isNum(c?.cy) || !isNum(c?.r)) continue
    const cx = toX(c.cx)
    const cy = toY(c.cy)
    const r = c.r * scale
    parts.push(`<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"${strokeDash(c.style)}/>`)
  }

  // 线段
  for (const seg of s.segments) {
    const a = findCoord(seg?.from)
    const b = findCoord(seg?.to)
    if (!a || !b) continue
    parts.push(
      `<line x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"${strokeDash(seg.style)}/>`
    )
  }

  // 直角标记（小方块）
  for (const ra of s.rightAngles) {
    const v = findCoord(ra?.vertex)
    const a = findCoord(ra?.from)
    const b = findCoord(ra?.to)
    if (!v || !a || !b) continue
    const sq = rightAngleSquare(v, a, b, 12)
    if (sq) parts.push(`<polyline points="${sq}"/>`)
  }

  parts.push(`</g>`)

  // 顶点圆点
  parts.push(`<g fill="#111111">`)
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y)) continue
    parts.push(`<circle cx="${fmt(toX(p.x))}" cy="${fmt(toY(p.y))}" r="2.4"/>`)
  }
  parts.push(`</g>`)

  // 顶点字母标注
  parts.push(`<g fill="#111111" font-family="Times New Roman, serif" font-size="16" font-style="italic">`)
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y) || p.label == null) continue
    const pos = labelOffset(p, s.points)
    parts.push(
      `<text x="${fmt(toX(p.x) + pos.dx)}" y="${fmt(toY(p.y) + pos.dy)}" text-anchor="${pos.anchor}">${esc(p.label)}</text>`
    )
  }
  parts.push(`</g>`)

  // 长度/角度标注
  parts.push(`<g fill="#111111" font-family="Times New Roman, serif" font-size="14">`)
  for (const l of s.labels) {
    if (!isNum(l?.x) || !isNum(l?.y) || l.text == null) continue
    parts.push(
      `<text x="${fmt(toX(l.x))}" y="${fmt(toY(l.y))}" text-anchor="middle" dominant-baseline="middle">${esc(l.text)}</text>`
    )
  }
  parts.push(`</g>`)

  parts.push(`</svg>`)
  return parts.join('')
}

/**
 * 计算顶点字母标注的偏移方向：让字母朝向远离图形质心的一侧。
 */
function labelOffset(point, allPoints) {
  let cx = 0
  let cy = 0
  let n = 0
  for (const p of allPoints) {
    if (isNum(p?.x) && isNum(p?.y)) { cx += p.x; cy += p.y; n++ }
  }
  if (n === 0) return { dx: 0, dy: -8, anchor: 'middle' }
  cx /= n
  cy /= n
  // 数学坐标下的远离方向
  let vx = point.x - cx
  let vy = point.y - cy
  const len = Math.hypot(vx, vy) || 1
  vx /= len
  vy /= len
  const dist = 16
  // SVG y 轴向下，故数学 y 正方向 → SVG 上方（dy 取负）
  const dx = vx * dist
  const dy = -vy * dist + 5
  const anchor = vx > 0.3 ? 'start' : vx < -0.3 ? 'end' : 'middle'
  return { dx, dy, anchor }
}

/**
 * 生成直角小方块的 polyline 点串（SVG 坐标系）。
 * v=直角顶点，a/b=两条边上的另一端点，size=方块边长(px)。
 */
function rightAngleSquare(v, a, b, size) {
  const ua = unit(v, a)
  const ub = unit(v, b)
  if (!ua || !ub) return null
  const p1 = { x: v.x + ua.x * size, y: v.y + ua.y * size }
  const p3 = { x: v.x + ub.x * size, y: v.y + ub.y * size }
  const p2 = { x: v.x + (ua.x + ub.x) * size, y: v.y + (ua.y + ub.y) * size }
  return `${fmt(p1.x)},${fmt(p1.y)} ${fmt(p2.x)},${fmt(p2.y)} ${fmt(p3.x)},${fmt(p3.y)}`
}

function unit(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 0.0001) return null
  return { x: dx / len, y: dy / len }
}
