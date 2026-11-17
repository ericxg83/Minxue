/**
 * curatedQuestionService.js — 好题甄选（2026-11-17）
 *
 * 职责：老师把散落在两处的好题收起来，打标签，集中筛选后导出 PDF。
 *
 * ⛔ 三条硬纪律（评审定稿）：
 *   1. 只存「引用 + 标签」，绝不复制题干/选项/答案/配图。
 *      列表时按 source_type + source_id 实时 JOIN 原表取内容。
 *   2. 不回写任何题目表、错题表、掌握度 —— 收藏是纯旁路动作。
 *   3. 自动打标只用客观数据，判不了就留空，绝不猜、不弹窗问老师。
 *
 * 两种来源：
 *   question           -> questions 表（每日错题 / 学生作答链路）
 *   resource_question  -> resource_questions 表（试卷/截图题，试卷题库）
 *
 * 标签（推荐四值：易错 / 高难 / 典型 / 好素材）：
 *   question 来源：difficulty>=4 →「高难」；错次>=2 →「易错」
 *   resource 来源：继承 resource_questions.tags（老师加题时已打的）
 */
import { query } from '../config/neon.js'

const SOURCE = {
  QUESTION: 'question',
  RESOURCE: 'resource_question',
}

/** 收藏。重复收藏返回 existed:true，不覆盖老师已改的标签。 */
export async function addCuratedQuestion({ sourceType, sourceId, tags }) {
  if (![SOURCE.QUESTION, SOURCE.RESOURCE].includes(sourceType)) {
    throw new Error('无效的来源类型')
  }
  if (!sourceId) throw new Error('缺少题目 ID')

  // 来源题必须真实存在（避免收藏一个死 ID，视图里成幽灵条目）
  const table = sourceType === SOURCE.QUESTION ? 'questions' : 'resource_questions'
  const exists = await query(`SELECT id FROM ${table} WHERE id = $1`, [sourceId])
  if (!exists.rows.length) throw new Error('题目不存在或已被删除')

  const autoTags = await deriveAutoTags(sourceType, sourceId)
  const finalTags = normalizeTags(tags).length ? normalizeTags(tags) : autoTags

  const { rows } = await query(
    `INSERT INTO curated_questions (source_type, source_id, tags)
     VALUES ($1, $2, $3::text[])
     ON CONFLICT (source_type, source_id) DO NOTHING
     RETURNING id, source_type, source_id, tags, created_at`,
    [sourceType, sourceId, finalTags]
  )
  if (rows.length) return { ...rows[0], existed: false, autoTags }

  const kept = await query(
    'SELECT id, source_type, source_id, tags, created_at FROM curated_questions WHERE source_type = $1 AND source_id = $2',
    [sourceType, sourceId]
  )
  return { ...kept.rows[0], existed: true, autoTags }
}

/** 取消收藏。按 (来源,题目ID) 精确删，不碰原题目。 */
export async function removeCuratedQuestion({ sourceType, sourceId }) {
  if (![SOURCE.QUESTION, SOURCE.RESOURCE].includes(sourceType)) throw new Error('无效的来源类型')
  if (!sourceId) throw new Error('缺少题目 ID')
  const { rowCount } = await query(
    'DELETE FROM curated_questions WHERE source_type = $1 AND source_id = $2',
    [sourceType, sourceId]
  )
  return { removed: rowCount > 0 }
}

/** 更新标签/备注/章节（老师手动增删）。只改 tags/note/chapter_ids，不碰 source。 */
export async function updateCuratedQuestion(id, { tags, note, chapterIds }) {
  const sets = []
  const params = [id]
  if (Array.isArray(tags)) {
    params.push(normalizeTags(tags))
    sets.push(`tags = $${params.length}::text[]`)
  }
  if (Array.isArray(chapterIds)) {
    params.push(normalizeTags(chapterIds))
    sets.push(`chapter_ids = $${params.length}::text[]`)
  }
  if (typeof note === 'string') {
    params.push(note.slice(0, 500))
    sets.push(`note = $${params.length}`)
  }
  if (!sets.length) return null
  const { rows } = await query(
    `UPDATE curated_questions SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, source_type, source_id, tags, note, chapter_ids, created_at`,
    params
  )
  return rows[0] || null
}

/** 批量写入章节（AI 归类后调用）。按 curated id 精确更新，只写 chapter_ids。 */
export async function setCuratedChapters(updates) {
  let applied = 0
  for (const u of (Array.isArray(updates) ? updates : [])) {
    if (!u?.id || !Array.isArray(u.chapterIds)) continue
    await query(
      'UPDATE curated_questions SET chapter_ids = $2::text[] WHERE id = $1',
      [u.id, normalizeTags(u.chapterIds)]
    )
    applied++
  }
  return { applied }
}

/**
 * 列表：实时 JOIN 原表取题目内容，两类来源归一化成同一形状。
 * 源题被删的记录自动跳过（LEFT JOIN + 过滤），不留幽灵条目。
 */
const QUESTION_READ = `
  SELECT cq.id AS curated_id, cq.source_type, cq.source_id, cq.tags, cq.note, cq.chapter_ids, cq.created_at,
         q.content, q.parent_stem, q.options, q.question_type, q.answer, q.analysis,
         q.difficulty, q.subject, q.geometry_image_url, q.image_url,
         r.name AS resource_name
    FROM curated_questions cq
    JOIN questions q ON q.id = cq.source_id AND q.deleted_at IS NULL
    LEFT JOIN resources r ON r.id = q.cache_id
   WHERE cq.source_type = 'question'
`
const RESOURCE_READ = `
  SELECT cq.id AS curated_id, cq.source_type, cq.source_id, cq.tags, cq.note, cq.chapter_ids, cq.created_at,
         rq.content, rq.parent_stem, rq.options, rq.question_type, rq.answer, rq.analysis,
         rq.difficulty, rq.image_url, rq.page_image_url,
         r.name AS resource_name, r.subject
    FROM curated_questions cq
    JOIN resource_questions rq ON rq.id = cq.source_id
    LEFT JOIN resources r ON r.id = rq.resource_id
   WHERE cq.source_type = 'resource_question'
`

