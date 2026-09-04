/**
 * Worksheet 单页手动修复：老师指定某 task 的某页应归属到哪个 unit，
 * 系统用该 unit 的答案库重新匹配并批改该页所有题目。
 */
import { query } from '../config/neon.js'
import { getResourceAnswersBySection } from './neonService.js'
import { judgeAnswer } from './judgeService.js'
import { searchByAnswerFingerprint } from '../worker.js'

/**
 * 删除/恢复指定题在错题本中的记录
 * @param {string} taskId
 * @param {string} studentId
 * @param {string} worksheetId
 * @param {number} pageNumber
 * @param {Array<{ id, question_number, oldIsCorrect, newIsCorrect, answer, student_answer, question_type }>} changes
 */
async function syncWrongQuestions(taskId, studentId, worksheetId, pageNumber, changes) {
  const wrongAdded = []
  const wrongRemoved = []

  for (const ch of changes) {
    const isBlank = ch.answer_source === 'blank'
    // 空答（answer_source='blank'）和判错（newIsCorrect=false）都视为错题入册；
    // 补答对（newIsCorrect=true）则从错题本移除，与正常错题一致。
    const wasWrong = ch.oldIsCorrect === false || (isBlank && ch.oldIsCorrect === null)
    const isWrong = ch.newIsCorrect === false || (isBlank && ch.newIsCorrect === null)

    if (wasWrong && !isWrong) {
      // 原来是错题，现在对了：从错题本移除
      await query(
        `DELETE FROM wrong_questions
         WHERE (question_id = $1)
            OR (student_id = $2 AND worksheet_id = $3 AND question_no = $4)`,
        [ch.id, studentId, worksheetId, ch.question_number]
      )
      wrongRemoved.push(ch.question_number)
    } else if (isWrong) {
      // 现在是错题：upsert 错题本记录
      const { rows: existing } = await query(
        `SELECT id FROM wrong_questions
         WHERE (question_id = $1)
            OR (student_id = $2 AND worksheet_id = $3 AND question_no = $4)
         LIMIT 1`,
        [ch.id, studentId, worksheetId, ch.question_number]
      )
      if (existing.length > 0) {
        await query(
          `UPDATE wrong_questions
           SET error_count = error_count + 1,
               last_wrong_at = NOW(),
               updated_at = NOW(),
               student_answer = $2,
               correct_answer = $3,
               question_id = COALESCE($4, question_id),
               page_number = COALESCE($5, page_number),
               is_blank = $6,
               error_type = $7
           WHERE id = $1`,
          [existing[0].id, ch.student_answer || null, ch.answer || null, ch.id, pageNumber, isBlank, isBlank ? '未作答' : null]
        )
      } else {
        await query(
          `INSERT INTO wrong_questions
           (student_id, question_id, worksheet_id, page_number, question_no,
            student_answer, correct_answer, question_type, answer_type, status, error_count, added_at, last_wrong_at, created_at, updated_at,
            is_blank, error_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 1, NOW(), NOW(), NOW(), NOW(),
                   $10, $11)`,
          [studentId, ch.id, worksheetId, pageNumber, ch.question_number,
           ch.student_answer || null, ch.answer || null,
           ch.question_type || 'answer', ch.question_type || 'answer',
           isBlank, isBlank ? '未作答' : null]
        )
      }
      wrongAdded.push(ch.question_number)
    }
  }

  if (wrongAdded.length > 0 || wrongRemoved.length > 0) {
    console.log(`[regradeTaskPageWithUnit] 错题本同步: +${wrongAdded.length} -${wrongRemoved.length} (taskId=${taskId}, page=${pageNumber})`)
  }
}

/**
 * 手动指定 unit 后，重新批改 task 的某一页
 * @param {string} taskId
 * @param {number} pageNumber
 * @param {string} unitKey
 * @returns {Promise<{ success: boolean, updated: number, skipped: number, errors?: string }>}
 */
