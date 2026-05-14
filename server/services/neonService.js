import { query, TABLES } from '../config/neon.js'

export const updateTaskStatus = async (taskId, status, result = null) => {
  const updateData = {
    status,
    updated_at: new Date().toISOString()
  }

  if (result !== null) {
    const { rows } = await query(
      `SELECT result FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const existingResult = rows[0]?.result || {}
    if (typeof existingResult === 'string') {
      updateData.result = JSON.stringify({ ...JSON.parse(existingResult), ...result })
    } else {
      updateData.result = JSON.stringify({ ...existingResult, ...result })
    }
  } else {
    updateData.result = JSON.stringify(result || {})
  }

  await query(
    `UPDATE ${TABLES.TASKS}
     SET status = $1, result = $2, updated_at = $3
     WHERE id = $4`,
    [status, updateData.result, updateData.updated_at, taskId]
  )
}

export const createQuestions = async (questions) => {
  const questionsWithTime = questions.map(q => {
    let statusValue = 'pending'
    if (q.status === 'wrong' || q.is_correct === false) {
      statusValue = 'wrong'
    } else if (q.status === 'mastered') {
      statusValue = 'mastered'
    }

    return {
      id: q.id,
      task_id: q.task_id,
      student_id: q.student_id,
      content: q.content || null,
      options: JSON.stringify(q.options || []),
      answer: q.answer || null,
      student_answer: q.student_answer || null,
      ai_answer: q.ai_answer || null,
      answer_source: q.answer_source || 'recognized',
      analysis: q.analysis || null,
      question_type: q.question_type || 'choice',
      subject: q.subject || null,
      is_correct: q.is_correct !== undefined ? q.is_correct : true,
      status: statusValue,
      image_url: q.image_url || null,
      ai_tags: JSON.stringify(q.ai_tags || []),
      manual_tags: JSON.stringify(q.manual_tags || []),
      tags_source: q.tags_source || 'ai',
      block_coordinates: q.block_coordinates ? JSON.stringify(q.block_coordinates) : null,
      created_at: new Date().toISOString()
    }
  })

  if (questionsWithTime.length === 0) return []

  const columns = Object.keys(questionsWithTime[0])
  const valuesPlaceholders = questionsWithTime.map((_, idx) => {
    return `(${columns.map((_, colIdx) => `$${idx * columns.length + colIdx + 1}`).join(', ')})`
  }).join(', ')

  const values = questionsWithTime.flatMap(q => columns.map(col => q[col]))

  await query(
    `INSERT INTO ${TABLES.QUESTIONS} (${columns.join(', ')}) VALUES ${valuesPlaceholders}`,
    values
  )
}

export const batchUpdateQuestionTags = async (tagUpdates) => {
  const results = []
  for (const update of tagUpdates) {
    try {
      await query(
        `UPDATE ${TABLES.QUESTIONS}
         SET ai_tags = $1::jsonb, tags_source = 'ai', updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(update.ai_tags), update.id]
      )
      results.push({ id: update.id })
    } catch (error) {
      console.error(`更新标签失败，题目ID: ${update.id}`, error)
    }
  }
  return results
}

export const addWrongQuestions = async (studentId, questionIds) => {
  if (!questionIds || questionIds.length === 0) return []

  const { rows: existing } = await query(
    `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
    [studentId, questionIds]
  )
  const existingIds = new Set(existing.map(e => e.question_id))
  const newIds = questionIds.filter(id => !existingIds.has(id))

  if (newIds.length === 0) return []

  const values = newIds.map((_, i) => `($1, $${i + 2}, 'pending', 1, NOW(), NOW(), NOW())`).join(',')
  const params = [studentId, ...newIds]

  await query(
    `INSERT INTO ${TABLES.WRONG_QUESTIONS} (student_id, question_id, status, error_count, added_at, last_wrong_at, created_at) VALUES ${values} ON CONFLICT DO NOTHING`,
    params
  )

  return newIds.map(id => ({ question_id: id }))
}

export const updateQuestionAnswer = async (questionId, answer, analysis) => {
  if (!answer && !analysis) return

  let analysisClause = ''
  const params = [answer || null, questionId]

  if (analysis && analysis.trim()) {
    analysisClause = ', analysis = CASE WHEN (analysis IS NULL OR analysis = \'\') THEN $3 ELSE analysis END'
    params.splice(1, 0, analysis)
  }

  await query(
    `UPDATE ${TABLES.QUESTIONS}
     SET answer = $1,
         updated_at = NOW()
         ${analysisClause}
     WHERE id = $2`,
    params
  )
}
