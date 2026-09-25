/**
 * 几何结构 JSON 的解析与规范化。SVG 渲染器、TikZ 渲染器、约束求解器共用这一份。
 *
 * 历史上 geometrySvg.js 与 geometryTikZ.js 各有一份 normalizeStructure，已经漂移：
 * TikZ 版支持 points[].name 别名但漏了 labels 的符号过滤，于是手写数字会画进 TikZ。
 * 这里取两者并集——保留 name 兼容，同时统一执行符号过滤。
 *
 * 坐标约定：模型输出数学平面坐标（y 向上为正），渲染器各自负责翻转。
 * 兼容两种点格式：扁平 { x, y } 与嵌套 { position: { x, y } }。
 */

const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * 是否为可保留的符号型标注（α、β、l 这类角名/线名）。
 *
 * 数字、长度、角度值一律剔除：学生习惯把已知条件和算出的答案手写在图旁，
 * 视觉模型会把这些手写当成图形标注抄进 labels，重绘成整齐字体后
 * 学生答案会伪装成题设。遵循"宁愿少显示，也不显示错误信息"。
 */
export function isSymbolLabel(text) {
  const t = String(text ?? '').trim()
  if (!t || t.length > 4) return false
  if (/[0-9０-９]/.test(t)) return false
  if (/[√°′″π]/.test(t)) return false
  if (/[一-鿿]/.test(t)) return false
  // 2026-09-19：含下划线的一律拦——视觉模型占位符命名（pt_a、arr_u、top_b、
  // T_n2_b、Axis_start 类）几乎必然带下划线，而真实数学标注（A、AB、∠A）不会。
  if (/[_]/.test(t)) return false
  return /^[A-Za-zα-ωΑ-Ω]/.test(t)
}

/**
 * 是否为「可上屏的顶点标注」——数学符号类名字（2026-09-19 新增）。
 *
 * 与 isSymbolLabel 的区别：这是渲染层的最后一道防线，判断"这个对象的名字
 * 看起来像数学符号、可以直接画在顶点旁边"。视觉模型生成 DSL 时常用
 * 占位符/变量名当对象名（pt_a、arr_u、Axis_start、T1_b、T_n2_b、P_left…），
 * 这些绝不能直接渲染成图上标注。
 *
 * 规则（宽松但能拦掉占位符）：
 * - 单个字母（A/B/C、a/b/c、O、M、x、y、α、β…），可带撇号/下标（A'、B₁、O₂）
 * - 单个数字（0、1、2…）或 -数字（数轴刻度）
 * - 单个字母+单个数字（x₁、B₂ 等教材常见下标标注；不允许字母前缀如 T1_b）
 * - ⚠️ 半角数字后缀（P1/P0/X1/k1/B8）是模型给内部构造点的编号名，原卷几乎
 *   不出现，一律拦（2026-09-20 平行线分线段题 P1~P6 冒名标注事故）
 * - 长度超 5、含下划线、含中文、含英文单词（Axis/Point/Start/Bottom…）一律拦
 */
