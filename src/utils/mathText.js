/**
 * 数学文本规范化的共享纯函数。
 * 供 pdfGenerator.js（PDF 渲染，经 auto-render）与 MathRender.vue（界面预览，经 renderToString）
 * 共同使用，保证两条渲染路径输出一致的标准 LaTeX。
 *
 * 规则：
 * - Unicode 上标整体合并：²⁰²¹ → ^{2021}（严禁拆成 ^{2}^{0}^{2}^{1}）
 * - √x、√(x)、√2 1/2、√17(a²+b²) → \sqrt{...}
 * - 斜杠 a/b、3/5 → \frac{a}{b}（禁止裸斜杠）
 * - × ÷ ≥ ≤ ≠ ± → \times \div \ge \le \ne \pm
 * - x² → x^{2}，x^2 → x^{2}，x_1 → x_{1}
 * - renderContent 将数学片段用严格 $...$（行内）/ $$...$$（独立）包裹
 */

const SYMBOL_MAP = {
  '∠': '\\angle ',
  '△': '\\triangle ',
  '°': '^{\\circ}',
  '≈': '\\approx ',
  '∞': '\\infty ',
  'π': '\\pi ',
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'δ': '\\delta ',
  'θ': '\\theta ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'σ': '\\sigma ',
  '∈': '\\in ',
  '∉': '\\notin ',
  '⊂': '\\subset ',
  '⊃': '\\supset ',
  '∪': '\\cup ',
  '∩': '\\cap ',
  '→': '\\rightarrow ',
  '←': '\\leftarrow ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '×': '\\times ',
  '÷': '\\div ',
  '±': '\\pm ',
  '·': '\\cdot ',
  '≥': '\\ge ',
  '≤': '\\le ',
  '≠': '\\ne ',
  '−': '-',      // U+2212 数学减号（OCR 高频）：不映射会落在文本段，用正文字体渲染、与相邻数学体割裂
  '⊥': '\\bot ',  // 垂直符号：KaTeX 对裸 Unicode 报 unknownSymbol，字形依赖兜底字体（乱码隐患）
  '∥': '\\parallel ', // 平行符号：同上
}

const SUP_BASE = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
  '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
  '⁺': '+', '⁻': '-',
  'ᵐ': 'm', 'ⁿ': 'n',
  '⁽': '(', '⁾': ')',
}

// Unicode 下标字符 → 数字/字母基底（U+2080-209C）。
// 上标（²⁰²¹…）有 steps 0.5 预处理成 ^{...}，下标（₀₁₂…）此前却没有任何对应处理，
// 导致 isMathChar 不认它 → 数学段被下标字符撕成两半（2026-09-18 白板第27题：
// `{\sqrt{y}₀}` 露出红色源码，正是 `{√y₀}` 被 `₀` 切开、KaTeX 拿到半个花括号报错）。
const SUB_BASE = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
  '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  '₊': '+', '₋': '-',
  'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x',
  'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n',
  'ₚ': 'p', 'ₛ': 's', 'ₜ': 't',
}

