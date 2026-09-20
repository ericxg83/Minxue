/**
 * DSL 命令表。
 *
 * 命名与语义**直接对齐 GeoBuildBench**（ooongs/GeoBuildBench, MIT）的
 * `prompts/system_prompt.txt` 与 `src/core/commands.py`：
 *   point / segment / line / ray / circle / circumcircle / incircle
 *   midpoint / orthogonal_line / parallel_line / line_bisector / angular_bisector
 *   intersect / rotate / mirror / incenter / circumcenter / polygon
 *
 * 与 GeoBuildBench 的三处**刻意偏离**（都写在注释里，避免以后误当成 bug）：
 *   1. 补了 `foot`（垂足）与 `centroid`（重心）：它们直接对应我们求解器的
 *      foot / centroid 约束类型，让模型少绕一步（GeoBuildBench 要用
 *      orthogonal_line + intersect 两条命令表达垂足）。三心原版只有
 *      incenter / circumcenter，没有重心。
 *   2. 补了 `shade`（填充多边形，教材"求阴影部分面积"的灰底）与
 *      `right_angle` / `angle_mark` / `label`（直角标记/角标记/文字标注）——
 *      我们自己的 SVG 渲染器有这些图元，GeoBuildBench 靠 matplotlib 自动标注，没有对应命令。
 *   3. **没有**采纳 GeoBuildBench "禁止 polygon 命令" 的规矩：我们的渲染器支持多边形
 *      （阴影要用），所以 `polygon` 合法，并且会自动登记边界线段，
 *      既保证渲染正确，也让内容闸门看得到这些边。
 *
 * 对象模型（executor 内部）：
 *   point   { kind:'p', label, x, y, derived? }
 *   segment { kind:'s', label, a, b }                  a/b 是点 label
 *   line    { kind:'l', label, p:{x,y}, d:{x,y}, via? } p 过点，d 单位方向
 *   ray     { kind:'r', label, p, d, via? }             同上，但只取 p 一侧
 *   circle  { kind:'c', label, c:{x,y}, r, centerLabel? }
 *   arc     { kind:'C', label, center, from, to }       三者都是点 label
 *   polygon { kind:'P', label, points:[label], fill }
 *   curve   { kind:'k', label, points:[[x,y]], expr }   函数图象采样点（不经内容闸门）
 *
 * 纪律：**不猜**。任何歧义（交点个数与输出个数不符、圆退化成点、
 * 输入类型不对）都返回 error 交 ReAct 循环修，绝不"挑一个最像的"。
 */

import {
  dist, unit, sub, add, scale, mid, dot, cross, len,
  footOfPerp, lineIntersect, reflectOverLine, rotateAbout,
  circleLineIntersect, circleCircleIntersect,
  centroid, incenter, circumcenter
} from '../vec.js'
import { evalFunctionAt } from './expr.js'

const EPS = 1e-9

/** curve 采样点数：奇数是让顶点（极值点）尽可能落在采样点上 */
const CURVE_SAMPLES = 121

/**
 * 函数图象裁剪：丢掉纵向离群点。
 *
 * 为什么需要：`1/x` 这类在定义域内发散的函数，采样点会跑到 ±10⁶，
 * 一旦进包围盒，整张图会被压成一条缝（抛物线题画出来像"一根竖线"）。
 * 判据用 2%~98% 分位再外扩 4 倍跨度 —— 对抛物线、双曲线、一次函数这类
 * 有界图象**永远不会误剪**（正常图象的极值就在分位范围内），
 * 只剪掉真正发散的那几个点。剪出的缺口由渲染层的间距断开逻辑处理。
 */
function clipCurveOutliers(pts) {
  const ys = pts.map(p => p[1]).sort((a, b) => a - b)
  const q = (r) => ys[Math.min(ys.length - 1, Math.max(0, Math.round((ys.length - 1) * r)))]
  const lo = q(0.02)
  const hi = q(0.98)
  const span = Math.max(hi - lo, 1e-6)
  const kept = pts.filter(p => p[1] >= lo - span * 4 && p[1] <= hi + span * 4)
  return kept.length >= 2 ? kept : pts
}

