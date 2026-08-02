/**
 * Worksheet 单页手动修复：老师指定某 task 的某页应归属到哪个 unit，
 * 系统用该 unit 的答案库重新匹配并批改该页所有题目。
 */
import { query } from '../config/neon.js'
import { getResourceAnswersBySection } from './neonService.js'
import { judgeAnswer } from './judgeService.js'
import { searchByAnswerFingerprint } from '../worker.js'

/**
 * 手动指定 unit 后，重新批改 task 的某一页
 * @param {string} taskId
 * @param {number} pageNumber
 * @param {string} unitKey
 * @returns {Promise<{ success: boolean, updated: number, skipped: number, errors?: string }>}
 */
export async function regradeTaskPageWithUnit(taskId, pageNumber, unitKey) {
  // 1) 确认 task 属于哪个 worksheet
  const { rows: taskRows } = await query(
    `SELECT worksheet_id FROM tasks WHERE id = $1 AND deleted_at IS NULL`,
    [taskId]
  )
  if (taskRows.length === 0) {
    return { success: false, updated: 0, skipped: 0, error: '任务不存在或已删除' }
  }
  const worksheetId = taskRows[0].worksheet_id
  if (!worksheetId) {
    return { success: false, updated: 0, skipped: 0, error: '任务未关联练习册' }
  }

  // 2) 加载该页题目（questions 表不存 sub_no，故只按 question_no 匹配）
  const { rows: questions } = await query(
    `SELECT id, question_number, question_type, student_answer, answer
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

  for (const q of questions) {
    const row = findRow(q)
    if (!row || !row.answer) {
      skipped++
      continue
    }

    const judgment = judgeAnswer(q.student_answer, row.answer, q.question_type || row.answer_type || 'answer')
    let status
    if (judgment.unrecognized) status = 'pending'
    else if (judgment.isCorrect === true) status = 'correct'
    else if (judgment.isCorrect === false) status = 'wrong'
    else status = 'pending'

    try {
      await query(
        `UPDATE questions
         SET answer = $1, is_correct = $2, status = $3, updated_at = NOW()
         WHERE id = $4`,
        [row.answer, judgment.isCorrect, status, q.id]
      )
      updated++
    } catch (e) {
      errors.push(`q${q.question_number}: ${e.message}`)
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
