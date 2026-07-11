/**
 * 几何重建：结构化 JSON → 确定性 TikZ 代码。
 *
 * 视觉模型输出的几何结构（点/线/圆/坐标系/约束）在服务端确定性地渲染成 TikZ 代码，
 * 完全基于 geometry_structure_json，**不自由猜测布局**，确保所有几何关系（垂直/平行/坐标系/约束）被正确表达。
 *
 * 坐标系：模型输出的是数学平面坐标（y 向上为正），TikZ 坐标系直接对应（y 向上为正）。
 */

const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * 从模型返回的文本中解析出几何结构 JSON（复用 geometrySvg 的解析逻辑）。
 * 兼容：纯 JSON、```json 代码块、前后夹带说明文字的情况。
 */
export function parseGeometryStructure(content) {
  if (!content || typeof content !== 'string') return null

  const block = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const candidates = []
  if (block) candidates.push(block[1].trim())

  const first = content.indexOf('{')
  const last = content.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    candidates.push(content.slice(first, last + 1))
  }

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
  let points = Array.isArray(obj.points) ? obj.points : []
  points = points.map(p => {
    if (p == null) return null
    // 兼容 points[].name 与 points[].label 两种字段名
    const pointLabel = p.label ?? p.name ?? ''
    if (p.position && isNum(p.position.x) && isNum(p.position.y)) {
      return { label: pointLabel, type: p.type || 'vertex', x: p.position.x, y: p.position.y }
    }
    if (isNum(p.x) && isNum(p.y)) {
      return { label: pointLabel, type: p.type || 'vertex', x: p.x, y: p.y }
    }
    return null
  }).filter(Boolean)

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

  return {
    points,
    segments,
    circles: Array.isArray(obj.circles) ? obj.circles : [],
    // 优先用分类后的 geometry_labels；旧结构无该字段时回退到 labels（向后兼容已渲染的题）
    labels: Array.isArray(obj.geometry_labels) ? obj.geometry_labels
          : Array.isArray(obj.labels) ? obj.labels : [],
    rightAngles: Array.isArray(obj.rightAngles) ? obj.rightAngles : [],
    coordinate_system: obj.coordinate_system && typeof obj.coordinate_system === 'object'
      ? {
          exists: !!obj.coordinate_system.exists,
          origin: obj.coordinate_system.origin || '',
          x_axis: !!obj.coordinate_system.x_axis,
          y_axis: !!obj.coordinate_system.y_axis
        }
      : { exists: false, origin: '', x_axis: false, y_axis: false },
    constraints: Array.isArray(obj.constraints) ? obj.constraints : [],
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

const fmt = (n) => Math.round(n * 100) / 100

/* TikZ 转义（保留 _ 和 ^，用于角/指数标注） */
const esc = (str) => String(str).replace(/([&%$#{}])/g, '\\$1')

/**
 * 把几何结构渲染成 TikZ 代码字符串。
 * @param {object} structure - { points, segments, circles, labels, rightAngles, coordinate_system, constraints }
 * @returns {string|null} TikZ 代码，或 null（无有效元素）
 */
export function renderGeometryTikZ(structure) {
  const s = normalizeStructure(structure || {})
  if (isEmptyStructure(s)) return null

  // 建立顶点查找表
  const pmap = {}
  for (const p of s.points) {
    if (p && p.label && isNum(p.x) && isNum(p.y)) pmap[p.label] = p
  }

  const lines = []
  lines.push('\\begin{tikzpicture}[scale=1]')

  // ── 坐标轴 ──
  const cs = s.coordinate_system
  if (cs.exists) {
    // 找原点坐标
    let ox = 0, oy = 0
    if (cs.origin && pmap[cs.origin]) {
      ox = pmap[cs.origin].x
      oy = pmap[cs.origin].y
    }

    // 计算整个图形的范围，用于确定坐标轴延伸长度
    let minXX = Infinity, maxXX = -Infinity, minYY = Infinity, maxYY = -Infinity
    for (const p of s.points) {
      if (isNum(p.x) && isNum(p.y)) {
        minXX = Math.min(minXX, p.x); maxXX = Math.max(maxXX, p.x)
        minYY = Math.min(minYY, p.y); maxYY = Math.max(maxYY, p.y)
      }
    }
    if (!isFinite(minXX)) { minXX = 0; maxXX = 5; minYY = 0; maxYY = 5 }
    const pad = Math.max(maxXX - minXX, maxYY - minYY, 1) * 0.2 + 1

    if (cs.x_axis) {
      lines.push(`\\draw[->,thick] (${fmt(ox - pad)},${fmt(oy)}) -- (${fmt(maxXX + pad)},${fmt(oy)}) node[right] {$x$};`)
    }
    if (cs.y_axis) {
      lines.push(`\\draw[->,thick] (${fmt(ox)},${fmt(oy - pad)}) -- (${fmt(ox)},${fmt(maxYY + pad)}) node[above] {$y$};`)
    }
  }

  // ── 圆 ──
  for (const c of s.circles) {
    if (!isNum(c?.cx) || !isNum(c?.cy) || !isNum(c?.r)) continue
    const style = c.style === 'dashed' ? 'dashed' : c.style === 'dotted' ? 'dotted' : ''
    const opt = style ? `[${style}]` : ''
    lines.push(`\\draw${opt} (${fmt(c.cx)},${fmt(c.cy)}) circle (${fmt(c.r)});`)
  }

  // ── 线段 ──
  for (const seg of s.segments) {
    const a = pmap[seg.from]
    const b = pmap[seg.to]
    if (!a || !b) continue
    const style = seg.style === 'dashed' ? 'dashed' : seg.style === 'dotted' ? 'dotted' : ''
    const opt = style ? `[${style}]` : ''
    lines.push(`\\draw${opt} (${fmt(a.x)},${fmt(a.y)}) -- (${fmt(b.x)},${fmt(b.y)});`)

    // 垂直标记（直角小方块）
    if (seg.relation === 'perpendicular') {
      const hasRA = s.rightAngles.some(ra => ra.vertex === seg.from || ra.vertex === seg.to)
      if (!hasRA) {
        // 在 from 端点画直角标记
        lines.push(perpendicularMark(a, a, b))
      }
    }

    // 平行标记（∥双竖线）
    if (seg.relation === 'parallel') {
      lines.push(parallelMark(a, b))
    }
  }

  // ── 直角标记 ──
  for (const ra of s.rightAngles) {
    const v = pmap[ra.vertex]
    const a = pmap[ra.from]
    const b = pmap[ra.to]
    if (!v || !a || !b) continue
    lines.push(perpendicularMark(v, a, b))
  }

  // ── 顶点圆点 ──
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y)) continue
    if (p.type === 'origin') {
      // 原点：小圆圈
      lines.push(`\\draw (${fmt(p.x)},${fmt(p.y)}) circle (0.08);`)
    } else if (p.type !== 'point') {
      // 普通顶点：实心点
      lines.push(`\\fill (${fmt(p.x)},${fmt(p.y)}) circle (0.06);`)
    }
    // type === 'point' 不画圆点（只是位置标记）
  }

  // ── 顶点字母标注 ──
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y) || !p.label) continue
    const pos = labelOffset(p, s.points)
    lines.push(`\\node[${pos.anchor}] at (${fmt(p.x + pos.dx)}, ${fmt(p.y + pos.dy)}) {$${esc(p.label)}$};`)
  }

  // ── 长度/角度/文字标注 ──
  for (const l of s.labels) {
    if (!isNum(l?.x) || !isNum(l?.y) || l.text == null) continue
    lines.push(`\\node at (${fmt(l.x)},${fmt(l.y)}) {$${esc(String(l.text))}$};`)
  }

  lines.push('\\end{tikzpicture}')

  return lines.join('\n')
}

/**
 * 生成垂直标记（直角方块）的 TikZ 路径
 */
function perpendicularMark(v, a, b) {
  const ua = unit(v, a)
  const ub = unit(v, b)
  if (!ua || !ub) return ''
  const size = 0.3
  const p1 = { x: v.x + ua.x * size, y: v.y + ua.y * size }
  const p3 = { x: v.x + ub.x * size, y: v.y + ub.y * size }
  const p2 = { x: v.x + (ua.x + ub.x) * size, y: v.y + (ua.y + ub.y) * size }
  return `\\draw (${fmt(p1.x)},${fmt(p1.y)}) -- (${fmt(p2.x)},${fmt(p2.y)}) -- (${fmt(p3.x)},${fmt(p3.y)});`
}

/**
 * 生成平行标记（∥双竖线）的 TikZ 路径
 */
function parallelMark(a, b) {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  // 法线方向
  const nx = -dy / len * 0.3
  const ny = dx / len * 0.3
  const l1 = `\\draw (${fmt(mx + nx * 0.6)},${fmt(my + ny * 0.6)}) -- (${fmt(mx - nx * 0.6)},${fmt(my - ny * 0.6)});`
  const l2 = `\\draw (${fmt(mx + nx * 0.6 + nx * 0.4)},${fmt(my + ny * 0.6 + ny * 0.4)}) -- (${fmt(mx - nx * 0.6 + nx * 0.4)},${fmt(my - ny * 0.6 + ny * 0.4)});`
  return l1 + '\n' + l2
}

/**
 * 计算顶点字母标注的偏移方向：让字母朝向远离图形质心的一侧。
 */
function labelOffset(point, allPoints) {
  let cx = 0, cy = 0, n = 0
  for (const p of allPoints) {
    if (isNum(p?.x) && isNum(p?.y)) { cx += p.x; cy += p.y; n++ }
  }
  if (n === 0) return { dx: 0, dy: 0.3, anchor: 'below' }
  cx /= n
  cy /= n
  let vx = point.x - cx
  let vy = point.y - cy
  const len = Math.hypot(vx, vy) || 1
  vx /= len
  vy /= len
  const dist = 0.3
  const dx = vx * dist
  const dy = vy * dist
  // TikZ 方向锚点
  let anchor
  if (vx > 0.4) anchor = 'right'
  else if (vx < -0.4) anchor = 'left'
  else if (vy > 0.4) anchor = 'above'
  else if (vy < -0.4) anchor = 'below'
  else anchor = 'right'
  return { dx, dy, anchor }
}

function unit(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 0.0001) return null
  return { x: dx / len, y: dy / len }
}
