/**
 * 诊断：作业图片误归到蔡怡希名下（用户本意为陆晨曦）。
 * 只读查询，不改库。
 *  - 学生信息（陆晨曦 / 蔡怡希）
 *  - 蔡怡希近 2 天新建的 tasks 及 questions / wrong_questions / judgements 归属
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2
})

const NAMES = ['陆晨曦', '蔡怡希']

async function main() {
  const out = []
  const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x, null, 2)).join(' '); out.push(s); console.log(s) }
  const stu = await pool.query(
    `SELECT id, name, grade, created_at FROM students WHERE name = ANY($1) ORDER BY name`,
    [NAMES]
  )
  log('=== 学生 ===')
  log(stu.rows)
  if (stu.rows.length === 0) { await pool.end(); return }

  for (const s of stu.rows) {
    const tk = await pool.query(
      `SELECT id, status, original_name, task_type, subject, worksheet_id, created_at, updated_at
       FROM tasks
       WHERE student_id = $1 AND deleted_at IS NULL
         AND created_at >= NOW() - INTERVAL '2 days'
       ORDER BY created_at DESC`,
      [s.id]
    )
    log(`\n=== ${s.name} (${s.id}) 近2天任务 ${tk.rowCount} 条 ===`)
    for (const t of tk.rows) {
      const q = await pool.query(
        `SELECT COUNT(*)::int AS questions,
                COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong
         FROM questions WHERE task_id = $1`,
        [t.id]
      )
      const wq = await pool.query(
        `SELECT COUNT(*)::int AS wrong_questions FROM wrong_questions
         WHERE question_id IN (SELECT id FROM questions WHERE task_id = $1)`,
        [t.id]
      )
      const imgs = await pool.query(
        `SELECT jsonb_array_length(COALESCE(images, '[]'::jsonb))::int AS image_count
         FROM tasks WHERE id = $1`,
        [t.id]
      )
      log({
        task: t,
        images: imgs.rows[0]?.image_count,
        questions: q.rows[0],
        wrong_questions: wq.rows[0]?.wrong_questions
      })
    }
  }
  await pool.end()
}


main().catch(e => { console.error(e); process.exit(1) })