function preprocessMath(text) {
  let s = String(text || '')

  // 0. 规范化已有 LaTeX 命令
  s = s.replace(/\\left/g, '').replace(/\\right/g, '')
  s = s.replace(/\\(?:dfrac|tfrac|cfrac)/g, '\\frac')
  s = s.replace(/\$\$?/g, '')
  s = s.replace(/\\\(/g, '').replace(/\\\)/g, '')
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}')

  // 0.5 Unicode 上标 → 单个整体指数（²⁰²¹ → ^{2021}，严禁拆成 ^{2}^{0}^{2}^{1}）
  //     含上标字母 ᵐⁿ 与上标括号 ⁽⁾（如 aᵐ⁽ⁿ⁾ → a^{m(n)}）
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ᵐⁿ⁽⁾]+/g, (run) => {
    let inner = ''
    for (const ch of run) inner += SUP_BASE[ch] || ch
    return '^{' + inner + '}'
  })

  // 0.55 Unicode 下标 → 单个整体下标（y₀ → y_{0}，yₙ₊₁ → y_{n+1}；严禁拆成 _{n}_{+1}）
  //     与上标同构，缺失是 2026-09-18 白板第27题乱码的根因（见 SUB_BASE 注释）
  s = s.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋ₐₑₒₓₕₖₗₘₙₚₛₜ]+/g, (run) => {
    let inner = ''
    for (const ch of run) inner += SUB_BASE[ch] || ch
    return '_{' + inner + '}'
  })

  // 0.6 填空线：连续下划线 ____ → \underline{\quad}（禁止裸 _，否则 KaTeX 当作下标报错）
  // 单个 _ 保留（可能用于下标，如 x_1；x_1 会在步骤 5 转 x_{1}）
  s = s.replace(/_{2,}/g, '\\underline{\\quad}')

  // 0.7 循环小数标记：组合上点 U+0307 / 组合上划线 U+0305 → \dot{} / \bar{}
  //
  // 为什么必须在这里转（2026-09-14 错题再测-0911 事故）：
  //   这两个是**组合附加符号**，语义上"贴在前一个数字上"。而数学段在两条渲染路径
  //   （pdfGenerator 的 auto-render、MathRender 的 renderToString）里都交给 KaTeX
  //   独占排版，KaTeX 的字形有自己的盒模型/定位 —— 落在文本段的孤立组合字符
  //   附着不到前一个字形上，于是打印出来「2.6̇」变成「2.6」，题目从无限循环小数
  //   变成有限小数，学生照着印出来的题作答必然被判定为错（事故里 5 个学生答 18、
  //   3 个学生按 3.12 作答，都是这个成因；全库 37 道题的题干含 72 个点）。
  //   转成 \dot{6} 后由 KaTeX 自己排版，预览与 PDF 都不会再丢。
  //
  // 保真转换、**不推断循环节范围**：OCR 有时只在循环节首尾加点（0.5̇03̇ = 503 循环），
  // 有时每个数字都带点（0.5̇0̇3̇）—— 两种是同一记法的不同来源。猜循环节会把
  // 0.3̇1̇8̇ 错排成 0.3̇8̇（318 循环 → 38 循环），语义就错了。
  s = s.replace(/([0-9A-Za-z])([\u0305\u0307])/g, (_m, base, mark) =>
    mark === '\u0307' ? `\\dot{${base}}` : `\\bar{${base}}`
  )

  // 1. √ → \sqrt{...}
  s = convertSqrt(s)

  // 2. 混合数：1 1/3 → 1\frac{1}{3}
  s = s.replace(/(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/g, (m, whole, num, den) =>
    parseInt(num, 10) < parseInt(den, 10) ? `${whole}\\frac{${num}}{${den}}` : m
  )

  // 3. 斜杠除法 a/b → \frac{a}{b}（多轮处理嵌套）
  //
  // 这里不能只用「括号 / 单个字母数字」作为分数两端：
  // `c^(2n+2)/a^(2n+1)` 中的正则如果从指数里的 `(2n+2)` 开始匹配，
  // 会误写成 `c^\frac{(2n+2)}{a}^(2n+1)`，白板上就会露出残缺的 LaTeX 源码。
  // 先把括号指数规范成 LaTeX 大括号，再让分数操作数一次性吃掉「底数+指数」；
  // 同时禁止从指数大括号内部起匹配，避免再次截断指数。
  // 单字符/数字指数，保证 `a^2/b^3` 也按完整操作数参与分数转换。
  //
  // ⚠ 这里必须**非贪婪**（`+?`）：贪婪会把 `6a^2b^6` 吞成 `6a^{2b}^6` —— `b` 被误当
  // 上标内容，产物非法 ⇒ KaTeX 红色源码（2026-10-10 几何/代数题乱码事故）。
  // 只吃「紧跟 ^ 的一个字符或一个 (…) 括号组」，后面的字母仍属基底。
  // 两条配合使用：`^数字+` 必须整段是数字（x^12 → x^{12}），
  // `^字母` 只吃**一个**字母（a^2b → a^{2}b，非贪婪单条正则做不到，用两条分工）。
  s = s.replace(/([a-zA-Z0-9])\^([0-9]+)(?![0-9A-Za-z])/g, '$1^{$2}')
  s = s.replace(/([a-zA-Z0-9])\^([a-zA-Z])(?![a-zA-Z0-9])/g, '$1^{$2}')
  s = s.replace(/([a-zA-Z0-9])\^\(([^()]*)\)/g, '$1^{$2}')
  const fractionOperand = String.raw`(?:\\sqrt\{[^{}]*\}|[a-zA-Z0-9]+(?:\.[0-9]+)?(?:\^\{[^{}]*\})?|\([^()]*\))`
  const fractionPattern = new RegExp(
    String.raw`(?<![\^{])(${fractionOperand})\s*\/\s*(${fractionOperand})(?!\^)`,
    'g'
  )
  let prev
  let guard = 0
  do {
    prev = s
    s = s.replace(fractionPattern, '\\frac{$1}{$2}')
    guard++
    if (guard > 20) break
  } while (s !== prev)

  // 4. 清理分数多余括号：\frac{(a)}{(b)} → \frac{a}{b}；(a/b) → a/b
  s = s.replace(/\\frac\{\(([^{}]*)\)\}\{\(([^{}]*)\)\}/g, '\\frac{$1}{$2}')
  s = s.replace(/\(\\frac\{([^{}]*)\}\{([^{}]*)\}\)/g, '\\frac{$1}{$2}')

  // 5. 指数/下标补花括号：x^2 → x^{2}、x_1 → x_{1}
  //    走确定性扫描（贪婪正则会把 `6a^2b^6` 吞成 `6a^{2b}^6`、`A_1B_1C_1` 吞成
  //    `A_{1B}_1C_{1}`，产物非法 ⇒ KaTeX 红色源码）。
  //
  //    ⚠ 顺序必须是「先下标、后上标」：下标步把 `p_1^k_1` 变成 `p_{1}^k_{1}`，
  //    上标步随后识别出 `_{1}` 紧贴在 `^{k}` 之后 —— 同一基底的上下标必须**上标在前**
  //    （`p_{1}^{k}_{1}` 在数学上非法，KaTeX 报错），此时把下标并入上标得 `p_{1}^{k+1}`。
  //    反过来先上标则 `^k_1` 的下标无处安放。
  s = normalizeSubscripts(s)
  s = normalizeScripts(s, '^')
  s = mergeTrailingSubscriptIntoSuperscript(s)

  // 6. Unicode 数学符号 → LaTeX 命令
  for (const [ch, latex] of Object.entries(SYMBOL_MAP)) {
    if (s.includes(ch)) s = s.split(ch).join(latex)
  }

  return s
}

