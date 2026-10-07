import { query } from '../config/neon.js'

// ============================================================
// 知识点前置关系服务（kp_relations）
//
// 用途：错题溯源 —— 学生错在某个知识点，往回追它的前置知识，
//       看是不是「根子在前置」而不是本题。
//
// ⛔ 口径：
//   - 只有 status='confirmed' 的关系才可直接用于「补练」，'proposed' 仅作展示建议。
//     默认查询两种都返回，但结果里带 status，调用方自行区分。
//   - 排除 archived 节点（高中/超范围），避免把学生引到不考的考点上。
//   - 有向：from 必须先掌握才能学 to。往回追 = 找 to_kp_id = 当前 的边（即前置）。
// ============================================================

// ⛔ 运行时默认只认 'confirmed'。
//   2026-10-07 实测：按课表顺序让模型生成的候选里约 1/3 讲不通
//   （「分数与整数混合运算 → 分母有理化」这种）。按「错的答案比空答案糟」，
//   默认不把它们喂进错题溯源；要看候选显式传 statuses。
const DEFAULT_STATUSES = ['confirmed']

/**
 * 批量查一组考点的「直接前置」（一层）。给薄弱点列表用，避免 N 次往返。
 * @param {string[]} kpIds
 * @param {{statuses?: string[]}} [opts]
 * @returns {Promise<Map<string, Array<{id, name, level, basis, reason}>>>}
 */
export async function getPrerequisitesForMany(kpIds, { statuses = DEFAULT_STATUSES } = {}) {
  const ids = (kpIds || []).filter(Boolean)
  if (ids.length === 0) return new Map()
  const { rows } = await query(
    `SELECT r.to_kp_id AS kp_id, f.id, f.name, f.level, r.basis, r.reason
       FROM kp_relations r
       JOIN knowledge_points f ON f.id = r.from_kp_id AND f.archived = false
      WHERE r.to_kp_id = ANY($1::uuid[])
        AND r.status = ANY($2::text[])
      ORDER BY f.level DESC, f.name`,
    [ids, statuses]
  )
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.kp_id)) m.set(r.kp_id, [])
    m.get(r.kp_id).push({ id: r.id, name: r.name, level: r.level, basis: r.basis, reason: r.reason })
  }
  return m
}

/**
 * 查某知识点的前置知识（往回追，depth 层）。
 * @param {string} kpId
 * @param {{depth?: number, statuses?: string[]}} [opts]
 * @returns {Promise<Array<{id, name, level, distance, status, basis, reason, viaId, viaName}>>}
 */
export async function getPrerequisites(kpId, { depth = 1, statuses = DEFAULT_STATUSES } = {}) {
  if (!kpId) return []
  const d = Math.min(Math.max(Number(depth) || 1, 1), 3)
  const { rows } = await query(
    `WITH RECURSIVE walk AS (
        SELECT r.from_kp_id AS id, 1 AS distance, r.status, r.basis, r.reason,
               r.to_kp_id AS via_id
          FROM kp_relations r
         WHERE r.to_kp_id = $1::uuid
           AND r.status = ANY($2::text[])
       UNION ALL
        SELECT r.from_kp_id, w.distance + 1, r.status, r.basis, r.reason, r.to_kp_id
          FROM kp_relations r
          JOIN walk w ON r.to_kp_id = w.id
         WHERE w.distance < $3::int
           AND r.status = ANY($2::text[])
     )
     SELECT DISTINCT ON (w.id)
            w.id, kp.name, kp.level, w.distance, w.status, w.basis, w.reason,
            w.via_id, via.name AS via_name
       FROM walk w
       JOIN knowledge_points kp ON kp.id = w.id AND kp.archived = false
       LEFT JOIN knowledge_points via ON via.id = w.via_id
      ORDER BY w.id, w.distance ASC`,
    [kpId, statuses, d]
  )
  return rows
}

/**
 * 查某知识点的后继知识（往前推，depth 层）。
 */
