import { Router } from 'express'
import { query } from '../config/neon.js'

const router = Router()

// ============================================================
// 备课讲义 CRUD 路由（handoutLecture）
//
// 提供：
//   POST   /api/handout/lectures              新建讲义
//   GET    /api/handout/lectures              列表（按 user/subject 过滤）
//   GET    /api/handout/lectures/:id          详情（含 notes）
//   PUT    /api/handout/lectures/:id          更新讲义（blocks 改）
//   DELETE /api/handout/lectures/:id          删除
//   PUT    /api/handout/lectures/:id/notes    更新某页笔记
//   POST   /api/handout/lectures/:id/duplicate 复制讲义
//   PUT    /api/handout/lectures/:id/lecture-script 更新 P4 提词器脚本
//   GET    /api/handout/lecture-templates     读模板元数据（按 DB；缺省回退代码层）
// ============================================================

const DEFAULT_USER = 'default-user'

const userOrDefault = (req) => (req.query.userId || req.body?.userId || req.headers['x-user-id'] || DEFAULT_USER).toString().trim()

const listWhere = (userId, subject) => {
  const conds = ['user_id = $1']
  const params = [userId]
  if (subject) {
    params.push(subject)
    conds.push(`subject = $${params.length}`)
  }
  return { sql: conds.join(' AND '), params }
}

