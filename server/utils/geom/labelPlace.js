/**
 * 顶点字母标注的通用摆位：**候选方向打分择优**（SVG 与 TikZ 两个渲染器共用同一套打分规则）。
 *
 * 为什么需要（2026-09-19 老师反馈「字母压到线上」）：
 *   旧算法 `labelOffset` 只做一件事——让字母朝向"远离所有点质心"的方向，
 *   完全**不看线段**。于是当顶点落在某条线（或线段的延长处）上时，字母正好被按在线上：
 *   典型如 △ABC 中 MN∥AC，N 是 AB 边上的点，字母 N 就压在 AB 上；坐标系里贴在
 *   对称轴线上的刻度数字也被轴线穿过。
 *
 * 设计要点：
 *   1. 只用**输出坐标**（SVG 像素 / TikZ 单位），由调用方各自映射好再传进来；
 *      坐标系约定 **y 向上为正**（SVG 调用方需把 y 取负后传入，偏移量再取负回去）。
 *   2. 「远离质心」从硬规则降级为**偏好项**（打分里的一项），不再一票决定。
 *      2026-09-19 二修起，顶点改用 `vertexPref`（外角平分线）；`outwardPref` 只作兜底。
 *   3. 打分项：压线（最重，但只罚"横跨线段本体"，贴着端点不罚）> 文字重叠 > 压点
 *      > 偏离偏好方向 > 距离。
 *   4. 纯函数、无副作用；`placed` 用于同图多标签之间的互相避让（按放置顺序累积）。
 *   5. 摆位问题**不要靠看图推演**：置 `GEOM_LABEL_DEBUG=1` 会打印每个候选的打分明细。
 */

/** 8 个候选方向（y 向上为正） */
const DIRS = [
  { key: 'right', vx: 1, vy: 0 },
  { key: 'topRight', vx: 0.7071, vy: 0.7071 },
  { key: 'top', vx: 0, vy: 1 },
  { key: 'topLeft', vx: -0.7071, vy: 0.7071 },
  { key: 'left', vx: -1, vy: 0 },
  { key: 'bottomLeft', vx: -0.7071, vy: -0.7071 },
  { key: 'bottom', vx: 0, vy: -1 },
  { key: 'bottomRight', vx: 0.7071, vy: -0.7071 },
]

/** 点到线段的最短距离 */
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * 线段到「轴对齐矩形」的最短距离（0 表示相交/穿过）。
 * 用矩形四条边与线段两两求距离 + 端点包含判断，足够本场景（文字框很小）。
 */
function segRectDist(ax, ay, bx, by, cx, cy, hw, hh) {
  const x0 = cx - hw
  const x1 = cx + hw
  const y0 = cy - hh
  const y1 = cy + hh

  // 线段任一端点在矩形内 → 距离 0
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  if (inside(ax, ay) || inside(bx, by)) return 0

  // 矩形中心在线段上的最近点距离，再减去矩形在该方向的"半径"（保守近似）
  const d = pointSegDist(cx, cy, ax, ay, bx, by)
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  // 线段法向单位向量
  const nx = -dy / len
  const ny = dx / len
  const radius = Math.abs(nx) * hw + Math.abs(ny) * hh
  return Math.max(0, d - radius)
}

/** 点是否落在以 (cx,cy) 为中心、半宽半高 (hw,hh) 的矩形内 */
function insideBox(cx, cy, hw, hh, x, y) {
  return x >= cx - hw && x <= cx + hw && y >= cy - hh && y <= cy + hh
}

/**
 * 文字框「压线」代价（2026-09-19 二次修订）。
 *
 * 关键区分：**贴着线段走** 与 **贴着端点走** 是两件事。
 *   · 顶点字母本来就该紧挨自己的顶点——而顶点正是线段的端点；沿边的延长线摆字母
 *     是教材惯例（正方形顶角 C 的字母就落在 BC 方向的延长侧），不该判成压线；
 *   · 真正的"压线"是文字框横跨线段**本体**（老师最初反馈的"字母压到线上"）。
 *
 * 旧版用「文字框中心到线段（含端点）的距离」定档，把前一种情况一起重罚了，
 * 结果是所有顶点字母被顶到 24px 开外（老师二修反馈"字母偏移了很多"）。
 * 现在把线段两端各内缩「文字半高」再算距离：贴着端点不再算近，横跨本体照旧重罚。
 */