export async function getSuccessors(kpId, { depth = 1, statuses = DEFAULT_STATUSES } = {}) {
  if (!kpId) return []
  const d = Math.min(Math.max(Number(depth) || 1, 1), 3)
  const { rows } = await query(
    `WITH RECURSIVE walk AS (
        SELECT r.to_kp_id AS id, 1 AS distance, r.status, r.basis, r.reason,
               r.from_kp_id AS via_id
          FROM kp_relations r
         WHERE r.from_kp_id = $1::uuid
           AND r.status = ANY($2::text[])
       UNION ALL
        SELECT r.to_kp_id, w.distance + 1, r.status, r.basis, r.reason, r.from_kp_id
          FROM kp_relations r
          JOIN walk w ON r.from_kp_id = w.id
         WHERE w.distance < $3::int
           AND r.status = ANY($2::text[])
     )
     SELECT DISTINCT ON (w.id)
            w.id, kp.name, kp.level, w.distance, w.status, w.basis, w.reason,
            w.via_id, via.name AS via_name
       FROM walk w
       JOIN knowledge_points kp ON kp.id = w.id AND kp.archived = false
       LEFT JOIN knowledge_points via ON via.id = w.via_id
      ORDER BY w.id, w.distance ASC`,
    [kpId, statuses, d]
  )
  return rows
}

/**
 * 错题溯源：给一组知识点（通常是学生错题挂到的考点），
 * 找出它们共同的前置知识，按「被多少个错题考点依赖」排序。
 *
 * ⛔ 返回的是「建议补练的前置」，不是结论 —— 老师自己判断要不要补。
 *
 * @param {string[]} kpIds
 * @param {{depth?: number, statuses?: string[], limit?: number}} [opts]
 * @returns {Promise<Array<{id, name, level, dependentCount, sampleFrom, status, basis, reason}>>}
 */
export async function tracePrerequisites(kpIds, { depth = 1, statuses = DEFAULT_STATUSES, limit = 30 } = {}) {
  const ids = (kpIds || []).filter(Boolean)
  if (ids.length === 0) return []
  const d = Math.min(Math.max(Number(depth) || 1, 1), 3)
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 200)
  const { rows } = await query(
    `WITH RECURSIVE walk AS (
        SELECT r.from_kp_id AS id, r.to_kp_id AS from_id, 1 AS distance,
               r.status, r.basis, r.reason
          FROM kp_relations r
         WHERE r.to_kp_id = ANY($1::uuid[])
           AND r.status = ANY($2::text[])
       UNION ALL
        SELECT r.from_kp_id, w.from_id, w.distance + 1, r.status, r.basis, r.reason
          FROM kp_relations r
          JOIN walk w ON r.to_kp_id = w.id
         WHERE w.distance < $3::int
           AND r.status = ANY($2::text[])
     )
     SELECT w.id, kp.name, kp.level,
            COUNT(DISTINCT w.from_id)::int AS dependent_count,
            MIN(w.distance)::int AS distance,
            (ARRAY_AGG(DISTINCT src.name))[1] AS sample_from,
            (ARRAY_AGG(w.status))[1] AS status,
            (ARRAY_AGG(w.basis))[1] AS basis,
            (ARRAY_AGG(w.reason))[1] AS reason
       FROM walk w
       JOIN knowledge_points kp ON kp.id = w.id AND kp.archived = false
       LEFT JOIN knowledge_points src ON src.id = w.from_id
      WHERE NOT (w.id = ANY($1::uuid[]))
      GROUP BY w.id, kp.name, kp.level
      ORDER BY dependent_count DESC, distance ASC, kp.level DESC
      LIMIT $4::int`,
    [ids, statuses, d, lim]
  )
  return rows
}

/**
 * 把 proposed 的关系标成 confirmed / rejected（人工核对入口）。
 * @param {string[]} relationIds
 * @param {'confirmed'|'rejected'} status
 */
export async function reviewRelations(relationIds, status) {
  if (!Array.isArray(relationIds) || relationIds.length === 0) return 0
  if (!['confirmed', 'rejected'].includes(status)) throw new Error('status 只能是 confirmed / rejected')
  const { rowCount } = await query(
    `UPDATE kp_relations SET status = $1, updated_at = now()
      WHERE id = ANY($2::uuid[]) AND status = 'proposed'`,
    [status, relationIds]
  )
  return rowCount
}

/** 关系表统计（体检/验收用） */
export async function getRelationStats() {
  const { rows } = await query(`
    SELECT status, basis, count(*)::int AS n
      FROM kp_relations GROUP BY status, basis ORDER BY status, basis`)
  const { rows: cov } = await query(`
    SELECT
      (SELECT count(*)::int FROM knowledge_points WHERE subject='数学' AND archived=false) AS kp_total,
      (SELECT count(DISTINCT from_kp_id)::int FROM kp_relations) AS has_successor,
      (SELECT count(DISTINCT to_kp_id)::int FROM kp_relations) AS has_prerequisite`)
  return { byStatusAndBasis: rows, coverage: cov[0] || {} }
}
