import { createHash } from 'node:crypto'
import { query, TABLES, LIFECYCLE_STATUS, WRONG_STATUS } from '../config/neon.js'
import { addWrongQuestions, createJudgement } from './neonService.js'
import { syncQuestionsKnowledgeAndMastery, syncReviewResultsMastery } from './knowledgeMasteryService.js'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const getSettlementRows = async ({ questionIds, studentId, settlementKey }) => {
  if (!studentId || !settlementKey || questionIds.length === 0) return []

  // judgements.question_id / student_id 是 TEXT 列（见 010 迁移），
  // 按 uuid[] 转换会让 PG 报 "operator does not exist: text = uuid"，
  // 整个重判结算（POST /api/questions/:id/rejudge）直接 500。
  const { rows } = await query(
    `SELECT question_id
     FROM ${TABLES.JUDGEMENTS}
     WHERE student_id = $1
       AND question_id = ANY($2::text[])
       AND metadata->>'settlement_key' = $3`,
    [String(studentId), questionIds.map(String), settlementKey]
  )
  return rows
}

const toQuestionMap = (questions) => new Map(
  questions.filter(q => q?.id).map(q => [q.id, q])
)

const buildQuestionSettlementKey = ({ questionId, mode, fingerprint }) =>
  `${mode}:${questionId}:${fingerprint || 'default'}`

const hashRejudgeInput = ({ studentAnswer, answer, questionType, isCorrect }) =>
  createHash('sha1')
    .update(JSON.stringify({ studentAnswer, answer, questionType, isCorrect }))
    .digest('hex')

/**
 * Final settlement for an OCR/AI grading task.
 * OCR judgements remain evidence; only this method changes the durable learning state.
 */
