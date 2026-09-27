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
 * 数值格式覆盖：整数/小数/负数（半角-、全角−、ASCII 连字符统一）、分数 a/b（真/假分数，
 * 2026-09-27 补）、根式 √n、系数根式 k√n。带四则运算的表达式（如 -√2+2）**不解析**
 * （那是答案不是题设）。
 *
 * @module utils/numberAxis
 */

const isNum = (v) => typeof v === 'number' && isFinite(v)

/**
 * 解析一个"题面明写的数"：-3 / 2.5 / -2/3 / √2 / -√3 / 2√5。
 * 解析不出返回 null（**不猜**：代数式、无解、带运算的表达式一律拒）。
 */
export function parseAxisNumber(raw) {
  let t = String(raw ?? '').trim()
  if (!t) return null
  // 负号统一：全角 −、en/em dash、unicode minus → ASCII '-'；去掉正号前缀与空白/转义残留
  t = t.replace(/[−–—－]/g, '-').replace(/^[+＋]/, '').replace(/\\!/g, '').replace(/\s+/g, '')
  let m = /^(-?)(\d{1,4}(?:\.\d+)?)$/.exec(t)
  if (m) return Number(`${m[1]}${m[2]}`)
  // 真/假分数（2026-09-27 补）：教材里刻度写分数比写小数常见，旧口径一律拒 ⇒
  // 实测 d0ccaf00 题干明写「点A表示的数是-2/3」却始终不出图（数值只在图里这条解释不成立，
  // 根因就是这里）。分数是**精确值**，与整数/小数同等可信，可直接参与精确布局。
  // 分母为 0、或数字后还跟着别的字符（-√2+2、1/2x —— 那是答案/代数式而非刻度）一律拒。
  m = /^(-?)(\d{1,4})\/(\d{1,4})$/.exec(t)
  if (m) {
    const den = Number(m[3])
    if (den === 0) return null
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) / den)
  }
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
  const NUM_TOK = "[-−－+]?\\s*(?:\\d{1,4}\\s*\\/\\s*\\d{1,4}|\\d+(?:\\.\\d+)?|√\\d{1,4}|\\d{1,2}\\s*√\\s*\\d{1,4})"
  // 数字尾部负向断言（2026-09-27）：分数必须整体吃下，数字不许被"吃半截"。
  // 旧口径下「点A表示的数是-2/3」只吃到 "-2" ⇒ 点被画到 -2 的刻度上（比不出图更糟：
  // 出了张错的图）。同理「-3/4x」「2√3」要么整体匹配、要么整条放弃。
  const NUM_END = "(?![0-9A-Za-z.√/])"
  const POINT_RE = new RegExp(`点\\s*([A-Za-z])\\s*(?:表示的数是|表示的数为|表示|所?对应的数|所在数)[^点。；;，,、]{0,3}?\\s*(${NUM_TOK})${NUM_END}`, 'g')
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
  const SOL_RE = new RegExp(`解集[^\\n]{0,24}?x\\s*(>|≥|＞|⩾|<|≤|＜|⩽)\\s*([−－-]?(?:\\d{1,4}\\s*\\/\\s*\\d{1,4}|\\d+(?:\\.\\d+)?|√\\d{1,4}))${NUM_END}`, 'g')
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

  // ── 枚举模式（2026-09-27）：「数轴上有 O、A、B、C、D 五个点，分别表示数 0、2、3、4、5」──
  // 教材常见的并列写法：点值不在「点X表示…」句式里，而在字母串+数值串的**一一对应**里。
  // 数值全部写在题面 ⇒ 仍是零目测；字母数与数值数不匹配、或任一数值解析不出 → 整题放弃。
  // 只在点值/解集模式一无所获时启用（不与既有结果混排，避免同点双源冲突）。
  if (points.length === 0 && solutions.length === 0) {
    const em = src.match(
      /([A-Za-z](?:\s*[、，,]\s*[A-Za-z]){1,9})\s*(?:[一二两三四五六七八九十\d]+\s*个点\s*)?[，,]?\s*分别\s*(?:表示|对应)\s*(?:的数是|的数为|的数|数)?\s*为?\s*([^。；;]{1,80})/,
    )
    if (em) {
      const letters = em[1].split(/\s*[、，,]\s*/).map(s => s.trim()).filter(Boolean)
      const rawVals = em[2].split(/\s*[、，,]\s*/).map(s => s.trim()).filter(Boolean)
      const vals = []
      for (const tok of rawVals) {
        const v = parseAxisNumber(tok)
        if (!isNum(v)) break // 第一个解析不出的 token 起是题面叙述，截断
        vals.push(v)
      }
      if (letters.length >= 2 && letters.length === vals.length) {
        for (let i = 0; i < letters.length; i++) {
          if (seen.has(letters[i])) {
            if (seen.get(letters[i]) !== vals[i]) return null // 同点双值矛盾 → 放弃
            continue
          }
          seen.set(letters[i], vals[i])
          points.push({ label: letters[i], value: vals[i] })
        }
      }
    }
  }

  if (points.length === 0 && solutions.length === 0) return null
  return { points, solutions }
}

