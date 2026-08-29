/**
 * 错题「同一题」判定 —— 移动端与 PC 工作台共用的唯一口径。
 *
 * 背景：此前两端各有一套实现，且口径不同——
 *   - 移动端 src/App.jsx 内联：question_id 精确 / 题干原文精确
 *   - PC 端 src/utils/questionDedup.js：Levenshtein 相似度 >= 90% 模糊合并
 * 模糊合并会把「只改数字/改角度」的变式题、以及「最小 vs 最大」「正确 vs 错误」
 * 这类语义相反的题判为同一题（实测相似度 90.5%~97.5%），题干越长误判越重；
 * 合并时又取组内最高 lifecycle，会让真实未掌握的错题从错题本消失。
 *
 * 因此本模块只做「归一化后精确匹配」，不引入任何相似度阈值：
 *   - OCR 的空白 / 全半角 / 句读 / 占位符长度噪声由归一化消除（零误判）
 *   - OCR 漏字错字造成的重复（如「的数」→「的效」）在字符层面与真实差异
 *     无法区分（实测编辑距离区间完全重叠），交由复核台人工判断，本层不猜
 *
 * 数据归属不变：wrong_questions 由后端拥有，
 * UNIQUE(student_id, question_id) 与自包含错题的
 * (student_id, worksheet_id, question_no) 才是唯一真相；本模块只做展示层兜底，
 * 不产生新的业务状态。
 */

// LaTeX 里不影响语义的间距命令，OCR 输出时有无不定
const LATEX_SPACE_RE = /\\(?:quad|qquad|thinspace|medspace|thickspace|enspace|hspace\s*\{[^}]*\}|[,;:!> ])/g

// 句读标点：NFKC 已把全角 ，；：！？ 折叠为 ASCII，故这里只列 ASCII 与
// 不在全角块内的中文标点（。、·）。
// 逗号一并删除：中文数学题里它只做句读或千分位（1,000 与 1000 是同一道题），
// 从不表示小数。
const PUNCT_RE = /[,;:!?\u3002\u3001\u00b7\u30fb]/g
// 句点必须区别对待——数字之间是小数点，承担语义（1.5 米 ≠ 15 米）。
const DOT_RE = /\./g

/**
 * 题干归一化：抹掉 OCR 格式噪声，保留全部语义字符。
 *
 * 顺序有意为之：NFKC 先把全角字母数字与全角标点折叠成半角，
 * 再去空白（此时 LaTeX 命令边界仍完整），最后处理句读。
 */
export const normalizeStem = (raw) => {
  let s = String(raw == null ? '' : raw)
  if (!s) return ''
  s = s.normalize('NFKC')
  s = s.replace(LATEX_SPACE_RE, '')
  s = s.replace(/\s+/g, '')
  s = s.replace(PUNCT_RE, '')
  // 句点：仅当两侧都是数字时保留（小数点），否则视为句读噪声删除。
  s = s.replace(DOT_RE, (match, offset, whole) => {
    const prev = whole[offset - 1]
    const next = whole[offset + 1]
    const isDigit = (c) => c >= '0' && c <= '9'
    return prev && next && isDigit(prev) && isDigit(next) ? match : ''
  })
  // 填空下划线与破折号的长度是 OCR 噪声，不是题目差异
  s = s.replace(/_{2,}/g, '_')
  s = s.replace(/[-\u2014\u2013]{2,}/g, '\u2014')
  return s.toLowerCase()
}

/**
 * 取错题记录上的题干。
 * 普通错题的题干在 JOIN 出来的 question 对象里，
 * 自包含错题（question_id 为空）的题干直接存在 wrong_questions.content。
 */
const readStem = (record) => {
  if (!record) return ''
  const nested = record.question
  if (nested && nested.content) return nested.content
  return record.content || ''
}