/**
 * 下标补花括号（确定性逐字符扫描，不用正则）。
 *
 * 2026-10-10 几何题乱码事故：几何角标 `A_1B_1C_1` 是**三个独立下标**，
 * 但旧实现 `s.replace(/([a-zA-Z])_([a-zA-Z0-9]+)/g, '$1_{$2}')` 的 `+` 是贪婪的，
 * 会把紧跟其后的字母一起吞进花括号 ⇒ `A_{1B}_1C_{1}`。产物不再是合法 LaTeX，
 * KaTeX 对 `\frac{AB}{A_{1B}_1}` 这类片段输出 `katex-error`（**红色源码**），
 * 老师在批改页看到的就是满屏 `A_{1B}_{1C_{1}}\therefore` 这样的乱码。
 *
 * 正则表达不了「下标只吃紧跟其后的那一个 token」，故改为扫描：
 *   - `_` 后紧跟 `{`        → 已有花括号下标，原样保留（`A_{1B}` 不动）；
 *   - `_` 后紧跟数字        → 连续数字整体作下标（`x_12` → `x_{12}`）；
 *   - `_` 后紧跟单个字母    → 该字母单独作下标（`A_1B` → `A_{1}B`，几何角标主流写法）；
 *   - `_` 后是其它（含空白）→ 不是下标，删掉这条孤立下划线（`_` 在数学模式是非法下标，
 *     留着必让整段变红）。填充线 `____` 在步骤 0.6 已先转成 \underline{\quad}。
 */
/**
 * 把紧贴在上标之后的孤立下标并入上标：`p^{k}_{1}` → `p^{k+1}`。
 *
 * 背景：同一基底的上下标在数学上必须**上标在前**（`p_{1}^{k}` 合法，
 * `p_{1}^{k}_{1}` 非法）。原始 OCR 文本里两种写法都有（`p_1^k_1`），
 * 规范化后若留下 `^{k}_{1}` 这种「上标后跟下标」，KaTeX 判非法并输出红色源码。
 * 这里把该下标的内容追加进上标（分隔符 +），保住语义且必然合法。
 *
 * 只处理「`^{…}` 紧跟 `_{…}`」这一种紧邻形态；中间夹了别的记号则不动
 * （那是两个不同基底的上下标，各自带花括号，本就合法）。
 */
