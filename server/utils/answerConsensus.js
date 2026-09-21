/**
 * 多路求解共识（self-consistency voting）—— 让「AI 给的答案」在被写进库之前先自证一致。
 *
 * 背景（2026-09-21 实测事故）
 *   题目：已知 x−2 的平方根是 ±2，2x+y+7 的立方根是 3，则 x²+y² 的平方根是____（正解 ±10）
 *   库内 answer = `±2√5`。追根因发现：答案引擎主供应商 SenseNova 的 pro/glm-5.2/
 *   sensenova-6.8 三个模型全部 `429 rpm exhausted`，代码在 3 模型 × 8s 重试后**直接降级**
 *   到兜底弱模型 `Huihuiyun:deepseek-v4-flash`，而该弱模型在**同一道题**上连续 4 次给出
 *   `±5 / ±10 / ±10 / ±10` —— 1 次错 3 次对，单次采样就等于掷骰子。
 *
 * 本模块只做一件事：把 N 路独立求解的答案归一化后投票，把「同题不同答」的不稳定性
 * 变成一个**可检测的分歧信号**，而不是让某一次随机采样直接变成标准答案。
 *
 * 判等口径（从严到宽，任一命中即视为同一答案）：
 *   ① 归一化字符串相等（全角/空格/±/最简根式/脚手架统一后逐字比）
 *   ② 数值等价（把 √、分数、小数、k√n、连乘式解析成浮点，容差 1e-9 相对）
 * 多空答案按**顺序**比对（教材约定「按空的顺序用逗号分隔」），顺序不同视为分歧 ——
 * 宁可多标一次分歧，也不要把「依次填 1,2」和「依次填 2,1」当成同一个答案。
 *
 * 纯函数、零副作用、不依赖数据库。
 */

// ── 归一化 ────────────────────────────────────────────────────────────────

// OCR / 各模型对同一数学符号的不同写法，统一到一套 ASCII 形态
const SYMBOL_FOLD = [
  [/[（]/g, '('], [/[）]/g, ')'], [/[【]/g, '('], [/[】]/g, ')'],
  [/[［\[]/g, '('], [/[］\]]/g, ')'],
  [/[＋﹢]/g, '+'], [/[－–—﹣−]/g, '-'], [/[×✕·⋅]/g, '*'], [/[÷／]/g, '/'],
  [/[＝]/g, '='], [/[＾]/g, '^'], [/[＊]/g, '*'], [/[．]/g, '.'], [/[％]/g, '%'],
  [/\\times|\\cdot/gi, '*'], [/\\div/gi, '/'],
  [/\\sqrt\s*\{([^{}]*)\}/gi, '√($1)'], [/\\sqrt\s*/gi, '√'],
  [/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/gi, '($1)/($2)'],
  [/∓/g, '±'], [/士/g, '±'],   // 「士」是 ± 的高频 OCR 误识
  [/[或和]/g, ','], [/[，；;、]/g, ','], [/[~〜]/g, ''],
  [/\s+/g, ''],
]

