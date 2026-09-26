/**
 * 配图「矢量化描摹」通道（2026-09-26）
 *
 * ── 为什么需要它 ──
 * 数轴、统计图、流程图、数值转换器、A4 折纸示意、格点图这类配图，信息载体是
 * **排布关系**（刻度位置、流程顺序、纸片比例），不是点线构造。让几何重绘去"翻译"
 * 它们，只会得到一张错的图。但它们在原卷上是**完全正确的** —— 缺的只是清晰度。
 *
 * 本通道做的事：把原卷裁片**描摹**成矢量路径。
 * **忠实描摹，不构造、不推断、不补全** ⇒ 内容与原图逐像素同构，数学上不会画错；
 * 输出是矢量 ⇒ 无限缩放、线条锐利。
 *
 * ── 与「几何重绘」的本质区别（务必守住）──
 * | | 几何重绘（DSL/确定性通道） | 本通道（描摹） |
 * |---|---|---|
 * | 输入 | 题干文字 + 图 | 只要裁片像素 |
 * | 是否构造 | 是，会"理解"图形并重建 | 否，逐条边界照抄 |
 * | 会画错吗 | 会（多画/漏画/位置错） | 不会（同构） |
 * | 能去手写吗 | 能（重新画干净的） | **不能**（手写也在像素里） |
 * ⇒ 所以：**只能用于"原图本身就对"的图**。若原裁片带学生手写，描摹会把手写一起留下，
 *   此时应走几何重绘或人工换图，不得用本通道"美化"。
 *
 * ── 算法 ──
 * ① 光照校正（除以大半径模糊背景）→ 归一化 → Otsu 全局阈值 → 二值墨迹
 * ② 去小连通域（噪点）
 * ③ **裂缝边界链化**：每个墨迹像素的四条边，邻接背景的那条即为边界边；把边界边
 *    按方向（墨迹恒在左侧）串成闭环 ⇒ 得到外轮廓与孔洞轮廓
 * ④ Douglas-Peucker 简化（ε≈0.8px）
 * ⑤ 输出 `fill-rule="evenodd"` 的 `<path>`，孔洞自动镂空
 *
 * ── 防错闸 ──
 * 栅格化回原尺寸 → 与二值墨迹比 **mismatch 面积比**（XOR / UNION）。
 * 描摹是恒等变换，mismatch 应当很小；超阈值说明二值化把内容吃掉了 ⇒ 拒绝出图。
 *
 * @module figureVectorize
 */

const INK = 1
const BG = 0

/** Otsu 阈值（0-255 灰度直方图） */
export function otsuThreshold(hist, total) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) { bestVar = between; best = t }
  }
  return best
}

/**
 * 二值化：光照校正 + Otsu。
 * @param {Buffer} rawGray - 单通道灰度 raw
 * @param {number} w
 * @param {number} h
 * @returns {{mask:Uint8Array, threshold:number, inkRatio:number}}
 */
export function binarize(rawGray, w, h) {
  const n = w * h
  const hist = new Int32Array(256)
  for (let i = 0; i < n; i++) hist[rawGray[i]]++
  const t = otsuThreshold(hist, n)
  const mask = new Uint8Array(n)
  let ink = 0
  for (let i = 0; i < n; i++) {
    if (rawGray[i] <= t) { mask[i] = INK; ink++ }
  }
  return { mask, threshold: t, inkRatio: ink / n }
}

/**
 * 去小连通域：把面积 < minArea 的墨迹块整块抹掉（扫描噪点）。
 *
 * ⚠️ 必须用 **8 邻域**（2026-09-26 实测踩坑）：45° 方向的 1px 细线在 4 邻域下是
 * **互不相连的单像素**，会被整条当噪点抹掉（合成用例「X 形交叉」实测 mismatch 超闸）。
 * 8 邻域把对角相邻像素视为同一笔画，既保住斜细线，又不影响噪点过滤
 * （噪点仍是孤立小面积块）。边界链化仍走 4 邻域裂缝图 —— 对角相触的两个区域
 * 由「最顺时针」配对保持分离，与 8 邻域标记并不冲突。
 */
