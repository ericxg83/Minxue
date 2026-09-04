import 'dotenv/config'
import { config } from 'dotenv'
config({ path: 'D:/Minxue_App_V3/server/.env' })

import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const name = '陈施君'

async function main() {
  // 1. 学生
  const stu = await pool.query(
    `SELECT id, name, grade, enrollment_status, paused_at, created_at, updated_at FROM students WHERE name = $1`,
    [name]
  )
  console.log('=== students ===')
  console.log(JSON.stringify(stu.rows, null, 2))

  if (stu.rows.length === 0) {
    console.log('未找到该学生！')
    await pool.end()
    return
  }

  for (const s of stu.rows) {
    console.log(`\n\n=== 学生 ${s.id} ${s.name} (enrollment_status=${s.enrollment_status}, paused_at=${s.paused_at}) ===`)

    // 2. tasks 全部
    const tk = await pool.query(
      `SELECT id, student_id, status, original_name, task_type, subject, created_at, updated_at, deleted_at,
              worksheet_id, generated_exam_id
       FROM tasks WHERE student_id = $1 ORDER BY created_at DESC`,
      [s.id]
    )
    const alive = tk.rows.filter(r => r.deleted_at === null)
    const dead = tk.rows.filter(r => r.deleted_at !== null)
    console.log(`\ntasks 共 ${tk.rowCount} 条；deleted_at IS NULL: ${alive.length}，deleted_at NOT NULL: ${dead.length}`)
    console.log('-- 可见(未删) --')
    console.log(JSON.stringify(alive.slice(0, 10), null, 2))
    console.log('-- 不可见(已删) --')
    console.log(JSON.stringify(dead.slice(0, 10), null, 2))

    // 3. wrong_questions 全部
    const wq = await pool.query(
      `SELECT id, status, lifecycle_status, created_at FROM wrong_questions WHERE student_id = $1 ORDER BY created_at DESC`,
      [s.id]
    )
    console.log(`\nwrong_questions 共 ${wq.rowCount} 条`)
    console.log(JSON.stringify(wq.rows, null, 2))

    // 4. worksheet_answers (新版本表) - 是否仍指向有效 task?
    const wa = await pool.query(
      `SELECT id, task_id, question_no, section, unit_id, sub_no, created_at
       FROM worksheet_answers WHERE task_id IN (SELECT id FROM tasks WHERE student_id = $1)
       ORDER BY created_at DESC LIMIT 5`,
      [s.id]
    )
    console.log(`\nworksheet_answers(tasks 关联) 共 ${wa.rowCount} 条 (头 5 条)`)
    console.log(JSON.stringify(wa.rows, null, 2))

    // 5. questions
    const qq = await pool.query(
      `SELECT COUNT(*)::int AS n FROM questions WHERE student_id = $1`,
      [s.id]
    )
    console.log(`\nquestions 共 ${qq.rows[0].n} 条`)
  }

  await pool.end()
}

main().catch(e => { console.error(e); pool.end() })