/** 类型字符：p 点 / s 线段 / l 直线 / r 射线 / c 圆 / C 圆弧 / P 多边形 / k 函数曲线 / f 函数式 / n 数值表达式 */
export const TYPES = ['p', 's', 'l', 'r', 'c', 'C', 'P', 'k', 'f', 'n']

const isP = (o) => o?.kind === 'p'
const isLineLike = (o) => o?.kind === 'l' || o?.kind === 's' || o?.kind === 'r'
const isCircleLike = (o) => o?.kind === 'c'
/** 有界的线（线段/射线）——交点必须落在范围内 */
const isBounded = (o) => o?.kind === 's' || o?.kind === 'r'

/**
 * 把「线状对象」化成 { p, d, len, bounded, kind }。
 * d 恒为单位方向；len 是线段长度（射线/直线为 Infinity）。
 * 线段与射线都由两个点确定，差别只在交点是否需要做范围过滤：
 *   直线 t ∈ (−∞,∞)   线段 t ∈ [0, len]   射线 t ∈ [0, ∞)
 *
 * 两种表示都要认：
 *   - 两点式 { a, b }（segment / line / ray 命令产出）
 *   - 点+方向式 { p, d }（orthogonal_line / parallel_line / line_bisector /
 *     angular_bisector 产出）—— 这类对象**没有** a/b，
 *     若不特判就会去 ctx.point(undefined) 拿到 null 然后崩在 unit() 里。
 */
function asLine(o, ctx) {
  if (!o) return null
  if (o.kind === 'l') return { p: o.p, d: o.d, len: Infinity, bounded: false }
  if (o.kind === 'r') {
    if (o.p && o.d) return { p: o.p, d: o.d, len: Infinity, bounded: true, kind: 'r' }
    const a = ctx.point(o.a)
    const b = ctx.point(o.b)
    const d = a && b ? unit(a, b) : null
    if (!d) return null
    return { p: a, d, len: Infinity, bounded: true, kind: 'r' }
  }
  if (o.kind === 's') {
    const a = ctx.point(o.a)
    const b = ctx.point(o.b)
    const d = a && b ? unit(a, b) : null
    if (!d) return null
    return { p: a, d, len: dist(a, b), bounded: true, kind: 's' }
  }
  return null
}

/** 参数 t（沿单位方向的长度）是否落在有界对象的范围内 */
function inRange(t, kind, lineLen) {
  if (kind === 's') return t >= -1e-6 && t <= lineLen + 1e-6
  if (kind === 'r') return t >= -1e-6
  return true
}

/** 从线状对象里取「两个点字母」的写法，用于 derived 标签（如 'AC'）。取不到返回 null */
function letterPair(o, ctx) {
  if (o?.kind === 's' || o?.kind === 'l' || o?.kind === 'r') {
    if (o.via && o.via.length === 2) return o.via.join('')
    if (o.a && o.b) return `${o.a}${o.b}`
  }
  return null
}

/** 把交点参数 t 转成坐标 */
const atT = (p, d, t) => ({ x: p.x + d.x * t, y: p.y + d.y * t })

/**
 * 命令表。
 * 每项：{ inputs:[类型...], outputs: 个数 | 'any', run(args, ctx) => out[] | {error} }
 *   - args 是**已解析好的对象/数值**（点对象、圆对象、数字）
 *   - ctx 提供 point(label) / 登记回调等
 */