function segPenalty(sg, cx, cy, hw, hh) {
  const dx = sg.b.x - sg.a.x
  const dy = sg.b.y - sg.a.y
  const len = Math.hypot(dx, dy)
  const ux = len > 0 ? dx / len : 1
  const uy = len > 0 ? dy / len : 0
  const shrink = Math.min(hh, len * 0.45)
  const d = segRectDist(
    sg.a.x + ux * shrink, sg.a.y + uy * shrink,
    sg.b.x - ux * shrink, sg.b.y - uy * shrink,
    cx, cy, hw, hh
  )
  let score = 0
  if (d < 1) score += 1000
  else if (d < 5) score += 250
  else if (d < 9) score += 60
  // 文字框盖住了线段端点（=顶点）本身：字母压在自己的顶点上，同样难看
  if (insideBox(cx, cy, hw, hh, sg.a.x, sg.a.y) || insideBox(cx, cy, hw, hh, sg.b.x, sg.b.y)) score += 400
  return score
}

/**
 * 给单个标签选最优偏移。
 *
 * @param {object}       o
 * @param {{x,y}}        o.node      该点坐标（输出坐标，y 向上为正）
 * @param {Array}        [o.points]  同图其它点（用于"别压到别的点"）
 * @param {Array}        [o.segments] 线段 [{a:{x,y}, b:{x,y}}]（用于"别压线"）
 * @param {Array}        [o.placed]  已放置文字的 {x,y,w,h}
 * @param {{x,y}}        [o.prefer]  偏好方向（单位向量；一般=远离质心方向）
 * @param {number}       [o.dist]    基础距离（输出坐标单位）
 * @param {{w,h}}        [o.box]     本标签文字框尺寸
 * @param {{x0,x1,y0,y1}} [o.bounds] 可见区域（y 向上为正）。给了就越界重罚，
 *                                   避免字母被推到画布边缘甚至裁掉（2026-09-19 实测踩到）
 * @param {string}       [o.tag]     调试用标签（顶点名）。置 GEOM_LABEL_DEBUG=1 时
 *                                   打印候选打分明细——摆位类问题必须看数字，别靠肉眼看图推演
 * @returns {{dx:number, dy:number, dir:string, score:number}}
 */
export function placeLabel({ node, points = [], segments = [], placed = [], prefer = null, dist = 16, box = { w: 10, h: 16 }, bounds = null, tag = '' }) {
  const hw = box.w / 2
  const hh = box.h / 2
  let best = null
  const debug = process.env.GEOM_LABEL_DEBUG === '1'
  const cands = []

  for (const d of DIRS) {
    // 每个方向试两档距离：先近后远（远了更好避让但更松散）
    for (const scale of [1, 1.5]) {
      const r = dist * scale
      const cx = node.x + d.vx * r
      const cy = node.y + d.vy * r
      let score = 0
      const why = []

      // ① 压线（最重）——文字框与任何线段过近都算"压"（端点侧不罚，见 segPenalty）
      for (const sg of segments) {
        const p = segPenalty(sg, cx, cy, hw, hh)
        if (p) { score += p; why.push(`line${p >= 1000 ? '!' : ''}+${p}`) }
      }

      // ② 与已放置文字重叠
      for (const t of placed) {
        const ox = Math.abs(cx - t.x)
        const oy = Math.abs(cy - t.y)
        const needX = hw + (t.w || 10) / 2 + 3
        const needY = hh + (t.h || 16) / 2 + 2
        if (ox < needX && oy < needY) { score += 500; why.push('text+500') }
      }

      // ③ 压到其它点（字母盖住另一个顶点很别扭）
      for (const p of points) {
        if (p === node) continue
        const dd = Math.hypot(cx - p.x, cy - p.y)
        if (dd < hw + 6) { score += 220; why.push('pt+220') }
      }

      // ④ 超出可见区域（字母贴边/被裁掉）
      if (bounds) {
        const l = cx - hw
        const rt = cx + hw
        const bo = cy - hh
        const tp = cy + hh
        if (l < bounds.x0 || rt > bounds.x1 || bo < bounds.y0 || tp > bounds.y1) {
          score += 800
          why.push('oob+800')
        }
      }

      // ⑤ 偏离偏好方向（保持"在图形外侧"的原有观感）
      if (prefer) {
        const dot = d.vx * prefer.x + d.vy * prefer.y
        const p = (1 - dot) * 45 // dot=1 → 0 分；反方向 → 90 分
        score += p
        why.push(`dir+${p.toFixed(1)}`)
      }

      // ⑥ 距离（倾向贴近点，避免字母飘太远）
      score += r * 1.5
      why.push(`d+${(r * 1.5).toFixed(1)}`)

      if (!best || score < best.score - 1e-9) best = { dx: d.vx * r, dy: d.vy * r, dir: d.key, score }
      if (debug) cands.push({ dir: d.key, r, score, why })
    }
  }
  if (debug) {
    cands.sort((a, b) => a.score - b.score)
    console.log(
      `[labelPlace] ${tag || '?'} node=(${node.x.toFixed(1)},${node.y.toFixed(1)}) box=${box.w}x${box.h} dist=${dist}`
      + ` prefer=${prefer ? `(${prefer.x.toFixed(2)},${prefer.y.toFixed(2)})` : 'none'}`
      + ` segs=${segments.length} placed=${placed.length} → ${best.dir} score=${best.score.toFixed(1)}`
    )
    for (const c of cands.slice(0, 4)) {
      console.log(`    ${c.dir.padEnd(12)} r=${c.r} score=${c.score.toFixed(1)}  ${c.why.join(' ')}`)
    }
  }
  return best
}

