/**
 * assertionVacuityKit.mjs —— 「这条断言是不是恒真、永远不会失败」的唯一判定实现（r246）
 *
 * 为什么要有它（本仓真实缺陷）：
 *   测试里写了 `assert.ok(<表达式> || true, '...')` —— `|| true` 让整个表达式恒为真，
 *   于是这条断言**永远不可能失败**。它长得像一道门禁，实际什么都没查，
 *   比「没有这条断言」更坏：它给后来人「这里已经盯住了」的错觉。
 *   实测命中 2 处（`test/dailyBackupResult.test.mjs` 的 BACKUP_ROOT 常量检查、
 *   `test/geomConstraintExtract.test.mjs` 的「结论式不得进约束集」检查）——
 *   后者正是几何配图那条链上最该盯的一句，却因为 `|| true` 一句都没盯住。
 *
 * 与既有 meta 判据的关系（同一枚硬币的不同面）：
 *   - `test/sourceLockFailClosed.test.mjs`（r167）拦的是「锚点改名 ⇒ 锁静默失效」；
 *   - 本 kit 拦的是「表达式恒真 ⇒ 锁静默失效」。两者都是「看着是绿的，其实什么都没查」。
 *
 * 判定口径（保守：只在**能证明它恒真**时才报，绝不猜）：
 *   一条断言被判恒真，当且仅当它的**第一个参数**（逗号在顶层切出的第一段）满足其一：
 *     ① 整个参数就是一个恒真的字面量：`true` / `1` / `[]` / `{}` / 非空字符串；
 *     ② 参数以 `|| <恒真字面量>` 收尾 ⇒ 无论左边是什么，结果都恒真。
 *   ⛔ 刻意不报 `a || b`（b 是变量）、`a || (true)`（括号包着）、`a || true && b`
 *      （结尾不是字面量）—— 那些**不一定**恒真，报了就是新的假红源（r214 教训）。
 *
 * 预处理（关键）：扫描前先把**注释与字符串字面量的内容**抹成空格（保留引号与换行）。
 *   ① 免得把「注释里当反面教材写的旧写法」当成违规代码（r167 教训）；
 *   ② 免得本 kit 与它的测试文件里那些**样本字符串**把自己判红 ⇒ 不用给自己开豁免洞；
 *   ③ 括号配对不会被人名/文案里的括号带偏。
 */

/** 恒真字面量（整个参数就是它）。空串 `''` 不算 —— 那恒假，是另一种毛病，别混进来。 */
const TRUTHY_LITERAL = String.raw`(?:true|1|\[\]|\{\}|'[^']+'|"[^"]+")`
/** 参数以 `|| <恒真字面量>` 收尾 ⇒ 恒真。 */
const ENDS_WITH_TRUTHY = new RegExp(String.raw`^[\s\S]*\|\|\s*${TRUTHY_LITERAL}$`)
const IS_TRUTHY = new RegExp(String.raw`^${TRUTHY_LITERAL}$`)

/** `/` 前面出现这些字符时，这个 `/` 更可能是正则字面量的开始，而不是除号。 */
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])

/**
 * 把注释与字符串字面量的**内容**抹成空格，长度与换行位置逐字保持不变。
 * 保留引号本身 ⇒ 被抹空的字符串仍然看得出「这里原本是个字符串」（`''`）。
 * @param {string} src 源码全文
 * @returns {string} 等长、等行号的掩码文本
 */
export function maskLiteralsAndComments(src) {
  const chars = String(src).split('')
  const n = chars.length
  const blank = (from, to) => {
    for (let k = Math.max(0, from); k < Math.min(to, n); k++) {
      if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' '
    }
  }
  const lastMeaningful = (idx) => {
    for (let k = idx - 1; k >= 0; k--) {
      if (chars[k] !== ' ' && chars[k] !== '\t') return chars[k]
    }
    return ''
  }

  let i = 0
  while (i < n) {
    const c = chars[i]
    const c2 = chars[i + 1]
    if (c === '/' && c2 === '/') {
      let j = i + 2
      while (j < n && chars[j] !== '\n') j++
      blank(i + 2, j)
      i = j
      continue
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2
      while (j < n && !(chars[j] === '*' && chars[j + 1] === '/')) j++
      blank(i + 2, j)
      i = Math.min(j + 2, n)
      continue
    }
    // 正则字面量：只吃「前面是运算符/括号」的那种 `/`，免得把除法当正则（反之亦然）
    if (c === '/' && REGEX_PREV.has(lastMeaningful(i))) {
      let j = i + 1
      let inClass = false
      while (j < n) {
        if (chars[j] === '\\') { j += 2; continue }
        if (chars[j] === '\n') break // 正则不跨行；说明这不是正则，退回
        if (chars[j] === '[') inClass = true
        else if (chars[j] === ']') inClass = false
        else if (chars[j] === '/' && !inClass) break
        j++
      }
      if (j < n && chars[j] === '/') { i = j + 1; continue }
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < n) {
        if (chars[j] === '\\') { j += 2; continue }
        if (chars[j] === c) break
        j++
      }
      blank(i + 1, j) // 保留首尾引号
      i = j + 1
      continue
    }
    i++
  }
  return chars.join('')
}

/** 从 `openIdx` 处的 `(` 找到配对的 `)`；找不到返回 -1。 */
function matchParen(s, openIdx) {
  let depth = 0
  for (let k = openIdx; k < s.length; k++) {
    const ch = s[k]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return k
    }
  }
  return -1
}

/** 在顶层逗号处切出第一段参数。 */
function firstArg(inner) {
  let depth = 0
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) return inner.slice(0, k)
  }
  return inner
}

const lineOf = (s, idx) => s.slice(0, idx).split('\n').length

/**
 * 找出一段源码里**恒真、永远不可能失败**的断言。
 *
 * 只认 `assert(...)` 与 `assert.ok(...)` —— 别的断言方法（equal/match/throws…）
 * 的恒真形态各不相同，没把握的就不报（宁可漏，不要假红）。
 *
 * @param {string} src 源码全文
 * @returns {{index:number, line:number, method:string, expr:string, reason:string}[]}
 */
export function findVacuousAssertions(src) {
  const masked = maskLiteralsAndComments(src)
  const hits = []
  const callRe = /\bassert(\.ok)?\s*\(/g
  let m
  while ((m = callRe.exec(masked))) {
    const openIdx = m.index + m[0].length - 1
    const closeIdx = matchParen(masked, openIdx)
    if (closeIdx < 0) continue
    const expr = firstArg(masked.slice(openIdx + 1, closeIdx)).trim()
    if (!expr) continue
    const method = m[1] ? 'assert.ok' : 'assert'
    if (IS_TRUTHY.test(expr)) {
      hits.push({
        index: m.index, line: lineOf(masked, m.index), method, expr,
        reason: `${method}() 的参数整个就是一个恒真的字面量 ⇒ 这条断言永远为真`,
      })
      continue
    }
    if (ENDS_WITH_TRUTHY.test(expr)) {
      hits.push({
        index: m.index, line: lineOf(masked, m.index), method, expr,
        reason: `${method}() 的参数以 "|| <恒真值>" 收尾 ⇒ 无论左边是什么都恒真，这条断言永远为真`,
      })
    }
  }
  return hits
}
