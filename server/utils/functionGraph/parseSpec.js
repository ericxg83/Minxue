/**
 * 函数图象规格解析（确定性，零模型调用）。
 *
 * 为什么不用视觉模型：函数表达式本来就写在题干里（"抛物线 y=ax²+1(a<0)"），
 * 让视觉模型去"看图猜函数"既不可靠又消耗额度。这里直接从题干文本解析出图形规格，
 * 服务端确定性采样渲染。
 *
 * 安全原则（沿用"宁愿少显示，也不显示错误信息"）：
 *   **开口方向或顶点位置任一无法确定时，返回 null**，由调用方回退展示裁剪原图。
 *   宁可不出图，也不给学生一张形状错误的示意图。
 *
 * 两条求解路径（先 A 后 B。A 优先是因为 a 是题设给定的，不该被"由点反解"覆盖）：
 *   路径 A —— 表达式里 a 是数字（y=x²-2x-3 / y=½(x-2)²+4 / y=3x²-1 …）
 *     A1 系数全数字         → 直接算出 a/h/k
 *     A2 无一次项 + C 数字   → 顶点在 y 轴上
 *     A3 对称轴 + C 数字     → 定 b，再算 h/k
 *     A4 显式顶点坐标        → 先与表达式系数交叉核对，矛盾就整体拒绝
 *     A5 对称轴 + 一个点     → k = y0 - a(x0-h)²
 *     A6 C 数字 + 一个点     → 解 b
 *     A7 两个点             → 解 (b, c)
 *   路径 B —— 表达式里 a 是符号（y=ax²+bx+c / y=a(x+m)² …）
 *     B1 显式顶点坐标 + 一个点 → 解 a（a 的符号是**解出来的**，不是猜的）
 *     B2 对称轴 + 两个点       → 解 a
 *     B3 C 数字 + 两个点       → 解 (a, b)
 *     B4 题干条件 a>0 / a<0   → 取 a=±1 作代表元，陡缓属示意（approximate=true）
 *   两条都不成立 → null（回退裁剪原图）
 */

// ────────────────────────────────────────────────────────────
// 文本归一化
// ────────────────────────────────────────────────────────────

/** 全角/数学符号/LaTeX 定界符归一，让后续正则只需要处理 ASCII 形态 */
function normalizeText(text) {
  return String(text ?? '')
    .replace(/\\[()[\]]/g, '')       // LaTeX 行内定界符 \( \) \[ \]
    .replace(/\$/g, '')              // LaTeX 数学模式符
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[－−–—]/g, '-')
    .replace(/[＜]/g, '<')
    .replace(/[＞]/g, '>')
    .replace(/[＝]/g, '=')
    .replace(/[＋]/g, '+')
    .replace(/[≠]/g, '!=')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/½/g, '1/2')
    .replace(/⅓/g, '1/3')
    .replace(/¼/g, '1/4')
    .replace(/／/g, '/')
    .replace(/[，]/g, ',')
    .replace(/[。；]/g, ';')
    .replace(/[：]/g, ':')
    .replace(/[₀-₉]/g, '')           // 下标 x₁ y₁ → x y（避免被当成带字母的坐标点）
    .replace(/\s+/g, ' ')
    .trim()
}

const NUM_RE = /^[-+]?\d+(?:\.\d+)?(?:\/\d+)?$/