export function isVertexSymbolLabel(text) {
  const t = String(text ?? '').trim()
  if (!t || t.length > 5) return false
  if (/[一-鿿]/.test(t)) return false
  if (/[_]/.test(t)) return false
  // 数轴刻度数字（可带负号）：-2、0、1、2
  if (/^-?\d{1,3}$/.test(t)) return true
  // 单字母（含希腊字母）可带撇号：A、A'、B′、O、M、x、α
  if (/^[A-Za-zα-ωΑ-Ω]['′]?$/.test(t)) return true
  // 字母+Unicode 下标：A₁、B₂、x₀（教材下标标注；**半角数字 P1/X1/k1 是
  // 构造点编号，不放行**——2026-09-20 P1~P6 冒名标注事故的根因）
  if (/^[A-Za-zα-ωΑ-Ω]['′]?[₀₁₂₃₄₅₆₇₈₉]{1,2}$/.test(t)) return true
  // ∠ 开头的角名（≤5 字符内）：∠A、∠α、∠ABC 会因长度拦掉，∠A/∠α 放行
  if (/^∠[A-Za-zα-ωΑ-Ω]['′]?$/.test(t)) return true
  return false
}

/**
 * 是否为「内部辅助点」——名字以 `_` 开头（2026-09-19 新增）。
 *
 * 这是 prompt 规则 11（reactLoop.js）与渲染器之间的契约：模型画曲线/阴影/网格时
 * 必须用到一些位置点，但题面并不标注它们。这类点统一用 `_` 前缀命名，渲染器
 * **既不画文字标注、也不画顶点圆点**，只让它们参与几何计算（连线/多边形/采样）。
 *
 * 为什么圆点也要藏：曲线的采样点、网格交点动辄几十个，画成实心圆点会让图变成
 * "一片黑点"，与原图完全不同（2026-09-19 换用 gemini-3.7-flash 后实测到的现象）。
 */
export function isAuxPointLabel(text) {
  return String(text ?? '').trim().startsWith('_')
}

/**
 * 归一化图形类型。
 * A 坐标/函数图 → 'coordinate'；B 纯几何示意图 → 'geometry'；C 带坐标背景的几何图 → 'geometry_with_coords'。
 * 模型未给出 figure_type 时按坐标系存在性回退：有坐标轴 → coordinate，否则 → geometry。
 */
export function normalizeFigureType(raw, cs) {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (t === 'coordinate' || t === 'function' || t === 'a') return 'coordinate'
  if (t === 'geometry' || t === 'b') return 'geometry'
  if (t === 'geometry_with_coords' || t === 'geometry_with_coordinates' || t === 'c') return 'geometry_with_coords'
  return cs && cs.exists ? 'coordinate' : 'geometry'
}

export function normalizeStructure(obj) {
  let points = Array.isArray(obj?.points) ? obj.points : []
  points = points.map(p => {
    if (p == null) return null
    const label = p.label ?? p.name ?? ''
    const base = { label, type: p.type || 'vertex' }
    const derived = p.derived && typeof p.derived === 'object' ? { derived: p.derived } : {}
    if (p.position && isNum(p.position.x) && isNum(p.position.y)) {
      return { ...base, x: p.position.x, y: p.position.y, ...derived }
    }
    if (isNum(p.x) && isNum(p.y)) {
      return { ...base, x: p.x, y: p.y, ...derived }
    }
    return null
  }).filter(Boolean)

  let segments = Array.isArray(obj?.segments) ? obj.segments : []
  segments = segments.map(seg => {
    if (seg == null) return null
    return {
      from: seg.from ?? seg.start ?? '',
      to: seg.to ?? seg.end ?? '',
      style: seg.style || 'solid',
      relation: seg.relation || 'normal',
      // 直线模式：渲染时沿两端各延长一截，画成穿过两点的直线（如平行线 l₁/l₂/l₃）
      extend: !!(seg.extend || seg.type === 'line')
    }
  }).filter(s => s.from && s.to)

  const rawCs = obj?.coordinate_system && typeof obj.coordinate_system === 'object'
    ? {
        exists: !!obj.coordinate_system.exists,
        origin: obj.coordinate_system.origin || '',
        x_axis: !!obj.coordinate_system.x_axis,
        y_axis: !!obj.coordinate_system.y_axis
      }
    : { exists: false, origin: '', x_axis: false, y_axis: false }
  const figure_type = normalizeFigureType(obj?.figure_type, rawCs)
  // 服务端硬性保护：纯几何示意图（类型 B）绝不绘制坐标轴，
  // 即使模型误判 coordinate_system.exists=true 也强制关闭，避免给几何题凭空加坐标系。
  const coordinate_system = figure_type === 'geometry'
    ? { exists: false, origin: '', x_axis: false, y_axis: false }
    : rawCs

  // ── 多边形（2026-09-18）──
  // 顶点必须是 points 里已存在的 label；少于 3 个顶点不成多边形，直接丢弃。
  // fill=true 表示这是阴影区域（教材里"求阴影部分面积"的灰底多边形）。
  let polygons = Array.isArray(obj?.polygons) ? obj.polygons : []
  polygons = polygons.map(pg => {
    if (pg == null) return null
    const raw = Array.isArray(pg.points) ? pg.points
      : Array.isArray(pg.vertices) ? pg.vertices : []
    const labels = raw.map(l => String(l ?? '').trim()).filter(Boolean)
    if (labels.length < 3) return null
    return {
      points: labels,
      style: pg.style || 'solid',
      fill: !!pg.fill
    }
  }).filter(Boolean)

  // ── 圆弧（2026-09-18）──
  // center / from / to 都是 points 里的 label。半径由 center→from 的距离决定，
  // 数学坐标下从 from 逆时针扫到 to（渲染器各自负责翻转 y）。
  let arcs = Array.isArray(obj?.arcs) ? obj.arcs : []
  arcs = arcs.map(a => {
    if (a == null) return null
    return {
      center: a.center ?? a.cx ?? '',
      from: a.from ?? a.start ?? '',
      to: a.to ?? a.end ?? '',
      style: a.style || 'solid',
      arrow: !!a.arrow
    }
  }).filter(a => a.center && a.from && a.to)

  // ── 角标记（2026-09-18）──
  // 顶点 vertex 处、夹在 vertex→from 与 vertex→to 两条射线之间的小圆弧。
  let angleMarks = Array.isArray(obj?.angleMarks) ? obj.angleMarks : []
  angleMarks = angleMarks.map(m => {
    if (m == null) return null
    return {
      vertex: m.vertex ?? '',
      from: m.from ?? '',
      to: m.to ?? '',
      style: m.style || 'solid'
    }
  }).filter(m => m.vertex && m.from && m.to)

  // ── 曲线（2026-09-18）──
  // 采样点折线，用于函数图象通道。points 是原始数学坐标对 [[x,y],...]，
  // 不引用 label（曲线是确定性生成的，不需要走内容闸门）。
  let curves = Array.isArray(obj?.curves) ? obj.curves : []
  curves = curves.map(c => {
    if (c == null) return null
    const raw = Array.isArray(c.points) ? c.points : []
    const pts = raw
      .map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])]
        : (p && isNum(p.x) && isNum(p.y)) ? [p.x, p.y] : null)
      .filter(p => p && isFinite(p[0]) && isFinite(p[1]))
    if (pts.length < 2) return null
    const out = { points: pts, style: c.style || 'solid' }
    // 断点下标（DSL curve 命令采样跳过无定义点时记录）——渲染端据此分成多段
    if (Array.isArray(c.breaks)) {
      const b = c.breaks.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < pts.length)
      if (b.length) out.breaks = b
    }
    return out
  }).filter(Boolean)

  // ── 折线兜底（2026-09-19 三修）──
  // 模型偶尔会用「辅助点密采样 + segment 直连」手搓函数图象（抛物线画成折线）。
  // 这里在结构层确定性识别并转成曲线，两个渲染器都自动平滑，不必重跑模型。
  const mergedCurves = mergeSampledCurveChains(points, segments, curves)
  segments = mergedCurves.segments
  curves = mergedCurves.curves

  // ── 刻度线形态兜底（2026-09-20 五修）──
  // 数轴的刻度小竖线按原卷（教材扫描件）画法是：**站在数轴上、朝上伸出一小截，不穿过轴**，
  // 数字写在轴下方。老师 2026-09-20 的原话："这个才是对的！请注意，不穿过 X 轴。"
  // （同日四修曾误判为"以轴为中线、上下等长"，那是只凭老师文字描述、没核对原卷造成的；
  //  核对原卷 5cac1e12 / 1cb0d196 / 2bd35d49 三张后纠正。）
  // 这里在结构层确定性把「穿轴 / 挂错侧 / 上下不对称」的刻度线归一到原卷画法，不重跑模型。
  const ticked = normalizeTickMarks(points, segments)
  points = ticked.points
  segments = ticked.segments

  // ── 双通道去重（2026-09-20）──
  // 模型偶尔把同一符号同时写进 points[]（顶点标注通道）与 labels[]（文字通道），
  // 两条通道各渲染一次 ⇒ 图上同一字母出现两遍（9c679f37 的 O 完全重叠）。
  // 顶点标注通道承载几何（圆点+字母），labels 里的同名条目是冗余，删之。
  let labels = Array.isArray(obj?.geometry_labels) ? obj.geometry_labels
    : Array.isArray(obj?.labels) ? obj.labels : []
  const vtxLabels = new Set(points.map(p => p?.label).filter(l => l && !isAuxPointLabel(l) && !isTickNumberLabel(l)))
  if (vtxLabels.size) {
    labels = labels.filter(l => !(l?.text && vtxLabels.has(String(l.text).trim())))
  }
  labels = labels.filter(l => isSymbolLabel(l?.text))

  return {
    points,
    segments,
    circles: Array.isArray(obj?.circles) ? obj.circles : [],
    polygons,
    arcs,
    angleMarks,
    curves,
    // 优先用分类后的 geometry_labels；旧结构无该字段时回退到 labels（向后兼容已渲染的题）
    labels,
    rightAngles: Array.isArray(obj?.rightAngles) ? obj.rightAngles : [],
    figure_type,
    coordinate_system,
    constraints: Array.isArray(obj?.constraints) ? obj.constraints : [],
  }
}

/**
 * 从模型返回的文本中解析出几何结构 JSON。
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

/** 模型未识别到任何几何元素——该题本就没有可重画的配图，不该重试 */
export function isRawEmptyStructure(s) {
  if (!s) return true
  return (
    (s.points?.length || 0) === 0 &&
    (s.segments?.length || 0) === 0 &&
    (s.circles?.length || 0) === 0 &&
    (s.polygons?.length || 0) === 0 &&
    (s.arcs?.length || 0) === 0 &&
    (s.angleMarks?.length || 0) === 0 &&
    (s.curves?.length || 0) === 0
  )
}

/**
 * 是否存在可渲染元素。
 * 线段两端必须能在 points 里定位，否则画出来就是一条指向虚空的红线。
 */
export function isEmptyStructure(s) {
  if (!s) return true
  const pts = (s.points || []).filter(p => p && isNum(p.x) && isNum(p.y))
  const named = new Set(pts.map(p => p.label).filter(Boolean))
  const segs = (s.segments || []).filter(g => named.has(g?.from) && named.has(g?.to))
  const circles = (s.circles || []).filter(c => isNum(c?.cx) && isNum(c?.cy) && isNum(c?.r))
  // 多边形/圆弧/角标记的顶点也必须全部能在 points 里定位，否则同样画不出来
  const polygons = (s.polygons || []).filter(pg => (pg?.points || []).every(l => named.has(l)))
  const arcs = (s.arcs || []).filter(a => named.has(a?.center) && named.has(a?.from) && named.has(a?.to))
  const angleMarks = (s.angleMarks || []).filter(
    m => named.has(m?.vertex) && named.has(m?.from) && named.has(m?.to)
  )
  const curves = (s.curves || []).filter(c => (c?.points || []).length >= 2)
  return (
    pts.length === 0 && segs.length === 0 && circles.length === 0 &&
    polygons.length === 0 && arcs.length === 0 && angleMarks.length === 0 &&
    curves.length === 0
  )
}

/**
 * 刻度数字标签：纯数字（可带负号/小数），如 `0`、`1`、`-2`、`1.5`。
 *
 * 为什么要单独识别（2026-09-19）：数轴/坐标轴的刻度数字是**文字刻度**，
 * 模型用 `point` 承载它的坐标只是为了定位，不是真有一个顶点在那里。
 * 渲染成实体圆点后，数字旁边多一个小黑点，视觉上就和轴线糊在一起
 * （老师原话："数字全跑到数轴上去了"）。原卷的刻度数字下面从来没有点。
 */
export function isTickNumberLabel(text) {
  const t = String(text ?? '').trim().replace(/[−–—]/g, '-')
  return /^-?[0-9]+(\.[0-9]+)?$/.test(t)
}

/**
 * 检测「水平数轴」（2026-09-19 新增）。
 *
 * 为什么需要：数轴上的数值标注（a、b、c、-2、0、1…）在 DSL 里只能用 `point`
 * 承载坐标——命令集没有"只画文字"的等价物。但渲染器对带 label 的 point 一律
 * 按几何顶点处理：画实心圆点 + 用 labelOffset 按"远离所有点质心"的方向摆字母。
 * 数轴题的点**全部共线**，质心方向退化成水平线，于是字母被推散到左右两侧，
 * 落在质心正上方的那个（刻度 0）还会被垂直推得最远（实测 35px vs 其他 21px）；
 * 而圆点忠实画在模型写的标签坐标上——模型为了把文字放到轴下方，把 y 写成 -9，
 * 圆点就跟着浮到轴下方 15px。
 *
 * 老师原话："字母太下面了，而且这个小圆点应该是在数轴上。"
 *
 * 判据必须同时成立（避免把三角形的水平底边、扁矩形、坐标轴网格误判为数轴）：
 *   1. 存在一条近水平的线段作轴线（长度 ≥ 图形 x 跨度的一半）；
 *   2. 至少 2 条「近竖直、长度 ≤ 轴长 20%、**y 区间跨过轴线**」的短线段 = 刻度线。
 *      跨过而非"贴在一侧"：教材两种画法都有（刻度在轴上方一小段，或穿过轴的短线）；
 *   3. 这些刻度线的**两个端点都是 `_` 前缀的辅助点**（本项目契约：内部构造点必须
 *      用 `_` 命名）。几何图形的边由真顶点（A、B…）构成，因此天然被排除；
 *   4. 不是真坐标系（`coordinate_system.exists` 为真，或存在一条竖直的长线段当 y 轴）。
 *      直角坐标系有专门的渲染通道，数轴的"标签吸附到轴"绝不能作用在它上面。
 *
 * @param {Array} points - 已归一化的点（{label,x,y}）
 * @param {Array} segments - 已归一化的线段（{from,to}）
 * @param {{ coordinateSystem?: boolean }} [opts]
 * @returns {{ y:number, x0:number, x1:number, len:number }|null} 轴线所在 y 与水平区间
 */
export function detectNumberAxis(points, segments, opts = {}) {
  if (opts && opts.coordinateSystem) return null
  const pts = (Array.isArray(points) ? points : []).filter(p => p && isNum(p.x) && isNum(p.y))
  const pmap = {}
  for (const p of pts) if (p.label) pmap[p.label] = p
  const segs = Array.isArray(segments) ? segments : []
  if (pts.length === 0 || segs.length === 0) return null

  const xs = pts.map(p => p.x)
  const spanX = Math.max(...xs) - Math.min(...xs) || 1
  const tol = spanX * 0.002 // 相对容差：容忍模型手写的轻微歪斜

  // 候选刻度线：近竖直、两端都是 `_` 辅助点、长度 ≤ 轴长 20%
  const verticals = []
  for (const g of segs) {
    const a = pmap[g.from]
    const b = pmap[g.to]
    if (!a || !b) continue
    if (!isAuxPointLabel(g.from) || !isAuxPointLabel(g.to)) continue
    if (Math.abs(a.x - b.x) > tol) continue
    const h = Math.abs(a.y - b.y)
    if (h <= tol) continue
    verticals.push({ x: a.x, loY: Math.min(a.y, b.y), hiY: Math.max(a.y, b.y), h })
  }
  if (verticals.length < 2) return null

  for (const g of segs) {
    const a = pmap[g.from]
    const b = pmap[g.to]
    if (!a || !b) continue
    if (Math.abs(a.y - b.y) > tol) continue // 必须近水平
    const len = Math.abs(a.x - b.x)
    if (len <= 0 || len < spanX * 0.5) continue // 必须是主轴线
    const x0 = Math.min(a.x, b.x)
    const x1 = Math.max(a.x, b.x)

    // 有竖直长线段当 y 轴 → 这是直角坐标系，不是数轴
    const hasYAxis = segs.some(s2 => {
      const c = pmap[s2.from]
      const d = pmap[s2.to]
      if (!c || !d) return false
      if (Math.abs(c.x - d.x) > tol) return false
      return Math.abs(c.y - d.y) >= len * 0.6
    })
    if (hasYAxis) continue

    let ticks = 0
    for (const v of verticals) {
      if (v.h > len * 0.2) continue
      if (v.x < x0 - tol || v.x > x1 + tol) continue
      // 轴线必须落在该短竖线的 y 区间内（贴一侧 / 穿过轴 都算）
      if (v.loY > a.y + tol || v.hiY < a.y - tol) continue
      ticks++
    }
    if (ticks < 2) continue
    return { y: a.y, x0, x1, len }
  }
  return null
}

/**
 * 数轴刻度小竖线的形态纠偏：一律「站在轴上、朝数字的反侧伸出一小截」，不穿过数轴
 * （2026-09-20 五修；取代同日四修的"以轴为中线、上下等长"方案）。
 *
 * 判据来自**原卷**（教材扫描件，实测 5cac1e12 / 1cb0d196 / 2bd35d49 三张）：
 *   数字写在数轴**下方**，刻度小竖线**站在轴上、朝上**伸出约轴长 2% 的一小截，
 *   **不穿过轴线**。老师 2026-09-20 原话："这个才是对的！请注意，不穿过 X 轴。"
 *   （四修时只有老师的文字描述、没核对原卷，误判成"上下等长"；见 §6g 的教训。）
 *
 * 模型给的三种画法（穿轴 `[-3,3]` / 只挂上方 `[0,4]` / 只挂下方 `[-4,0]`）都归一到这一种；
 * 长度取模型给得**较长**的一侧，保住原有的可见刻度长度，不新造长度。
 *
 * 只处理**识别出数轴**的图，且只动「两端都是 `_` 辅助点、近竖直、与轴线相交、
 * 单侧长度 ≤ 轴长 10%」的短线段（与 `detectNumberAxis` 同一套判据），
 * 因此几何图形的边、坐标系的刻度都不会被碰。
 *
 * 幂等：已经「站在轴上且只朝一侧」的刻度线直接跳过，跑两次结果相同。
 *
 * @param {Array} points - 已归一化的点（就地改写 y）
 * @param {Array} segments - 已归一化的线段
 * @returns {{ points:Array, segments:Array }} 同一个数组引用（便于链式调用）
 */
export function normalizeTickMarks(points, segments) {
  const pts = Array.isArray(points) ? points : []
  const segs = Array.isArray(segments) ? segments : []
  const axis = detectNumberAxis(pts, segs, {})
  if (!axis) return { points: pts, segments: segs }

  const pmap = {}
  for (const p of pts) if (p && p.label) pmap[p.label] = p

  const tol = Math.max(axis.len * 0.002, 1e-9)
  const tolExact = Math.max(axis.len * 0.02, 1e-9)
  // 单侧长度上限：超过轴长 10% 的一律不当刻度线（宁可不动，也别把图形边拉成刻度）
  const maxLen = axis.len * 0.1

  // 刻度朝向 = 数字的反侧（数字在下方 ⇒ 刻度朝上）。同一张图取第一个有明确侧向的数字。
  // 没有数字标注时按原卷惯例朝上。⚠️ 结构里 y 向上为正。
  let numBelow = true
  for (const p of pts) {
    if (!p || !isNum(p.y) || !p.label || !isTickNumberLabel(p.label)) continue
    const d = p.y - axis.y
    if (Math.abs(d) <= tolExact) continue
    numBelow = d < 0
    break
  }
  const wantUp = numBelow

  for (const g of segs) {
    const a = pmap[g.from]
    const b = pmap[g.to]
    if (!a || !b) continue
    if (!isAuxPointLabel(g.from) || !isAuxPointLabel(g.to)) continue
    // 虚线是对称轴/辅助线，不是刻度（对称轴往往也"穿过轴"，别把它拉成刻度）
    if (g.style === 'dashed') continue
    if (Math.abs(a.x - b.x) > tol) continue // 必须近竖直
    const hi = Math.max(a.y, b.y)
    const lo = Math.min(a.y, b.y)
    const h0 = hi - lo
    if (h0 <= tol) continue
    if (h0 > maxLen) continue // 太长，不是刻度线
    if (lo > axis.y + tol || hi < axis.y - tol) continue // 与轴线不相交，不是刻度线

    const up = hi - axis.y
    const down = axis.y - lo
    // 已经符合形态：站在轴上、只朝正确的一侧 → 跳过（幂等）
    if (wantUp ? up > tol && down <= tol : down > tol && up <= tol) continue

    const h = Math.max(up, down)
    if (h <= 0 || h > maxLen) continue
    const top = axis.y + (wantUp ? h : 0)
    const bottom = axis.y - (wantUp ? 0 : h)
    if (a.y >= b.y) {
      a.y = top
      b.y = bottom
    } else {
      b.y = top
      a.y = bottom
    }
  }
  return { points: pts, segments: segs }
}

/**
 * 数轴数值标注的摆位决策（SVG / TikZ 两个渲染器共用，唯一口径）。
 *
 * 作用：把「模型为了排版而写的标签坐标」翻译成「数轴上的正确画法」——
 *   · 圆点吸附到轴上（模型写 y=-9 只为表达"文字放下方"，不是真有个点悬在轴外）；
 *   · 文字统一摆到点的正上/正下方并居中，同一张图上所有标签距轴距离一致；
 *   · 侧向由模型给的 y 决定（y 在轴下方 → 文字在轴下方；y 恰在轴上 → 大写字母
 *     按教材惯例摆上方，数字/小写字母摆下方）。
 *
 * 只处理**孤立标签点**：不作为任何线段/多边形/圆弧/角标记端点的点。
 * 真几何顶点（三角形的 A、B、C）永不会被吸附或改摆位。
 *
 * @returns {Map<string, { axisY:number, side:'above'|'below' }>}
 */
export function resolveNumberAxisLabels(structure) {
  const out = new Map()
  const s = structure || {}
  const axis = detectNumberAxis(s.points, s.segments, {
    coordinateSystem: !!(s.coordinate_system && s.coordinate_system.exists)
  })
  if (!axis) return out

  // 被任何几何构造引用的名字 = 真顶点（圆点本就落在轴上，只需对齐文字）
  const used = collectUsedLabels(s)

  const tol = Math.max(axis.len * 0.15, 1e-9)
  // 真顶点用**更严**的容差：它们是真的落在轴上（dy≈0），不是为了排版故意写偏的
  const tolExact = Math.max(axis.len * 0.02, 1e-9)

  // 同图刻度数字的侧向——真顶点跟随刻度数字同侧，让"字母与数字同一水平"（老师 2026-09-19 要求）
  let tickSide = 'below'
  for (const p of s.points || []) {
    if (!p || !isNum(p.y) || !p.label || !isTickNumberLabel(p.label)) continue
    const d = p.y - axis.y
    if (Math.abs(d) <= tolExact) continue
    tickSide = d < 0 ? 'below' : 'above'
    break
  }

  for (const p of s.points || []) {
    if (!p || !isNum(p.x) || !isNum(p.y) || !p.label) continue
    if (isAuxPointLabel(p.label)) continue
    if (!isVertexSymbolLabel(p.label)) continue
    if (p.x < axis.x0 - tol || p.x > axis.x1 + tol) continue

    const isTrueVertex = used.has(p.label)
    // 真顶点：必须真的就在轴上才纳入（它的圆点不需吸附，只要文字与其他标签齐平）
    const bound = isTrueVertex ? tolExact : tol
    const dy = p.y - axis.y
    if (Math.abs(dy) > bound) continue

    out.set(p.label, {
      axisY: axis.y,
      // snap=false ⇒ 渲染器不移动圆点（真顶点本来就在轴上），只统一文字摆位
      snap: !isTrueVertex,
      side: isTrueVertex
        ? tickSide // 与刻度数字同一水平（见上）
        : dy < 0 ? 'below' : dy > 0 ? 'above' : (/^[A-Z]/.test(p.label) ? 'above' : 'below'),
    })
  }
  return out
}

/**
 * 被任何几何构造引用过的名字 = 真顶点（不是"为排版而写的标签点"）。
 *
 * 数轴摆位与直角坐标系摆位都要这条判据：真顶点的圆点在它自己身上，
 * 标签点的圆点是模型为了给文字定位而虚构的。
 */
function collectUsedLabels(s) {
  const used = new Set()
  const collect = (v) => {
    if (typeof v === 'string') { used.add(v); return }
    if (Array.isArray(v)) { v.forEach(collect); return }
    if (v && typeof v === 'object') { Object.values(v).forEach(collect); return }
  }
  for (const g of s.segments || []) { used.add(g.from); used.add(g.to) }
  collect(s.polygons)
  collect(s.arcs)
  collect(s.angleMarks)
  collect(s.rightAngles)
  return used
}

/**
 * 检测「直角坐标系」（两条相互垂直的长轴线 + 交点在图内）。
 *
 * 为什么需要（2026-09-19 老师二修反馈）：函数图象题的 x/y 轴是**用 segment 画的**，
 * 而 `normalizeStructure` 对 `figure_type='geometry'` 会强制清空 `coordinate_system`
 * ⇒ 渲染层完全不知道这是坐标系。落在 x 轴上的 A、原点 O 于是被通用避让算法
 * 推成"斜上方 24px"，老师原话："A 点应该是在 x 轴上，0 代表原点，应该是 x 轴和 y 轴相交点，
 * 但目前全部偏移"。
 *
 * 判据：
 *   ① 一条近水平线段（长 ≥ x 跨度一半）与一条近竖直线段（长 ≥ y 跨度一半）；
 *   ② 交点落在**两条线段各自的内部**（不是端点拼出来的拐角）——这一条同时挡掉
 *      「数轴 + 立在轴上的正方形竖边」这种伪坐标系（正方形竖边的下端点正是交点）；
 *   ③ 若结构里有 `x`/`y` 轴名标注，优先用它挑轴线（比"最长线段"稳得多：
 *      函数图象题的对称轴也是一条很长的竖线）。
 *
 * @returns {{origin:{x,y}, xAxis:object, yAxis:object}|null}
 */
export function detectCoordAxes(points, segments, labels = []) {
  const pts = (Array.isArray(points) ? points : []).filter(p => p && isNum(p.x) && isNum(p.y))
  const pmap = {}
  for (const p of pts) if (p.label) pmap[p.label] = p
  const segs = Array.isArray(segments) ? segments : []
  if (pts.length === 0 || segs.length === 0) return null

  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const spanX = Math.max(...xs) - Math.min(...xs) || 1
  const spanY = Math.max(...ys) - Math.min(...ys) || 1
  const tol = spanX * 0.002

  const horiz = []
  const vert = []
  for (const g of segs) {
    const a = pmap[g.from]
    const b = pmap[g.to]
    if (!a || !b) continue
    if (Math.abs(a.y - b.y) <= tol) {
      const len = Math.abs(a.x - b.x)
      if (len >= spanX * 0.5) horiz.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), len })
    }
    if (Math.abs(a.x - b.x) <= tol) {
      const len = Math.abs(a.y - b.y)
      if (len >= spanY * 0.5) vert.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), len })
    }
  }
  if (horiz.length === 0 || vert.length === 0) return null

  // 轴名标注（x / y）优先：取到轴名最近的那条候选
  const named = (text) => (Array.isArray(labels) ? labels : []).find(l => String(l?.text ?? '').trim().toLowerCase() === text)
  const xName = named('x')
  const yName = named('y')
  const pickNearest = (cands, l, horizontal) => {
    if (!l || !isNum(l.x) || !isNum(l.y)) return null
    let best = null
    for (const c of cands) {
      const d = horizontal ? Math.abs(l.y - c.y) : Math.abs(l.x - c.x)
      if (!best || d < best.d) best = { c, d }
    }
    return best ? best.c : null
  }
  const longest = (cands) => cands.reduce((a, b) => (!a || b.len > a.len ? b : a), null)
  const h = pickNearest(horiz, xName, true) || longest(horiz)
  const v = pickNearest(vert, yName, false) || longest(vert)

  // 交点必须在两条轴线的内部（端点相交不算坐标系）
  if (v.x <= h.x0 + tol || v.x >= h.x1 - tol) return null
  if (h.y <= v.y0 + tol || h.y >= v.y1 - tol) return null
  return { origin: { x: v.x, y: h.y }, xAxis: h, yAxis: v }
}