export async function listCuratedQuestions(filters = {}) {
  const wantsQuestion = !filters.sourceType || filters.sourceType === SOURCE.QUESTION
  const wantsResource = !filters.sourceType || filters.sourceType === SOURCE.RESOURCE
  const [qRows, rRows] = await Promise.all([
    wantsQuestion ? query(QUESTION_READ) : Promise.resolve({ rows: [] }),
    wantsResource ? query(RESOURCE_READ) : Promise.resolve({ rows: [] }),
  ])

  let list = [
    ...qRows.rows.map(r => normalizeRow(r, SOURCE.QUESTION)),
    ...rRows.rows.map(r => normalizeRow(r, SOURCE.RESOURCE)),
  ]

  // 标签筛选：命中任一即保留（数组包含语义）
  if (Array.isArray(filters.tags) && filters.tags.length) {
    list = list.filter(item => filters.tags.some(t => item.tags.includes(t)))
  }
  // 章节筛选：命中任一章节即保留（一题可挂多章）
  if (Array.isArray(filters.chapterIds) && filters.chapterIds.length) {
    list = list.filter(item => filters.chapterIds.some(cid => item.chapterIds.includes(cid)))
  }
  // 关键词：题干 / 公共题干
  if (filters.keyword) {
    const kw = String(filters.keyword).trim().toLowerCase()
    list = list.filter(item =>
      String(item.content || '').toLowerCase().includes(kw) ||
      String(item.parentStem || '').toLowerCase().includes(kw)
    )
  }

  // 排序：默认最新在前
  const sort = filters.sort || 'newest'
  if (sort === 'oldest') list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  else if (sort === 'difficulty_desc') list.sort((a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1))
  else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  return {
    items: list,
    total: list.length,
    tagStats: tagStats(list),
  }
}

/** 查收藏状态（给五处星标按钮用，批量查避免 N+1）。 */
export async function getCuratedStatus(sourceType, sourceIds) {
  const ids = Array.isArray(sourceIds) ? sourceIds.filter(Boolean) : (sourceIds ? [sourceIds] : [])
  if (!ids.length) return {}
  const { rows } = await query(
    `SELECT source_id, tags, created_at FROM curated_questions
      WHERE source_type = $1 AND source_id = ANY($2::uuid[])`,
    [sourceType, ids]
  )
  const map = {}
  for (const r of rows) map[r.source_id] = { curated: true, tags: r.tags, createdAt: r.created_at }
  return map
}

/** 自动打标：只用客观数据，判不了返回空数组。 */
async function deriveAutoTags(sourceType, sourceId) {
  const tags = []
  if (sourceType === SOURCE.QUESTION) {
    // 难度：difficulty 是 smallint，questions 表全量有值
    const d = await query('SELECT difficulty FROM questions WHERE id = $1', [sourceId])
    const difficulty = Number(d.rows[0]?.difficulty)
    if (Number.isFinite(difficulty) && difficulty >= 4) tags.push('高难')

    // 错次：同一题可能有多条错题记录（多个学生），取最大错次
    const w = await query(
      'SELECT MAX(error_count) AS max_ec FROM wrong_questions WHERE question_id = $1',
      [sourceId]
    )
    const maxEc = Number(w.rows[0]?.max_ec)
    if (Number.isFinite(maxEc) && maxEc >= 2) tags.push('易错')
  } else {
    // 试卷题：继承老师加题时在试卷题库打的标签
    const r = await query('SELECT tags FROM resource_questions WHERE id = $1', [sourceId])
    const raw = r.rows[0]?.tags
    if (Array.isArray(raw)) tags.push(...raw.filter(Boolean))
  }
  return [...new Set(tags)]
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map(t => String(t).trim()).filter(Boolean))].slice(0, 10)
}

function normalizeRow(r, sourceType) {
  const isQuestion = sourceType === SOURCE.QUESTION
  return {
    id: r.curated_id,
    sourceType,
    sourceId: r.source_id,
    tags: r.tags || [],
    chapterIds: r.chapter_ids || [],
    note: r.note || '',
    createdAt: r.created_at,
    content: r.content || '',
    parentStem: r.parent_stem || '',
    options: r.options || [],
    questionType: r.question_type || 'answer',
    answer: r.answer || '',
    analysis: r.analysis || '',
    difficulty: r.difficulty == null ? null : Number(r.difficulty),
    subject: r.subject || '数学',
    // 配图走原表 URL，不复制图片本身。
    // ⛔ 必须用裁片 image_url（白底、已去背景），不能用 page_image_url（整页截图，
    //    含黑底/人像/板书重影）—— 试卷题库 paperBankService.js:2303 事故同源。
    imageUrl: isQuestion
      ? (r.geometry_image_url || r.image_url || '')
      : (r.image_url || ''),
    resourceName: r.resource_name || '',
  }
}

function tagStats(list) {
  const m = {}
  for (const item of list) for (const t of item.tags) m[t] = (m[t] || 0) + 1
  return Object.entries(m)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}
