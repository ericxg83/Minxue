/**
 * 单进程顺序重批多份 L1-d 误挂卷（不走 Redis 队列）：
 *   - 每份调用 processTask（deleteQuestionsByTaskId + 重建），保证单批次无重复
 *   - 顺序执行，避免并发与线上 worker 抢同一份卷产生重复行
 *   - 答案引擎：由 shell 注入 ANSWER_ENGINE_VENDOR/MODEL 覆盖（默认应传 Bailian 付费模型）
 *
 * 用法（在 server/ 目录用绝对路径的 node 跑，并通过环境变量指定付费主模型）：
 *   ANSWER_ENGINE_VENDOR=Bailian ANSWER_ENGINE_MODEL=qwen3.8-flash \
 *   ANSWER_ENGINE_FALLBACK_MODELS=deepseek-v4-pro \
 *   ANSWER_ENGINE_FALLBACK_VENDORS='SenseNova:kimi-k3' \
 *   node server/scripts/rerun-homework-batch.mjs --tasks=deb4a13d,4cd6cde0,6f13049b,0e5d6db1
 */
import dotenv from 'dotenv'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })

// 打印当前答案引擎口径（确认付费模型生效）
console.log('[config] ANSWER_ENGINE =', process.env.ANSWER_ENGINE_VENDOR, '/', process.env.ANSWER_ENGINE_MODEL)
console.log('[config] FALLBACK_MODELS =', process.env.ANSWER_ENGINE_FALLBACK_MODELS)
console.log('[config] FALLBACK_VENDORS =', process.env.ANSWER_ENGINE_FALLBACK_VENDORS)

const arg = (name) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(`--${name}=`.length) || null
const TASKS = (arg('tasks') || '').split(',').map(s => s.trim()).filter(Boolean)
if (!TASKS.length) { console.error('❌ 缺少 --tasks=前缀1,前缀2,...'); process.exit(1) }

const { Pool } = await import('pg')
const pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
const { processTask } = await import('../worker.js')

for (const prefix of TASKS) {
  console.log(`\n================== 重批 ${prefix} ==================`)
  const { rows: t } = await pool.query(
    `SELECT id, status, task_type, image_url, images, student_id, original_name, worksheet_id, resource_id, generated_exam_id
     FROM tasks WHERE id::text LIKE $1`,
    [prefix + '%']
  )
  if (!t.length) { console.error(`❌ 未找到 ${prefix}`); continue }
  if (t.length > 1) { console.error(`❌ 前缀 ${prefix} 匹配多个`); continue }
  const task = t[0]
  const images = Array.isArray(task.images) ? task.images : []
  if (!images.length) { console.error('❌ images 为空'); continue }

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

  const t0 = Date.now()
  try {
    await processTask(job)
    console.log(`✅ ${prefix} 完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  } catch (e) {
    console.error(`❌ ${prefix} 失败:`, e?.message)
    console.error(e?.stack?.split('\n').slice(0, 6).join('\n'))
  }

  const { rows: chk } = await pool.query(
    `SELECT COUNT(*)::int total,
            (SELECT COUNT(DISTINCT question_number)::int FROM questions WHERE task_id=$1) distinct_no,
            (SELECT SUM(CASE WHEN answer IS NULL OR answer='' OR answer='待人工补充' OR answer='此为主观题，无法自动求解' OR answer='-' THEN 1 ELSE 0 END)::int
             FROM questions WHERE task_id=$1) ans_empty
     FROM questions WHERE task_id=$1`,
    [task.id]
  )
  const c = chk[0]
  console.log(`   题行数=${c.total}  不重复题号=${c.distinct_no}  缺答案=${c.ans_empty}  ${c.total === c.distinct_no ? '✅无重复' : '⚠️仍有重复'}`)
}

await pool.end()
process.exit(0)
