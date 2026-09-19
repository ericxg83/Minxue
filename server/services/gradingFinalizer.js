import { createHash } from 'node:crypto'
import { query, transaction, TABLES, LIFECYCLE_STATUS, WRONG_STATUS } from '../config/neon.js'
import { addWrongQuestions, createJudgement } from './neonService.js'
import { compensateWrongBook } from './wrongBookCompensation.js'
import { syncQuestionsKnowledgeAndMastery, syncReviewResultsMastery } from './knowledgeMasteryService.js'
import { syncQuestionCompletenessQuietly } from './questionCompletenessSync.js'
import { checkQuestionCompleteness } from '../utils/questionCompleteness.js'
import { buildWrongQuestionSnapshotSql } from '../utils/wrongQuestionSnapshot.js'

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

/**
 * 批量回写 questions.is_correct 的 CASE 片段（结算收尾唯一出口）。
 *
 * ⚠️ THEN 分支必须显式写 `::boolean`，不能省。
 *   `SET is_correct = CASE id WHEN $1::uuid THEN $2 ... END` 里，$2 处在 THEN 位置
 *   没有任何类型上下文，PostgreSQL 会把它推断成 text，整条语句直接抛：
 *     `42804 column "is_correct" is of type boolean but expression is of type text`
 *   炸点在「错题生命周期已推进、exam.status 还没写」之间，异常又被上层静默吞掉，
 *   于是表现为：前端提示「复核完成，已保存」，但库里 exam.status 永远 ungraded
 *   → 左侧列表一直「待复核」、移动端一直「待完成」，且每点一次完成复核就把
 *   wrong_questions 的 lifecycle/practice_count 重复推进一次（假掌握）。
 *   （2026-09-14 错题再测-0911 事故根因）
 *   新增同类批量更新必须复用本函数，不要另写一份 CASE。
 */
const buildIsCorrectAssignments = (ids) =>
  ids.map((_, index) => `WHEN $${index * 2 + 1}::uuid THEN $${index * 2 + 2}::boolean`).join(' ')