/**
 * 直角坐标系下的标注摆位（数轴摆位的姊妹口径，2026-09-19 新增）。
 *
 * 与 `resolveNumberAxisLabels` 一样返回 `Map<label, layout>`，渲染器共用同一套消费逻辑。
 * 差别只在判据来源（"两条互相垂直的长轴"而不是"一条轴 + 短刻度"）与侧向规则：
 *   · x 轴上的**刻度数字** → 轴下方（同数轴）；
 *   · 落在 x 轴上的**点** → 该点若有线段向上走（图形立轴上）→ 轴下方（避开图形），
 *     否则 → 轴上方（函数图象题的 A、B 这类交点，原卷就是写在轴上方）；
 *   · **原点**（两轴交点）→ 轴下方偏右压紧（`origin:true`），且**文字锚在交点本身**：
 *     带 `atX`/`atY`（= 两轴交点），渲染器用它当锚点，不再复用模型写的坐标。
 *     模型把 O 写在 (-0.4,-0.45) 是在表达"文字放在交点左下方一点"的排版意图，
 *     不是真有个点在那里（老师 2026-09-19："这个 0 点标的太下面了，0 应该是
 *     x 轴和 y 轴的交点"）。原点字母也不能居中：y 轴往往会往轴下方伸出一小截，
 *     居中摆放会与它叠住；原卷也是把 O 写在竖直线的右侧、紧贴交点。
 *
 * 原点可能出现在**两条通道**里，两条都要收：
 *   · `points[]`（带 label 的点，圆点+文字）；
 *   · `labels[]`（只画文字的自由标注）——模型有时用它承载原点，这时连吸附逻辑
 *     都碰不到它，文字会停在模型给的位置（实测偏 22px/26px）。
 *
 * @returns {Map<string, {axisY:number, snap:boolean, side:string, origin?:boolean,
 *                        atX?:number, atY?:number, fromLabel?:boolean}>}
 */