export const COMMANDS = {
  // ── 点 ──
  point: {
    inputs: ['n', 'n'], outputs: 1, creates: 'p',
    help: 'point : <x> <y> -> A   （坐标可用算式，如 100*cos(60°)）',
    run: ([x, y], ctx, out) => [{ kind: 'p', label: out[0], x, y, type: 'vertex' }]
  },

  // ── 线段 / 直线 / 射线 ──
  segment: {
    inputs: ['p', 'p'], outputs: 'any', creates: 's',
    help: 'segment : A B -> seg_AB',
    run: ([a, b], ctx, out) => {
      if (a.label === b.label) return { error: 'DEGENERATE_SEGMENT', hint: '线段两端不能是同一个点' }
      return [{ kind: 's', label: out[0] || `s_${a.label}${b.label}`, a: a.label, b: b.label }]
    }
  },
  // 虚线段：对称轴、辅助线、延长线、折叠痕等「作图辅助/非实体边」必须用虚线
  // （2026-09-19 新增：此前命令集只能画实线，模型画不出原图里的虚线对称轴）
  dashed_segment: {
    inputs: ['p', 'p'], outputs: 'any', creates: 's',
    help: 'dashed_segment : A B -> seg_AB   （虚线段，用于对称轴/辅助线/延长线）',
    run: ([a, b], ctx, out) => {
      if (a.label === b.label) return { error: 'DEGENERATE_SEGMENT', hint: '线段两端不能是同一个点' }
      return [{ kind: 's', label: out[0] || `ds_${a.label}${b.label}`, a: a.label, b: b.label, style: 'dashed' }]
    }
  },
  line: {
    inputs: ['p', 'p'], outputs: 'any', creates: 'l',
    help: 'line : A B -> line_AB',
    run: ([a, b], ctx, out) => {
      const d = unit(a, b)
      if (!d) return { error: 'DEGENERATE_LINE', hint: '直线不能由同一个点确定' }
      return [{ kind: 'l', label: out[0] || `l_${a.label}${b.label}`, p: { x: a.x, y: a.y }, d, via: [a.label, b.label] }]
    }
  },
  ray: {
    inputs: ['p', 'p'], outputs: 'any', creates: 'r',
    help: 'ray : A B -> ray_AB   （起点 A，过 B）',
    run: ([a, b], ctx, out) => {
      const d = unit(a, b)
      if (!d) return { error: 'DEGENERATE_RAY' }
      return [{ kind: 'r', label: out[0] || `ray_${a.label}${b.label}`, p: { x: a.x, y: a.y }, d, via: [a.label, b.label] }]
    }
  },

  // ── 圆 ──
  circle: {
    inputs: ['p', ['p', 'n']], outputs: 1, creates: 'c',
    help: 'circle : O A -> c_O（过点） | circle : O <r> -> c_O（半径）',
    run: ([o, second], ctx, out) => {
      const r = isP(second) ? dist(o, second) : Number(second)
      if (!Number.isFinite(r) || r < EPS) return { error: 'BAD_RADIUS', hint: '半径必须是正数' }
      return [{ kind: 'c', label: out[0], c: { x: o.x, y: o.y }, r, centerLabel: o.label }]
    }
  },
  circumcircle: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'c',
    help: 'circumcircle : A B C -> circle_O',
    run: ([a, b, c], ctx, out) => {
      const o = circumcenter(a, b, c)
      if (!o) return { error: 'DEGENERATE_TRIANGLE', hint: '三点共线，没有外接圆' }
      return [{ kind: 'c', label: out[0], c: o, r: dist(o, a) }]
    }
  },
  incircle: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'c',
    help: 'incircle : A B C -> circle_I',
    run: ([a, b, c], ctx, out) => {
      const i = incenter(a, b, c)
      if (!i) return { error: 'DEGENERATE_TRIANGLE', hint: '三点共线，没有内切圆' }
      const r = dist(i, footOfPerp(i, a, b) || i)
      if (!(r > EPS)) return { error: 'DEGENERATE_TRIANGLE' }
      return [{ kind: 'c', label: out[0], c: i, r }]
    }
  },

  // ── 构造点 ──
  midpoint: {
    inputs: ['p', 'p'], outputs: 1, creates: 'p',
    help: 'midpoint : A B -> M',
    run: ([a, b], ctx, out) => [{
      kind: 'p', label: out[0], ...mid(a, b), type: 'derived',
      derived: { midpoint_of: `${a.label}${b.label}` }
    }]
  },
  foot: {
    inputs: ['p', ['l', 's', 'r']], outputs: 1, creates: 'p',
    help: 'foot : P <line|segment> -> F   （P 到该线的垂足）',
    run: ([p, ln], ctx, out) => {
      const L = asLine(ln, ctx)
      if (!L) return { error: 'BAD_LINE' }
      const f = footOfPerp(p, L.p, atT(L.p, L.d, 1))
      if (!f) return { error: 'DEGENERATE_FOOT' }
      const pair = letterPair(ln, ctx)
      const derived = pair
        ? { foot_of: p.label, perpendicular_to: pair }
        : null
      return [{ kind: 'p', label: out[0], x: f.x, y: f.y, type: 'derived', ...(derived ? { derived } : {}) }]
    }
  },
  incenter: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'p',
    help: 'incenter : A B C -> I',
    run: ([a, b, c], ctx, out) => {
      const q = incenter(a, b, c)
      if (!q) return { error: 'DEGENERATE_TRIANGLE' }
      return [{ kind: 'p', label: out[0], ...q, type: 'derived', derived: { incenter_of: `${a.label}${b.label}${c.label}` } }]
    }
  },
  circumcenter: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'p',
    help: 'circumcenter : A B C -> O',
    run: ([a, b, c], ctx, out) => {
      const q = circumcenter(a, b, c)
      if (!q) return { error: 'DEGENERATE_TRIANGLE' }
      return [{ kind: 'p', label: out[0], ...q, type: 'derived', derived: { circumcenter_of: `${a.label}${b.label}${c.label}` } }]
    }
  },
  centroid: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'p',
    help: 'centroid : A B C -> G   （本项目的扩展命令，原版没有）',
    run: ([a, b, c], ctx, out) => [{
      kind: 'p', label: out[0], ...centroid(a, b, c), type: 'derived',
      derived: { centroid_of: `${a.label}${b.label}${c.label}` }
    }]
  },
  rotate: {
    inputs: ['p', 'n', 'p'], outputs: 1, creates: 'p',
    help: 'rotate : P <angle> <center> -> P2   （角度单位默认度，逆时针为正）',
    run: ([p, deg, c], ctx, out) => [{
      kind: 'p', label: out[0], ...rotateAbout(p, c, deg), type: 'derived',
      derived: { rotate_of: p.label, center: c.label, deg }
    }]
  },
  mirror: {
    inputs: ['p', ['l', 's', 'r']], outputs: 1, creates: 'p',
    help: 'mirror : P <line|segment> -> P2   （P 关于该线的对称点，即折叠的像）',
    run: ([p, ln], ctx, out) => {
      const L = asLine(ln, ctx)
      if (!L) return { error: 'BAD_LINE' }
      const q = reflectOverLine(p, L.p, atT(L.p, L.d, 1))
      if (!q) return { error: 'DEGENERATE_MIRROR' }
      const pair = letterPair(ln, ctx)
      const derived = pair ? { reflect_of: p.label, axis: pair } : null
      return [{ kind: 'p', label: out[0], x: q.x, y: q.y, type: 'derived', ...(derived ? { derived } : {}) }]
    }
  },

  // ── 构造线 ──
  orthogonal_line: {
    inputs: ['p', ['l', 's', 'r']], outputs: 1, creates: 'l',
    help: 'orthogonal_line : P <line|segment> -> perp   （过 P 作垂线）',
    run: ([p, ln], ctx, out) => {
      const L = asLine(ln, ctx)
      if (!L) return { error: 'BAD_LINE' }
      return [{ kind: 'l', label: out[0], p: { x: p.x, y: p.y }, d: { x: -L.d.y, y: L.d.x } }]
    }
  },
  parallel_line: {
    inputs: ['p', ['l', 's', 'r']], outputs: 1, creates: 'l',
    help: 'parallel_line : P <line|segment> -> para   （过 P 作平行线）',
    run: ([p, ln], ctx, out) => {
      const L = asLine(ln, ctx)
      if (!L) return { error: 'BAD_LINE' }
      return [{ kind: 'l', label: out[0], p: { x: p.x, y: p.y }, d: { x: L.d.x, y: L.d.y } }]
    }
  },
  line_bisector: {
    inputs: ['p', 'p'], outputs: 1, creates: 'l',
    help: 'line_bisector : A B -> bisector   （AB 的垂直平分线）',
    run: ([a, b], ctx, out) => {
      const d = unit(a, b)
      if (!d) return { error: 'DEGENERATE_LINE' }
      return [{ kind: 'l', label: out[0], p: mid(a, b), d: { x: -d.y, y: d.x } }]
    }
  },
  angular_bisector: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'r',
    help: 'angular_bisector : A B C -> bis   （∠ABC 的平分线，从 B 出发）',
    run: ([a, b, c], ctx, out) => {
      const ua = unit(b, a)
      const ub = unit(b, c)
      if (!ua || !ub) return { error: 'DEGENERATE_ANGLE' }
      const s = add(ua, ub)
      const d = len(s) < EPS ? null : unit({ x: 0, y: 0 }, s)
      if (!d) return { error: 'DEGENERATE_ANGLE', hint: '∠ABC 是平角，平分线方向不唯一' }
      return [{ kind: 'r', label: out[0], p: { x: b.x, y: b.y }, d }]
    }
  },

  // ── 交点 ──
  intersect: {
    inputs: [['l', 's', 'r', 'c'], ['l', 's', 'r', 'c']], outputs: 'any', creates: 'p',
    help: 'intersect : <line1> <line2> -> P    |    intersect : <line> <circle> -> P1 P2',
    run: ([o1, o2], ctx, out) => {
      const sols = intersectObjects(o1, o2, ctx)
      if (sols == null) return { error: 'BAD_INTERSECT_INPUT', hint: '只支持 线×线 / 线×圆 / 圆×圆' }
      if (sols.length === 0) return { error: 'NO_INTERSECTION', hint: '两对象不相交（或切点退化）' }
      if (sols.length !== out.length) {
        return {
          error: 'OUTPUT_COUNT_MISMATCH',
          hint: `该构造产生 ${sols.length} 个交点，但给了 ${out.length} 个输出名 —— 请按实际个数列出`
        }
      }
      const pairA = letterPair(o1, ctx)
      const pairB = letterPair(o2, ctx)
      const derived = (pairA && pairB)
        ? { intersection: [pairA, pairB] }
        : null
      return sols.map((q, i) => ({
        kind: 'p', label: out[i], x: q.x, y: q.y, type: 'derived',
        ...(derived ? { derived } : {})
      }))
    }
  },

  // ── 多边形 ──
  polygon: {
    inputs: ['p', 'p', 'p'], outputs: 'any', creates: 'P', variadic: 'p',
    help: 'polygon : A B C -> poly_ABC   （轮廓；会自动登记边界线段）',
    run: (pts, ctx, out) => {
      if (pts.length < 3) return { error: 'TOO_FEW_VERTICES' }
      const labels = pts.map(p => p.label)
      if (new Set(labels).size !== labels.length) return { error: 'DUPLICATE_VERTEX' }
      ctx.registerPolygonEdges(labels)
      return [{ kind: 'P', label: out[0], points: labels, fill: false }]
    }
  },
  shade: {
    inputs: ['p', 'p', 'p'], outputs: 'any', creates: 'P', variadic: 'p',
    help: 'shade : A B C -> sh_ABC   （填充多边形，用于"阴影部分"）',
    run: (pts, ctx, out) => {
      if (pts.length < 3) return { error: 'TOO_FEW_VERTICES' }
      const labels = pts.map(p => p.label)
      if (new Set(labels).size !== labels.length) return { error: 'DUPLICATE_VERTEX' }
      ctx.registerPolygonEdges(labels)
      return [{ kind: 'P', label: out[0], points: labels, fill: true }]
    }
  },

  // ── 函数图象（2026-09-19）──
  // 为什么必须有这条命令：函数图象题（抛物线/双曲线/一次函数…）的解析式常常
  // "只写在图里"或需要先解出系数，`functionGraph` 通道（从题干文本解析）会整题拒绝；
  // 而 DSL 此前**没有任何画曲线的命令**，模型只能用 point+segment 手搓折线 ⇒
  // 图上出现折角（实测 `1696dca2` 抛物线底部折了），或者干脆漏画抛物线
  // （实测 `1e853fd1` 整条抛物线消失）。有了 curve，曲线由**解析式**确定性采样，
  // 形状恒正确，模型也不必再目测一堆采样点坐标。
  //
  // 语义：画 y=f(x) 在 [x1, x2] 上的图像。x1/x2 是**数值表达式**（可含 pi、分数），
  // f 是含变量 x 的函数表达式（支持隐式乘法：`2x`≡`2*x`）。
  curve: {
    inputs: ['f', 'n', 'n'], outputs: 1, creates: 'k',
    help: 'curve : x^2-2x-3 -1 4 -> k1   （画 y=f(x)，x∈[-1,4]；抛物线等函数图象必须用它，禁止用 segment 拼折线）',
    run: ([f, x1, x2], ctx, out) => {
      if (!f?.expr) return { error: 'BAD_FUNCTION_EXPR', hint: '第一个输入必须是含 x 的表达式，如 x^2-2*x-3' }
      if (!(x2 > x1)) return { error: 'BAD_DOMAIN', hint: `定义域要写成 [小数, 大数]，实际 x1=${x1}、x2=${x2}` }
      // 采样时带上网格序号：被跳过的点（无定义）或被裁掉的离群点会让序号不连续，
      // 由序号差直接得出**断点位置**——不靠"间距像不像缺口"这种启发式去猜。
      const sampled = []
      for (let i = 0; i < CURVE_SAMPLES; i++) {
        const x = x1 + ((x2 - x1) * i) / (CURVE_SAMPLES - 1)
        const y = evalFunctionAt(f, x)
        if (y == null) continue
        sampled.push([x, y, i])
      }
      if (sampled.length < 2) return { error: 'EMPTY_CURVE', hint: '该表达式在给定定义域内求不出有效点' }
      const kept = clipCurveOutliers(sampled)
      const points = []
      const breaks = []
      kept.forEach((p, k) => {
        if (k > 0 && p[2] - kept[k - 1][2] > 1) breaks.push(k) // 序号跳号 ⇒ 中间有无定义区间
        points.push([p[0], p[1]])
      })
      const outObj = { kind: 'k', label: out[0], points, expr: f.expr }
      if (breaks.length) outObj.breaks = breaks
      return [outObj]
    }
  },

  // ── 圆弧与标注 ──
  arc: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'C',
    help: 'arc : O A B -> arc_O   （以 O 为圆心，从 A 逆时针扫到 B）',
    run: ([o, a, b], ctx, out) => {
      if (dist(o, a) < EPS || dist(o, b) < EPS) return { error: 'DEGENERATE_ARC' }
      return [{ kind: 'C', label: out[0], center: o.label, from: a.label, to: b.label }]
    }
  },
  right_angle: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'mark',
    help: 'right_angle : A B C -> mark   （在顶点 B 处画直角标记）',
    run: ([a, b, c], ctx, out) => {
      if (a.label === b.label || c.label === b.label) return { error: 'DEGENERATE_ANGLE' }
      return [{ kind: 'mark', label: out[0], mark: 'right', vertex: b.label, from: a.label, to: c.label }]
    }
  },
  angle_mark: {
    inputs: ['p', 'p', 'p'], outputs: 1, creates: 'mark',
    help: 'angle_mark : A B C -> mark   （在顶点 B 处画角标记）',
    run: ([a, b, c], ctx, out) => {
      if (a.label === b.label || c.label === b.label) return { error: 'DEGENERATE_ANGLE' }
      return [{ kind: 'mark', label: out[0], mark: 'angle', vertex: b.label, from: a.label, to: c.label }]
    }
  },
  label: {
    inputs: ['str', 'n', 'n'], outputs: 1, creates: 'text',
    // 注意：下游 normalizeStructure 的 isSymbolLabel 会**丢掉数字/长度/角度型文字**——
    // 那是防"学生手写答案被重绘成题设"的既定纪律（见 structure.js 注释），
    // 本命令不得绕过它，所以只对符号型文字（α、β、l、m…）有效。
    help: 'label : "<符号文字>" <x> <y> -> L   （角名/线名等符号标注；数字与长度会被安全过滤丢掉）',
    run: ([s, x, y], ctx, out) => [{ kind: 'text', label: out[0], text: s.value, x, y }]
  }
}

