/**
 * 几何求解的残差评估与退化检查（纯函数）。
 *
 * 残差闸门的唯一判据来源：solveGeometry 解完一组点后，逐条硬约束量化「还差多少」。
 * 长度类用相对残差（÷ 图形尺度 scale），角度类用绝对度数——两套阈值互不干扰。
 *
 * 设计原则：
 *   - 一条约束可能由多个子条件构成（foot 既要求落在线段所在直线上、又要求连线垂直），
 *     每个子条件都是独立残差分量，一起进 LM 代价向量；对外展示时合成一条摘要 item。
 *   - 软约束（polygon_shape 等）只记录不拦，永远不算 fail。
 *   - 无解/退化算子一律返回大残差而非抛异常，让闸门统一裁决。
 */

import {
  dist, dot, unit, pointToLineDist, pointToSegmentDist, footOfPerp, lineIntersect,
  angleAt, bisectorDir, reflectOverLine, rotateAbout, circumcenter, incenter,
  centroid, mid
} from './vec.js'

import { CONSTRAINT_TYPES, isHard, constraintKey } from './constraintSchema.js'

const isNum = (v) => typeof v === 'number' && isFinite(v)

/** 长度类相对残差阈值（400px 画布上 ≈1.6px，小于线宽即肉眼不可见） */
export const LEN_TOL_REL = 0.004
/** 角度类残差阈值（度） */
export const ANGLE_TOL_DEG = 0.35
/** 比例类残差阈值（无量纲） */
export const RATIO_TOL = 0.004
/** 退化判据 */
export const DEGENERACY_TOL = { minAngleDeg: 12, minSepRel: 0.04, footMargin: 0.05 }

/**
 * 把 points（数组或 {label:{x,y}} 映射）归一成 {label:{x,y}} 映射。
 */
export function toPointMap(points) {
  const pm = {}
  const arr = Array.isArray(points) ? points : Object.values(points || {})
  for (const p of arr) {
    if (p && p.label && isNum(p.x) && isNum(p.y)) pm[p.label] = { x: p.x, y: p.y }
  }
  return pm
}

/** 线段长度；端点缺失返回 null */
export function segLen(pm, ab) {
  const a = pm[ab?.[0]]
  const b = pm[ab?.[1]]
  if (!a || !b) return null
  return dist(a, b)
}

/**
 * 圆半径：优先取结构 circles 里显式给的 r；否则用同圆所有 on_circle 点到圆心的平均距离。
 * 圆半径是图形自身的量，不属于任何一条约束的残差，故单独解析。
 */
