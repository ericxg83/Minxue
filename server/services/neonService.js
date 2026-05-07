import { query, transaction, TABLES } from '../config/neon.js'

// ==================== 学生相关操作 ====================

export const getStudents = async () => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.STUDENTS} ORDER BY created_at DESC`
  )
  return rows
}

export const getStudentById = async (id) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.STUDENTS} WHERE id = $1`,
    [id]
  )
  return rows[0] || null
}

export const createStudent = async (studentData) => {
  const { rows } = await query(
    `INSERT INTO ${TABLES.STUDENTS} (name, grade, class, remark, avatar)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [studentData.name, studentData.grade || null, studentData.class || null,
     studentData.remark || null, studentData.avatar || null]
  )
  return rows[0]
}

export const updateStudent = async (id, updates) => {
  const allowedFields = ['name', 'grade', 'class', 'remark', 'avatar']
  const setClause = []
  const values = []
  let paramIndex = 1

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClause.push(`${field} = $${paramIndex}`)
      values.push(updates[field])
      paramIndex++
    }
  }

  if (setClause.length === 0) return null

  setClause.push(`updated_at = NOW()`)
  values.push(id)

  const { rows } = await query(
    `UPDATE ${TABLES.STUDENTS} SET ${setClause.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  )
  return rows[0]
}

export const deleteStudent = async (id) => {
  await query(`DELETE FROM ${TABLES.STUDENTS} WHERE id = $1`, [id])
  return true
}

// ==================== 任务相关操作 ====================

export const getTasksByStudent = async (studentId) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.TASKS} WHERE student_id = $1 ORDER BY created_at DESC`,
    [studentId]
  )
  return rows
}

export const getTaskById = async (taskId) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.TASKS} WHERE id = $1`,
    [taskId]
  )
  return rows[0] || null
}

export const createTask = async (taskData) => {
  const { rows } = await query(
    `INSERT INTO ${TABLES.TASKS} (student_id, image_url, original_name, status, result)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [taskData.student_id, taskData.image_url || null, taskData.original_name || null,
     taskData.status || 'pending', taskData.result ? JSON.stringify(taskData.result) : null]
  )
  return rows[0]
}

export const updateTaskStatus = async (taskId, status, result = null) => {
  let sql, params

  if (result !== null) {
    // 合并现有 result
    const { rows: existing } = await query(
      `SELECT result FROM ${TABLES.TASKS} WHERE id = $1`,
      [taskId]
    )
    const mergedResult = {
      ...(existing[0]?.result || {}),
      ...result
    }

    sql = `UPDATE ${TABLES.TASKS} SET status = $1, result = $2, updated_at = NOW() WHERE id = $3 RETURNING *`
    params = [status, JSON.stringify(mergedResult), taskId]
  } else {
    sql = `UPDATE ${TABLES.TASKS} SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`
    params = [status, taskId]
  }

  const { rows } = await query(sql, params)
  return rows[0]
}

// ==================== 题目相关操作 ====================

export const getQuestionsByTask = async (taskId) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.QUESTIONS} WHERE task_id = $1 ORDER BY created_at ASC`,
    [taskId]
  )
  return rows.map(row => ({
    ...row,
    options: row.options || [],
    ai_tags: row.ai_tags || [],
    manual_tags: row.manual_tags || []
  }))
}

export const getQuestionsByIds = async (questionIds) => {
  if (!questionIds || questionIds.length === 0) return []

  const placeholders = questionIds.map((_, i) => `$${i + 1}`).join(',')
  const { rows } = await query(
    `SELECT * FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
    questionIds
  )
  return rows
}

export const createQuestions = async (questions) => {
  const created = []

  for (const q of questions) {
    let statusValue = 'pending'
    if (q.status === 'wrong' || !q.is_correct) {
      statusValue = 'wrong'
    } else if (q.status === 'mastered') {
      statusValue = 'mastered'
    }

    const { rows } = await query(
      `INSERT INTO ${TABLES.QUESTIONS}
       (task_id, student_id, content, options, answer, analysis, question_type, subject, is_correct, status, image_url, ai_tags, manual_tags, tags_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [q.task_id, q.student_id, q.content || null, JSON.stringify(q.options || []),
       q.answer || null, q.analysis || null, q.question_type || 'choice',
       q.subject || null, q.is_correct !== undefined ? q.is_correct : true,
       statusValue, q.image_url || null, JSON.stringify(q.ai_tags || []),
       JSON.stringify(q.manual_tags || []), q.tags_source || 'ai']
    )
    created.push(rows[0])
  }

  return created
}

