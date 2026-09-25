/**
 * teachingMarks.js — 白板「讲题状态」写入接口
 * ================================================================
 * POST /api/teaching-marks
 *   Body: { grade, subject?, scopeKey?, marks: [{ anchorKey, anchorKeyAlt?,
 *           status, source?, questionId?, wqIds?, studentCount?, difficulty?,
 *           dwellSeconds?, note? }] }
 *   → { success: true, saved: N }
 *
 * ── 为什么只有写接口、没有读接口 ─────────────────────────────
 * 读侧不需要独立接口：白板的题单本来就由 `buildHandout` 产出
 * （server/lib/weekendHandout.js），那里已经按锚点聚合好了题目，
 * 顺带把 teaching_marks 读出来挂到每张 slide 上即可 —— 白板打开一次
 * 就拿到全部标记，不必再发一轮批量查询。见 weekendHandout.js 的「讲题状态」段。
 *
 * ── 边界（红线）──────────────────────────────────────────────
 * 本接口**只写 teaching_marks**，绝不触碰：
 *   - wrong_questions.lifecycle_status（掌握度，唯一写入方是 gradingFinalizer）
 *   - knowledge_mastery（知识点掌握度）
 *   - questions.review_status / is_correct（判分语义）
 * 老师标记「讲过」≠ 学生会了。
 */
import { Router } from 'express'
import { query as defaultQuery } from '../config/neon.js'

const router = Router()

const STATUSES = new Set(['new', 'done', 'rework', 'skip'])
const SOURCES = new Set(['auto', 'manual'])
const MAX_MARKS = 300

const str = (v, dft = '') => (typeof v === 'string' ? v.trim() : dft)
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** 单个 mark 归一化；非法项返回 null（整批里跳过它，不整批失败） */
export function normalizeMark(raw) {
  if (!raw || typeof raw !== 'object') return null
  const anchorKey = str(raw.anchorKey)
  if (!anchorKey) return null
  const status = str(raw.status, 'new')
  if (!STATUSES.has(status)) return null
  const source = SOURCES.has(str(raw.source)) ? str(raw.source) : 'auto'
  const wqIds = Array.isArray(raw.wqIds)
    ? raw.wqIds.map(String).filter(Boolean).slice(0, 200)
    : null
  return {
    anchorKey,
    anchorKeyAlt: str(raw.anchorKeyAlt),
    status,
    source,
    questionId: str(raw.questionId) || null,
    wqIds: wqIds && wqIds.length ? wqIds : null,
    studentCount: num(raw.studentCount),
    difficulty: num(raw.difficulty),
    dwellSeconds: num(raw.dwellSeconds),
    note: str(raw.note) || null,
  }
}

/**
 * 批量幂等 upsert。
 *
 * ── 自动判定不覆盖既有状态（关键约定）────────────────────────
 * 老师第二次打开白板会再翻一遍。若无脑覆盖，taught_at 会被不断刷成「刚刚」，
 * 那么「讲完之后学生又被做错」这个回炉信号永远不会触发。因此：
 *   source='auto' 且既有 status ≠ 'new'  → 不改状态
 *   source='manual'                      → 永远生效（含手动重置回 'new'）
 *
 * ── taught_at 何时刷新 ──────────────────────────────────────
 *   source='auto'  ：只在「首次进入已讲态」时写（既有状态不是 done/rework）
 *   source='manual'：每次都写 —— 老师长按标「已讲」= 我这次真的又讲了一遍，
 *                    需要把「讲完之后又被做错」的比较基线推到当下，否则
 *                    手动重讲后旧的错题仍会一直把这道题判成「建议回炉」。
 *
 * @param {Object} opts
 * @param {Function} [opts.runQuery] 注入查询函数。默认走连接池；
 *        探针脚本会注入一个事务 client，用**同一份 SQL** 验证语义后回滚。
 */