export function removeSmallComponents(mask, w, h, minArea = 6) {
  const n = w * h
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  let removed = 0
  for (let start = 0; start < n; start++) {
    if (mask[start] !== INK || seen[start]) continue
    let sp = 0
    stack[sp++] = start
    seen[start] = 1
    const comp = []
    while (sp > 0) {
      const p = stack[--sp]
      comp.push(p)
      const x = p % w, y = (p - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const q = ny * w + nx
          if (mask[q] === INK && !seen[q]) { seen[q] = 1; stack[sp++] = q }
        }
      }
    }
    if (comp.length < minArea) {
      for (const p of comp) mask[p] = BG
      removed++
    }
  }
  return removed
}

/**
 * 裂缝边界链化 → 闭环多边形（顶点在整数网格上，即像素边界交点）。
 *
 * 每条边界边都按「墨迹在左」定向，因此每个墨迹区域的外轮廓与孔洞轮廓方向天然相反，
 * 配合 `fill-rule="evenodd"` 即可正确镂空，无需显式区分内外。
 *
 * ⚠️ 歧义顶点必须用**转向规则**消解（2026-09-26 实测踩坑）：
 * 两笔画交叉处（对角线相触 / X 形交叉）会出现「2 进 2 出」的顶点。此时若随便取一条
 * 出边，会把**外轮廓与孔洞轮廓拼成一条自交路径**，`evenodd` 就会把本该是细线的
 * 三角区域填成实心块 —— 实测 mismatch 0.50~0.85、图面出现大片黑三角。
 * 正解：始终取**最顺时针**的那条出边。它保证「对角相触的两个区域保持分离」、
 * 「交叉处各自沿自己的笔画继续」，即标准的面遍历配对。
 *
 * @returns {Array<Array<[number,number]>>} 闭环点列（首尾不重复）
 */
export function traceBoundaries(mask, w, h) {
  const VW = w + 1
  /** @type {Map<number, number[]>} from → to 列表 */
  const out = new Map()
  const addEdge = (fx, fy, tx, ty) => {
    const from = fy * VW + fx
    let list = out.get(from)
    if (!list) { list = []; out.set(from, list) }
    list.push(ty * VW + tx)
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] !== INK) continue
      if (y === 0 || mask[(y - 1) * w + x] !== INK) addEdge(x, y, x + 1, y)          // 上边 左→右
      if (y === h - 1 || mask[(y + 1) * w + x] !== INK) addEdge(x + 1, y + 1, x, y + 1) // 下边 右→左
      if (x === 0 || mask[y * w + (x - 1)] !== INK) addEdge(x, y + 1, x, y)          // 左边 下→上
      if (x === w - 1 || mask[y * w + (x + 1)] !== INK) addEdge(x + 1, y, x + 1, y + 1) // 右边 上→下
    }
  }

  /** 取一条出边；多选时取「最顺时针」的转向 */
  const takeNext = (from, dir) => {
    const list = out.get(from)
    if (!list || !list.length) return null
    if (list.length === 1) return list.pop()
    const fx = from % VW, fy = Math.floor(from / VW)
    let bestK = 0, bestAng = -Infinity
    for (let k = 0; k < list.length; k++) {
      const to = list[k]
      const dx = (to % VW) - fx, dy = Math.floor(to / VW) - fy
      const cross = dir[0] * dy - dir[1] * dx
      const dot = dir[0] * dx + dir[1] * dy
      const ang = Math.atan2(cross, dot)
      if (ang > bestAng) { bestAng = ang; bestK = k }
    }
    return list.splice(bestK, 1)[0]
  }

  const loops = []
  const limit = w * h * 4 + 16
  for (const start of [...out.keys()]) {
    while ((out.get(start) || []).length) {
      const loop = []
      let prev = -1
      let cur = start
      let closed = false
      for (let guard = 0; guard < limit; guard++) {
        const dir = prev < 0
          ? [1, 0]
          : [(cur % VW) - (prev % VW), Math.floor(cur / VW) - Math.floor(prev / VW)]
        const to = takeNext(cur, dir)
        if (to === null) break
        loop.push([cur % VW, Math.floor(cur / VW)])
        prev = cur
        cur = to
        if (cur === start) { closed = true; break }
      }
      if (closed && loop.length >= 3) loops.push(loop)
      else if (!closed) break // 断链（理论不该发生）→ 放弃该起点，避免死循环
    }
  }
  return loops
}

