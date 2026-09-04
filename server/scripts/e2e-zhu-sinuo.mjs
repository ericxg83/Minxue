// 本地端到端跑朱思诺 task 一次：直接调 processTask，看新代码能否成功
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pg from 'pg'
const { Pool } = pg

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
})

// 1) 拿朱思诺 task 信息
const { rows } = await pool.query(
  `SELECT id, student_id, image_url, original_name, images, task_type, worksheet_id, resource_id, generated_exam_id, status, retry_count, last_error
   FROM tasks WHERE id='87240cbf-abd5-45ea-972d-55befd4037f8'`
)
const task = rows[0]
console.log('📋 任务现状：')
console.log(JSON.stringify(task, null, 2))

if (task.status === 'done') {
  console.log('\n✅ 任务已完成，跳过')
  await pool.end()
  process.exit(0)
}

// 2) 备份原 status（万一失败要还原）
const ORIGINAL = { ...task }

// 3) 重置为 pending（模拟 retryTaskById 的第一步）
await pool.query(
  `UPDATE tasks SET status='pending', retry_count=0, last_error=NULL, updated_at=NOW() WHERE id=$1`,
  [task.id]
)
console.log('\n🔄 重置为 pending，开始本地跑 processTask...')

// 4) 直接调 processTask，job.data 从 task 行还原（不依赖 BullMQ）
const { processTask } = await import('../worker.js')

const job = {
  id: 'local-e2e-' + Date.now(),
  data: {
    taskId: task.id,
    studentId: task.student_id,
    imageUrl: task.image_url,
    images: task.images,
    originalName: task.original_name,
    taskType: task.task_type,
    worksheetId: task.worksheet_id,
    resourceId: task.resource_id,
    generatedExamId: task.generated_exam_id
  },
  updateProgress: async () => {},
  log: () => {}
}

try {
  console.log(`\n⏱  启动 ${new Date().toISOString()}`)
  const result = await processTask(job)
  console.log(`\n✅ processTask 返回：`)
  console.log(JSON.stringify(result, null, 2))
} catch (e) {
  console.log(`\n❌ processTask 抛出：${e.message}`)
  console.log(e.stack)
}

// 5) 看最终状态
const { rows: final } = await pool.query(
  `SELECT status, retry_count, last_error, updated_at, result FROM tasks WHERE id=$1`,
  [task.id]
)
console.log('\n📋 最终状态：')
console.log(JSON.stringify(final[0], null, 2))

// 6) 看 questions 表
const { rows: qs } = await pool.query(
  `SELECT COUNT(*)::int AS n FROM questions WHERE task_id=$1`,
  [task.id]
)
console.log(`\n📋 questions 行数：${qs[0].n}`)

// 7) 如果失败，恢复原状态
if (final[0].status === 'failed') {
  console.log(`\n⚠️  task 失败，恢复原状态: ${ORIGINAL.status}`)
  await pool.query(
    `UPDATE tasks SET status=$1, retry_count=$2, last_error=$3 WHERE id=$4`,
    [ORIGINAL.status, ORIGINAL.retry_count, ORIGINAL.last_error, task.id]
  )
}

await pool.end()