function mergeTrailingSubscriptIntoSuperscript(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    // 匹配完整的 ^{...}
    if (s[i] === '^' && s[i + 1] === '{') {
      let depth = 0
      let j = i
      while (j < s.length) {
        if (s[j] === '{') depth++
        if (s[j] === '}') {
          depth--
          if (depth === 0) { j++; break }
        }
        j++
      }
      const sup = s.slice(i, j)
      // 紧跟 _{...} ⇒ 并入上标
      if (s[j] === '_' && s[j + 1] === '{') {
        let d2 = 0
        let k = j
        while (k < s.length) {
          if (s[k] === '{') d2++
          if (s[k] === '}') {
            d2--
            if (d2 === 0) { k++; break }
          }
          k++
        }
        const sub = s.slice(j + 2, k - 1) // 去掉 `_{` 与结尾 `}`，只留内容
        out += sup.slice(0, -1) + '+' + sub + '}'
        i = k
        continue
      }
      out += sup
      i = j
      continue
    }
    out += s[i]
    i++
  }
  return out
}

function normalizeSubscripts(s) {
  return normalizeScripts(s, '_')
}

/**
 * 上标/下标统一规范化（确定性逐字符扫描，不用正则）。marker 传 '^' 或 '_'。
 *
 * 与 normalizeSubscripts 同构，存在的理由是**同一个 bug 在上标侧一模一样地存在**：
 * `6a^2b^6 ÷ x^2` 被 `([a-zA-Z0-9])\^([a-zA-Z0-9]+)` 的贪婪 `+` 吞成
 * `6a^{2b}^6` —— `b` 被误当上标内容，产物非法，KaTeX 输出红色源码。
 * 两处口径必须一致，否则修了下标却留着上标。
 */
function normalizeScripts(s, marker) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c !== marker) {
      out += c
      i++
      continue
    }
    // 已是花括号形式：原样搬运（含平衡花括号）
    if (s[i + 1] === '{') {
      let depth = 0
      let j = i
      while (j < s.length) {
        out += s[j]
        if (s[j] === '{') depth++
        if (s[j] === '}') {
          depth--
          if (depth === 0) { j++; break }
        }
        j++
      }
      i = j
      continue
    }
    // 数字：连续数字整体作上标/下标（x^12 → x^{12}）
    if (/[0-9]/.test(s[i + 1] || '')) {
      let j = i + 1
      while (j < s.length && /[0-9]/.test(s[j])) j++
      out += marker + '{' + s.slice(i + 1, j) + '}'
      i = j
      continue
    }
    // 单个字母：只吃一个字母，后续字母是基底（A_1B_1C_1 / 6a^2b^6）
    if (/[a-zA-Z]/.test(s[i + 1] || '')) {
      out += marker + '{' + s[i + 1] + '}'
      i += 2
      continue
    }
    // 孤立 marker：丢弃（连续填充线 ____ 已在步骤 0.6 先转成 \underline{\quad}，
    // 这里只剩异常形态；留着必让整段变红）
    i++
  }
  return out
}

/**
 * 根号族：√ 平方根、∛ 立方根、∜ 四次根。
 * 三者操作数解析规则完全一致（括号 / 混合数 / 数字字母组合 / 单字母），
 * 区别只在输出要带根指数。以前只认 √，导致 `∛27` 在屏幕与 PDF 里都是正文字体的裸符号、
 * 后面的数字还被当成独立数学段（2026-10-02 负责人批准：屏幕与打印一起修）。
 */
const RADICALS = { '\u221A': null, '\u221B': 3, '\u221C': 4 }

