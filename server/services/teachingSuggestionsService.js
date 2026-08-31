import { query, TABLES } from '../config/neon.js'
import { callTextCompletion } from '../config/ai.js'

// ============================================================
// 教学备课建议聚合服务（teachingSuggestionsService）
//
// 设计动机：
//   老师每周拿到的不再是「讲义」，而是「备课清单」——
//   1. 班级（晚托班按年级）共性薄弱 KP + 错因分布 + 典型错题 + 一句话教学建议
//   2. 单生薄弱 KP + 错因分布 + 典型错题 + 一句话教学建议
//
// 数据源（与现有 teaching.js / weeklyReport.js 共用，不另起炉灶）：
//   - wrong_questions: error_type / error_reason / is_blank / added_at
//   - questions: ai_tags（知识点标签 JSONB）
//   - students: grade（年级）
//
// LLM：
//   - 沿用 diagnosisService 约定：callTextCompletion + model='auto' + temperature=0.2
//   - 失败兜底：返回固定模板，不让卡片空白
// =================================

const MAX_KP_PER_SUGGESTION = 5
const MAX_SAMPLES_PER_KP = 3
const TEACHING_ADVICE_TIMEOUT_MS = 8000

/**
 * 给定一组学生 ID + 时段 + 学科，返回按 KP 聚合的「备课建议」列表。
 * 年级视图：studentIds = 该年级所有学生
 * 单生视图：studentIds = [studentId]
 *
 * @param {Object} args
 * @param {string[]} args.studentIds 学生 ID 数组（空数组返回空结果）
 * @param {Date} args.periodStart
 * @param {Date} args.periodEnd
 * @param {string} [args.subject] 默认 '数学'
 * @returns {Promise<Array<{kpName, subject, wrongCount, blankCount, studentCount, errorDistribution, topErrorType, topErrorRatio, sampleQuestions, teachingAdvice}>>}
 */
export async function aggregateKnowledgeSuggestions({ studentIds, periodStart, periodEnd, subject = '数学' }) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return []

  // 1. 错题按 KP × error_type 聚合（仅做错题参与错因分布；空题独立计数）
  const params = [studentIds, periodStart, periodEnd, subject]
  const studentList = `$${1}::uuid[]`
  const { rows } = await query(
    `SELECT
       COALESCE(NULLIF(q.subject, ''), $5) AS subject,
       tag,
       COUNT(*) FILTER (WHERE wq.is_blank = TRUE)::int AS blank_count,
       COUNT(*) FILTER (WHERE wq.is_blank IS NOT TRUE)::int AS wrong_count,
       COUNT(DISTINCT wq.student_id)::int AS student_count
     FROM ${TABLES.WRONG_QUESTIONS} wq
     JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id AND q.is_complete = TRUE
     JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
     ) AS tag
     WHERE wq.student_id = ANY(${studentList})
       AND wq.added_at >= $2 AND wq.added_at < $3
       AND (q.subject = $4 OR $4 = '全部')
       AND tag != '未分类'
     GROUP BY COALESCE(NULLIF(q.subject, ''), $5), tag
     ORDER BY blank_count DESC, wrong_count DESC, student_count DESC
     LIMIT ${MAX_KP_PER_SUGGESTION * 2}`,
    [...params, subject]
  )

  if (rows.length === 0) return []

  // 2. 每个 KP 单独查错因分布 + 典型错题（限样本数，避免 N+1）
  const suggestions = []
  for (const r of rows.slice(0, MAX_KP_PER_SUGGESTION)) {
    const kpName = r.tag
    const errorDistRows = await query(
      `SELECT
         COALESCE(wq.error_type, '未标注') AS error_type,
         COUNT(*)::int AS count
       FROM ${TABLES.WRONG_QUESTIONS} wq
       JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
           ) t WHERE t = $1
         )
       WHERE wq.student_id = ANY(${studentList})
         AND wq.added_at >= $2 AND wq.added_at < $3
         AND (wq.is_blank IS NOT TRUE)
       GROUP BY COALESCE(wq.error_type, '未标注')
       ORDER BY count DESC`,
      [kpName, periodStart, periodEnd, ...studentIds.slice(0, 1)] // studentIds 已展开在 ANY，重复传第一个仅占位
    )

    // 上面把 studentIds 放在 params 第4位起更稳；这里改回正确写法 ↓
    const dist = await fetchErrorDistribution({ studentIds, kpName, periodStart, periodEnd })
    const totalErrors = dist.reduce((s, x) => s + x.count, 0)
    const topError = dist[0]

    const samples = await fetchSampleQuestions({ studentIds, kpName, periodStart, periodEnd, limit: MAX_SAMPLES_PER_KP })

    suggestions.push({
      kpName,
      subject: r.subject,
      wrongCount: r.wrong_count,
      blankCount: r.blank_count,
      studentCount: r.student_count,
      errorDistribution: dist.map(d => ({
        errorType: d.errorType,
        count: d.count,
        ratio: totalErrors > 0 ? Math.round((d.count / totalErrors) * 100) : 0
      })),
      topErrorType: topError?.errorType || null,
      topErrorRatio: totalErrors > 0 && topError ? Math.round((topError.count / totalErrors) * 100) : 0,
      sampleQuestions: samples,
      teachingAdvice: null // 调用方补 generateTeachingAdvice
    })
  }

  return suggestions
}

