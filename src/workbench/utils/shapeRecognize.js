/**
 * 手绘图形识别（2026-10-09 · 白板「画完停顿 1 秒自动拉直」）
 *
 * 用途：老师在白板上手画直线 / 三角形 / 矩形 / 多边形 / 圆后原地停顿约 1 秒，
 * DrawingCanvas 把刚收笔的那一笔交给 recognizeShape()；识别成功就把手绘点列
 * 换成理想几何的稠密点列（视觉上 = 自动拉直 / 整形），识别不出来就原样保留。
 *
 * 设计约束（阈值为什么这么定）：
 * - 只服务讲题板书里的高频几何。手写字母（0/O/D）、抛物线 / 波浪线草图、对勾、
 *   箭头、平滑的椭圆一律**不认**，宁可不变也不能把老师写的东西改坏。
 * - 输出是**稠密采样**点列（边每 ~10px 一点、圆 64 点）：DrawingCanvas 的笔迹
 *   渲染用「相邻点中点 + 二次贝塞尔」平滑（drawSegment），如果只放顶点，每个角
 *   会被渲染成横跨半条边的大圆弧；密采样既保住笔直的边，又只留 ~2px 的自然
 *   圆角，观感与手写一致。
 * - 所有点过 quantizeStrokePoint（2 位小数）：与 DrawingCanvas#pointFromEvent
 *   同一条纪律 —— 内存里的点与落盘的点必须是同一份（见 utils/strokePoint.js）。
 * - 纯函数、无 DOM：node --test 直接跑（test/shapeRecognize.test.mjs）。
 *
 * 识别流程：
 *   ① 太小（包围盒对角 < 40px）→ 不认（顿笔 / 短标记）。
 *   ② 首尾距离小（≤ max(26, 周长×13%)）视为闭合 → 圆与多边形**各自出候选**
 *      （圆：Kåsa 最小二乘拟合 + 残差 / 长宽比 / 角度覆盖三道闸；多边形：RDP
 *      提角点 + 角够尖 / 边够长 / 角点间不鼓包三道闸），再比谁的 RMS 残差更
 *      能解释这份笔迹 —— 圆要明显更优才判圆，否则优先多边形（正五/六边形
 *      本来就贴着圆，角点是更硬的证据）。
 *   ③ 开放笔迹只认直线：所有点离弦偏差 ≤ max(7, 弦长×7%)；与水平 / 垂直夹角
 *      < 7° 时吸附成精确水平 / 垂直（保持中点与长度）。
 */

// ⛔ 相对导入必须带 .js 扩展名：node --test（ESM）要求显式扩展，Vite 两种都认
import { quantizeStrokePoint } from './strokePoint.js'

// ── 阈值（调参集中在这里，改完跑 test/shapeRecognize.test.mjs）────────
const MIN_BBOX_DIAG = 40        // 包围盒对角线下限：更小当顿笔/短标记
const CLOSED_GAP_RATIO = 0.13   // 闭合判定：首尾距 ≤ max(26, 周长×此值)
const LINE_MIN_LEN = 40         // 直线最短弦长
const LINE_MAX_DEV_RATIO = 0.07 // 直线：所有点离弦 ≤ max(7, 弦长×此值)，防拉直抛物线
const AXIS_SNAP_DEG = 7         // 与水平/垂直夹角小于此度数 → 精确吸附
const CIRCLE_MIN_R = 14         // 圆最小半径
const CIRCLE_RMS_RATIO = 0.11   // 圆：拟合残差 RMS / 半径 上限
const CIRCLE_MAX_ASPECT = 1.35  // 圆：包围盒长宽比上限（防椭圆/0/O 误判）
const CIRCLE_MAX_GAP_DEG = 75   // 圆：绕心角度覆盖的最大缺口（防 3/4 弧误判）
const POLY_EPS_RATIO = 0.018    // 多边形 RDP：eps = max(7, 周长×此值)
const POLY_FLAT_DEG = 162       // 内角比这更平的「角」只是边上的点，丢弃
const POLY_MAX_CORNER_DEG = 158 // 成形后任何角不得比这更平（防波浪线误判）
const POLY_MIN_EDGE_RATIO = 0.06 // 最短边 ≥ max(12, 周长×此值)
const POLY_MAX_BOW = 1.8        // 相邻角点之间路径鼓包 ≤ max(12, eps×此值)，防椭圆/圆误判多边形
const RECT_ANGLE_TOL = 13       // 矩形判定：四角 90°±此值
const RECT_AXIS_TOL_DEG = 6     // 矩形主方向接近水平 → 吸附成轴对齐
const SAMPLE_STEP = 10          // 多边形边采样步长（板面 px）
const CIRCLE_SAMPLES = 64

const DEG = 180 / Math.PI

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) }
function pt(x, y) { return quantizeStrokePoint({ x, y }) }