/** 由「输出坐标下的点集」算质心与远离方向（偏好项用） */
export function outwardPref(node, points) {
  let cx = 0
  let cy = 0
  let n = 0
  for (const p of points) {
    if (typeof p?.x === 'number' && typeof p?.y === 'number') { cx += p.x; cy += p.y; n++ }
  }
  if (!n) return { x: 0, y: 1 }
  const vx = node.x - cx / n
  const vy = node.y - cy / n
  const len = Math.hypot(vx, vy)
  if (len < 1e-6) return { x: 0, y: 1 } // 质心与该点重合（如数轴共线题）→ 默认朝上
  return { x: vx / len, y: vy / len }
}

/**
 * 顶点标注的偏好方向 = **外角平分线**（2026-09-19 二次修订）。
 *
 * 旧版一律用「远离所有点的质心」，在两类常见图形上会摆歪：
 *   · 共线/小点集（坐标系里的原点 O）——质心方向退化，字母被推向正上方；
 *   · 对称图形（坐标系中立在数轴上的正方形）——左上角 C 与右上角 D 本该镜像对称，
 *     质心方向却让 C 朝正上、D 朝右上，两角摆得不一样（老师二修反馈）。
 *
 * 教材惯例其实是：顶点字母放在**该顶点的外角平分线**方向上——把与该顶点相连的
 * 边当成"遮挡物"，选相邻遮挡方向之间角度空隙最大的那个扇区，取它的平分线。
 * 校验：正方形顶角 C → 左上、D → 右上（与原卷一致）；三角形顶点 → 正上方。
 *
 * ⚠️ **直角顶点例外（2026-09-19 三修）**：外角平分线成立的前提是"遮挡扇区大"，
 * 而直角顶点两条边成 90°，外侧扇区 270°，其平分线恒为 **45° 斜向**。斜向摆字母
 * 会让字母"既不在正上方、也不在正侧方"，横坐标整体外移一个文字宽度——原卷上
 * 正方形顶角 C 的字母是**正上方**（竖边正对字母底部），斜插看起来就是"飘出去"了
 * （老师两次反馈"字母的位置依旧很奇怪"，实测 C 右缘在 x=196.9，而顶点在 x=208.2）。
 * 所以直角顶点一律把偏好量化到**正上/正下**（外侧扇区若已含水平方向且更贴边则保留水平）。
 * 偏好只是打分里的一项（权重 ≤90），真被线挡住时 `placeLabel` 仍会自行让开，不会硬贴。
 *
 * 点在**线段内部**时（如 N 落在 AB 上）该直线两侧都是遮挡方向，角度空隙各 180°，
 * 出现并列 → 用兜底方向（`fallback`，一般传 outwardPref 的结果）在并列项里挑。
 *
 * @param {{x,y}} node 目标点（输出坐标，与 segments 同一坐标系）
 * @param {Array}  segments 线段 [{a:{x,y},b:{x,y}}]
 * @param {{x,y}}  [fallback] 无相连边（或角度并列）时的兜底偏好
 * @param {number} [eps] 判定"点落在这条线段上"的容差；默认按线段包围盒尺度自适应
 * @returns {{x,y}} 单位向量
 */
