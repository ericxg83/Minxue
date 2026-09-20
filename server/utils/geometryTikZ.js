/**
 * 几何重建：结构化 JSON → 确定性 TikZ 代码。
 *
 * 视觉模型输出的几何结构（点/线/圆/坐标系/约束）在服务端确定性地渲染成 TikZ 代码，
 * 完全基于 geometry_structure_json，**不自由猜测布局**，确保所有几何关系（垂直/平行/坐标系/约束）被正确表达。
 *
 * 坐标系：模型输出的是数学平面坐标（y 向上为正），TikZ 坐标系直接对应（y 向上为正）。
 */

import {
  parseGeometryStructure,
  normalizeStructure,
  isEmptyStructure,
  isVertexSymbolLabel,
  isAuxPointLabel,
  isTickNumberLabel,
  splitCurveRuns,
  resolveAxisLabels
} from './geom/structure.js'
import { unit } from './geom/vec.js'
import { placeLabel, outwardPref, vertexPref } from './geom/labelPlace.js'

// 再导出，保持 tikzWorker 既有的 import 路径不变
export { parseGeometryStructure, isEmptyStructure }

const isNum = (v) => typeof v === 'number' && isFinite(v)

const fmt = (n) => Math.round(n * 100) / 100

// 数轴 / 直角坐标系数值标注距轴线的距离（cm，2026-09-19）。
// 与 SVG 渲染器 AXIS_LABEL_DY 语义一致：固定距离、居中，同图所有标签等距。
const AXIS_LABEL_GAP = { below: '0.25cm', above: '0.18cm', origin: '0.10cm', originDx: '0.16cm' }

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

  // ── 填充多边形（阴影区域，2026-09-18）──
  // 与 SVG 渲染器同一条判据：顶点齐备 + 每条边都已由 segments 表达，才上色。
  const segKeys = new Set(s.segments.map(g => [String(g.from), String(g.to)].sort().join('|')))
  for (const pg of s.polygons || []) {
    if (!pg.fill) continue
    const labels = pg.points || []
    if (labels.length < 3) continue
    if (!labels.every(l => pmap[l])) continue
    const closed = labels.every((l, i) =>
      segKeys.has([l, labels[(i + 1) % labels.length]].sort().join('|'))
    )
    if (!closed) continue
    const coords = labels.map(l => `(${fmt(pmap[l].x)},${fmt(pmap[l].y)})`).join(' -- ')
    lines.push(`\\draw[fill=black!12] ${coords} -- cycle;`)
  }

  // ── 圆弧（扇形弧 / 优弧劣弧，2026-09-18）──
  for (const arc of s.arcs || []) {
    const c = pmap[arc.center]
    const a = pmap[arc.from]
    const b = pmap[arc.to]
    if (!c || !a || !b) continue
    const R = Math.hypot(a.x - c.x, a.y - c.y)
    if (!(R > 0)) continue
    const { startAngle, endAngle } = arcAngles(c, a, b)
    const style = arc.style === 'dashed' ? 'dashed' : arc.style === 'dotted' ? 'dotted' : ''
    const opt = style ? `[${style}]` : ''
    lines.push(
      `\\draw${opt} (${fmt(a.x)},${fmt(a.y)}) arc[start angle=${fmt(startAngle)}, end angle=${fmt(endAngle)}, radius=${fmt(R)}];`
    )
  }

  // ── 曲线（函数图象，2026-09-18；2026-09-19 改平滑渲染）──
  // 与 SVG 渲染器**同源同形**：splitCurveRuns 切无定义缺口，再用 Catmull-Rom 转
  // `.. controls ..` 三次贝塞尔。刻意不用 TikZ 的 `smooth` 绘图选项——那要
  // plothandlers 库，仓库里没有任何 `\usetikzlibrary` 声明，缺库会直接编译失败。
  for (const cv of s.curves || []) {
    const style = cv.style === 'dashed' ? 'dashed' : cv.style === 'dotted' ? 'dotted' : ''
    const opt = style ? `[${style}]` : ''
    for (const run of splitCurveRuns(cv.points, cv.breaks)) {
      const d = tikzSmoothPath(run)
      if (d) lines.push(`\\draw${opt} ${d};`)
    }
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

  // ── 角标记（顶点处的小圆弧，2026-09-18）──
  // 半径固定 0.4 个 TikZ 单位，与 SVG 渲染器的 14px 对应。
  const ANGLE_MARK_R = 0.4
  for (const m of s.angleMarks || []) {
    const v = pmap[m.vertex]
    const a = pmap[m.from]
    const b = pmap[m.to]
    if (!v || !a || !b) continue
    const { startAngle, endAngle } = arcAngles(v, a, b)
    const rad = startAngle * Math.PI / 180
    const sx = v.x + ANGLE_MARK_R * Math.cos(rad)
    const sy = v.y + ANGLE_MARK_R * Math.sin(rad)
    lines.push(
      `\\draw (${fmt(sx)},${fmt(sy)}) arc[start angle=${fmt(startAngle)}, end angle=${fmt(endAngle)}, radius=${ANGLE_MARK_R}];`
    )
  }

  // ── 顶点圆点 ──
  // 数轴 / 直角坐标系标注的摆位与 SVG 渲染器同一条判据（resolveAxisLabels）：
  // 圆点吸附到轴上，模型写的 y=-9 只是"文字放轴下方"的排版意图。
  const axisLabels = resolveAxisLabels(s)
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y)) continue
    // 内部辅助点（`_` 前缀）只参与几何计算，不画圆点（2026-09-19，与 SVG 渲染器同判据）
    if (isAuxPointLabel(p.label)) continue
    // 刻度数字（0、1、-2…）是文字刻度不是顶点，不画圆点（2026-09-19，与 SVG 同判据）
    if (isTickNumberLabel(p.label)) continue
    const axisLay = axisLabels.get(p.label)
    // snap=false 的是「本来就落在轴上的真顶点」：圆点保持原位，只统一文字摆位
    const snapped = !!axisLay && axisLay.snap !== false
    const py = snapped ? axisLay.axisY : p.y
    // 原点：圆点吸附到**两轴交点**（模型给的 x/y 是文字排版意图，不是几何事实）
    const px = snapped && isNum(axisLay.atX) ? axisLay.atX : p.x
    if (p.type === 'origin') {
      // 原点：小圆圈
      lines.push(`\\draw (${fmt(px)},${fmt(py)}) circle (0.08);`)
    } else if (p.type !== 'point') {
      // 普通顶点：实心点
      lines.push(`\\fill (${fmt(px)},${fmt(py)}) circle (0.06);`)
    }
    // type === 'point' 不画圆点（只是位置标记）
  }

  // ── 顶点字母标注 ──
  // 与 SVG 渲染器同一条判据（2026-09-19）：只画「数学符号」类名字，
  // 拦掉视觉模型给内部对象起的占位符（pt_a、arr_u、Axis_start、T1_b…）；
  // 摆位同样走 labelPlace 打分（避让线段/文字/点），两渲染器必须一致。
  const labelPts = s.points
    .filter(p => isNum(p?.x) && isNum(p?.y) && p.label && isVertexSymbolLabel(p.label))
    .map(p => ({ x: p.x, y: p.y }))
  const labelSegs = []
  for (const g of s.segments) {
    const a = pmap[g.from]
    const b = pmap[g.to]
    if (a && b && isNum(a.x) && isNum(a.y) && isNum(b.x) && isNum(b.y)) {
      labelSegs.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } })
    }
  }
  for (const pg of s.polygons || []) {
    const vs = (pg?.points || []).map(l => pmap[l]).filter(v => v && isNum(v.x) && isNum(v.y))
    for (let i = 0; i < vs.length; i++) {
      labelSegs.push({ a: { x: vs[i].x, y: vs[i].y }, b: { x: vs[(i + 1) % vs.length].x, y: vs[(i + 1) % vs.length].y } })
    }
  }
  const placedBoxes = []
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y) || !p.label) continue
    if (!isVertexSymbolLabel(p.label)) continue
    const axisLay = axisLabels.get(p.label)
    if (axisLay) {
      // 轴系标签：点正下/正上方居中，同图所有标签距轴等距（不走避让打分，
      // 该算法对共线点集会把手写体推散到左右两侧）。
      // 落轴真顶点（snap=false）也按此摆位，与刻度数字齐平；只是它本就在轴上。
      // 原点额外右移一点（`below right`），避开 y 轴往轴下方伸出的那一小截。
      const atY = axisLay.origin && isNum(axisLay.atY)
        ? axisLay.atY
        : (axisLay.snap === false ? p.y : axisLay.axisY)
      // 原点：锚在**两轴交点**上（模型给的坐标只是"文字放哪"的排版意图）
      const atX = axisLay.origin && isNum(axisLay.atX) ? axisLay.atX : p.x
      let opt
      if (axisLay.side === 'above') opt = `above=${AXIS_LABEL_GAP.above}`
      else if (axisLay.origin) opt = `below=${AXIS_LABEL_GAP.origin}, xshift=${AXIS_LABEL_GAP.originDx}`
      else opt = `below=${AXIS_LABEL_GAP.below}`
      lines.push(`\\node[${opt}] at (${fmt(atX)}, ${fmt(atY)}) {$${esc(p.label)}$};`)
      continue
    }
    const node = { x: p.x, y: p.y }
    const fallback = outwardPref(node, labelPts)
    const pos = placeLabel({
      tag: p.label,
      node,
      points: labelPts,
      segments: labelSegs,
      placed: placedBoxes,
      // 偏好方向 = 该顶点的外角平分线（教材惯例）；孤立点/共线点回退到"远离质心"
      prefer: vertexPref(node, labelSegs, fallback),
      dist: 0.35,
      box: { w: labelWidthTikz(p.label), h: 0.5 },
    })
    const tx = node.x + pos.dx
    const ty = node.y + pos.dy
    lines.push(`\\node[${anchorOfDir(pos.dir)}] at (${fmt(tx)}, ${fmt(ty)}) {$${esc(p.label)}$};`)
    placedBoxes.push({ x: tx, y: ty, w: labelWidthTikz(p.label), h: 0.5 })
  }

  // ── 长度/角度/文字标注 ──
  for (const l of s.labels) {
    if (!isNum(l?.x) || !isNum(l?.y) || l.text == null) continue
    // 文字通道里的原点符号（模型把 O 写成 label 而不是 point）：同样锚到两轴交点，
    // 摆位与上面「顶点字母标注」的原点分支逐字一致（同样 below/xshift），
    // 否则它会在交点右下方老远（实测 22px/26px）。
    const oLay = axisLabels.get(String(l.text).trim())
    if (oLay && oLay.origin && isNum(oLay.atX) && isNum(oLay.atY)) {
      lines.push(
        `\\node[below=${AXIS_LABEL_GAP.origin}, xshift=${AXIS_LABEL_GAP.originDx}] at (${fmt(oLay.atX)}, ${fmt(oLay.atY)}) {$${esc(String(l.text))}$};`
      )
      continue
    }
    lines.push(`\\node at (${fmt(l.x)},${fmt(l.y)}) {$${esc(String(l.text))}$};`)
  }

  lines.push('\\end{tikzpicture}')

  return lines.join('\n')
}