/** 点到线段距离平方 */
function distSqToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return (px - ax) * (px - ax) + (py - ay) * (py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = ax + t * dx, cy = ay + t * dy
  return (px - cx) * (px - cx) + (py - cy) * (py - cy)
}

/**
 * Douglas-Peucker 闭环简化。
 *
 * ⚠️ 闭环必须**整圈**作为 DP 输入（2026-09-26 实测踩坑）：
 * 早期写法是从「最远点对」的 i 正向走到 j 就停 —— 但闭环上 i→j 有两条弧，
 * 正向那条通常只覆盖半圈，**另一半顶点被整段丢弃**，闭环于是被拉成三角形。
 * 实测后果：12 个顶点的细线轮廓简化成 3 个顶点，`evenodd` 把细线填成实心块
 * （mismatch 0.5~0.85，图面出现大片黑三角）。
 * 正确做法：从 bestI 起绕**一整圈**（n 个点），再补一个与起点重合的末点让 DP
 * 把「闭合边」也纳入误差判定，最后去掉重复末点。
 */
export function simplifyLoop(points, eps = 0.8) {
  const n = points.length
  if (n <= 4) return points
  // 起点取「最远点对」的一端 —— 保证起点落在简化结果的顶点上
  const stride = n > 1500 ? Math.ceil(n / 1500) : 1
  const idx = []
  for (let k = 0; k < n; k += stride) idx.push(k)
  let bestI = idx[0], bestD = -1
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const i = idx[a], j = idx[b]
      const dx = points[i][0] - points[j][0], dy = points[i][1] - points[j][1]
      const d = dx * dx + dy * dy
      if (d > bestD) { bestD = d; bestI = i }
    }
  }

  const chain = []
  for (let k = 0; k < n; k++) chain.push(points[(bestI + k) % n])
  chain.push(points[bestI]) // 闭合边

  const keep = new Uint8Array(chain.length)
  keep[0] = 1; keep[chain.length - 1] = 1
  const stack = [[0, chain.length - 1]]
  const eps2 = eps * eps
  while (stack.length) {
    const [a, b] = stack.pop()
    if (b - a < 2) continue
    let far = -1, farD = eps2
    for (let i = a + 1; i < b; i++) {
      const d = distSqToSeg(chain[i][0], chain[i][1], chain[a][0], chain[a][1], chain[b][0], chain[b][1])
      if (d > farD) { farD = d; far = i }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  const out = []
  for (let i = 0; i < chain.length; i++) if (keep[i]) out.push(chain[i])
  out.pop() // 末点与首点重合，去掉（闭环由 path 的 Z 表达）
  return out
}

/**
 * 多边形 → SVG 路径串。
 * @param {Array<Array<[number,number]>>} loops
 */
export function loopsToPathData(loops) {
  const fmt = (v) => {
    const r = Math.round(v * 10) / 10
    return Number.isInteger(r) ? String(r) : r.toFixed(1)
  }
  return loops.map(loop => {
    if (!loop.length) return ''
    let d = `M${fmt(loop[0][0])} ${fmt(loop[0][1])}`
    for (let i = 1; i < loop.length; i++) d += `L${fmt(loop[i][0])} ${fmt(loop[i][1])}`
    return d + 'Z'
  }).filter(Boolean).join('')
}

/**
 * 主入口：裁片 buffer → 矢量 SVG。
 *
 * @param {Buffer} input
 * @param {Object} [opts]
 * @param {number} [opts.minComponent=6] 去噪最小面积
 * @param {number} [opts.eps=0.6] DP 简化容差（px）。实测标定（6 张真实裁片）：
 *   eps=0.8 → mismatch 1.3%~4.6%；eps=0.6 → 0.1%~0.3%（体积仅 1.4 倍）；eps=0.4 → 0，
 *   但体积翻倍。0.6 是「近无损 + 体积可接受」的拐点。
 * @param {number} [opts.maxMismatch=0.06] 防错闸：XOR/UNION 面积比上限
 *   （真实裁片实测 0.1%~0.3%，合成 1px 斜线最坏 ~0.06，取 0.06 留足余量）
 * @param {boolean} [opts.verify=true] 是否跑防错闸
 * @returns {Promise<{ok:boolean, svg?:string, reason?:string, stats:Object}>}
 */
export async function vectorizeFigure(input, opts = {}) {
  const { minComponent = 6, eps = 0.6, maxMismatch = 0.06, verify = true } = opts
  const sharp = (await import('sharp')).default

  const meta = await sharp(input).metadata()
  const w = meta.width || 0, h = meta.height || 0
  if (!w || !h) return { ok: false, reason: 'empty-image', stats: {} }

  // ① 光照校正：除以大半径模糊背景，消除纸面明暗不均
  // ⚠️ 必须 `.raw()` —— 不加 raw 时 sharp 会把结果编码成 PNG，拿到的是压缩字节流
  //    而不是像素，按下标索引会静默得到垃圾（2026-09-26 实测踩坑：inkRatio 假 0.89）。
  const gray = await sharp(input)
    .flatten({ background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer()
  if (gray.length !== w * h) {
    return { ok: false, reason: `channel-mismatch:${gray.length}!=${w * h}`, stats: {} }
  }
  const bg = await sharp(gray, { raw: { width: w, height: h, channels: 1 } })
    .blur(Math.max(8, Math.round(Math.min(w, h) / 12)))
    .raw()
    .toBuffer()
  const corrected = Buffer.allocUnsafe(w * h)
  for (let i = 0; i < w * h; i++) {
    const g = gray[i], b = Math.max(1, bg[i])
    corrected[i] = Math.max(0, Math.min(255, Math.round((g / b) * 235)))
  }

  // ② 二值化 + 去噪
  const { mask, threshold, inkRatio } = binarize(corrected, w, h)
  const removed = removeSmallComponents(mask, w, h, minComponent)

  const inkPx = mask.reduce((a, v) => a + v, 0)
  if (inkPx === 0) return { ok: false, reason: 'no-ink', stats: { threshold, inkRatio } }

  // ③④ 链化 + 简化
  const rawLoops = traceBoundaries(mask, w, h)
  const loops = rawLoops.map(l => simplifyLoop(l, eps)).filter(l => l.length >= 3)
  if (!loops.length) return { ok: false, reason: 'no-loops', stats: { threshold, inkRatio } }
  const d = loopsToPathData(loops)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="#ffffff"/>`
    + `<path d="${d}" fill="#111111" fill-rule="evenodd"/></svg>`

  const stats = {
    width: w, height: h, threshold, inkRatio: Number(inkRatio.toFixed(4)),
    componentsRemoved: removed, loops: loops.length,
    points: loops.reduce((a, l) => a + l.length, 0),
    svgBytes: Buffer.byteLength(svg, 'utf8'),
  }

  // ⑤ 防错闸：栅格化回原尺寸比 XOR/UNION
  if (verify) {
    const v = await verifyVectorTrace(svg, mask, w, h)
    stats.mismatch = v.mismatch
    stats.iou = v.iou
    if (!v.ok || v.mismatch > maxMismatch) {
      return { ok: false, reason: `trace-mismatch:${v.mismatch}`, svg, stats }
    }
  }
  return { ok: true, svg, stats }
}

/**
 * 防错闸：把 SVG 栅格化回原尺寸，与二值墨迹比 XOR/UNION。
 * 两者都是同一内容的二值图，所以这是**同构性检验**，不是"像不像"的主观判断。
 *
 * @returns {Promise<{ok:boolean, mismatch:number, iou:number}>}
 */
export async function verifyVectorTrace(svg, mask, w, h, maxMismatch = 0.06) {
  const sharp = (await import('sharp')).default
  const rendered = await sharp(Buffer.from(svg))
    .resize(w, h, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .raw()
    .toBuffer()
  const n = w * h
  let inter = 0, union = 0
  for (let i = 0; i < n; i++) {
    const a = mask[i] === INK
    const b = rendered[i] < 128
    if (a || b) union++
    if (a && b) inter++
  }
  const xor = union - inter
  const mismatch = union === 0 ? 1 : xor / union
  const iou = union === 0 ? 0 : inter / union
  return { ok: mismatch <= maxMismatch, mismatch: Number(mismatch.toFixed(4)), iou: Number(iou.toFixed(4)) }
}