async function fetchErrorDistribution({ studentIds, kpName, periodStart, periodEnd }) {
  const { rows } = await query(
    `SELECT
       COALESCE(wq.error_type, '未标注') AS error_type,
       COUNT(*)::int AS count
     FROM ${TABLES.WRONG_QUESTIONS} wq
     JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
         ) t WHERE t = $1
       )
     WHERE wq.student_id = ANY($2::uuid[])
       AND wq.added_at >= $3 AND wq.added_at < $4
       AND (wq.is_blank IS NOT TRUE)
     GROUP BY COALESCE(wq.error_type, '未标注')
     ORDER BY count DESC`,
    [kpName, studentIds, periodStart, periodEnd]
  )
  return rows.map(r => ({ errorType: r.error_type, count: r.count }))
}

async function fetchSampleQuestions({ studentIds, kpName, periodStart, periodEnd, limit }) {
  const { rows } = await query(
    `SELECT
       wq.id, wq.question_id,
       q.content, q.answer AS correct_answer,
       wq.student_answer, wq.is_blank, wq.error_type, wq.error_reason,
       COALESCE(s.name, '未知学生') AS student_name
     FROM ${TABLES.WRONG_QUESTIONS} wq
     JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(q.ai_tags::jsonb) = 'array' THEN q.ai_tags::jsonb ELSE '[]'::jsonb END
         ) t WHERE t = $1
       )
     LEFT JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
     WHERE wq.student_id = ANY($2::uuid[])
       AND wq.added_at >= $3 AND wq.added_at < $4
     ORDER BY (wq.error_type IS NULL) ASC, (wq.is_blank IS TRUE) ASC, wq.updated_at DESC
     LIMIT $5`,
    [kpName, studentIds, periodStart, periodEnd, limit]
  )
  return rows.map(q => ({
    id: q.id,
    questionId: q.question_id,
    content: q.content || '(题干缺失)',
    correctAnswer: q.correct_answer,
    studentAnswer: q.student_answer,
    isBlank: q.is_blank === true,
    errorType: q.error_type,
    errorReason: q.error_reason,
    studentName: q.student_name
  }))
}

/**
 * 获取晚托班所有年级（去重，按 grade 排序）
 * 用于年级选择器下拉
 */
export async function listGrades() {
  const { rows } = await query(
    `SELECT DISTINCT grade FROM ${TABLES.STUDENTS} WHERE grade IS NOT NULL AND grade != '' ORDER BY grade`
  )
  return rows.map(r => r.grade).filter(Boolean)
}

