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

import {
  parseGeometryStructure,
  normalizeStructure,
  isSymbolLabel,
  isVertexSymbolLabel,
  isAuxPointLabel,
  isTickNumberLabel,
  isRawEmptyStructure,
  isEmptyStructure,
  hasDerivedPoints,
  splitCurveRuns,
  resolveNumberAxisLabels,
  resolveCoordAxisLabels,
  resolveAxisLabels
} from './geom/structure.js'
import { unit } from './geom/vec.js'
import { placeLabel, outwardPref, vertexPref } from './geom/labelPlace.js'

// 再导出，保持 geometryWorker / rerunGeometry / 测试既有的 import 路径不变
export {
  parseGeometryStructure,
  isSymbolLabel,
  isVertexSymbolLabel,
  isAuxPointLabel,
  isTickNumberLabel,
  isRawEmptyStructure,
  isEmptyStructure,
  hasDerivedPoints,
  splitCurveRuns,
  resolveNumberAxisLabels,
  resolveCoordAxisLabels,
  resolveAxisLabels
}

const SVG_W = 400
const SVG_H = 300
const MARGIN = 36

// 数轴 / 直角坐标系数值标注距轴线的像素距离（2026-09-19）。
// 同一张图上所有标签共用同一距离，消除「值标位置参差不齐」的观感问题。
const AXIS_LABEL_DY = { below: 20, above: 10, origin: 17 }
// 原点字母的横向偏移：y 轴常往轴下方伸出一小截，居中会被它叠住（原卷写在竖线右侧）
const ORIGIN_LABEL_DX = 9

