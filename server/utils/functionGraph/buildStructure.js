/**
 * 函数图象规格 → 几何结构（含 curves 采样点）。
 *
 * 输出的是与视觉模型完全相同的结构格式，因此可以直接复用
 * renderGeometrySvg / 存储链路 / 前端展示，不需要另建一套渲染。
 *
 * 视野计算：以顶点、坐标轴交点、题干点名点为锚点定出 x 范围，
 * 再收紧到"曲线完全落在 y 窗口内"，避免抛物线冲出画面把图形压扁。
 */

const SAMPLE_COUNT = 81 // 取奇数，保证顶点本身是采样点

/** 抛物线顶点式采样：y = a(x-h)² + k */
export function sampleParabola(a, h, k, xLo, xHi, count = SAMPLE_COUNT) {
  const pts = []
  if (!(xHi > xLo) || count < 2) return pts
  const step = (xHi - xLo) / (count - 1)
  for (let i = 0; i < count; i++) {
    const x = i === count - 1 ? xHi : xLo + step * i
    pts.push([x, a * (x - h) * (x - h) + k])
  }
  return pts
}

/** 与 x 轴的交点横坐标（实根才返回；无实根返回空数组） */
export function xInterceptsOf(a, h, k) {
  if (a === 0) return []
  const disc = -k / a
  if (disc < 0) return []
  if (disc === 0) return [h]
  const r = Math.sqrt(disc)
  return [h - r, h + r]
}

/**
 * 计算视野与采样点。
 *
 * 两个必须守住的约束：
 *   1. **窗口关于顶点对称**。抛物线两翼必须都看得见 —— 只画出一半会让学生
 *      以为图错了，比不出图更糟。
 *   2. **y 跨度不能失控**。抛物线的 y 跨度随 x 窗口平方增长，
 *      窗口开太大图形会被压成一条细线，所以按 |a| 反比设一个上限。
 *
 * 注意：结构里始终带原点 O(0,0)，而渲染器用「所有点 ∪ 曲线采样点」算包围盒，
 * 因此 x=0 / y=0 一定会进画面。这里把 |h| 纳入 half 就是为了让这件事
 * 不破坏对称性。
 *
 * @returns {{ points: Array, curves: Array }}
 */