// ── 列表 ──
router.get('/lectures', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const subject = req.query.subject ? String(req.query.subject) : null
    const search = req.query.search ? String(req.query.search).trim() : null
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200)
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0)

    const { sql: where, params } = listWhere(userId, subject)
    if (search) {
      params.push(`%${search}%`)
      params.push(`%${search}%`)
      params.push(limit)
      params.push(offset)
      const { rows } = await query(
        `SELECT id, title, subject, period_text, template, created_at, updated_at,
                jsonb_array_length(blocks) AS page_count,
                (SELECT count(*)::int FROM jsonb_array_elements(blocks) p WHERE p->>'name' NOT IN ('cover','toc')) AS kp_count
         FROM handout_lectures
         WHERE ${where} AND (title ILIKE $${params.length - 3} OR period_text ILIKE $${params.length - 2})
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      )
      return res.json({ success: true, lectures: rows })
    }
    params.push(limit); params.push(offset)
    const { rows } = await query(
      `SELECT id, title, subject, period_text, template, created_at, updated_at,
              jsonb_array_length(blocks) AS page_count,
              (SELECT count(*)::int FROM jsonb_array_elements(blocks) p WHERE p->>'name' NOT IN ('cover','toc')) AS kp_count
       FROM handout_lectures
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ success: true, lectures: rows })
  } catch (e) {
    console.error('[handoutLecture] 列表失败:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 详情（含 notes） ──
router.get('/lectures/:id', async (req, res) => {
  try {
    const { id } = req.params
    const userId = userOrDefault(req)
    const { rows } = await query(
      `SELECT id, user_id, title, subject, period_text, template, base_query, base_diagnosis,
              blocks, lecture_script, metadata, created_at, updated_at
       FROM handout_lectures WHERE id = $1 AND user_id = $2`,
      [id, userId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '讲义不存在' })
    }
    const lec = rows[0]
    // 拉笔记
    const { rows: notes } = await query(
      `SELECT page_name, content, updated_at FROM handout_lecture_notes WHERE lecture_id = $1`,
      [id]
    )
    const notesMap = {}
    for (const n of notes) notesMap[n.page_name] = n.content
    res.json({ success: true, lecture: { ...lec, notes: notesMap } })
  } catch (e) {
    console.error('[handoutLecture] 详情失败:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 新建 ──
router.post('/lectures', async (req, res) => {
  try {
    const userId = userOrDefault(req)
    const { title, subject, periodText, template, baseQuery, baseDiagnosis, blocks, notes, lectureScript, metadata } = req.body || {}
    if (!title || !Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ success: false, error: 'title 和 blocks 必填' })
    }
    const { rows } = await query(
      `INSERT INTO handout_lectures
        (user_id, title, subject, period_text, template, base_query, base_diagnosis, blocks, lecture_script, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
       RETURNING id, created_at, updated_at`,
      [
        userId,
        title,
        subject || null,
        periodText || null,
        template || 'lecture_prep',
        JSON.stringify(baseQuery || {}),
        JSON.stringify(baseDiagnosis || []),
        JSON.stringify(blocks),
        JSON.stringify(lectureScript || null),
        JSON.stringify(metadata || {}),
      ]
    )
    const newId = rows[0].id
    // 写笔记
    if (notes && typeof notes === 'object') {
      for (const [pageName, content] of Object.entries(notes)) {
        if (typeof content === 'string' && content) {
          await query(
            `INSERT INTO handout_lecture_notes (lecture_id, page_name, content)
             VALUES ($1, $2, $3)
             ON CONFLICT (lecture_id, page_name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
            [newId, pageName, content]
          )
        }
      }
    }
    res.json({ success: true, lecture: { id: newId, created_at: rows[0].created_at, updated_at: rows[0].updated_at } })
  } catch (e) {
    console.error('[handoutLecture] 新建失败:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 更新（blocks 改） ──
router.put('/lectures/:id', async (req, res) => {
  try {
    const { id } = req.params
    const userId = userOrDefault(req)
    const { title, subject, periodText, template, baseQuery, baseDiagnosis, blocks, notes, lectureScript, metadata } = req.body || {}
    if (!Array.isArray(blocks) || blocks.length === 0) {
      return res.status(400).json({ success: false, error: 'blocks 必填' })
    }
    const { rowCount } = await query(
      `UPDATE handout_lectures SET
        title = COALESCE($3, title),
        subject = COALESCE($4, subject),
        period_text = COALESCE($5, period_text),
        template = COALESCE($6, template),
        base_query = COALESCE($7::jsonb, base_query),
        base_diagnosis = COALESCE($8::jsonb, base_diagnosis),
        blocks = $9::jsonb,
        lecture_script = COALESCE($10::jsonb, lecture_script),
        metadata = COALESCE($11::jsonb, metadata),
        updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [
        id, userId,
        title || null,
        subject || null,
        periodText || null,
        template || null,
        baseQuery ? JSON.stringify(baseQuery) : null,
        baseDiagnosis ? JSON.stringify(baseDiagnosis) : null,
        JSON.stringify(blocks),
        lectureScript ? JSON.stringify(lectureScript) : null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    )
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: '讲义不存在' })
    }
    // 同步笔记
    if (notes && typeof notes === 'object') {
      for (const [pageName, content] of Object.entries(notes)) {
        if (typeof content === 'string' && content) {
          await query(
            `INSERT INTO handout_lecture_notes (lecture_id, page_name, content)
             VALUES ($1, $2, $3)
             ON CONFLICT (lecture_id, page_name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
            [id, pageName, content]
          )
        }
      }
    }
    res.json({ success: true })
  } catch (e) {
    console.error('[handoutLecture] 更新失败:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 删除 ──
router.delete('/lectures/:id', async (req, res) => {
  try {
    const { id } = req.params
    const userId = userOrDefault(req)
    const { rowCount } = await query(
      `DELETE FROM handout_lectures WHERE id = $1 AND user_id = $2`,
      [id, userId]
    )
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: '讲义不存在' })
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 笔记 upsert（按页） ──
router.put('/lectures/:id/notes', async (req, res) => {
  try {
    const { id } = req.params
    const { pageName, content } = req.body || {}
    if (!pageName || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'pageName 和 content 必填' })
    }
    // 校验讲义存在
    const { rows: exist } = await query(
      `SELECT 1 FROM handout_lectures WHERE id = $1`,
      [id]
    )
    if (exist.length === 0) {
      return res.status(404).json({ success: false, error: '讲义不存在' })
    }
    if (!content) {
      // 空内容视为删除
      await query(`DELETE FROM handout_lecture_notes WHERE lecture_id = $1 AND page_name = $2`, [id, pageName])
    } else {
      await query(
        `INSERT INTO handout_lecture_notes (lecture_id, page_name, content)
         VALUES ($1, $2, $3)
         ON CONFLICT (lecture_id, page_name) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
        [id, pageName, content]
      )
    }
    await query(`UPDATE handout_lectures SET updated_at = now() WHERE id = $1`, [id])
    res.json({ success: true, pageName, content })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 复制讲义（P3） ──
router.post('/lectures/:id/duplicate', async (req, res) => {
  try {
    const { id } = req.params
    const userId = userOrDefault(req)
    const { rows: orig } = await query(
      `SELECT user_id, title, subject, period_text, template, base_query, base_diagnosis,
              blocks, lecture_script, metadata
       FROM handout_lectures WHERE id = $1`,
      [id]
    )
    if (orig.length === 0) {
      return res.status(404).json({ success: false, error: '讲义不存在' })
    }
    if (orig[0].user_id !== userId) {
      return res.status(403).json({ success: false, error: '无权复制此讲义' })
    }
    const o = orig[0]
    const { rows: ins } = await query(
      `INSERT INTO handout_lectures
        (user_id, title, subject, period_text, template, base_query, base_diagnosis, blocks, lecture_script, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
       RETURNING id, created_at`,
      [
        userId,
        `${o.title}（副本）`,
        o.subject, o.period_text, o.template,
        JSON.stringify(o.base_query || {}),
        JSON.stringify(o.base_diagnosis || []),
        JSON.stringify(o.blocks),
        JSON.stringify(o.lecture_script),
        JSON.stringify(o.metadata || {}),
      ]
    )
    // 复制笔记
    const { rows: notes } = await query(
      `SELECT page_name, content FROM handout_lecture_notes WHERE lecture_id = $1`,
      [id]
    )
    for (const n of notes) {
      await query(
        `INSERT INTO handout_lecture_notes (lecture_id, page_name, content)
         VALUES ($1, $2, $3)`,
        [ins[0].id, n.page_name, n.content]
      )
    }
    res.json({ success: true, lecture: { id: ins[0].id, title: `${o.title}（副本）` } })
  } catch (e) {
    console.error('[handoutLecture] 复制失败:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 清理老版讲义（blocks 含禁用关键词） ──
//
// 用途：用户在升级到 P0-P4 讲义系统后，可能还残留着老版本（"变式改写 / 强化训练"）
// 保存的讲义。模板已删，本端点清掉 DB 中 blocks 含禁用关键词的讲义。
router.post('/lectures/cleanup-old-blocks', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, title, blocks FROM handout_lectures`
    )
    const FORBIDDEN = [
      '变式改写', '强化训练', '变式题与', '以下变式题', '建议独立完成',
      '同类题练习', '同考点变式', '变式练习', '举一反三', '拓展训练',
      '强化提升', '错题重练', '再做一遍', '巩固练习',
    ]
    let removedLectures = 0
    let sanitizedLectures = 0
    let removedBlocks = 0

    for (const lec of rows) {
      const blocks = lec.blocks
      if (!Array.isArray(blocks)) continue
      let changed = false
      const cleaned = blocks.map(p => {
        if (!p || !Array.isArray(p.blocks)) return p
        const before = p.blocks.length
        const kept = p.blocks.filter(b => {
          if (!b) return false
          const text = [b.content, b.title, b.subtitle].filter(Boolean).join(' ')
          const hit = FORBIDDEN.some(kw => String(text).includes(kw))
          if (hit) { changed = true; return false }
          return true
        })
        removedBlocks += before - kept.length
        return { ...p, blocks: kept }
      })
      if (!changed) continue
      // 全部页都空了 → 删除整份讲义；否则更新
      const totalBlocks = cleaned.reduce((s, p) => s + (p.blocks?.length || 0), 0)
      if (totalBlocks === 0) {
        await query(`DELETE FROM handout_lectures WHERE id = $1`, [lec.id])
        removedLectures += 1
      } else {
        await query(
          `UPDATE handout_lectures SET blocks = $2::jsonb, updated_at = now() WHERE id = $1`,
          [lec.id, JSON.stringify(cleaned)]
        )
        sanitizedLectures += 1
      }
    }
    res.json({ success: true, removedLectures, sanitizedLectures, removedBlocks })
  } catch (e) {
    console.error('[handoutLecture] 清理旧讲义失败:', e)
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── P4 提词器脚本更新 ──
router.put('/lectures/:id/lecture-script', async (req, res) => {
  try {
    const { id } = req.params
    const { lectureScript } = req.body || {}
    if (lectureScript === undefined) {
      return res.status(400).json({ success: false, error: 'lectureScript 必填（可 null）' })
    }
    const { rowCount } = await query(
      `UPDATE handout_lectures SET lecture_script = $2::jsonb, updated_at = now() WHERE id = $1`,
      [id, lectureScript === null ? null : JSON.stringify(lectureScript)]
    )
    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: '讲义不存在' })
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

// ── 模板元数据（DB 优先，缺省回退代码层） ──
router.get('/lecture-templates', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, label, description, supports_subject, enabled, sort_order
       FROM handout_lecture_templates
       WHERE enabled = true
       ORDER BY sort_order ASC, id ASC`
    )
    if (rows.length === 0) {
      // 回退到代码层
      const { listTemplates } = await import('../services/handoutTemplates/index.js')
      return res.json({ success: true, templates: listTemplates(req.query.subject) })
    }
    const subject = req.query.subject ? String(req.query.subject) : null
    const filtered = subject
      ? rows.filter(t => t.supports_subject === 'all' || t.supports_subject === subject || (t.supports_subject || '').split(',').includes(subject))
      : rows
    res.json({ success: true, templates: filtered.map(t => ({
      id: t.id, label: t.label, description: t.description, supportsSubject: t.supports_subject,
    })) })
  } catch (e) {
    res.status(500).json({ success: false, error: e.message })
  }
})

export default router
