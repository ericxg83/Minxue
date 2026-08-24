import { Router } from 'express'
import { query } from '../config/neon.js'

const router = Router()
const DEFAULT_USER = 'default-user'
const userOrDefault = (req) => (req.query.userId || req.body?.userId || req.headers['x-user-id'] || DEFAULT_USER).toString().trim()
const subject = '数学'

function normalizeTags(value) {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, 12) : []
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

router.get('/', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const kpId = String(req.query.kpId || '')
    const keyword = String(req.query.keyword || '').trim()
    const params = [userId, subject]
    const clauses = ['t.user_id = $1', 't.subject = $2', "t.status <> 'archived'"]
    if (kpId) { params.push(kpId); clauses.push(`t.kp_id = $${params.length}`) }
    if (keyword) { params.push(`%${keyword}%`); clauses.push(`(t.name ILIKE $${params.length} OR t.teaching_notes ILIKE $${params.length})`) }
    const { rows } = await query(
      `SELECT t.id, t.kp_id, t.name, t.teaching_notes, t.common_mistakes, t.tags, t.status, t.updated_at,
              kp.name AS knowledge_name, COUNT(e.id)::int AS example_count
       FROM teaching_question_types t
       JOIN knowledge_points kp ON kp.id = t.kp_id
       LEFT JOIN teaching_question_type_examples e ON e.type_id = t.id
       WHERE ${clauses.join(' AND ')}
       GROUP BY t.id, kp.name
       ORDER BY kp.sort_order, t.sort_order, t.updated_at DESC`, params)
    res.json({ success: true, types: rows })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/summary', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const { rows } = await query(
      `SELECT COUNT(*)::int AS type_count, COUNT(DISTINCT kp_id)::int AS knowledge_count,
        COUNT(*) FILTER (WHERE updated_at >= date_trunc('week', now()))::int AS updated_this_week
       FROM teaching_question_types WHERE user_id = $1 AND subject = $2 AND status <> 'archived'`, [userId, subject])
    res.json({ success: true, summary: rows[0] })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/candidates', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const { rows } = await query(
      `SELECT kp.id AS kp_id, kp.name AS knowledge_name, COALESCE(NULLIF(q.question_type, ''), '综合题') AS source_type,
        COUNT(*)::int AS wrong_count, COUNT(DISTINCT wq.student_id)::int AS student_count,
        (array_agg(wq.id ORDER BY wq.added_at DESC))[1] AS wrong_question_id,
        (array_agg(q.id ORDER BY wq.added_at DESC))[1] AS question_id,
        (array_agg(jsonb_build_object(
          'content', q.content, 'options', q.options, 'answer', q.answer, 'analysis', q.analysis,
          'questionType', q.question_type, 'subject', q.subject, 'imageUrl', q.image_url,
          'studentAnswer', wq.student_answer, 'errorReason', wq.error_reason
        ) ORDER BY wq.added_at DESC))[1] AS snapshot
       FROM wrong_questions wq
       JOIN questions q ON q.id = wq.question_id AND q.is_complete = TRUE
       JOIN question_knowledge qk ON qk.question_id = q.id AND qk.role = 'primary'
       JOIN knowledge_points kp ON kp.id = qk.kp_id AND kp.subject = $1
       WHERE NOT EXISTS (
         SELECT 1 FROM teaching_question_types t
         WHERE t.user_id = $2 AND t.kp_id = kp.id AND t.subject = $1
           AND t.name = concat(kp.name, ' · ', COALESCE(NULLIF(q.question_type, ''), '综合题'))
       )
       GROUP BY kp.id, kp.name, q.question_type
       ORDER BY wrong_count DESC, student_count DESC
       LIMIT 12`, [subject, userId])
    res.json({ success: true, candidates: rows })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.get('/:id', async (req, res) => {
  try {
    const type = await getTypeDetail(req.params.id, userOrDefault(req))
    if (!type) return res.status(404).json({ success: false, error: '题型不存在' })
    res.json({ success: true, type })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.post('/', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const { kpId, name, teachingNotes = '', commonMistakes = '', tags = [], status = 'active' } = req.body || {}
    if (!kpId || !String(name || '').trim()) return res.status(400).json({ success: false, error: '知识点和题型名称必填' })
    const { rows } = await query(
      `INSERT INTO teaching_question_types (user_id, kp_id, subject, name, teaching_notes, common_mistakes, tags, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING id`,
      [userId, kpId, subject, String(name).trim(), String(teachingNotes), String(commonMistakes), JSON.stringify(normalizeTags(tags)), status])
    res.status(201).json({ success: true, type: await getTypeDetail(rows[0].id, userId) })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const { name, teachingNotes, commonMistakes, tags, status, kpId } = req.body || {}
    const { rowCount } = await query(
      `UPDATE teaching_question_types SET name = COALESCE($1, name), kp_id = COALESCE($2, kp_id),
        teaching_notes = COALESCE($3, teaching_notes), common_mistakes = COALESCE($4, common_mistakes),
        tags = COALESCE($5::jsonb, tags), status = COALESCE($6, status), updated_at = now()
       WHERE id = $7 AND user_id = $8`,
      [name == null ? null : String(name).trim(), kpId || null, teachingNotes == null ? null : String(teachingNotes), commonMistakes == null ? null : String(commonMistakes), tags === undefined ? null : JSON.stringify(normalizeTags(tags)), status || null, req.params.id, userId])
    if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' })
    res.json({ success: true, type: await getTypeDetail(req.params.id, userId) })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.post('/:id/examples', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const type = await getTypeDetail(req.params.id, userId)
    if (!type) return res.status(404).json({ success: false, error: '题型不存在' })
    const { sourceQuestionId = null, sourceWrongQuestionId = null, snapshot, note = '' } = req.body || {}
    if ((!sourceQuestionId && !sourceWrongQuestionId) || !snapshot) return res.status(400).json({ success: false, error: '代表题来源和快照必填' })
    await query(`INSERT INTO teaching_question_type_examples (type_id, source_question_id, source_wrong_question_id, snapshot, note)
      VALUES ($1, $2, $3, $4::jsonb, $5)`, [req.params.id, sourceQuestionId, sourceWrongQuestionId, JSON.stringify(snapshot), String(note)])
    res.status(201).json({ success: true, type: await getTypeDetail(req.params.id, userId) })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await query(`UPDATE teaching_question_types SET status = 'archived', updated_at = now() WHERE id = $1 AND user_id = $2`, [req.params.id, userOrDefault(req)])
    if (!rowCount) return res.status(404).json({ success: false, error: '题型不存在' })
    res.json({ success: true })
  } catch (error) { res.status(500).json({ success: false, error: error.message }) }
})

export default router