/**
 * 求圆弧的起始/终止角（度，TikZ 约定：x 轴正方向为 0°，逆时针为正）。
 * 数学坐标下从 a 逆时针扫到 b，故终止角保证大于起始角。
 * 与 SVG 渲染器 arcPathD 同一约定，两个渲染器必须给出方向一致的弧。
 */
function arcAngles(c, a, b) {
  const toDeg = (p) => Math.atan2(p.y - c.y, p.x - c.x) * 180 / Math.PI
  const startAngle = toDeg(a)
  let endAngle = toDeg(b)
  while (endAngle <= startAngle) endAngle += 360
  return { startAngle, endAngle }
}

/**
 * 曲线采样点 → TikZ 三次贝塞尔路径（`(p0) .. controls (c1) and (c2) .. (p1) ...`）。
 *
 * Catmull-Rom 插值，与 `geometrySvg.js` 的 smoothPathD **逐点等价**：
 * 两个渲染器必须给出形状一致的同一条曲线，否则 App 上的图和 PDF/讲义里的图
 * 会对不上（此前顶点标注就踩过一次"只改一半"的坑）。
 */
function tikzSmoothPath(P) {
  const pt = (p) => `(${fmt(p[0])},${fmt(p[1])})`
  if (!Array.isArray(P) || P.length < 2) return null
  if (P.length === 2) return `${pt(P[0])} -- ${pt(P[1])}`
  const n = P.length
  const at = (i) => P[Math.max(0, Math.min(n - 1, i))]
  let out = pt(P[0])
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    out += ` .. controls ${pt(c1)} and ${pt(c2)} .. ${pt(p2)}`
  }
  return out
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
 * 标注文本框的近似宽度（TikZ 数学单位）。字号约 0.5 单位高，符号宽约 0.3/字符。
 * 与 SVG 渲染器的 labelWidth 语义一致，仅量纲不同，用于避让打分。
 */
function labelWidthTikz(label) {
  const s = String(label || '')
  let w = 0
  for (const ch of s) w += /[\u2080-\u209f\u2070-\u207f]/.test(ch) ? 0.2 : 0.3
  return Math.max(0.25, w)
}

/** 候选方向 → TikZ 节点锚点（与 labelPlace 的 dir 命名对应） */
function anchorOfDir(dir) {
  if (dir === 'top') return 'above'
  if (dir === 'bottom') return 'below'
  if (dir === 'left' || dir === 'topLeft' || dir === 'bottomLeft') return 'left'
  return 'right'
}
