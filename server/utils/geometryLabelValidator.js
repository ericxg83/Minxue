/**
 * 几何标注二次整理（服务端规则过滤层）。
 *
 * 视觉模型对"几何标注 vs 非几何数字"的判断不稳定（常把题干数字 / 学生笔迹 /
 * 页码 / 题号混入 labels，又或把 50° 误读成 2.5）。本模块在模型输出之后、
 * 渲染之前，按纯空间规则把 labels 重新拆成：
 *
 *   geometry_labels  — 确认属于几何图的标注（点/线/角的标注），进入 TikZ 渲染
 *   ignored_labels   — 其余：清晰垃圾（outside_figure）或无法判定（ambiguous）。
 *                      一律不进入 TikZ；ambiguous 供人工复核（needs_review）。
 *
 * 设计原则（按需求）：
 *   - 不依赖模型是否遵循 geometry_labels / ignored_labels schema——
 *     无论模型吐 labels / geometry_labels / ignored_labels，都重新判定。
 *   - 保留模型原始输出作为候选数据（合并进同一候选池，去重）。
 *   - "宁愿少显示，也不要显示错误信息"：无法判定的 label 不进 TikZ。
 *
 * 坐标系：模型输出的点/线段/标注都是同一数学平面坐标（y 向上为正）。
 * 本模块只在模型坐标空间内做几何计算，无需像素/图片。
 */

const isNum = (v) => typeof v === 'number' && isFinite(v)

// 阈值（相对图形尺度 extent = max(包围盒宽, 高)，自动适配不同缩放）
// 减小阈值：更严格地要求标注必须紧贴几何元素，避免误判题干数字
const REGION_PAD_FRAC = 0.20  // 图形 bbox 外扩比例，定义"几何区域内"（收紧）
const PROX_FRAC = 0.18        // 距最近几何元素（线段/点）的最大距离（收紧）
const ANGLE_POINT_FRAC = 0.35 // 角度标注：距顶点的最大距离（收紧）

/**
 * 对候选 label 去重（按 text + 坐标）。
 */
