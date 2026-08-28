/**
 * 二次根式的最简化（有理化）。
 *
 * AI 现场生成的标准答案常停在"算出来了"就收手，不做最后一步有理化：
 * 圆面积比 3:2 求半径比，它给 "√3:√2"，而教材要求的最简形式是 "√6:2"。
 * 学生写了更规范的 "√6:2" 反而和标准答案对不上，标准答案本身还会沉淀进
 * 答案库/讲义，把不规范的写法教给下一个孩子。
 *
 * 只改写能完全解析成 [系数]√[整数] 的简单形态，且改写后要通过数值自检
 * （原式与新式数值相等）才采用，解析不了或数值不符就原样返回。
 */

/** 提出被开方数里的平方因子：√18 → { coef: 3, rad: 2 } */
function simplifySqrt(radicand) {
  let coef = 1
  let rad = radicand
  for (let f = 2; f * f <= rad; f++) {
    while (rad % (f * f) === 0) {
      rad /= f * f
      coef *= f
    }
  }
  return { coef, rad }
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a || 1
}

/**
 * 解析 "√3" / "2√3" / "5" / "-√2" / "3√5/2" 成 { num, den, rad }，
 * 表示 (num/den)·√rad。解析不了返回 null。
 */
function parseRadicalTerm(input) {
  const s = String(input ?? '').replace(/\s+/g, '')
  if (!s) return null
  const m = /^([+-]?)(\d*)(?:√(\d+))?(?:\/(\d+))?$/.exec(s)
  if (!m) return null
  const [, sign, coefStr, radStr, denStr] = m
  if (!radStr && !coefStr) return null
  const num = (sign === '-' ? -1 : 1) * (coefStr === '' ? 1 : parseInt(coefStr, 10))
  const den = denStr ? parseInt(denStr, 10) : 1
  const rad = radStr ? parseInt(radStr, 10) : 1
  if (!den || rad < 1) return null
  return { num, den, rad }
}

/** { num, den, rad } → 数值 */
function termValue({ num, den, rad }) {
  return (num / den) * Math.sqrt(rad)
}

/** 把平方因子从根号里提到系数上，并约掉系数的公因数 */
function normalizeTerm({ num, den, rad }) {
  const { coef, rad: r } = simplifySqrt(rad)
  const n = num * coef
  const g = gcd(n, den)
  return { num: n / g, den: den / g, rad: r }
}

/** { num, den, rad } → "3√2/4" 这样的最简字符串 */
function formatTerm(term) {
  const { num, den, rad } = normalizeTerm(term)
  const sign = num < 0 ? '-' : ''
  const n = Math.abs(num)
  const head = rad === 1 ? String(n) : (n === 1 ? `√${rad}` : `${n}√${rad}`)
  return sign + (den === 1 ? head : `${head}/${den}`)
}

/**
 * 比例的后项有理化："√3:√2" → "√6:2"。
 * 后项不含根号时不动；两段里有解析不了的就整体放弃。
 */
function rationalizeRatio(text) {
  const raw = String(text ?? '')
  const parts = raw.split(/[:：]/)
  if (parts.length !== 2) return null
  const a = parseRadicalTerm(parts[0])
  const b = parseRadicalTerm(parts[1])
  if (!a || !b) return null
  if (b.rad === 1) return null // 后项已无根号，无需有理化

  // 两项同乘 √(b.rad)：前项 √(rad_a·rad_b)、后项 b·rad_b
  const na = normalizeTerm({ num: a.num, den: a.den, rad: a.rad * b.rad })
  const nb = normalizeTerm({ num: b.num * b.rad, den: b.den, rad: 1 })
  // 比例整体约分：先通分成整数系数，再同除最大公因数，"6:12" 要收成 "1:2"
  const lcm = (x, y) => Math.abs(x * y) / gcd(x, y)
  const L = lcm(na.den, nb.den)
  let ia = na.num * (L / na.den)
  let ib = nb.num * (L / nb.den)
  const g = gcd(ia, ib)
  ia /= g
  ib /= g
  const left = { num: ia, den: 1, rad: na.rad }
  const right = { num: ib, den: 1, rad: nb.rad }
  const out = `${formatTerm(left)}:${formatTerm(right)}`

  // 数值自检：比值必须不变
  const oldRatio = termValue(a) / termValue(b)
  if (!termValue(right)) return null
  if (Math.abs(termValue(left) / termValue(right) - oldRatio) > 1e-9) return null
  return out === raw.replace(/\s+/g, '') ? null : out
}

/**
 * 分母有理化："1/√2" → "√2/2"，"3/√5" → "3√5/5"。
 */
function rationalizeFraction(text) {
  const s = String(text ?? '').replace(/\s+/g, '')
  const m = /^([+-]?)(\d*)\/√(\d+)$/.exec(s)
  if (!m) return null
  const [, sign, numStr, radStr] = m
  const num = (numStr === '' ? 1 : parseInt(numStr, 10)) * (sign === '-' ? -1 : 1)
  const rad = parseInt(radStr, 10)
  if (rad < 2) return null
  const out = formatTerm({ num, den: rad, rad })
  const before = num / Math.sqrt(rad)
  const after = parseRadicalTerm(out)
  if (!after || Math.abs(termValue(after) - before) > 1e-9) return null
  return out
}

/**
 * 对答案做最简化改写；不认识的形态原样返回。
 */
export function rationalizeAnswer(answer) {
  const raw = String(answer ?? '')
  if (!raw.includes('√')) return raw
  const trimmed = raw.trim()
  return rationalizeRatio(trimmed) || rationalizeFraction(trimmed) || raw
}

export { parseRadicalTerm, simplifySqrt, formatTerm }