export function vertexPref(node, segments = [], fallback = { x: 0, y: 1 }, eps = null) {
  if (!eps) {
    let ext = 0
    for (const sg of segments) {
      ext = Math.max(ext, Math.abs(sg.a.x - sg.b.x), Math.abs(sg.a.y - sg.b.y))
    }
    eps = Math.max(ext * 0.008, 0.5)
  }

  const dirs = []
  const push = (vx, vy) => {
    const l = Math.hypot(vx, vy)
    if (l > 1e-6) dirs.push({ x: vx / l, y: vy / l, ang: Math.atan2(vy, vx) })
  }
  for (const sg of segments) {
    if (pointSegDist(node.x, node.y, sg.a.x, sg.a.y, sg.b.x, sg.b.y) > eps) continue
    const atA = Math.hypot(node.x - sg.a.x, node.y - sg.a.y) <= eps
    const atB = Math.hypot(node.x - sg.b.x, node.y - sg.b.y) <= eps
    if (atA && atB) continue // 退化线段
    if (atA) {
      push(sg.b.x - sg.a.x, sg.b.y - sg.a.y)
    } else if (atB) {
      push(sg.a.x - sg.b.x, sg.a.y - sg.b.y)
    } else {
      // 点在线段内部：整条直线从两侧遮挡
      push(sg.b.x - sg.a.x, sg.b.y - sg.a.y)
      push(sg.a.x - sg.b.x, sg.a.y - sg.b.y)
    }
  }
  if (dirs.length < 2) return { ...fallback }

  const sorted = dirs.slice().sort((p, q) => p.ang - q.ang)
  let best = null
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    const b = sorted[(i + 1) % sorted.length]
    let gap = b.ang - a.ang
    if (i === sorted.length - 1) gap += Math.PI * 2
    const bis = a.ang + gap / 2
    const v = { x: Math.cos(bis), y: Math.sin(bis) }
    const dot = v.x * (fallback?.x ?? 0) + v.y * (fallback?.y ?? 0)
    if (!best || gap > best.gap + 1e-6 || (Math.abs(gap - best.gap) <= 1e-6 && dot > best.dot)) {
      best = { x: v.x, y: v.y, gap, dot, edgeA: a, edgeB: b }
    }
  }

  // 直角扇区 ⇒ 量化到正上/正下
  //
  // 判据是「**胜出扇区的两条边界边互相垂直**」，不是"该点恰好有两条边"——
  // 多条边汇于一点时（实测 `3b05e732`：B 处 AB、BC、BE 三条边），只要空档最大的
  // 那个扇区是 90°，平分线照样是 45° 斜向，同样该走竖直。
  //
  // ⚠️ 比较必须带容差：45° 处 `Math.cos(π/4)=0.7071067811865476` 而
  // `Math.sin(π/4)=0.7071067811865475`，两者差 1 个 ULP。若直接写 `|y| >= |x|`，
  // 同一个正方形的左上角（bis=135°）会进分支、右上角（bis=45°）不进——
  // 对称图形左右摆法不一致，这种"1 ULP 分叉"极难看出原因（实测踩到）。
  const perp = Math.abs(best.edgeA.x * best.edgeB.x + best.edgeA.y * best.edgeB.y) <= 0.1
  if (perp && Math.abs(best.y) >= Math.abs(best.x) - 1e-9) {
    return { x: 0, y: best.y >= 0 ? 1 : -1 }
  }
  return { x: best.x, y: best.y }
}