function convertSqrt(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c in RADICALS) {
      const degree = RADICALS[c]
      const wrap = (inner) => (degree ? `\\sqrt[${degree}]{${inner}}` : `\\sqrt{${inner}}`)
      let j = i + 1
      while (j < s.length && (s[j] === ' ' || s[j] === '\u00A0')) j++

      // A. 括号形式：√(...) → \sqrt{...}（平衡括号）
      if (s[j] === '(') {
        let depth = 0
        let k = j
        let inner = ''
        while (k < s.length) {
          const ch = s[k]
          inner += ch
          if (ch === '(') depth++
          else if (ch === ')') {
            depth--
            if (depth === 0) { k++; break }
          }
          k++
        }
        // 递归处理 inner 里可能嵌套的 √：避免 √(2-√3) → \sqrt{(2-√3)}
        // 这种 inner 还含 Unicode 根号的半成品送进 KaTeX 后部分渲染失败，
        // 表现为"已知a=√√ ... 求b的值"这种散架（错题本 PDF 错乱根因之一）
        out += wrap(convertSqrt(inner))
        i = k
        continue
      }

      // B. 混合数：√2 1/2 → \sqrt{2\frac{1}{2}}
      const mixed = s.slice(j).match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)/)
      if (mixed) {
        out += wrap(mixed[1] + '\\frac{' + mixed[2] + '}{' + mixed[3] + '}')
        i = j + mixed[0].length
        continue
      }

      // C. 数字/负号/小数/字母组合：√30、√-5a、√3.5、√17(a²+b²)、√2x
      const num = s.slice(j).match(/^(-?[0-9]+(?:\.[0-9]+)?[a-zA-Z]*(?:\([^()]*\))?)/)
      if (num && num[1].length > 0) {
        // 递归：num 内部可能含 √(...) 嵌套（如 √17(a²+b²) 的 num="17" 不嵌套，
        // 但 √(x²+1) 等含括号变体经 convertSqrt 走 A 路径之后内部不会再剩 √）
        out += wrap(convertSqrt(num[1]))
        i = j + num[1].length
        continue
      }

      // D. 字母：√x
      if (/[a-zA-Z]/.test(s[j])) {
        out += wrap(s[j])
        i = j + 1
        continue
      }

      // E. 无法识别，保留原样
      out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