function perimeterOf(pts) {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i])
  return s
}

function bboxOf(pts) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/** 点到线段 AB 的距离 */
function segDist(p, a, b) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const wx = p.x - a.x
  const wy = p.y - a.y
  const len2 = vx * vx + vy * vy
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(wx - t * vx, wy - t * vy)
}

/** 在 b 处的内角（度，0~180）。真凹角按劣角算 —— 凹多边形靠边数上限兜住 */
function angleAt(a, b, c) {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const l1 = Math.hypot(v1x, v1y)
  const l2 = Math.hypot(v2x, v2y)
  if (l1 === 0 || l2 === 0) return 180
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2)
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG
}

/** Ramer–Douglas–Peucker 简化（迭代实现，防长笔迹深递归） */
function rdp(pts, eps) {
  const n = pts.length
  if (n < 3) return pts.slice()
  const keep = new Array(n).fill(false)
  keep[0] = true
  keep[n - 1] = true
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let maxD = -1
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true
      stack.push([s, idx], [idx, e])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** 3×3 线性方程组（带列主元消元）；奇异返回 null */
function solve3(m, v) {
  const a = [
    m[0], m[1], m[2], v[0],
    m[3], m[4], m[5], v[1],
    m[6], m[7], m[8], v[2],
  ]
  for (let col = 0; col < 3; col++) {
    let piv = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r * 4 + col]) > Math.abs(a[piv * 4 + col])) piv = r
    }
    if (Math.abs(a[piv * 4 + col]) < 1e-9) return null
    if (piv !== col) {
      for (let c = 0; c < 4; c++) {
        const t = a[col * 4 + c]
        a[col * 4 + c] = a[piv * 4 + c]
        a[piv * 4 + c] = t
      }
    }
    const d = a[col * 4 + col]
    for (let c = col; c < 4; c++) a[col * 4 + c] /= d
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const f = a[r * 4 + col]
      if (f === 0) continue
      for (let c = col; c < 4; c++) a[r * 4 + c] -= f * a[col * 4 + c]
    }
  }
  return [a[3], a[7], a[11]]
}

/** Kåsa 最小二乘圆拟合： minimize Σ(x²+y²+Ax+By+C)²。返回 {x, y, r}（圆心/半径） */
function fitCircle(pts) {
  let Sx = 0
  let Sy = 0
  let Sxx = 0
  let Syy = 0
  let Sxy = 0
  let Sxz = 0
  let Syz = 0
  let Sz = 0
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y
    Sx += p.x
    Sy += p.y
    Sxx += p.x * p.x
    Syy += p.y * p.y
    Sxy += p.x * p.y
    Sxz += p.x * z
    Syz += p.y * z
    Sz += z
  }
  const sol = solve3(
    [Sxx, Sxy, Sx, Sxy, Syy, Sy, Sx, Sy, pts.length],
    [-Sxz, -Syz, -Sz],
  )
  if (!sol) return null
  const x = -sol[0] / 2
  const y = -sol[1] / 2
  const rr = x * x + y * y - sol[2]
  if (!Number.isFinite(rr) || !(rr > 0)) return null
  return { x, y, r: Math.sqrt(rr) }
}

/**
 * 识别一笔手绘笔迹。返回 null（不认，保持原样）或：
 *   { kind: 'line'|'circle'|'triangle'|'rect'|'quad'|'polygon', points: [...] }
 * points 是可直接替换 stroke.points 的稠密量化点列。
 */
