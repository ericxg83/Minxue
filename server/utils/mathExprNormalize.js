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