export { buildIsCorrectAssignments }

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
  // 判题域契约：is_correct === false（明确判错）或 answer_source='blank'（空答/不会）才入错题本。
  // 空题算"不会"等同错题，老师拍板入册；is_correct === null 的其它情况（缺参考答案/答案不唯一）
  // 仍由老师复核给结论，避免错题本混入系统噪音。
  //
  // 入册统一走 compensateWrongBook 对账：以数据库现况为准，
  //   · 能补上「判题时参考答案为空、随后才异步补齐」的漏网（本题在此处的 in-memory 快照可能已有答案，
  //     但历史批次/其它入口未必赶上，故以库为准再对一次账）；
  //   · 排除老师已给终态复核结论（correct / exclude / wrong_no_book）的题，避免把老师判对的题又拉回错题本；
  //   · 置信度闸 / 完整性闸 / 空答语义仍复用 addWrongQuestions，不在此另写口径。
  // 用 try/catch 包住：一次入册异常绝不能吞掉后面的 judgement 审计与掌握度更新（原实现即此处裸 await，异常会中断整轮结算）。
  let wrongBookStats = { added: 0 }
  try {
    wrongBookStats = await compensateWrongBook({
      studentId,
      questions: pendingQuestions,
      reason: `finalizeGradingBatch task=${taskId}`
    })
  } catch (e) {
    console.error(`[GradingFinalizer] 错题入册失败 task=${taskId}:`, e.message)
  }

  const updateIds = pendingQuestions.filter(q => q.is_correct !== null && q.is_correct !== undefined).map(q => q.id)
  if (updateIds.length > 0) {
    const params = updateIds.flatMap(id => {
      const question = questionMap.get(id)
      return [id, question.is_correct === true]
    })
    await query(
      `UPDATE ${TABLES.QUESTIONS}
       SET is_correct = CASE id ${buildIsCorrectAssignments(updateIds)} END, updated_at = NOW()
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

  // 批改落库后把 is_complete 对齐到动态真值。OCR 阶段建的题答案为空 → 落 false，
  // 答案解析异步补齐后无人回写，错题本 / 周报 / 讲义按 `is_complete = TRUE` 过滤时会漏题。
  syncQuestionCompletenessQuietly(
    pendingQuestions.map(q => q.id),
    `finalizeGradingBatch task=${taskId}`
  )

  return {
    settled: pendingQuestions.length,
    skipped: settledIds.size,
    wrongQuestions: wrongBookStats.added,
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

  // 重判常发生在老师补完答案/配图/选项之后，此时落库列最容易偏旧。
  syncQuestionCompletenessQuietly([question.id], `finalizeRejudgeResult q=${question.id}`)

  return { settled: true, skipped: false, isCorrect, wrongQuestionAdded }
}

/**
 * 掌握度状态机（2026-09-13 队列分层定稿）：
 *
 * 状态：NEW（新错题/累计答对 0 次）→ REVIEW_1（基本掌握/累计答对 1 次）→ MASTERED（完全掌握/累计答对 2 次）
 * 答对：NEW → REVIEW_1 → MASTERED；MASTERED 保持
 * 答错：NEW 保持原位（error_count+1）；
 *       REVIEW_1 答错 → 退回 NEW（「基本掌握」是假象，回池重练）；
 *       MASTERED 答错 → 退回 REVIEW_1（基本掌握，重新走周回顾验证）
 *
 * REVIEW_2 保留为历史兼容枚举（生产库 0 条），不再被写入；
 * 遇到旧 review_2 数据时按 REVIEW_1 语义处理。
 *
 * 与前端展示层两份同构实现保持逐字一致：
 *   - 移动端 src/pages/Grading/index.jsx 的 getNextLifecycle（仅预览统计，结算仍走服务端）
 *   - PC 端 src/workbench/stores/lifecycleStore.js 的 processReviewResult
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
  if (current === LIFECYCLE_STATUS.REVIEW_1 || current === LIFECYCLE_STATUS.REVIEW_2) {
    return LIFECYCLE_STATUS.NEW
  }
  return current
}

export { getNextLifecycle }

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
        // 答错：review_1 退回 new、mastered 退回 review_1 均计入 reset；error_count 一定 +1
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

  // ⚠️ 结算原子化（2026-09-14 根治，勿拆回逐步提交）：以下全部写入在同一个事务里，
  // 要么整体提交、要么整体回滚。历史事故（42804）正是「错题推进已提交、后续步骤炸」的
  // 半提交状态，叠加结算审计未落库 ⇒ 老师每点一次复核就重复推进一次
  // （error_count 刷到 28、practice_count 刷到 31、new→review_1→mastered 假升级）。
  // 事务化后任何一步失败即整体回滚并向上抛，不存在"写了一半"，重试也天然幂等。
  // 注意：结算审计必须在本事务内用 client 直写（createJudgement 自带重试且吞异常、
  // 且走连接池，进不了事务）——审计缺失正是当年重复推进的前提条件之一。
  await transaction(async (client) => {
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
      await client.query(
        `INSERT INTO ${TABLES.WRONG_QUESTIONS}
         (student_id, question_id, status, lifecycle_status, error_count, practice_count, created_at)
         VALUES ${placeholders}
         ON CONFLICT DO NOTHING`,
        params
      )

      // 入册快照补齐（同一事务内，紧跟 INSERT）：
      //   上面的 INSERT 只写生命周期字段，出处分 (last_wrong_task_id / page_number /
      //   question_no / content / question_type / block_coordinates) 全为空。后果是
      //   周末班白板「学生原卷（整页图）」按 last_wrong_task_id 取 tasks.images 取不到，
      //   弹窗永远「无原卷图」（2026-09-19 用户报障）。这里从题目行补齐快照，
      //   口径见 utils/wrongQuestionSnapshot.js（只补空、不覆盖、失败即整体回滚）。
      await client.query(
        buildWrongQuestionSnapshotSql(),
        [insertedRows.map(r => r.questionId), studentId]
      )
    }

    for (const row of updatedRows) {
      await client.query(
        `UPDATE ${TABLES.WRONG_QUESTIONS}
         SET status = $1, lifecycle_status = $2, error_count = $3,
             practice_count = practice_count + 1, updated_at = NOW()
         WHERE id = $4`,
        [row.status, row.lifecycleStatus, row.errorCount, row.id]
      )
    }

    if (updateQuestionIds.length > 0) {
      const params = updateQuestionIds.flatMap((questionId, index) => [
        questionId,
        updateQuestionValues[index]
      ])
      await client.query(
        `UPDATE ${TABLES.QUESTIONS}
         SET is_correct = CASE id ${buildIsCorrectAssignments(updateQuestionIds)} END, updated_at = NOW()
         WHERE id = ANY($${params.length + 1}::uuid[])`,
        [...params, updateQuestionIds]
      )
    }

    // 本语句保持在题目回写之后（原注释约定不变）；事务化后即使失败也已整体回滚，
    // 不会再出现「错题已推进、exam 还是 ungraded」的撕裂状态。
    await client.query(
      `UPDATE ${TABLES.GENERATED_EXAMS}
       SET status = 'graded', updated_at = NOW()
       WHERE id = $1`,
      [generatedExamId]
    )

    // 结算审计（settlement_key 是幂等判据）：必须在事务内落库。
    for (const result of pendingResults) {
      await client.query(
        `INSERT INTO ${TABLES.JUDGEMENTS}
         (question_id, student_id, source, is_correct, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [result.questionId, studentId, 'manual_review', result.isCorrect,
         JSON.stringify({
           generated_exam_id: generatedExamId,
           settlement_key: settlementKey,
           settlement_mode: 'retry',
           wrong_book_action: result.skipWrongBook ? 'skip' : 'settle'
         })]
      )
    }
  })

  // 知识点/掌握度同步是尽力而为的旁路（失败仅告警），放在事务外避免长事务持锁。
  if (pendingResults.length > 0) {
    try {
      await syncReviewResultsMastery({ studentId, results: pendingResults })
    } catch (error) {
      console.error(`[GradingFinalizer] mastery sync failed exam=${generatedExamId}:`, error.message)
    }
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
