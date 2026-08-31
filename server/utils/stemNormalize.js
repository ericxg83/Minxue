/**
 * 后端题干归一化：与 src/domain/questionIdentity.js 的 normalizeStem 同口径，
 * 用于 wrong-paper 按题维度聚合时的 stem 兜底身份键。
 *
 * 不做相似度匹配，只做精确归一化（NFKC + 去 LaTeX 间距 + 去空白 + 去句读 +
 * 数字之间的小数点保留 + 折叠下划线/破折号 + 转小写）。
 */

const LATEX_SPACE_RE = /\\(?:quad|qquad|thinspace|medspace|thickspace|enspace|hspace\s*\{[^}]*\}|[,;:!> ])/g
const PUNCT_RE = /[,;:!?。、·・]/g
const DOT_RE = /\./g

export function normalizeStem(raw) {
  let s = String(raw == null ? '' : raw)
  if (!s) return ''
  s = s.normalize('NFKC')
  s = s.replace(LATEX_SPACE_RE, '')
  s = s.replace(/\s+/g, '')
  s = s.replace(PUNCT_RE, '')
  s = s.replace(DOT_RE, (match, offset, whole) => {
    const prev = whole[offset - 1]
    const next = whole[offset + 1]
    const isDigit = (c) => c >= '0' && c <= '9'
    return prev && next && isDigit(prev) && isDigit(next) ? match : ''
  })
  s = s.replace(/_{2,}/g, '_')
  s = s.replace(/[-—–]{2,}/g, '—')
  return s.toLowerCase()
}

/**
 * 题身份键生成：与 questionIdentity.getQuestionIdentityKey 同口径。
 * 优先级：question_id > worksheet_id+question_no > stem 归一化。
 *
 * @param {{question_id?:string|null, worksheet_id?:string|null, question_no?:string|number|null, page_number?:number|null, content?:string|null}} record
 */
export function buildWrongQuestionIdentityKey(record) {
  if (!record) return null
  if (record.question_id) return `qid:${record.question_id}`
  if (record.worksheet_id && record.question_no != null && record.question_no !== '') {
    const page = record.page_number == null ? '' : record.page_number
    return `ws:${record.worksheet_id}|p${page}|n${record.question_no}`
  }
  const stem = normalizeStem(record.content || '')
  return stem ? `stem:${stem}` : null
}