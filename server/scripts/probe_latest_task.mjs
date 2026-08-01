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
  // 查最新任务
  const { rows: tasks } = await pool.query(`
    SELECT id, original_name, status, result, created_at
    FROM tasks
    WHERE worksheet_id = '1c31ee45-0879-4d53-a54c-60af85ee15cc'
    ORDER BY created_at DESC LIMIT 3
  `)
  console.log('=== 最近 3 个任务 ===')
  for (const t of tasks) {
    console.log(`\n${t.id} | ${t.status} | ${t.original_name} | ${t.created_at.toISOString()}`)
    const result = typeof t.result === 'string' ? JSON.parse(t.result) : t.result
    if (result) {
      console.log(`  matched_unit: ${result.sectionMatch?.pages?.[0]?.matched_unit}`)
      console.log(`  page_title: ${result.sectionMatch?.pages?.[0]?.page_title}`)
      console.log(`  wrongCount: ${result.wrongCount}, matchedCount: ${result.matchedCount}`)
    }
  }

  // 看最新任务的 questions 表
  const latestId = tasks[0].id

  // 先查 questions 表字段
  const { rows: cols } = await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name='questions' ORDER BY ordinal_position
  `)
  console.log('\n=== questions 表字段 ===')
  console.log(cols.map(c => c.column_name).join(', '))

  const { rows: qs } = await pool.query(`
    SELECT * FROM questions WHERE task_id = $1 ORDER BY page_number, id
  `, [latestId])
  console.log(`\n=== 最新任务 ${latestId} questions 表 ${qs.length} 条 ===`)
  for (const q of qs) {
    const mark = q.is_correct === false ? '❌' : q.is_correct === true ? '✓' : '?'
    const sa = (q.student_answer || '').slice(0, 50)
    const ans = (q.answer || '').slice(0, 30)
    console.log(`  p${q.page_number} q${q.question_number} ${mark} suspicious=${q.is_suspicious} | student="${sa}" | ref="${ans}"`)
  }

  await pool.end()
}
run().catch(console.error)
