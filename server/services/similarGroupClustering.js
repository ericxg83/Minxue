/**
 * similarGroupClustering.js —— 疑似同类题聚类（2026-10-18）
 *
 * 方案：docs/similar-groups-方案.md
 * 口径（负责人拍板）：
 *   - A 主：字符相似粗分 —— 同学生内 normalizeStem 后编辑距离 ≤ 2 且长度差 ≤ 2
 *   - B 辅：同知识点辅助 —— 同学生内共享 question_knowledge 同一 kp 且该 kp 下错题 ≥ 2
 *
 * ⛔ 红线（AGENTS.md 第 9 条）：这是**分组快照**，绝不合并/删除/修改任何错题记录。
 * ⛔ 幂等：已出现在 pending/confirmed 组中的错题不重复入组（避免每次 scan 重复骚扰老师）。
 * ⛔ 纯函数可测：clusterContentGroups / clusterKpGroups 不连库，单测直接喂数据。
 */
import { query } from '../config/neon.js'

// ── 归一化（与 src/domain/questionIdentity.js normalizeStem 同款，展示层兜底口径）──
const LATEX_SPACE_RE = /\\(?:quad|qquad|thinspace|medspace|thickspace|enspace|hspace\s*\{[^}]*\}|[,;:!> ])/g
const PUNCT_RE = /[,;:!?\u3002\u3001\u00b7\u30fb]/g
const DOT_RE = /\./g

export const normalizeStemV2 = (raw) => {
  let s = String(raw == null ? '' : raw)
  if (!s) return ''
  s = s.normalize('NFKC')
  s = s.replace(LATEX_SPACE_RE, '')
  s = s.replace(/\s+/g, '')
  s = s.replace(PUNCT_RE, '')
  s = s.replace(DOT_RE, (match, offset, whole) => {
    const prev = whole[offset - 1]
    const next = whole[offset + 1]
    const isDigit = (c) => c >= '0' && c <= '9'
    return prev && next && isDigit(prev) && isDigit(next) ? match : ''
  })
  s = s.replace(/_{2,}/g, '_')
  s = s.replace(/[-\u2014\u2013]{2,}/g, '\u2014')
  return s.toLowerCase()
}

// Levenshtein 距离（分组候选用；不是合并判据）
export function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  let curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[b.length]
}

const MAX_GROUP_SIZE = 20
const MAX_STEM_LEN = 120 // 超长题干（多小问大题）不参与字符聚类，避免误聚

/**
 * A 主：字符相似聚类（纯函数，可单测）。
 *
 * @param {Array<{id:string, studentId:string, content:string}>} items 一条记录 = 一道错题
 * @returns {Array<{studentId, wrongIds:string[], title, reason:'content', preview:Array}>}
 */
export function clusterContentGroups(items) {
  if (!Array.isArray(items) || items.length < 2) return []

  // 按学生分组
  const byStudent = new Map()
  for (const it of items) {
    const stem = normalizeStemV2(it.content)
    if (!stem || stem.length > MAX_STEM_LEN) continue
    if (!byStudent.has(it.studentId)) byStudent.set(it.studentId, [])
    byStudent.get(it.studentId).push({ ...it, stem })
  }

  const groups = []
  for (const [, list] of byStudent) {
    if (list.length < 2) continue
    // 按长度桶（只比较长度差 ≤ 2 的候选，O(n) 摊派）
    const byLen = new Map()
    for (const it of list) {
      if (!byLen.has(it.stem.length)) byLen.set(it.stem.length, [])
      byLen.get(it.stem.length).push(it)
    }
    const lens = [...byLen.keys()].sort((a, b) => a - b)
    const used = new Set()
    for (let i = 0; i < lens.length; i++) {
      for (let j = i; j < lens.length; j++) {
        if (lens[j] - lens[i] > 2) break
        for (const a of byLen.get(lens[i])) {
          if (used.has(a.id)) continue
          for (const b of byLen.get(lens[j])) {
            if (used.has(b.id) || a.id === b.id) continue
            const d = levenshtein(a.stem, b.stem)
            if (d <= 2) {
              // 聚组：a 与 b 以及整个桶内相近的都收进来
              const groupIds = [a.id, b.id]
              used.add(a.id); used.add(b.id)
              // 再吸收同桶其余与 a 相近的
              for (const other of list) {
                if (used.has(other.id) || other.id === a.id || other.id === b.id) continue
                if (levenshtein(a.stem, other.stem) <= 2) {
                  groupIds.push(other.id)
                  used.add(other.id)
                }
              }
              if (groupIds.length >= 2) {
                const memberMap = new Map(list.map(x => [x.id, x]))
                const wrongs = groupIds.map(id => memberMap.get(id)).filter(Boolean)
                groups.push({
                  studentId: a.studentId,
                  wrongIds: groupIds,
                  title: `内容相近 ${groupIds.length} 道`,
                  reason: 'content',
                  preview: wrongs.map(w => ({ id: w.id, content: (w.content || '').slice(0, 80) })).slice(0, 5),
                })
              }
              break
            }
          }
        }
      }
    }
  }
  return groups
}

