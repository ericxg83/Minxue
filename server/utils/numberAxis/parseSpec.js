/**
 * 数轴「程序化图元」确定性生成通道（2026-09-26 P2-7）。
 *
 * ── 为什么需要 ──
 * 数轴题的信息载体是**刻度排布**，不是点线构造。走几何重绘（目测 DSL + 视觉闭环）
 * 有两个结构性弱点：
 *   1. 点的位置靠模型目测，√2 画在 1.4 还是 1.5 全看它心情（数值题恰恰要求准确）；
 *   2. 题干把数全写明了（"点A表示-√2""解集为x>2"）时，图其实**不需要看**——
 *      看原图反而引入幻觉。此类题此前要么被内容闸误杀回退描摹，要么消耗视觉额度目测。
 * 本通道与 functionGraph（抛物线确定性骨架）同思路：**从题干文本解析数值 →
 * 服务端按单位长度精确布局 → 复用既有数轴渲染通道**（resolveNumberAxisLabels
 * 吸附、normalizeTickMarks 刻度形态、根式刻度白名单），零视觉调用、坐标零目测。
 *
 * ── 纪律（不猜）──
 *   1. 只收「文本里写明的数」：点值模式 `点X表示…<数>`、解集模式 `解集为x>a`。
 *      题干提到的每个点字母**都必须**有显式值，缺一个就整题放弃（位置可能只在图里）。
 *   2. 解集必须带「解集」字样才收：单独的条件 `x>3` 可能是已知条件而非要画的解。
 *   3. 含其它几何构造（三角形/圆/中点/垂足…）、多子图、分数表达式 → 返回 null。
 *      残缺的图不如原卷裁片。
 *   4. 生成的结构必须 `detectNumberAxis` 可识别（≥2 刻度 + 主轴），否则不出图 ——
 *      数轴识别失败意味着渲染器不会走吸附/摆位通道，画出来是一张歪图。
 *
 * 数值格式覆盖：整数/小数/负数（半角-、全角−、ASCII 连字符统一）、根式 √n、
 * 系数根式 k√n。带四则运算的表达式（如 -√2+2）**不解析**（那是答案不是题设）。
 *
 * @module utils/numberAxis
 */

const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * 解析一个"题面明写的数"：-3 / 2.5 / √2 / -√3 / 2√5。
 * 解析不出返回 null（**不猜**：分数、代数式、无解一律拒）。
 */
export function parseAxisNumber(raw) {
  let t = String(raw ?? '').trim()
  if (!t) return null
  // 负号统一：全角 −、en/em dash、unicode minus → ASCII '-'；去掉正号前缀与空白/转义残留
  t = t.replace(/[−–—－]/g, '-').replace(/^[+＋]/, '').replace(/\\!/g, '').replace(/\s+/g, '')
  let m = /^(-?)(\d{1,4}(?:\.\d+)?)$/.exec(t)
  if (m) return Number(`${m[1]}${m[2]}`)
  m = /^(-?)(\d{0,2})√(\d{1,4})$/.exec(t)
  if (m) {
    const sign = m[1] === '-' ? -1 : 1
    const k = m[2] === '' ? 1 : Number(m[2])
    return sign * k * Math.sqrt(Number(m[3]))
  }
  return null
}

/** 数值 → 刻度标签文本（负号统一用 ASCII '-'，与 isTickNumberLabel/isVertexSymbolLabel 同口径） */
function fmtTick(v) {
  return String(Math.round(v * 1e6) / 1e6)
}

/**
 * 从题干文本解析数轴规格。
 *
 * @param {string} text parent_stem + content 合并文本
 * @returns {null | {
 *   points: Array<{label:string, value:number}>,
 *   solutions: Array<{dir:'>'|'<', value:number, boundLabel:string, hollow:boolean}>
 * }} 无数值可画的内容时返回 null
 */