const isNum = (v) => typeof v === 'number' && isFinite(v)

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
  // 曲线采样点必须计入包围盒，否则函数图象会被裁出画面
  for (const cv of s.curves || []) {
    for (const pt of cv?.points || []) {
      if (isNum(pt?.[0]) && isNum(pt?.[1])) { xs.push(pt[0]); ys.push(pt[1]) }
    }
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

  // ── 填充多边形（阴影区域，2026-09-18）──
  // 必须在线段之前绘制，避免灰底盖住边线与顶点。
  // 只在结构里真的存在可渲染多边形时输出 —— 保证存量结构的 SVG 逐字节不变。
  const segKeys = new Set(s.segments.map(g => segKey(g.from, g.to)))
  const filledPolygons = (s.polygons || [])
    .map(pg => ({ pg, coords: resolvablePolygon(pg, segKeys, findCoord) }))
    .filter(x => x.coords && x.pg.fill)
  if (filledPolygons.length > 0) {
    parts.push(`<g stroke="none" fill="#d9d9d9">`)
    for (const { coords } of filledPolygons) {
      parts.push(`<polygon points="${coords.map(c => `${fmt(c.x)},${fmt(c.y)}`).join(' ')}"/>`)
    }
    parts.push(`</g>`)
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

  // ── 圆弧（扇形弧 / 优弧劣弧，2026-09-18）──
  for (const arc of s.arcs || []) {
    const d = arcPathD(arc, findCoord, null)
    if (d) parts.push(`<path d="${d}"${strokeDash(arc.style)}/>`)
  }

  // ── 曲线（函数图象，2026-09-18；2026-09-19 改平滑渲染）──
  // 由函数图象通道 / DSL curve 命令确定性生成，不经视觉模型，故不参与内容闸门核对。
  for (const cv of s.curves || []) {
    const d = curvePathD(cv, toX, toY)
    if (d) parts.push(`<path d="${d}"${strokeDash(cv.style)}/>`)
  }

  // 线段
  for (const seg of s.segments) {
    const a = findCoord(seg?.from)
    const b = findCoord(seg?.to)
    if (!a || !b) continue
    // 直线模式：沿方向向量向两端各延长 14%，画成穿过两点的直线（l₁/l₂/l₃ 类）
    let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y
    if (seg.extend) {
      const dx = x2 - x1, dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len, uy = dy / len
      const pad = 4
      // 沿单位方向，分别算 a 反向 / b 正向到画布边的可用距离，取最小，避免延长后越界被裁
      const distToEdge = (px, py, sx, sy) => {
        let m = Infinity
        if (sx > 1e-6) m = Math.min(m, (SVG_W - pad - px) / sx); else if (sx < -1e-6) m = Math.min(m, (pad - px) / sx)
        if (sy > 1e-6) m = Math.min(m, (SVG_H - pad - py) / sy); else if (sy < -1e-6) m = Math.min(m, (pad - py) / sy)
        return m === Infinity ? len * 0.14 : m
      }
      const ext = Math.max(0, Math.min(len * 0.14, distToEdge(x1, y1, -ux, -uy), distToEdge(x2, y2, ux, uy)))
      x1 -= ux * ext; y1 -= uy * ext; x2 += ux * ext; y2 += uy * ext
    }
    parts.push(
      `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"${strokeDash(seg.style)}/>`
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

  // ── 角标记（顶点处的小圆弧，2026-09-18）──
  // 半径固定 14px（与图形尺度无关），符合教材角的标注习惯。
  for (const m of s.angleMarks || []) {
    const d = arcPathD({ center: m.vertex, from: m.from, to: m.to }, findCoord, 14)
    if (d) parts.push(`<path d="${d}"${strokeDash(m.style)}/>`)
  }

  parts.push(`</g>`)

  // ── 顶点圆点 ──
  // 数轴 / 直角坐标系标签（a/b/c、-2/0/1、落轴点、原点）的摆位：模型只能用 point
  // 承载标签坐标，它写的 y=-9 只是"把文字放轴下方"的排版意图，不是真有个点悬在轴外。
  // 这里统一把圆点吸附到轴上，文字走固定侧向（见 resolveAxisLabels）。
  const axisLabels = resolveAxisLabels(s)
  parts.push(`<g fill="#111111">`)
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y)) continue
    // 内部辅助点（`_` 前缀）只参与几何计算，不画圆点（2026-09-19）
    if (isAuxPointLabel(p.label)) continue
    // 刻度数字（0、1、-2…）是文字刻度不是顶点，不画圆点（2026-09-19）
    if (isTickNumberLabel(p.label)) continue
    const axisLay = axisLabels.get(p.label)
    // snap=false 的是「本来就落在轴上的真顶点」：圆点保持原位，只统一文字摆位
    const snapped = !!axisLay && axisLay.snap !== false
    const py = snapped ? axisLay.axisY : p.y
    // 原点：圆点吸附到**两轴交点**（模型给的 x/y 是文字排版意图，不是几何事实）
    const px = snapped && isNum(axisLay.atX) ? axisLay.atX : p.x
    // 原点用稍大的空心圆
    if (p.type === 'origin') {
      parts.push(`<circle cx="${fmt(toX(px))}" cy="${fmt(toY(py))}" r="3" fill="none" stroke="#111111" stroke-width="1.2"/>`)
    } else {
      parts.push(`<circle cx="${fmt(toX(px))}" cy="${fmt(toY(py))}" r="2.4"/>`)
    }
  }
  parts.push(`</g>`)

  // ── 顶点字母标注 ──
  // 摆位规则（2026-09-19 起）：候选方向打分择优，**避让线段**（老师反馈"字母压到线上"）、
  // 避让已放置的其它文字、别盖住别的点，同时保留"朝向图形外侧"的观感偏好。
  // 打分器见 utils/geom/labelPlace.js（与 TikZ 渲染器共用同一套规则）。
  parts.push(`<g fill="#111111" font-family="Times New Roman, serif" font-size="16" font-style="italic">`)
  // labelPlace 约定 y 向上为正，而 SVG y 向下为正 ⇒ 内部统一取负，输出时再取负回来
  const outPt = (p) => ({ x: toX(p.x), y: -toY(p.y) })
  const labelPts = s.points
    .filter(p => isNum(p?.x) && isNum(p?.y) && p.label && isVertexSymbolLabel(p.label))
    .map(p => outPt(p))
  const labelSegs = []
  for (const g of s.segments) {
    // ⚠️ findCoord 返回的**已经是 SVG 像素坐标**（x=toX, y=toY），不能再套一层 toX/toY。
    // 这里只需把 y 取负转成"向上为正"的约定。
    const a = findCoord(g.from)
    const b = findCoord(g.to)
    if (a && b && isNum(a.x) && isNum(a.y) && isNum(b.x) && isNum(b.y)) {
      labelSegs.push({ a: { x: a.x, y: -a.y }, b: { x: b.x, y: -b.y } })
    }
  }
  for (const pg of s.polygons || []) {
    const vs = (pg?.points || []).map(l => findCoord(l)).filter(v => v && isNum(v.x) && isNum(v.y))
    for (let i = 0; i < vs.length; i++) {
      labelSegs.push({ a: { x: vs[i].x, y: -vs[i].y }, b: { x: vs[(i + 1) % vs.length].x, y: -vs[(i + 1) % vs.length].y } })
    }
  }
  const placedBoxes = []
  for (const p of s.points) {
    if (!isNum(p?.x) || !isNum(p?.y) || !p.label) continue
    // 2026-09-19：顶点标注只渲染「数学符号」类名字（A/B/C、O、α、1、0、x₁ 等），
    // 过滤视觉模型生成的占位符命名（pt_a、arr_u、Axis_start、T1_b、T_n2_b…）。
    // 这类占位符是模型给内部对象起的变量名，直接上屏会变成"画的是什么鬼"的乱码标注。
    if (!isVertexSymbolLabel(p.label)) continue
    const axisLay = axisLabels.get(p.label)
    if (axisLay) {
      // 轴系标签：点正下/正上方居中，同图所有标签距轴等距。
      // 不走避让打分——数轴题的点全共线，通用算法会让字母左右乱窜（实测 21~36px 不齐）。
      // 落轴真顶点（snap=false）同样按此摆位，好与刻度数字齐平；只是它的圆点不挪。
      // 原点（origin）额外右移一点，避开 y 轴往轴下方伸出的那一小截。
      const dy = axisLay.side === 'above'
        ? -AXIS_LABEL_DY.above
        : axisLay.side === 'origin' ? AXIS_LABEL_DY.origin : AXIS_LABEL_DY.below
      // 原点：文字锚在**两轴交点**上（模型给的坐标只是"文字放哪"的排版意图，
      // 实测能偏到 26px ⇒ 老师看到"0 点标的太下面了"）
      const refX = axisLay.origin && isNum(axisLay.atX) ? axisLay.atX : p.x
      const refY = axisLay.origin && isNum(axisLay.atY)
        ? axisLay.atY
        : (axisLay.snap === false ? p.y : axisLay.axisY)
      const baseY = toY(refY)
      const lx = toX(refX) + (axisLay.origin ? ORIGIN_LABEL_DX : 0)
      parts.push(
        `<text x="${fmt(lx)}" y="${fmt(baseY + dy)}" text-anchor="middle">${esc(p.label)}</text>`
      )
      placedBoxes.push({ x: lx, y: -(baseY + dy), w: labelWidth(p.label), h: 16 })
      continue
    }
    const node = outPt(p)
    const fallback = outwardPref(node, labelPts)
    const pos = placeLabel({
      tag: p.label,
      node,
      points: labelPts,
      segments: labelSegs,
      placed: placedBoxes,
      // 偏好方向 = 该顶点的外角平分线（教材惯例）；孤立点/共线点回退到"远离质心"
      prefer: vertexPref(node, labelSegs, fallback),
      dist: 16,
      box: { w: labelWidth(p.label), h: 16 },
      // 可见区域（y 已取负 → 向上为正），越界的候选重罚，避免字母被推到画布边缘
      bounds: { x0: 2, x1: SVG_W - 2, y0: -(SVG_H - 2), y1: -2 },
    })
    const tx = node.x + pos.dx
    const ty = node.y + pos.dy
    parts.push(
      `<text x="${fmt(tx)}" y="${fmt(-ty)}" text-anchor="${anchorOfDir(pos.dir)}">${esc(p.label)}</text>`
    )
    placedBoxes.push({ x: tx, y: ty, w: labelWidth(p.label), h: 16 })
  }
  parts.push(`</g>`)

  // ── 长度/角度/文字标注 ──
  parts.push(`<g fill="#111111" font-family="Times New Roman, serif" font-size="14">`)
  for (const l of s.labels) {
    if (!isNum(l?.x) || !isNum(l?.y) || l.text == null) continue
    // 文字通道里的原点符号（模型把 O 写成 label 而不是 point）：同样锚到两轴交点，
    // 摆位与上面「顶点字母标注」的原点分支逐字一致（同样的基线口径、同样右移 9px），
    // 否则它会在交点右下方老远（实测 22px/26px）。
    const oLay = axisLabels.get(String(l.text).trim())
    if (oLay && oLay.origin && isNum(oLay.atX) && isNum(oLay.atY)) {
      parts.push(
        `<text x="${fmt(toX(oLay.atX) + ORIGIN_LABEL_DX)}" y="${fmt(toY(oLay.atY) + AXIS_LABEL_DY.origin)}" text-anchor="middle">${esc(l.text)}</text>`
      )
      continue
    }
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
 * 标注文字框的近似宽度（像素）。font-size 16 的 Times 斜体，符号宽约 9px/字符；
 * 下标字符（₁₂ 等 Unicode）窄一些，按 7px 折算。用于避让打分，不追求精确排版。
 */
function labelWidth(label) {
  const s = String(label || '')
  let w = 0
  for (const ch of s) w += /[\u2080-\u209f\u2070-\u207f]/.test(ch) ? 7 : 10
  return Math.max(8, w)
}

/** 候选方向 → SVG text-anchor（与 labelPlace 的 dir 命名对应） */
function anchorOfDir(dir) {
  if (dir === 'left' || dir === 'topLeft' || dir === 'bottomLeft') return 'end'
  if (dir === 'top' || dir === 'bottom') return 'middle'
  return 'start'
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

/** 线段的端点无关键，用于"这条边是否已由 segments 表达"的判定 */
const segKey = (a, b) => [String(a), String(b)].sort().join('|')

/**
 * 曲线采样点的 SVG path d 串（**平滑三次贝塞尔**）。
 *
 * 为什么不再是折线（2026-09-19 改）：DSL 的 curve 命令采样点密集（121 点）时
 * 折线与曲线肉眼无差，但**稀疏采样**（模型早期用 point+segment 手搓的十几个点）
 * 画出来底部是尖折角——老师看图会直接说"这抛物线怎么是弯的"。
 * 改用 Catmull-Rom 插值：曲线**精确经过**每个采样点（顶点不会被挪走），
 * 且处处 C1 连续，点再少也是光滑的。
 *
 * 无定义缺口（如 y=1/x 在 0 处）由 splitCurveRuns 切成多段，各段独立成 path，
 * 避免两个分支被一条横穿坐标轴的直线连起来。
 *
 * @param {object} curve - { points: [[x,y],...] }，数学坐标
 * @param {Function} toX - 数学 x → SVG x
 * @param {Function} toY - 数学 y → SVG y
 */
function curvePathD(curve, toX, toY) {
  const runs = splitCurveRuns(curve?.points, curve?.breaks)
  const ds = runs
    .map(run => smoothPathD(run.map(p => [toX(p[0]), toY(p[1])])))
    .filter(Boolean)
  return ds.length ? ds.join(' ') : null
}

/** Catmull-Rom 转三次贝塞尔：过点插值，处处 C1 连续 */
function smoothPathD(P) {
  if (!Array.isArray(P) || P.length < 2) return null
  if (P.length === 2) {
    return `M ${fmt(P[0][0])} ${fmt(P[0][1])} L ${fmt(P[1][0])} ${fmt(P[1][1])}`
  }
  const n = P.length
  const at = (i) => P[Math.max(0, Math.min(n - 1, i))]
  const out = [`M ${fmt(P[0][0])} ${fmt(P[0][1])}`]
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    out.push(`C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`)
  }
  return out.join(' ')
}

/**
 * 多边形是否可渲染：顶点齐备，且每条边都已由 segments 表达。
 *
 * 阴影区域的边界属于题设，必须经过内容闸门核对；宁可少画一层灰底，
 * 也不给未经验证的区域上色（沿用"宁愿少显示，也不显示错误信息"）。
 * 注意：这里不自动把多边形的边补进 segments —— 那会让闸门把模型凭空
 * 造出的边当成合法边，反而放大错误。
 *
 * @returns {Array<{x:number,y:number}>|null} SVG 坐标顶点，或 null（不可渲染）
 */
function resolvablePolygon(pg, segKeys, findCoord) {
  const labels = pg?.points || []
  if (labels.length < 3) return null
  const coords = labels.map(l => findCoord(l))
  if (coords.some(c => !c)) return null
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i]
    const b = labels[(i + 1) % labels.length]
    if (!segKeys.has(segKey(a, b))) return null
  }
  return coords
}