/** 两个对象的交点（含线段/射线的范围过滤）。返回 null 表示类型不支持 */
function intersectObjects(o1, o2, ctx) {
  const L1 = asLine(o1, ctx)
  const L2 = asLine(o2, ctx)
  const C1 = isCircleLike(o1) ? o1 : null
  const C2 = isCircleLike(o2) ? o2 : null

  if (L1 && L2) {
    // 两条有向参数直线求交
    const den = cross(L1.d, L2.d)
    if (Math.abs(den) < EPS) return [] // 平行或重合：不唯一，判为无交点
    const w = sub(L2.p, L1.p)
    const t = cross(w, L2.d) / den
    const u = cross(w, L1.d) / den
    if (L1.bounded && !inRange(t, L1.kind, L1.len)) return []
    if (L2.bounded && !inRange(u, L2.kind, L2.len)) return []
    return [atT(L1.p, L1.d, t)]
  }
  if (L1 && C2) return lineCircle(L1, C2)
  if (L2 && C1) return lineCircle(L2, C1)
  if (C1 && C2) return circleCircleIntersect(C1.c, C1.r, C2.c, C2.r)
  return null
}

/**
 * 直线/线段/射线 与圆的交点。
 * 用「点 + 单位方向」参数化（而不是取圆上另一端点），
 * 这样参数 t 直接是沿方向的**长度**，与 inRange 的区间语义一致。
 */
function lineCircle(L, C) {
  const pts = circleLineIntersect(C.c, C.r, L.p, atT(L.p, L.d, 1))
  if (!L.bounded) return pts
  return pts.filter(q => inRange(q.t, L.kind, L.len))
}

/** 供 executor 做参数类型检查用的类型标签 */
export function typeOfArg(v) {
  if (typeof v === 'number') return 'n'
  return v?.kind || '?'
}

/** 命令是否存在 */
export const hasCommand = (name) => Object.prototype.hasOwnProperty.call(COMMANDS, name)

/** 全部命令名（用于 prompt 与文档生成） */
export const commandNames = () => Object.keys(COMMANDS)

/**
 * 从命令表生成 prompt 用的命令参考（**单一真值源**）。
 * 手写 prompt 里的命令表迟早会和代码漂移，所以这里由代码生成。
 */
export function commandReference() {
  return Object.entries(COMMANDS)
    .map(([name, def]) => `- ${def.help || `${name} : ${def.inputs.join(' ')} -> out`}`)
    .join('\n')
}
