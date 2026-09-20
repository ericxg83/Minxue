/**
 * DSL 数值表达式求值（递归下降，**零 eval / 零 new Function**）。
 *
 * 来源：GeoBuildBench（ooongs/GeoBuildBench, MIT）的 DSL 允许坐标写成算式，
 * 例如 `point : 100*cos(60°) 100*sin(60°) -> A`。这样模型不必目测坐标，
 * 而是**声明构造**，精确值由执行器算出来 —— 这正是我们需要的：
 * 视觉模型给的像素坐标本来就是猜的，猜错了整张图就废了。
 *
 * 语法（严格对齐 GeoBuildBench prompts/system_prompt.txt）：
 *   数字、+ - * / ^ ( )、一元负号
 *   函数 cos sin tan asin acos atan sqrt abs min max round floor ceil
 *   常量 pi π e
 *   角度单位后缀 ° / deg（度，默认）/ rad（弧度）
 *
 * 两处扩展（2026-09-19，为 `curve` 函数图象命令服务）：
 *   1. **变量绑定**：`evalExpr(src, { x: 1.5 })`。变量只在显式传入时生效，
 *      不传就完全没有变量——保持"表达式里不认对象名"的原有纪律。
 *   2. **隐式乘法**：`2x` ≡ `2*x`、`2(x+1)` ≡ `2*(x+1)`、`(x+1)(x-1)` ≡ `(x+1)*(x-1)`、
 *      `(x+1)x` ≡ `(x+1)*x`。语义唯一、不存在歧义，故不算"猜"。
 *      `f(` 形式（cos/sin/…）**不插**乘号，函数调用照旧。
 *
 * 角度约定：**默认度**。`cos(30)` ≡ `cos(30°)`。
 *   要弧度就写 `cos(pi/2 rad)`。
 *   实现上所有角度量内部一律折算成「度」，三角函数调用时再转弧度，
 *   这样单位后缀可以出现在任何位置而不需要带标签的值类型。
 *
 * 纪律：解析失败返回 null（由调用方记 error），绝不"尽量猜"。
 * 表达式里**不允许空格**（GeoBuildBench 的约定），所以词法分析不需要处理空白。
 */

/** 词法：数字 | 标识符 | 运算符 | 括号 */
function tokenize(src) {
  const s = String(src ?? '')
  const out = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const raw = s.slice(i, j)
      if ((raw.match(/\./g) || []).length > 1 || raw === '.') return null
      out.push({ t: 'num', v: Number(raw) })
      i = j
      continue
    }
    if (/[A-Za-z_π°]/.test(ch)) {
      // 单位后缀 ° 单字符
      if (ch === '°') { out.push({ t: 'unit', v: 'deg' }); i++; continue }
      if (ch === 'π') { out.push({ t: 'id', v: 'pi' }); i++; continue }
      let j = i
      while (j < s.length && /[A-Za-z_]/.test(s[j])) j++
      out.push({ t: 'id', v: s.slice(i, j) })
      i = j
      continue
    }
    if ('+-*/^(),'.includes(ch)) { out.push({ t: ch, v: ch }); i++; continue }
    return null // 未识别字符：整条表达式判失败
  }
  return insertImplicitMul(out)
}

/**
 * 插入隐式乘号：`2x` → `2* x`、`2(x+1)` → `2*(x+1)`、`(x+1)(x-1)` → `(x+1)*(x-1)`。
 *
 * 只在下述相邻组合上插入，语义唯一：
 *   左 ∈ {数字, 标识符, )} 且 右 ∈ {数字, 标识符, (}
 * 唯一的例外是「标识符 + (」——那可能是函数调用（`cos(60)`），
 * 只有该标识符**不是**已知函数名时才补乘号（`x(x+1)`）。
 *
 * 这一步只让原本**必然报错**的输入变成合法，不会改变任何已能求值的表达式。
 */
function insertImplicitMul(toks) {
  const LEFT = new Set(['num', 'id', ')'])
  const RIGHT = new Set(['num', 'id', '('])
  const out = []
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i]
    const b = toks[i + 1]
    out.push(a)
    if (!b || !LEFT.has(a.t) || !RIGHT.has(b.t)) continue
    if (a.t === 'id' && b.t === '(' && FUNCS[a.v]) continue // 函数调用
    // 角度单位后缀不是被乘数：`30deg` 是「30 度」，插了乘号就变成 30 × deg（deg 未定义）
    if (b.t === 'id' && (b.v === 'deg' || b.v === 'rad')) continue
    out.push({ t: '*', v: '*' })
  }
  return out
}