function splitToSegments(text, opts = {}) {
  // glueInnerSpaces=false 用于「独立公式判定」的保守口径，见 renderContent 注释：
  // 判定不看合并结果，否则 `-|-2| = 2` 这类行内项会被升级成居中独立公式。
  const glueInnerSpaces = opts.glueInnerSpaces !== false
  const segments = []
  let mathBuffer = ''
  let textBuffer = ''
  // LaTeX 环境深度（cases / array / pmatrix 等）。>0 时环境内部**整体**锁为一个数学段：
  // 环境体里既有中文说明也有 `\\` 换行，任何按字符的启发式都会把它撕开，
  // 而 `\begin{cases}` 与 `\end{cases}` 一旦落进不同片段，KaTeX 必然输出红色源码
  // （2026-10-10 几何题乱码事故）。
  let envDepth = 0

  function flushMath() {
    if (!mathBuffer.trim()) {
      mathBuffer = ''
      return
    }
    // 数学段末尾的句读标点必须留在文本段（2026-09-21 白板第2题）。
    //
    // 症状：`(2) $\sqrt{\frac{3}{x-2}}$.` 的句点在旧实现里因为 `.` 属于 isMathChar
    // 被吸进数学段，于是 ① KaTeX 在数学模式里排出一个"悬空的点"，跟卷面的句号不是一个东西；
    // ② 「公式+句号」被算成"整段只有数学" ⇒ standalone ⇒ $$...$$ 独立公式，
    //    在同一份题面里 (2)(4)(5) 被居中、(3) 因为中间有空格反而行内，一眼就是"不标准"。
    // 句读是句子层面的标点，任何渲染路径（预览/PDF/白板）都该由正文字体排。
    let math = mathBuffer
    let tail = ''
    const punct = math.match(TRAILING_SENTENCE_PUNCT)
    if (punct) {
      tail = punct[0]
      math = math.slice(0, -punct[0].length)
    }
    if (math.trim()) segments.push({ text: math.trim(), isMath: true })
    // 进入数学段前 textBuffer 必已 flush 干净，这里直接把标点接回文本缓冲，
    // 保证「数学段 → 标点」的先后顺序不丢。
    if (tail) textBuffer += tail
    mathBuffer = ''
  }
  function flushText() {
    if (textBuffer) segments.push({ text: textBuffer, isMath: false })
    textBuffer = ''
  }

  let i = 0
  while (i < text.length) {
    const char = text[i]

    // 0. LaTeX 换行符 `\\`（cases/array 环境里的行分隔）—— 必须整段留在数学缓冲内。
    //
    // 2026-10-10 几何题乱码事故：`\begin{cases} a \\ b \end{cases}` 里的 `\\`
    // 在旧实现里落到「普通字符」分支（`\` 不在 isMathChar 内）⇒ flushMath 把数学段
    // 从中间切断，`\begin{cases}` 与 `\end{cases}` 各自落进**不同**的 `$...$` 片段。
    // KaTeX 拿到残缺环境（`\begin{cases} \angle` / `\end{cases} \therefore`）就输出
    // `katex-error` 红色源码 —— 正是老师截图里看到的 `\begin{cases}\angle` 红字。
    //
    // 判据：`\\` 只有作为数学环境内的行分隔才有意义，且它必须**始终**并入数学段，
    // 否则环境必然被撕开。这里无条件并入（`\\` 在纯文本里本就是异常形态）。
    if (char === '\\' && text[i + 1] === '\\') {
      flushText()
      mathBuffer += '\\\\'
      i += 2
      continue
    }

    // 0.5 LaTeX 环境：\begin{cases} … \end{cases}，整段并入数学缓冲并跟踪深度。
    //     深度 >0 期间环境内部整体锁住（见下方 4.5 分支的环境优先判定）。
    //
    //     实现说明：`\begin{` / `\end{` 之后一定是 `{环境名}`，这里只按「花括号 + 环境名」
    //     精确取到配对的 `}`（环境名里不会有嵌套花括号）。任何异常形态都退化为
    //     只吃掉反斜杠后的字母（交给第 1 条常规命令分支），保证 i 一定前进、不死循环。
    if (char === '\\') {
      const isBegin = text.slice(i, i + 7) === '\\begin{'
      const isEnd = text.slice(i, i + 5) === '\\end{'
      if (isBegin || isEnd) {
        const headLen = isBegin ? 7 : 5
        const close = text.indexOf('}', i + headLen)
        // 环境名只允许字母（如 cases / array / pmatrix）；含非法字符说明不是环境命令，
        // 退回常规命令分支处理，避免误吞正文。
        const envName = close === -1 ? '' : text.slice(i + headLen, close)
        if (close > i + headLen && /^[a-zA-Z]+$/.test(envName)) {
          flushText()
          mathBuffer += text.slice(i, close + 1)
          if (isBegin) envDepth++
          else envDepth = Math.max(0, envDepth - 1)
          i = close + 1
          continue
        }
      }
    }

    // 1. LaTeX 命令: \xxx{...}{...}
    if (char === '\\' && i + 1 < text.length && /[a-zA-Z]/.test(text[i + 1])) {
      flushText()
      let cmd = '\\'
      i++
      while (i < text.length && /[a-zA-Z]/.test(text[i])) {
        cmd += text[i]
        i++
      }
      while (i < text.length && text[i] === '{') {
        let depth = 0
        while (i < text.length) {
          cmd += text[i]
          if (text[i] === '{') depth++
          if (text[i] === '}') {
            depth--
            if (depth === 0) { i++; break }
          }
          i++
        }
      }
      mathBuffer += cmd
      continue
    }

    // 2. ^{...} 或 _{...} 结构
    if ((char === '^' || char === '_') && i + 1 < text.length && text[i + 1] === '{') {
      flushText()
      let expr = char + '{'
      i += 2
      let depth = 1
      while (i < text.length && depth > 0) {
        expr += text[i]
        if (text[i] === '{') depth++
        if (text[i] === '}') depth--
        i++
      }
      mathBuffer += expr
      continue
    }

    // 3. 单个 ^ 或 _（简单上标/下标）
    if ((char === '^' || char === '_') && /[a-zA-Z0-9]/.test(textBuffer.slice(-1))) {
      const lastChar = textBuffer.slice(-1)
      textBuffer = textBuffer.slice(0, -1)
      if (textBuffer) flushText()
      mathBuffer = lastChar + char
      i++
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) {
        mathBuffer += text[i]
        i++
      }
      flushMath()
      continue
    }

    // 4.5 环境内部（cases/array）：整体锁进同一数学段，不做任何切断判定。
    //     必须排在「空格判定」之前 —— 环境体里的空格与 `\\` 换行都不能切，
    //     否则 \begin{cases} 与 \end{cases} 会落进不同片段，KaTeX 渲染成红色源码。
    if (envDepth > 0) {
      flushText()
      mathBuffer += char
      i++
      continue
    }

    // 4. 公式内部空格：两侧都是数学记号、且至少一侧是运算符/结构符 ⇒ 属于同一公式，不切断
    //    （`\sqrt{3-x} + \sqrt{x-3}` 必须整体交给 KaTeX，否则被切成三段各排各的，
    //     二元运算符间距丢失、两段字号观感不一致 —— 白板第2题 (3) 就是这么散架的）
    if (glueInnerSpaces && isMathInnerSpace(text, i, mathBuffer)) {
      mathBuffer += char
      i++
      continue
    }

    // 5. 普通字符 — 判断是数学还是文本
    if (isMathChar(char)) {
      if (textBuffer) flushText()
      mathBuffer += char
      i++
    } else {
      if (mathBuffer) flushMath()
      textBuffer += char
      i++
    }
  }

  if (mathBuffer.trim()) flushMath()
  if (textBuffer) flushText()

  const merged = []
  for (const seg of segments) {
    if (!seg.text) continue
    if (merged.length > 0 && merged[merged.length - 1].isMath === seg.isMath) {
      merged[merged.length - 1].text += seg.text
    } else {
      merged.push({ ...seg })
    }
  }
  return merged.length > 0 ? merged : [{ text, isMath: false }]
}