/** '3' / '-3/2' / '1.5' → number；无法解析返回 null */
export function parseNumber(s) {
  const t = String(s ?? '').replace(/\s+/g, '')
  if (!NUM_RE.test(t)) return null
  const m = t.match(/^([-+]?)(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  const n = Number(m[2])
  const d = m[3] != null ? Number(m[3]) : 1
  if (!isFinite(n) || !isFinite(d) || d === 0) return null
  return sign * (n / d)
}

// ────────────────────────────────────────────────────────────
// 系数解析
// ────────────────────────────────────────────────────────────

/**
 * 系数原文 → { num, sym, sign }。
 *   '' / '+'      → { num: 1 }
 *   '-'           → { num: -1 }
 *   '3' / '-3/2'  → { num: 3 }
 *   'a' / '-a' / '2a' → { num: null, sym: 'a', sign: 1|-1 }
 */
function resolveCoef(raw) {
  const t = String(raw ?? '').replace(/\s+/g, '')
  if (t === '' || t === '+') return { num: 1, sym: null, sign: 1 }
  if (t === '-') return { num: -1, sym: null, sign: -1 }
  const n = parseNumber(t)
  if (n != null) return { num: n, sym: null, sign: n < 0 ? -1 : 1 }
  const m = t.match(/^([-+]?)(\d+(?:\.\d+)?(?:\/\d+)?)?([a-zA-Z])$/)
  if (m) {
    const sign = m[1] === '-' ? -1 : 1
    return { num: null, sym: m[3], sign }
  }
  return { num: null, sym: null, sign: null }
}

/** 按顶层 +/- 切分表达式（括号内不切）。'x^2-2x-3' → ['x^2','-2x','-3'] */
function splitTerms(expr) {
  const s = String(expr)
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && (ch === '+' || ch === '-') && cur !== '') {
      out.push(cur)
      cur = ch
    } else {
      cur += ch
    }
  }
  if (cur) out.push(cur)
  return out.map(t => t.trim()).filter(Boolean)
}

/**
 * 归类单个项。返回 { deg, coefRaw, vertexForm?, shiftRaw? }，无法识别返回 null。
 *   'x^2'      → deg 2, coefRaw ''
 *   '-3/2x^2'  → deg 2, coefRaw '-3/2'
 *   '3(x-1)^2' → deg 2, vertexForm, coefRaw '3', shiftRaw '-1'
 *   '2ax'      → deg 1, coefRaw '2a'
 *   '-4'       → deg 0, coefRaw '-4'
 */
function classifyTerm(term) {
  const t = String(term).replace(/\s+/g, '')
  if (!t) return null

  // 顶点式：COEF(x±S)^2
  const vf = t.match(/^([-+]?(?:\d+(?:\.\d+)?(?:\/\d+)?)?[a-zA-Z]?)?\*?\(x([-+](?:\d+(?:\.\d+)?(?:\/\d+)?|[a-zA-Z]))?\)\^2$/)
  if (vf) return { deg: 2, vertexForm: true, coefRaw: vf[1] || '', shiftRaw: vf[2] || '' }

  if (/x\^2$/.test(t)) return { deg: 2, coefRaw: t.slice(0, -3) }
  if (/x$/.test(t)) return { deg: 1, coefRaw: t.slice(0, -1) }
  return { deg: 0, coefRaw: t }
}

/** 解析 y=<rhs> 的右端，返回 { A, B, C, vertexForm:{shift} } 或 null */
function parseQuadraticRhs(rhs) {
  const t = String(rhs).replace(/\s+/g, '')
  if (!t) return null
  const terms = splitTerms(t)
  if (terms.length === 0) return null

  let quad = null
  let lin = null
  let cons = null
  for (const term of terms) {
    const c = classifyTerm(term)
    if (!c) return null // 有无法识别的项 → 整体放弃，不猜
    if (c.deg === 2) { if (quad) return null; quad = c }
    else if (c.deg === 1) { if (lin) return null; lin = c }
    else { if (cons) return null; cons = c }
  }
  if (!quad) return null // 不是二次函数

  return {
    A: resolveCoef(quad.coefRaw),
    B: lin ? resolveCoef(lin.coefRaw) : { num: 0, sym: null, sign: 1 },
    C: cons ? resolveCoef(cons.coefRaw) : { num: 0, sym: null, sign: 1 },
    hasLinearTerm: !!lin,
    vertexForm: quad.vertexForm ? { shift: resolveCoef(quad.shiftRaw) } : null
  }
}

// ────────────────────────────────────────────────────────────
// 题干特征抽取
// ────────────────────────────────────────────────────────────