export function resolveCoordAxisLabels(structure) {
  const out = new Map()
  const s = structure || {}
  const cs = detectCoordAxes(s.points, s.segments, s.labels)
  if (!cs) return out

  const used = collectUsedLabels(s)
  const tol = Math.max(cs.xAxis.len * 0.15, 1e-9)
  const tolExact = Math.max(cs.xAxis.len * 0.02, 1e-9)
  // 原点标注的容差放宽一档：模型常常把 O 写在交点的左下方一点（它是在写"文字位置"，
  // 不是真有个点在那里）。老师口径："0 代表原点，应该是 x 轴和 y 轴相交点"。
  const tolOrigin = Math.max(cs.xAxis.len * 0.08, tolExact)

  for (const p of s.points || []) {
    if (!p || !isNum(p.x) || !isNum(p.y) || !p.label) continue
    if (isAuxPointLabel(p.label)) continue
    if (!isVertexSymbolLabel(p.label)) continue
    if (p.x < cs.xAxis.x0 - tol || p.x > cs.xAxis.x1 + tol) continue

    // ① 原点（两轴交点）：文字锚在**交点本身**，不复用模型给的坐标。
    //    模型写 (-0.4,-0.45) 是在表达"文字放交点左下方一点"，不是真有个点在那里。
    const dOrigin = Math.max(Math.abs(p.x - cs.origin.x), Math.abs(p.y - cs.origin.y))
    if (dOrigin <= tolExact || (/^[Oo]$/.test(p.label) && dOrigin <= tolOrigin)) {
      out.set(p.label, {
        axisY: cs.origin.y,
        // 真顶点（被线段/多边形引用）的圆点不挪，只对齐文字；
        // 纯标签点的圆点是模型为给文字定位而虚构的 ⇒ 吸附到交点
        snap: !used.has(p.label),
        side: 'origin',
        origin: true,
        atX: cs.origin.x,
        atY: cs.origin.y,
      })
      continue
    }

    // ② x 轴上的刻度数字 / 落轴点
    const dy = p.y - cs.xAxis.y
    const isTick = isTickNumberLabel(p.label)
    const isTrue = used.has(p.label)
    if (isTick) {
      // ⚠️ 必须判"这个数字属于哪条轴"：坐标系里 y 轴自己的刻度数字（如写在 y 轴左侧的 1）
      // 到 x 轴的距离可能小于轴长的 15%，只按距离判会把它当成 x 轴刻度、推到 x 轴下面去。
      // 归属判据 = 到哪条轴的**垂距更近**（刻度数字总是紧贴自己那条轴写）。
      const nearX = Math.abs(dy)
      const nearY = Math.abs(p.x - cs.yAxis.x)
      if (nearX > nearY) continue
      if (nearX > tol) continue
    } else {
      if (Math.abs(dy) > tolExact) continue // 只收「真落在轴上的点」
    }
    out.set(p.label, {
      axisY: cs.xAxis.y,
      snap: !isTrue,
      // 刻度数字一律在轴下方；落轴点看该点上方有没有图形（有则让到下方）
      side: isTick || hasSegmentGoingUp(s, p) ? 'below' : 'above',
    })
  }

  // ② 文字通道（`structure.labels`）里的原点符号。
  // 模型有时把原点写成 label（只想控制文字位置）而不是 point，这条通道**不画圆点、
  // 也不参与任何吸附**，文字会停在模型给的位置上——实测偏交点 (22px, 26px)，
  // 正是老师说的"0 点标的太下面了"。容差与 point 通道同一档（轴长 8%）。
  for (const l of s.labels || []) {
    if (!l || !isNum(l.x) || !isNum(l.y) || l.text == null) continue
    const text = String(l.text).trim()
    if (!/^[Oo0]$/.test(text)) continue
    if (out.has(text)) continue // point 通道优先（上面已处理，别覆盖它的摆位）
    if (Math.max(Math.abs(l.x - cs.origin.x), Math.abs(l.y - cs.origin.y)) > tolOrigin) continue
    out.set(text, {
      axisY: cs.origin.y,
      snap: false,
      side: 'origin',
      origin: true,
      atX: cs.origin.x,
      atY: cs.origin.y,
      fromLabel: true,
    })
  }
  return out
}