export function parseNumberAxisSpec(text) {
  const src = String(text ?? '').replace(/\\!\s*/g, '')
  if (!/数轴/.test(src)) return null
  // 分数表达式（\frac/\dfrac/½）→ 位置与数值关系复杂，交给回退通道
  if (/\\d?frac|[½⅓⅔¼¾]/.test(src)) return null

  // ── 点值模式：点X表示的数是-√2 / 点A表示-3.5 / 点B所表示的数为 2√3 ──
  // ⚠️ 连接词必须走「动词 + 任意短连接（≤3 非句读字）」两条：`点X表示的数是…` 里
  // 「的数是」是三个字，旧版单字类 `[数为]?` 只吃一个字→整句丢配（实测回归）。
  const NUM_TOK = "[-−－+]?\\s*(?:\\d+(?:\\.\\d+)?|√\\d{1,4}|\\d{1,2}\\s*√\\s*\\d{1,4})"
  const POINT_RE = new RegExp(`点\\s*([A-Za-z])\\s*(?:表示的数是|表示的数为|表示|所?对应的数|所在数)[^点。；;，,、]{0,3}?\\s*(${NUM_TOK})`, 'g')
  const points = []
  const seen = new Map()
  let m
  while ((m = POINT_RE.exec(src)) !== null) {
    const label = m[1]
    const value = parseAxisNumber(m[2])
    if (!isNum(value) || Math.abs(value) > 1000) return null // 解析不出/超界 → 整题放弃，不留半张图
    if (seen.has(label)) {
      if (seen.get(label) !== value) return null // 同一点两个互相矛盾的值 → 不确定，放弃
      continue
    }
    seen.set(label, value)
    points.push({ label, value })
  }

  // 题干提到的其它点字母必须有显式值（位置可能只在原图里，画不出来就是残图）
  const mentioned = new Set()
  for (const mm of src.matchAll(/(?<![\u4e00-\u9fff])点\s*([A-Za-z])(?![A-Za-z])/g)) mentioned.add(mm[1])
  for (const mm of src.matchAll(/([A-Za-z])\s*(?:表示的?数|对应的数|所表示)/g)) mentioned.add(mm[1])
  for (const l of mentioned) if (!seen.has(l)) return null

  // ── 解集模式：解集为 x>2 / 解集在数轴上表示为 x≥-1 ──
  const solutions = []
  const SOL_RE = /解集[^\n]{0,24}?x\s*(>|≥|＞|⩾|<|≤|＜|⩽)\s*([−－-]?(?:\d+(?:\.\d+)?|√\d{1,4}))/g
  while ((m = SOL_RE.exec(src)) !== null) {
    const dirRaw = m[1]
    const value = parseAxisNumber(m[2])
    if (!isNum(value)) return null
    const dir = ['>', '≥', '＞', '⩾'].includes(dirRaw) ? '>' : '<'
    solutions.push({
      dir,
      value,
      // 题面原样（含根式写法）：非整数端点的轴下标签用它，不用四舍五入小数的 fmtTick
      tickText: m[2].replace(/[−－]/g, '-'),
      hollow: dirRaw === '>' || dirRaw === '<', // 严格不等 → 空心圆点（教材惯例）
    })
    if (solutions.length > 2) return null // 三条以上解集线（不等式组多图）→ 超出本通道形态
  }
  // 解集与点值混排：形态不确定（谁画在哪一侧），放弃
  if (solutions.length > 0 && points.length > 0) return null

  if (points.length === 0 && solutions.length === 0) return null
  return { points, solutions }
}

/**
 * 数轴规格 → 既有几何结构（数学坐标：y 向上为正，轴在 y=0，1 个数值单位 = 100px）。
 *
 * 布局口径与 reactLoop 提示词例 3（数轴 DSL 契约）逐字同构：
 *   轴线 `_ax0→_ax1`（右端箭头 `_arr_t/_arr_b→_ax1`）；刻度 `_tk{i}→_tk{i}t`
 *   站在轴上朝上伸出；刻度数字为 point（渲染器吸附+轴下方居中）；
 *   点名（A/B…）通过 `_hk{lbl}` 虚线挂轴上 ⇒ 判真顶点、圆点不落吸附。
 *
 * @returns {object|null} 结构，或 null（无可画内容）
 */
