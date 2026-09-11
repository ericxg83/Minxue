import { query, TABLES } from '../config/neon.js'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const normalizeIds = (questionIds) => {
  const list = Array.isArray(questionIds) ? questionIds : [questionIds]
  // 只收合法 uuid：非法值进 ANY() 会让 PG 抛 invalid input syntax，整条 UPDATE 失败。
  return [...new Set(list.map(v => (v == null ? '' : String(v))).filter(v => UUID_RE.test(v)))]
}

/**
 * 按动态口径重算并持久化 questions.is_complete
 *
 * 背景：questions.is_complete 是 checkQuestionCompleteness() 的反范式缓存列，
 * 存在的唯一理由是让 SQL 侧能直接 `WHERE is_complete = TRUE` 过滤
 * （错题本列表、周报、讲义、学情都靠它）。但它只在建题那一刻算过一次，
 * 之后答案 / 题型 / 选项 / 配图被异步补齐时无人回写 → 长期偏旧。
 * 实测 2026-09-11：396 条已入册错题里 112 条被读口径隐藏，其中 102 条字段其实齐全。
 *
 * 因此凡是要么写入了完整性相关字段、要么依赖该列做过滤的地方，都要调这里对齐一次。
 *
 * @param {string[]|string} questionIds
 * @returns {Promise<{checked: number, updated: number}>} 实际被 UPDATE 的行数
 */
export const syncQuestionCompleteness = async (questionIds) => {
  const ids = normalizeIds(questionIds)
  if (ids.length === 0) return { checked: 0, updated: 0 }

  const { rows } = await query(
    `SELECT id, content, geometry_image_url, question_type, options, answer
     FROM ${TABLES.QUESTIONS}
     WHERE id = ANY($1)`,
    [ids]
  )
  if (rows.length === 0) return { checked: 0, updated: 0 }

  const completeIds = []
  const incompleteIds = []
  for (const row of rows) {
    // 落库列必须反映动态真值，包括「从 true 翻回 false」——
    // 老师删掉配图/清空答案后，题目应重新被错题本挡住。
    ;(checkQuestionCompleteness(row).isComplete ? completeIds : incompleteIds).push(row.id)
  }

  let updated = 0
  if (completeIds.length > 0) {
    const res = await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET is_complete = TRUE, updated_at = NOW()
       WHERE id = ANY($1) AND is_complete IS DISTINCT FROM TRUE`,
      [completeIds]
    )
    updated += res.rowCount || 0
  }
  if (incompleteIds.length > 0) {
    const res = await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET is_complete = FALSE, updated_at = NOW()
       WHERE id = ANY($1) AND is_complete IS DISTINCT FROM FALSE`,
      [incompleteIds]
    )
    updated += res.rowCount || 0
  }
  return { checked: rows.length, updated }
}

/**
 * fire-and-forget 版本：缓存列回写失败绝不能影响批改/入册主流程，
 * 失败只记日志，由一次性的 backfill 脚本兜底。
 *
 * @param {string[]|string} questionIds
 * @param {string} label 日志上下文，便于定位是哪个调用点失败的
 */
export const syncQuestionCompletenessQuietly = (questionIds, label = '') => {
  const ids = normalizeIds(questionIds)
  if (ids.length === 0) return
  Promise.resolve()
    .then(() => syncQuestionCompleteness(ids))
    .then(({ updated }) => {
      if (updated > 0) {
        console.log(`[is_complete 回写] ${label || 'sync'} 更新 ${updated} 题`)
      }
    })
    .catch(err => {
      console.error(`[is_complete 回写失败] ${label || 'sync'}:`, err?.message || err)
    })
}