/**
 * 圆弧的 SVG path d 串。数学坐标下从 from 逆时针扫到 to。
 *
 * SVG 的 y 轴向下，所以数学逆时针 = SVG 顺时针，sweep-flag 固定为 1；
 * 是否走优弧由数学坐标下 from→to 的逆时针夹角是否超过 π 决定。
 *
 * @param {object} arc - { center, from, to }，三者均为 points 里的 label
 * @param {Function} findCoord - label → { x, y, mx, my }（x/y 为 SVG 像素，mx/my 为数学坐标）
 * @param {number|null} radiusPx - 固定像素半径（角标记用）；null 表示半径 = center→from 距离
 * @returns {string|null}
 */
function arcPathD(arc, findCoord, radiusPx) {
  const c = findCoord(arc?.center)
  const a = findCoord(arc?.from)
  const b = findCoord(arc?.to)
  if (!c || !a || !b) return null

  const r = radiusPx != null ? radiusPx : Math.hypot(a.x - c.x, a.y - c.y)
  if (!(r > 0)) return null

  // 角度一律在数学坐标下算，避免 y 翻转带来的方向混淆
  const angA = Math.atan2(a.my - c.my, a.mx - c.mx)
  const angB = Math.atan2(b.my - c.my, b.mx - c.mx)
  let delta = angB - angA
  while (delta <= 0) delta += Math.PI * 2
  const largeArc = delta > Math.PI ? 1 : 0

  const start = radiusPx != null
    ? { x: c.x + r * Math.cos(angA), y: c.y - r * Math.sin(angA) }
    : a
  const end = radiusPx != null
    ? { x: c.x + r * Math.cos(angB), y: c.y - r * Math.sin(angB) }
    : b

  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} 1 ${fmt(end.x)} ${fmt(end.y)}`
}