export function specToNumberAxisStructure(spec) {
  if (!spec) return null
  const pts = []
  const segs = []

  // ── 值域与刻度范围 ──
  const values = [
    ...spec.points.map(p => p.value),
    ...spec.solutions.map(s => s.value),
  ]
  if (values.length === 0) return null
  let lo = Math.floor(Math.min(...values))
  let hi = Math.ceil(Math.max(...values))
  if (lo === hi) { lo -= 1; hi += 1 }
  // 两端至少各留 1 个刻度（箭头侧由 _ax1 外延承担）
  lo -= 1
  const nTicks = hi - lo + 1
  if (nTicks > 21) return null // 值域过宽（如 -100…100），单位长度失真的图不如原裁片
  const unit = 40 // 1 数值单位 = 40 数学像素（渲染器整体缩放到 400×300 画布）
  const xOf = (v) => (v - lo) * unit
  const x0 = xOf(lo) - unit * 0.5
  const x1 = xOf(hi) + unit * 1.2 // 右端外延：箭头与解集射线终点
  const tickH = 3 // 刻度小竖线高度（≈ 轴长 2%，normalizeTickMarks 上限内）

  // ── 轴线 + 右端箭头（DSL 例 3 同款） ──
  pts.push({ label: '_ax0', x: x0, y: 0 }, { label: '_ax1', x: x1, y: 0 })
  segs.push({ from: '_ax0', to: '_ax1' })
  pts.push(
    { label: '_arr_t', x: x1 - unit * 0.15, y: tickH * 1.4 },
    { label: '_arr_b', x: x1 - unit * 0.15, y: -tickH * 1.4 },
  )
  segs.push({ from: '_arr_t', to: '_ax1' }, { from: '_arr_b', to: '_ax1' })

  // ── 整数刻度 + 数字标签 ──
  for (let v = lo; v <= hi; v++) {
    const x = xOf(v)
    pts.push({ label: `_tk${v}`, x, y: 0 }, { label: `_tk${v}t`, x, y: tickH })
    segs.push({ from: `_tk${v}`, to: `_tk${v}t` })
    pts.push({ label: fmtTick(v), x, y: -9 }) // 数字在轴下方（排版意图，渲染器吸附圆点）
  }

  // ── 点值：字母写在轴下方（与刻度数字同侧同口径，渲染器把圆点吸附到轴上居中）──
  // ⚠️ 不用「字母在上方 + 引线挂轴」的形态：竖直引线（dx=0、长度≤10%轴长）会被
  // normalizeTickMarks 误判成刻度线端点被改写，字母圆点悬空在轴上方（实测回归）。
  for (const p of spec.points) {
    const x = xOf(p.value)
    pts.push({ label: p.label, x, y: -9 })
  }

  // ── 解集：轴上端点圆点（空心=严格，实心=含等）→ 引线→ 轴上方解线 + 方向端箭头 ──
  // ⚠️ 引线必须带 `extend:true`：normalizeTickMarks/detectNumberAxis 只把「两端都是 _ 辅助点
  //    且未标直线模式」的近竖直短线当刻度纠偏，extend 段豁免（且渲染层只沿线内缩延长，
  //    形态不变）；不带则引线被当刻度改写，整块解线糊在轴上方（实测回归）。
  //    解线也不能与轴同高：同高同宽会完全重合成一条线，学生看不出解。
  for (const s of spec.solutions) {
    const bx = xOf(s.value)
    const lift = unit * 0.22 // 解线抬高：明显高于刻度顶，又不吃画布
    const dotLbl = `_sd${s.value}`
    pts.push({ label: dotLbl, x: bx, y: 0, type: s.hollow ? 'origin' : 'vertex' })
    // 端点值标签写在轴下方（整数端点已有刻度数字，不重复；根式/小数补上）
    if (!Number.isInteger(s.value)) {
      pts.push({ label: s.tickText || fmtTick(s.value), x: bx, y: -9 })
    }
    const e1 = `_sl${s.dir}`
    const endX = s.dir === '>' ? x1 - unit * 0.15 : x0 + unit * 0.15
    const e2 = `_se${s.dir}`
    pts.push({ label: e1, x: bx, y: lift }, { label: e2, x: endX, y: lift })
    segs.push({ from: dotLbl, to: e1, extend: true }) // 竖直引线（豁免刻度纠偏）
    segs.push({ from: e1, to: e2 })
    // 解线箭头：箭尖落在解线端点，两斜线往回张；不越过轴端箭头
    const tip = s.dir === '>' ? endX + unit * 0.05 : endX - unit * 0.05
    const baseX = s.dir === '>' ? tip - unit * 0.18 : tip + unit * 0.18
    const t1 = `_sat${s.dir}`
    const t2 = `_sab${s.dir}`
    pts.push({ label: t1, x: baseX, y: lift + tickH }, { label: t2, x: baseX, y: lift - tickH })
    segs.push({ from: e2, to: t1 }, { from: e2, to: t2 })
  }

  return {
    figure_type: 'geometry',
    points: pts,
    segments: segs,
    coordinate_system: { exists: false, origin: '', x_axis: false, y_axis: false },
  }
}
