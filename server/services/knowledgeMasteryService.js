import { query, TABLES } from '../config/neon.js'
import { normalizeQuestionTags, assignQuestionKnowledge, assignQuestionsKnowledgeBulk } from './knowledgeService.js'

// ============================================================
// 知识点掌握度服务（knowledgeMasteryService）
//
// 掌握度公式（与 KNOWLEDGE_LOOP_PLAN 一致）：
//   掌握度 = 正确率 × 难度加权 + 连续正确进阶奖励 - 时间衰减
// 简化实现（phase-1，难度列尚未回填完整，暂不乘难度加权）：
//   accuracy  = correct / total * 100            // 0-100
//   streakBonus = min(consecutive_correct, 5) * 2 // 连续正确最高 +10
//   decay      = idle 超过 14 天后每 7 天 -5       // 长期不练缓慢衰减
//   mastery    = clamp(round(accuracy + streakBonus - decay), 0, 100)
//
// 统计口径：
//   - 只统计"学生已作答且能判定"的题目（answer_source='blank' / is_correct=null 不计入）
//   - 一题关联多个知识点时，每个知识点都参与统计（体现一题多知识点）
// ============================================================

const DECAY_AFTER_DAYS = 14
const DECAY_PER_WEEK = 5
const STREAK_BONUS_PER_STEP = 2
const STREAK_MAX_STEPS = 5
const HISTORY_CAP = 50

/**
 * 计算掌握度分值（纯函数，便于单测）。
 * @param {number} total 累计作答数
 * @param {number} correct 累计正确数
 * @param {number} consecutiveCorrect 当前连续正确次数
 * @param {string|Date|null} lastPracticedAt 上次练习时间
 * @returns {number} 0-100
 */
export function calculateMastery({ total, correct, consecutiveCorrect = 0, lastPracticedAt = null }) {
  if (!total || total <= 0) return 0
  const accuracy = (correct / total) * 100
  const streakBonus = Math.min(Math.max(consecutiveCorrect, 0), STREAK_MAX_STEPS) * STREAK_BONUS_PER_STEP

  let decay = 0
  if (lastPracticedAt) {
    const days = Math.max(0, (Date.now() - new Date(lastPracticedAt).getTime()) / 86400000)
    if (days > DECAY_AFTER_DAYS) {
      decay = Math.floor((days - DECAY_AFTER_DAYS) / 7) * DECAY_PER_WEEK
    }
  }

  return Math.max(0, Math.min(100, Math.round(accuracy + streakBonus - decay)))
}

/**
 * 读取学生的知识点掌握度记录（带 kp 名称/层级/父级链）。
 * @param {string} studentId
 * @param {string} [subject] 可选学科过滤
 * @returns {Promise<Array>}
 */
export async function getStudentMastery(studentId, subject = null) {
  const params = [studentId]
  let subjectClause = ''
  if (subject) {
    params.push(subject)
    subjectClause = ` AND kp.subject = $2`
  }
  const { rows } = await query(
    `SELECT km.id, km.student_id, km.kp_id, km.mastery,
            km.total_questions, km.correct_questions, km.wrong_questions,
            km.consecutive_correct, km.last_practiced_at, km.updated_at,
            kp.name, kp.level, kp.subject, kp.parent_id, kp.sort_order
     FROM ${TABLES.KNOWLEDGE_MASTERY} km
     JOIN ${TABLES.KNOWLEDGE_POINTS} kp ON kp.id = km.kp_id
     WHERE km.student_id = $1${subjectClause}
     ORDER BY km.mastery ASC, kp.level ASC, kp.sort_order ASC`,
    params
  )
  return rows
}

/**
 * 对某一道题的作答做掌握度增量更新。
 * 内部已保证：knowledge_mastery 行不存在则创建（UNIQUE(student_id, kp_id)）。
 * @param {Object} params
 * @param {string} params.studentId
 * @param {string} params.questionId
 * @param {boolean} params.isCorrect
 * @param {Array<{kp_id, role, weight}>} params.kps 该题关联的知识点
 * @returns {Promise<number>} 更新的知识点条数
 */
export async function updateMasteryForQuestion({ studentId, questionId, isCorrect, kps }) {
  if (!studentId || !questionId || !Array.isArray(kps) || kps.length === 0) return 0

  let updated = 0
  for (const kp of kps) {
    try {
      await upsertMasteryRecord(studentId, kp.kp_id, isCorrect, questionId)
      updated++
    } catch (err) {
      console.warn(`  ⚠️ [Mastery] 掌握度更新失败 kp=${String(kp.kp_id).slice(0, 8)}:`, err.message)
    }
  }
  return updated
}

