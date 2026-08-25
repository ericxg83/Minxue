import { Router } from 'express'
import { query } from '../config/neon.js'

const router = Router()
const DEFAULT_USER = 'default-user'
const userOrDefault = (req) => (req.query.userId || req.body?.userId || req.headers['x-user-id'] || DEFAULT_USER).toString().trim()
const subject = '数学'
const DEFAULT_DAYS = 14

function normalizeTags(value) {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, 12) : []
}

function autoName(knowledgeName, questionType) {
  const label = { choice: '选择题方法辨析', fill: '填空题关键结论', judge: '判断题条件辨析', answer: '综合解答与建模' }[questionType] || questionType || '综合题'
  return `${knowledgeName} · ${label}`
}

function autoTeachingNotes(knowledgeName, errorReason) {
  const reason = errorReason ? `重点回应学生常见问题：${errorReason}。` : '先让学生说出已知条件和目标，再通过一题示范完整推理链。'
  return `先回顾「${knowledgeName}」的核心条件与方法，再用代表题带学生拆解：识别条件 → 选择方法 → 写出关键步骤 → 回代或检验。${reason}`
}

async function getTypeDetail(id, userId) {
  const { rows } = await query(
    `SELECT t.*, kp.name AS knowledge_name,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', e.id, 'sourceQuestionId', e.source_question_id, 'sourceWrongQuestionId', e.source_wrong_question_id,
        'snapshot', e.snapshot, 'note', e.note, 'sortOrder', e.sort_order, 'createdAt', e.created_at
      ) ORDER BY e.sort_order, e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::jsonb) AS examples
     FROM teaching_question_types t
     JOIN knowledge_points kp ON kp.id = t.kp_id
     LEFT JOIN teaching_question_type_examples e ON e.type_id = t.id
     WHERE t.id = $1 AND t.user_id = $2
     GROUP BY t.id, kp.name`, [id, userId])
  return rows[0] || null
}

async function getAutoGroups(days = DEFAULT_DAYS) {
  const { rows } = await query(
    `SELECT kp.id AS kp_id, kp.name AS knowledge_name, q.question_type,
      COUNT(*)::int AS wrong_count, COUNT(DISTINCT wq.student_id)::int AS student_count,
      (array_agg(wq.id ORDER BY wq.added_at DESC))[1] AS wrong_question_id,
      (array_agg(q.id ORDER BY wq.added_at DESC))[1] AS question_id,
      (array_agg(COALESCE(NULLIF(wq.error_reason, ''), NULLIF(wq.error_type, '')) ORDER BY wq.added_at DESC))[1] AS error_reason,
      (array_agg(jsonb_build_object(
        'content', q.content, 'options', q.options, 'answer', q.answer, 'analysis', q.analysis,
        'questionType', q.question_type, 'subject', q.subject, 'imageUrl', q.image_url,
        'studentAnswer', wq.student_answer, 'errorReason', wq.error_reason
      ) ORDER BY wq.added_at DESC))[1] AS snapshot
     FROM wrong_questions wq
     JOIN questions q ON q.id = wq.question_id AND q.is_complete = TRUE
     JOIN question_knowledge qk ON qk.question_id = q.id AND qk.role = 'primary'
     JOIN knowledge_points kp ON kp.id = qk.kp_id AND kp.subject = $1
     WHERE wq.added_at >= now() - ($2::int * interval '1 day')
     GROUP BY kp.id, kp.name, q.question_type
     HAVING COUNT(*) >= 1
     ORDER BY wrong_count DESC, student_count DESC
     LIMIT 30`, [subject, days])
  return rows.map(row => ({ ...row, name: autoName(row.knowledge_name, row.question_type) }))
}

async function createAutoType(userId, group, status = 'draft') {
  const summary = { wrongCount: group.wrong_count, studentCount: group.student_count, days: DEFAULT_DAYS, generatedAt: new Date().toISOString() }
  const { rows } = await query(
    `INSERT INTO teaching_question_types (user_id, kp_id, subject, name, teaching_notes, common_mistakes, tags, status, source, auto_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'auto', $9::jsonb)
     ON CONFLICT (user_id, kp_id, name) DO UPDATE SET
       auto_summary = EXCLUDED.auto_summary,
       status = CASE WHEN teaching_question_types.status = 'archived' THEN 'draft' ELSE teaching_question_types.status END,
       updated_at = now()
     RETURNING id`,
    [userId, group.kp_id, subject, group.name, autoTeachingNotes(group.knowledge_name, group.error_reason), group.error_reason || '', JSON.stringify(['自动整理', '近期错题']), status, JSON.stringify(summary)])
  const typeId = rows[0]?.id
  if (!typeId) {
    const existing = await query(`SELECT id FROM teaching_question_types WHERE user_id = $1 AND kp_id = $2 AND name = $3`, [userId, group.kp_id, group.name])
    return existing.rows[0]?.id || null
  }
  await query(
    `INSERT INTO teaching_question_type_examples (type_id, source_question_id, source_wrong_question_id, snapshot, note)
     SELECT $1, $2, $3, $4::jsonb, '系统从近期错题自动选取的代表题'
     WHERE NOT EXISTS (SELECT 1 FROM teaching_question_type_examples WHERE type_id = $1 AND source_wrong_question_id = $3)`,
    [typeId, group.question_id, group.wrong_question_id, JSON.stringify(group.snapshot)])
  return typeId
}

