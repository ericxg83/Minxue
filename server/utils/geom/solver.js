/**
 * 几何约束求解器（Levenberg-Marquardt，纯函数）。
 *
 * 影子模式用途：把模型给的点坐标 + 题干预束当成输入，求一组满足约束的点群。
 * - solveGeometry 解完后，用 residual.js 的闸门量「还差多少」：解后 maxNorm<=1 即几何自洽、可信任；
 *   解后虽自洽但位移 displacement 很大，说明模型原图与题设不符，需要回灌修正（后续阶段）。
 * - 不通过（解后 maxNorm>1 / 退化）则交人工复核，绝不擅自改渲染。
 *
 * 变量：所有点的 x,y 都是自由变量；同时给每个点一个弱锚（anchor）拉回模型原坐标，
 * 避免无约束自由度（整体旋转/平移）导致 LM 病态，也保住未约束点的相对位置。
 */

import { toPointMap, residualComponents, figureScale } from './residual.js'
import { dist } from './vec.js'

/** 解 n×n 线性方程组 A·x = b（高斯消元 + 部分主元），奇异返回 null */
function solveLinear(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (Math.abs(M[piv][col]) < 1e-15) return null
    if (piv !== col) { const tmp = M[piv]; M[piv] = M[col]; M[col] = tmp }
    const d = M[col][col]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / d
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  const x = new Array(n)
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i]
  return x
}

/**
 * @param {Array<{label,x,y}>|Object<string,{x,y}>} points 初始点群（模型坐标）
 * @param {Array<object>} constraints 约束数组（约束Schema 形态，带 type/args/weight/source）
 * @param {object} [options]
 * @returns {{points:object, converged:boolean, iterations:number, cost:number, perConstraint:object[], displacement:number, scale:number}}
 */
export function solveGeometry(points, constraints, options = {}) {
  const pm0 = toPointMap(points)
  const labels = Object.keys(pm0)
  const N = labels.length
  const empty = { points: pm0, converged: true, iterations: 0, cost: 0, perConstraint: [], displacement: 0, scale: 1 }
  if (N === 0) return empty

  const scale = options.scale != null ? options.scale : figureScale(pm0)
  const opts = { scale, circles: options.circles }
  const anchors = options.anchors !== false
  const anchorWeight = options.anchorWeight != null ? options.anchorWeight : 0.02
  const maxIter = options.maxIter || 300
  const tol = options.tol || 1e-10

  const init = new Array(2 * N)
  let x = new Array(2 * N)
  labels.forEach((l, i) => {
    init[2 * i] = pm0[l].x; init[2 * i + 1] = pm0[l].y
    x[2 * i] = pm0[l].x; x[2 * i + 1] = pm0[l].y
  })

  const setPm = (vec) => {
    const m = {}
    labels.forEach((l, i) => { m[l] = { x: vec[2 * i], y: vec[2 * i + 1] } })
    return m
  }

  // 构造归一化残差向量：每条分量按 sqrt(weight) 加权（soft 0.3 / hard 1）；anchor 弱拉回原坐标
  const build = (vec) => {
    const pm = setPm(vec)
    const comps = residualComponents(pm, constraints, opts)
    const r = []
    for (const c of comps) {
      const w = Math.sqrt(c.weight)
      for (const comp of c.comps) r.push(w * comp.norm)
    }
    if (anchors) {
      const aw = Math.sqrt(anchorWeight)
      for (let i = 0; i < N; i++) {
        r.push((aw * (vec[2 * i] - init[2 * i])) / scale)
        r.push((aw * (vec[2 * i + 1] - init[2 * i + 1])) / scale)
      }
    }
    return r
  }

  const costOf = (r) => { let s = 0; for (const v of r) s += v * v; return s }

  let cur = build(x)
  let curCost = costOf(cur)
  let lambda = options.lambda != null ? options.lambda : 1e-3
  let it = 0
  const h = 1e-6 * Math.max(scale, 1)

  for (; it < maxIter; it++) {
    const r = cur
    const M = r.length
    const J = Array.from({ length: M }, () => new Array(2 * N).fill(0))
    for (let j = 0; j < 2 * N; j++) {
      const xp = x.slice(); xp[j] += h
      const xm = x.slice(); xm[j] -= h
      const rp = build(xp)
      const rm = build(xm)
      const denom = 2 * h
      for (let k = 0; k < M; k++) J[k][j] = (rp[k] - rm[k]) / denom
    }
    // 法方程 (JtJ + λI) Δ = -Jt·r
    const A = Array.from({ length: 2 * N }, () => new Array(2 * N).fill(0))
    const b = new Array(2 * N).fill(0)
    for (let k = 0; k < M; k++) {
      for (let a = 0; a < 2 * N; a++) {
        b[a] -= J[k][a] * r[k]
        for (let bb = 0; bb < 2 * N; bb++) A[a][bb] += J[k][a] * J[k][bb]
      }
    }
    for (let a = 0; a < 2 * N; a++) A[a][a] += lambda
    const delta = solveLinear(A, b)
    if (!delta) break
    const xn = x.map((v, i) => v + delta[i])
    const next = build(xn)
    const nextCost = costOf(next)
    if (nextCost < curCost) {
      x = xn
      cur = next
      curCost = nextCost
      lambda = Math.max(lambda * 0.7, 1e-12)
      let dnorm = 0
      for (const d of delta) dnorm += d * d
      if (dnorm < tol) break
    } else {
      lambda *= 2
      if (lambda > 1e12) break
    }
  }

  const pm = setPm(x)
  const comps = residualComponents(pm, constraints, opts)
  const perConstraint = comps.map((c) => {
    const maxNorm = c.comps.reduce((m, x) => Math.max(m, x.norm), 0)
    return { type: c.type, key: c.key, soft: c.soft, maxNorm, pass: c.soft ? true : maxNorm <= 1 + 1e-9 }
  })
  let displacement = 0
  labels.forEach((l, i) => {
    const d = dist({ x: init[2 * i], y: init[2 * i + 1] }, { x: x[2 * i], y: x[2 * i + 1] })
    if (d > displacement) displacement = d
  })
  return {
    points: pm,
    converged: it < maxIter,
    iterations: it,
    cost: curCost,
    perConstraint,
    displacement,
    scale
  }
}
