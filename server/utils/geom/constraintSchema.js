/**
 * 几何约束的类型定义与规范化。
 *
 * 约束是求解器的唯一输入语言。三个来源（题干文本、模型 derived 字段、模型 constraints
 * 数组）都要先翻译成这里定义的扁平形式，再合并去重。
 *
 * 统一形状：{ type, args, source, weight, raw }
 *   source  'text' | 'model_derived' | 'model_constraints'，冲突时 text 优先——
 *           题干是唯一干净的独立证据源，模型坐标与标注都可能是目测或幻觉。
 *   weight  数值求解时的软权重；硬约束固定 1，形状类（正方形/菱形）为软约束。
 */

export const CONSTRAINT_TYPES = {
  foot: { hard: true },            // { point, from, onLine:[a,b] } 垂足：既垂直又落在线上
  perpendicular: { hard: true },   // { l1:[a,b], l2:[c,d] }
  parallel: { hard: true },        // { l1:[a,b], l2:[c,d] }
  midpoint: { hard: true },        // { point, of:[a,b] }
  on_segment: { hard: true },      // { point, of:[a,b], t? }
  on_line: { hard: true },         // { point, of:[a,b] }
  on_circle: { hard: true },       // { point, circle }
  circle_center: { hard: true },   // { point, circle }
  line_intersect: { hard: true },  // { point, l1:[a,b], l2:[c,d] }
  angle_bisector: { hard: true },  // { ray:[v,p], of:{vertex,from,to} }
  reflect: { hard: true },         // { point, source, axis:[a,b] }
  rotate: { hard: true },          // { point, source, center, deg }
  tangent: { hard: true },         // { line:[a,b], circle, point? }
  incenter: { hard: true },        // { point, of:[a,b,c] }
  circumcenter: { hard: true },    // { point, of:[a,b,c] }
  centroid: { hard: true },        // { point, of:[a,b,c] }
  equal_length: { hard: true },    // { segs:[[a,b],[c,d],...] }
  ratio: { hard: true },           // { segs:[[a,b],[c,d]], value }
  angle_value: { hard: true },     // { vertex, from, to, deg }
  polygon_shape: { hard: false }   // { kind, vertices:[...] } 正方形/菱形/等边…
}

export const SOURCE_PRIORITY = { text: 3, model_derived: 2, model_constraints: 1 }

export const isHard = (c) => CONSTRAINT_TYPES[c?.type]?.hard === true

/** 线段的无向键：AB 与 BA 视作同一条 */
export const segKey = (seg) => (Array.isArray(seg) ? [...seg].sort().join('') : String(seg ?? ''))

/**
 * 去重键。同一几何事实可能被题干与模型各说一遍（"BD⊥AC" 与 derived:{on_segment:'AC'}），
 * 键要能把它们碰到一起，否则同一条约束会在数值求解里被计两次权重。
 */
export function constraintKey(c) {
  const a = c?.args || {}
  switch (c?.type) {
    case 'perpendicular':
    case 'parallel':
      return `${c.type}|${[segKey(a.l1), segKey(a.l2)].sort().join('~')}`
    case 'foot':
      return `foot|${a.point}|${a.from}|${segKey(a.onLine)}`
    case 'midpoint':
    case 'on_segment':
    case 'on_line':
      return `${c.type}|${a.point}|${segKey(a.of)}`
    case 'on_circle':
    case 'circle_center':
      return `${c.type}|${a.point}|${a.circle}`
    case 'line_intersect':
      return `line_intersect|${a.point}|${[segKey(a.l1), segKey(a.l2)].sort().join('~')}`
    case 'angle_bisector':
      return `angle_bisector|${segKey(a.ray)}|${a.of?.vertex}|${[a.of?.from, a.of?.to].sort().join('')}`
    case 'reflect':
      return `reflect|${a.point}|${a.source}|${segKey(a.axis)}`
    case 'rotate':
      return `rotate|${a.point}|${a.source}|${a.center}|${a.deg}`
    case 'tangent':
      return `tangent|${segKey(a.line)}|${a.circle}`
    case 'incenter':
    case 'circumcenter':
    case 'centroid':
      return `${c.type}|${a.point}|${[...(a.of || [])].sort().join('')}`
    case 'equal_length':
      return `equal_length|${(a.segs || []).map(segKey).sort().join('~')}`
    case 'ratio':
      return `ratio|${(a.segs || []).map(segKey).join('~')}|${a.value}`
    case 'angle_value':
      return `angle_value|${a.vertex}|${[a.from, a.to].sort().join('')}|${a.deg}`
    case 'polygon_shape':
      return `polygon_shape|${a.kind}|${(a.vertices || []).join('')}`
    default:
      return `${c?.type}|${JSON.stringify(a)}`
  }
}