/** 从题干提取符号条件：'a<0' → { a: -1 }；'an>0' 这类乘积式不采信 */
function parseSignConditions(text) {
  const out = {}
  for (const m of String(text).matchAll(/(?<![a-zA-Z])([a-zA-Z])\s*([<>])\s*0(?!\d)/g)) {
    out[m[1]] = m[2] === '<' ? -1 : 1
  }
  return out
}

/** 从题干提取对称轴：'对称轴为直线x=2' / '对称轴是直线 x=3/2' */
function parseAxisOfSymmetry(text) {
  const m = String(text).match(/对称轴\s*(?:为|是)?\s*(?:直线)?\s*x\s*=\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)/)
  return m ? parseNumber(m[1]) : null
}

/**
 * 从题干提取**显式给出的顶点坐标**：'顶点坐标为(1,4)' / '顶点是(1,4)'
 *
 * `为|是` 是必需的：'△OAB 的顶点A(-2,4)' 里的"顶点A"是三角形顶点，
 * 不是抛物线顶点，少了这道限制就会把三角形顶点当成抛物线顶点。
 */
function parseVertexCoord(text) {
  const m = String(text).match(/顶点\s*(?:坐标)?\s*(?:为|是)\s*[A-Z]?\s*\(\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*\)/)
  if (!m) return null
  const x = parseNumber(m[1])
  const y = parseNumber(m[2])
  return x == null || y == null ? null : { x, y }
}

/** 所有带字母的坐标点：'A(-1,0)' / 'B(4,2)' / '点 A 的坐标为(-1,0)'（下标已归一） */
export function extractNamedPoints(text) {
  const s = String(text)
  const out = []
  const seen = new Set()
  const push = (label, xRaw, yRaw, index) => {
    const x = parseNumber(xRaw)
    const y = parseNumber(yRaw)
    if (x == null || y == null || seen.has(label)) return
    seen.add(label)
    out.push({ label, x, y, index })
  }

  // 形式一：A(-1,0)
  for (const m of s.matchAll(/([A-Z])\s*\(\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*\)/g)) {
    push(m[1], m[2], m[3], m.index)
  }
  // 形式二：点A的坐标为(-1,0) / 点 A 的坐标是(-1,0)
  for (const m of s.matchAll(/点\s*([A-Z])\s*的?\s*坐标\s*(?:为|是)\s*\(\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:\/\d+)?)\s*\)/g)) {
    push(m[1], m[2], m[3], m.index)
  }
  return out.sort((a, b) => a.index - b.index)
}

/**
 * 只保留**能确认在抛物线上**的点。
 *
 * 这是整条链路上最需要保守的一步：题干里的坐标点未必在曲线上
 * （"过B、C、D三点的抛物线"里的 B 是待求的；"平行四边形顶点A的坐标为(2,6)"的 A 在平行四边形上）。
 * 用错一个点就会画出一条形状错误的曲线，所以只采信明确的"在曲线上"表述。
 *
 * 做法分两步（解耦，因为坐标常在触发短语之后很远才给出）：
 *   1) 从触发短语里收集**可信字母**：'交于点 A、B' / '过点 C(0,3)' / '经过点 A(2,2)'
 *   2) 或字母后面直接跟"在（该）抛物线上"
 *   坐标点只有标签落在这个集合里才会被采信。
 */
/**
 * 触发短语后跟的**字母列表**：支持 '交于点 A(2,0)、B(-4,0)' 与 '经过点C(0,3)和点D(0,100)'
 * 两种写法（坐标可省、分隔符可省、第二个字母前可带"点"）。
 */
const TRUSTED_LABEL_RE = /(?:经过点|经过|过原点|过点|交于点|相交于点|抛物线过|的图象过|的图像过|图象过|图像过|都在|在抛物线|在函数图象|在函数图像)\s*((?:点?\s*[A-Z]\s*(?:\(\s*[^)]*\))?\s*[、,和与及]?\s*)+)/g
const ON_CURVE_AFTER = /(?:在|都在)\s*(?:该)?\s*(?:抛物线|函数|二次函数|图象|图像)/
const LABEL_RE = /[A-Z]/g

