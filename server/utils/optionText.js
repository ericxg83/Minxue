/**
 * 选项标号清洗。
 *
 * AI 识别（OCR）会把试卷原印的标号一起转录进 options，例如 ["(A) 3/4", "(B) 4/3"]；
 * 而前端各处又按数组下标补一个 "A."，于是渲染成 "A. (A) 3/4"。
 * 统一在入库前把标号剥掉，让 options 只存选项正文，标号一律由展示层按下标生成。
 *
 * 安全策略（避免把正文误当标号剥掉）：
 * 整组表决 —— 只有当【每一项都能解析出标号】且【标号恰好是 A、B、C… 的连续升序】时才剥。
 * 任一项没有标号（如 ["正确","错误"]）或标号乱序，整组原样返回。
 */

// 带括号：(A) （A） [A] 【A】 「A」 ；裸字母：A. A． A、 A) A）
const LABEL_RE = /^\s*(?:[（([【「]\s*([A-Ha-h])\s*[)）\]】」]|([A-Ha-h])\s*[.．、)）])[.．、]?\s*/
// 最外层可能包着行内公式定界符：$(A) \frac{3}{4}$
const MATH_OPEN_RE = /^\s*(\$\$?|\\\(|\\\[)/

/** 解析单个选项的标号，无标号或剥完为空时返回 null */
const parseLabeled = (raw) => {
  if (typeof raw !== 'string') return null
  const mathOpen = raw.match(MATH_OPEN_RE)
  const head = mathOpen ? raw.slice(mathOpen[0].length) : raw
  const m = head.match(LABEL_RE)
  if (!m) return null
  const rest = head.slice(m[0].length)
  if (!rest.trim()) return null
  return { letter: (m[1] || m[2]).toUpperCase(), text: (mathOpen ? mathOpen[1] : '') + rest }
}

/**
 * 剥掉整组选项的标号。不满足整组表决条件时原样返回（幂等，可重复调用）。
 * @param {any} options 选项数组；非数组原样返回
 * @returns {any}
 */
export const normalizeOptions = (options) => {
  if (!Array.isArray(options) || options.length === 0) return options
  const parsed = options.map(parseLabeled)
  if (parsed.some(p => p === null)) return options
  if (!parsed.every((p, i) => p.letter === String.fromCharCode(65 + i))) return options
  return parsed.map(p => p.text.trim())
}

/**
 * 展示层用：取第 idx 项的正文。整组能剥就用剥过的，否则回退原文。
 * @param {any} options 选项数组
 * @param {number} idx 下标
 * @returns {string}
 */
export const optionTextAt = (options, idx) => {
  const list = normalizeOptions(options)
  return Array.isArray(list) ? String(list[idx] ?? '') : ''
}

/**
 * 拼进 AI prompt 用：options 已不带标号，必须显式补回 "A. xxx"，
 * 否则模型看到 "选项：3/4；4/3" 无从判断哪个是 A，答案字母只能靠猜。
 * @param {any} options 选项数组
 * @returns {string} 形如 "A. 3/4；B. 4/3"，无选项时返回空串
 */
export const formatOptionsForPrompt = (options) => {
  const list = normalizeOptions(options)
  if (!Array.isArray(list) || list.length === 0) return ''
  return list.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('；')
}