/** 构造一条规范约束；类型未知或参数缺失时返回 null，由调用方丢进 dropped */
export function makeConstraint(type, args, source, raw) {
  if (!CONSTRAINT_TYPES[type]) return null
  return {
    type,
    args,
    source,
    weight: CONSTRAINT_TYPES[type].hard ? 1 : 0.3,
    raw: raw || ''
  }
}

/** 'AB' | ['A','B'] → ['A','B']；解析不出返回 null */
export function parseSeg(v) {
  if (Array.isArray(v)) return v.length === 2 ? v.map(String) : null
  const s = String(v ?? '').replace(/[^A-Za-z′']/g, '')
  const m = s.match(/([A-Za-z]['′]?)([A-Za-z]['′]?)/)
  return m ? [m[1], m[2]] : null
}

/**
 * 把视觉模型写在点上的 derived 字段翻译成约束。
 *
 * 模型对这个字段的键名很随意（prompt 只举了 on_segment 一例，且是扁平写法
 * { "on_segment": "AB" }），垂足/中点/交点没有给格式，实测会写成嵌套对象。
 * 两种形态都必须认，否则模型标了 derived 却一条约束都抽不出来：
 *   扁平：{ foot_of: 'C', perpendicular_to: 'AB' }
 *   嵌套：{ foot: { from: 'C', on_line: ['A', 'B'] } }
 *
 * 支持的类型：垂足 / 中点 / 两线交点 / 落边落线 / 在圆上 / 折叠对称像 / 重心·内心·外心。
 * 其余（rotate 等）不映射——prompt 没要求，凭空认键名会造出错约束。
 *
 * 注意：parseSeg 对对象会退化成 String(obj)="[object Object]"，剥非字母后切出
 * "ob" 这类垃圾字母。所以对象必须先由 obj() 识别并走嵌套分支，绝不能直接丢给 parseSeg。
 *
 * 注意这一路的可信度低于题干：模型经常漏标 derived（实测两个垂足都没标），
 * 也可能标错线段——它只作为题干抽取的补充。
 */
export function fromDerivedField(label, derived, raw = '') {
  const out = []
  if (!label || !derived || typeof derived !== 'object') return out
  const push = (type, args) => {
    const c = makeConstraint(type, args, 'model_derived', raw)
    if (c) out.push(c)
  }
  const get = (...keys) => {
    for (const k of keys) if (derived[k] != null) return derived[k]
    return null
  }
  /** 只接受非数组对象；数组/字符串走 parseSeg 的扁平分支 */
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : null
  /** 只接受非空字符串（对象/数组一律判否，避免 String(obj) 污染） */
  const str = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null
  /** 只对字符串/数组做 parseSeg；对象一律判否（否则 String(obj) 会切出 "ob" 这类垃圾字母） */
  const seg = (v) => (typeof v === 'string' || Array.isArray(v)) ? parseSeg(v) : null
  /** 三顶点（重心/内心/外心的 of）：接受 'ABC' 或 ['A','B','C']，必须恰好 3 个 */
  const tri = (v) => {
    const arr = Array.isArray(v)
      ? v.map(String)
      : (typeof v === 'string' ? [...v.matchAll(/[A-Z][′'’]?/g)].map(x => x[0].replace(/[′'’]/g, '′')) : [])
    return arr.length === 3 ? arr : null
  }

  const footRaw = get('foot', 'footOf', 'foot_of')
  const midRaw = get('midpoint', 'midpointOf', 'midpoint_of', 'mid_of')
  const interRaw = get('intersection', 'intersectionOf', 'intersection_of', 'intersect_of')
  const footObj = obj(footRaw)
  const midObj = obj(midRaw)
  const interObj = obj(interRaw)

  const onSeg = seg(get('on_segment', 'onSegment', 'on', 'segment'))
  const onLine = seg(get('on_line', 'onLine', 'line'))
  const midOf = seg(midRaw)
    || (midObj ? seg(midObj.of ?? midObj.segment ?? midObj.on ?? midObj.line) : null)
  const footFrom = str(get('foot_of', 'footOf', 'foot_from', 'footFrom', 'from'))
    || (footObj ? str(footObj.from ?? footObj.source ?? footObj.of) : null)
  const footOn = seg(get('perpendicular_to', 'perpendicularTo', 'foot_on', 'onLine', 'on_segment'))
    || (footObj ? seg(footObj.on_line ?? footObj.onLine ?? footObj.to ?? footObj.line ?? footObj.on) : null)
  const onCircle = str(get('on_circle', 'onCircle', 'circle'))

  if (footFrom && footOn) push('foot', { point: label, from: footFrom, onLine: footOn })
  else if (midOf) push('midpoint', { point: label, of: midOf })
  else if (onSeg) push('on_segment', { point: label, of: onSeg })
  else if (onLine) push('on_line', { point: label, of: onLine })

  // 折叠/对称的像：{ reflect_of: 'B', axis: 'AC' } 或 { reflect: { source:'B', axis:['A','C'] } }
  // 带撇点（B′）是原像点关于轴的镜像，轴缺失就整条不认——猜轴会把图拧变形。
  const reflectRaw = get('reflect', 'reflectOf', 'reflect_of', 'fold', 'folded_from', 'mirror_of')
  const reflectObj = obj(reflectRaw)
  const reflectSource = str(reflectRaw)
    || (reflectObj ? str(reflectObj.source ?? reflectObj.from ?? reflectObj.of) : null)
    || (reflectRaw != null ? str(get('source', 'from')) : null)
  const reflectAxis = (reflectObj
    ? seg(reflectObj.axis ?? reflectObj.over ?? reflectObj.across ?? reflectObj.line ?? reflectObj.on_line)
    : null)
    || (reflectRaw != null ? seg(get('axis', 'over', 'across')) : null)
  if (reflectSource && reflectAxis) push('reflect', { point: label, source: reflectSource, axis: reflectAxis })

  // 三心：{ centroid_of: 'ABC' } / { incenter_of: 'ABC' } / { circumcenter_of: 'ABC' }
  const CENTER_KEYS = [
    ['centroid', ['centroid', 'centroidOf', 'centroid_of']],
    ['incenter', ['incenter', 'incenterOf', 'incenter_of']],
    ['circumcenter', ['circumcenter', 'circumcenterOf', 'circumcenter_of', 'orthocenter_of']]
  ]
  for (const [type, keys] of CENTER_KEYS) {
    const raw = get(...keys)
    const of = tri(raw) || (obj(raw) ? tri(raw.of ?? raw.vertices ?? raw.points ?? raw.triangle) : null)
    if (of) push(type, { point: label, of })
  }

  // 交点：扁平 ['AF','DE'] 与嵌套 { l1, l2 } 两种形态
  const interPair = Array.isArray(interRaw) && interRaw.length === 2
    ? interRaw.map(seg)
    : (interObj
      ? [
        seg(interObj.l1 ?? interObj.line1 ?? interObj.first ?? interObj.of ?? interObj.a),
        seg(interObj.l2 ?? interObj.line2 ?? interObj.second ?? interObj.with ?? interObj.b)
      ]
      : null)
  if (interPair && interPair[0] && interPair[1]) {
    push('line_intersect', { point: label, l1: interPair[0], l2: interPair[1] })
  }
  if (onCircle && !onSeg && !onLine) push('on_circle', { point: label, circle: onCircle })
  return out
}

/**
 * 模型 constraints 数组里的对象型条目。实测该字段几乎总是空数组，
 * 有值时形如 { type:'parallel', segments:['AB','CD'] }。字符串型条目
 * （"∠BAD = 50°"）不在这里处理——交给题干抽取器当普通文本解析。
 */
export function fromModelObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const type = String(obj.type || '').toLowerCase()
  const segs = Array.isArray(obj.segments) ? obj.segments.map(parseSeg).filter(Boolean) : []
  const raw = JSON.stringify(obj)
  if ((type === 'parallel' || type === 'perpendicular') && segs.length >= 2) {
    return makeConstraint(type, { l1: segs[0], l2: segs[1] }, 'model_constraints', raw)
  }
  if ((type === 'equal' || type === 'equal_length') && segs.length >= 2) {
    return makeConstraint('equal_length', { segs }, 'model_constraints', raw)
  }
  if (type === 'midpoint' && obj.point && segs.length >= 1) {
    return makeConstraint('midpoint', { point: String(obj.point), of: segs[0] }, 'model_constraints', raw)
  }
  return null
}

/**
 * 合并多路约束并去重。同键冲突时保留 source 优先级高的那条
 * （题干 > 模型 derived > 模型 constraints）。
 *
 * @returns {{constraints: object[], duplicates: object[]}}
 */
export function mergeConstraints(...lists) {
  const byKey = new Map()
  const duplicates = []
  for (const list of lists) {
    for (const c of (list || [])) {
      if (!c || !CONSTRAINT_TYPES[c.type]) continue
      const k = constraintKey(c)
      const prev = byKey.get(k)
      if (!prev) { byKey.set(k, c); continue }
      const win = (SOURCE_PRIORITY[c.source] || 0) > (SOURCE_PRIORITY[prev.source] || 0) ? c : prev
      const lose = win === c ? prev : c
      byKey.set(k, win)
      duplicates.push({ key: k, kept: win.source, dropped: lose.source })
    }
  }
  return { constraints: [...byKey.values()], duplicates }
}



