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
 * ⚠️ 取数字段必须包含 parent_stem：动态口径的引图判定看的是 parent_stem + content
 * （拆小问后「如图」只留在公共题干），漏查会把缺图题重算成完整并回写 TRUE。
 *
 * @param {string[]|string} questionIds
 * @returns {Promise<{checked: number, updated: number}>} 实际被 UPDATE 的行数
 */
export const syncQuestionCompleteness = async (questionIds) => {
  const ids = normalizeIds(questionIds)
  if (ids.length === 0) return { checked: 0, updated: 0 }

  const { rows } = await query(
    `SELECT id, content, parent_stem, geometry_image_url, question_type, options, answer
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
 * 读前自愈：把「动态口径判完整、但 is_complete 缓存陈旧」的题在**读取前**回写。
 *
 * ── 为什么要它（提案㉘，2026-10-07r215 发现 / 2026-10-10 负责人拍板修）──
 * `questions.is_complete` 只是为了让 SQL 能 `WHERE is_complete = TRUE` 而存在的
 * 反范式缓存列。周报 / 分享卡 / 讲义这条链路**从来不写它**，于是缓存可以长期偏旧：
 * r215 实测近 30 天有 141 道早已批完的题（所属90 个任务状态全是 `reviewed`）
 * 被缓存值挡住，家长看到「批改题量」少 141 题（6.0%）、正确率被**抬高**。
 * 个别学生偏差极大（陈施君 51.2% → 真实 40.4%），即给家长的数字比孩子实际掌握的好看。
 *
 * ── 为什么方向是「只增不减」──
 * 这里只挑 `is_complete IS DISTINCT FROM TRUE`（即当前为假的）行重算，
 * 所以最多把这些行**加回**可见集合，绝不会把已可见的题踢出去。
 * 反向问题（缓存为真但动态口径判残题）属另一个缺陷，不在本函数范围内，
 * 避免一个改动同时动两个方向、无法归因。
 *
 * ── 与既有自愈的关系（同一件事只准一个实现）──
 * 写侧自愈在`server/index.js:3719` 与 `server/worker.js:6235`；
 * 错题本列表的读前自愈在 `server/index.js:3770`。本函数是**周报/ 分享卡
 * 这条链路的**读前自愈，判据与回写一律走 `syncQuestionCompleteness`，不另立一套。
 *
 * ⚠️ 单次上限：命中数达到 limit 时必须在日志里说「可能还有更多」，
 *    绝不能让「只扫了 500 行」静默变成「全扫过了」。
 *
 * @param {string|null} studentId 该学生；传 null 表示不按学生限定（全班口径用）
 * @param {Date} periodStart 周期起（含）
 * @param {Date} periodEnd 周期止（不含）
 * @param {{limit?: number, label?: string}} [opts]
 * @returns {Promise<{candidates:number, updated:number, truncated:boolean}>}
 */
export const healStaleCompletenessForPeriod = async (
  studentId,
  periodStart,
  periodEnd,
  { limit = 500, label = 'period' } = {}
) => {
  const params = [periodStart, periodEnd]
  const studentFilter = studentId ? 'AND student_id = $3' : ''
  if (studentId) params.push(studentId)

  const { rows } = await query(
    `SELECT id
     FROM ${TABLES.QUESTIONS}
     WHERE created_at >= $1
       AND created_at < $2
       ${studentFilter}
       AND is_complete IS DISTINCT FROM TRUE
     LIMIT $${params.length + 1}`,
    [...params, limit]
  )

  if (rows.length === 0) return { candidates: 0, updated: 0, truncated: false }

  const { updated } = await syncQuestionCompleteness(rows.map(r => r.id))
  const truncated = rows.length >= limit
  if (updated > 0) {
    console.log(`[is_complete 读前自愈] ${label} 候选 ${rows.length} → 回写 ${updated} 题`)
  }
  if (truncated) {
    console.warn(
      `[is_complete 读前自愈] ${label} 候选已达上限 ${limit}，可能还有陈旧行未处理` +
      `（student=${studentId || '全部'}）`
    )
  }
  return { candidates: rows.length, updated, truncated }
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
