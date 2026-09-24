/**
 * 数学答案的「同解异写」归一化与比对（2026-09-24）
 *
 * ── 解决什么 ──
 * 同一个答案会有多种等价写法，粗比对会把它们判成「不一致」而白白丢弃：
 *   `2 \times (\frac{5}{3})^n`  vs  `2·(5/3)ⁿ`      ← LaTeX vs Unicode
 *   `S=2a+b-1`                 vs  `2a+b-1`          ← 多带变量前缀
 *   `√6/2`                     vs  `\frac{\sqrt{6}}{2}`
 * 实测（`_存量重跑候选清单-20260924.md`）：两轮独立运行的 9 条「不一致」里，
 * **7 条只是表述差异，只有 2 条是实质矛盾** —— 不做归一就会把 7 条好答案当幻觉丢掉。
 *
 * ── 用途 ──
 * 1. 「同题两次独立运行」的防幻觉比对（`scripts/solve-with-figure.mjs`）；
 * 2. 任何需要判断「两个答案是不是同一个」的离线分析。
 *
 * ⛔ 只用于**比对**，不用于落库：落库永远写模型原始答案（`stripAnswerScaffolding` 后的形态），
 *    归一化结果不能当答案写进 `questions.answer`。
 */

/** LaTeX / Unicode / 印刷体 → 统一的 ASCII 骨架 */
export function normalizeMathExpr(s) {
  return String(s || '')
    .replace(/\\times|\\cdot|\\ast/g, '*')
    .replace(/\\div/g, '/')
    .replace(/\\pm/g, '±')
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    // ⚠️ 上标字母必须先于上标数字处理：模型常输出 `(5/3)ⁿ`（U+207F 上标 n），
    //    它不在 ⁰¹²³⁴⁵⁶⁷⁸⁹ 集合里，漏了就把同解异写判成不一致（2026-09-24 实测踩过）。
    .replace(/ⁿ/g, '^n')
    .replace(/⁺/g, '^+').replace(/⁻/g, '^-')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => '^' + [...m].map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)).join(''))
    .replace(/[×✕·⋅∙]/g, '*')
    .replace(/[−–—﹣]/g, '-')
    .replace(/[（【]/g, '(').replace(/[）】]/g, ')')
    .replace(/√/g, 'sqrt')
    .replace(/\s+/g, '')
    .replace(/[，,。．.;；]$/g, '')
    .toLowerCase()
}

/** 再去掉全部括号（只用于比对，能覆盖 `(5)/(3)` vs `5/3` 这类多余括号差异） */
export function looseMathExpr(s) {
  return normalizeMathExpr(s).replace(/[()]/g, '')
}

/**
 * 两个答案是否「实质同解」。
 * 两级判据：① 严格归一相同；② 去括号后相同。
 */
export function isSameMathAnswer(a, b) {
  const na = normalizeMathExpr(a)
  const nb = normalizeMathExpr(b)
  if (na && na === nb) return true
  const la = looseMathExpr(a)
  const lb = looseMathExpr(b)
  return Boolean(la) && la === lb
}

/**
 * 在 `isSameMathAnswer` 之上补一层「叙述型答案的包含关系」判据。
 *
 * ── 为什么需要（2026-09-24 实测） ──
 * 证明/说理题的两次独立运行详略常常不同：一次给完整推导、一次只给结论。
 * 实测第 5 题：run1 = `证明：∵四边形ABCD为菱形…∴△ABC∽△AEB。`，run2 = `△ABC∽△AEB`；
 * 第 9 题：run1 = `证明：∵矩形ABCD中AD∥BC…∴PM=QM。`，run2 = `PM=QM`。
 * 结论完全一致，但归一化不会相等 —— 按「两次不一致」丢弃是**误杀好答案**
 * （23 题试跑里 2 条属此类）。
 *
 * ── 判据 ──
 * ① 先走 isSameMathAnswer（严格归一 / 去括号等价）；
 * ② 否则看一侧是否为另一侧的**规范化子串**，要求：短侧 ≥4 字符、**两侧都含字母或汉字**。
 *
 * ⛔ 为什么必须排除纯数值：`15` 是 `315` 的子串，纯数值的包含关系毫无意义。
 *    纯数值的等价性只能由 isSameMathAnswer 判定，绝不交给包含判据（否则会放水）。
 */
/**
 * 判断题（`judge` 题）答案的**极性归一**。
 * 「正确 / 对 / 是 / √ / 成立」→ `Y`；「错误 / 错 / 不正确 / 不对 / × / 不成立」→ `N`。
 *
 * ── 为什么需要（2026-09-24 实测） ──
 * 判断题的两次独立运行常给出**同义不同词**的答案：run1「不正确」、run2「错误」
 * （实测 `21ed36f3` q#22），字面不同但实质同解 —— 不归一会把好答案当幻觉丢掉。
 *
 * ⛔ 只归一「整串恰好就是极性词」的情况。答案里混了别的字（如「不正确，因为…」）返回 null，
 *    避免把说理题的半句话当成判断题答案。
 * ⛔ 绝不把字母 `x` 当 `N` —— 它常是数学答案里的变量（化简结果就是 `x` 的题真实存在）。
 */
