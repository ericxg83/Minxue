/**
 * 几何重建：结构化 JSON → 干净 SVG。
 *
 * 视觉模型输出的几何结构（点/线/圆/坐标系/约束）在服务端确定性地渲染成 SVG。
 * 输出：白色背景、黑色线条、保留顶点字母/几何数字/角度标记，仅含几何元素。
 *
 * 坐标系：模型输出的是数学平面坐标（y 向上为正），本模块渲染时翻转 y。
 *
 * 兼容性：支持新旧两种格式：
 *   旧格式：points[i].{x, y}（直接坐标字段）
 *   新格式：points[i].position.{x, y}（含 type 字段）
 */

const SVG_W = 400
const SVG_H = 300
const MARGIN = 36

const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * 从模型返回的文本中解析出几何结构 JSON。
 * 兼容：纯 JSON、```json 代码块、前后夹带说明文字的情况。
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

/** 规范化结构：确保各字段为数组，兼容新旧格式 */
function normalizeStructure(obj) {
  // 兼容新旧 points 格式
  let points = Array.isArray(obj.points) ? obj.points : []
  points = points.map(p => {
    if (p == null) return null
    // 新格式：{ label, type, position: { x, y } }
    if (p.position && isNum(p.position.x) && isNum(p.position.y)) {
      return {
        label: p.label ?? '',
        type: p.type || 'vertex',
        x: p.position.x,
        y: p.position.y
      }
    }
    // 旧格式：{ label, x, y }
    if (isNum(p.x) && isNum(p.y)) {
      return {
        label: p.label ?? '',
        type: p.type || 'vertex',
        x: p.x,
        y: p.y
      }
    }
    return null
  }).filter(Boolean)

  // segments 兼容新老格式
  let segments = Array.isArray(obj.segments) ? obj.segments : []
  segments = segments.map(seg => {
    if (seg == null) return null
    return {
      from: seg.from ?? seg.start ?? '',
      to: seg.to ?? seg.end ?? '',
      style: seg.style || 'solid',
      relation: seg.relation || 'normal'
    }
  }).filter(s => s.from && s.to)

  // ── 图形类型判断层 ──
  // figure_type: 'coordinate'(A 坐标/函数图) | 'geometry'(B 纯几何示意图) | 'geometry_with_coords'(C 带坐标背景的几何图)
  // 缺省时（旧结构无该字段）按坐标系存在性回退推断，保持向后兼容。
  const rawCs = obj.coordinate_system && typeof obj.coordinate_system === 'object'
    ? {
        exists: !!obj.coordinate_system.exists,
        origin: obj.coordinate_system.origin || '',
        x_axis: !!obj.coordinate_system.x_axis,
        y_axis: !!obj.coordinate_system.y_axis
      }
    : { exists: false, origin: '', x_axis: false, y_axis: false }
  const figure_type = normalizeFigureType(obj.figure_type, rawCs)
  // 服务端硬性保护：纯几何示意图（类型 B）绝不绘制坐标轴，
  // 即使模型误判 coordinate_system.exists=true 也强制关闭，避免给几何题凭空加坐标系。
  const coordinate_system = figure_type === 'geometry'
    ? { exists: false, origin: '', x_axis: false, y_axis: false }
    : rawCs

  return {
    points,
    segments,
    circles: Array.isArray(obj.circles) ? obj.circles : [],
    // 优先用分类后的 geometry_labels；旧结构无该字段时回退到 labels（向后兼容已渲染的题）
    labels: Array.isArray(obj.geometry_labels) ? obj.geometry_labels
          : Array.isArray(obj.labels) ? obj.labels : [],
    rightAngles: Array.isArray(obj.rightAngles) ? obj.rightAngles : [],
    figure_type,
    coordinate_system,
    constraints: Array.isArray(obj.constraints) ? obj.constraints : [],
  }
}

/**
 * 归一化图形类型。
 * A 坐标/函数图 → 'coordinate'；B 纯几何示意图 → 'geometry'；C 带坐标背景的几何图 → 'geometry_with_coords'。
 * 模型未给出 figure_type 时按坐标系存在性回退：有坐标轴 → coordinate，否则 → geometry。
 */
function normalizeFigureType(raw, cs) {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (t === 'coordinate' || t === 'function' || t === 'a') return 'coordinate'
  if (t === 'geometry' || t === 'b') return 'geometry'
  if (t === 'geometry_with_coords' || t === 'geometry_with_coordinates' || t === 'c') return 'geometry_with_coords'
  // 回退推断
  return cs && cs.exists ? 'coordinate' : 'geometry'
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
 * @param {object} structure - { points, segments, circles, labels, rightAngles, coordinate_system, constraints }
 * @returns {string|null} SVG 源码，或 null（无有效元素）
 */
export function renderGeometrySvg(structure) {
  const s = normalizeStructure(structure || {})
  if (isEmptyStructure(s)) return null

  // 建立顶点查找表
  const pmap = {}
  for (const p of s.points) {
    if (p && p.label && isNum(p.x) && isNum(p.y)) pmap[p.label] = p
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

  // ── 坐标轴（在线段之前绘制，确保在底层） ──
  const cs = s.coordinate_system
  if (cs.exists) {
    const axisColor = '#555555'
    const axisWidth = 1.2
    // 找原点
    let ox = MARGIN + offsetX - minX * scale  // 数学原点在 SVG 中的 x
    let oy = MARGIN + offsetY + maxY * scale   // 数学原点在 SVG 中的 y
    let originLabel = null
    if (cs.origin && pmap[cs.origin]) {
      ox = toX(pmap[cs.origin].x)
      oy = toY(pmap[cs.origin].y)
      originLabel = cs.origin
    }

    // 确定轴端点：沿 x/y 方向延伸到图形边界。
    // 命名以「数学方向」为准，避免混淆 SVG 的 y 向下：
    //   xPos = x 正方向端（右）、xNeg = 负方向端（左）
    //   yPos = y 正方向端（上，SVG 里是最小 y 像素）、yNeg = 负方向端（下）
    const xPos = toX(maxX + (maxX - minX) * 0.15) // x 轴正向：右侧箭头处
    const xNeg = toX(minX - (maxX - minX) * 0.15) // x 轴负向：左端
    const yNeg = toY(minY - (maxY - minY) * 0.15) // y 轴负向：下端
    const yPos = toY(maxY + (maxY - minY) * 0.15) // y 轴正向：上侧箭头处

    // 用 <g> 分组，方便统一样式
    parts.push(`<g stroke="${axisColor}" stroke-width="${axisWidth}" fill="none" stroke-linecap="round">`)

    // X 轴（箭头在正方向 = 右端）
    if (cs.x_axis) {
      parts.push(`<line x1="${fmt(xNeg)}" y1="${fmt(oy)}" x2="${fmt(xPos)}" y2="${fmt(oy)}"/>`)
      // X 轴箭头（指向右）
      const arrowSize = 8
      parts.push(`<polyline points="${fmt(xPos)},${fmt(oy)} ${fmt(xPos - arrowSize)},${fmt(oy - arrowSize * 0.5)} ${fmt(xPos - arrowSize)},${fmt(oy + arrowSize * 0.5)}" fill="${axisColor}" stroke="none"/>`)
    }

    // Y 轴（箭头在正方向 = 上端）
    if (cs.y_axis) {
      parts.push(`<line x1="${fmt(ox)}" y1="${fmt(yNeg)}" x2="${fmt(ox)}" y2="${fmt(yPos)}"/>`)
      // Y 轴箭头（指向上）
      const arrowSize = 8
      parts.push(`<polyline points="${fmt(ox)},${fmt(yPos)} ${fmt(ox - arrowSize * 0.5)},${fmt(yPos + arrowSize)} ${fmt(ox + arrowSize * 0.5)},${fmt(yPos + arrowSize)}" fill="${axisColor}" stroke="none"/>`)
    }

    parts.push('</g>')

    // 轴标签 "x"（右箭头旁）和 "y"（上箭头旁）——符合中国教材习惯：
    //   y 在 y 轴顶端（正方向）附近，绝不放到原点下方。
    parts.push(`<g fill="${axisColor}" font-family="Times New Roman, serif" font-size="14" font-style="italic">`)
    if (cs.x_axis) {
      parts.push(`<text x="${fmt(xPos + 4)}" y="${fmt(oy + 4)}" text-anchor="start">x</text>`)
    }
    if (cs.y_axis) {
      parts.push(`<text x="${fmt(ox + 6)}" y="${fmt(yPos + 12)}" text-anchor="start">y</text>`)
    }
    parts.push('</g>')
  }

  // ── 主几何图形（黑色线条） ──
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

    // 垂直标记：在交点处画小方块（如果 relation 是 perpendicular 且没有 rightAngles 条目）
    if (seg.relation === 'perpendicular') {
      // 检查是否已有 rightAngles 条目覆盖此关系
      const hasRightAngleEntry = s.rightAngles.some(
        ra => ra.vertex === seg.from || ra.vertex === seg.to
      )
      if (!hasRightAngleEntry) {
        // 在 from 端点画直角标记
        const sq = rightAngleSquare(a, a, b, 10)
        if (sq) parts.push(`<polyline points="${sq}"/>`)
      }
    }

    // 平行标记：在线的中点附近画小箭头（// 标记）
    if (seg.relation === 'parallel') {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      // 法线方向（垂直方向）
      const nx = -dy / len * 8
      const ny = dx / len * 8
      // 两条平行线标记
      parts.push(
        `<line x1="${fmt(mx + nx * 1.5)}" y1="${fmt(my + ny * 1.5)}" x2="${fmt(mx + nx * 1.5)}" y2="${fmt(my + ny * 1.5)}" stroke="none"/>`,
        `<line x1="${fmt(mx + nx * 0.8)}" y1="${fmt(my + ny * 0.8)}" x2="${fmt(mx + nx * 0.8)}" y2="${fmt(my + ny * 0.8)}" stroke="none"/>`
      )
    }
  }

  // 直角标记
  for (const ra of s.rightAngles) {
    const v = findCoord(ra?.vertex)
    const a = findCoord(ra?.from)
    const b = findCoord(ra?.to)
    if (!v || !a || !b) continue
    const sq = rightAngleSquare(v, a, b, 12)
    if (sq) parts.push(`<polyline points="${sq}"/>`)
  }

  parts.push(`</g>`)

  // ── 顶点圆点 ──
  parts.push(`<g fill="#111111">`)
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y)) continue
    // 原点用稍大的空心圆
    if (p.type === 'origin') {
      parts.push(`<circle cx="${fmt(toX(p.x))}" cy="${fmt(toY(p.y))}" r="3" fill="none" stroke="#111111" stroke-width="1.2"/>`)
    } else {
      parts.push(`<circle cx="${fmt(toX(p.x))}" cy="${fmt(toY(p.y))}" r="2.4"/>`)
    }
  }
  parts.push(`</g>`)

  // ── 顶点字母标注 ──
  parts.push(`<g fill="#111111" font-family="Times New Roman, serif" font-size="16" font-style="italic">`)
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y) || !p.label) continue
    const pos = labelOffset(p, s.points)
    parts.push(
      `<text x="${fmt(toX(p.x) + pos.dx)}" y="${fmt(toY(p.y) + pos.dy)}" text-anchor="${pos.anchor}">${esc(p.label)}</text>`
    )
  }
  parts.push(`</g>`)

  // ── 长度/角度/文字标注 ──
  parts.push(`<g fill="#111111" font-family="Times New Roman, serif" font-size="14">`)
  for (const l of s.labels) {
    if (!isNum(l?.x) || !isNum(l?.y) || l.text == null) continue
    parts.push(
      `<text x="${fmt(toX(l.x))}" y="${fmt(toY(l.y))}" text-anchor="middle" dominant-baseline="middle">${esc(l.text)}</text>`
    )
  }
  parts.push(`</g>`)

  // ── SVG 底部注释：存储原始结构 JSON（调试用，不渲染可见内容） ──
  // geometry_structure_json 单独存储，不嵌入 SVG

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