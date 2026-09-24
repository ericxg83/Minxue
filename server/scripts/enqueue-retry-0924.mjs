/**
 * 按 retryTaskById 的口径「重新入队」一个或多个 task —— 但**只入队、不起本地 worker**。
 *
 * 为什么要有这个脚本（2026-09-24 事故）：
 *   同一批 task 被「直调 processTask 的脚本 + 本地 server + 线上 worker」三方并发重批，
 *   产生重复行 / FK 报错。要重跑某个 task，正确做法是把 job 放进 `task-processing` 队列，
 *   让**唯一**的消费者去处理；绝不能本地 import worker 直调 processTask。
 *
 * 用法：node server/scripts/enqueue-retry-0924.mjs <前缀1> [前缀2 ...]
 * 安全：① 逐个先查队列里有没有同一 task 的未完成 job，有就跳过（防重复入队）；
 *       ② 只改 status/result/retry_count/last_error，不碰 questions（processTask 自己会 delete+重建）。
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const PREFIXES = process.argv.slice(2).map(s => s.trim()).filter(Boolean)
if (!PREFIXES.length) { console.error('用法: node server/scripts/enqueue-retry-0924.mjs <前缀1> [前缀2 ...]'); process.exit(1) }

const { redisManager } = await import('../redisManager.js')
const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

await redisManager.init()
const connection = await redisManager.getAvailableClient()
if (!connection) throw new Error('无法连接 Redis')
const { Queue } = await import('bullmq')
const queue = new Queue('task-processing', { connection })

const active = await queue.getJobs(['waiting', 'active', 'delayed', 'paused'])
const busyTaskIds = new Set(active.map(j => j.data?.taskId).filter(Boolean))
console.log(`队列未完成 job=${active.length}（同 task 去重判据用）\n`)

for (const PREFIX of PREFIXES) {
  const { rows } = await pool.query(`SELECT * FROM tasks WHERE id::text LIKE $1 || '%'`, [PREFIX])
  if (!rows.length) { console.log(`${PREFIX} ✗ 未找到任务`); continue }
  const task = rows[0]
  const tag = task.id.slice(0, 8)
  if (task.deleted_at) { console.log(`${tag} ✗ 已软删，跳过`); continue }
  if (busyTaskIds.has(task.id)) { console.log(`${tag} ⚠️ 队列里已有未完成 job，跳过（防重复重批）`); continue }
  if (task.status === 'processing') { console.log(`${tag} ⚠️ 当前正在 processing，跳过`); continue }

  const result = task.result || {}
  await pool.query(
    `UPDATE tasks SET status='pending', result=$1, retry_count=0, last_error=NULL, updated_at=NOW() WHERE id=$2`,
    [JSON.stringify({ progress: 0, retryCount: (result.retryCount || 0) + 1, previousError: result.error || null }), task.id]
  )
  const job = await queue.add('process-task', {
    taskId: task.id,
    studentId: task.student_id,
    imageUrl: task.image_url,
    images: task.images || null,
    originalName: task.original_name,
    taskType: task.task_type || null,
    worksheetId: task.worksheet_id || null,
    subject: task.subject || null,
    resourceId: task.task_type === 'workbook'
      ? (task.resource_id || null)
      : (task.resource_id || task.worksheet_id || null),
    generatedExamId: task.generated_exam_id || null
  }, {
    attempts: parseInt(process.env.MAX_RETRIES) || 3,
    backoff: { type: 'exponential', delay: 5000 }
  })
  busyTaskIds.add(task.id)
  console.log(`${tag} ✅ 已入队 job=${job.id} type=${task.task_type} name=${task.original_name}`)
}

const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')
console.log('\n队列计数:', JSON.stringify(counts))

await queue.close()
await pool.end()
process.exit(0)