export function judgePolarity(s) {
  const n = String(s || '').trim().toLowerCase().replace(/[\s。．.,，;；!！]/g, '')
  if (/^(正确|对|是|√|成立|true|yes|y)$/.test(n)) return 'Y'
  if (/^(错误|错|不正确|不对|否|不成立|×|false|no|n)$/.test(n)) return 'N'
  return null
}

/**
 * 「恰好一侧带单位、另一侧不带」时判同（2026-09-24 实测 4 条被误杀）。
 * 实测样本：`1.608×10^5吨` vs `1.608×10^5`、
 * `1.14405×10^6 t，2.559×10^6 t` vs `1.14405×10^6，2.559×10^6`
 * —— 差异只在单位词与分隔标点，**数值骨架逐字相同**。
 *
 * ── 为什么不能无脑剥单位 ──
 * `5cm` 与 `5m` 剥完都是 `5`，会放水成「同解」。故本判据要求
 * **恰好一侧含单位、另一侧完全不含**；两侧都带单位（`5cm` vs `5m`）或都不带时一律返回 false，
 * 交回 isSameMathAnswer 判定。
 *
 * ⛔ 单位表刻意**不含** `t`（吨的符号）：`t` 太常作为变量/参数出现，列入会污染判据。
 *    代价是「…×10^6 t」与「…×10^6」这类样本仍需人工确认（本轮实测第 23/24 条）。
 */
const UNIT_RE = /(平方厘米|立方厘米|千克|公斤|厘米|毫米|吨|克|米|元|个|只|本|人|天|度|°|km|cm|mm|dm|kg|m)/i

export function isSameUnitVariant(a, b) {
  const clean = (s) => normalizeMathExpr(s).replace(/[，,、；;]/g, '')
  const na = clean(a)
  const nb = clean(b)
  if (!na || !nb || na === nb) return false
  const ha = UNIT_RE.test(na)
  const hb = UNIT_RE.test(nb)
  if (ha === hb) return false // 两侧都有单位（或都没有）→ 不走这条，避免 5cm/5m 放水
  const strip = (s) => s.replace(new RegExp(UNIT_RE.source, 'gi'), '')
  return strip(na) === strip(nb)
}

/**
 * 「恰好一侧带变量赋值前缀」时判同（2026-09-24 实测 `1aabc26b`：`-1` vs `k=-1`）。
 * 同一题两次运行常一次写 `k=-1`、一次只写 `-1`；`y=x²-4x+3` vs `x²-4x+3` 同理。
 *
 * ── 为什么要求「恰好一侧」 ──
 * 两侧都带前缀时（`a=1` vs `b=1`），前缀本身承载语义（求的是哪个量），
 * 一律返回 false 交回 isSameMathAnswer，避免把「求 a」和「求 b」的答案判成同一个。
 *
 * ⛔ 只剥离**单个字母 + 等号**的前缀（`k=`、`y=`、`S=`）。`f(x)=` 这类函数式前缀不剥。
 */
const ASSIGN_PREFIX = /^[a-z]=/

export function isSameAssignVariant(a, b) {
  const na = normalizeMathExpr(a)
  const nb = normalizeMathExpr(b)
  if (!na || !nb || na === nb) return false
  const ha = ASSIGN_PREFIX.test(na)
  const hb = ASSIGN_PREFIX.test(nb)
  if (ha === hb) return false // 两侧都带前缀（或都不带）→ 不判同
  const strip = (s) => s.replace(ASSIGN_PREFIX, '')
  return strip(na) === strip(nb)
}

export function isSameAnswerSemantic(a, b) {
  if (isSameMathAnswer(a, b)) return true
  if (isSameUnitVariant(a, b)) return true
  if (isSameAssignVariant(a, b)) return true
  // 判断题极性同义（「不正确」≡「错误」）—— 2026-09-24 实测 21ed36f3 被误杀
  const pa = judgePolarity(a)
  const pb = judgePolarity(b)
  if (pa && pb && pa === pb) return true
  const na = normalizeMathExpr(a)
  const nb = normalizeMathExpr(b)
  if (!na || !nb) return false
  // 两侧都必须含字母或汉字 —— 挡掉纯数值/纯符号串的包含误判
  const hasWord = (s) => /[a-z\u4e00-\u9fa5]/.test(s)
  if (!hasWord(na) || !hasWord(nb)) return false
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (short.length < 4) return false
  return long.includes(short)
}