export function circleRadius(pm, constraints, circles, circleLabel) {
  const c = pm[circleLabel]
  if (!c) return null
  if (Array.isArray(circles)) {
    for (const cc of circles) {
      if (cc && isNum(cc.cx) && isNum(cc.cy) && isNum(cc.r) && (cc.label === circleLabel || cc.center === circleLabel)) {
        return cc.r
      }
    }
  }
  const pts = (constraints || []).filter(x => x.type === 'on_circle' && x.args?.circle === circleLabel)
  const ds = pts.map(x => dist(pm[x.args?.point], c)).filter(isNum)
  if (ds.length === 0) return null
  return ds.reduce((a, b) => a + b, 0) / ds.length
}
/** 线段在 pm 里的方向角（度），端点缺失返回 null */
function dirAngle(pm, ab) {
  const a = pm[ab?.[0]]
  const b = pm[ab?.[1]]
  if (!a || !b) return null
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

/** 一条约束的所有残差分量（LM 用），每一项 { residual, unit:'len'|'deg'|'ratio' } */
export function constraintResiduals(pm, c, scale, circles, all) {
  const a = c?.args || {}
  const out = []
  const lenR = (v) => out.push({ residual: v, unit: 'len' })
  const degR = (v) => out.push({ residual: v, unit: 'deg' })
  const ratioR = (v) => out.push({ residual: v, unit: 'ratio' })
  const S = Math.max(scale || 1, 1e-9)

  switch (c?.type) {
    case 'perpendicular': {
      const d1 = dirAngle(pm, a.l1)
      const d2 = dirAngle(pm, a.l2)
      if (d1 == null || d2 == null) { lenR(1 * S); break }
      const diff = Math.abs(d1 - d2) % 180
      degR(Math.abs(Math.min(diff, 180 - diff) - 90))
      break
    }
    case 'parallel': {
      const d1 = dirAngle(pm, a.l1)
      const d2 = dirAngle(pm, a.l2)
      if (d1 == null || d2 == null) { lenR(1 * S); break }
      const diff = Math.abs(d1 - d2) % 180
      degR(Math.min(diff, 180 - diff))
      break
    }
    case 'foot': {
      const p = pm[a.point]
      const from = pm[a.from]
      const [x, y] = a.onLine || []
      const L = pm[x]
      const R = pm[y]
      if (!p || !from || !L || !R) { lenR(1 * S); break }
      // 1) 垂足必须落在 onLine 上；2) from→point 必须垂直 onLine
      lenR(pointToLineDist(p, L, R))
      const lineDir = unit(L, R)
      const perpDir = unit(from, p)
      if (lineDir && perpDir) {
        degR(Math.abs(Math.acos(Math.max(-1, Math.min(1, dot(lineDir, perpDir)))) * 180 / Math.PI - 90))
      }
      break
    }
    case 'midpoint': {
      const p = pm[a.point]
      const M = a.of?.length === 2 ? mid(pm[a.of[0]], pm[a.of[1]]) : null
      if (!p || !M) { lenR(1 * S); break }
      lenR(dist(p, M))
      break
    }
    case 'on_segment': {
      const p = pm[a.point]
      const [x, y] = a.of || []
      if (!p || !pm[x] || !pm[y]) { lenR(1 * S); break }
      lenR(pointToSegmentDist(p, pm[x], pm[y]))
      break
    }
    case 'on_line': {
      const p = pm[a.point]
      const [x, y] = a.of || []
      if (!p || !pm[x] || !pm[y]) { lenR(1 * S); break }
      lenR(pointToLineDist(p, pm[x], pm[y]))
      break
    }
    case 'on_circle': {
      const p = pm[a.point]
      const ctr = pm[a.circle]
      const r = circleRadius(pm, all, circles, a.circle)
      if (!p || !ctr || r == null) { lenR(1 * S); break }
      lenR(Math.abs(dist(p, ctr) - r))
      break
    }
    case 'circle_center': {
      const p = pm[a.point]
      const ctr = pm[a.circle]
      if (!p || !ctr) { lenR(1 * S); break }
      lenR(dist(p, ctr))
      break
    }
    case 'line_intersect': {
      const p = pm[a.point]
      const [x1, y1] = a.l1 || []
      const [x2, y2] = a.l2 || []
      const hit = pm[x1] && pm[y1] && pm[x2] && pm[y2] ? lineIntersect(pm[x1], pm[y1], pm[x2], pm[y2]) : null
      if (!p || !hit) { lenR(1 * S); break }
      lenR(dist(p, hit))
      break
    }
    case 'angle_bisector': {
      const v = pm[a.of?.vertex]
      const p = pm[a.ray?.[1]] // ray:[v, p] 取第二端
      const f = pm[a.of?.from]
      const t = pm[a.of?.to]
      const bis = v && f && t ? bisectorDir(v, f, t) : null
      const dr = v && p ? unit(v, p) : null
      if (!bis || !dr) { degR(180); break }
      degR(Math.acos(Math.max(-1, Math.min(1, dot(bis, dr)))) * 180 / Math.PI)
      break
    }
    case 'reflect': {
      const p = pm[a.point]
      const src = pm[a.source]
      const [x, y] = a.axis || []
      const q = src && pm[x] && pm[y] ? reflectOverLine(src, pm[x], pm[y]) : null
      if (!p || !q) { lenR(1 * S); break }
      lenR(dist(p, q))
      break
    }
    case 'rotate': {
      const p = pm[a.point]
      const src = pm[a.source]
      const c = pm[a.center]
      const q = src && c ? rotateAbout(src, c, Number(a.deg) || 0) : null
      if (!p || !q) { lenR(1 * S); break }
      lenR(dist(p, q))
      break
    }
    case 'tangent': {
      const ctr = pm[a.circle]
      const [x, y] = a.line || []
      const r = circleRadius(pm, all, circles, a.circle)
      if (!ctr || !pm[x] || !pm[y] || r == null) { lenR(1 * S); break }
      lenR(Math.abs(pointToLineDist(ctr, pm[x], pm[y]) - r))
      break
    }
    case 'incenter':
    case 'circumcenter':
    case 'centroid': {
      const p = pm[a.point]
      const [p1, p2, p3] = (a.of || []).map(l => pm[l])
      const calc = c?.type === 'incenter' ? incenter
        : c?.type === 'circumcenter' ? circumcenter : centroid
      const q = p1 && p2 && p3 ? calc(p1, p2, p3) : null
      if (!p || !q) { lenR(1 * S); break }
      lenR(dist(p, q))
      break
    }
    case 'equal_length': {
      const lens = (a.segs || []).map(s => segLen(pm, s)).filter(isNum)
      if (lens.length < 2) { lenR(1 * S); break }
      const base = lens[0]
      lenR(Math.max(...lens.map(l => Math.abs(l - base))))
      break
    }
    case 'ratio': {
      const l1 = segLen(pm, a.segs?.[0])
      const l2 = segLen(pm, a.segs?.[1])
      const val = Number(a.value)
      if (l1 == null || l2 == null || !isNum(val) || l2 < 1e-12) { ratioR(1); break }
      ratioR(Math.abs(l1 / l2 - val))
      break
    }
    case 'angle_value': {
      const v = pm[a.vertex]
      const f = pm[a.from]
      const t = pm[a.to]
      const ang = v && f && t ? angleAt(v, f, t) : null
      if (ang == null) { degR(180); break }
      degR(Math.abs(ang - Number(a.deg)))
      break
    }
    case 'polygon_shape':
      out.push(...shapeResiduals(pm, a, S))
      break
    default:
      // 未知类型：无法量化 → 不参与残差（交给模型坐标兜底）
      break
  }
  return out
}

/** 形状类软约束的残差分量（不参与硬闸门，仅作软拉与展示）。kind: square|rhombus|equilateral|isosceles */
export function shapeResiduals(pm, a, S) {
  const out = []
  const vs = (a.vertices || []).map((l) => pm[l]).filter(Boolean)
  if (vs.length < 3) return out
  const lens = []
  for (let i = 0; i < vs.length; i++) {
    lens.push(dist(vs[i], vs[(i + 1) % vs.length]))
  }
  const pushLen = (v) => out.push({ residual: v, unit: 'len' })
  const pushDeg = (v) => out.push({ residual: v, unit: 'deg' })
  const eqSides = (idxs) => {
    const base = lens[idxs[0]]
    for (let k = 1; k < idxs.length; k++) {
      if (idxs[k] < lens.length) pushLen(Math.abs(lens[idxs[k]] - base))
    }
  }
  const rightAngles = () => {
    for (let i = 0; i < vs.length; i++) {
      const prev = vs[(i - 1 + vs.length) % vs.length]
      const cur = vs[i]
      const next = vs[(i + 1) % vs.length]
      const ang = angleAt(cur, prev, next)
      if (ang != null) pushDeg(Math.abs(ang - 90))
    }
  }
  switch (a.kind) {
    case 'square':
      if (vs.length >= 4) { eqSides([0, 1, 2, 3]); rightAngles() }
      break
    case 'rhombus':
      if (vs.length >= 4) eqSides([0, 1, 2, 3])
      break
    case 'equilateral':
      eqSides([0, 1, 2])
      break
    case 'isosceles':
      if (lens.length >= 3) pushLen(Math.abs(lens[0] - lens[2]))
      break
    default:
      break
  }
  return out
}

/** 图形尺度：包围盒对角线（下限 1），用于把长度残差折算成相对容差 */
export function figureScale(pm) {
  const pts = Object.values(pm || {})
  if (pts.length === 0) return 1
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  return Math.max(maxX - minX, maxY - minY, 1)
}

function tolFor(unit, scale) {
  const S = Math.max(scale || 1, 1e-9)
  if (unit === 'len') return LEN_TOL_REL * S
  if (unit === 'deg') return ANGLE_TOL_DEG
  if (unit === 'ratio') return RATIO_TOL
  return 1
}

export function residualComponents(pm, constraints, opts = {}) {
  const scale = opts.scale != null ? opts.scale : figureScale(pm)
  const circles = opts.circles
  const comps = []
  for (const c of (constraints || [])) {
    if (!c || !CONSTRAINT_TYPES[c.type]) continue
    const soft = !isHard(c)
    const weight = c.weight != null ? c.weight : (soft ? 0.3 : 1)
    const raws = constraintResiduals(pm, c, scale, circles, constraints)
    const items = raws.map((r) => {
      const tol = tolFor(r.unit, scale)
      const norm = tol > 0 ? r.residual / tol : Math.abs(r.residual)
      return { raw: r.residual, unit: r.unit, norm }
    })
    comps.push({ type: c.type, key: constraintKey(c), source: c.source, soft, weight, comps: items })
  }
  return comps
}

export function evaluateConstraint(pm, c, opts = {}) {
  const [comp] = residualComponents(pm, [c], opts)
  if (!comp) return { type: c?.type, soft: !isHard(c), maxNorm: Infinity, pass: false, comps: [] }
  const maxNorm = comp.comps.reduce((m, x) => Math.max(m, x.norm), 0)
  return {
    type: comp.type, key: comp.key, source: comp.source, soft: comp.soft,
    maxNorm, pass: comp.soft ? true : maxNorm <= 1 + 1e-9, comps: comp.comps
  }
}

export function evaluateResiduals(pm, constraints, opts = {}) {
  const comps = residualComponents(pm, constraints, opts)
  const items = comps.map((c) => {
    const maxNorm = c.comps.reduce((m, x) => Math.max(m, x.norm), 0)
    return { type: c.type, key: c.key, source: c.source, soft: c.soft, maxNorm, pass: c.soft ? true : maxNorm <= 1 + 1e-9 }
  })
  const failed = items.filter((i) => !i.pass)
  const maxNorm = items.reduce((m, i) => Math.max(m, i.maxNorm), 0)
  return { items, failed, maxNorm, allPass: failed.length === 0 }
}

export function checkDegeneracy(pm, constraints, opts = {}) {
  const scale = opts.scale != null ? opts.scale : figureScale(pm)
  const S = Math.max(scale, 1e-9)
  const reasons = []
  const pts = Object.values(pm || {})
  const minSep = DEGENERACY_TOL.minSepRel * S
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (dist(pts[i], pts[j]) < minSep) { reasons.push('overlap'); break }
    }
  }
  for (const c of (constraints || [])) {
    if (c?.type === 'polygon_shape') {
      const vs = (c.args?.vertices || []).map((l) => pm[l]).filter(Boolean)
      for (let i = 0; i < vs.length; i++) {
        const ang = angleAt(vs[i], vs[(i - 1 + vs.length) % vs.length], vs[(i + 1) % vs.length])
        if (ang != null && ang < DEGENERACY_TOL.minAngleDeg) reasons.push('collapsed_angle')
      }
    }
    if (c?.type === 'foot') {
      const f = pm[c.args?.from]
      const L = pm[c.args?.onLine?.[0]]
      const R = pm[c.args?.onLine?.[1]]
      if (f && L && R) {
        const t = footOfPerp(f, L, R)?.t
        if (t != null && (t < -DEGENERACY_TOL.footMargin || t > 1 + DEGENERACY_TOL.footMargin)) {
          reasons.push('foot_off_segment')
        }
      }
    }
  }
  return { degenerate: reasons.length > 0, reasons: [...new Set(reasons)] }
}

export function residualGate(pm, constraints, opts = {}) {
  const ev = evaluateResiduals(pm, constraints, opts)
  const deg = checkDegeneracy(pm, constraints, opts)
  return {
    pass: ev.allPass && !deg.degenerate,
    maxNorm: ev.maxNorm,
    items: ev.items,
    failed: ev.failed,
    degenerate: deg.degenerate,
    degenerateReasons: deg.reasons
  }
}

