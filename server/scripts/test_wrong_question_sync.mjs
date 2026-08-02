/**
 * 测试：手动修复单元后，wrong_questions 同步
 * 先人为把 q21 改成 wrong 并插入错题本，再调用 regradeTaskPageWithUnit，
 * 验证错题本记录被删除。
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { query } from '../config/neon.js'
import { regradeTaskPageWithUnit } from '../services/worksheetPageService.js'

const taskId = '73464f43-d669-42e7-93a9-e1dbfb14a0d3'
const pageNumber = 1
const questionNumber = 21

const run = async () => {
  // 1) 读取 task 与学生/练习册
  const { rows: taskRows } = await query(
    `SELECT worksheet_id, student_id FROM tasks WHERE id = $1`,
    [taskId]
  )
  if (taskRows.length === 0) {
    console.log('❌ task 不存在')
    process.exit(1)
  }
  const { worksheet_id: worksheetId, student_id: studentId } = taskRows[0]

  // 2) 找到 q21 的 questions 记录（取学生答案为 "2√10" 的那条）
  const { rows: qRows } = await query(
    `SELECT id, question_number, student_answer, answer, is_correct, status
     FROM questions
     WHERE task_id = $1 AND page_number = $2 AND question_number = $3 AND deleted_at IS NULL`,
    [taskId, pageNumber, questionNumber]
  )
  if (qRows.length === 0) {
    console.log('❌ q21 不存在')
    process.exit(1)
  }
  const q21 = qRows.find(q => q.student_answer === '2√10') || qRows[0]
  console.log('=== 修复前 q21 状态 ===')
  console.log(q21)

  // 3) 人为把它改成 wrong，并写入错题本（模拟错挂导致的错误记录）
  await query(
    `UPDATE questions SET is_correct = false, status = 'wrong', updated_at = NOW() WHERE id = $1`,
    [q21.id]
  )
  await query(
    `DELETE FROM wrong_questions WHERE question_id = $1 OR (student_id = $2 AND worksheet_id = $3 AND question_no = $4)`,
    [q21.id, studentId, worksheetId, questionNumber]
  )
  await query(
    `INSERT INTO wrong_questions (student_id, question_id, worksheet_id, page_number, question_no,
      student_answer, correct_answer, question_type, answer_type, status, error_count, added_at, last_wrong_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'answer', 'answer', 'pending', 1, NOW(), NOW(), NOW(), NOW())`,
    [studentId, q21.id, worksheetId, pageNumber, questionNumber, q21.student_answer, q21.answer]
  )

  const { rows: before } = await query(
    `SELECT id FROM wrong_questions WHERE question_id = $1`,
    [q21.id]
  )
  console.log(`\n修复前错题本记录数: ${before.length}`)

  // 4) 调用手动修复
  const result = await regradeTaskPageWithUnit(taskId, pageNumber, '试卷3|19.2')
  console.log('\n=== 修复结果 ===')
  console.log(JSON.stringify(result, null, 2))

  // 5) 验证 q21 与错题本
  const { rows: afterQ } = await query(
    `SELECT id, question_number, student_answer, answer, is_correct, status
     FROM questions WHERE id = $1`,
    [q21.id]
  )
  const { rows: afterW } = await query(
    `SELECT id FROM wrong_questions WHERE question_id = $1`,
    [q21.id]
  )
  console.log('\n=== 修复后 q21 状态 ===')
  console.log(afterQ[0])
  console.log(`修复后错题本记录数: ${afterW.length}`)

  const passed = afterQ[0].is_correct === true && afterW.length === 0
  console.log('\n' + (passed ? '✅ 错题本同步正确：q21 判对且错题记录已删除' : '❌ 错题本同步失败'))
  process.exit(passed ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