/**
 * 数轴规格 → 既有几何结构（数学坐标：y 向上为正，轴在 y=0，1 个数值单位 = 100px）。
 *
 * 布局口径与 reactLoop 提示词例 3（数轴 DSL 契约）逐字同构：
 *   轴线 `_ax0→_ax1`（右端箭头 `_arr_t/_arr_b→_ax1`）；刻度 `_tk{i}→_tk{i}t`
 *   站在轴上朝上伸出；刻度数字为 point（渲染器吸附+轴下方居中）；
 *   点名（A/B…）为 y=0 的**孤立** point ⇒ 圆点落轴上、字母摆轴上方（与数字异侧，互不压）
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

  // ── 点值：字母写在**轴上方**（题面「数字在下、点名在上」的原卷惯例）──
  // ⚠️ 不能写 y=-9（刻度数字那一行）：整数值的点（「点A表示的数是-2」——最常见的题型）
  //    字母会与刻度数字**完全重叠**，实测两者的 <text> 坐标逐位相同，"A" 正压在 "-2" 上，
  //    题面点名读不出来（比不出图更糟）。
  // ⚠️ 也不能「字母在上方 + 引线挂轴」：竖直引线（dx=0、长度 ≤ 轴长 10%、两端都是 _ 辅助点）
  //    会被 normalizeTickMarks 判成刻度线而纠偏改写，字母圆点被抬得悬空在轴上方。
  //    这里只给孤立点、不给引线：resolveNumberAxisLabels 按 y 定侧向（y 在轴上/上方 ⇒ 大写
  //    字母摆上方），且 snap=true 会把圆点吸附回轴上 ⇒ 圆点在轴上、字母在轴上方、数字在轴下方。
  //    y 取 +9 与提示词规则 13（数字在下 y≈-9、点名在上 y≈+9）逐字同构。
  for (const p of spec.points) {
    const x = xOf(p.value)
    pts.push({ label: p.label, x, y: 9 })
  }

  // ── 解集：轴上端点圆点（空心=严格，实心=含等）→ 引线→ 轴上方解线 + 方向端箭头 ──
  // ⚠️ 引线必须带 `extend:true`：normalizeTickMarks/detectNumberAxis 只把「两端都是 _ 辅助点
  //    且未标直线模式」的近竖直短线当刻度纠偏，extend 段豁免（且渲染层只沿线内缩延长，
  //    形态不变）；不带则引线被当刻度改写，整块解线糊在轴上方（实测回归）。
  //    解线也不能与轴同高：同高同宽会完全重合成一条线，学生看不出解。
  let solIdx = 0
  for (const s of spec.solutions) {
    const bx = xOf(s.value)
    const lift = unit * 0.22 // 解线抬高：明显高于刻度顶，又不吃画布
    // ⚠️ 端点圆点的载体标签**绝不能带 `_` 前缀**：`_` = 内部辅助点 ⇒ 渲染器既不画圆点也不画
    //    文字（SVG/TikZ 同判据，见 isAuxPointLabel 契约）。而「不含等 < / 含等 ≤」的唯一视觉
    //    区分就是这颗粒子的**空心 / 实心**——旧口径写 `_sd{v}`，整数端点（x>2、x≤−1）的圆点
    //    整颗丢失，学生看到的是一条从刻度数字旁起笔的裸解线，含等与不含等完全一样（实测 2026-09-27）。
    //    载体也不能长得像顶点符号，否则渲染器会把它当字母打印出来 ⇒ 取「含下划线」的非符号名：
    //    渲染器画圆点、不画文字，两个渲染器、内容闸与发布侧标注校验都把它当渲染家具（已核实）。
    const dotLbl = `sd_${s.dir === '>' ? 'g' : 'l'}${solIdx++}`
    pts.push({ label: dotLbl, x: bx, y: 0, type: s.hollow ? 'origin' : 'vertex' })
    // 端点值标签写在轴下方（整数端点已有刻度数字，不重复；分数/根式/小数补上）
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
