import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const run = async () => {
  const wsId = '1c31ee45-0879-4d53-a54c-60af85ee15cc'

  // 查答案库 q21、q22 的 sub 行
  const { rows } = await pool.query(`
    SELECT wa.question_no, wa.sub_no, wa.answer, wa.answer_type, wa.section,
           ru.unit_key, ru.unit_title
    FROM worksheet_answers wa
    JOIN resource_units ru ON ru.id = wa.unit_id
    WHERE wa.worksheet_id = $1
      AND wa.question_no IN (21, 22)
    ORDER BY wa.question_no, wa.sub_no
  `, [wsId])

  console.log('=== 答案库 q21/q22 sub 行 ===')
  for (const r of rows) {
    console.log(`  ${r.unit_key} | q${r.question_no}|${r.sub_no || ''} | type=${r.answer_type} | answer="${r.answer}"`)
  }

  // 查最新任务 OCR 输出
  const { rows: tasks } = await pool.query(`
    SELECT id, created_at FROM tasks
    WHERE worksheet_id = $1
    ORDER BY created_at DESC LIMIT 1
  `, [wsId])
  const latestId = tasks[0].id

  const { rows: qs } = await pool.query(`
    SELECT question_number, sub_no, student_answer, answer, is_correct, question_type
    FROM questions WHERE task_id = $1
      AND question_number IN (21, 22)
    ORDER BY question_number
  `, [latestId])

  console.log('\n=== 最新任务 OCR 输出 ===')
  for (const q of qs) {
    console.log(`  q${q.question_number} sub_no=${q.sub_no} type=${q.question_type} is_correct=${q.is_correct}`)
    console.log(`    student="${q.student_answer}"`)
    console.log(`    ref="${q.answer}"`)
  }

  await pool.end()
}
run().catch(console.error)