router.get('/', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const kpId = String(req.query.kpId || '')
    const keyword = String(req.query.keyword || '').trim()
    const mode = String(req.query.mode || 'all')
    const params = [userId, subject]
    const clauses = ['t.user_id = $1', 't.subject = $2', "t.status <> 'archived'"]
    if (mode === 'recommended') clauses.push("t.status = 'draft' AND t.source = 'auto'")
    if (mode === 'library') clauses.push("t.status = 'active'")
    if (kpId) { params.push(kpId); clauses.push(`t.kp_id = $${params.length}`) }
    if (keyword) { params.push(`%${keyword}%`); clauses.push(`(t.name ILIKE $${params.length} OR t.teaching_notes ILIKE $${params.length})`) }
    const { rows } = await query(
      `SELECT t.id, t.kp_id, t.name, t.teaching_notes, t.common_mistakes, t.tags, t.status, t.source, t.auto_summary, t.updated_at,
              kp.name AS knowledge_name, COUNT(e.id)::int AS example_count
       FROM teaching_question_types t
       JOIN knowledge_points kp ON kp.id = t.kp_id
       LEFT JOIN teaching_question_type_examples e ON e.type_id = t.id
       WHERE ${clauses.join(' AND ')}
       GROUP BY t.id, kp.name
       ORDER BY CASE WHEN t.status = 'draft' THEN 0 ELSE 1 END, MIN(kp.sort_order), t.sort_order, t.updated_at DESC`, params)
    res.json({ success: true, types: rows })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/summary', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const { rows } = await query(
      `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS type_count,
        COUNT(DISTINCT kp_id) FILTER (WHERE status = 'active')::int AS knowledge_count,
        COUNT(*) FILTER (WHERE status = 'draft' AND source = 'auto')::int AS recommendation_count,
        COUNT(*) FILTER (WHERE updated_at >= date_trunc('week', now()))::int AS updated_this_week
       FROM teaching_question_types WHERE user_id = $1 AND subject = $2 AND status <> 'archived'`, [userId, subject])
    res.json({ success: true, summary: rows[0] })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.post('/auto-organize', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const days = Math.min(Math.max(Number(req.body?.days) || DEFAULT_DAYS, 7), 90)
    const groups = await getAutoGroups(days)
    const typeIds = []
    for (const group of groups) {
      const id = await createAutoType(userId, group, 'draft')
      if (id) typeIds.push(id)
    }
    res.json({ success: true, generated: typeIds.length, periodDays: days, message: typeIds.length ? `已整理 ${typeIds.length} 个待确认题型` : '近期没有可自动整理的已关联错题' })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.post('/auto-handout', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const limit = Math.min(Math.max(Number(req.body?.limit) || 8, 1), 16)
    const { rows } = await query(
      `SELECT id FROM teaching_question_types
       WHERE user_id = $1 AND subject = $2 AND status IN ('draft', 'active')
       ORDER BY CASE WHEN status = 'draft' THEN 0 ELSE 1 END, (auto_summary->>'wrongCount')::int DESC NULLS LAST, updated_at DESC
       LIMIT $3`, [userId, subject, limit])
    const types = []
    for (const row of rows) { const type = await getTypeDetail(row.id, userId); if (type) types.push(type) }
    if (!types.length) return res.json({ success: true, handout: null, message: '先自动整理近期错题，才能生成周末讲义初稿' })
    const pages = [{ name: 'cover', blocks: [{ type: 'cover-title', content: '本周数学周末课讲义' }, { type: 'cover-subtitle', content: '来源：近期错题自动整理' }, { type: 'cover-info', content: `已选 ${types.length} 个高频题型` }, { type: 'cover-date', content: `生成日期：${new Date().toLocaleDateString('zh-CN')}` }] }, { name: 'toc', blocks: [{ type: 'section', content: '目录' }] }]
    const byKnowledge = new Map()
    for (const type of types) { if (!byKnowledge.has(type.knowledge_name)) byKnowledge.set(type.knowledge_name, []); byKnowledge.get(type.knowledge_name).push(type) }
    for (const [knowledgeName, entries] of byKnowledge) {
      const blocks = [{ type: 'kp-section', content: knowledgeName }, { type: 'kp-key-points', content: ['先回顾知识点的条件、定义与核心方法。'] }]
      for (const type of entries) {
        blocks.push({ type: 'type-section', content: type.name, sourceTypeId: type.id, knowledgePointId: type.kp_id })
        if (type.teaching_notes) blocks.push({ type: 'lecture-guidance', content: type.teaching_notes })
        if (type.common_mistakes) blocks.push({ type: 'error-cause', content: type.common_mistakes })
        for (const example of type.examples || []) {
          const snapshot = example.snapshot || {}
          blocks.push({ type: 'question', content: snapshot.content || '题目内容不可用', options: snapshot.options || [], questionType: snapshot.questionType || '代表题', imageUrls: [snapshot.imageUrl].filter(Boolean), sourceTypeId: type.id, sourceExampleId: example.id })
          if (snapshot.answer) blocks.push({ type: 'answer', content: '课堂作答后揭晓', correctAnswer: snapshot.answer })
          if (snapshot.analysis) blocks.push({ type: 'analysis', content: snapshot.analysis })
        }
        pages[1].blocks.push({ type: 'toc-item', content: `${knowledgeName} · ${type.name}`, sub: true })
      }
      pages.push({ name: `${knowledgeName} · 本周重点`, blocks })
    }
    res.json({ success: true, handout: { title: '本周数学周末课讲义', subject, periodText: `近 ${DEFAULT_DAYS} 天自动整理`, template: 'lecture_prep', pages, baseDiagnosis: [], generatedAt: new Date().toISOString() } })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.post('/:id/confirm', async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE teaching_question_types SET status = 'active', updated_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, userOrDefault(req)])
    if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' })
    res.json({ success: true })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.post('/:id/ignore', async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE teaching_question_types SET status = 'archived', updated_at = now() WHERE id = $1 AND user_id = $2 AND source = 'auto'`, [req.params.id, userOrDefault(req)])
    if (!rowCount) return res.status(404).json({ success: false, error: '自动建议不存在' })
    res.json({ success: true })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/candidates', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const groups = await getAutoGroups(DEFAULT_DAYS)
    const types = await Promise.all(groups.map(async group => ({ ...group, existing: await query(`SELECT id FROM teaching_question_types WHERE user_id = $1 AND kp_id = $2 AND name = $3 AND status <> 'archived'`, [userId, group.kp_id, group.name]) })))
    res.json({ success: true, candidates: types.filter(item => item.existing.rows.length === 0).map(({ existing, ...item }) => item) })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/:id', async (req, res) => { try { const type = await getTypeDetail(req.params.id, userOrDefault(req)); if (!type) return res.status(404).json({ success: false, error: '题型不存在' }); res.json({ success: true, type }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.post('/', async (req, res) => { try { const userId = userOrDefault(req); const { kpId, name, teachingNotes = '', commonMistakes = '', tags = [], status = 'active' } = req.body || {}; if (!kpId || !String(name || '').trim()) return res.status(400).json({ success: false, error: '知识点和题型名称必填' }); const { rows } = await query(`INSERT INTO teaching_question_types (user_id, kp_id, subject, name, teaching_notes, common_mistakes, tags, status) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING id`, [userId, kpId, subject, String(name).trim(), String(teachingNotes), String(commonMistakes), JSON.stringify(normalizeTags(tags)), status]); res.status(201).json({ success: true, type: await getTypeDetail(rows[0].id, userId) }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.put('/:id', async (req, res) => { try { const userId = userOrDefault(req); const { name, teachingNotes, commonMistakes, tags, status, kpId } = req.body || {}; const { rowCount } = await query(`UPDATE teaching_question_types SET name = COALESCE($1, name), kp_id = COALESCE($2, kp_id), teaching_notes = COALESCE($3, teaching_notes), common_mistakes = COALESCE($4, common_mistakes), tags = COALESCE($5::jsonb, tags), status = COALESCE($6, status), updated_at = now() WHERE id = $7 AND user_id = $8`, [name == null ? null : String(name).trim(), kpId || null, teachingNotes == null ? null : String(teachingNotes), commonMistakes == null ? null : String(commonMistakes), tags === undefined ? null : JSON.stringify(normalizeTags(tags)), status || null, req.params.id, userId]); if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' }); res.json({ success: true, type: await getTypeDetail(req.params.id, userId) }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.post('/:id/examples', async (req, res) => { try { const userId = userOrDefault(req); const type = await getTypeDetail(req.params.id, userId); if (!type) return res.status(404).json({ success: false, error: '题型不存在' }); const { sourceQuestionId = null, sourceWrongQuestionId = null, snapshot, note = '' } = req.body || {}; if ((!sourceQuestionId && !sourceWrongQuestionId) || !snapshot) return res.status(400).json({ success: false, error: '代表题来源和快照必填' }); await query(`INSERT INTO teaching_question_type_examples (type_id, source_question_id, source_wrong_question_id, snapshot, note) VALUES ($1, $2, $3, $4::jsonb, $5)`, [req.params.id, sourceQuestionId, sourceWrongQuestionId, JSON.stringify(snapshot), String(note)]); res.status(201).json({ success: true, type: await getTypeDetail(req.params.id, userId) }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })
router.delete('/:id', async (req, res) => { try { const { rowCount } = await query(`UPDATE teaching_question_types SET status = 'archived', updated_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, userOrDefault(req)]); if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' }); res.json({ success: true }) } catch (error) { res.status(500).json({ success: false, error: error.message }) } })

export default router