export function recognizeShape(rawPoints) {
  const pts = (Array.isArray(rawPoints) ? rawPoints : [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (pts.length < 3) return null
  const bb = bboxOf(pts)
  if (Math.hypot(bb.w, bb.h) < MIN_BBOX_DIAG) return null
  const per = perimeterOf(pts)
  if (!(per > 0)) return null
  const gap = dist(pts[0], pts[pts.length - 1])
  const closed = gap <= Math.max(26, per * CLOSED_GAP_RATIO)
  return closed ? recognizeClosed(pts, bb, per) : recognizeLine(pts)
}

// ── 开放笔迹：只认直线 ────────────────────────────────────────────────
function recognizeLine(pts) {
  const A = pts[0]
  const B = pts[pts.length - 1]
  const L = dist(A, B)
  if (L < LINE_MIN_LEN) return null
  // ⛔ 用「所有点到弦的距离」而不是 RDP 残差：抛物线 / 大弧的 RDP 也可能只剩
  //    两三点，但其中间点离弦很远 —— 老师随手画的抛物线绝不能被拉成直线。
  let maxDev = 0
  for (const p of pts) {
    const d = segDist(p, A, B)
    if (d > maxDev) maxDev = d
  }
  if (maxDev > Math.max(7, L * LINE_MAX_DEV_RATIO)) return null
  // 近水平 / 垂直 → 吸附成精确水平 / 垂直（保持中点与长度）：
  // 板书里横线（等号、分数线、下划线）是最高频的「直线」，吸附后横平竖直
  let a = A
  let b = B
  const deg = Math.abs(Math.atan2(B.y - A.y, B.x - A.x)) * DEG
  if (deg < AXIS_SNAP_DEG || 180 - deg < AXIS_SNAP_DEG) {
    const my = (A.y + B.y) / 2
    a = { x: Math.min(A.x, B.x), y: my }
    b = { x: Math.max(A.x, B.x), y: my }
  } else if (Math.abs(deg - 90) < AXIS_SNAP_DEG) {
    const mx = (A.x + B.x) / 2
    a = { x: mx, y: Math.min(A.y, B.y) }
    b = { x: mx, y: Math.max(A.y, B.y) }
  }
  return { kind: 'line', points: [pt(a.x, a.y), pt(b.x, b.y)] }
}

// ── 闭合笔迹：圆与多边形各出候选，比「谁更能解释这份笔迹」─────────────
// 正五边形 / 正六边形本来就贴着圆（圆拟合残差很小），单纯「圆先试」会把
// 手绘多边形吃掉、「多边形先试」会把圆吃成六边形 —— 所以两边都先算 RMS 残差，
// 圆要明显更优（×1.4 余量）才判圆，其余优先多边形（角点是更硬的证据）。
function recognizeClosed(pts, bb, per) {
  const poly = polygonCandidate(pts, per)
  const circ = circleCandidate(pts, bb)
  if (poly && circ) {
    return circ.rms * 1.4 < poly.rms ? circleResult(circ) : polyResult(poly)
  }
  if (poly) return polyResult(poly)
  if (circ) return circleResult(circ)
  return null
}

/** 圆候选：过长宽比 / 拟合残差 / 角度覆盖三道闸，返回圆心半径与残差 */
function circleCandidate(pts, bb) {
  if (bb.w <= 0 || bb.h <= 0) return null
  const aspect = Math.max(bb.w, bb.h) / Math.min(bb.w, bb.h)
  if (aspect > CIRCLE_MAX_ASPECT) return null
  const fit = fitCircle(pts)
  if (!fit || fit.r < CIRCLE_MIN_R) return null
  // 残差闸：椭圆 / 圆角方 / 字母 0 的圆拟合残差明显偏大。
  // ⛔ 用 !(x <= tol) 而不是 x > tol：NaN（异常数据）也必须被拒
  let sum2 = 0
  let mean = 0
  for (const p of pts) {
    const d = dist(p, fit)
    mean += d
    sum2 += (d - fit.r) * (d - fit.r)
  }
  mean /= pts.length
  const rms = Math.sqrt(sum2 / pts.length)
  if (!(rms / fit.r <= CIRCLE_RMS_RATIO)) return null
  // 覆盖闸：点列绕圆心的角度缺口太大 = 其实是一段弧（3/4 圆、C 形）
  const angs = pts.map((p) => Math.atan2(p.y - fit.y, p.x - fit.x)).sort((a, b) => a - b)
  let maxGap = 2 * Math.PI - (angs[angs.length - 1] - angs[0])
  for (let i = 1; i < angs.length; i++) maxGap = Math.max(maxGap, angs[i] - angs[i - 1])
  if (!(maxGap * DEG <= CIRCLE_MAX_GAP_DEG)) return null
  return { x: fit.x, y: fit.y, r: mean, rms }
}

function circleResult(c) {
  const points = []
  for (let i = 0; i < CIRCLE_SAMPLES; i++) {
    const t = (i / CIRCLE_SAMPLES) * 2 * Math.PI
    points.push(pt(c.x + c.r * Math.cos(t), c.y + c.r * Math.sin(t)))
  }
  // 笔迹按开放折线渲染：显式补回首点把圆封口
  points.push(pt(points[0].x, points[0].y))
  return { kind: 'circle', points }
}

/** 多边形候选：RDP 提角点 + 角够尖 / 边够长 / 角点间不鼓包三道闸，返回角点与残差 */
function polygonCandidate(pts, per) {
  const eps = Math.max(7, per * POLY_EPS_RATIO)
  const loop = pts.concat([pts[0]])
  const simp = rdp(loop, eps)
  // 闭合环的首尾是同一点：去掉重复尾点得到环序角点
  let corners = simp.slice(0, Math.max(1, simp.length - 1))
  corners = dropFlatCorners(corners)
  const n = corners.length
  if (n < 3 || n > 6) return null
  // 角要够尖、边要够长
  const minEdge = Math.max(12, per * POLY_MIN_EDGE_RATIO)
  for (let i = 0; i < n; i++) {
    const a = corners[(i - 1 + n) % n]
    const b = corners[i]
    const c = corners[(i + 1) % n]
    if (angleAt(a, b, c) > POLY_MAX_CORNER_DEG) return null
    if (dist(b, c) < minEdge) return null
  }
  // 鼓包闸：真多边形在相邻角点之间基本贴着直边走；圆角方 / 圆拟合失败后的
  // 圆滑形状在角点之间会大幅外鼓 —— 多边形误判的最后一道防线
  const bowTol = Math.max(12, eps * POLY_MAX_BOW)
  if (maxPathDeviation(pts, corners) > bowTol) return null
  return { corners, rms: rmsToPolyPath(pts, corners) }
}

function polyResult(poly) {
  const { corners } = poly
  const n = corners.length
  if (n === 4) {
    const angs = corners.map((b, i) => angleAt(corners[(i + 3) % 4], b, corners[(i + 1) % 4]))
    if (angs.every((ang) => Math.abs(ang - 90) <= RECT_ANGLE_TOL)) {
      return { kind: 'rect', points: densifyClosed(rectVertices(corners)) }
    }
    return { kind: 'quad', points: densifyClosed(corners) }
  }
  return { kind: n === 3 ? 'triangle' : 'polygon', points: densifyClosed(corners) }
}

/** 点集到「角点连成的多边形路径」的 RMS 距离（候选间比较用） */
function rmsToPolyPath(pts, corners) {
  let sum = 0
  const n = corners.length
  for (const p of pts) {
    let best = Infinity
    for (let i = 0; i < n; i++) best = Math.min(best, segDist(p, corners[i], corners[(i + 1) % n]))
    sum += best * best
  }
  return Math.sqrt(sum / pts.length)
}

/** 迭代丢弃「几乎是直线」的角点（笔画起点落在边中间时 RDP 会多留一个假角） */
function dropFlatCorners(cs) {
  const arr = cs.slice()
  while (arr.length > 3) {
    let worst = -1
    let worstAng = -1
    for (let i = 0; i < arr.length; i++) {
      const ang = angleAt(arr[(i - 1 + arr.length) % arr.length], arr[i], arr[(i + 1) % arr.length])
      if (ang > worstAng) { worstAng = ang; worst = i }
    }
    if (worstAng <= POLY_FLAT_DEG) break
    arr.splice(worst, 1)
  }
  return arr
}

/** 原始点集到「角点连成的多边形路径」的最大距离 */
function maxPathDeviation(pts, corners) {
  let maxD = 0
  const n = corners.length
  for (const p of pts) {
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const d = segDist(p, corners[i], corners[(i + 1) % n])
      if (d < best) best = d
    }
    if (best > maxD) maxD = best
  }
  return maxD
}

/**
 * 由 4 个角点构造精确矩形：
 * - 主方向接近水平 → 直接取轴对齐包围盒（老师画的水平/垂直矩形严格对齐横竖）；
 * - 斜矩形 → 转到主方向坐标系取正包围盒再转回去（四角精确 90°、对边相等）。
 */
function rectVertices(cs) {
  let bestLen = -1
  let theta = 0
  for (let i = 0; i < 4; i++) {
    const a = cs[i]
    const b = cs[(i + 1) % 4]
    const l = dist(a, b)
    if (l > bestLen) { bestLen = l; theta = Math.atan2(b.y - a.y, b.x - a.x) }
  }
  // 矩形对 90° 旋转对称：主方向归一到 [-45°, 45°)
  theta %= Math.PI / 2
  if (theta > Math.PI / 4) theta -= Math.PI / 2
  if (theta < -Math.PI / 4) theta += Math.PI / 2
  if (Math.abs(theta) * DEG <= RECT_AXIS_TOL_DEG) {
    const bb = bboxOf(cs)
    return [
      { x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY },
      { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY },
    ]
  }
  const cos = Math.cos(-theta)
  const sin = Math.sin(-theta)
  const rot = cs.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }))
  const bb = bboxOf(rot)
  const local = [
    { x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY },
    { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY },
  ]
  const cos2 = Math.cos(theta)
  const sin2 = Math.sin(theta)
  return local.map((p) => ({ x: p.x * cos2 - p.y * sin2, y: p.x * sin2 + p.y * cos2 }))
}

/** 顶点序列 → 沿边每 ~SAMPLE_STEP 一点的稠密闭合折线（首尾同点封口） */
function densifyClosed(vs) {
  const out = [pt(vs[0].x, vs[0].y)]
  const n = vs.length
  for (let i = 0; i < n; i++) {
    const a = vs[i]
    const b = vs[(i + 1) % n]
    if (i > 0) out.push(pt(a.x, a.y))
    const L = dist(a, b)
    const k = Math.max(1, Math.round(L / SAMPLE_STEP))
    for (let s = 1; s < k; s++) {
      const t = s / k
      out.push(pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
    }
  }
  out.push(pt(vs[0].x, vs[0].y))
  return out
}
