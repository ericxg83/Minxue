import { query, TABLES } from '../config/neon.js'
import { buildWrongQuestionIdentityKey } from '../utils/stemNormalize.js'
import { listStudentIdsByGrade } from './teachingSuggestionsService.js'

/**
 * 周末讲题错题卷数据服务（wrongPaperService）
 *
 * 唯一所有者：错题卷视图数据（wrong-paper 接口 + 导出接口共用）。
 * 数据来源：wrong_questions + questions + students（只读）。
 *
 * 题身份键：与 src/domain/questionIdentity.js 同口径，由 buildWrongQuestionIdentityKey 生成。
 * 禁止相似度合并。
 */

const MAX_ITEMS_DEFAULT = 50

/**
 * 按年级聚合错题（按"具体题"维度，学生数口径错误率）。
 *
 * @param {Object} args
 * @param {string} args.grade 年级
 * @param {Date} args.periodStart
 * @param {Date} args.periodEnd
 * @param {string} [args.subject]
 * @param {number} [args.maxItems] 限制返回条数，默认 50
 * @returns {Promise<{totalStudentCount:number, wrongStudentCount:number, items:Array}>}
 */
export async function aggregateWrongPaper({ grade, periodStart, periodEnd, subject = '', maxItems = MAX_ITEMS_DEFAULT }) {
  const studentIds = await listStudentIdsByGrade(grade)
  if (studentIds.length === 0) {
    return { totalStudentCount: 0, wrongStudentCount: 0, items: [] }
  }

  const params = [studentIds, periodStart, periodEnd]
  const studentList = `$${1}::uuid[]`
  let subjectClause = ''
  if (subject) {
    params.push(subject)
    subjectClause = ` AND q.subject = $${params.length}`
  }

  const { rows } = await query(
    `SELECT
      wq.id, wq.student_id, wq.question_id,
      wq.worksheet_id, wq.page_number, wq.question_no,
      wq.content AS wq_content,
      q.content AS q_content,
      q.answer AS correct_answer,
      q.options,
      q.question_type,
      q.subject AS q_subject,
      q.ai_tags,
      wq.student_answer,
      wq.is_blank,
      wq.error_type,
      wq.error_reason,
      wq.lifecycle_status,
      wq.error_count,
      wq.added_at,
      COALESCE(s.name, '未知学生') AS student_name
    FROM ${TABLES.WRONG_QUESTIONS} wq
    LEFT JOIN ${TABLES.QUESTIONS} q ON q.id = wq.question_id
    LEFT JOIN ${TABLES.STUDENTS} s ON s.id = wq.student_id
    WHERE wq.student_id = ANY(${studentList})
      AND wq.added_at >= $2 AND wq.added_at < $3
      AND COALESCE(wq.lifecycle_status, 'new') != 'mastered'
      ${subjectClause}
    ORDER BY wq.added_at DESC`,
    params
  )

  if (rows.length === 0) {
    return { totalStudentCount: studentIds.length, wrongStudentCount: 0, items: [] }
  }

  const totalStudentCount = studentIds.length

  // 按身份键分桶
  const buckets = new Map()
  for (const r of rows) {
    const record = {
      question_id: r.question_id,
      worksheet_id: r.worksheet_id,
      question_no: r.question_no,
      page_number: r.page_number,
      content: r.q_content || r.wq_content || '',
    }
    const key = buildWrongQuestionIdentityKey(record)
    if (!key) continue

    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        identityKey: key,
        questionId: r.question_id || null,
        content: r.q_content || r.wq_content || '',
        correctAnswer: r.correct_answer || '',
        questionType: r.question_type || '',
        subject: r.q_subject || '',
        knowledgeTags: parseTags(r.ai_tags),
        wrongCount: 0,
        studentSet: new Set(),
        errorTypeCount: new Map(),
        sampleRows: [],
        involvedStudentsMap: new Map(),
        lastAddedAt: r.added_at,
      }
      buckets.set(key, bucket)
    }

    bucket.wrongCount += 1
    bucket.studentSet.add(r.student_id)

    if (!r.is_blank) {
      const et = r.error_type || '未标注'
      bucket.errorTypeCount.set(et, (bucket.errorTypeCount.get(et) || 0) + 1)
    }

    const existing = bucket.involvedStudentsMap.get(r.student_id)
    if (existing) {
      existing.wrongTimes += 1
      existing.errorTypes.add(r.error_type || (r.is_blank ? '空题' : '未标注'))
    } else {
      bucket.involvedStudentsMap.set(r.student_id, {
        id: r.student_id,
        name: r.student_name,
        wrongTimes: 1,
        errorTypes: new Set([r.error_type || (r.is_blank ? '空题' : '未标注')]),
        isBlank: !!r.is_blank,
      })
    }

    if (bucket.sampleRows.length < 3) {
      bucket.sampleRows.push({
        studentId: r.student_id,
        studentName: r.student_name,
        studentAnswer: r.student_answer,
        correctAnswer: r.correct_answer,
        errorType: r.error_type,
        errorReason: r.error_reason,
        isBlank: !!r.is_blank,
      })
    }

    // 跟踪最近时间
    if (r.added_at && (!bucket.lastAddedAt || r.added_at > bucket.lastAddedAt)) {
      bucket.lastAddedAt = r.added_at
    }
  }

  // 组装 items
  const items = []
  for (const bucket of buckets.values()) {
    const studentCount = bucket.studentSet.size
    const errorRate = totalStudentCount > 0
      ? Math.round((studentCount / totalStudentCount) * 100)
      : 0

    const totalErrors = Array.from(bucket.errorTypeCount.values()).reduce((s, n) => s + n, 0)
    const errorDistribution = Array.from(bucket.errorTypeCount.entries())
      .map(([errorType, count]) => ({
        errorType,
        count,
        ratio: totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    const sample = pickSample(bucket.sampleRows)

    const involvedStudents = Array.from(bucket.involvedStudentsMap.values())
      .map(s => ({
        id: s.id,
        name: s.name,
        wrongTimes: s.wrongTimes,
        errorTypes: Array.from(s.errorTypes),
      }))
      .sort((a, b) => b.wrongTimes - a.wrongTimes || a.name.localeCompare(b.name))

    items.push({
      identityKey: bucket.identityKey,
      questionId: bucket.questionId,
      content: bucket.content || '(题干缺失)',
      correctAnswer: bucket.correctAnswer,
      questionType: bucket.questionType,
      subject: bucket.subject,
      knowledgeTags: bucket.knowledgeTags,
      wrongCount: bucket.wrongCount,
      studentCount,
      errorRate,
      errorDistribution,
      involvedStudents,
      sample,
    })
  }

  items.sort((a, b) =>
    b.errorRate - a.errorRate ||
    b.studentCount - a.studentCount ||
    b.wrongCount - a.wrongCount
  )

  // 限制返回条数（讲义场景题量过大会变成大文件）
  const limited = items.slice(0, maxItems)

  return {
    totalStudentCount,
    wrongStudentCount: new Set(rows.map(r => r.student_id)).size,
    items: limited,
  }
}

/**
 * 样题挑选：优先"已标注错因的做错" → "做错" → "空题"
 */
function pickSample(rows) {
  if (!rows || rows.length === 0) return null
  const wrongWithReason = rows.find(r => !r.isBlank && r.errorType)
  if (wrongWithReason) return wrongWithReason
  const wrongAny = rows.find(r => !r.isBlank)
  if (wrongAny) return wrongAny
  return rows[0]
}

function parseTags(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }
  return []
}