function isMathChar(char) {
  if (/[a-zA-Z0-9.]/.test(char)) return true
  if ('+-*/=^_(){}[]<>|'.includes(char)) return true
  if ('αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'.includes(char)) return true
  if ('≥≤≈∞π∥⊥'.includes(char)) return true
  // Unicode 上下标（²⁰²¹₀₁₂…）：属于数学记号。上标已由 preprocessMath 0.5 转成 ^{...}，
  // 下标由 0.55 转成 _{...}，正常情况下不会流到这里；这里兜底防止漏转时再被切出数学段。
  if (char >= '\u00B2' && char <= '\u00B3') return true
  if (char >= '\u2070' && char <= '\u209F') return true
  return false
}

/**
 * 句子级句读：这些字符跟在数学段末尾时属于「句子标点」，不是公式的一部分。
 *
 * 单独定义成常量是因为它同时被两处消费：splitToSegments 的 flushMath（把句读踢出数学段），
 * 以及测试里的口径断言。新增符号（如全角句号变体）改这里一处即可。
 */
const TRAILING_SENTENCE_PUNCT = /[.,;:!?。，、；：！？．…]+$/

/** 运算符/结构符：出现它说明这一侧是"公式内部"，而不是并列的独立符号 */
const MATH_STRUCT_CHAR = /[+\-*/=<>^_{}()\[\]|]/

/** 该位置是不是一个数学记号（\cmd 与 \\ 换行符都算，因为 \ 不在 isMathChar 里） */
function isMathTokenAt(text, index) {
  if (index < 0 || index >= text.length) return false
  const c = text[index]
  if (isMathChar(c)) return true
  if (c !== '\\') return false
  // `\\`（cases 行分隔）与 `\cmd` 都是数学记号，否则 cases 环境会被空格切断
  return text[index + 1] === '\\' || /[a-zA-Z]/.test(text[index + 1] || '')
}

/**
 * 空格是否处在公式内部（应当并入数学段，不切断）。
 *
 * 保守边界（避免把中文里的并列项粘成一个公式）：
 *   必须 ① 当前已在数学段内；② 空格两侧都是数学记号；
 *   ③ 至少一侧是运算符/结构符（如 `\sqrt{3-x} + \sqrt{x-3}` 的 `}` 与 `+`）。
 * 反例 `a 1`（两侧都是普通字母数字）不并 —— 那种空格是排版间隔，并进去会让 KaTeX
 * 忽略空格把 `a 1` 排成 `a1`。
 */