export const finalizeGradingBatch = async ({
  taskId,
  studentId,
  questions,
  source = 'ai_answer_gen',
  settlementMode = 'initial_grading'
}) => {
  const validQuestions = Array.isArray(questions)
    ? questions.filter(q => q?.id && UUID_RE.test(q.id))
    : []

  if (!studentId || validQuestions.length === 0) {
    return { settled: 0, skipped: validQuestions.length, wrongQuestions: 0, mastery: 0 }
  }

  const settlementKey = `task:${taskId}:final`
  const existingRows = await getSettlementRows({
    questionIds: validQuestions.map(q => q.id),
    studentId,
    settlementKey
  })
  const settledIds = new Set(existingRows.map(row => row.question_id))
  const pendingQuestions = validQuestions.filter(q => !settledIds.has(q.id))

  if (pendingQuestions.length === 0) {
    return { settled: 0, skipped: validQuestions.length, wrongQuestions: 0, mastery: 0 }
  }

  const questionMap = toQuestionMap(pendingQuestions)
  const confidenceMap = new Map(pendingQuestions.map(q => [q.id, q.confidence]))
  // 判题域契约：is_correct === false（明确判错）或 answer_source='blank'（空答/不会）才入错题本。
  // 空题算"不会"等同错题，老师拍板入册；is_correct === null 的其它情况（缺参考答案/答案不唯一）
  // 仍由老师复核给结论，避免错题本混入系统噪音。
  const wrongIds = pendingQuestions
    .filter(q => (q.is_correct === false || q.answer_source === 'blank') && q.answer && q.answer.trim())
    .map(q => q.id)

  if (wrongIds.length > 0) {
    await addWrongQuestions(studentId, wrongIds, confidenceMap, questionMap)
  }

  const updateIds = pendingQuestions.filter(q => q.is_correct !== null && q.is_correct !== undefined).map(q => q.id)
  if (updateIds.length > 0) {
    const clauses = updateIds.map((_, index) =>
      `WHEN $${index * 2 + 1}::uuid THEN $${index * 2 + 2}`
    ).join(' ')
    const params = updateIds.flatMap(id => {
      const question = questionMap.get(id)
      return [id, question.is_correct === true]
    })
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET is_correct = CASE id ${clauses} END, updated_at = NOW()
       WHERE id = ANY($${params.length + 1}::uuid[])`,
      [...params, updateIds]
    )
  }

  let masteryStats = { mastery: 0 }
  try {
    masteryStats = await syncQuestionsKnowledgeAndMastery({
      studentId,
      questions: pendingQuestions
    })
  } catch (error) {
    console.error(`[GradingFinalizer] mastery sync failed task=${taskId}:`, error.message)
  }

  for (const question of pendingQuestions) {
    await createJudgement({
      questionId: question.id,
      studentId,
      source,
      confidence: question.confidence ?? null,
      isCorrect: question.is_correct ?? null,
      content: question.content ?? null,
      answer: question.answer ?? null,
      studentAnswer: question.student_answer ?? null,
      aiAnswer: question.ai_answer ?? null,
      analysis: question.analysis ?? null,
      metadata: {
        question_type: question.question_type,
        settlement_key: settlementKey,
        settlement_mode: settlementMode,
        task_id: taskId
      }
    })
  }

  return {
    settled: pendingQuestions.length,
    skipped: settledIds.size,
    wrongQuestions: wrongIds.length,
    mastery: masteryStats.mastery || 0
  }
}

/**
 * Final settlement for a deterministic rejudge.
 * The input fingerprint makes retrying the same request idempotent while allowing
 * a later rejudge after the answer data changes.
 */
export const finalizeRejudgeResult = async ({
  question,
  isCorrect,
  oldIsCorrect,
  source = 'pc_rejudge',
  manualOverride = false
}) => {
  if (!question?.id || !question.student_id) {
    return { settled: false, skipped: true }
  }

  const fingerprint = hashRejudgeInput({
    studentAnswer: question.student_answer,
    answer: question.answer,
    questionType: question.question_type,
    isCorrect
  })
  const settlementKey = buildQuestionSettlementKey({
    questionId: question.id,
    mode: 'rejudge',
    fingerprint
  })
  const existing = await getSettlementRows({
    questionIds: [question.id],
    studentId: question.student_id,
    settlementKey
  })
  if (existing.length > 0) {
    return { settled: false, skipped: true, isCorrect }
  }

  // status 必须跟着 is_correct 一起翻：GET /api/questions?status=wrong 按它筛错题，
  // 只改 is_correct 会让重判为对的题继续挂在错题筛选里。
  // 翻对时退回 'pending' 而不是 'correct'——createQuestions 对判对的题落的就是 'pending'，
  // 前端 useExamReview 用 status !== 'correct' 判"AI 判过"，写 'correct' 会造成新旧数据两种形态。
  // 'mastered' 是错题本掌握态，不在此覆盖。
  await query(
    `UPDATE ${TABLES.QUESTIONS}
     SET is_correct = $1,
         status = CASE
           WHEN status = 'mastered' THEN status
           WHEN $1 IS FALSE THEN 'wrong'
           WHEN status = 'wrong' THEN 'pending'
           ELSE status END,
         updated_at = NOW()
     WHERE id = $2`,
    [isCorrect, question.id]
  )

  let wrongQuestionAdded = false
  if ((isCorrect === false || question.answer_source === 'blank') && question.answer && question.answer.trim()) {
    const completeness = checkQuestionCompleteness(question)
    if (completeness.isComplete) {
      const added = await addWrongQuestions(
        question.student_id,
        [question.id],
        null,
        new Map([[question.id, question]]),
        { skipConfidence: manualOverride }
      )
      wrongQuestionAdded = added.length > 0
    }
  } else if (isCorrect === true) {
    // rejudge 答对 = 误判（AI 判错但学生其实答对了），从错题本移除整行
    // 与 worksheetPageService.syncWrongQuestions 行为一致。
    // 真正的「已掌握」走 finalizeGeneratedExamResults 状态机（lifecycle_status='mastered'），
    // 不是 PC rejudge 路径。
    await query(
      `DELETE FROM ${TABLES.WRONG_QUESTIONS}
       WHERE student_id = $1 AND question_id = $2`,
      [question.student_id, question.id]
    )
  }

  try {
    await syncReviewResultsMastery({
      studentId: question.student_id,
      results: [{ questionId: question.id, isCorrect }]
    })
  } catch (error) {
    console.error(`[GradingFinalizer] mastery sync failed rejudge=${question.id}:`, error.message)
  }

  await createJudgement({
    questionId: question.id,
    studentId: question.student_id,
    source,
    isCorrect,
    answer: question.answer,
    studentAnswer: question.student_answer,
    metadata: {
      oldIsCorrect,
      questionType: question.question_type,
      settlement_key: settlementKey,
      settlement_mode: 'rejudge'
    }
  })

  return { settled: true, skipped: false, isCorrect, wrongQuestionAdded }
}

/**
 * 掌握度状态机（业务规则：累计答对 2 次到达 mastered，中途答错不重置进度）
 *
 * 状态：NEW（新错题/累计答对 0 次）→ REVIEW_1（累计答对 1 次）→ MASTERED（累计答对 2 次）
 * 答对：NEW → REVIEW_1 → MASTERED；MASTERED 保持
 * 答错：NEW/REVIEW_1 保持原位（error_count+1），MASTERED 退回 REVIEW_1 重新验证
 *
 * REVIEW_2 保留为历史兼容枚举（生产库 0 条），不再被写入；
 * 遇到旧 review_2 数据时按 REVIEW_1 语义处理。
 */
const getNextLifecycle = (current, isCorrect) => {
  if (isCorrect) {
    switch (current) {
      case LIFECYCLE_STATUS.NEW:
      case LIFECYCLE_STATUS.REVIEW_2:
        return LIFECYCLE_STATUS.REVIEW_1
      case LIFECYCLE_STATUS.REVIEW_1:
        return LIFECYCLE_STATUS.MASTERED
      case LIFECYCLE_STATUS.MASTERED:
        return LIFECYCLE_STATUS.MASTERED
      default:
        return LIFECYCLE_STATUS.REVIEW_1
    }
  }
  if (current === LIFECYCLE_STATUS.MASTERED) return LIFECYCLE_STATUS.REVIEW_1
  return current
}

/**
 * Final settlement for generated retry exams.
 * Keeps the existing wrong-question lifecycle while sharing audit and mastery writes.
 */
export const finalizeGeneratedExamResults = async ({
  generatedExamId,
  studentId,
  results
}) => {
  const normalizedResults = Array.isArray(results)
    ? results.filter(r => r?.questionId && UUID_RE.test(r.questionId))
      .map(r => ({
        questionId: r.questionId,
        isCorrect: r.isCorrect === true,
        skipWrongBook: r.skipWrongBook === true
      }))
    : []

  if (!studentId || normalizedResults.length === 0) {
    return {
      total: 0,
      masteredCount: 0,
      upgradedCount: 0,
      resetCount: 0,
      lifecycleChanges: []
    }
  }

  const questionIds = [...new Set(normalizedResults.map(r => r.questionId))]
  const settlementKey = `generated_exam:${generatedExamId}:final`
  const existingSettlements = await getSettlementRows({
    questionIds,
    studentId,
    settlementKey
  })
  const settledIds = new Set(existingSettlements.map(row => row.question_id))
  const pendingResults = normalizedResults.filter(r => !settledIds.has(r.questionId))

  const { rows: existingWqRows } = await query(
    `SELECT id, question_id, lifecycle_status, error_count
     FROM ${TABLES.WRONG_QUESTIONS}
     WHERE student_id = $1 AND question_id = ANY($2::uuid[])`,
    [studentId, questionIds]
  )
  const wqByQuestionId = new Map(existingWqRows.map(row => [row.question_id, row]))

  let masteredCount = 0
  let upgradedCount = 0
  let resetCount = 0
  const lifecycleChanges = []
  const insertedRows = []
  const updatedRows = []
  const updateQuestionIds = []
  const updateQuestionValues = []

  for (const result of pendingResults) {
    const existing = wqByQuestionId.get(result.questionId)
    const currentLifecycle = existing?.lifecycle_status || LIFECYCLE_STATUS.NEW
    const skipWrongBook = result.skipWrongBook && !result.isCorrect

    if (!skipWrongBook) {
      const nextLifecycle = getNextLifecycle(currentLifecycle, result.isCorrect)
      let errorCountDelta = 0

      if (result.isCorrect) {
        if (nextLifecycle === LIFECYCLE_STATUS.MASTERED && currentLifecycle !== LIFECYCLE_STATUS.MASTERED) {
          masteredCount++
        } else if (nextLifecycle !== currentLifecycle) {
          upgradedCount++
        }
      } else {
        // 答错不重置进度；仅"已掌握退回 review_1"计入 reset
        errorCountDelta = 1
        if (nextLifecycle !== currentLifecycle) resetCount++
      }

      const status = nextLifecycle === LIFECYCLE_STATUS.MASTERED
        ? WRONG_STATUS.MASTERED
        : WRONG_STATUS.PENDING

      if (!existing) {
        insertedRows.push({
          questionId: result.questionId,
          status,
          lifecycleStatus: nextLifecycle,
          errorCount: result.isCorrect ? 0 : 1
        })
      } else {
        updatedRows.push({
          id: existing.id,
          status,
          lifecycleStatus: nextLifecycle,
          errorCount: (existing.error_count || 1) + errorCountDelta
        })
      }

      lifecycleChanges.push({
        questionId: result.questionId,
        previous: currentLifecycle,
        current: nextLifecycle
      })
    }

    updateQuestionIds.push(result.questionId)
    updateQuestionValues.push(result.isCorrect)
  }

  if (insertedRows.length > 0) {
    const placeholders = insertedRows.map((_, index) => {
      const base = index * 5
      return `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NOW())`
    }).join(', ')
    const params = [studentId]
    for (const row of insertedRows) {
      // practice_count 起始为 1：本次是第一次重练；UPDATE 路径后续每次 +1
      params.push(row.questionId, row.status, row.lifecycleStatus, row.errorCount, 1)
    }
    await query(
      `INSERT INTO ${TABLES.WRONG_QUESTIONS}
       (student_id, question_id, status, lifecycle_status, error_count, practice_count, created_at)
       VALUES ${placeholders}
       ON CONFLICT DO NOTHING`,
      params
    )
  }

  for (const row of updatedRows) {
    await query(
      `UPDATE ${TABLES.WRONG_QUESTIONS}
       SET status = $1, lifecycle_status = $2, error_count = $3,
           practice_count = practice_count + 1, updated_at = NOW()
       WHERE id = $4`,
      [row.status, row.lifecycleStatus, row.errorCount, row.id]
    )
  }

  if (updateQuestionIds.length > 0) {
    const clauses = updateQuestionIds.map((_, index) =>
      `WHEN $${index * 2 + 1}::uuid THEN $${index * 2 + 2}`
    ).join(' ')
    const params = updateQuestionIds.flatMap((questionId, index) => [
      questionId,
      updateQuestionValues[index]
    ])
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET is_correct = CASE id ${clauses} END, updated_at = NOW()
       WHERE id = ANY($${params.length + 1}::uuid[])`,
      [...params, updateQuestionIds]
    )
  }

  await query(
    `UPDATE ${TABLES.GENERATED_EXAMS}
     SET status = 'graded', updated_at = NOW()
     WHERE id = $1`,
    [generatedExamId]
  )

  if (pendingResults.length > 0) {
    try {
      await syncReviewResultsMastery({ studentId, results: pendingResults })
    } catch (error) {
      console.error(`[GradingFinalizer] mastery sync failed exam=${generatedExamId}:`, error.message)
    }
  }

  for (const result of pendingResults) {
    await createJudgement({
      questionId: result.questionId,
      studentId,
      source: 'manual_review',
      isCorrect: result.isCorrect,
      metadata: {
        generated_exam_id: generatedExamId,
        settlement_key: settlementKey,
        settlement_mode: 'retry',
        wrong_book_action: result.skipWrongBook ? 'skip' : 'settle'
      }
    })
  }

  return {
    total: normalizedResults.length,
    masteredCount,
    upgradedCount,
    resetCount,
    lifecycleChanges,
    settled: pendingResults.length,
    skipped: settledIds.size
  }
}