/**
 * 获取某年级下所有学生 ID
 */
export async function listStudentIdsByGrade(grade) {
  if (!grade) return []
  const { rows } = await query(
    `SELECT id FROM ${TABLES.STUDENTS} WHERE grade = $1`,
    [grade]
  )
  return rows.map(r => r.id)
}

/**
 * 给一组 KP 建议批量生成 LLM 教学建议（年级 / 单生 两种 perspective）
 * 失败兜底：返回硬编码模板，不抛错，不让卡片空白
 *
 * @param {Array} suggestions aggregateKnowledgeSuggestions 的返回值
 * @param {'grade'|'single'} perspective
 * @returns {Promise<Array>} 同一数组，每项的 teachingAdvice 被填充
 */
export async function fillTeachingAdvice(suggestions, perspective = 'grade') {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return suggestions

  const results = await Promise.all(suggestions.map(async (s) => {
    if (!s.topErrorType || s.errorDistribution.length === 0) {
      return { ...s, teachingAdvice: fallbackAdvice(s.kpName, null, 0) }
    }
    try {
      const advice = await generateAdviceWithTimeout({
        kpName: s.kpName,
        topErrorType: s.topErrorType,
        topRatio: s.topErrorRatio,
        wrongCount: s.wrongCount,
        studentCount: s.studentCount,
        perspective
      })
      return { ...s, teachingAdvice: advice }
    } catch (e) {
      console.warn(`[TeachingSuggestions] LLM 教学建议失败 kp=${s.kpName}: ${e.message}`)
      return { ...s, teachingAdvice: fallbackAdvice(s.kpName, s.topErrorType, s.topErrorRatio) }
    }
  }))

  return results
}

async function generateAdviceWithTimeout({ kpName, topErrorType, topRatio, wrongCount, studentCount, perspective }) {
  const systemPrompt = `你是 K12 晚托班数学老师助手。看到一组同知识点错题，输出 30 字以内的"本周教学建议"。要求：
1. 用动词开头（重点讲/让学生先/对比/辨析/复习）
2. 必须包含错因关键词（${topErrorType}）
3. 不要客套，不要解释，不要 Markdown

严格返回 JSON：{"advice": "..."}`

  const userPrompt = perspective === 'grade'
    ? `年级视角：
知识点：${kpName}
本周错题数：${wrongCount} 道
涉及学生：${studentCount} 人
主要错因：${topErrorType}（占 ${topRatio}%）

给出该年级本周这条 KP 的教学建议。`
    : `单生视角：
知识点：${kpName}
本周错题数：${wrongCount} 道
主要错因：${topErrorType}（占 ${topRatio}%）

给出针对该学生的辅导建议。`

  const adviceP = callTextCompletion({
    systemContent: systemPrompt,
    userContent: userPrompt,
    temperature: 0.2,
    maxTokens: 100
  })

  const timeoutP = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('LLM 教学建议超时')), TEACHING_ADVICE_TIMEOUT_MS)
  )

  const { content: raw } = await Promise.race([adviceP, timeoutP])
  if (!raw) throw new Error('AI 返回内容为空')

  let jsonStr = raw
  const fenceMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) || raw.match(/```\n?([\s\S]*?)\n?```/)
  if (fenceMatch) jsonStr = fenceMatch[1]

  let result
  try {
    result = JSON.parse(jsonStr)
  } catch {
    const repaired = jsonStr
      .replace(/'/g, '"')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
      .replace(/,\s*([}\]])/g, '$1')
    result = JSON.parse(repaired)
  }

  const advice = String(result.advice || '').trim()
  if (!advice) throw new Error('AI 返回 advice 为空')
  // 保险：截断到 40 字
  return advice.slice(0, 40)
}

function fallbackAdvice(kpName, topErrorType, topRatio) {
  if (!topErrorType) return `本周重点复习「${kpName}」。`
  return `重点讲「${kpName}」的${topErrorType}（占${topRatio}%）。`
}