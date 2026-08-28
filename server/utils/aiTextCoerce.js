/**
 * AI 返回的文本字段可能不是字符串。
 *
 * 视觉模型遇到多解题（"4(1-x)²=9"）时会自作主张把 student_answer 输出成数组
 * ["x₁ = -1/2","x₂ = 5/2"]，直接把它当参数传给 pg，node-postgres 会按 PG 数组
 * 字面量序列化，写进 text 列后就成了字面串 {"x₁ = -1/2","x₂ = 5/2"}：
 * 页面上显示成乱码，判题也拿这串带引号花括号的东西去比对。
 *
 * 所有从 AI JSON 取文本字段的地方都要先过这里。
 */
export function coerceAIText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value.map(coerceAIText).filter(s => s.trim()).join(', ')
  }
  if (typeof value === 'object') {
    return Object.values(value).map(coerceAIText).filter(s => s.trim()).join(', ')
  }
  return ''
}

/**
 * 还原已经写进库的 PG 数组字面量：{"x₁ = -1/2","x₂ = 5/2"} → "x₁ = -1/2, x₂ = 5/2"。
 * 只认「整串被花括号包住、且内部元素带双引号」的形态，不碰正常含花括号的 LaTeX
 * （如 \frac{1}{2}）。无法解析时返回原串。
 */
export function unwrapPgArrayLiteral(text) {
  const raw = String(text ?? '')
  const trimmed = raw.trim()
  if (!/^\{".*"\}$/s.test(trimmed)) return raw
  const inner = trimmed.slice(1, -1)
  const parts = []
  let buf = ''
  let inQuote = false
  let escaped = false
  for (const ch of inner) {
    if (escaped) { buf += ch; escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inQuote = !inQuote; continue }
    if (ch === ',' && !inQuote) { parts.push(buf); buf = ''; continue }
    buf += ch
  }
  parts.push(buf)
  const cleaned = parts.map(p => p.trim()).filter(Boolean)
  return cleaned.length ? cleaned.join(', ') : raw
}
