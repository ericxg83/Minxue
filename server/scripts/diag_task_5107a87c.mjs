import { query, TABLES } from '../config/neon.js'

const taskId = '5107a87c-25c4-442a-a348-6543eb719b01'
const { rows } = await query(
  `SELECT id, task_type, worksheet_id, generated_exam_id, resource_id, subject, original_name, status, created_at, updated_at
   FROM ${TABLES.TASKS} WHERE id = $1`,
  [taskId]
)
console.log('TASK:', JSON.stringify(rows, null, 2))

if (rows[0]?.worksheet_id) {
  const { rows: ws } = await query(
    `SELECT id, name, subject, status, answer_count FROM ${TABLES.WORKSHEETS} WHERE id = $1`,
    [rows[0].worksheet_id]
  )
  console.log('WORKSHEET:', JSON.stringify(ws, null, 2))
  const { rows: ans } = await query(
    `SELECT id, question_no, answer, answer_type, section, confidence
     FROM ${TABLES.WORKSHEET_ANSWERS} WHERE worksheet_id = $1
     ORDER BY question_no LIMIT 20`,
    [rows[0].worksheet_id]
  )
  console.log('ANSWERS (first 20):', JSON.stringify(ans, null, 2))
}
process.exit(0)
