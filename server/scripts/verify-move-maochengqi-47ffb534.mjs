import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 })

const TASK = '47ffb534-e6f3-418c-8ef7-e7faad80b60e'
const FAN = '91099a74-79f8-4de3-a178-2dc5594168c0'
const MAO = '31b7d263-0eb0-476e-836e-faa7977b15f4'

const t = await pool.query(
  `SELECT t.id, t.original_name, t.status, s.name AS student, t.student_id
   FROM tasks t JOIN students s ON s.id=t.student_id WHERE t.id=$1`, [TASK])
console.log('=== 任务归属 ===')
console.log(JSON.stringify(t.rows, null, 2))

const q = await pool.query(
  `SELECT s.name, COUNT(*)::int n FROM questions q JOIN students s ON s.id=q.student_id
   WHERE q.task_id=$1 GROUP BY s.name`, [TASK])
const w = await pool.query(
  `SELECT s.name, COUNT(*)::int n FROM wrong_questions w JOIN students s ON s.id=w.student_id
   WHERE w.question_id IN (SELECT id FROM questions WHERE task_id=$1) GROUP BY s.name`, [TASK])
const j = await pool.query(
  `SELECT s.name, COUNT(*)::int n FROM judgements j JOIN students s ON s.id::text=j.student_id
   WHERE j.question_id IN (SELECT id::text FROM questions WHERE task_id=$1) GROUP BY s.name`, [TASK])
console.log('\nquestions 归属:', JSON.stringify(q.rows))
console.log('wrong_questions 归属:', JSON.stringify(w.rows))
console.log('judgements 归属:', JSON.stringify(j.rows))

console.log('\n=== 两人名下作业 ===')
for (const [n, id] of [['毛辰绮', MAO], ['范梓琪', FAN]]) {
  const r = await pool.query(
    `SELECT original_name, status, created_at FROM tasks WHERE student_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [id])
  console.log(`\n【${n}】${r.rowCount} 条`)
  r.rows.forEach(x => console.log(`  ${x.created_at.toISOString().slice(0, 10)} | ${x.status.padEnd(9)} | ${x.original_name}`))
}

console.log('\n=== 备份可回滚性 ===')
const bk = await pool.query(
  `SELECT table_name, COUNT(*)::int n FROM backup_misattr_20260911 GROUP BY table_name ORDER BY table_name`)
console.log(JSON.stringify(bk.rows))

await pool.end()