const CONSTS = { pi: Math.PI, π: Math.PI, e: Math.E }
const FUNCS = {
  cos: (d) => Math.cos((d * Math.PI) / 180),
  sin: (d) => Math.sin((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
  asin: (x) => (Math.asin(x) * 180) / Math.PI,
  acos: (x) => (Math.acos(x) * 180) / Math.PI,
  atan: (x) => (Math.atan(x) * 180) / Math.PI,
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max
}
const ARITY = { min: 2, max: 2, round: 1, floor: 1, ceil: 1, sqrt: 1, abs: 1, cos: 1, sin: 1, tan: 1, asin: 1, acos: 1, atan: 1 }
const RAD_TO_DEG = 180 / Math.PI

/**
 * 求值一条表达式。
 * @param {string} src
 * @param {Record<string, number>} [vars] 变量绑定（如 `{ x: 1.5 }`）。
 *   不传时变量一律不认——坐标表达式仍然必须是纯数字。
 * @returns {number|null} 失败返回 null
 */
export function evalExpr(src, vars) {
  const toks = tokenize(src)
  if (!toks || toks.length === 0) return null
  let pos = 0
  const peek = () => toks[pos]
  const eat = (t) => (toks[pos] && toks[pos].t === t ? (pos++, true) : false)
  let bad = false

  /**
   * 角度单位后缀：`°` / `deg` 保持度，`rad` 折算成度。
   * **只挂在「项」(term) 的层级**，不挂在原子层级——否则
   * `pi/2 rad` 会被读成 `pi/(2 rad)`（rad 只作用于 2），
   * 正确语义是 `(pi/2) rad`。所以 unitSuffix 必须等乘除算完再吃掉。
   */
  const unitSuffix = (v) => {
    const tk = peek()
    if (!tk) return v
    if (tk.t === 'unit') { pos++; return v } // ° → 已是度
    if (tk.t === 'id' && tk.v === 'deg') { pos++; return v }
    if (tk.t === 'id' && tk.v === 'rad') { pos++; return v * RAD_TO_DEG }
    return v
  }

  function parseExpr() {
    let v = parseTerm()
    if (v == null) return null
    for (;;) {
      if (eat('+')) { const r = parseTerm(); if (r == null) return null; v += r }
      else if (eat('-')) { const r = parseTerm(); if (r == null) return null; v -= r }
      else break
    }
    return v
  }
  function parseTerm() {
    let v = parseUnary()
    if (v == null) return null
    for (;;) {
      if (eat('*')) { const r = parseUnary(); if (r == null) return null; v *= r }
      else if (eat('/')) { const r = parseUnary(); if (r == null) return null; if (r === 0) return null; v /= r }
      else break
    }
    return unitSuffix(v)
  }
  function parseUnary() {
    if (eat('-')) { const v = parseUnary(); return v == null ? null : -v }
    if (eat('+')) return parseUnary()
    return parsePower()
  }
  function parsePower() {
    const base = parseAtom()
    if (base == null) return null
    if (eat('^')) { const ex = parseUnary(); if (ex == null) return null; return Math.pow(base, ex) }
    return base
  }
  function parseAtom() {
    const tk = peek()
    if (!tk) return null
    if (tk.t === 'num') { pos++; return tk.v }
    if (tk.t === '(') {
      pos++
      const v = parseExpr()
      if (v == null || !eat(')')) return null
      return v
    }
    if (tk.t === 'id') {
      const name = tk.v
      if (FUNCS[name]) {
        pos++
        if (!eat('(')) return null
        const args = []
        if (!eat(')')) {
          for (;;) {
            const a = parseExpr()
            if (a == null) return null
            args.push(a)
            if (eat(',')) continue
            if (eat(')')) break
            return null
          }
        }
        const ar = ARITY[name]
        if (ar === 1 && args.length !== 1) return null
        if (ar === 2 && args.length < 2) return null
        const out = FUNCS[name](...args)
        return Number.isFinite(out) ? out : null
      }
      if (name in CONSTS) { pos++; return CONSTS[name] }
      // 显式绑定的变量（curve 的 x）——只在调用方传了 vars 时才认
      if (vars && Object.prototype.hasOwnProperty.call(vars, name)) {
        const v = vars[name]
        if (typeof v !== 'number' || !Number.isFinite(v)) return null
        pos++
        return v
      }
      // 表达式里**不认**对象名：坐标必须是纯数字（见模块头注释的纪律）
      return null
    }
    return null
  }

  const v = parseExpr()
  if (v == null || pos !== toks.length || bad) return null
  return Number.isFinite(v) ? v : null
}

/** 表达式是否可求值（供 DSL 预校验用，不抛异常） */
export const isExpr = (s) => evalExpr(s) != null

/** 表达式里是否含**独立**变量 x（`max`/`exp` 里的 x 不算） */
const hasVarX = (s) => /(?<![A-Za-z_])x(?![A-Za-z_])/.test(s)

/**
 * 把 token 解析成「函数表达式」对象（curve 命令的 `f` 类型参数）。
 *
 * 判据两条，缺一不可：① 含独立变量 x；② 代入一个试探值能求出有限数。
 * 不满足就返回 null，由 executor 报 BAD_FUNCTION_EXPR —— 绝不"降级当常数用"，
 * 否则模型把 `k*x` 写成常量时会被悄悄画成一条水平线，比报错难查得多。
 *
 * @param {string} src
 * @returns {{kind:'f', expr:string}|null}
 */
export function parseFunctionExpr(src) {
  const t = String(src ?? '')
  if (!hasVarX(t)) return null
  // 两个试探点：只求一次可能在正负号/根号处蒙过去
  const a = evalExpr(t, { x: 1.234 })
  if (a == null) return null
  const b = evalExpr(t, { x: -0.777 })
  if (b == null) return null
  return { kind: 'f', expr: t }
}

/** 函数表达式在给定 x 处的值（null 表示该点无定义） */
export function evalFunctionAt(fn, x) {
  const expr = typeof fn === 'string' ? fn : fn?.expr
  if (!expr) return null
  const v = evalExpr(expr, { x })
  return v == null || !Number.isFinite(v) ? null : v
}
