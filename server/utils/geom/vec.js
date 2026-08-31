/**
 * 平面几何原语。约束求解器与渲染器共用的唯一一份向量/构造实现。
 *
 * 点统一表示为 { x, y }（数学坐标，y 向上为正）。所有函数为纯函数，
 * 无解时返回 null 或空数组，绝不抛异常——上层靠残差闸门判断能否出图。
 */

export const EPS = 1e-9

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k })
export const dot = (a, b) => a.x * b.x + a.y * b.y
export const cross = (a, b) => a.x * b.y - a.y * b.x
export const len = (a) => Math.hypot(a.x, a.y)
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function unit(a, b) {
  if (b === undefined) {
    const l = len(a)
    return l < EPS ? null : { x: a.x / l, y: a.y / l }
  }
  return unit(sub(b, a))
}

/** 点到无限直线 ab 的距离 */
export function pointToLineDist(p, a, b) {
  const ab = sub(b, a)
  const l = len(ab)
  if (l < EPS) return dist(p, a)
  return Math.abs(cross(ab, sub(p, a))) / l
}

/** 点到线段 ab 的距离（端点外按端点算） */
export function pointToSegmentDist(p, a, b) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  if (l2 < EPS) return dist(p, a)
  let t = dot(sub(p, a), ab) / l2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t })
}

/**
 * p 到直线 ab 的垂足。返回的 t 是垂足在 ab 上的参数（0=a，1=b），
 * 求解器靠它判断垂足是否落在线段内——跑到线段外的垂足是退化解。
 */
export function footOfPerp(p, a, b) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  if (l2 < EPS) return null
  const t = dot(sub(p, a), ab) / l2
  return { x: a.x + ab.x * t, y: a.y + ab.y * t, t }
}

/** 两条无限直线 ab、cd 的交点；平行或重合返回 null */
export function lineIntersect(a, b, c, d) {
  const r = sub(b, a)
  const s = sub(d, c)
  const den = cross(r, s)
  if (Math.abs(den) < EPS) return null
  const t = cross(sub(c, a), s) / den
  return { x: a.x + r.x * t, y: a.y + r.y * t, t }
}

/** 线段 ab 上的定比点：t=0 → a，t=1 → b */
export const divideRatio = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** ∠avb 的角平分线方向（单位向量）；两边反向时无定义，返回 null */
export function bisectorDir(v, a, b) {
  const ua = unit(v, a)
  const ub = unit(v, b)
  if (!ua || !ub) return null
  return unit(add(ua, ub))
}

/** p 关于直线 ab 的镜像点 */
export function reflectOverLine(p, a, b) {
  const f = footOfPerp(p, a, b)
  if (!f) return null
  return { x: 2 * f.x - p.x, y: 2 * f.y - p.y }
}

/** p 绕 c 旋转 deg 度（正值为逆时针，与数学坐标一致） */
export function rotateAbout(p, c, deg) {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const v = sub(p, c)
  return { x: c.x + v.x * cos - v.y * sin, y: c.y + v.x * sin + v.y * cos }
}

/** 直线 ab 与圆(center,r) 的交点：0/1/2 个，按沿 a→b 方向排序 */
export function circleLineIntersect(center, r, a, b) {
  const d = sub(b, a)
  const l2 = dot(d, d)
  if (l2 < EPS) return []
  const f = sub(a, center)
  const bq = dot(f, d)
  const c = dot(f, f) - r * r
  const disc = bq * bq - l2 * c
  if (disc < -EPS) return []
  if (disc < EPS) {
    const t = -bq / l2
    return [{ x: a.x + d.x * t, y: a.y + d.y * t, t }]
  }
  const sq = Math.sqrt(disc)
  return [(-bq - sq) / l2, (-bq + sq) / l2].map(t => ({ x: a.x + d.x * t, y: a.y + d.y * t, t }))
}

/** 两圆交点：0/1/2 个。同心或分离返回空 */
export function circleCircleIntersect(c1, r1, c2, r2) {
  const d = dist(c1, c2)
  if (d < EPS) return []
  if (d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h2 = r1 * r1 - a * a
  const h = h2 < 0 ? 0 : Math.sqrt(h2)
  const u = unit(c1, c2)
  const base = { x: c1.x + u.x * a, y: c1.y + u.y * a }
  if (h < EPS) return [base]
  const n = { x: -u.y * h, y: u.x * h }
  return [add(base, n), sub(base, n)]
}

/** 从圆外点 p 到圆(center,r) 的两个切点 */
export function tangentFromExternal(p, center, r) {
  const d = dist(p, center)
  if (d < r + EPS) return []
  return circleCircleIntersect(p, Math.sqrt(d * d - r * r), center, r)
}

export const centroid = (a, b, c) => ({ x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 })

/** 外心：三边中垂线交点 */
export function circumcenter(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < EPS) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  }
}

/** 内心：三角形内角平分线交点，按对边长加权 */
export function incenter(a, b, c) {
  const la = dist(b, c)
  const lb = dist(c, a)
  const lc = dist(a, b)
  const s = la + lb + lc
  if (s < EPS) return null
  return {
    x: (la * a.x + lb * b.x + lc * c.x) / s,
    y: (la * a.y + lb * b.y + lc * c.y) / s
  }
}

/** ∠avb 的度数（0~180） */
export function angleAt(v, a, b) {
  const ua = unit(v, a)
  const ub = unit(v, b)
  if (!ua || !ub) return null
  const c = Math.max(-1, Math.min(1, dot(ua, ub)))
  return (Math.acos(c) * 180) / Math.PI
}

/** 多边形有向面积（正=逆时针）。求解器用它的符号判断有没有把图镜像翻转 */
export function signedArea(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    s += p.x * q.y - q.x * p.y
  }
  return s / 2
}

/**
 * 求把 from 点集最优贴合到 to 点集的**保向**相似变换（旋转+等比缩放+平移，无反射）。
 *
 * 用途：精确构造出的图形只保证形状正确，朝向是任意的；用它对齐到视觉模型给的坐标，
 * 让重绘图保持与原图一致的观感。限定保向是刻意的——允许反射会把图镜像翻转，
 * 学生看到的就是一张左右颠倒的图。复数最小二乘天然只给保向解。
 *
 * @returns {{apply:(p)=>{x,y}, scale:number, rotationDeg:number} | null}
 */
export function bestSimilarity(from, to) {
  const n = Math.min(from.length, to.length)
  if (n === 0) return null
  const cf = { x: 0, y: 0 }
  const ct = { x: 0, y: 0 }
  for (let i = 0; i < n; i++) {
    cf.x += from[i].x; cf.y += from[i].y
    ct.x += to[i].x; ct.y += to[i].y
  }
  cf.x /= n; cf.y /= n; ct.x /= n; ct.y /= n

  // 复数乘子 z = Σ conj(f)·t / Σ|f|²，同时含旋转与缩放
  let re = 0
  let im = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const f = sub(from[i], cf)
    const t = sub(to[i], ct)
    re += f.x * t.x + f.y * t.y
    im += f.x * t.y - f.y * t.x
    den += f.x * f.x + f.y * f.y
  }
  if (den < EPS) return null
  const zr = re / den
  const zi = im / den
  const s = Math.hypot(zr, zi)
  if (s < EPS) return null
  return {
    scale: s,
    rotationDeg: (Math.atan2(zi, zr) * 180) / Math.PI,
    apply: (p) => {
      const v = sub(p, cf)
      return { x: ct.x + zr * v.x - zi * v.y, y: ct.y + zi * v.x + zr * v.y }
    }
  }
}



