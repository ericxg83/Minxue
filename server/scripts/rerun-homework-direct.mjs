/**
 * 本地直接调用 processTask（通用/homework 批改管线）重跑指定任务，**不走 Redis 队列**，
 * 保证单进程内 deleteQuestionsByTaskId + 重建，不与线上 worker 竞争 → 不会产生重复题。
 *
 * 背景：L1-d 误挂卷转 homework 后，早先多次并发 retry 与线上 worker 互相覆盖，
 *       导致 questions 出现重复行。本脚本为"干净重批"的兜底修复。
 *
 * 用法:
 *   node server/scripts/rerun-homework-direct.mjs --task=<id前缀>
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(`--${name}=`.length) || null
const TASK_PREFIX = arg('task')
if (!TASK_PREFIX) { console.error('❌ 缺少 --task=<id前缀>'); process.exit(1) }

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })

const { rows: t } = await pool.query(
  `SELECT id, status, task_type, image_url, images, student_id, original_name, worksheet_id, resource_id, generated_exam_id
   FROM tasks WHERE id::text LIKE $1`,
  [TASK_PREFIX + '%']
)
if (!t.length) { console.error(`❌ 未找到任务 ${TASK_PREFIX}`); process.exit(1) }
if (t.length > 1) { console.error(`❌ 前缀 ${TASK_PREFIX} 匹配多个`); process.exit(1) }
const task = t[0]
const images = Array.isArray(task.images) ? task.images : []
console.log(`\n===== 本地直调 processTask 重批 =====`)
console.log(`  taskId   = ${task.id}`)
console.log(`  status   = ${task.status}  type=${task.task_type}`)
console.log(`  pages    = ${images.length}`)
if (!images.length) { console.error('❌ images 为空，无法多页重批'); process.exit(1) }

// 重置为 pending，避免列表页显示旧结论（与 rerun-workbook-direct 一致）
await pool.query(`UPDATE tasks SET status='pending', result=NULL, last_error=NULL WHERE id=$1`, [task.id])

const job = {
  id: `local-${task.id.slice(0, 8)}`,
  data: {
    taskId: task.id,
    studentId: task.student_id,
    imageUrl: task.image_url,
    images,
    originalName: task.original_name,
    taskType: task.task_type || 'homework',
    worksheetId: task.worksheet_id || null,
    resourceId: task.resource_id || null,
    generatedExamId: task.generated_exam_id || null,
  },
  updateProgress: async () => {},
}

console.log('开始执行（本机代码，不走队列）...')
const { processTask } = await import('../worker.js')
const t0 = Date.now()
try {
  await processTask(job)
  console.log(`\n✅ 完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
} catch (e) {
  console.error('\n❌ 执行失败:', e?.message)
  console.error(e?.stack?.split('\n').slice(0, 6).join('\n'))
}

const after = await pool.query(`SELECT status FROM tasks WHERE id=$1`, [task.id])
console.log(`\n结果: status=${after.rows[0].status}`)

// 去重校验
const { rows: chk } = await pool.query(
  `SELECT COUNT(*)::int total,
          (SELECT COUNT(DISTINCT question_number)::int FROM questions WHERE task_id=$1) distinct_no
   FROM questions WHERE task_id=$1`,
  [task.id]
)
console.log(`题行数=${chk[0].total}  distinct题号=${chk[0].distinct_no} ${chk[0].total === chk[0].distinct_no ? '✅ 无重复' : '⚠️ 仍有重复'}`,
)

await pool.end()
process.exit(0)