// 上标数字 → ^(n)：10² → 10^(2)、10⁻⁴ → 10^(-4)
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
function foldSuperscripts(s) {
  return s.replace(/[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => {
    let exp = ''
    for (const c of m) exp += c === '⁻' ? '-' : c === '⁺' ? '+' : String(SUP_DIGITS.indexOf(c))
    return `^(${exp})`
  })
}

/** 去掉模型爱写的语气脚手架（「答案为」「是」「记作」…）与包裹引号、尾部标点 */
function stripScaffolding(s) {
  return String(s ?? '')
    .replace(/^[“"「『']\s*/, '').replace(/\s*[”"」』']$/, '')
    .replace(/^(?:最终答案|答案|正确答案|所以|因此|故|应为|应该是|应该|是|为|记作|写作)\s*[是为：:]?\s*/, '')
    .replace(/\s*(?:为准|即可|为止)\s*$/, '')
    .trim()
}

/**
 * 答案归一化键：用于**字符串级**比对。
 * 不做数学化简（那是 rationalizeAnswer 的活），只做「同一写法的不同外观」折叠。
 */
export function normalizeAnswerKey(answer) {
  let s = stripScaffolding(answer)
  if (!s) return ''
  s = foldSuperscripts(s)
  for (const [re, to] of SYMBOL_FOLD) s = s.replace(re, to)
  // 尾部标点（保留无限小数省略号：0.31818... 的 ... 有信息）
  s = s.replace(/[。、,;:]+$/, '')
  if (/[^.]\.$/.test(s)) s = s.replace(/\.$/, '')
  // 去掉每个分空上的「变量名=」前缀：`b=6,c=10` 与 `6,10` 是同一个答案。
  // 2026-09-21 存量对账实测：同一个正确答案，答案引擎写 `b=6，c=10`、强模型写 `6,10`，
  // 不折叠就会被当成"分歧"白报一次。
  s = s.split(',').map(part => part.replace(/^[a-zA-Z]\s*=\s*/, '')).join(',')
  // ± 位置统一：把 `-10,10` / `10,-10` 这类等价写法折叠成 `±10` 的规范形态
  const pm = s.match(/^([+-]?[\d.]+),(-?[\d.]+)$/)
  if (pm && Math.abs(parseFloat(pm[1])) === Math.abs(parseFloat(pm[2]))) s = `±${Math.abs(parseFloat(pm[1]))}`
  return s
}

// ── 数值求值（支持 √ ∛ 分数 小数 幂 隐式乘法）──────────────────────────────

function tokenizeMath(s) {
  const tokens = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\d/.test(c) || (c === '.' && /\d/.test(s[i + 1] || ''))) {
      const m = /^\d*\.?\d+/.exec(s.slice(i))
      tokens.push({ t: 'num', v: parseFloat(m[0]) })
      i += m[0].length
      continue
    }
    if (c === '√') { tokens.push({ t: 'sqrt', n: 2 }); i += 1; continue }
    if (c === '∛') { tokens.push({ t: 'sqrt', n: 3 }); i += 1; continue }
    if ('+-*/^()'.includes(c)) { tokens.push({ t: c }); i += 1; continue }
    throw new Error(`unsupported token: ${c}`)
  }
  // 隐式乘法：2√5、3(1/2)、(1/2)(2/3)
  const out = []
  for (const cur of tokens) {
    const prev = out[out.length - 1]
    const prevEnds = prev && (prev.t === 'num' || prev.t === ')')
    const curStarts = cur.t === 'num' || cur.t === '(' || cur.t === 'sqrt'
    if (prevEnds && curStarts) out.push({ t: '*' })
    out.push(cur)
  }
  return out
}

function evaluateTokens(tokens) {
  let i = 0
  const peek = () => tokens[i]?.t
  const parseAtom = () => {
    const tk = tokens[i]
    if (!tk) throw new Error('unexpected end')
    if (tk.t === 'num') { i += 1; return tk.v }
    if (tk.t === '(') {
      i += 1
      const v = parseSum()
      if (peek() !== ')') throw new Error('missing )')
      i += 1
      return v
    }
    if (tk.t === 'sqrt') { i += 1; return Math.pow(parseAtom(), 1 / tk.n) }
    throw new Error(`unexpected ${tk.t}`)
  }
  const parsePower = () => {
    const base = parseAtom()
    if (peek() === '^') { i += 1; return Math.pow(base, parseUnary()) }
    return base
  }
  const parseUnary = () => {
    if (peek() === '+') { i += 1; return parseUnary() }
    if (peek() === '-') { i += 1; return -parseUnary() }
    return parsePower()
  }
  const parseProduct = () => {
    let v = parseUnary()
    while (peek() === '*' || peek() === '/') {
      const op = peek(); i += 1
      const r = parseUnary()
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const parseSum = () => {
    let v = parseProduct()
    while (peek() === '+' || peek() === '-') {
      const op = peek(); i += 1
      const r = parseProduct()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const value = parseSum()
  if (i !== tokens.length) throw new Error('trailing tokens')
  return value
}

/** 单个数值表达式求值；解析不了返回 null（不抛） */
function evalNumber(expr) {
  const s = foldSuperscripts(String(expr).trim())
  if (!s || !/^[\d.+\-*/^()√∛]+$/.test(s)) return null
  try {
    const v = evaluateTokens(tokenizeMath(s))
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/**
 * 把答案解析成数值序列（多空答案 → 多个元素）。解析不了返回 null。
 * `±2√5` → [4.4721…, -4.4721…]（± 展开成两支，任一命中即等价）
 */
export function parseNumericValues(answer) {
  let s = normalizeAnswerKey(answer)
  if (!s) return null
  if (s.includes('±')) {
    const plus = s.replace(/±/g, '+')
    const minus = s.replace(/±/g, '-')
    const a = evalNumber(plus), b = evalNumber(minus)
    if (a === null || b === null) return null
    return [a, b]
  }
  const parts = s.split(',')
  const out = []
  for (const p of parts) {
    const v = evalNumber(p)
    if (v === null) return null
    out.push(v)
  }
  return out.length ? out : null
}

function nearlyEqual(a, b) {
  if (a === b) return true
  const scale = Math.max(1, Math.abs(a), Math.abs(b))
  return Math.abs(a - b) <= 1e-9 * scale
}

/**
 * 两个答案是否同一个答案。
 * ① 归一化字符串相等 → 是
 * ② 都能数值化 → 逐项比较：含 ± 的一侧按**无序集合**比（± 只是两支的写法），
 *    否则按**顺序**逐项比（多空答案「按空的顺序」是有语义的）
 * 其余 → 否。特别注意 `±10` 与 `10` **不等价** —— 「漏写 ±」正是平方根类题目的
 * 高频分歧点，必须算成不同答案才会被投票标出来。
 */
export function answersEquivalent(a, b) {
  const ka = normalizeAnswerKey(a)
  const kb = normalizeAnswerKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const na = parseNumericValues(a)
  const nb = parseNumericValues(b)
  if (!na || !nb || na.length !== nb.length) return false
  if (ka.includes('±') || kb.includes('±')) {
    const sa = [...na].sort((x, y) => x - y)
    const sb = [...nb].sort((x, y) => x - y)
    return sa.every((v, i) => nearlyEqual(v, sb[i]))
  }
  return na.every((v, i) => nearlyEqual(v, nb[i]))
}

/**
 * 投票。返回：
 *   verdict   unanimous（全一致）| majority（过半数）| split（无过半，含全不同）
 *   winner    多数派答案（原样保留，不归一化，便于直接入库）
 *   agreement 多数派占比
 *   groups    [{ answer, count, samples }] 按票数降序
 */
export function voteAnswers(answers) {
  const list = (answers || []).map(a => String(a ?? '').trim()).filter(Boolean)
  if (list.length === 0) return { verdict: 'empty', winner: null, agreement: 0, groups: [], total: 0 }

  const groups = []
  for (const a of list) {
    const hit = groups.find(g => answersEquivalent(g.answer, a))
    if (hit) { hit.count += 1; hit.samples.push(a) } else groups.push({ answer: a, count: 1, samples: [a] })
  }
  groups.sort((x, y) => y.count - x.count)
  const total = list.length
  const top = groups[0]
  const verdict = groups.length === 1 ? 'unanimous' : top.count > total / 2 ? 'majority' : 'split'
  return { verdict, winner: top.answer, agreement: top.count / total, groups, total }
}

/**
 * 把投票结果转成给老师看的一句话（写进 questions.ai_answer_risk_reason）。
 * 一致 / 单样本 返回 null —— 没有问题就不要制造噪音。
 */
export function describeConsensus(consensus, { engine = null } = {}) {
  if (!consensus || consensus.total < 2) return null
  if (consensus.verdict === 'unanimous') return null
  const list = consensus.groups
    .map(g => `${g.answer}（${g.count}/${consensus.total}）`)
    .join(' / ')
  const tag = consensus.verdict === 'majority' ? '多路求解多数一致' : '多路求解结果分歧'
  const engineNote = engine ? `，求解通道 ${engine}` : ''
  const consistencyNote = Number.isFinite(consensus.selfConsistentCount) && Number.isFinite(consensus.sampleCount)
    ? `，其中与解析自洽 ${consensus.selfConsistentCount}/${consensus.sampleCount}`
    : ''
  return `参考答案存疑：${tag}（候选：${list}${engineNote}${consistencyNote}），请人工核对`
}