/** 是否有线段从该点出发向上走（用来判断"轴上方有没有图形挡着"） */
function hasSegmentGoingUp(s, p) {
  for (const g of s.segments || []) {
    const otherLabel = g.from === p.label ? g.to : g.to === p.label ? g.from : null
    if (!otherLabel) continue
    const other = (s.points || []).find(q => q && q.label === otherLabel)
    if (!other || !isNum(other.x) || !isNum(other.y)) continue
    if (isAuxPointLabel(otherLabel)) continue
    // 大致同 x（近竖直）且更高 → 轴上方有图形
    if (Math.abs(other.x - p.x) <= Math.abs(other.y - p.y) * 0.35 && other.y > p.y) return true
  }
  return false
}

/**
 * 轴系标注摆位的统一入口（渲染器只调这一个）。
 * 数轴优先（判据更专），坐标系补位；两者判据互斥，实测不会同时命中。
 */
export function resolveAxisLabels(structure) {
  const m = resolveNumberAxisLabels(structure)
  for (const [k, v] of resolveCoordAxisLabels(structure)) {
    if (!m.has(k)) m.set(k, v)
  }
  return m
}

/** 是否有靠作图关系定义的派生点（垂足/中点/交点/线上动点） */
export function hasDerivedPoints(s) {
  return (s?.points || []).some(
    p => p && p.derived && typeof p.derived === 'object' && Object.keys(p.derived).length > 0
  )
}