/**
 * 错题身份键。返回 null 表示该记录缺少任何可定位信息，调用方应跳过。
 *
 * 优先级与后端去重键保持一致：
 *   1. question_id —— 对应后端 UNIQUE(student_id, question_id)
 *   2. worksheet_id + page_number + question_no —— 自包含错题的自然键
 *      （见 server/services/neonService.js 的 addSelfContainedWrongQuestion）
 *      按 AGENTS.md：练习册定位不能只依赖题号，故带上 worksheet 与页码
 *   3. 归一化题干 —— 上面两者都缺时的展示层兜底
 */
export const getQuestionIdentityKey = (record) => {
  if (!record) return null

  if (record.question_id) return `qid:${record.question_id}`

  const worksheetId = record.worksheet_id
  const questionNo = record.question_no
  if (worksheetId && questionNo != null && questionNo !== '') {
    const page = record.page_number == null ? '' : record.page_number
    return `ws:${worksheetId}|p${page}|n${questionNo}`
  }

  const stem = normalizeStem(readStem(record))
  return stem ? `stem:${stem}` : null
}

/** 两条错题记录是否指向同一道题。 */
export const isSameWrongQuestion = (a, b) => {
  const ka = getQuestionIdentityKey(a)
  if (!ka) return false
  return ka === getQuestionIdentityKey(b)
}

const LIFECYCLE_ORDER = ['new', 'review_1', 'review_2', 'mastered']

const pickTime = (record) => record.last_wrong_at || record.added_at || record.created_at || ''

/**
 * 合并同一身份键下的多条记录。
 *
 * 归一化精确匹配下这里通常只有单条：普通错题受数据库唯一约束，
 * 自包含错题受写入侧自然键约束。真正会出现多条的是分页拉取时
 * 同一行被重复带回，已在 dedupeWrongQuestions 里先按行 id 折叠，
 * 因此此处累加统计不会把同一行算两次。
 */
const mergeGroup = (group) => {
  if (group.length === 1) return group[0]

  const sorted = [...group].sort((a, b) => String(pickTime(b)).localeCompare(String(pickTime(a))))
  const latest = sorted[0]
  const earliest = sorted[sorted.length - 1]

  let lifecycle = 'new'
  for (const item of group) {
    const cur = item.lifecycle_status || 'new'
    if (LIFECYCLE_ORDER.indexOf(cur) > LIFECYCLE_ORDER.indexOf(lifecycle)) lifecycle = cur
  }

  return {
    ...latest,
    error_count: group.reduce((sum, item) => sum + (item.error_count || 1), 0),
    practice_count: group.reduce((sum, item) => sum + (item.practice_count || 0), 0),
    lifecycle_status: lifecycle,
    first_wrong_time: earliest.added_at || earliest.created_at,
    last_wrong_time: pickTime(latest),
    is_merged: true,
    wrong_count: group.length,
    original_ids: group.map(item => item.id)
  }
}

/**
 * 错题列表去重。保持入参顺序（按首次出现位置），排序由调用方负责。
 * 缺少任何可定位信息的记录会被丢弃——它们无法在两端稳定对应同一道题。
 */
export const dedupeWrongQuestions = (list) => {
  if (!Array.isArray(list) || list.length === 0) return []

  // 1) 先折叠完全相同的数据库行（分页重叠、缓存与新数据合并时会出现）
  const byRowId = []
  const seenRowIds = new Set()
  for (const record of list) {
    if (!record) continue
    if (record.id != null) {
      if (seenRowIds.has(record.id)) continue
      seenRowIds.add(record.id)
    }
    byRowId.push(record)
  }

  // 2) 再按身份键分组
  const groups = new Map()
  for (const record of byRowId) {
    const key = getQuestionIdentityKey(record)
    if (!key) continue
    const bucket = groups.get(key)
    if (bucket) bucket.push(record)
    else groups.set(key, [record])
  }

  return Array.from(groups.values(), mergeGroup)
}