export async function regradeTaskPageWithUnit(taskId, pageNumber, unitKey) {
  // 1) 确认 task 属于哪个 worksheet 及学生
  const { rows: taskRows } = await query(
    `SELECT worksheet_id, student_id FROM tasks WHERE id = $1 AND deleted_at IS NULL`,
    [taskId]
  )
  if (taskRows.length === 0) {
    return { success: false, updated: 0, skipped: 0, error: '任务不存在或已删除' }
  }
  const worksheetId = taskRows[0].worksheet_id
  const studentId = taskRows[0].student_id
  if (!worksheetId) {
    return { success: false, updated: 0, skipped: 0, error: '任务未关联练习册' }
  }
  if (!studentId) {
    return { success: false, updated: 0, skipped: 0, error: '任务未关联学生' }
  }

  // 2) 加载该页题目（questions 表不存 sub_no，故只按 question_no 匹配）
  const { rows: questions } = await query(
    `SELECT id, question_number, question_type, student_answer, answer, is_correct, answer_source
     FROM questions
     WHERE task_id = $1 AND page_number = $2 AND deleted_at IS NULL
     ORDER BY question_number`,
    [taskId, pageNumber]
  )
  if (questions.length === 0) {
    return { success: true, updated: 0, skipped: 0, message: '该页没有题目' }
  }

  // 3) 加载答案库 3D Map
  const answersByUnit = await getResourceAnswersBySection(worksheetId)
  const unitAnswers = answersByUnit.get(unitKey)
  if (!unitAnswers) {
    return { success: false, updated: 0, skipped: 0, error: `单元 ${unitKey} 不存在于答案库` }
  }

  // 4) 在指定 unit 内匹配答案。
  //   由于 questions 表不存 sub_no，OCR 可能把多空题拆成多条同 question_number 记录。
  //   策略：
  //   - 先按 question_no|'' 找整题答案
  //   - 找不到时，用 searchByAnswerFingerprint 按学生答案内容在该 unit 内找最相似的 sub 行
  const usedKeys = new Set()
  const findRow = (q) => {
    // 4.1) 优先整题匹配
    const wholeKey = `${Number(q.question_number)}|`
    for (const qMap of unitAnswers.values()) {
      if (qMap.has(wholeKey) && !usedKeys.has(wholeKey)) {
        const row = qMap.get(wholeKey)
        usedKeys.add(wholeKey)
        return row
      }
    }
    // 4.2) 答案指纹匹配（解决 sub 拆分场景）
    const found = searchByAnswerFingerprint(q.student_answer, q.question_type, unitAnswers, usedKeys)
    if (found) {
      usedKeys.add(found.qKey)
      return found.row
    }
    return null
  }

  let updated = 0
  let skipped = 0
  const errors = []
  const changes = []

  for (const q of questions) {
    const row = findRow(q)
    if (!row || !row.answer) {
      skipped++
      continue
    }

    const judgment = judgeAnswer(q.student_answer, row.answer, row.answer_type || q.question_type || 'answer')
    let status
    if (judgment.unrecognized) status = 'pending'
    else if (judgment.isCorrect === true) status = 'correct'
    else if (judgment.isCorrect === false) status = 'wrong'
    else status = 'pending'

    const oldIsCorrect = q.is_correct
    const newIsCorrect = judgment.isCorrect

    try {
      await query(
        `UPDATE questions
         SET answer = $1, is_correct = $2, status = $3, updated_at = NOW()
         WHERE id = $4`,
        [row.answer, judgment.isCorrect, status, q.id]
      )
      updated++

      // 记录状态变化，用于同步错题本
      if (oldIsCorrect !== newIsCorrect || q.answer_source === 'blank') {
        changes.push({
          id: q.id,
          question_number: q.question_number,
          oldIsCorrect,
          newIsCorrect,
          answer: row.answer,
          student_answer: q.student_answer,
          question_type: q.question_type || row.answer_type || 'answer',
          answer_source: q.answer_source
        })
      }
    } catch (e) {
      errors.push(`q${q.question_number}: ${e.message}`)
    }
  }

  // 5) 同步错题本：错→对删除，对→错添加
  if (changes.length > 0) {
    try {
      await syncWrongQuestions(taskId, studentId, worksheetId, pageNumber, changes)
    } catch (e) {
      console.error(`[regradeTaskPageWithUnit] 同步错题本失败: ${e.message}`)
      errors.push(`sync_wrong_questions: ${e.message}`)
    }
  }

  return {
    success: errors.length === 0,
    updated,
    skipped,
    total: questions.length,
    unitKey,
    errors: errors.length > 0 ? errors : undefined,
  }
}