/**
 * 把曲线采样点按「无定义缺口」切成若干连续段。
 *
 * 为什么需要：`curve` 采样遇到无定义点（如 y=1/x 在 x=0 处）会跳过该点，
 * 数组里就出现「前一段末点」直接接「后一段首点」的**跳变**。不切分的话，
 * 两个分支会被一条长直线连起来——图上凭空多出一条横穿坐标轴的直线，比不画还糟。
 *
 * 断点来源有两路，**优先显式**：
 *   1. `curve` 命令采样时记录的下标（`curves[].breaks`）——确定性，不猜；
 *   2. 历史数据没有 breaks 时，按 x 间距启发式判：超过中位间距 {@link gapFactor} 倍即为缺口。
 *      均匀采样下正常相邻间距恰好等于中位间距，1.5 倍阈值既能抓出"只漏一个采样点"
 *      （间距变成 2 倍），又不会误切正常曲线。
 *
 * @param {Array<[number,number]>} points 数学坐标采样点
 * @param {number[]} [breaks] 断点下标（该下标处的点开始新的一段）
 * @returns {Array<Array<[number,number]>>} 每段至少 2 个点
 */
export function splitCurveRuns(points, breaks, gapFactor = 1.5) {
  const pts = (Array.isArray(points) ? points : [])
    .filter(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))
  if (pts.length < 2) return []

  const explicit = (Array.isArray(breaks) ? breaks : [])
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0 && n < pts.length)

  const cuts = new Set(explicit)
  if (cuts.size === 0) {
    // 启发式：x 间距的突变
    const gaps = []
    for (let i = 1; i < pts.length; i++) gaps.push(Math.abs(pts[i][0] - pts[i - 1][0]))
    const sorted = gaps.slice().sort((a, b) => a - b)
    const med = sorted[Math.floor(sorted.length / 2)]
    if (med > 0) {
      const limit = med * gapFactor
      for (let i = 1; i < pts.length; i++) {
        if (Math.abs(pts[i][0] - pts[i - 1][0]) > limit) cuts.add(i)
      }
    }
  }

  const runs = []
  let cur = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (cuts.has(i)) { runs.push(cur); cur = [pts[i]] }
    else cur.push(pts[i])
  }
  runs.push(cur)
  return runs.filter(r => r.length >= 2)
}