export async function upsertMarks({ grade, subject, scopeKey, marks, runQuery = defaultQuery }) {
  const params = []
  const tuples = []
  for (const m of marks) {
    const b = params.length
    const taughtNow = m.status === 'done' || m.status === 'rework'
    params.push(
      m.anchorKey,               // $b+1  anchor_key
      m.anchorKeyAlt || '',      // $b+2  anchor_key_alt（NOT NULL 列，缺省给空串）
      scopeKey,                  // $b+3  scope_key
      grade,                     // $b+4  grade
      subject || null,           // $b+5  subject
      m.status,                  // $b+6  status
      m.source,                  // $b+7  source
      m.questionId,              // $b+8  question_id
      m.wqIds,                   // $b+9  wq_ids
      m.studentCount,            // $b+10 student_count
      m.difficulty,              // $b+11 difficulty
      m.dwellSeconds,            // $b+12 dwell_seconds
      taughtNow,                 // $b+13 布尔：是否本次进入已讲态
    )
    tuples.push(
      `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},` +
      `$${b + 8},$${b + 9}::uuid[],$${b + 10},$${b + 11},$${b + 12},` +
      `CASE WHEN $${b + 13} THEN now() ELSE NULL END,` +
      `CASE WHEN $${b + 13} THEN 1 ELSE 0 END)`
    )
  }

  const sql = `
    INSERT INTO teaching_marks (
      anchor_key, anchor_key_alt, scope_key, grade, subject, status, source,
      question_id, wq_ids, student_count, difficulty, dwell_seconds,
      taught_at, taught_times
    ) VALUES ${tuples.join(',')}
    ON CONFLICT (anchor_key, scope_key) DO UPDATE SET
      status = CASE
        WHEN EXCLUDED.source = 'manual' THEN EXCLUDED.status
        WHEN teaching_marks.status = 'new' THEN EXCLUDED.status
        ELSE teaching_marks.status
      END,
      taught_at = CASE
        WHEN EXCLUDED.status IN ('done','rework')
             AND (EXCLUDED.source = 'manual'
                  OR teaching_marks.status NOT IN ('done','rework'))
        THEN now()
        ELSE teaching_marks.taught_at
      END,
      taught_times = teaching_marks.taught_times + CASE
        WHEN EXCLUDED.status IN ('done','rework')
             AND (EXCLUDED.source = 'manual'
                  OR teaching_marks.status NOT IN ('done','rework'))
        THEN 1 ELSE 0
      END,
      anchor_key_alt = CASE
        WHEN EXCLUDED.anchor_key_alt <> '' THEN EXCLUDED.anchor_key_alt
        ELSE teaching_marks.anchor_key_alt
      END,
      subject = COALESCE(EXCLUDED.subject, teaching_marks.subject),
      question_id = COALESCE(EXCLUDED.question_id, teaching_marks.question_id),
      wq_ids = COALESCE(EXCLUDED.wq_ids, teaching_marks.wq_ids),
      student_count = COALESCE(EXCLUDED.student_count, teaching_marks.student_count),
      difficulty = COALESCE(EXCLUDED.difficulty, teaching_marks.difficulty),
      dwell_seconds = COALESCE(EXCLUDED.dwell_seconds, teaching_marks.dwell_seconds),
      note = COALESCE(EXCLUDED.note, teaching_marks.note),
      source = CASE WHEN EXCLUDED.source = 'manual' THEN 'manual' ELSE teaching_marks.source END,
      updated_at = now()
  `
  const res = await runQuery(sql, params)
  return res.rowCount ?? marks.length
}

/**
 * 完整写入链路：参数归一化 → 幂等 upsert。
 *
 * 路由与验证探针都走这一个函数，保证「探针验过的」就是「线上跑的」。
 *
 * @param {Object} opts
 * @param {string} opts.grade
 * @param {string} [opts.subject]
 * @param {string} [opts.scopeKey] 缺省 = grade（见下方注释）
 * @param {Array}  opts.marks     原始 marks（未归一化也可，内部会归一化并跳过非法项）
 * @param {Function} [opts.runQuery]
 * @returns {Promise<{saved:number, skipped:number}>}
 */
export async function saveMarks({ grade, subject = null, scopeKey, marks: rawMarks = [], runQuery = defaultQuery }) {
  if (!Array.isArray(rawMarks) || rawMarks.length === 0) return { saved: 0, skipped: 0 }
  const marks = rawMarks.map(normalizeMark).filter(Boolean)
  if (marks.length === 0) return { saved: 0, skipped: rawMarks.length }

  // scopeKey 缺省 = grade。系统里没有班级表 / 排课表，「周末班」的实际定义就是
  // 「年级 + 手选学生姓名」，因此当前按年级隔离；将来带多个班时升级为 grade:班级 即可，
  // 不必改表结构（唯一索引是 anchor_key + scope_key）。
  const scope = String(scopeKey || '').trim() || grade
  const saved = await upsertMarks({ grade, subject, scopeKey: scope, marks, runQuery })
  return { saved, skipped: rawMarks.length - marks.length }
}

router.post('/api/teaching-marks', async (req, res) => {
  try {
    const body = req.body || {}
    const grade = str(body.grade)
    if (!grade) {
      return res.status(400).json({ success: false, error: '缺少 grade' })
    }
    const rawMarks = Array.isArray(body.marks) ? body.marks : []
    if (rawMarks.length === 0) {
      return res.json({ success: true, saved: 0 })
    }
    if (rawMarks.length > MAX_MARKS) {
      return res.status(400).json({ success: false, error: `marks 超过上限 ${MAX_MARKS}` })
    }

    const { saved, skipped } = await saveMarks({
      grade,
      subject: str(body.subject) || null,
      scopeKey: str(body.scopeKey) || undefined,
      marks: rawMarks,
    })
    res.json({ success: true, saved, skipped })
  } catch (err) {
    // 表还没建（迁移未跑）时给一句能自解释的错，别丢一个裸 500
    if (err?.code === '42P01') {
      return res.status(503).json({
        success: false,
        error: 'teaching_marks 表不存在，迁移 060 尚未应用',
      })
    }
    console.error('[teaching-marks] 写入失败:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router