function collectTrustedLabels(text) {
  const s = String(text)
  const set = new Set()
  for (const m of s.matchAll(TRUSTED_LABEL_RE)) {
    const labels = m[1].match(LABEL_RE)
    if (labels) for (const l of labels) set.add(l)
  }
  // 后置形式：'A(－2,4)在抛物线y=ax²上'
  for (const m of s.matchAll(/([A-Z])\s*\(/g)) {
    if (ON_CURVE_AFTER.test(s.slice(m.index, m.index + 32))) set.add(m[1])
  }
  return set
}

function extractCurvePoints(text, points) {
  const trusted = collectTrustedLabels(text)
  if (trusted.size === 0) return []
  return points.filter(p => trusted.has(p.label))
}

/**
 * 从 `y = <RHS>` 里取出干净的 RHS。
 * 'ax^2+1(a<0) 与过点 (0,-3)…'  → 'ax^2+1'
 * 'x^2-2x-3. (2)在平面直角…'    → 'x^2-2x-3'
 * '-3/2(x-h)^2+k(h,k为常数)'    → '-3/2(x-h)^2+k'
 */
function cleanRhs(raw) {
  let t = String(raw)
  // 截到第一个中文字符（归一后表达式全是 ASCII，中文一定属于题面描述）
  const cjk = t.search(/[\u4e00-\u9fff]/)
  if (cjk >= 0) t = t.slice(0, cjk)
  // 去掉末尾未闭合的 '('
  const lastOpen = t.lastIndexOf('(')
  if (lastOpen >= 0 && t.indexOf(')', lastOpen) < 0) t = t.slice(0, lastOpen)
  // 去掉末尾的条件括号：(a<0) / (a≠0) / (an>0)
  t = t.replace(/\([^()]*[<>!][^()]*\)\s*$/, '')
  // 去掉末尾的小问号/题号括号：(1)(2)(3) —— 实测这是最常见的污染源
  t = t.replace(/(?:\(\s*\d+\s*\)\s*)+$/, '')
  // 去掉末尾空白与标点（'x^2-2x-3. ' 里的句点后面跟着空格，必须先吃掉空白）
  t = t.replace(/[\s.,;:]+$/, '')
  return t.trim()
}

// ────────────────────────────────────────────────────────────
// 求解
// ────────────────────────────────────────────────────────────

const EPS = 1e-9

/**
 * 把 (a, h, k) 组装成规格，并做一致性校验。
 * 所有被采信的曲线点都必须真的落在曲线上，否则说明采信错了点 → 返回 null。
 */
function finalize(a, h, k, meta, curvePoints) {
  if (![a, h, k].every(v => typeof v === 'number' && isFinite(v))) return null
  if (a === 0) return null
  for (const p of curvePoints) {
    const pred = a * (p.x - h) * (p.x - h) + k
    const tol = Math.max(1e-6, Math.abs(p.y) * 1e-6)
    if (Math.abs(pred - p.y) > tol) return null
  }
  return {
    kind: 'parabola',
    opens: a > 0 ? 'up' : 'down',
    vertex: { x: h, y: k },
    a,
    approximate: !!meta.approximate,
    solvedFrom: meta.solvedFrom,
    vertexForm: !!meta.vertexForm
  }
}

/**
 * 尝试把一段 RHS 解析成二次函数规格。
 *
 * 路径按可靠性排序，且**先走 a 已知的分支**：
 * 表达式里 a 是数字时，它就是题设给定的开口与陡缓，绝不能被"由点反解 a"覆盖。
 * 只有 a 是符号（a / k / m 这类）时，才用题干里的顶点、对称轴、点去反解。
 *
 * @returns {object|null}
 */
function tryParseQuadratic(rhs, ctx) {
  const parsed = parseQuadraticRhs(rhs)
  if (!parsed) return null
  const { A, B, C, hasLinearTerm, vertexForm } = parsed
  const { conditions, axisOfSymmetry, vertexCoord, curvePoints } = ctx

  // ══════════ 顶点式 y = A(x - s)² + C ══════════
  if (vertexForm) {
    const s = vertexForm.shift
    const a = A.num
    const h = s && s.num != null ? -s.num : null
    const k = C.num
    // 全数字顶点式 → 直接
    if (a != null && h != null && k != null) {
      const spec = finalize(a, h, k, { solvedFrom: 'vertex_form_exact', vertexForm: true }, curvePoints)
      if (spec) return spec
    }
    // 顶点位置已知（表达式里或题干里）+ 一个曲线点 → 解 a
    // 表达式给的对称轴与题干给的顶点必须一致，矛盾说明题干解析有误
    if (h != null && vertexCoord && Math.abs(h - vertexCoord.x) > 1e-6) return null
    const hh = h != null ? h : (vertexCoord ? vertexCoord.x : null)
    const kk = k != null ? k : (vertexCoord ? vertexCoord.y : null)
    if (hh != null && kk != null) {
      const spec = solveFromVertexAndPoint(hh, kk, curvePoints, { vertexForm: true })
      if (spec) return spec
    }
    return null
  }

  // ══════════ 一般式 y = Ax² + Bx + C ══════════

  // y = ax² + c 没有一次项，顶点必然落在 y 轴上。
  // 题干却给出偏离 0 的顶点/对称轴 → 题面自相矛盾，整体拒绝。
  if (!hasLinearTerm) {
    if (vertexCoord && Math.abs(vertexCoord.x) > 1e-6) return null
    if (axisOfSymmetry != null && Math.abs(axisOfSymmetry) > 1e-6) return null
  }

  // ── 路径 A：a 是数字 → 优先，a 由题设给定，不做反解 ──
  if (A.num != null && A.num !== 0) {
    const a = A.num
    const at = (h, k, from) => finalize(a, h, k, { solvedFrom: from }, curvePoints)

    // 题干给出的顶点/对称轴必须与表达式自身的系数自洽。
    // 例：'y=2x²+bx+1，顶点坐标为(1,3)' —— 顶点 x=1 要求 b=-4，此时顶点 y 只能是 -1，
    // 与题面写的 3 矛盾。这类矛盾说明题干解析或 OCR 有误，整体拒绝而不是挑一个信。
    const impliedB = vertexCoord ? -2 * a * vertexCoord.x
      : (axisOfSymmetry != null ? -2 * a * axisOfSymmetry : null)
    if (impliedB != null && B.num != null && Math.abs(impliedB - B.num) > 1e-6) return null
    if (vertexCoord && C.num != null && impliedB != null) {
      const kImplied = C.num - (impliedB * impliedB) / (4 * a)
      if (Math.abs(kImplied - vertexCoord.y) > 1e-6) return null
    }

    // A1 系数全数字
    if (B.num != null && C.num != null) {
      const spec = at(-B.num / (2 * a), C.num - (B.num * B.num) / (4 * a), 'numeric_all')
      if (spec) return spec
    }
    // A2 无一次项 + C 数字 → 顶点在 y 轴
    if (!hasLinearTerm && C.num != null) {
      const spec = at(0, C.num, 'numeric_no_linear')
      if (spec) return spec
    }
    // A3 对称轴 + C 数字 → 定 B
    if (C.num != null && axisOfSymmetry != null) {
      const b = -2 * a * axisOfSymmetry
      const spec = at(axisOfSymmetry, C.num - (b * b) / (4 * a), 'numeric_with_axis')
      if (spec) return spec
    }
    // A4 显式顶点坐标 → h/k 直接给出
    if (vertexCoord) {
      const spec = at(vertexCoord.x, vertexCoord.y, 'numeric_with_vertex')
      if (spec) return spec
    }
    // A5 对称轴 + 一个点 → k = y0 - a(x0 - h)²
    if (axisOfSymmetry != null) {
      for (const p of curvePoints) {
        const k = p.y - a * (p.x - axisOfSymmetry) * (p.x - axisOfSymmetry)
        const spec = at(axisOfSymmetry, k, 'numeric_axis_and_point')
        if (spec) return spec
      }
    }
    // A6 C 数字 + 一个点（x0≠0）→ b = (y0 - a·x0² - C)/x0
    if (C.num != null) {
      for (const p of curvePoints) {
        if (Math.abs(p.x) < 1e-9) continue
        const b = (p.y - a * p.x * p.x - C.num) / p.x
        const spec = at(-b / (2 * a), C.num - (b * b) / (4 * a), 'numeric_c_and_point')
        if (spec) return spec
      }
    }
    // A7 两个点 → 解 (b, c)
    if (curvePoints.length >= 2) {
      for (let i = 0; i < curvePoints.length; i++) {
        for (let j = i + 1; j < curvePoints.length; j++) {
          const p = curvePoints[i]
          const q = curvePoints[j]
          if (Math.abs(p.x - q.x) < 1e-9) continue
          const b = ((p.y - a * p.x * p.x) - (q.y - a * q.x * q.x)) / (p.x - q.x)
          const c = p.y - a * p.x * p.x - b * p.x
          const spec = at(-b / (2 * a), c - (b * b) / (4 * a), 'numeric_two_points')
          if (spec) return spec
        }
      }
    }
    return null
  }

  // ── 路径 B：a 是符号 → 用顶点/对称轴/点反解 a（解出的符号即开口，不是猜的）──

  // B1 显式顶点坐标 + 一个曲线点
  if (vertexCoord) {
    const spec = solveFromVertexAndPoint(vertexCoord.x, vertexCoord.y, curvePoints, {})
    if (spec) return spec
  }

  // B2 对称轴 + 两个曲线点
  if (axisOfSymmetry != null) {
    const spec = solveFromAxisAndPoints(axisOfSymmetry, curvePoints)
    if (spec) return spec
  }

  // B3 C 数字 + 两个曲线点 → 解 (a, b)
  if (C.num != null && curvePoints.length >= 2) {
    const spec = solveFromTwoPointsAndC(curvePoints, C.num)
    if (spec) return spec
  }

  // B4 题干条件(a>0 / a<0)定开口 → 取 ±1 作代表元，陡缓属示意
  const sign = symbolSign(A, conditions)
  if (sign != null) {
    const h = vertexCoord ? vertexCoord.x : (axisOfSymmetry ?? (!hasLinearTerm ? 0 : null))
    if (h != null) {
      const k = vertexCoord ? vertexCoord.y
        : (curvePoints.length > 0 ? curvePoints[0].y - sign * (curvePoints[0].x - h) * (curvePoints[0].x - h) : null)
      if (k != null) {
        const spec = finalize(sign, h, k, { approximate: true, solvedFrom: 'symbolic_representative' }, [curvePoints[0]].filter(Boolean))
        if (spec) return spec
      }
    }
  }

  return null
}

/** 符号系数 a 的符号来源：题干条件 a>0 / a<0 */
function symbolSign(coef, conditions) {
  if (coef.num != null) return coef.num > 0 ? 1 : -1
  if (coef.sym && conditions[coef.sym]) return conditions[coef.sym] > 0 ? 1 : -1
  return null
}

/** 顶点 (h,k) + 曲线上一点 → a = (y0 - k)/(x0 - h)² */
function solveFromVertexAndPoint(h, k, curvePoints, meta) {
  for (const p of curvePoints) {
    const dx = p.x - h
    if (Math.abs(dx) < 1e-9) continue
    const a = (p.y - k) / (dx * dx)
    if (!isFinite(a) || Math.abs(a) < 1e-9) continue
    const spec = finalize(a, h, k, { ...meta, solvedFrom: meta.solvedFrom || 'vertex_and_point' }, curvePoints)
    if (spec) return spec
  }
  return null
}

/**
 * 对称轴 h + 两个曲线点 → a = (y1-y2) / ((x1-h)² - (x2-h)²)
 * 要求两点关于对称轴的偏移不同（否则分母为 0，解不出 a）。
 */
function solveFromAxisAndPoints(h, curvePoints) {
  for (let i = 0; i < curvePoints.length; i++) {
    for (let j = i + 1; j < curvePoints.length; j++) {
      const p = curvePoints[i]
      const q = curvePoints[j]
      const d1 = (p.x - h) * (p.x - h)
      const d2 = (q.x - h) * (q.x - h)
      const den = d1 - d2
      if (Math.abs(den) < 1e-9) continue
      const a = (p.y - q.y) / den
      if (!isFinite(a) || Math.abs(a) < 1e-9) continue
      const k = p.y - a * d1
      const spec = finalize(a, h, k, { solvedFrom: 'axis_and_two_points' }, curvePoints)
      if (spec) return spec
    }
  }
  return null
}

/**
 * 两个曲线点 + 常数项 C → 解 (a, b)
 *   y1 = a·x1² + b·x1 + C
 *   y2 = a·x2² + b·x2 + C
 */
function solveFromTwoPointsAndC(curvePoints, c) {
  for (let i = 0; i < curvePoints.length; i++) {
    for (let j = i + 1; j < curvePoints.length; j++) {
      const p = curvePoints[i]
      const q = curvePoints[j]
      if (Math.abs(p.x - q.x) < 1e-9) continue
      // 克莱姆法则：[[x1², x1], [x2², x2]] · [a, b] = [y1-C, y2-C]
      const det = p.x * p.x * q.x - q.x * q.x * p.x
      if (Math.abs(det) < 1e-12) continue
      const r1 = p.y - c
      const r2 = q.y - c
      const a = (r1 * q.x - r2 * p.x) / det
      const b = (p.x * p.x * r2 - q.x * q.x * r1) / det
      if (!isFinite(a) || !isFinite(b) || Math.abs(a) < 1e-9) continue
      const h = -b / (2 * a)
      const k = c - (b * b) / (4 * a)
      const spec = finalize(a, h, k, { solvedFrom: 'two_points_and_c' }, curvePoints)
      if (spec) return spec
    }
  }
  return null
}

// ────────────────────────────────────────────────────────────
// 主入口
// ────────────────────────────────────────────────────────────

/** 题干里出现"抛物线"才允许走"无表达式反推"路径 */
const PARABOLA_RE = /抛物线/

/**
 * 收集"与x轴交于X、Y两点"这类句式里的有序字母。
 *
 * 为什么需要：这类抛物线题题干会写"抛物线与x轴交于A、B两点"但不给坐标，
 * A、B 的位置（y=0 的两个根）由表达式唯一确定，是**可求的**。此前解析器
 * 只采信"带坐标的点"（C(0,3) 这种），A、B 因无坐标被丢 —— 图上就少了
 * 两个关键交点标注（2026-09-18 用户截图实锤：顶点(1,4) 抛物线题缺 A、B）。
 *
 * 只认"交于X、Y两点"（两字母），单交点（"交于点M"）暂不支持 —— 抛物线与
 * x 轴相切（判别式=0）罕见且字母顺序难定，保守起见等有实例再扩展。
 *
 * @returns {string[]|null} 有序字母数组，未命中返回 null
 */
function collectXInterceptLabels(text) {
  const s = String(text || '')
  const re = /与\s*x\s*轴\s*交\s*(?:于|在)?\s*(?:点)?\s*([A-Z])\s*[、,，和与及]?\s*(?:点)?\s*([A-Z])\s*两点/
  const m = re.exec(s)
  if (!m) return null
  const a = m[1], b = m[2]
  if (!a || !b || a === b) return null
  return [a, b]
}

/**
 * 收集"点X(m,n)是抛物线上一点"这类**无坐标符号点**的字母。
 *
 * 为什么需要：题干常写"点D(m,n)是抛物线上一点"——D 在曲线上但坐标是符号
 * （m/n 的值由后续小问给定），`extractNamedPoints` 只收数字坐标，D 被丢 →
 * 图上缺一个关键标注（2026-09-18 用户对比原图实锤：A、B 修好后 D 仍缺失）。
 *
 * 只认"点X(...)是(该)抛物线上一点"句式，避免把"平行四边形顶点A的坐标为…"等
 * 无关字母收进来。返回无序字母集合（渲染层给示意位置，与顺序无关）。
 */
function collectSymbolicCurveLabels(text) {
  const s = String(text || '')
  const set = new Set()
  const re = /点\s*([A-Z])\s*\([a-z][^)]*\)\s*(?:是|为)\s*(?:该\s*)?(?:抛物线|函数图象|函数图像|图象|图像|函数)上\s*(?:一|的)?\s*(?:点)?/g
  for (const m of s.matchAll(re)) {
    if (m[1]) set.add(m[1])
  }
  // 兜底写法："D 是抛物线上一点"（无括号坐标）
  const re2 = /([A-Z])\s*(?:是|为)\s*(?:该\s*)?(?:抛物线|函数图象|函数图像|图象|图像|函数)上\s*(?:一|的)?\s*(?:点)?/g
  for (const m of s.matchAll(re2)) {
    if (m[1]) set.add(m[1])
  }
  return [...set]
}