/** 折线总长 */
function polylineLength(pts) {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return len
}

/** 点集包围盒对角线长（平均点距的相对基准） */
function bboxDiag(pts) {
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1
}

/**
 * 5 点二次 Savitzky–Golay 平滑（保曲率去噪）。
 *
 * 核对：核 `[-3,12,17,12,-3]/35` 的系数和为 1（不改变常数），且对
 * `y = a·i² + b·i + c` 这类二次序列输出与输入完全相等 ⇒ **二次曲率不被削平**，
 * 这一点对抛物线至关重要（普通移动平均会把顶点压平）。它只压掉高频抖动。
 *
 * 首尾各两点保持原值：窗口不完整，且端点必须落在原图端点上（曲线与轴的交点、
 * 题目给的取值范围都靠它）。
 *
 * @param {Array<[number,number]>} pts 有序采样点
 * @returns {Array<[number,number]>} 新数组（不修改入参）
 */
function savitzkyGolay5(pts) {
  const n = pts.length
  if (n < 5) return pts.map(p => [p[0], p[1]])
  const out = pts.map(p => [p[0], p[1]])
  for (let i = 2; i < n - 2; i++) {
    for (const k of [0, 1]) {
      out[i][k] = (
        -3 * pts[i - 2][k] + 12 * pts[i - 1][k] + 17 * pts[i][k] + 12 * pts[i + 1][k] - 3 * pts[i + 2][k]
      ) / 35
    }
  }
  return out
}