export function computeView(spec) {
  const h = spec.vertex.x
  const k = spec.vertex.y
  const a = spec.a
  if (!(Math.abs(a) > 0)) return { points: [], curves: [] }

  const named = Array.isArray(spec.curvePoints) ? spec.curvePoints : []
  const roots = xInterceptsOf(a, h, k)

  // ── x 窗口 ──
  const interesting = [0, ...roots, ...named.map(p => p.x)]
  const base = Math.max(1, ...interesting.map(x => Math.abs(x - h))) * 1.25
  const cap = 8 / Math.abs(a) // y 跨度上限 ≈ 8 倍 x 跨度
  let half = Math.max(base, Math.abs(h))
  half = Math.min(half, Math.max(cap, base))

  const xLo = h - half
  const xHi = h + half
  const curve = sampleParabola(a, h, k, xLo, xHi)

  // ── y 窗口 ──
  const ys = curve.map(p => p[1]).concat(named.map(p => p.y))
  let yLo = Math.min(...ys)
  let yHi = Math.max(...ys)
  // x 轴离得不远就纳进来（教材里的抛物线图基本都带 x 轴）
  const ySpan0 = Math.max(yHi - yLo, 1e-6)
  if (0 >= yLo - 2 * ySpan0 && 0 <= yHi + 2 * ySpan0) { yLo = Math.min(yLo, 0); yHi = Math.max(yHi, 0) }
  const yPad = Math.max((yHi - yLo) * 0.12, 0.2)
  yLo -= yPad
  yHi += yPad

  // 点：原点（保证坐标轴有正确的锚点）+ 落在视野内的题干点名点
  const points = [{ label: 'O', x: 0, y: 0, type: 'origin' }]
  const tolX = (xHi - xLo) * 0.1
  const tolY = (yHi - yLo) * 0.1
  for (const p of named) {
    if (p.label === 'O') continue
    if (p.x < xLo - tolX || p.x > xHi + tolX) continue
    if (p.y < yLo - tolY || p.y > yHi + tolY) continue
    points.push({ label: p.label, x: p.x, y: p.y, type: 'vertex' })
  }

  // ⭐ x 轴交点标注：题干写了「与x轴交于A、B两点」时，把实根按 x 升序
  // 与字母一一配对（数学约定：左边的根 = 题干第一个字母）。
  // 此前这组根只用于视野计算，从不落成带字母的点 —— 用户实测（顶点(1,4)
  // 抛物线题）图上缺 A、B 两个交点。只有 roots 数量与字母数一致才配对，
  // 避免相切（单根）或题干字母数不符时错误标注。
  const il = Array.isArray(spec.xInterceptLabels) ? spec.xInterceptLabels : null
  if (il && il.length === 2 && roots.length === 2 && roots[0] !== roots[1]) {
    const sortedRoots = [...roots].sort((x, y) => x - y)
    for (let i = 0; i < 2; i++) {
      const x = sortedRoots[i]
      // 交点必然在 x 轴上（y=0），也在视野内（roots 本就参与窗口计算）
      points.push({ label: il[i], x, y: 0, type: 'vertex' })
    }
  }

  // ⭐ 曲线上符号点标注：题干写「点X(m,n)是抛物线上一点」时，X 在曲线上但
  // 坐标是符号（m/n 的值在后续小问才给定）。给一个**贴合教材惯例的示意位置**：
  //   右支上、顶点与右根之间的中段（开口向下时视觉上"顶点右侧中上部"，
  //   与教科书配图的动点位置一致 —— 用户实测对比原图 D 就在该区域）。
  // 只做示意：坐标由表达式算出保证**真的在曲线上**，不目测。
  // 多个符号点时错开（依次右移），避免叠在一起。
  const sym = Array.isArray(spec.symbolicCurveLabels) ? spec.symbolicCurveLabels : []
  if (sym.length > 0) {
    const already = new Set(points.map(p => p.label))
    const rightRoot = roots.length > 0 ? Math.max(...roots) : (h + half)
    // 示意 x：顶点与右根之间的 55% 处（靠右中段），多个点依次 +0.4
    for (let i = 0; i < sym.length; i++) {
      const label = sym[i]
      if (already.has(label)) continue // 若已有同名带坐标点，跳过（坐标版优先）
      const xs = h + (rightRoot - h) * 0.55 + i * 0.4
      const ys2 = a * (xs - h) * (xs - h) + k // 确保在曲线上
      points.push({ label, x: xs, y: ys2, type: 'vertex' })
    }
  }

  return { points, curves: [{ points: curve, style: 'solid' }] }
}

/**
 * 规格 → 完整几何结构。
 * @param {object} spec - parseFunctionGraphSpec 的返回值
 * @returns {object} 可直接交给 renderGeometrySvg 的结构
 */
export function specToGeometryStructure(spec) {
  const { points, curves } = computeView(spec)
  return {
    figure_type: 'coordinate',
    points,
    segments: [],
    circles: [],
    polygons: [],
    arcs: [],
    angleMarks: [],
    curves,
    labels: [],
    rightAngles: [],
    coordinate_system: { exists: true, origin: 'O', x_axis: true, y_axis: true },
    constraints: [],
    // 溯源信息：便于人工核对这张图是从哪句题干推出来的
    _source: {
      channel: 'function_graph_deterministic',
      expression: spec.expression,
      opens: spec.opens,
      vertex: spec.vertex,
      axisOfSymmetry: spec.axisOfSymmetry ?? null,
      approximate: !!spec.approximate,
      solvedFrom: spec.solvedFrom
    }
  }
}
