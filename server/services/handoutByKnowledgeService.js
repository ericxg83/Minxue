import { query, TABLES } from '../config/neon.js'
import { loadKnowledgePoints } from './knowledgeService.js'

// ============================================================
// 按知识点生成讲义服务（handoutByKnowledgeService）
//
// 职责：老师手动选规范知识点（如"一元一次方程"）时，从错题库拉取该知识点
// 的错题样本，供 buildHandout 组装"知识点 → 例题(错题) → 题型归纳"讲义。
// 与 from-diagnosis（错题驱动、自动聚合知识点）互补：本服务是"知识点驱动"。
//
// 纯函数（可测）：buildKpMatchWords / collectKpNodes / mapWrongRowsToSamples
// DB 查询（联调验证）：fetchWrongSamplesForKp（错题按知识点匹配词拉样）
// ============================================================

/**
 * 生成一个知识点的匹配词集合（自身 name + 同义词 + 若干变体）。
 * 用于在 ai_tags 里子串模糊匹配，提高"一元一次方程"命中"一元一次方程的解法"等变体的概率。
 * name 始终保留（用户明确选中，即便单字如"圆"）；同义词过滤过短词避免误匹配。
 * @param {Object} kp 知识树节点 { name, synonyms }
 * @returns {string[]} 去空、去重后的匹配词
 */
export function buildKpMatchWords(kp) {
  const words = new Set()
  const add = (s, minLen) => {
    const t = String(s == null ? '' : s).replace(/[\s　]+/g, '').trim()
    if (t && t.length >= minLen) words.add(t)
  }
  const name = String(kp && kp.name ? kp.name : '').replace(/[\s　]+/g, '').trim()
  if (name) words.add(name)
  if (kp && Array.isArray(kp.synonyms)) kp.synonyms.forEach(s => add(s, 2)) // 同义词至少 2 字
  return Array.from(words)
}

/**
 * 根据知识点名查知识树节点（含同义词），用于后续匹配与归一化展示。
 * @param {string} name 规范知识点名
 * @param {string} subject 学科
 * @returns {Promise<{name, synonyms}|null>}
 */
export async function collectKpNode(name, subject = '数学') {
  try {
    const list = await loadKnowledgePoints(subject)
    const hit = list.find(k => k.name === name)
    if (hit) return { name: hit.name, synonyms: hit.synonyms || [] }
    // 未精确命中也兜底为一个只有 name 的节点（保证 always 能生成）
  } catch (e) {
    console.warn(`  ⚠️ [ByKnowledge] 加载知识树失败 name=${name}: ${e.message}`)
  }
  return { name, synonyms: [] }
}

/**
 * 把一条错题库行映射为讲义样本结构（与 from-diagnosis 输出一致）。
 * @param {Object} r DB 行
 * @returns {Object} sampleQuestions 元素
 */
export function mapWrongRowsToSamples(rows) {
  return (rows || []).map(q => ({
    questionId: q.question_id,
    content: q.content,
    options: q.options,
    questionType: q.question_type || '其他',
    imageUrls: [q.image_url].filter(Boolean),
    studentAnswer: q.student_answer,
    correctAnswer: q.correct_answer,
    isBlank: q.is_blank === true,
    errorType: q.error_type,
    errorReason: q.error_reason,
    studentName: q.student_name,
  }))
}

/**
 * 按知识点匹配词从错题库拉取样本（时段 + 学科过滤，题型聚拢 + 空题优先）。
 * ai_tags 任一元素包含任一匹配词即命中（子串模糊匹配）。
 * @param {Object} args
 * @param {string[]} args.words 匹配词
 * @param {Date} args.periodStart
 * @param {Date} args.periodEnd
 * @param {string} [args.subject]
 * @param {number} [args.limit]
 * @returns {Promise<Object[]>} 错题库原始行
 */
export async function fetchWrongSamplesForKp({ words, periodStart, periodEnd, subject = '', limit = 10 }) {
  if (!Array.isArray(words) || words.length === 0) return []
  // Convert to PostgreSQL array literal: {word1,word2,word3}
  const pgArray = '{' + words.map(w => JSON.stringify(String(w))).join(',') + '}'
  const params = [pgArray, periodStart, periodEnd]
  let subjectClause = ''
  if (subject) {
    params.push(subject)
    subjectClause = ` AND q.subject = $${params.length}`
  }
  params.push(limit)
  const { rows } = await query(
    `SELECT
      wq.id, wq.question_id,
      q.content, q.options, q.answer AS correct_answer,
      q.question_type,
      q.image_url,
      wq.student_answer, wq.is_blank, wq.error_type, wq.error_reason,
      COALESCE(s.name, '未知学生') AS student_name
    FROM ${TABLES.WRONG_QUESTIONS} wq
    JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
        ) t
        CROSS JOIN unnest($1::text[]) mw
        WHERE position(mw IN t) > 0
      )
    LEFT JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
    WHERE wq.added_at >= $2 AND wq.added_at < $3${subjectClause}
    ORDER BY
      COALESCE(NULLIF(q.question_type, ''), '其他') ASC,
      (wq.is_blank IS NOT TRUE) ASC,
      wq.updated_at DESC
    LIMIT $${params.length}`,
    params
  )
  return rows
}

/**
 * 为一批指定知识点收集讲义 knowledgeSections（供 buildHandout 组装）。
 * @param {Object} args
 * @param {Array<{name, subject?}>} args.knowledge 选中的知识点
 * @param {string} [args.subject] 默认学科（知识点未指定时用）
 * @param {Date} args.periodStart
 * @param {Date} args.periodEnd
 * @param {number} [args.perKpLimit] 每个知识点最多取几道错题
 * @returns {Promise<Array<{kpName, subject, sampleQuestions}>>}
 */
export async function collectKnowledgeSections({ knowledge, subject = '数学', periodStart, periodEnd, perKpLimit = 10 }) {
  const sections = []
  for (const k of knowledge || []) {
    const kpSubject = k.subject || subject
    const node = await collectKpNode(k.name, kpSubject)
    const words = buildKpMatchWords(node)
    let samples = []
    try {
      const rows = await fetchWrongSamplesForKp({ words, periodStart, periodEnd, subject: kpSubject, limit: perKpLimit })
      samples = mapWrongRowsToSamples(rows)
    } catch (e) {
      console.warn(`  ⚠️ [ByKnowledge] 拉样失败 kp=${node.name}: ${e.message}`)
    }
    sections.push({ kpName: node.name, subject: kpSubject, sampleQuestions: samples })
  }
  return sections
}
