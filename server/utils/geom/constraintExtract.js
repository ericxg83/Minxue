/**
 * 从中文题干抽取几何约束。
 *
 * 这是求解器最重要的一路输入：视觉模型给的点坐标是目测的，而且它经常漏标 derived
 * （实测某题两个垂足都没标），所以「D 是 BD 到 AC 的垂足」这类事实只能从题干读出来。
 * 题干还是唯一干净的独立证据源——图上混着学生笔迹，模型自我验证抓不到自身偏差。
 *
 * 纪律：抽不准就不抽。每条候选约束的点字母必须同时出现在题干引用点集与结构点集里，
 * 涉及的线段必须能在题干找到出处，否则丢进 dropped 供人工复核。宁可少一条约束
 * （退化成自由点，图形维持模型形状），也不能凭空造一条把图形拧变形。
 */

import {
  extractReferencedPoints,
  extractReferencedSegments,
  extractLetterRuns
} from '../geometryContentGate.js'
import {
  makeConstraint,
  mergeConstraints,
  fromDerivedField,
  fromModelObject
} from './constraintSchema.js'

const P = String.raw`[A-Z][′'’]?`
const norm = (s) => String(s ?? '').replace(/[′'’]/g, '′')
const re = (body, flags = 'g') => new RegExp(body.replace(/\bP\b/g, P), flags)
/** 找首处的单次匹配正则（.match 语义），用于「从片段里找轴」这类需要捕获组的场景 */
const reOnce = (body) => re(body, '')
const splitPoints = (run) => [...String(run).matchAll(new RegExp(P, 'g'))].map(m => norm(m[0]))

/** 结论不是条件：求证式里的等式描述的是待证目标，抄成约束会把图拧成"已证"的样子 */
// ·/×/⋅ 是乘积式（BD·DE=BE·CD），+/- 是线段和差式（DE=AD+BE）——两种都是结论或
// 中间推导，不是构造题图的条件。它们的方向性信号会出现在等长匹配片段的 ctx 里。
const CONCLUSION_RE = /·|×|⋅|[+\u2212\-]|求证|证明|试证|说明理由|判断/

/**
 * 角标记会污染线段正则："∠CDC′=∠DAC′" 会被读成线段 DC′=DA。
 * 所以线段类约束一律在抹掉 ∠XYZ 之后再抽。
 */
const maskAngles = (text) => text.replace(re(String.raw`∠\s*(?:P){1,3}`), '∠_')

/**
 * 把 letterRuns 展开成允许的边集：△ABC → AB/BC/CA，四边形ABCD → AB/BC/CD/DA。
 * 注意 runs 来自 extractLetterRuns，已经按相邻对展开；这里只做去重与键归一化。
 */
function runAdjacentSegs(runs) {
  const out = new Set()
  for (const run of runs) {
    if (!Array.isArray(run) || run.length < 2) continue
    // 多边形闭合：首尾也视为相邻（四边形 ABCD 含 DA）
    for (let i = 0; i < run.length; i++) {
      const a = run[i]
      const b = run[(i + 1) % run.length]
      if (a && b && a !== b) out.add([a, b].sort().join('|'))
    }
  }
  return out
}

/**
 * 额外允许的"隐式边"：当题干显式提到某条线（如"直线 CD"、"线段 BE"），
 * 即使它不在 letterRuns 的相邻对里，也应被允许。这覆盖了尺规作图题
 * "过 C 作直线 CD"这类句式——CD 是人为构造的线，不会出现在 △ABC 的 run 里。
 */
function explicitLineSegs(text) {
  const out = new Set()
  // "直线 XY" / "线段 XY" / "射线 XY" / "连接 XY"
  for (const m of String(text).matchAll(/(?:直线|线段|射线|连接)\s*([A-Z][′'’]?)([A-Z][′'’]?)/g)) {
    const a = m[1].replace(/[′'']/g, '′')
    const b = m[2].replace(/[′'']/g, '′')
    if (a !== b) out.add([a, b].sort().join('|'))
  }
  return out
}

/**
 * 从题干抽取全部约束。三路合并：题干文本（主）+ 模型 derived + 模型 constraints。
 *
 * @param {string} content - 题干文本
 * @param {object} structure - normalizeStructure 后的结构
 * @returns {{constraints: object[], dropped: {raw:string, reason:string}[]}}
 */
export function extractConstraints(content, structure) {
  const text = String(content || '')
  const points = (structure?.points || []).map(p => p.label).filter(Boolean)
  const pointSet = new Set(points)
  const refPts = extractReferencedPoints(text)
  const refSegs = extractReferencedSegments(text)
  const runs = extractLetterRuns(text)
  const allowedSegs = new Set([...refSegs, ...runAdjacentSegs(runs), ...explicitLineSegs(text)])

  const dropped = []
  const candidates = []

  // ── 1. 模型 derived 字段 ──
  for (const p of structure?.points || []) {
    if (!p?.label || !p.derived) continue
    for (const c of fromDerivedField(p.label, p.derived)) candidates.push(c)
  }

  // ── 2. 模型 constraints 数组里的对象型条目 ──
  for (const raw of structure?.constraints || []) {
    if (typeof raw === 'string') continue
    const c = fromModelObject(raw)
    if (c) candidates.push(c)
  }

  // ── 3. 题干文本正则抽取 ──
  const masked = maskAngles(text)

  // 垂足：BD⊥AC 于点 D / 过点 D 作 AC 的垂线，垂足为 E / ∠ABC=90°
  for (const m of text.matchAll(re(String.raw`(P)(P)\s*⊥\s*(P)(P)(?:\s*于(?:点)?\s*(P))?`))) {
    const [l1a, l1b, l2a, l2b, foot] = [m[1], m[2], m[3], m[4], m[5]].map(norm)
    candidates.push(makeConstraint('perpendicular', { l1: [l1a, l1b], l2: [l2a, l2b] }, 'text', m[0]))
    if (foot) candidates.push(makeConstraint('foot', { point: foot, from: l1a, onLine: [l2a, l2b] }, 'text', m[0]))
  }
  for (const m of text.matchAll(re(String.raw`过点?(P)作(P)(P)的垂线[，,]?\s*垂足(?:为|是)点?(P)`))) {
    const [foot, a, b, _] = [m[1], m[2], m[3], m[4]].map(norm)
    candidates.push(makeConstraint('foot', { point: foot, from: _, onLine: [a, b] }, 'text', m[0]))
  }
  // 作点 B 到直线 CD 的垂线，垂足为点 E（尺规作图题常用，没有「过/于点」字样）
  for (const m of text.matchAll(re(String.raw`作点?(P)到(?:直线|线段|射线)?\s*(P)(P)\s*的垂线[，,]?\s*垂足(?:为|是)点?(P)`))) {
    const [from, la, lb, foot] = [m[1], m[2], m[3], m[4]].map(norm)
    if (!lb || lb === foot) continue
    candidates.push(makeConstraint('foot', { point: foot, from, onLine: [la, lb] }, 'text', m[0]))
  }
  for (const m of text.matchAll(re(String.raw`∠\s*(P)(P)(P)\s*=\s*90\s*°`))) {
    const [a, v, b] = [m[1], m[2], m[3]].map(norm)
    candidates.push(makeConstraint('perpendicular', { l1: [v, a], l2: [v, b] }, 'text', m[0]))
  }

  // 中点
  for (const m of text.matchAll(re(String.raw`(P)\s*(?:是|为)\s*(?:边|线段)?(P)(P)\s*的中点`))) {
    const [pt, a, b] = [m[1], m[2], m[3]].map(norm)
    candidates.push(makeConstraint('midpoint', { point: pt, of: [a, b] }, 'text', m[0]))
  }
  for (const m of text.matchAll(re(String.raw`取(P)(P)的中点(P)`))) {
    const [a, b, pt] = [m[1], m[2], m[3]].map(norm)
    candidates.push(makeConstraint('midpoint', { point: pt, of: [a, b] }, 'text', m[0]))
  }

  // 平行：CD∥AB / CD//AB（OCR 常把 ∥ 识别成两个斜杠）
  for (const m of text.matchAll(re(String.raw`(P)(P)\s*(?:∥|//)\s*(P)(P)`))) {
    const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map(norm)
    candidates.push(makeConstraint('parallel', { l1: [a, b], l2: [c, d] }, 'text', m[0]))
  }
  for (const m of text.matchAll(re(String.raw`过点?(P)作(P)(P)的平行线`))) {
    // 这种句式只声明"有一条过 P 平行于 AB 的线"，没有给出第二条线的端点，无法形成硬约束。
    // 记入 dropped 供人工看，不进入求解器。
    dropped.push({ raw: m[0], reason: 'parallel_through_point_no_second_line' })
  }
  for (const m of text.matchAll(re(String.raw`平行四边形\s*(P)(P)(P)(P)`))) {
    const vs = [m[1], m[2], m[3], m[4]].map(norm)
    candidates.push(makeConstraint('polygon_shape', { kind: 'parallelogram', vertices: vs }, 'text', m[0]))
    candidates.push(makeConstraint('parallel', { l1: [vs[0], vs[1]], l2: [vs[2], vs[3]] }, 'text', m[0]))
    candidates.push(makeConstraint('parallel', { l1: [vs[1], vs[2]], l2: [vs[3], vs[0]] }, 'text', m[0]))
  }

  // 折叠：将△BCE沿着BE折叠得到△BC′E / △BCE折叠后落在△BC′E
  //   → reflect(派生点, 原像点, axis=折叠线)。带撇的是派生点（C→C′）。
  //   轴（折叠线）可能显式给出（沿着BE），也可能只说「折叠后落在」需从上下文找。
  const foldRe = re(String.raw`(?:将|把)?\s*△\s*(P)(P)(P)\s*(?:(?:沿着|沿|以)\s*(P)(P)\s*(?:所在直线)?)?\s*(?:折叠|翻折|对折)(?:后)?\s*(?:得到|落在)\s*△\s*(P′?)(P′?)(P′?)`)
  for (const m of text.matchAll(foldRe)) {
    const src = [m[1], m[2], m[3]].map(norm)
    const axis = (m[4] && m[5]) ? [norm(m[4]), norm(m[5])] : null
    const dst = [m[6], m[7], m[8]].map(norm)
    for (let i = 0; i < 3; i++) {
      if (dst[i].endsWith('′') && src[i] !== dst[i]) {
        if (axis) {
          candidates.push(makeConstraint('reflect', { point: dst[i], source: src[i], axis }, 'text', m[0]))
        } else {
          dropped.push({ raw: m[0], reason: `reflect_pair_without_axis:${src[i]}→${dst[i]}` })
        }
      }
    }
  }

  // 旋转
  for (const m of text.matchAll(re(String.raw`绕(?:着)?(?:点)?(P)\s*(?:顺|逆)时针\s*(?:旋转)?\s*(\d+(?:\.\d+)?)\s*°`))) {
    dropped.push({ raw: m[0], reason: 'rotate_needs_source_point' })
  }

  // 角平分线
  for (const m of text.matchAll(re(String.raw`(P)(P)\s*(?:是|为)?\s*∠\s*(P)(P)(P)\s*的(?:角)?平分线`))) {
    const [r1, r2, a, v, b] = [m[1], m[2], m[3], m[4], m[5]].map(norm)
    candidates.push(makeConstraint('angle_bisector', { ray: [v, r2], of: { vertex: v, from: a, to: b } }, 'text', m[0]))
  }
  // ∠BAC 的平分线 AG（射线在「平分线」后面）——OCR 常见句式，与射线在前是同一事实
  for (const m of text.matchAll(re(String.raw`∠\s*(P)(P)(P)\s*的(?:角)?平分线\s*(P)(P)`))) {
    const [a, v, b, r1, r2] = [m[1], m[2], m[3], m[4], m[5]].map(norm)
    candidates.push(makeConstraint('angle_bisector', { ray: [v, r2], of: { vertex: v, from: a, to: b } }, 'text', m[0]))
  }
  for (const m of text.matchAll(re(String.raw`平分\s*∠\s*(P)(P)(P)`))) {
    dropped.push({ raw: m[0], reason: 'bisector_without_ray' })
  }

  // 圆：△ABC 内接于 ⊙O / ⊙O 是 △ABC 的外接圆 → on_circle × 3 + circle_center
  // 注意题干常写「三角形ABC」而不是符号「△ABC」，两者都要认。
  for (const m of text.matchAll(re(String.raw`(?:△|三角形)\s*(P)(P)(P)\s*(?:内接于|的外接圆(?:是|为)?)\s*⊙(P)`))) {
    const vs = [m[1], m[2], m[3]].map(norm)
    const o = norm(m[4])
    for (const v of vs) candidates.push(makeConstraint('on_circle', { point: v, circle: o }, 'text', m[0]))
    candidates.push(makeConstraint('circle_center', { point: o, circle: o }, 'text', m[0]))
  }
  for (const m of text.matchAll(re(String.raw`⊙(P)\s*(?:是|为)\s*△(P)(P)(P)\s*的内切圆`))) {
    const o = norm(m[1])
    const vs = [m[2], m[3], m[4]].map(norm)
    candidates.push(makeConstraint('incenter', { point: o, of: vs }, 'text', m[0]))
  }

  // 角度值
  for (const m of text.matchAll(re(String.raw`∠\s*(P)(P)(P)\s*=\s*(\d+(?:\.\d+)?)\s*°`))) {
    const [a, v, b] = [m[1], m[2], m[3]].map(norm)
    const deg = Number(m[4])
    if (Number.isFinite(deg)) candidates.push(makeConstraint('angle_value', { vertex: v, from: a, to: b, deg }, 'text', m[0]))
  }

  // 等长：AB=CD / AB=BC=CA（链式展开）。排除求证式/乘积式。
  for (const m of masked.matchAll(re(String.raw`(P)(P)\s*=\s*(P)(P)(?:\s*=\s*(P)(P))*`))) {
    // 乘积式自带点乘号会干扰正则——BD·DE=BE·CD 会被读成 "DE=BE"（两端都紧贴 ·）。
    // 把匹配前后各 2 个字符并入判断，扫到 ·/×/求证 等结论性信号就丢弃。
    const ctx = masked.slice(Math.max(0, m.index - 2), m.index + m[0].length + 2)
    if (CONCLUSION_RE.test(ctx)) continue
    const segs = []
    for (let i = 0; i < m.length - 2; i += 2) {
      if (m[i + 1] && m[i + 2]) segs.push([norm(m[i + 1]), norm(m[i + 2])])
    }
    if (segs.length >= 2) candidates.push(makeConstraint('equal_length', { segs }, 'text', m[0]))
  }

  // 形状词
  for (const m of text.matchAll(/正方形\s*([A-Z][′'’]?(?:[A-Z][′'’]?){3})/g)) {
    const vs = splitPoints(m[1])
    if (vs.length === 4) candidates.push(makeConstraint('polygon_shape', { kind: 'square', vertices: vs }, 'text', m[0]))
  }
  for (const m of text.matchAll(/菱形\s*([A-Z][′'’]?(?:[A-Z][′'’]?){3})/g)) {
    const vs = splitPoints(m[1])
    if (vs.length === 4) candidates.push(makeConstraint('polygon_shape', { kind: 'rhombus', vertices: vs }, 'text', m[0]))
  }
  for (const m of text.matchAll(/(?:等边三角形|正三角形)\s*([A-Z][′'’]?(?:[A-Z][′'’]?){2})/g)) {
    const vs = splitPoints(m[1])
    if (vs.length === 3) candidates.push(makeConstraint('polygon_shape', { kind: 'equilateral', vertices: vs }, 'text', m[0]))
  }
  for (const m of text.matchAll(/等腰(?:直角)?三角形\s*([A-Z][′'’]?(?:[A-Z][′'’]?){2})/g)) {
    const vs = splitPoints(m[1])
    if (vs.length === 3) candidates.push(makeConstraint('polygon_shape', { kind: 'isosceles', vertices: vs }, 'text', m[0]))
  }

  // ── 防溢出校验：字母必须在题干引用点集 ∩ 结构点集里，线段必须在允许边集里 ──
  const validated = []
  for (const c of candidates) {
    if (!c) continue
    const letters = collectLetters(c)
    const badLetter = letters.find(l => !pointSet.has(l) || !refPts.has(l))
    if (badLetter) {
      dropped.push({ raw: c.raw, reason: `letter_not_in_both:${badLetter}` })
      continue
    }
    const segs = collectSegs(c)
    // 模型声明的 foot 隐含着 from→point 这条线段（A 到 BC 的垂足 D 意味着 AD）。
    // 题干没提过这条线的模型声称不可信，一并校验——无法在题干找到出处就拦下。
    if (c.type === 'foot' && c.source !== 'text' && c.args?.from && c.args?.point) {
      segs.push([c.args.from, c.args.point].sort().join('|'))
    }
    const badSeg = segs.find(s => !allowedSegs.has(s))
    if (badSeg) {
      dropped.push({ raw: c.raw, reason: `seg_not_referenced:${badSeg}` })
      continue
    }
    validated.push(c)
  }

  const { constraints, duplicates } = mergeConstraints(validated)
  return { constraints, dropped, duplicates }
}

/** 收集一条约束涉及的所有点字母（用于防溢出校验） */
function collectLetters(c) {
  const out = []
  const add = (v) => { if (typeof v === 'string' && /^[A-Z][′']?$/.test(v)) out.push(v) }
  const walk = (o) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) {
      // 数组元素可能是单字母字符串（l1:['B','D']），也可能是嵌套对象/数组
      for (const x of o) {
        if (typeof x === 'string') add(x)
        else walk(x)
      }
      return
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'deg' || k === 'value' || k === 'kind' || k === 'raw') continue
      if (typeof v === 'string') add(v)
      else walk(v)
    }
  }
  walk(c.args)
  return out
}

/** 收集一条约束涉及的所有无向线段键（用于防溢出校验） */
function collectSegs(c) {
  const out = []
  const push = (ab) => {
    if (Array.isArray(ab) && ab.length === 2) out.push([...ab].sort().join('|'))
  }
  const a = c.args || {}
  if (a.l1) push(a.l1)
  if (a.l2) push(a.l2)
  if (a.of && Array.isArray(a.of) && a.of.length === 2) push(a.of)
  if (a.axis) push(a.axis)
  if (a.line) push(a.line)
  if (Array.isArray(a.segs)) a.segs.forEach(push)
  return out
}
