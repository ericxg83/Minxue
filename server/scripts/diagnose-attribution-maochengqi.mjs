/**
 * 诊断：毛辰琦的试卷被归到了范梓琪名下。
 * 只读查询，不改库。
 *  - 两个学生的 id
 *  - 范梓琪近期任务（含 worksheet / 题目 / 错题 / 判题 数量）
 *  - 候选任务详列，便于人工确认哪条是毛辰琦的
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

const NAMES = ['毛辰琦', '范梓琪']

async function main() {
  // 1. 学生
  const stu = await pool.query(
    `SELECT id, name, grade, enrollment_status, created_at FROM students WHERE name = ANY($1) ORDER BY name`,
    [NAMES]
  )
  console.log('=== 学生 ===')
  console.log(JSON.stringify(stu.rows, null, 2))

  // 模糊匹配，防止姓名有空格/异体字
  const fuzzy = await pool.query(
    `SELECT id, name FROM students WHERE name LIKE '%毛%' OR name LIKE '%辰%' OR name LIKE '%范%' OR name LIKE '%梓%' ORDER BY name`
  )
  console.log('\n=== 模糊匹配 ===')
  console.log(JSON.stringify(fuzzy.rows, null, 2))

  const fan = stu.rows.find(r => r.name === '范梓琪')
  if (!fan) { console.log('\n❌ 未找到范梓琪，终止'); await pool.end(); return }

  // 2. 范梓琪名下任务（近 7 天）
  const tk = await pool.query(
    `SELECT id, status, original_name, task_type, subject, worksheet_id,
            jsonb_array_length(COALESCE(images,'[]'::jsonb))::int AS image_count,
            created_at, updated_at, deleted_at
     FROM tasks
     WHERE student_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC`,
    [fan.id]
  )
  console.log(`\n=== 范梓琪(${fan.id}) 近 7 天任务 ${tk.rowCount} 条 ===`)

  for (const t of tk.rows) {
    const q = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_correct = false)::int AS wrong,
              COUNT(*) FILTER (WHERE is_correct IS NULL)::int AS unresolved
       FROM questions WHERE task_id = $1`, [t.id])
    const wq = await pool.query(
      `SELECT COUNT(*)::int AS n FROM wrong_questions
       WHERE question_id IN (SELECT id FROM questions WHERE task_id = $1)`, [t.id])
    const jd = await pool.query(
      `SELECT COUNT(*)::int AS n FROM judgements
       WHERE question_id IN (SELECT id::text FROM questions WHERE task_id = $1)`, [t.id])
    console.log('\n---')
    console.log(JSON.stringify({
      task_id: t.id,
      status: t.status,
      original_name: t.original_name,
      task_type: t.task_type,
      subject: t.subject,
      worksheet_id: t.worksheet_id,
      images: t.image_count,
      created_at: t.created_at,
      updated_at: t.updated_at,
      deleted_at: t.deleted_at,
      questions: q.rows[0],
      wrong_questions: wq.rows[0]?.n,
      judgements: jd.rows[0]?.n
    }, null, 2))
  }

  // 3. 该学生名下 worksheet 关联
  console.log('\n=== 范梓琪 worksheets 关联 ===')
  try {
    const ws = await pool.query(
      `SELECT ws.id, ws.title, ws.subject, ws.created_at
       FROM worksheets ws
       WHERE ws.id IN (SELECT DISTINCT worksheet_id FROM tasks WHERE student_id = $1 AND worksheet_id IS NOT NULL)`,
      [fan.id])
    console.log(JSON.stringify(ws.rows, null, 2))
  } catch (e) { console.log('（无 worksheets 表或无关联）', e.message) }

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
