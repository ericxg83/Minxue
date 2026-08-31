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
  return /^[A-Za-zα-ωΑ-Ω]/.test(t)
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
      relation: seg.relation || 'normal'
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

  return {
    points,
    segments,
    circles: Array.isArray(obj?.circles) ? obj.circles : [],
    // 优先用分类后的 geometry_labels；旧结构无该字段时回退到 labels（向后兼容已渲染的题）
    labels: (Array.isArray(obj?.geometry_labels) ? obj.geometry_labels
          : Array.isArray(obj?.labels) ? obj.labels : []).filter(l => isSymbolLabel(l?.text)),
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
    (s.circles?.length || 0) === 0
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
  return pts.length === 0 && segs.length === 0 && circles.length === 0
}

/** 是否有靠作图关系定义的派生点（垂足/中点/交点/线上动点） */
export function hasDerivedPoints(s) {
  return (s?.points || []).some(
    p => p && p.derived && typeof p.derived === 'object' && Object.keys(p.derived).length > 0
  )
}