/**
 * B 辅：同知识点聚类（纯函数，可单测）。
 *
 * @param {Array<{id:string, studentId:string, kpIds:string[]}>} items 记录带题挂的知识点
 * @returns {Array<{studentId, wrongIds:string[], title, reason:'kp', preview:Array}>}
 */
export function clusterKpGroups(items, previewOf = (it) => ({})) {
  if (!Array.isArray(items) || items.length < 2) return []
  const groups = []
  const used = new Set()
  // (studentId, kpId) -> items
  const kpBuckets = new Map()
  for (const it of items) {
    for (const kp of it.kpIds || []) {
      const key = `${it.studentId}::${kp}`
      if (!kpBuckets.has(key)) kpBuckets.set(key, [])
      kpBuckets.get(key).push(it)
    }
  }
  for (const [, bucket] of kpBuckets) {
    if (bucket.length < 2) continue
    const fresh = bucket.filter(x => !used.has(x.id))
    if (fresh.length < 2) continue
    const ids = fresh.map(x => x.id)
    ids.forEach(id => used.add(id))
    groups.push({
      studentId: fresh[0].studentId,
      wrongIds: ids,
      title: `同知识点 ${ids.length} 道`,
      reason: 'kp',
      preview: fresh.map(it => ({ id: it.id, ...previewOf(it) })).slice(0, 5),
    })
  }
  return groups
}

// ── scan：全量聚类 + 幂等落库 ────────────────────────────────────────────
export async function scanSimilarGroups() {
  // 1. 拉取全部非 mastered 错题（含题面）
  const { rows } = await query(`
    SELECT wq.id, wq.student_id, wq.question_id, wq.content,
           q.content AS q_content, wq.lifecycle_status, wq.error_count
      FROM wrong_questions wq
      LEFT JOIN questions q ON q.id = wq.question_id
     WHERE COALESCE(wq.lifecycle_status, 'new') <> 'mastered'
  `)

  // 2. 已消费的错题（在 pending/confirmed 组里出现过的不再骚扰）
  const { rows: consumedRows } = await query(`
    SELECT DISTINCT jsonb_array_elements_text(wrong_ids) AS wid
      FROM similar_question_groups
     WHERE status IN ('pending', 'confirmed')
  `)
  const consumed = new Set(consumedRows.map(r => r.wid))

  // 3. 题↔知识点关联（B 辅用）
  const { rows: qkRows } = await query(`
    SELECT qk.question_id, qk.kp_id
      FROM question_knowledge qk
      JOIN questions q ON q.id = qk.question_id
  `)
  const kpByQuestion = new Map()
  for (const r of qkRows) {
    if (!kpByQuestion.has(r.question_id)) kpByQuestion.set(r.question_id, [])
    kpByQuestion.get(r.question_id).push(r.kp_id)
  }

  const items = rows
    .filter(r => !consumed.has(r.id))
    .map(r => ({
      id: r.id,
      studentId: r.student_id,
      content: r.content || r.q_content || '',
      kpIds: r.question_id ? (kpByQuestion.get(r.question_id) || []) : [],
      questionId: r.question_id,
    }))

  const contentGroups = clusterContentGroups(items)
  const kpGroups = clusterKpGroups(items)

  // 4. 落库幂等：核心分组（>=2 条）入库 pending
  let inserted = 0
  const allGroups = contentGroups.concat(kpGroups)
  for (const g of allGroups) {
    // 组内必须有 question_ids（用于将来送重练）
    const memberMap = new Map(rows.map(r => [r.id, r]))
    const gQuestionIds = g.wrongIds
      .map(id => memberMap.get(id)?.question_id)
      .filter(Boolean)
    const { rows: ins } = await query(
      `INSERT INTO similar_question_groups (student_id, status, reason, title, wrong_ids, question_ids, question_preview)
       VALUES ($1, 'pending', $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
       RETURNING id`,
      [g.studentId, g.reason, g.title, JSON.stringify(g.wrongIds), JSON.stringify(gQuestionIds), JSON.stringify(g.preview)]
    )
    inserted += ins.length
  }

  return { inserted, contentGroups: contentGroups.length, kpGroups: kpGroups.length, total: allGroups.length }
}