/** 组装最终返回值，统一带上溯源字段 */
function wrap(spec, rhs, ctx, namedPoints) {
  return {
    ...spec,
    axisOfSymmetry: ctx.axisOfSymmetry,
    namedPoints,
    curvePoints: ctx.curvePoints.map(p => ({ label: p.label, x: p.x, y: p.y })),
    xInterceptLabels: ctx.xInterceptLabels || null,
    symbolicCurveLabels: ctx.symbolicCurveLabels || [],
    expression: rhs ? `y=${rhs.replace(/\s+/g, '')}` : 'y=ax²+bx+c（由顶点/交点反推）'
  }
}

/**
 * 题干 → 函数图象规格。无法确定图形时返回 null。
 *
 * @param {string} parentStem - 多小问大题的公共题干
 * @param {string} content - 子题正文
 * @returns {object|null} { kind, opens, vertex, a, approximate, solvedFrom, namedPoints, expression, axisOfSymmetry }
 */
export function parseFunctionGraphSpec(parentStem, content) {
  const text = normalizeText([parentStem, content].filter(Boolean).join(' '))
  if (!text) return null

  const conditions = parseSignConditions(text)
  const axisOfSymmetry = parseAxisOfSymmetry(text)
  const vertexCoord = parseVertexCoord(text)
  const namedPoints = extractNamedPoints(text)
  const curvePoints = extractCurvePoints(text, namedPoints)
  const xInterceptLabels = collectXInterceptLabels(text)
  const symbolicCurveLabels = collectSymbolicCurveLabels(text)

  const ctx = { conditions, axisOfSymmetry, vertexCoord, curvePoints, xInterceptLabels, symbolicCurveLabels }

  // 收集所有 y=... 候选（一句话里可能出现多个函数，逐个尝试）
  for (const m of text.matchAll(/y\s*=\s*([^;]{1,70})/g)) {
    const rhs = cleanRhs(m[1])
    if (!rhs) continue
    const spec = tryParseQuadratic(rhs, ctx)
    if (spec) return wrap(spec, rhs, ctx, namedPoints)
  }

  // 兜底：题干没写函数表达式（"抛物线的顶点坐标为(1,4)，与y轴交于点C(0,3)"），
  // 但"抛物线 + 顶点坐标 + 曲线上一点"已经唯一确定这条抛物线，可以反推。
  // 只在明确出现"抛物线"时启用，避免把别的曲线误当抛物线。
  if (PARABOLA_RE.test(text)) {
    if (vertexCoord) {
      const spec = solveFromVertexAndPoint(vertexCoord.x, vertexCoord.y, curvePoints, { solvedFrom: 'vertex_and_point_implied' })
      if (spec) return wrap(spec, null, ctx, namedPoints)
    }
    if (axisOfSymmetry != null) {
      const spec = solveFromAxisAndPoints(axisOfSymmetry, curvePoints)
      if (spec) return wrap(spec, null, ctx, namedPoints)
    }
  }

  return null
}