function dedupeLabels(arr) {
  const seen = new Set()
  const out = []
  for (const c of arr) {
    if (!c || c.text == null) continue
    const x = isNum(c.x) ? Math.round(c.x * 100) : 0
    const y = isNum(c.y) ? Math.round(c.y * 100) : 0
    const key = `${String(c.text)}|${x}|${y}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/**
 * 点到线段的最短距离（模型坐标空间，坐标系无关）。
 */
function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq < 1e-9 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/**
 * 从 constraints（模型输出的几何约束文本数组，如 "∠BAD = 50°"、"BD = DC"）
 * 提取所有"数值 token"，用于辅助校验候选 label 是否真实存在。
 * 返回 numeric token 集合，例如 Set(['50','2.5','6'])（角标只取数字部分 "50"）。
 */
function extractConstraintNumbers(constraints) {
  const nums = new Set()
  if (!Array.isArray(constraints)) return nums
  for (const c of constraints) {
    if (typeof c !== 'string') continue
    // 匹配所有数字（含小数与负号）
    const matches = c.match(/-?\d+(\.\d+)?/g)
    if (matches) for (const m of matches) nums.add(String(Number(m)))
  }
  return nums
}

/**
 * 把候选 label 的 text 归一化为可与 constraint 数值集合比对的形式。
 * "50°" → "50"，"∠50°" → "50"，"2.5" → "2.5"，"BD" → null（非数值，不靠数值约束校验）。
 */
function labelNumericToken(text) {
  if (text == null) return null
  const m = String(text).match(/-?\d+(\.\d+)?/)
  return m ? String(Number(m[0])) : null
}

/**
 * 辅助校验：候选 label 的数值是否出现在 constraints 中（辅助确认，不作唯一依据）。
 * 仅当 label 本身是数值型（角度/长度/坐标数值）时才参与比对；
 * 文本型标注（如 BD/DC）空间规则已覆盖，不依赖此函数。
 * @returns {boolean} true 表示该数值被某条约束佐证
 */
function isCorroboratedByConstraint(labelText, constraintNumbers) {
  if (!constraintNumbers || constraintNumbers.size === 0) return false
  const tok = labelNumericToken(labelText)
  if (tok == null) return false
  return constraintNumbers.has(tok)
}

/**
 * 把模型输出的 labels 重新分类为 geometry_labels / ignored_labels。
 *
 * @param {object} structure - { points, segments, labels|geometry_labels|ignored_labels, ... }
 * @returns {object} 原 structure 的副本，新增 geometry_labels / ignored_labels 字段；
 *                   每个 ignored label 附 reason: 'outside_figure' | 'ambiguous' | 'no_coord'。
 */
export function validateGeometryLabels(structure) {
  if (!structure || typeof structure !== 'object') return structure

  const points = Array.isArray(structure.points) ? structure.points : []
  const segments = Array.isArray(structure.segments) ? structure.segments : []

  // ── 候选池：合并模型可能输出的所有 label 字段，去重 ──
  const rawPool = [
    ...(Array.isArray(structure.labels) ? structure.labels : []),
    ...(Array.isArray(structure.geometry_labels) ? structure.geometry_labels : []),
    ...(Array.isArray(structure.ignored_labels) ? structure.ignored_labels : []),
  ]
  const candidates = dedupeLabels(rawPool)
  if (candidates.length === 0) {
    return { ...structure, geometry_labels: [], ignored_labels: [] }
  }

  // ── 点查找表 + 图形区域（bbox）──
  const pmap = {}
  for (const p of points) {
    if (p && p.label && isNum(p.x) && isNum(p.y)) pmap[p.label] = p
  }

  const validPts = points.filter((p) => isNum(p?.x) && isNum(p?.y))
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of validPts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }

  // 没有可用点：无法界定区域 → 全部标 ambiguous（保守：不进 TikZ，待复核）
  if (!isFinite(minX)) {
    return {
      ...structure,
      geometry_labels: [],
      ignored_labels: candidates.map((c) => ({ ...c, reason: 'ambiguous' })),
    }
  }

  const extent = Math.max(maxX - minX, maxY - minY) || 1
  const pad = extent * REGION_PAD_FRAC
  const region = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad }
  // 线段/点标注：必须紧贴几何元素（否则视为区域中央的漂浮数字 → 不进 TikZ）
  const prox = extent * PROX_FRAC
  // 角度标注：必须落在某顶点附近（顶点 = 关联 ≥2 条线段的点）
  const angleProx = extent * ANGLE_POINT_FRAC

  // 每个顶点关联的线段数（角度判定 + 普通顶点判定用）
  const incident = {}
  for (const seg of segments) {
    if (seg?.from) incident[seg.from] = (incident[seg.from] || 0) + 1
    if (seg?.to) incident[seg.to] = (incident[seg.to] || 0) + 1
  }

  // ── 第三层：constraints 辅助校验（不作唯一依据，仅当存在 constraints 时启用）──
  // 从约束文本提取数值集合，用于佐证"空间上靠近几何但仍拿不准"的标注。
  const constraintNumbers = extractConstraintNumbers(structure.constraints)
  const hasConstraints = constraintNumbers.size > 0

  // 线段端点坐标（用于距离计算）
  const segs = segments
    .map((seg) => {
      const a = pmap[seg?.from]
      const b = pmap[seg?.to]
      if (!a || !b) return null
      return { a, b }
    })
    .filter(Boolean)

  // 圆（半径/直径标注常置于圆心或圆周，需单独判近）
  const circles = Array.isArray(structure.circles)
    ? structure.circles.filter((c) => isNum(c?.cx) && isNum(c?.cy) && isNum(c?.r))
    : []

  const geometry_labels = []
  const ignored_labels = []

  for (const lab of candidates) {
    // 无坐标：无法判定空间关系 → 不进 TikZ
    if (!isNum(lab?.x) || !isNum(lab?.y)) {
      ignored_labels.push({ ...lab, reason: 'no_coord' })
      continue
    }
    const lx = lab.x
    const ly = lab.y

    // 距离最近线段
    let dSeg = Infinity
    for (const s of segs) {
      const d = pointToSegmentDist(lx, ly, s.a.x, s.a.y, s.b.x, s.b.y)
      if (d < dSeg) dSeg = d
    }
    // 距离最近点
    let dPt = Infinity
    let nearPtLabel = null
    for (const p of validPts) {
      const d = Math.hypot(lx - p.x, ly - p.y)
      if (d < dPt) { dPt = d; nearPtLabel = p.label }
    }
    // 距离最近圆（圆心距离，近似：圆心 ± 半径带内的标注都算近圆）
    let dCirc = Infinity
    for (const c of circles) {
      const dCenter = Math.hypot(lx - c.cx, ly - c.cy)
      const dBand = Math.abs(dCenter - c.r) // 到圆周的距离
      const d = Math.min(dCenter, dBand)
      if (d < dCirc) dCirc = d
    }

    const dNear = Math.min(dSeg, dPt)
    const inside = lx >= region.minX && lx <= region.maxX && ly >= region.minY && ly <= region.maxY

    // ── 第一优先：空间关系验证 ──
    // 计算"空间上是否成立"。注意：成立 ≠ 立即进入 TikZ（若启用 constraints 还需佐证）。
    let spatialPass = false
    let reason = null
    let spatialReason = null // 空间失败原因（outside_figure / ambiguous）

    if (!inside) {
      spatialReason = 'outside_figure'
    } else if ((lab.type || 'text') === 'angle') {
      // 角度：必须落在某个"顶点"（关联 ≥2 条线段）附近。
      if (nearPtLabel && dPt <= angleProx && (incident[nearPtLabel] || 0) >= 2) {
        spatialPass = true
      } else {
        spatialReason = 'ambiguous' // 角度无明确顶点关联
      }
    } else {
      // length / text / 圆标注：必须紧贴某几何元素（线段 / 顶点 / 圆）。
      if (dNear <= prox) spatialPass = true
      else if (dCirc <= prox) spatialPass = true
      else spatialReason = 'ambiguous' // 区域内但无明确几何关联
    }

    // ── 第二：constraints 辅助验证（不作唯一依据，仅当存在 constraints 时启用）──
    // 规则：
    //   - 空间不成立 → 直接丢弃（constraints 不拯救无空间关系的标注）；
    //   - 空间成立 + 存在 constraints → 仅当该数值被约束佐证才保留，否则降为 ambiguous；
    //   - 空间成立 + 无 constraints → 直接保留（无额外证据要求）。
    let pass = false
    if (!spatialPass) {
      reason = spatialReason
    } else if (hasConstraints) {
      if (isCorroboratedByConstraint(lab.text, constraintNumbers)) {
        pass = true // 空间 + 约束双重确认
      } else {
        reason = 'ambiguous' // 空间靠近但约束未佐证 → 疑似垃圾，待人工复核，不进 TikZ
      }
    } else {
      pass = true // 无 constraints，空间成立即可
    }

    if (pass) {
      geometry_labels.push(lab)
    } else {
      ignored_labels.push({ ...lab, reason: reason || 'ambiguous' })
    }
  }

  return { ...structure, geometry_labels, ignored_labels }
}

export default validateGeometryLabels
