/**
 * 函数图象复合构造：抛物线 + 直线（相交/弦/与顶点连线）——确定性，零模型调用。
 *
 * 背景（2026-09-27，「35条其他」处理）：纯度闸 `hasOtherGeometry` 把一切含
 * 三角形/线段/直线字样的题干判为「本通道画不出」→ 落回几何 DSL 目测通道，
 * 而 DSL 渲染器画不出曲线，于是「抛物线 y=(x-2)² 顶点 C，直线 y=2x+4 交抛物线
 * 于 A、B，求 △ABC」这类**表达式全在题面里**的题被两头拒之门外，长期停留在
 * 描摹/裁片显示。用户判语：「是重绘/函数图象通道没接上，不属于图元」。
 *
 * 本模块把这类复合构造接进确定性通道，纪律与主通道一致——**拼不出完整图就 null**：
 *   1. 直线必须显式 `直线y=kx+b`（k、b 全数字），且写明「与抛物线交于X、Y两点」；
 *   2. 联立必须有两个**不同实根**（相切/不相交 → 图与题不符，拒绝）；
 *   3. X、Y 不得与「与x轴交于X、Y两点」的字母声明冲突（同字母不能既在 x 轴又在交点）；
 *   4. 三角形只认「△XYV 且 V 是题面写明坐标的抛物线顶点」（顶点=题干字母）；
 *   5. 弦/三角形的边只画**题干点过名的**（△ABC→三边、直线AB→直线本体）。
 * 任何一环缺证据 → null，调用方按旧行为回退（描摹/原卷裁片），零回归。
 *
 * 交点坐标是**解出来的**（联立二次方程），不是目测；直线按视野窗口求端点，
 * 画成穿过两交点的直线（教材惯例）。
 */

import { solveLineParabolaRoots } from './buildStructure.js'

const NUM = '\\d+(?:\\.\\d+)?(?:/\\d+)?'

/**
 * 从题干文本（须先过 normalizeText 同规则归一，或直接传原文——内部会归一关键符号）
 * 解析「直线y=kx+b 与抛物线交于X、Y两点（+ 顶点为V / △XYV）」。
 *
 * @param {string} text parentStem + ' ' + content
 * @returns {{k:number,b:number,l1:string,l2:string,vertexLabel:string|null,triangle:boolean}|null}
 */
export function parseLineParabola(text) {
  const s = String(text ?? '')
    .replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[－−–—]/g, '-').replace(/[＋]/g, '+').replace(/[＝]/g, '=')
    .replace(/\$/g, '').replace(/\\[()[\]]/g, '')
    .replace(/\s+/g, ' ')

  // ── 1. 直线本体：直线y=kx+b / 直线y=kx / 直线y=b（水平线） ──
  const lm = s.match(new RegExp(`直线\\s*y\\s*=\\s*(?:(${NUM})\\s*\\*?\\s*x\\s*(?:([+-])\\s*(${NUM}))?|([+-])?(${NUM})(?![\\d.]))`))
  if (!lm) return null
  const num = (t) => {
    if (t == null || t === '') return null
    const m = String(t).match(/^([-+]?)((\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?)$/)
    if (!m) return NaN
    const v = m[3].includes('/') ? Number(m[3].split('/')[0]) / Number(m[3].split('/')[1]) : Number(m[3])
    return m[1] === '-' ? -v : v
  }
  let k = null, b = null
  if (lm[1] != null || lm[3] != null) {
    k = lm[1] != null ? num(lm[1]) : 1
    if (s.match(new RegExp(`直线\\s*y\\s*=\\s*(?:${NUM})?\\s*\\*?\\s*x\\s*\\+\\s*x`))) return null // x²等高次混入
    b = lm[3] != null ? num((lm[2] === '-' ? '-' : '+') + lm[3]) : 0
    // 排除把 y=kx²+… 的二次式当直线：k 后若紧跟 x^2 / x² 直接拒
    const afterX = s.match(new RegExp(`直线\\s*y\\s*=\\s*${NUM}?\\s*\\*?\\s*x\\s*(\\^2|²)`))
    if (afterX && lm[1] != null && lm[3] == null) return null
  } else {
    k = 0
    b = num((lm[4] === '-' ? '-' : '') + lm[5])
  }
  if (!Number.isFinite(k) || !Number.isFinite(b)) return null

  // ── 2. 交点字母：与(抛物线)?交于X、Y两点（X、Y 须是相邻两字母声明） ──
  const im = s.match(new RegExp(`交\\s*(?:于|在)\\s*(?:点)?\\s*([A-Z])\\s*(?:点)?\\s*[、,，和与]\\s*(?:点)?\\s*([A-Z])\\s*两点`))
  if (!im || im[1] === im[2]) return null
  const l1 = im[1], l2 = im[2]

  // ── 3. 顶点字母：(抛物线|曲线)…的?顶点(坐标)?为|是V[(h,k)] ──
  let vertexLabel = null
  const vm = s.match(/顶点\s*(?:坐标)?\s*(?:为|是)\s*([A-Z])?(?:\(\s*(-?[\d./]+)\s*,\s*(-?[\d./]+)\s*\))?/)
  if (vm && vm[1] && vm[1] !== l1 && vm[1] !== l2) vertexLabel = vm[1]

  // ── 4. 三角形：△l1l2V（第三点必须就是顶点字母） ──
  let triangle = false
  if (vertexLabel) {
    const tm = s.match(new RegExp(`△\\s*(${l1})\\s*(${l2})\\s*([A-Z])|△\\s*(${l1})\\s*([A-Z])\\s*(${l2})|△\\s*([A-Z])\\s*(${l1})\\s*(${l2})`))
    const third = tm && ([tm[3], tm[6], tm[9]].find(x => x))
    if (third === vertexLabel) triangle = true
  }

  return { k, b, l1, l2, vertexLabel, triangle }
}