/**
 * 曲线兜底：把「辅助点密采样 + `segment` 直连」的折线在结构层还原成曲线（2026-09-19 三修）。
 *
 * 为什么需要：提示词规则 11/12 与 `curve` 命令都要求函数图象必须用 `curve` 画，但模型
 * 仍会自作聪明地**目测一串点再逐段 `segment` 连起来**——实测 `1dac908f`：23 个
 * `_c0…_c22` + 22 条 `segment` ⇒ 抛物线画成折线，底部有明显折角，老师一眼就看出
 * "不是平滑的曲线，一定是个 BUG"。该样本生成于 `curve` 上线之前（存量数据），
 * 但模型随时可能再犯，所以在结构层加一层**确定性兜底**：识别出来就当曲线渲染，
 * 两个渲染器都自动走 `smoothPathD`/`tikzSmoothPath` 平滑，无需重跑模型。
 *
 * 判据（**全部满足**才兜底；宁可漏兜，也不能把真折线掰弯）：
 *   1. 两端都是 `_` 前缀辅助点——真实标注点绝不被平滑穿过；
 *   2. 连通分量是一条**简单开放路径**（度 ≤2、恰 2 个度为 1 的端点、节点数 = 边数+1）
 *      ⇒ 多边形、闭合阴影、分叉网格都排除在外；
 *   3. 点数 ≥ `minPoints`（默认 6），且**平均点距 ≤ 包围盒对角线 × `maxGapRatio`**（默认 0.22）
 *      ⇒ 只认"密采样"特征；五六个点连成的折线不满足；
 *   4. 每个内部点**转角 ≤ `maxTurnDeg`**（默认 45°）——超过的点处**切段**：
 *      分段函数（y=|x| 的尖角）、折线统计图的大拐弯原地保留，其余段照旧平滑。
 *      切段而非整条否决，是为了"一个噪声尖点不至于把整条曲线拖回折线"。
 *
 * 通过判据后还会做一次**保曲率去噪**（`denoise`，默认开）：模型目测出来的采样点
 * 在 y 上普遍有 ±5 的抖动（实测 `_c7` 写 40，而它左右邻居 44/29 夹出的真值约 35），
 * 直接样条插值会把这些抖动原样画成"鼓包"。用 5 点二次 Savitzky–Golay 核
 * `[-3,12,17,12,-3]/35` 平滑——它保留二次曲率（抛物线顶点不会被削平），只压高频噪声；
 * **首尾各两点保持原值**，保证曲线端点仍落在原图端点上。
 * DSL `curve` 命令出来的 121 点采样**不走这条路**，不受影响。
 *
 * @param {Array} points    归一化后的点（含 label/x/y）
 * @param {Array} segments  归一化后的线段
 * @param {Array} curves    已有曲线（新曲线追加在后面）
 * @returns {{segments: Array, curves: Array, merged: number}} 被吞掉的线段已从 segments 摘除
 */
export function mergeSampledCurveChains(points, segments = [], curves = [], opts = {}) {
  const minPoints = opts.minPoints ?? 6
  const maxTurnDeg = opts.maxTurnDeg ?? 45
  const maxGapRatio = opts.maxGapRatio ?? 0.22
  const denoise = opts.denoise !== false
  const unchanged = { segments, curves, merged: 0 }

  const pmap = new Map()
  for (const p of points || []) if (p?.label) pmap.set(p.label, p)

  const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)
  const adj = new Map() // label -> 邻接 label 数组
  const segIdx = new Map() // pairKey -> 该线段在 segments 里的下标
  for (let i = 0; i < segments.length; i++) {
    const g = segments[i]
    const a = pmap.get(g.from)
    const b = pmap.get(g.to)
    if (!a || !b) continue
    if (!isAuxPointLabel(g.from) || !isAuxPointLabel(g.to)) continue
    const k = pairKey(g.from, g.to)
    if (segIdx.has(k)) continue // 同一条边重复写了两遍，忽略
    segIdx.set(k, i)
    if (!adj.has(g.from)) adj.set(g.from, [])
    if (!adj.has(g.to)) adj.set(g.to, [])
    adj.get(g.from).push(g.to)
    adj.get(g.to).push(g.from)
  }
  if (adj.size < minPoints) return unchanged

  const seen = new Set()
  const dropIdx = new Set()
  const added = []

  for (const start of adj.keys()) {
    if (seen.has(start)) continue
    const stack = [start]
    const nodes = []
    seen.add(start)
    while (stack.length) {
      const cur = stack.pop()
      nodes.push(cur)
      for (const nb of adj.get(cur) || []) {
        if (!seen.has(nb)) { seen.add(nb); stack.push(nb) }
      }
    }
    // ② 简单开放路径
    if (nodes.length < minPoints) continue
    if (nodes.some(n => (adj.get(n) || []).length > 2)) continue
    const ends = nodes.filter(n => (adj.get(n) || []).length === 1)
    const edges = nodes.reduce((s, n) => s + (adj.get(n) || []).length, 0) / 2
    if (ends.length !== 2 || edges !== nodes.length - 1) continue

    // 沿链走一遍取有序坐标
    const ordered = [ends[0]]
    let prev = null
    let cur = ends[0]
    while (ordered.length < nodes.length) {
      const nxt = (adj.get(cur) || []).find(n => n !== prev)
      if (nxt == null) break
      ordered.push(nxt)
      prev = cur
      cur = nxt
    }
    if (ordered.length !== nodes.length) continue
    const pts = ordered.map(l => [pmap.get(l).x, pmap.get(l).y])

    // ③ 密采样：整条链先过一遍（平均点距相对包围盒对角线）
    if (polylineLength(pts) / (pts.length - 1) > bboxDiag(pts) * maxGapRatio) continue

    // ④ 按尖角切段：转角超过阈值的点处断开（分段函数 y=|x| 的尖角、折线图的大拐弯原地保留），
    //    各段独立判定与平滑——否则一个噪声尖点会把整条曲线一起拖下水，退回折线。
    const maxTan = Math.tan((maxTurnDeg * Math.PI) / 180)
    const isSharp = (a, b, c) => {
      const ax = b[0] - a[0]
      const ay = b[1] - a[1]
      const bx = c[0] - b[0]
      const by = c[1] - b[1]
      const la = Math.hypot(ax, ay)
      const lb = Math.hypot(bx, by)
      if (la < 1e-9 || lb < 1e-9) return false
      const cos = (ax * bx + ay * by) / (la * lb)
      if (cos <= 0) return true // 转角 ≥ 90°
      return Math.abs(ax * by - ay * bx) / (la * lb) / cos > maxTan
    }
    const runs = []
    let runStart = 0
    for (let i = 1; i < pts.length - 1; i++) {
      if (isSharp(pts[i - 1], pts[i], pts[i + 1])) {
        runs.push(ordered.slice(runStart, i + 1)) // 尖点归上一段
        runStart = i // 尖点同时作为下一段起点（两段共用它，尖角原地不动）
      }
    }
    runs.push(ordered.slice(runStart))

    // 逐段判定：够密够长才兜底；段内已无尖角（切过），可安全平滑
    for (const run of runs) {
      if (run.length < minPoints) continue
      const rpts = run.map(l => [pmap.get(l).x, pmap.get(l).y])
      if (polylineLength(rpts) / (rpts.length - 1) > bboxDiag(rpts) * maxGapRatio) continue
      for (let i = 1; i < run.length; i++) {
        const k = pairKey(run[i - 1], run[i])
        if (segIdx.has(k)) dropIdx.add(segIdx.get(k))
      }
      added.push({ points: denoise ? savitzkyGolay5(rpts) : rpts, style: 'solid' })
    }
  }

  if (!added.length) return unchanged
  return {
    segments: segments.filter((_, i) => !dropIdx.has(i)),
    curves: [...curves, ...added],
    merged: added.length
  }
}