function isMathInnerSpace(text, index, mathBuffer) {
  const c = text[index]
  if (c !== ' ' && c !== '\u00A0') return false
  if (!mathBuffer) return false
  const prev = text[index - 1] || ''
  const next = text[index + 1] || ''
  if (!isMathTokenAt(text, index - 1) || !isMathTokenAt(text, index + 1)) return false
  if (MATH_STRUCT_CHAR.test(prev) || MATH_STRUCT_CHAR.test(next)) return true
  // `}` 收尾的环境/命令（如 `\begin{cases} \angle`）后接空格：属公式内部，不切断。
  // 仅这一侧放宽 —— 反向（空格后接 `\cmd`）不放开，否则 `6a^{2} \cdot b^{6} \div x^{2}`
  // 这类正常公式会被整段粘连，把 `^2b` 上标贪婪造成的坏形态暴露成 KaTeX 报错（2026-10-10 回归）。
  return prev === '}' && isMathTokenAt(text, index - 1)
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 渲染内容：中文保持纯文本，数学片段用严格 $...$（行内）/ $$...$$（独立）定界符包裹。
 * 返回可安全注入 DOM 的 HTML 字符串。
 *
 * ⚠ 两个口径必须分开（2026-09-21 白板第2题沉淀）：
 *   - **渲染分段**用新口径：公式内部空格不再切断数学段，`\sqrt{3-x} + \sqrt{x-3}`
 *     整体交给 KaTeX，二元运算符间距才对；
 *   - **"是否独立公式"判定**用保守口径（空格仍切断）：判定一旦跟着合并走，
 *     全库会有 338 处行内项（选项 174 / 答案 91 / 题干 73）被凭空升级成 $$ 居中块
 *     —— 选项、小问、答案都是行内项，居中不是版式意图，只是这个启发式的副作用。
 *     判定保持"原本就只有一个数学表达式"才算独立公式，分段改口径就不会掀动版式。
 */
function renderContent(text) {
  if (!text) return ''
  const processed = preprocessMath(String(text))
  const segments = splitToSegments(processed)
  const decisionSegs = splitToSegments(processed, { glueInnerSpaces: false })
  const decisionMath = decisionSegs.filter(s => s.isMath && s.text)
  const decisionHasText = decisionSegs.some(s => !s.isMath && s.text.trim().length > 0)
  const standalone = decisionMath.length === 1 && !decisionHasText
  let html = ''
  for (const seg of segments) {
    if (seg.isMath && seg.text) {
      const dl = standalone ? '$$' : '$'
      html += dl + escapeHtml(seg.text) + dl
    } else {
      html += escapeHtml(seg.text)
    }
  }
  return html
}

/**
 * 印刷/预览自检：循环小数标记有没有活着走到渲染产物里。
 *
 * 背景（2026-09-14 错题再测-0911 事故）：组合点丢过一次，而且**丢得悄无声息** ——
 * 页面上「2.6̇」变成「2.6」，题目从无限循环小数变成有限小数，没有任何报错，
 * 直到学生按印出来的题作答被判错才被发现。
 * 所以渲染前规范化之外，还要有一道"渲染后点数对得上"的自检：原文有几个点，
 * 产物里就该有几个 \dot/\bar，且**不允许有裸组合字符**残留在 KaTeX 之外。
 *
 * @param {string} text 题目原文（题干/选项/答案均可）
 * @param {string} [label] 定位用标签，如 `第3题题干`
 * @returns {null | {label:string, dots:number, bare:number, accents:number, text:string}}
 *          返回 null 表示无循环点或渲染完好；返回对象即为"丢点"证据
 */
function auditLoopDotRendering(text, label = '') {
  const src = String(text || '')
  const dots = (src.match(/[\u0305\u0307]/g) || []).length
  if (!dots) return null
  const rendered = renderContent(src)
  const bare = (rendered.match(/[\u0305\u0307]/g) || []).length
  const accents = (rendered.match(/\\dot\{|\\bar\{/g) || []).length
  if (bare === 0 && accents >= dots) return null
  return { label, dots, bare, accents, text: src.slice(0, 60) }
}

export {
  preprocessMath,
  convertSqrt,
  splitToSegments,
  isMathChar,
  isMathInnerSpace,
  TRAILING_SENTENCE_PUNCT,
  SUP_BASE,
  SUB_BASE,
  renderContent,
  auditLoopDotRendering,
}