/**
 * 把复合构造并进通道产出的 structure（points/segments/curves 与确定性骨架同格式）。
 *
 * @param {object} structure specToGeometryStructure 的产物（含 curves[0] 采样、O 点）
 * @param {object} spec parseFunctionGraphSpec 的返回值（y=a(x-h)²+k）
 * @param {object} lp parseLineParabola 的返回值
 * @returns {object|null} 新 structure（不改动入参），拼不出返回 null
 */
export function applyLineParabola(structure, spec, lp) {
  const a = spec?.a, h = spec?.vertex?.x, k0 = spec?.vertex?.y
  if (!structure?.curves?.length || !Number.isFinite(a) || a === 0) return null
  if (!Number.isFinite(h) || !Number.isFinite(k0)) return null
  const { k: lk, b: lb, l1, l2, vertexLabel, triangle } = lp

  // ── 联立求交点（坐标是解出来的，不是目测）──
  const roots = solveLineParabolaRoots(a, h, k0, lk, lb)
  if (!roots) return null // 相切/不相交：与题面「交于两点」矛盾，拒绝
  const [xa, xb] = roots
  const ya = lk * xa + lb, yb = lk * xb + lb
  if (![xa, ya, xb, yb].every(Number.isFinite)) return null

  // ── 视野校验：computeView 已按 spec.line 扩窗重采样，两点必须在窗口内 ──
  const curve = structure.curves[0].points
  if (!curve.length) return null
  const xLo = Math.min(...curve.map(p => p[0])), xHi = Math.max(...curve.map(p => p[0]))
  const tolX = (xHi - xLo) * 0.1
  if (xa < xLo - tolX || xb > xHi + tolX) return null // 窗口仍容不下：不出图，回退原行为

  const pts = new Map((structure.points || []).map(p => [p.label, p]))
  // 字母冲突保护：同字母已被「与x轴交于L1、L2两点」声明（一图两义）→ 拒绝
  const il = spec.xInterceptLabels || []
  if (il.includes(l1) || il.includes(l2)) return null
  for (const [lab, x, y] of [[l1, xa, ya], [l2, xb, yb]]) {
    const exist = pts.get(lab)
    if (exist) {
      if (Math.abs(exist.x - x) > 1e-6 || Math.abs(exist.y - y) > 1e-6) return null // 同字母坐标打架
      continue
    }
    pts.set(lab, { label: lab, x, y, type: 'vertex' })
  }

  const P = (lab) => pts.get(lab)
  const segs = [...(structure.segments || [])]

  // ── 直线本体：与曲线采样同窗口求端点（画成穿过两交点的直线） ──
  // 端点取 [xLo,xHi] 上直线的两点；若 y 超出曲线采样 y 范围太多则收缩窗口，
  // 渲染器按全要素包围盒自适应，多出的留白可接受。
  const lx1 = xLo - (xHi - xLo) * 0.06, lx2 = xHi + (xHi - xLo) * 0.06
  const ly1 = lk * lx1 + lb, ly2 = lk * lx2 + lb
  if (!Number.isFinite(ly1) || !Number.isFinite(ly2)) return null
  if (!P('_LINE_p1')) {
    pts.set('_LINE_p1', { label: '_LINE_p1', x: lx1, y: ly1, type: 'vertex' })
    pts.set('_LINE_p2', { label: '_LINE_p2', x: lx2, y: ly2, type: 'vertex' })
    segs.push({ from: '_LINE_p1', to: '_LINE_p2', style: 'solid' })
  }

  // ── 弦 L1L2（两交点连线段；题干「交于L1、L2」即点名） ──
  segs.push({ from: l1, to: l2, style: 'solid' })

  // ── 三角形：仅当题面写明 △L1L2V 且 V 有确定坐标（顶点=题干字母） ──
  if (triangle && vertexLabel && !P(vertexLabel)) {
    pts.set(vertexLabel, { label: vertexLabel, x: h, y: k0, type: 'vertex' })
  }
  if (triangle && vertexLabel && P(vertexLabel)) {
    segs.push({ from: l1, to: vertexLabel, style: 'solid' })
    segs.push({ from: l2, to: vertexLabel, style: 'solid' })
  }

  return {
    ...structure,
    points: [...pts.values()],
    segments: segs,
    _lineComposite: { line: `y=${lk}x${lb >= 0 ? '+' : ''}${lb}`, through: [l1, l2], vertex: vertexLabel || null, triangle },
  }
}