export const updateQuestion = async (id, updates) => {
  const allowedFields = ['content', 'options', 'answer', 'analysis', 'question_type', 'subject', 'is_correct', 'status', 'image_url', 'ai_tags', 'manual_tags', 'tags_source']
  const setClause = []
  const values = []
  let paramIndex = 1

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClause.push(`${field} = $${paramIndex}`)
      values.push(['options', 'ai_tags', 'manual_tags'].includes(field)
        ? JSON.stringify(updates[field])
        : updates[field])
      paramIndex++
    }
  }

  if (setClause.length === 0) return null

  setClause.push(`updated_at = NOW()`)
  values.push(id)

  const { rows } = await query(
    `UPDATE ${TABLES.QUESTIONS} SET ${setClause.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  )
  return rows[0]
}

// ==================== 错题本相关操作 ====================

export const getWrongQuestionsByStudent = async (studentId) => {
  const { rows: wrongData } = await query(
    `SELECT * FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 ORDER BY added_at DESC`,
    [studentId]
  )

  if (!wrongData || wrongData.length === 0) return []

  const questionIds = wrongData.map(wq => wq.question_id).filter(Boolean)

  let questionsMap = {}
  if (questionIds.length > 0) {
    const placeholders = questionIds.map((_, i) => `$${i + 1}`).join(',')
    const { rows: questionsData } = await query(
      `SELECT * FROM ${TABLES.QUESTIONS} WHERE id IN (${placeholders})`,
      questionIds
    )

    for (const q of questionsData) {
      questionsMap[q.id] = {
        ...q,
        options: q.options || [],
        ai_tags: q.ai_tags || [],
        manual_tags: q.manual_tags || []
      }
    }
  }

  return wrongData.map(wq => ({
    ...wq,
    question: questionsMap[wq.question_id] || null
  }))
}

export const addWrongQuestions = async (studentId, questionIds) => {
  const { rows: existing } = await query(
    `SELECT question_id FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1 AND question_id = ANY($2)`,
    [studentId, questionIds]
  )

  const existingIds = new Set((existing || []).map(e => e.question_id))
  const newIds = questionIds.filter(id => !existingIds.has(id))

  if (newIds.length === 0) return []

  const created = []
  for (const questionId of newIds) {
    const { rows } = await query(
      `INSERT INTO ${TABLES.WRONG_QUESTIONS}
       (student_id, question_id, status, error_count, added_at, last_wrong_at)
       VALUES ($1, $2, 'pending', 1, NOW(), NOW())
       RETURNING *`,
      [studentId, questionId]
    )
    created.push(rows[0])
  }

  return created
}

// ==================== 生成试卷相关操作 ====================

export const getGeneratedExamsByStudent = async (studentId) => {
  const { rows } = await query(
    `SELECT * FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1 ORDER BY created_at DESC`,
    [studentId]
  )

  return (rows || []).map(exam => ({
    id: exam.id,
    student_id: exam.student_id,
    name: exam.name || '错题重练卷',
    question_ids: exam.question_ids || [],
    status: 'ungraded',
    created_at: exam.created_at,
    graded_at: null,
    source: 'generated'
  }))
}

export const createGeneratedExam = async (examData) => {
  const { rows } = await query(
    `INSERT INTO ${TABLES.GENERATED_EXAMS} (student_id, name, question_ids)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [examData.student_id, examData.name || '错题重练卷', examData.question_ids || []]
  )
  return rows[0]
}

// ==================== 统计相关 ====================

export const getStudentStats = async (studentId) => {
  const { rows: taskCount } = await query(
    `SELECT COUNT(*) as count FROM ${TABLES.TASKS} WHERE student_id = $1`,
    [studentId]
  )

  const { rows: wrongCount } = await query(
    `SELECT COUNT(*) as count FROM ${TABLES.WRONG_QUESTIONS} WHERE student_id = $1`,
    [studentId]
  )

  const { rows: examCount } = await query(
    `SELECT COUNT(*) as count FROM ${TABLES.GENERATED_EXAMS} WHERE student_id = $1`,
    [studentId]
  )

  return {
    tasks: parseInt(taskCount[0]?.count || 0),
    wrongQuestions: parseInt(wrongCount[0]?.count || 0),
    exams: parseInt(examCount[0]?.count || 0)
  }
}