async function upsertMasteryRecord(studentId, kpId, isCorrect, questionId) {
  const now = new Date().toISOString()

  const { rows } = await query(
    `SELECT * FROM ${TABLES.KNOWLEDGE_MASTERY} WHERE student_id = $1 AND kp_id = $2`,
    [studentId, kpId]
  )

  if (rows.length === 0) {
    // 首答：正确率 100/0，无连续正确加成，无衰减
    const mastery = calculateMastery({
      total: 1,
      correct: isCorrect ? 1 : 0,
      consecutiveCorrect: isCorrect ? 1 : 0,
      lastPracticedAt: null
    })
    await query(
      `INSERT INTO ${TABLES.KNOWLEDGE_MASTERY}
       (student_id, kp_id, mastery, total_questions, correct_questions, wrong_questions,
        consecutive_correct, last_practiced_at, history, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10)`,
      [
        studentId, kpId, mastery,
        isCorrect ? 1 : 0, isCorrect ? 0 : 1, isCorrect ? 1 : 0,
        now, JSON.stringify([{ date: now, isCorrect, questionId, delta: isCorrect ? 1 : 0 }]),
        now, now
      ]
    )
    return mastery
  }

  const row = rows[0]
  const total = (row.total_questions || 0) + 1
  const correct = (row.correct_questions || 0) + (isCorrect ? 1 : 0)
  const wrong = (row.wrong_questions || 0) + (isCorrect ? 0 : 1)
  const consecutive = isCorrect ? (row.consecutive_correct || 0) + 1 : 0

  let history = Array.isArray(row.history) ? row.history : []
  try { history = JSON.parse(JSON.stringify(history)) } catch { history = [] }
  history.push({ date: now, isCorrect, questionId, delta: isCorrect ? 1 : 0 })
  if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP)

  const mastery = calculateMastery({
    total,
    correct,
    consecutiveCorrect: consecutive,
    lastPracticedAt: row.last_practiced_at || null
  })

  await query(
    `UPDATE ${TABLES.KNOWLEDGE_MASTERY}
     SET mastery = $1, total_questions = $2, correct_questions = $3, wrong_questions = $4,
         consecutive_correct = $5, last_practiced_at = $6, history = $7, updated_at = NOW()
     WHERE student_id = $8 AND kp_id = $9`,
    [mastery, total, correct, wrong, consecutive, now, JSON.stringify(history), studentId, kpId]
  )
  return mastery
}

/**
 * 批量同步一道题：归一化知识点 → 写 question_knowledge → 更新各知识点掌握度。
 * 供 worker 批改管线在任务末尾调用（非阻塞语义：内部全部 try-catch，绝不影响主流程）。
 *
 * @param {Object} params
 * @param {string} params.studentId
 * @param {Array<Object>} params.questions questions 行（须含 id/content/subject/options/ai_tags/is_correct/answer_source）
 * @returns {Promise<{linked: number, mastery: number, skipped: number}>}
 */
export async function syncQuestionsKnowledgeAndMastery({ studentId, questions }) {
  const stats = { linked: 0, mastery: 0, skipped: 0 }
  if (!studentId || !Array.isArray(questions) || questions.length === 0) return stats

  // 1) 归一化（每题跑一次，纯本地匹配，无 DB IO）
  const entries = []
  for (const q of questions) {
    if (!q || !q.id) continue
    if (q.answer_source === 'blank' || q.is_correct === null || q.is_correct === undefined) {
      stats.skipped++
      continue
    }
    try {
      const normalized = await normalizeQuestionTags({
        content: q.content,
        subject: q.subject,
        options: q.options,
        aiTags: q.ai_tags,
      })
      if (normalized.kps && normalized.kps.length > 0) {
        entries.push({ questionId: q.id, kps: normalized.kps })
      }
    } catch (err) {
      console.warn(`  ⚠️ [Knowledge] 归一化失败 q=${String(q.id).slice(0, 8)}:`, err.message)
    }
  }

  // 2) 批量写 question_knowledge（1 次 DELETE + N/200 次 INSERT，N 大时显著减少 round-trip）
  if (entries.length > 0) {
    try {
      const linked = await assignQuestionsKnowledgeBulk(entries)
      stats.linked = linked
    } catch (err) {
      console.warn('  ⚠️ [Knowledge] 批量关联失败:', err.message)
    }
  }

  // 3) 更新各知识点掌握度（每题 × 每 kp 一次，公式纯计算）
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    if (!q || !q.id) continue
    if (q.answer_source === 'blank' || q.is_correct === null || q.is_correct === undefined) continue
    const entry = entries.find(e => e.questionId === q.id)
    if (!entry || !entry.kps.length) continue
    try {
      const m = await updateMasteryForQuestion({
        studentId,
        questionId: q.id,
        isCorrect: q.is_correct === true,
        kps: entry.kps,
      })
      if (m > 0) stats.mastery++
    } catch (err) {
      console.warn(`  ⚠️ [Mastery] 更新失败 q=${String(q.id).slice(0, 8)}:`, err.message)
    }
  }

  return stats
}

/**
 * 组卷重练（错题重练）批改后，按答题结果批量同步掌握度。
 * 供 /api/generated-exams/:id/grade 在 lifecycle 进阶之后调用（非阻塞）。
 *
 * @param {Object} params
 * @param {string} params.studentId
 * @param {Array<{questionId, isCorrect}>} params.results
 * @returns {Promise<{linked, mastery, skipped}>}
 */
export async function syncReviewResultsMastery({ studentId, results }) {
  if (!studentId || !Array.isArray(results) || results.length === 0) {
    return { linked: 0, mastery: 0, skipped: 0 }
  }
  const ids = results.map(r => r.questionId).filter(Boolean)
  if (ids.length === 0) return { linked: 0, mastery: 0, skipped: 0 }

  let rows = []
  try {
    const { rows: qRows } = await query(
      `SELECT id, content, subject, options, ai_tags, is_correct, answer_source
       FROM ${TABLES.QUESTIONS} WHERE id = ANY($1::uuid[])`,
      [ids]
    )
    rows = qRows
  } catch (err) {
    console.warn('  ⚠️ [Mastery] 读取组卷题目失败:', err.message)
    return { linked: 0, mastery: 0, skipped: 0 }
  }

  const resultMap = new Map(results.map(r => [r.questionId, r.isCorrect]))
  const questions = rows.map(r => ({
    ...r,
    // 以本次批改结果为准（覆盖 questions 表旧值）
    is_correct: resultMap.has(r.id) ? resultMap.get(r.id) === true : r.is_correct
  }))
  return syncQuestionsKnowledgeAndMastery({ studentId, questions })
}
